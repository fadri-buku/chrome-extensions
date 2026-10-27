# Window Overview

One page that shows every open Chrome window and the tabs inside it, built for cleaning up.

## Views
- **By freshness** (default): columns Now / Today / This week / Forgotten, by how long since you last used each tab.
- **By site**: tabs grouped by domain, biggest piles first.

Every tile shows favicon, title, domain, `open …` (how long the tab has existed) and `used … ago`, plus a colored `W#` badge for its window.

## Thumbnails
Toggle **🖼 Thumbnails** in the header to show a page preview on every tile. Chrome only allows screenshots of the visible tab, so previews are captured in the background when you switch to a tab or it finishes loading while active; tabs you haven't visited since install show "no preview yet". Pick a size: **Small** (6 per row), **Medium** (4 per row) or **3×3** (default: 3 across and 3 down, so nine large thumbnails fill the screen; scroll for more). Previews are small JPEGs kept in local storage and removed when the tab closes.

## Saved sessions
**💾 Sessions** saves selected tabs, one window, or everything as a named set (keeps window grouping and pins), optionally closing them after. Restore reopens each saved window as a new window. **Save & close** in the selection bar is the one-click version. Only http(s)/file tabs are saved.

## Live previews
**🔴 Live** (thumbnail mode) refreshes previews about twice a second, in place without redrawing the board. Chrome can only screenshot the visible tab of each window and limits it to ~2 shots/second, so the *active tab of every window* is live (marked **● LIVE**, cycling round-robin: with N windows each updates every ~N/2 seconds) while background tabs keep their last snapshot. It pauses when the overview tab is hidden or windows are minimized.

## Capture previews
In thumbnail mode, **📸 Capture previews** visits every tab that has no preview, takes a shot, then returns each window to the tab you had open. Click again to stop. Tabs that were unloaded get loaded in the process.

## Keyboard
Arrow keys move a cursor over the tiles (up/down jump a full row in thumbnail mode), `Space` selects, `Enter` jumps to the tab, `X` closes the tab under the cursor (or the selection). Mouse clicks also move the cursor.

## Interactions
- Click a tile to jump to the tab. Hover for **Pin**, **Mute** (when audible/muted) and **✕**.
- **Select**: Ctrl/Cmd-click or the checkbox; Shift-click for a range; group checkbox selects a whole group. Once anything is selected, plain clicks toggle selection.
- **Selection bar**: close selected, or move them to any window / a new window.
- **Drag** one tile (or the whole selection) onto a window chip at the top to move it, or onto "New window".
- **Group windows by site** (By site view): one click turns every site with 2+ tabs into its own window (respects the window chip filter; incognito and normal tabs are never mixed). Each site group also has an **Own window** button. Undo puts tabs back where they were.
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

Permissions: `<all_urls>` and `unlimitedStorage` (page thumbnails), `tabs` (titles/URLs), `storage` (open times, game progress, snoozed tabs) and `alarms` (wake snoozed tabs). Nothing leaves your browser.
