import {
  K,
  SNOOZE_MINUTES,
  dayKey,
  storeKey,
  hostFromUrl,
  getSettings,
  getLimits,
  readDay,
  dur,
  badgeText,
} from './common.js';

const ALARM_TICK = 'tick';
const ALARM_PRUNE = 'prune';
// Guards against clock jumps (laptop sleep, a delayed alarm):
// never credit more than five minutes in a single pass.
const MAX_CHUNK = 300;

/* ---------- serialise handlers so events don't overwrite each other ---------- */

let chain = Promise.resolve();
function lock(fn) {
  const next = chain.then(fn).catch((e) => console.error('[Chrono]', e));
  chain = next;
  return next;
}

/* ---------- writing time ---------- */

async function addTime(host, sec, at) {
  const d = new Date(at);
  const key = dayKey(d);
  const sk = storeKey(key);
  const store = await chrome.storage.local.get(sk);
  const day = store[sk] || {};
  const rec = day[host] || { t: 0, h: {} };
  const hour = d.getHours();
  rec.t += sec;
  rec.h[hour] = (rec.h[hour] || 0) + sec;
  day[host] = rec;
  await chrome.storage.local.set({ [sk]: day });
  return { key, total: rec.t };
}

/** Credits the running session and moves its start point forward. */
async function commit(endAt = Date.now()) {
  const r = await chrome.storage.local.get(K.SESSION);
  const session = r[K.SESSION];
  if (!session) return null;

  let sec = Math.floor((endAt - session.startedAt) / 1000);
  if (sec > MAX_CHUNK) sec = MAX_CHUNK;

  let written = null;
  if (sec > 0) written = await addTime(session.host, sec, endAt);

  const updated = { ...session, startedAt: Math.max(session.startedAt, endAt) };
  await chrome.storage.local.set({ [K.SESSION]: updated });
  return { session: updated, ...(written || {}) };
}

async function stopSession(endAt = Date.now()) {
  const info = await commit(endAt);
  await chrome.storage.local.remove(K.SESSION);
  return info;
}

/* ---------- which tab is in front ---------- */

async function activeTab(settings) {
  let win;
  try {
    win = await chrome.windows.getLastFocused();
  } catch {
    return null;
  }
  // Browser window isn't focused — the person is in another app.
  if (!win || !win.focused) return null;
  if (win.incognito && settings.skipIncognito) return null;

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  } catch {
    return null;
  }
  if (!tab || (tab.incognito && settings.skipIncognito)) return null;
  return tab;
}

/* ---------- main handler ---------- */

async function sync() {
  const settings = await getSettings();
  const tab = settings.paused ? null : await activeTab(settings);
  const host = tab ? hostFromUrl(tab.url) : null;
  const now = Date.now();

  const r = await chrome.storage.local.get(K.SESSION);
  const current = r[K.SESSION];

  let info = null;
  if (current && current.host === host) {
    info = await commit(now);
  } else {
    if (current) await stopSession(now);
    if (host) {
      await chrome.storage.local.set({
        [K.SESSION]: { host, startedAt: now, since: now, remindedAt: 0 },
      });
    }
  }

  if (host) await enforceLimit(host, tab, now, settings, info);
  if (info) await focusReminder(info.session, now, settings);
  await updateBadge(host);
}

/* ---------- notifications ---------- */

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 1,
  });
}

/**
 * What actually happens when a daily limit runs out:
 *   1. a notification, repeated every `limitRepeatMinutes` while still over;
 *   2. the toolbar badge turns red;
 *   3. if "dim the page" is on and permission was granted, an overlay is
 *      injected into the tab with a Snooze and a Close tab button.
 * Nothing is ever blocked silently and the tab is never closed on its own.
 */
