# Window Overview

One page that shows every open Chrome window and the tabs inside it.

- Click the toolbar icon to open (or focus) the dashboard.
- One card per window, one row per tab (favicon, title, domain; 📌 pinned, 🔊 audible, 💤 discarded).
- Search by title or URL across all windows.
- Click a tab to jump to it; ✕ closes it; ⧉ moves it to a new window.
- Drag a tab onto another window's card to move it there.
- Updates live as tabs and windows change, and durations tick every 30s.
- Shows how long each tab has been open and when you last used it. Chrome does not record creation time, so the extension timestamps tabs as they open; tabs that already existed at install (or after a browser restart) show a lower bound like `open ≥3h`.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select this `window-overview/` folder.

Permissions: `tabs` (titles/URLs) and `storage` (remembers when each tab was opened). Nothing leaves your browser.
