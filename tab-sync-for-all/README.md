# Tab Sync for All (Chrome Extension)

A side-panel tab manager: see and control **every tab in every open
window** — grouped or not — from one place, give any tab a custom title,
**pin** any tab or whole group so it survives closing/reopening the browser
and follows you to other devices signed into the same Chrome profile,
**force-pin** the ones you don't want closed by accident, and **cap how many
windows** you're allowed to have open at once. Manifest V3, no build step,
no external dependencies.

## Features

- **Unified manager panel** (Chrome's side panel, not a popup — stays open
  while you work): lists every tab in every open window, grouped by window.
  Tabs that belong to a Chrome tab group are shown in their group's card;
  everything else shows up under an "Ungrouped tabs" card per window, so
  nothing is left out of view. Refreshed live as tabs/groups change.
- Per group: rename, recolor, collapse/expand, jump to it (focuses its
  window and the first tab), or close all its tabs — all from the panel.
- **Move any tab into a group, across windows** — every tab row (grouped or
  not) has a "Move…" dropdown listing every open group anywhere, plus a
  "+ New group" option to pop it into a fresh group on the spot.
- **Custom tab titles**: click any tab's title in the panel to override
  what's shown in the tab strip and tab-group manager. Sticks across page
  reloads and even survives sites that rewrite `document.title` themselves
  (e.g. SPAs) via a `MutationObserver` that keeps reapplying it. Clear the
  override to fall back to the page's real title.
- **Pin (★) a whole group or any individual tab** — grouped or ungrouped —
  to keep it around:
  - Its contents are kept live-synced to storage as you work, even while
    the panel is closed (a group's tab list can grow/shrink; a solo tab's
    URL/title track its live tab).
  - Close the whole browser and reopen it — pinned items are automatically
    restored so you can pick your work back up. For groups, if Chrome's own
    "continue where you left off" already restored the same group (matched
    by title + color), the extension adopts it instead of opening a
    duplicate; for solo tabs, it matches by URL.
  - Close just that tab/group mid-session (not the whole browser) and it's
    listed under "Pinned, not open" with a one-click **Restore**.
  - Unpinning (★ again) stops tracking/syncing it but leaves it open.
- **Force-pin (🔒)** — one step further than pinning, only available once
  something is already pinned: if a force-pinned tab or group gets closed
  *during your session* (not just at browser restart), it's reopened
  automatically within about half a second, and a `chrome.notifications`
  alert explains why. A content script also adds a native "leave site?"
  confirmation before a force-pinned tab closes, as an extra deliberate
  step. **This is a strong deterrent, not an absolute block** — see
  [Known limitations](#known-limitations) for exactly what it can't do.
  Unlock (🔒 again) to allow normal closing; unpin (★) to stop tracking it
  entirely.
- **Synced across devices** via `chrome.storage.sync` — pinned items and
  custom titles follow you automatically to any device signed into the same
  Chrome profile, no extra sign-in step.
- **Window limit** — cap how many normal Chrome windows can be open at once
  (default **2**, configurable in the panel's "Window limit" section, and
  itself synced via `chrome.storage.sync`). Open one over the limit and its
  tabs are folded into an existing window (nothing is discarded) and a
  `chrome.notifications` alert explains what happened.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or another Chromium browser).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `tab-sync-for-all` folder.
4. Pin the extension, then click its toolbar icon — it opens the side
   panel (not a popup), which you can leave open alongside your tabs.

No `npm install`, no bundler — plain HTML/CSS/JS loaded directly by Chrome.

## Project structure

```
tab-sync-for-all/
├── manifest.json             # MV3 config: permissions, side panel, content scripts
├── background.js             # Service worker: startup restore, live-syncs/heals pinned items, enforces window limit
├── lib/
│   ├── storage.js            # sync/local/session storage layer for pinned items/titles (with quota fallback)
│   ├── tabgroups.js          # shared helpers: snapshot/restore a pinned item, live-sync vs. force-pin healing
│   └── windowLimit.js        # window-count cap: settings + enforcement, shared by background & panel
├── content/
│   ├── title-override.js     # applies a custom title on matching pages, re-applies on SPA changes
│   └── force-pin-guard.js    # adds a "leave site?" confirmation on force-pinned pages
├── sidepanel/
│   ├── sidepanel.html/.css/.js  # the unified manager UI (tabs, groups, pinning, window limit)
└── icons/                    # toolbar/extension icons (16/48/128 px)
```

## How it works

### Reading tabs across windows

The panel calls `chrome.windows.getAll({populate: true})` and
`chrome.tabGroups.query({})` and joins them by `windowId`/`groupId` — there's
no native "everything, everywhere" concept in Chrome's UI, but the API
already exposes everything needed to build one.

### Storage layout (`lib/storage.js`)

- **Pinned items** are stored one-per-key (`pin:<uuid>`) rather than as one
  big object, so each item's JSON stays under `chrome.storage.sync`'s
  8KB-per-item limit independently of how many things you pin. Each record
  has a `kind` (`"group"` or `"tab"`), its tab list (one entry for a solo
  tab), and a `forced` flag. A write that still doesn't fit (a group with a
  *lot* of tabs) falls back to `chrome.storage.local` automatically — that
  item just won't follow you to other devices, and the panel labels it
  "local only".
- **Custom titles** are one `url -> title` map under a single sync key, with
  the same local fallback if it ever grows past quota.
