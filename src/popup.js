import {
  K,
  dayKey,
  humanDate,
  readDay,
  getSettings,
  setSettings,
  getLimits,
  dur,
  colorFor,
  sortedEntries,
} from './common.js';

const el = (id) => document.getElementById(id);
const TOP_N = 7;

let liveHost = null;
let liveSeconds = 0;
let dayTotal = 0;

async function render() {
  // Ask the worker to write down any pending seconds so the numbers are fresh.
  try {
    await chrome.runtime.sendMessage({ type: 'flush' });
  } catch {
    /* worker may have been asleep — not a problem */
  }

  const key = dayKey();
  const [day, settings, limits, sessionRec] = await Promise.all([
    readDay(key),
    getSettings(),
    getLimits(),
    chrome.storage.local.get(K.SESSION),
  ]);
  const session = sessionRec[K.SESSION];

  el('dateLabel').textContent = `today · ${humanDate(key)}`;

  const entries = sortedEntries(
    Object.fromEntries(Object.entries(day).map(([h, r]) => [h, r.t]))
  );
  dayTotal = entries.reduce((s, [, v]) => s + v, 0);
  el('total').textContent = dur(dayTotal);

  renderStrip(day);
  renderList(entries, limits);

  liveHost = session?.host || null;
  liveSeconds = liveHost ? day[liveHost]?.t || 0 : 0;
  const nowBox = el('nowBox');
  nowBox.hidden = !liveHost;
  if (liveHost) {
    el('nowHost').textContent = liveHost;
    el('nowTime').textContent = dur(liveSeconds);
  }

  const pause = el('pause');
  pause.textContent = settings.paused ? 'Resume' : 'Pause';
  pause.classList.toggle('paused', settings.paused);
}

/** The day as 24 columns — height is the share of that hour spent in the browser */
function renderStrip(day) {
  const hours = new Array(24).fill(0);
  const perHour = new Array(24).fill(null).map(() => ({}));

  for (const [host, rec] of Object.entries(day)) {
    for (const [h, sec] of Object.entries(rec.h || {})) {
      const i = Number(h);
      hours[i] += sec;
      perHour[i][host] = (perHour[i][host] || 0) + sec;
    }
  }

  const now = new Date();
  const currentHour = now.getHours();
  const strip = el('strip');
  strip.textContent = '';

  hours.forEach((sec, i) => {
    const d = document.createElement('div');
    d.className = 'hour';
    const label = `${String(i).padStart(2, '0')}:00`;
    if (sec > 0) {
      d.classList.add('has');
      const share = Math.min(1, sec / 3600);
      d.style.height = `${Math.max(8, Math.round(share * 100))}%`;
      d.style.opacity = String(0.45 + share * 0.55);
      const top = sortedEntries(perHour[i])[0];
      d.title = `${label} — ${dur(sec)} · ${top[0]}`;
    } else {
      d.style.height = '2px';
      if (i > currentHour) d.classList.add('future');
      d.title = `${label} — nothing`;
    }
    strip.appendChild(d);
  });

  const marker = document.createElement('span');
  marker.className = 'marker';
  marker.style.left = `${(((currentHour * 60 + now.getMinutes()) / 1440) * 100).toFixed(2)}%`;
  strip.appendChild(marker);
}

function renderList(entries, limits) {
  const list = el('list');
  list.textContent = '';

  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent =
      'Nothing counted yet today. Open any site and the clock starts on its own.';
    list.appendChild(p);
    return;
  }

  const max = entries[0][1];
  entries.slice(0, TOP_N).forEach(([host, sec]) => {
    const limit = limits[host];
    const over = limit && sec >= limit;

    const row = document.createElement('div');
    row.className = 'row' + (over ? ' over' : '');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorFor(host);

    const name = document.createElement('span');
    name.className = 'host';
    name.textContent = host;
    name.title = limit ? `${host} · limit ${dur(limit)}` : host;

    if (over) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'over';
      tag.title = `Limit ${dur(limit)} reached`;
      name.appendChild(tag);
    }

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = dur(sec);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(2, (sec / max) * 100)}%`;
    fill.style.background = over ? 'var(--coral)' : colorFor(host);
    bar.appendChild(fill);

    row.append(dot, name, time, bar);
    list.appendChild(row);
  });

  if (entries.length > TOP_N) {
    const rest = entries.slice(TOP_N);
    const sec = rest.reduce((s, [, v]) => s + v, 0);
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `+ ${rest.length} more ${
      rest.length === 1 ? 'site' : 'sites'
    } · ${dur(sec)}`;
    list.appendChild(more);
  }
}

/* Keeps the two visible numbers ticking while the popup is open.
   Minutes only, so the DOM is touched at most once a minute. */
setInterval(() => {
  if (!liveHost) return;
  liveSeconds += 1;
  dayTotal += 1;
  const a = dur(liveSeconds);
  const b = dur(dayTotal);
  if (el('nowTime').textContent !== a) el('nowTime').textContent = a;
  if (el('total').textContent !== b) el('total').textContent = b;
}, 1000);

el('pause').addEventListener('click', async () => {
  const s = await getSettings();
  await setSettings({ paused: !s.paused });
  await chrome.runtime.sendMessage({ type: 'settings-changed' }).catch(() => {});
  await render();
});

el('stats').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

render();
