# Window Limit Guard (Chrome Extension)

Caps how many Chrome windows you can have open at once on your profile.
Open one more than the limit and the extension folds its tabs back into an
existing window (no tabs are lost) and shows a notification explaining why.
Manifest V3, no build step, no external dependencies.

## Features

- **Configurable limit** (default **2**) — set from the toolbar popup, saved
  via `chrome.storage.sync` so it follows your Chrome profile to other
  devices too.
- **Blocks the (N+1)th window**: as soon as it's created, its tabs are moved
  into your most recently existing window and the now-empty extra window is
  closed — your tabs aren't discarded, just merged back.
- **Notification popup** (`chrome.notifications`) explains what happened and
  what the current limit is, every time this triggers.
- Incognito windows are ignored/not counted, since the extension typically
  can't see them unless you explicitly enable "Allow in Incognito".

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `window-limit-guard` folder.
4. Click the toolbar icon any time to check/change the limit.

## Project structure

```
window-limit-guard/
├── manifest.json      # MV3 config: windows/tabs/storage/notifications permissions
├── background.js      # Listens for new windows and enforces the limit
├── lib/
│   └── settings.js    # Reads/writes the configured limit (chrome.storage.sync)
├── popup/
│   ├── popup.html/.css/.js   # Toolbar popup: view/change the limit, see current count
└── icons/              # Toolbar/extension icons (16/48/128 px)
```

## How it works

`chrome.windows.onCreated` fires for every new normal browser window. The
handler counts current normal (non-incognito) windows via
`chrome.windows.getAll({windowTypes: ["normal"]})`; if that count exceeds the
configured limit, it:

1. Queries the new window's tabs (`chrome.tabs.query({windowId})`).
2. Moves them into an existing window (`chrome.tabs.move(tabIds, {windowId:
   target, index: -1})`) rather than just closing the window outright — so
   dragging a tab out into its own window, or opening a link with
   "Open in new window", doesn't lose that tab's content.
3. Closes the now-empty extra window (usually redundant, since Chrome closes
   a window automatically once its last tab is moved out, but done
   defensively in case it doesn't).
4. Fires a `chrome.notifications` alert naming the configured limit.

The limit itself lives in `lib/settings.js`, backed by `chrome.storage.sync`
(a single small number, nowhere near sync's quotas) and read fresh on every
new-window event, so changing it in the popup takes effect immediately for
the next window you open.

## Permissions

`windows`, `tabs`, `storage`, `notifications` — no host permissions, no
network requests.

## Known limitations / behavior notes

- The limit is enforced **going forward only**: lowering it while more
  windows than the new limit are already open does not retroactively close
  anything — it only blocks the *next* window you open.
- Incognito windows aren't counted or blocked by default (and are usually
  invisible to the extension unless you turn on "Allow in Incognito" for it
  in `chrome://extensions`).
- If you use this alongside the `tab-group-sync` extension: restoring a
  pinned group into a brand-new window (when no window exists yet) can
  itself trigger this cap. In practice this only matters if your limit is
  set very low (e.g. 1) and you have pinned groups that need a fresh window
  to restore into.
