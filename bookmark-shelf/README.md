# Bookmark Shelf (Chrome Extension)

A popup bookmark manager: organize bookmarks into **categories**, add the
page you're on with one click, and generate a **QR code** for any saved
link — all backed by real Chrome bookmarks, so everything rides Chrome's
own sync to whatever Google account you're signed into. Manifest V3, no
build step, no network requests, one vendored (MIT-licensed) QR library
and nothing else.

## Features

- **Categories are real bookmark folders** — every category you create is
  a folder under a single "Bookmark Shelf" folder in "Other Bookmarks", and
  every bookmark you add is a real Chrome bookmark inside it. Nothing lives
  in extension storage, so it's visible in Chrome's own Bookmark Manager
  and **syncs across devices via Chrome's account sync**, the same way any
  bookmark does — no extra sign-in step, no custom backend.
- **One accordion view, not a drill-down** — every category is listed with
  its bookmarks expandable in place right underneath it (all expanded by
  default, with a **Collapse all / Expand all** toggle). You can see and
  manage several categories side by side instead of navigating into one
  category at a time and losing sight of the rest.
- Add a category, rename it inline, or delete it (with its bookmarks) via a
  two-step confirm — no `window.confirm`, since Chrome extension popups
  don't support the native JS dialogs at all.
- **Add a bookmark to any category** with its own "+" button, which opens
  an inline form scoped to that category (prefilled from the current tab,
  or click **Use current tab** to refill it). Edit or delete any bookmark
  in place; click a bookmark to open it in a new tab.
- **Move a bookmark between categories** two ways: drag a bookmark row and
  drop it on another category's header, or click the ⇄ button for a
  dropdown of every other category — whichever is more convenient in the
  moment.
- **QR code, generated fully offline**: click the QR icon on any bookmark
  to render a QR code for its URL directly on a `<canvas>`, with a
  **Download PNG** button. No API call, no image ever leaves the machine —
  it's encoded locally by a vendored copy of `qrcode-generator`.
- **Search across every category** from the top search box — matches
  title or URL, and each result shows which category it's filed under with
  a jump-to-category action that expands it in the accordion below.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or another Chromium browser).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `bookmark-shelf` folder.
4. Pin the extension, then click its toolbar icon to open the popup.

No `npm install`, no bundler — plain HTML/CSS/JS loaded directly by Chrome.

## Project structure

```
bookmark-shelf/
├── manifest.json         # MV3 config: permissions, popup, icons
├── lib/
│   ├── bookmarks.js       # chrome.bookmarks wrapper: categories (folders) + items (bookmarks)
│   └── qrcode.js          # vendored qrcode-generator (MIT) — offline QR encoding
├── popup/
│   ├── popup.html/.css/.js  # the whole UI: categories, items, search, QR overlay
└── icons/                 # toolbar/extension icons (16/48/128 px)
```

## How it works

### Bookmarks as the only data store (`lib/bookmarks.js`)

There is no `chrome.storage` layer at all — categories and their bookmarks
*are* the data. `getOrCreateRootFolderId()` searches for a folder titled
"Bookmark Shelf" under "Other Bookmarks" (created once, cached, and
re-searched-by-title if the cached id ever goes stale after a service
worker/popup reload). Categories are that folder's direct children;
`listCategories()` reads them via `chrome.bookmarks.getChildren` and counts
each one's bookmark children for the badge shown in the list. Adding,
renaming, and deleting a bookmark or category are thin calls to
`chrome.bookmarks.create/update/remove/removeTree` — Chrome's own bookmark
sync (tied to the signed-in Google account) does the rest, including
propagating changes to other devices and to Chrome's Bookmark Manager UI.
A bare domain typed into the URL field (e.g. `example.com`) is normalized
to `https://example.com` before being saved.

### Accordion state (`popup/popup.js`)

There's a single list of category "sections"; `expandedIds` (a `Set`) tracks
which ones are currently open, and `itemsByCategory` caches each expanded
category's bookmarks. Every mutation (add/edit/delete/move, in this
category or another) goes through `loadAndRender()`, which re-fetches
categories plus every currently-expanded category's items and re-renders
the whole list from that state — simple and correct over piecemeal DOM
patching, and cheap enough for the size of data involved. Toggling a
category adds/removes its id from `expandedIds` (fetching its items on
first expand, dropping the cache on collapse); **Collapse all/Expand all**
does the same for every category at once, and its own label reflects which
state you're in.

