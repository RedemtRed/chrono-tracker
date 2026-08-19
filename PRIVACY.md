# Privacy Policy — Chrono

_Last updated: 19 August 2026_

## In short

Chrono does not send anything anywhere. Everything it measures stays in your
browser.

## What is processed

To measure time, the extension reads the **domain of the active tab** (for example
`github.com`) and how long you stayed on it. Only this is stored:

- the domain;
- seconds per day and per hour;
- your settings and daily limits.

**Not stored**: full page URLs, page titles, page content, form input, cookies,
passwords, or search queries. Incognito tabs are excluded by default.

## Where it is kept

In your browser's local storage (`chrome.storage.local`), on your device. The
extension has no server and makes no network requests. Records older than the
retention period you choose (90 days by default) are deleted automatically.

## Who it is shared with

Nobody. Data is not sold, not shared with third parties, and not used for
advertising, analytics, profiling, or anything beyond showing you your own stats.

## Your control

- **Erase history** on the stats page deletes every record.
- **Download CSV / JSON** gives you your own copy.
- Removing the extension removes its storage with it.

## Permissions

Granted at install:

- `tabs` — read the active tab's domain.
- `storage` — keep stats and settings locally.
- `alarms` — periodically write down accumulated seconds.
- `idle` — stop counting when you step away from the computer.
- `notifications` — tell you when a daily limit runs out.

Optional, requested only if you turn the feature on:

- `scripting` and host access — used solely to draw a dimming panel over a site
  whose daily limit has run out. Page content is never read, collected, or
  transmitted. The feature is off by default, and declining it leaves limits
  working as notifications.

## Changes and contact

Any change to this policy will appear on this page with a new date.

Questions, bug reports and privacy requests:
https://github.com/YOUR_USERNAME/chrono-tracker/issues
