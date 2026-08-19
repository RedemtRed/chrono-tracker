import {
  DEFAULTS,
  dayKey,
  shiftKey,
  rangeEndingAt,
  humanDate,
  shortDate,
  relativeLabel,
  readRange,
  totalsByHost,
  sortedEntries,
  getSettings,
  setSettings,
  getLimits,
  setLimits,
  dur,
  splitHm,
  colorFor,
} from './common.js';

const el = (id) => document.getElementById(id);

let range = 1;
let anchor = dayKey(); // last day of the shown period
let selectedHost = null;
let days = {};
let limits = {};

/* ---------- date navigation ---------- */

function keys() {
  return rangeEndingAt(anchor, range);
}

function renderNav() {
  const picker = el('picker');
  picker.value = anchor;
  picker.max = dayKey();

  const rel = relativeLabel(anchor);
  el('navLabel').textContent =
    range === 1
      ? humanDate(anchor) + (rel ? ` · ${rel}` : '')
      : `${shortDate(keys()[0])} – ${shortDate(anchor)}`;

  const atToday = anchor === dayKey();
  el('next').disabled = atToday;
  el('today').disabled = atToday;
}

function move(dir) {
  const step = range === 1 ? 1 : range;
  const next = shiftKey(anchor, dir * step);
  anchor = next > dayKey() ? dayKey() : next;
  load();
}

/* ---------- loading ---------- */

async function load() {
  try {
    await chrome.runtime.sendMessage({ type: 'flush' });
  } catch {
    /* worker was asleep */
  }
  days = await readRange(keys());
  limits = await getLimits();

  const totals = totalsByHost(days);
  const entries = sortedEntries(totals);

  // A filter on a site that has no data here would show an empty chart.
  if (selectedHost && !totals[selectedHost]) selectedHost = null;

  renderNav();
  renderFilter();
  renderKpis(entries, totals);
  renderChart();
  renderTable(entries);
}

function renderFilter() {
  const box = el('filter');
  box.hidden = !selectedHost;
  if (!selectedHost) return;
  el('filterDot').style.background = colorFor(selectedHost);
  el('filterName').textContent = selectedHost;
}

function renderKpis(entries, totals) {
  const grand = entries.reduce((s, [, v]) => s + v, 0);
  const shown = selectedHost ? totals[selectedHost] || 0 : grand;
  const activeDays =
    Object.values(days).filter((d) => Object.keys(d).length).length || 1;
  const top = entries[0];

  const items = selectedHost
    ? [
        ['time on this site', dur(shown), false],
        ['share of period', grand ? `${((shown / grand) * 100).toFixed(1)}%` : '—', false],
        ['selected site', selectedHost, true],
        ['daily limit', limits[selectedHost] ? dur(limits[selectedHost]) : 'none', true],
      ]
    : [
        ['total', dur(grand), false],
        [
          range === 1 ? 'sites visited' : 'daily average',
          range === 1 ? String(entries.length) : dur(grand / activeDays),
          false,
        ],
        ['busiest site', top ? top[0] : '—', true],
        ['time on it', top ? dur(top[1]) : '—', true],
      ];

  const box = el('kpis');
  box.textContent = '';
  for (const [label, value, small] of items) {
    const cell = document.createElement('div');
    cell.className = 'kpi';
    const l = document.createElement('div');
    l.className = 'eyebrow';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'v' + (small ? ' small' : '');
    v.textContent = value;
    v.title = value;
    cell.append(l, v);
    box.appendChild(cell);
  }
}