### Moving a bookmark between categories

Two independent paths call the same `store.moveItem(itemId, categoryId)`,
which is just `chrome.bookmarks.move` under the hood:

- **Drag-and-drop**: every bookmark row is `draggable`; `dragstart` puts its
  id on the `DataTransfer` under a custom MIME type
  (`text/bookmark-item-id`). Each category header listens for `dragover`
  (only reacting if that MIME type is present, so dragging something else
  onto it is a no-op) and highlights itself, then reads the id back out on
  `drop`.
- **The ⇄ button**: swaps that bookmark's actions for a `<select>` listing
  every *other* category (hidden entirely if there's only one category to
  begin with); picking one fires the move on `change`. This is the
  reliable fallback for anyone who'd rather not drag, and doesn't depend on
  the browser's native drag gesture at all.

### No native dialogs

Chrome extension popups don't support `window.alert`/`confirm`/`prompt` —
calling them is a silent no-op. Every place that would normally use one
gets bespoke inline UI instead: renaming a category swaps its header for a
text input with ✓/✕ buttons, and deleting a category or bookmark is a
two-click confirm (a row swaps to explicit Delete/Cancel buttons) rather
than a popup dialog.

### QR generation (`lib/qrcode.js`, used from `popup.js`)

`lib/qrcode.js` is `qrcode-generator` v2.0.4 (dist/qrcode.js +
dist/qrcode_UTF8.js) vendored verbatim under its MIT license, loaded as a
plain classic `<script>` (not a module) so it attaches a global `qrcode`
function, exactly as the upstream library expects. `showQr()` in
`popup.js` calls `qrcode(0, 'M')` — type `0` means "auto-pick the smallest
QR version that fits the data" — adds the bookmark's URL, calls `.make()`,
then uses the library's own `renderTo2dContext()` to paint the module grid
straight onto the popup's `<canvas>` at a fixed cell size, with a quiet-zone
margin added manually. **Download PNG** just calls `canvas.toDataURL()` and
triggers it through a throwaway `<a download>` link — no server round
trip, so the URL being encoded never leaves the browser.

### Search (`searchItems` in `lib/bookmarks.js`)

Walks every category under the root folder, checks each of its bookmarks'
title/URL for a case-insensitive substring match, and returns hits flagged
with their parent category's id/title so the popup can render a "jump to
category" action per result.

## Permissions

- `bookmarks` — read/create/update/remove the categories (folders) and
  bookmarks this extension manages, all confined to its own root folder.
- `activeTab` — lets **Use current tab** (and the automatic prefill when an
  add-bookmark form is opened) read the URL/title of the tab the popup was
  opened from. Granted only for that tab, only because opening the popup is
  itself the user gesture that activates it — no broader `tabs` permission
  needed.

No network requests are made anywhere in this extension — bookmark sync
happens entirely through Chrome's own account sync infrastructure, and QR
codes are generated locally by the vendored library.

## Known limitations

- Bookmark sync requires Chrome's own account sync to be enabled
  (`chrome://settings/syncSetup`) — this extension doesn't sync anything
  itself, it just creates ordinary bookmarks and lets Chrome do the rest.
- Categories are flat (no nested sub-categories) — a category is always a
  direct child of the "Bookmark Shelf" root folder.
- Renaming/organizing folders or bookmarks directly in Chrome's Bookmark
  Manager works fine and is picked up next time the popup opens, but
  moving a bookmark *out* of the "Bookmark Shelf" folder tree that way just
  makes it disappear from the extension's view (it's still a normal
  bookmark, just no longer inside a tracked category).
- The popup closes if it loses focus (standard Chrome behavior for
  `default_popup`), so a long editing session means reopening it; nothing
  unsaved is lost since every change is written to `chrome.bookmarks`
  immediately, not held in memory.
- Drag-and-drop between categories moves the bookmark to the end of the
  target category (no drop-position reordering within a category) — it
  intentionally avoids the trickier index math needed for precise
  reordering. The ⇄ dropdown does the same move without any drag gesture.
- Categories don't have a manual sort order in the UI (they list in
  whatever order `chrome.bookmarks.getChildren` returns, which follows
  Chrome's own folder order) — reorder them via Chrome's Bookmark Manager
  if needed.
