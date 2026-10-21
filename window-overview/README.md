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

## Tab Triage (the game)
Click **🎮 Triage** on the board. It shows stale tabs one at a time and every choice acts on your real tabs:
- **Keep** (`K`): resets the tab's idle timer, so it stops counting as stale.
- **Snooze** (`S`): closes the tab and reopens it in the background after 1, 3 or 7 days (default 7). Snoozed tabs survive browser restarts; overdue ones reopen on the next startup. Manage them under "snoozed tabs waiting".
- **Close** (`C`): closes it. `Z` undoes the last decision (reopens a closed tab, cancels a snooze, reverts a keep). `Space` skips, `Open tab ↗` jumps to it.
- Pick how stale a tab must be to appear (1 hour to 7 days). Pinned tabs and tabs playing audio are never included.

Scoring: **tab debt** grows with idle time (12 per idle day, capped at 400 per tab; 0 if used in the last hour) and is shown on the board and in Triage. Each decision pays down that tab's debt and earns points (close 10, snooze 8, keep 3) with a combo multiplier for decisions made within 6s of each other. Points set your level. A day counts toward your **streak** if you review 5+ tabs or clear the queue. Badges: Spring Cleaner (5+ closed in a session), Speed Reader (10+ reviewed in under 60s), Fresh Start (nothing idle over 7 days), Zero Debt (debt reaches 0).

## How "open" time works
Chrome does not record tab creation time, so the background worker timestamps tabs as they open (stored in `chrome.storage.local`). Tabs already open at install, or after a browser restart, show a lower bound like `open ≥3h`. "used … ago" comes from Chrome's own `lastAccessed` and is always accurate.

## Install
1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select this `window-overview/` folder.
3. Click the toolbar icon.

Permissions: `tabs` (titles/URLs), `storage` (open times, game progress, snoozed tabs) and `alarms` (wake snoozed tabs). Nothing leaves your browser.