function renderChart() {
  const chart = el('chart');
  const axis = el('chartAxis');
  chart.textContent = '';
  axis.textContent = '';

  const pick = (rec) => (selectedHost ? (rec ? rec.t : 0) : 0);
  let values, labels, title, hint;

  if (range === 1) {
    values = new Array(24).fill(0);
    const day = days[anchor] || {};
    for (const [host, rec] of Object.entries(day)) {
      if (selectedHost && host !== selectedHost) continue;
      for (const [h, sec] of Object.entries(rec.h || {})) values[Number(h)] += sec;
    }
    labels = values.map((_, i) => (i % 3 === 0 ? String(i).padStart(2, '0') : ''));
    title = 'by hour';
    const peak = values.indexOf(Math.max(...values));
    hint = Math.max(...values)
      ? `busiest hour ${String(peak).padStart(2, '0')}:00`
      : 'nothing recorded';
  } else {
    const ks = keys();
    values = ks.map((k) => {
      const day = days[k] || {};
      if (selectedHost) return pick(day[selectedHost]);
      return Object.values(day).reduce((s, r) => s + r.t, 0);
    });
    const step = range > 10 ? Math.ceil(range / 8) : 1;
    labels = ks.map((k, i) => (i % step === 0 ? shortDate(k) : ''));
    title = 'by day';
    const best = values.indexOf(Math.max(...values));
    hint = Math.max(...values) ? `busiest day ${humanDate(ks[best])}` : 'nothing recorded';
  }

  const max = Math.max(...values, 1);
  const peakIndex = values.indexOf(Math.max(...values));
  const accent = selectedHost ? colorFor(selectedHost) : 'var(--amber)';
  const ks = keys();

  values.forEach((v, i) => {
    const col = document.createElement('div');
    col.className = 'col' + (v === 0 ? ' zero' : '');
    col.style.height = v === 0 ? '2px' : `${Math.max(3, (v / max) * 100)}%`;
    if (v > 0) col.style.background = i === peakIndex ? 'var(--coral)' : accent;
    col.title =
      range === 1
        ? `${String(i).padStart(2, '0')}:00 — ${dur(v)}`
        : `${humanDate(ks[i])} — ${dur(v)}`;
    // In multi-day mode a column is a day you can open.
    if (range > 1) {
      col.classList.add('clickable');
      col.addEventListener('click', () => {
        anchor = ks[i];
        range = 1;
        [...el('tabs').children].forEach((b) =>
          b.classList.toggle('on', b.dataset.range === '1')
        );
        load();
      });
    }
    chart.appendChild(col);
  });

  labels.forEach((t) => {
    const s = document.createElement('span');
    s.textContent = t;
    axis.appendChild(s);
  });

  el('chartLabel').textContent = title;
  el('chartHint').textContent = hint;
}

function renderTable(entries) {
  const tbody = el('tbody');
  tbody.textContent = '';
  el('tableEmpty').hidden = entries.length > 0;
  el('table').hidden = entries.length === 0;

  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const todayTotals = totalsByHost({ x: days[dayKey()] || {} });

  for (const [host, sec] of entries) {
    const limit = limits[host];
    // The limit is a daily thing, so only flag it while looking at today.
    const over =
      limit && anchor === dayKey() && range === 1 && (todayTotals[host] || 0) >= limit;

    const tr = document.createElement('tr');
    tr.className = (over ? 'over ' : '') + (selectedHost === host ? 'picked' : '');

    const mark = document.createElement('td');
    mark.className = 'mark';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorFor(host);
    mark.appendChild(dot);

    const name = document.createElement('td');
    name.className = 'host';
    const btn = document.createElement('button');
    btn.className = 'linkish';
    btn.textContent = host;
    btn.title = `Chart ${host} on its own`;
    btn.addEventListener('click', () => {
      selectedHost = selectedHost === host ? null : host;
      load();
    });
    name.appendChild(btn);

    const time = document.createElement('td');
    time.className = 'r time';
    time.textContent = dur(sec);

    const share = document.createElement('td');
    share.className = 'r';
    share.textContent = `${((sec / total) * 100).toFixed(1)}%`;

    tr.append(mark, name, time, share, limitCell(host, limit, tr));
    tbody.appendChild(tr);
  }
}

