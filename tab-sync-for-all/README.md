# Tab Sync for All (Chrome Extension)

A side-panel tab manager: see and control every tab group across **all your
open windows** from one place, give any tab a custom title, **pin** groups
so they survive closing/reopening the browser and follow you to other
devices signed into the same Chrome profile, and **cap how many windows**
you're allowed to have open at once. Manifest V3, no build step, no
external dependencies.

## Features

- **Unified manager panel** (Chrome's side panel, not a popup — stays open
  while you work): lists every tab group in every open window, grouped by
  window, refreshed live as groups/tabs change.
- Per group: rename, recolor, collapse/expand, jump to it (focuses its
  window and the first tab), or close all its tabs — all from the panel.
- **Move tabs between groups across windows** — each tab row has a "Move…"
  dropdown listing every other open group, even ones in a different window.
- **Custom tab titles**: click any tab's title in the panel to override
  what's shown in the tab strip and tab-group manager. Sticks across page
  reloads and even survives sites that rewrite `document.title` themselves
  (e.g. SPAs) via a `MutationObserver` that keeps reapplying it. Clear the
  override to fall back to the page's real title.
- **Pin a group (★)** to keep it around:
  - Its contents (tabs, title, color, collapsed state) are kept live-synced
    to storage as you work, even while the panel is closed.
  - Close the whole browser and reopen it — pinned groups are automatically
    restored so you can pick your work back up. If Chrome's own "continue
    where you left off" already restored the same group (matched by title +
    color), the extension adopts it instead of opening a duplicate.
  - Close just that group mid-session (not the whole browser) and it's
    listed under "Pinned, not open" with a one-click **Restore**.
  - Unpinning stops tracking/syncing a group but leaves its tabs open.
- **Synced across devices** via `chrome.storage.sync` — pinned groups and
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
├── manifest.json             # MV3 config: permissions, side panel, content script
├── background.js             # Service worker: startup restore, live-syncs pinned groups, enforces window limit
├── lib/
│   ├── storage.js            # sync/local/session storage layer for groups/titles (with quota fallback)
│   ├── tabgroups.js          # shared helpers: snapshot/restore/refresh a live tab group
│   └── windowLimit.js        # window-count cap: settings + enforcement, shared by background & panel
├── content/
│   └── title-override.js     # applies a custom title on matching pages, re-applies on SPA changes
├── sidepanel/
│   ├── sidepanel.html/.css/.js  # the unified manager UI (groups, pinning, window limit)
└── icons/                    # toolbar/extension icons (16/48/128 px)
```

## How it works

### Reading groups across windows

The panel calls `chrome.windows.getAll({populate: true})` and
`chrome.tabGroups.query({})` and joins them by `windowId`/`groupId` — there's
no native "all groups everywhere" concept in Chrome's UI, but the API
already exposes everything needed to build one.

### Storage layout (`lib/storage.js`)

- **Pinned groups** are stored one-per-key (`pin:<uuid>`) rather than as one
  big object, so each group's JSON (title, color, collapsed, ordered tab
  URLs/titles) stays under `chrome.storage.sync`'s
  8KB-per-item limit independently of how many groups you pin. A write that
  still doesn't fit (a group with a *lot* of tabs) falls back to
  `chrome.storage.local` automatically — that group just won't follow you to
  other devices, and the panel labels it "local only".
- **Custom titles** are one `url -> title` map under a single sync key, with
  the same local fallback if it ever grows past quota.
- **Live map** (`pinnedId -> currently-open chrome tabGroup id`) lives in
  `chrome.storage.session`, shared between the background worker and the
  panel, and is cleared automatically when the browser closes — exactly the
  lifetime needed to tell "pinned and open" apart from "pinned and closed"
  after a restart.

### Keeping pinned groups live (`background.js` + `lib/tabgroups.js`)

The service worker listens to `chrome.tabGroups.onUpdated` and a broad set
of `chrome.tabs.*` events (created/updated/removed/moved/attached/detached),
debounced by 400ms, and re-snapshots every pinned-and-currently-open group
from its live state into storage. This runs whether or not the side panel is
open, so a pinned group's stored definition always reflects your latest
tab list — pinning isn't a one-time snapshot.

### Restoring on browser startup

`chrome.runtime.onStartup` (fires only on an actual browser cold start, not
on extension reload) reads every pinned group and, for each one, first
checks whether a live group with the same title+color already exists
(covers the case where Chrome's session restore beat the extension to it);
otherwise it reopens the group's tabs in the background and re-groups them.

### Custom titles (`content/title-override.js`)

A content script on every page reads the `customTitles` map directly from
`chrome.storage` (content scripts have direct API access, no message-passing
needed), sets `document.title` if there's an override for the exact current
URL, and watches the `<title>` element with a `MutationObserver` to
reapply it if the page's own script changes it back. It also listens for
`chrome.storage.onChanged` so editing a title from the panel updates an
already-open tab immediately.

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
  window.
- A content script matching `<all_urls>` — needed only to apply your custom
  tab titles; it does not read page content otherwise.

No network requests are made — sync happens entirely through Chrome's own
account sync infrastructure (`chrome.storage.sync`), not a custom backend.

## Known limitations

- `chrome.storage.sync` quotas (~8KB/group, ~100KB total, ~1800 writes/hour)
  mean a very large pinned group, or a large number of pinned groups, may
  spill into local-only storage (flagged in the panel) instead of syncing.
- Cross-device sync relies on Chrome's own account sync being enabled
  (`chrome://settings/syncSetup`); it does not work across different browser
  vendors (e.g. Chrome ↔ Edge) since each has its own sync backend.
- Restored tabs are reopened fresh (by URL), not restored from their exact
  prior in-page state (scroll position, form input, etc.).
- The window limit is enforced **going forward only**: lowering it while
  more windows than the new limit are already open doesn't retroactively
  close anything — it only blocks the *next* window you open. Incognito
  windows aren't counted or blocked.
- If your window limit is set very low (e.g. 1) and a pinned group needs a
  brand-new window to restore into at browser startup, that restore can
  itself trip the limit.
