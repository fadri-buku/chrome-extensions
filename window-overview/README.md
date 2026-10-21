# Window Overview

One page that shows every open Chrome window and the tabs inside it, built for cleaning up.

## Views
- **By freshness** (default): columns Now / Today / This week / Forgotten, by how long since you last used each tab.
- **By site**: tabs grouped by domain, biggest piles first.

Every tile shows favicon, title, domain, `open …` (how long the tab has existed) and `used … ago`, plus a colored `W#` badge for its window.

## Interactions
- Click a tile to jump to the tab. Hover for **Pin**, **Mute** (when audible/muted) and **✕**.
- **Select**: Ctrl/Cmd-click or the checkbox; Shift-click for a range; group checkbox selects a whole group. Once anything is selected, plain clicks toggle selection.
- **Selection bar**: close selected, or move them to any window / a new window.
- **Drag** one tile (or the whole selection) onto a window chip at the top to move it, or onto "New window".
- Window chips filter the board; click to toggle.
- **Close all** per group; **Close N duplicates** keeps the most recently used copy of each URL.
- **Undo** toast after every close (reopens the tabs; their order/history is not restored).
- Search by title or URL. Keyboard: `/` search, `Esc` clear, `Delete` close selected, `Ctrl/Cmd+A` select shown, `Ctrl/Cmd+Z` undo.
- Updates live as tabs and windows change; durations tick every 30s.

## How "open" time works
Chrome does not record tab creation time, so the background worker timestamps tabs as they open (stored in `chrome.storage.local`). Tabs already open at install, or after a browser restart, show a lower bound like `open ≥3h`. "used … ago" comes from Chrome's own `lastAccessed` and is always accurate.

## Install
1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select this `window-overview/` folder.
3. Click the toolbar icon.

Permissions: `tabs` (titles/URLs) and `storage` (open times). Nothing leaves your browser.