/** Two boxes, hours and minutes, so the unit is never in doubt. */
function limitCell(host, limit, row) {
  const td = document.createElement('td');
  td.className = 'r';
  const wrap = document.createElement('div');
  wrap.className = 'hm';

  const { h, m } = limit ? splitHm(limit) : { h: 0, m: 0 };

  const make = (value, max, unit, aria) => {
    const box = document.createElement('span');
    box.className = 'hm-box';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(max);
    input.placeholder = '–'; // empty reads as "no limit", not "limit of zero"
    input.value = limit ? String(value) : '';
    input.setAttribute('aria-label', `${aria} for ${host}`);
    const tag = document.createElement('span');
    tag.className = 'unit';
    tag.textContent = unit;
    box.append(input, tag);
    return { box, input };
  };

  const hh = make(h, 23, 'h', 'Limit hours');
  const mm = make(m, 59, 'm', 'Limit minutes');

  const apply = async () => {
    const hv = Math.min(23, Math.max(0, Number(hh.input.value) || 0));
    const mv = Math.min(59, Math.max(0, Number(mm.input.value) || 0));
    const seconds = hv * 3600 + mv * 60;

    if (hh.input.value !== '') hh.input.value = String(hv);
    if (mm.input.value !== '') mm.input.value = String(mv);

    const all = await getLimits();
    if (seconds <= 0) delete all[host];
    else all[host] = seconds;
    await setLimits(all);
    limits = all;

    // Repaint just this row so the boxes keep focus while typing.
    const todayTotals = totalsByHost({ x: days[dayKey()] || {} });
    const over =
      seconds > 0 &&
      anchor === dayKey() &&
      range === 1 &&
      (todayTotals[host] || 0) >= seconds;
    row.classList.toggle('over', Boolean(over));
    if (selectedHost === host) renderKpis(sortedEntries(totalsByHost(days)), totalsByHost(days));
    chrome.runtime.sendMessage({ type: 'settings-changed' }).catch(() => {});
  };

  hh.input.addEventListener('change', apply);
  mm.input.addEventListener('change', apply);

  wrap.append(hh.box, mm.box);
  td.appendChild(wrap);
  return td;
}

/* ---------- settings ---------- */

const FIELDS = [
  {
    key: 'paused',
    type: 'check',
    label: 'Pause counting',
    sub: 'Nothing is recorded while this is on',
  },
  {
    key: 'notifyLimits',
    type: 'check',
    label: 'Notify me about limits',
    sub: 'A notification the moment a daily limit runs out',
  },
  {
    key: 'limitAction',
    type: 'select',
    label: 'When a limit runs out',
    sub: 'Dimming needs one extra permission, which Chrome will ask you for',
    options: [
      ['notify', 'Notify only'],
      ['block', 'Notify and dim the page'],
    ],
  },
  {
    key: 'limitRepeatMinutes',
    type: 'num',
    label: 'Repeat while over, minutes',
    sub: 'Nudge again if you stay on the site. 0 means tell me once',
    min: 0,
    max: 240,
  },
  {
    key: 'reminderMinutes',
    type: 'num',
    label: 'Time-check nudge, minutes',
    sub: 'Tells you how long you have sat on one site without a break. 0 is off',
    min: 0,
    max: 600,
  },
  {
    key: 'idleSeconds',
    type: 'num',
    label: 'Idle threshold, seconds',
    sub: 'Counting stops after this long with no mouse or keyboard',
    min: 15,
    max: 900,
  },
  {
    key: 'countAudible',
    type: 'check',
    label: 'Count video and music',
    sub: 'A tab playing sound is never treated as idle',
  },
  {
    key: 'skipIncognito',
    type: 'check',
    label: 'Skip incognito',
    sub: 'Incognito tabs stay out of the stats',
  },
  {
    key: 'keepDays',
    type: 'num',
    label: 'Keep history, days',
    sub: 'Older records are deleted automatically',
    min: 7,
    max: 365,
  },
];

async function renderSettings() {
  const s = await getSettings();
  const box = el('settings');
  box.textContent = '';

  for (const f of FIELDS) {
    const row = document.createElement('div');
    row.className = 'set';

    const label = document.createElement('label');
    label.textContent = f.label;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = f.sub;
    label.appendChild(sub);

    const id = `set-${f.key}`;
    label.htmlFor = id;
    let field;

    if (f.type === 'check') {
      field = document.createElement('input');
      field.type = 'checkbox';
      field.checked = Boolean(s[f.key]);
      field.addEventListener('change', () => save(f.key, field.checked));
    } else if (f.type === 'select') {
      field = document.createElement('select');
      for (const [value, text] of f.options) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        field.appendChild(o);
      }
      field.value = s[f.key];
      field.addEventListener('change', () => onLimitAction(field));
    } else {
      field = document.createElement('input');
      field.type = 'number';
      field.min = f.min;
      field.max = f.max;
      field.value = s[f.key] ?? DEFAULTS[f.key];
      field.addEventListener('change', () => {
        let v = Number(field.value);
        if (Number.isNaN(v)) v = DEFAULTS[f.key];
        v = Math.min(f.max, Math.max(f.min, v));
        field.value = v;
        save(f.key, v);
      });
    }

    field.id = id;
    row.append(label, field);
    box.appendChild(row);
  }
}