async function enforceLimit(host, tab, now, settings, info) {
  const limits = await getLimits();
  const limit = limits[host];
  if (!limit) return;

  const key = info?.key || dayKey();
  const total = info?.total ?? (await readDay(key))[host]?.t ?? 0;
  if (total < limit) return;

  const flag = `${key}|${host}`;
  const nr = await chrome.storage.local.get(K.NOTIFIED);
  const notified = nr[K.NOTIFIED] || {};
  const last = typeof notified[flag] === 'number' ? notified[flag] : 0;
  const repeatMs = (settings.limitRepeatMinutes || 0) * 60000;
  const due = last === 0 || (repeatMs > 0 && now - last >= repeatMs);

  if (settings.notifyLimits && due) {
    notified[flag] = now;
    await chrome.storage.local.set({ [K.NOTIFIED]: notified });
    notify(
      `limit:${flag}:${now}`,
      last === 0 ? 'Daily limit reached' : 'Still over the limit',
      `${host} — ${dur(total)} of ${dur(limit)}`
    );
  }

  if (settings.limitAction === 'block' && tab) {
    await dimPage(tab, host, total, limit, now);
  }
}

async function dimPage(tab, host, total, limit, now) {
  const sr = await chrome.storage.local.get(K.SNOOZE);
  const snooze = sr[K.SNOOZE] || {};
  if (snooze[host] && snooze[host] > now) return;

  let granted = false;
  try {
    granted = await chrome.permissions.contains({
      permissions: ['scripting'],
      origins: ['<all_urls>'],
    });
  } catch {
    granted = false;
  }
  if (!granted) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: overlay,
      args: [host, dur(total), dur(limit), SNOOZE_MINUTES],
    });
  } catch {
    // Restricted page (web store, chrome://, PDF viewer) — nothing to inject into.
  }
}

