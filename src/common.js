// Shared helpers for the service worker, the popup and the stats page.

export const K = {
  SETTINGS: 'settings',
  LIMITS: 'limits',
  SESSION: 'session',
  NOTIFIED: 'notified',
  SNOOZE: 'snooze',
};

export const DEFAULTS = {
  paused: false,            // counting is on hold
  idleSeconds: 60,          // no input for this long -> stop counting
  countAudible: true,       // a tab playing sound is never idle
  skipIncognito: true,      // ignore incognito windows
  notifyLimits: true,       // notify when a daily limit runs out
  limitAction: 'notify',    // 'notify' | 'block'  (block dims the page)
  limitRepeatMinutes: 15,   // remind again while still over the limit, 0 = once
  reminderMinutes: 0,       // "you've been here N minutes" nudge, 0 = off
  keepDays: 90,             // history retention
};

export const SNOOZE_MINUTES = 5;

export const PALETTE = ['#F5B944', '#E8825A', '#6FA9C9', '#9A8FC4', '#86B99A'];

export function colorFor(host) {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/* ---------- dates ---------- */

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function storeKey(key) {
  return `d:${key}`;
}

export function toDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** '2026-08-19' shifted by N days */
export function shiftKey(key, delta) {
  const d = toDate(key);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

/** N consecutive day keys ending at endKey (inclusive) */
export function rangeEndingAt(endKey, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftKey(endKey, -i));
  return out;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08-19' -> 'Wed 19 Aug' */
export function humanDate(key) {
  const d = toDate(key);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** '2026-08-19' -> '19 Aug' */
export function shortDate(key) {
  const d = toDate(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function relativeLabel(key) {
  const today = dayKey();
  if (key === today) return 'Today';
  if (key === shiftKey(today, -1)) return 'Yesterday';
  return null;
}

/* ---------- urls ---------- */

export function hostFromUrl(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.hostname.replace(/^www\./, '');
}

/* ---------- durations ---------- */

/** Hours and minutes only — 8420 -> '2h 20m'. Seconds are never shown. */
export function dur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return sec > 0 ? '<1m' : '0m';
}

/** Compact form for the toolbar badge — max 4 characters. */
export function badgeText(sec) {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = sec / 3600;
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
}

export function splitHm(sec) {
  return { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) };
}

/* ---------- storage ---------- */

export async function getSettings() {
  const r = await chrome.storage.local.get(K.SETTINGS);
  return { ...DEFAULTS, ...(r[K.SETTINGS] || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [K.SETTINGS]: next });
  return next;
}

export async function getLimits() {
  const r = await chrome.storage.local.get(K.LIMITS);
  return r[K.LIMITS] || {};
}

export async function setLimits(limits) {
  await chrome.storage.local.set({ [K.LIMITS]: limits });
}

/** One day: { host: { t: seconds, h: { hour: seconds } } } */
export async function readDay(key) {
  const sk = storeKey(key);
  const r = await chrome.storage.local.get(sk);
  return r[sk] || {};
}

export async function readRange(keys) {
  const sks = keys.map(storeKey);
  const r = await chrome.storage.local.get(sks);
  const out = {};
  keys.forEach((k, i) => {
    out[k] = r[sks[i]] || {};
  });
  return out;
}

/** Collapses several days into { host: seconds } */
export function totalsByHost(days) {
  const out = {};
  for (const day of Object.values(days)) {
    for (const [host, rec] of Object.entries(day)) {
      out[host] = (out[host] || 0) + rec.t;
    }
  }
  return out;
}

export function sortedEntries(totals) {
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}