/** Dimming needs scripting access, so ask for it only when it is switched on. */
async function onLimitAction(select) {
  if (select.value !== 'block') {
    await save('limitAction', 'notify');
    showHint('');
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({
      permissions: ['scripting'],
      origins: ['<all_urls>'],
    });
  } catch {
    granted = false;
  }
  if (!granted) {
    select.value = 'notify';
    await save('limitAction', 'notify');
    showHint('Chrome did not grant page access, so limits will only notify you.');
    return;
  }
  await save('limitAction', 'block');
  showHint(
    'Dimming is on. The overlay appears over the site itself, so pages like the Chrome Web Store and chrome:// tabs stay untouched.'
  );
}

function showHint(text) {
  const hint = el('hint');
  hint.textContent = text;
  hint.hidden = !text;
}

async function save(key, value) {
  await setSettings({ [key]: value });
  try {
    await chrome.runtime.sendMessage({ type: 'settings-changed' });
  } catch {
    /* worker was asleep */
  }
}

/* ---------- export ---------- */

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileStamp() {
  return range === 1 ? anchor : `${keys()[0]}_${anchor}`;
}

el('csv').addEventListener('click', async () => {
  const all = await readRange(keys());
  const rows = ['date,hour,site,seconds,minutes'];
  for (const [key, day] of Object.entries(all)) {
    for (const [host, rec] of Object.entries(day)) {
      rows.push(`${key},,${host},${rec.t},${(rec.t / 60).toFixed(1)}`);
      for (const [h, sec] of Object.entries(rec.h || {})) {
        rows.push(`${key},${String(h).padStart(2, '0')},${host},${sec},${(sec / 60).toFixed(1)}`);
      }
    }
  }
  download(`chrono-${fileStamp()}.csv`, rows.join('\n'), 'text/csv');
});

el('json').addEventListener('click', async () => {
  const all = await readRange(keys());
  download(
    `chrono-${fileStamp()}.json`,
    JSON.stringify({ exported: new Date().toISOString(), days: all }, null, 2),
    'application/json'
  );
});

let wipeArmed = false;
el('wipe').addEventListener('click', async () => {
  if (!wipeArmed) {
    wipeArmed = true;
    el('wipeNote').hidden = false;
    el('wipe').textContent = 'Erase everything';
    setTimeout(() => {
      wipeArmed = false;
      el('wipeNote').hidden = true;
      el('wipe').textContent = 'Erase history';
    }, 6000);
    return;
  }
  await chrome.runtime.sendMessage({ type: 'wipe' }).catch(() => {});
  wipeArmed = false;
  el('wipeNote').hidden = true;
  el('wipe').textContent = 'Erase history';
  selectedHost = null;
  await load();
});

/* ---------- wiring ---------- */

el('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  range = Number(btn.dataset.range);
  [...el('tabs').children].forEach((b) => b.classList.toggle('on', b === btn));
  load();
});

el('prev').addEventListener('click', () => move(-1));
el('next').addEventListener('click', () => move(1));
el('today').addEventListener('click', () => {
  anchor = dayKey();
  load();
});
el('picker').addEventListener('change', (e) => {
  if (!e.target.value) return;
  anchor = e.target.value > dayKey() ? dayKey() : e.target.value;
  load();
});
el('filterClear').addEventListener('click', () => {
  selectedHost = null;
  load();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') move(-1);
  if (e.key === 'ArrowRight' && anchor !== dayKey()) move(1);
});

renderSettings();
load();

// Refresh live numbers, but never while someone is typing into a field.
setInterval(() => {
  if (document.activeElement?.matches('input, select')) return;
  if (anchor === dayKey()) load();
}, 30000);