/** Runs inside the page. Must be fully self-contained. */
function overlay(host, spent, limit, snoozeMinutes) {
  const ID = 'chrono-limit-overlay';
  if (document.getElementById(ID)) return;

  const root = document.createElement('div');
  root.id = ID;
  root.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;color-scheme:dark';
  const shadow = root.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      .veil{position:fixed;inset:0;background:rgba(14,26,34,.94);
        backdrop-filter:blur(3px);display:flex;align-items:center;
        justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
      .card{max-width:380px;padding:32px 34px;text-align:center;color:#E7EFF3}
      .eyebrow{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;
        letter-spacing:.16em;text-transform:uppercase;color:#7D97A5}
      h2{font-size:21px;font-weight:500;margin:12px 0 8px}
      p{font-size:13.5px;line-height:1.55;color:#7D97A5;margin:0 0 22px}
      b{color:#F5B944;font-weight:500}
      .row{display:flex;gap:9px;justify-content:center}
      button{font:inherit;font-size:13px;padding:9px 15px;border-radius:6px;
        border:1px solid #23404F;background:transparent;color:#E7EFF3;cursor:pointer}
      button:hover{border-color:#7D97A5}
      button.go{border-color:#F5B944;color:#F5B944}
      button.go:hover{background:rgba(245,185,68,.1)}
    </style>
    <div class="veil">
      <div class="card">
        <div class="eyebrow">daily limit reached</div>
        <h2>${host}</h2>
        <p><b>${spent}</b> today, limit is ${limit}.</p>
        <div class="row">
          <button class="go" id="close">Close tab</button>
          <button id="snooze">${snoozeMinutes} more minutes</button>
        </div>
      </div>
    </div>`;

  shadow.getElementById('snooze').addEventListener('click', () => {
    root.remove();
    chrome.runtime.sendMessage({ type: 'snooze', host });
  });
  shadow.getElementById('close').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'close-tab' });
  });

  document.documentElement.appendChild(root);
}

async function focusReminder(session, now, settings) {
  if (!settings.reminderMinutes || !session) return;
  const base = session.remindedAt || session.since;
  if (now - base < settings.reminderMinutes * 60000) return;

  await chrome.storage.local.set({
    [K.SESSION]: { ...session, remindedAt: now },
  });
  const mins = Math.round((now - session.since) / 60000);
  notify(
    `focus:${session.host}:${now}`,
    'Time check',
    `${session.host} — ${mins} minutes without a break`
  );
}

/* ---------- toolbar badge ---------- */

async function updateBadge(host) {
  if (!host) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Chrono' });
    return;
  }
  const day = await readDay(dayKey());
  const total = day[host]?.t || 0;
  const limits = await getLimits();
  const limit = limits[host];
  const over = limit && total >= limit;

  await chrome.action.setBadgeText({ text: badgeText(total) });
  await chrome.action.setBadgeBackgroundColor({ color: over ? '#E8825A' : '#F5B944' });
  await chrome.action.setTitle({
    title: `${host} — ${dur(total)} today${limit ? ` of ${dur(limit)}` : ''}`,
  });
}

/* ---------- housekeeping ---------- */

async function prune() {
  const settings = await getSettings();
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - settings.keepDays);
  const cutoffKey = dayKey(cutoff);

  const drop = Object.keys(all).filter(
    (k) => k.startsWith('d:') && k.slice(2) < cutoffKey
  );

  const today = dayKey();
  const notified = {};
  for (const [k, v] of Object.entries(all[K.NOTIFIED] || {})) {
    if (k.split('|')[0] === today) notified[k] = v;
  }

  const now = Date.now();
  const snooze = {};
  for (const [k, v] of Object.entries(all[K.SNOOZE] || {})) {
    if (v > now) snooze[k] = v;
  }

  if (drop.length) await chrome.storage.local.remove(drop);
  await chrome.storage.local.set({ [K.NOTIFIED]: notified, [K.SNOOZE]: snooze });
}

/* ---------- startup ---------- */

async function boot() {
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(15, settings.idleSeconds));
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  chrome.alarms.create(ALARM_PRUNE, { periodInMinutes: 360 });
  await sync();
}

chrome.runtime.onInstalled.addListener(() => lock(boot));
chrome.runtime.onStartup.addListener(() => lock(boot));

/* ---------- browser events ---------- */

chrome.tabs.onActivated.addListener(() => lock(sync));

chrome.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.status === 'complete') lock(sync);
});

chrome.tabs.onRemoved.addListener(() => lock(sync));

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    lock(() => stopSession().then(() => updateBadge(null)));
  } else {
    lock(sync);
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  lock(async () => {
    if (state === 'active') {
      await sync();
      return;
    }
    const settings = await getSettings();
    const session = (await chrome.storage.local.get(K.SESSION))[K.SESSION];
    if (session) {
      // Video and music play without mouse movement — that isn't idle.
      if (settings.countAudible) {
        const tab = await activeTab(settings);
        if (tab && tab.audible) return;
      }
      // Roll back the idle threshold: those seconds weren't watched.
      await stopSession(Date.now() - settings.idleSeconds * 1000);
    }
    await updateBadge(null);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_TICK) lock(sync);
  if (alarm.name === ALARM_PRUNE) lock(prune);
});

/* ---------- messages from the UI and the overlay ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'flush' || msg?.type === 'settings-changed') {
    lock(async () => {
      if (msg.type === 'settings-changed') {
        const settings = await getSettings();
        chrome.idle.setDetectionInterval(Math.max(15, settings.idleSeconds));
      }
      await sync();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg?.type === 'snooze' && msg.host) {
    lock(async () => {
      const sr = await chrome.storage.local.get(K.SNOOZE);
      const snooze = sr[K.SNOOZE] || {};
      snooze[msg.host] = Date.now() + SNOOZE_MINUTES * 60000;
      await chrome.storage.local.set({ [K.SNOOZE]: snooze });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg?.type === 'close-tab' && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    return false;
  }

  if (msg?.type === 'wipe') {
    lock(async () => {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith('d:'));
      await chrome.storage.local.remove([...keys, K.SESSION, K.NOTIFIED, K.SNOOZE]);
      await sync();
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
