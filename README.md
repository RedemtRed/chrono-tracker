# Chrono — website time tracker

A Chrome extension that counts how long you spend on each website, breaks it
down hour by hour, and keeps the history so you can look back at any past day.

Everything stays on your machine. No account, no server, no analytics.

<!-- Once the extension is live, put the store badge / link here:
[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/YOUR_ID)
-->

## What it does

- **Day strip** — the popup shows 24 columns, one per hour, so the shape of
  your day is visible at a glance.
- **History** — pick any past date and see it broken down by hour and by site.
- **Single-site view** — click a site and the chart rebuilds around just it.
- **Daily limits** — set a limit in hours and minutes; get a notification when
  it runs out, and optionally have the page dimmed until you decide to move on.
- **Time-check nudges** — an optional reminder telling you how long you have
  sat on one site without a break.
- **Export** — CSV and JSON, including the hourly breakdown.

## Counting rules

Most trackers count any tab that happens to be open. This one does not:

- The Chrome window has to be in focus. Switch to another app and the clock stops.
- After a minute with no mouse or keyboard the clock stops, and that idle minute
  is rolled back rather than credited to the site.
- A tab playing audio is never treated as idle, so films and music are not
  silently dropped.
- If the machine sleeps, the gap is capped at five minutes instead of turning an
  overnight sleep into eight hours on a news site.

## What limits actually do

A limit applies to one domain for one calendar day. When it runs out:

1. A notification fires, repeated every N minutes while you stay on the site
   (configurable; set 0 to be told once).
2. The toolbar badge turns red and the site is flagged in the popup.
3. If page dimming is enabled, a panel appears over the site with a **Snooze**
   button and a **Close tab** button.

Nothing is blocked silently and no tab is ever closed for you. Dimming needs
access to page content, so it is an **optional permission**: Chrome asks for it
only when you switch the feature on, and declining leaves limits working as
notifications.

## Privacy

Only the site's domain and the seconds spent there are stored — never page URLs,
titles, page content, form input, cookies or search queries. Incognito tabs are
skipped by default. Records older than your retention setting (90 days by
default) are deleted automatically. See [PRIVACY.md](PRIVACY.md).

## Install from source

```
git clone https://github.com/YOUR_USERNAME/chrono-tracker.git
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick the folder containing `manifest.json`

## Project layout

| Path | Purpose |
|---|---|
| `manifest.json` | Permissions and entry points (Manifest V3) |
| `src/background.js` | Service worker: counting, idle handling, limits |
| `src/common.js` | Storage, dates, formatting, palette |
| `src/popup.*` | Toolbar popup — day strip and top sites |
| `src/dashboard.*` | Stats page — history, limits, settings, export |
| `icons/` | 16 / 32 / 48 / 128 px icons |

Data is kept in `chrome.storage.local`, one key per day:

```
d:2026-08-19 → { "github.com": { t: 8420, h: { 9: 1400, 10: 2100 } } }
```

`t` is seconds for the day, `h` is the per-hour breakdown that drives both the
day strip and the hourly chart.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read the active tab's domain so time lands on the right site |
| `storage` | Keep totals, limits and settings locally |
| `alarms` | Write pending seconds once a minute before the worker suspends |
| `idle` | Stop counting when you step away |
| `notifications` | Tell you when a daily limit runs out |
| `scripting`, host access | **Optional, off by default.** Only to draw the dimming panel |

## License

MIT — see [LICENSE](LICENSE).