- **Live map** (`pinnedId -> {kind, id}`, where `id` is the currently-open
  chrome tabGroup or tab id) lives in `chrome.storage.session`, shared
  between the background worker and the panel, and is cleared automatically
  when the browser closes — exactly the lifetime needed to tell "pinned and
  open" apart from "pinned and closed" after a restart.

### Keeping pinned items live, or healing them (`background.js` + `lib/tabgroups.js`)

The service worker listens to `chrome.tabGroups.onUpdated` and a broad set
of `chrome.tabs.*` events (created/updated/removed/moved/attached/detached),
debounced by 400ms, and for every pinned-and-currently-open item calls
`tabgroups.syncLiveItem`, which branches on the item's `forced` flag:

- **Not forced** — the normal live-sync behavior from before: re-snapshot
  the stored definition from whatever the group/tab currently looks like
  (so closing a tab in a pinned group is a deliberate, honored edit).
- **Forced** — the opposite: never shrink the stored definition. Instead,
  compare it against what's actually still open and reopen whatever's
  missing (a single closed tab gets recreated and re-added to its group; if
  the *whole* group or the solo tab is gone, it's fully restored from the
  last-known snapshot), then fires a notification. `chrome.tabGroups.onRemoved`
  is special-cased to *not* clear the live mapping for a forced group, so
  this healing pass has something to reattach to.

### Restoring on browser startup

`chrome.runtime.onStartup` (fires only on an actual browser cold start, not
on extension reload) reads every pinned item and, for each one, first
checks whether a live counterpart already exists — a group matched by
title+color, a solo tab matched by URL — (covering the case where Chrome's
own session restore beat the extension to it); otherwise it reopens it.

### Custom titles (`content/title-override.js`)

A content script on every page reads the `customTitles` map directly from
`chrome.storage` (content scripts have direct API access, no message-passing
needed), sets `document.title` if there's an override for the exact current
URL, and watches the `<title>` element with a `MutationObserver` to
reapply it if the page's own script changes it back. It also listens for
`chrome.storage.onChanged` so editing a title from the panel updates an
already-open tab immediately.

### Force-pin confirmation (`content/force-pin-guard.js`)

`background.js` maintains a flat list of every URL currently belonging to a
`forced` pinned item in `chrome.storage.local` (key `forcedUrls`), recomputed
whenever a pinned item changes. A second content script checks whether its
own page's URL is on that list and, if so, attaches a `beforeunload` handler
that triggers Chrome's native "leave site?" dialog on any attempt to close
or navigate away from that tab — one extra deliberate click before it goes,
on top of the auto-reopen healing described above.

### Window limit (`lib/windowLimit.js`)

`chrome.windows.onCreated` fires for every new normal browser window.
`background.js` hands it to `windowLimit.enforceOnNewWindow`, which counts
current normal (non-incognito) windows; if that exceeds the configured
limit, it moves the new window's tabs into an existing window
(`chrome.tabs.move`, rather than just closing the window outright, so
dragging a tab into its own window doesn't lose that tab), closes the
now-empty extra window, and fires a `chrome.notifications` alert. The limit
itself is one small number in `chrome.storage.sync`, read fresh on every new
window and editable from the panel's "Window limit" section.

## Permissions

- `tabGroups`, `tabs`, `windows`, `storage`, `sidePanel`, `notifications` —
  read/modify groups, tabs and windows; persist state; alert on a blocked
  window or a healed force-pin.
- Content scripts matching `<all_urls>` — needed only to apply custom tab
  titles and the force-pin confirmation dialog; neither reads page content
  otherwise.

No network requests are made — sync happens entirely through Chrome's own
account sync infrastructure (`chrome.storage.sync`), not a custom backend.

## Known limitations

- `chrome.storage.sync` quotas (~8KB/item, ~100KB total, ~1800 writes/hour)
  mean a very large pinned group, or a large number of pinned items, may
  spill into local-only storage (flagged in the panel) instead of syncing.
- Cross-device sync relies on Chrome's own account sync being enabled
  (`chrome://settings/syncSetup`); it does not work across different browser
  vendors (e.g. Chrome ↔ Edge) since each has its own sync backend.
- Restored/reopened tabs come back fresh (by URL), not restored from their
  exact prior in-page state (scroll position, form input, JS state, etc.).
- The window limit is enforced **going forward only**: lowering it while
  more windows than the new limit are already open doesn't retroactively
  close anything — it only blocks the *next* window you open. Incognito
  windows aren't counted or blocked.
- If your window limit is set very low (e.g. 1) and a pinned group needs a
  brand-new window to restore into at browser startup, that restore can
  itself trip the limit.
- **Force-pin cannot truly prevent a tab from closing** — no Chrome
  extension API allows vetoing a tab/window close. What it actually does:
  - The auto-reopen always works, but it is a real close followed by a
    fresh reopen — there's a brief flicker, the tab gets a new tab id, and
    any unsaved in-page state (scroll position, form input, a draft) is
    lost, exactly as if you'd closed and revisited the URL yourself.
  - The confirmation dialog is a real interception, but Chrome requires the
    page to have received at least one user interaction (click, keypress)
    since it loaded for the `beforeunload` dialog to appear at all — a
    force-pinned tab you haven't touched yet may close silently on the
    first attempt (the auto-reopen still catches it afterward).
  - Neither mechanism can do anything about closing the entire browser
    process (e.g. quitting the app, not just its windows) — reopening only
    happens on the *next* browser startup in that case, same as a normal
    (non-forced) pin.
  - Reopening a force-pinned *group* member reattaches it to the same
    Chrome tab group only if that group still exists; if the whole group
    was closed at once, the entire group is recreated fresh from its
    last-known tab list.
