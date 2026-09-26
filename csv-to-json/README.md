# CSV to JSON (Chrome Extension)

A toolbar popup that converts CSV into formatted JSON, live. Manifest V3, no
build step, no external dependencies, **zero permissions** — it only touches
the CSV you paste or upload into it.

## Features

- **Paste or upload** — type/paste CSV directly, click **Upload**, or drag a
  `.csv` file onto the input box.
- Converts live as you type or change an option.
- **Delimiter** — auto-detect, or force comma/semicolon/tab/pipe.
- **Header row** toggle — first row becomes object keys (array of objects),
  or off for a plain array of arrays.
- **Infer types** toggle — numbers and `true`/`false` become native JSON
  types instead of strings; empty cells become `null`.
- **Indent** — 2 spaces, 4 spaces, or minified.
- Handles quoted fields correctly: commas inside quotes, escaped `""`
  quotes, and multi-line values.
- Malformed CSV (e.g. an unclosed quote) shows an inline error instead of
  producing garbage.
- **Copy** button for the result, **Clear** to reset, **Example** to reload
  sample data.
- Light/dark theme, follows your OS preference.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge,
   Brave, etc. use the same flow).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `csv-to-json` folder.
4. Pin the extension so it's always one click away.
5. Click the toolbar icon, paste or upload a CSV, and copy the JSON out.

No `npm install`, no bundler — it's plain HTML/CSS/JS, loaded directly by
Chrome.

## Project structure

```
csv-to-json/
├── manifest.json   # Manifest V3 config: toolbar action + icons, no permissions
├── popup.html      # Options row, CSV input pane, JSON output pane
├── popup.css       # Styling, including a dark-mode variant
├── popup.js        # CSV parser + conversion logic, upload/drag-drop, clipboard copy
├── icons/          # Toolbar/extension icons (16/48/128 px)
└── README.md
```

## How it works

All the logic lives in `popup.js`:

- A small hand-written parser walks the CSV character by character, tracking
  whether it's inside a quoted field, so delimiters and newlines inside
  quotes don't split a field early, and `""` unescapes to a literal `"`.
- **Auto delimiter** counts occurrences of `,` `;` tab and `|` in the first
  line and picks whichever is most common.
- With **header row** on, the first row becomes each object's keys and the
  rest become records; with it off, every row becomes an array.
- With **infer types** on, each cell is tested against `^-?\d+$` (integer),
  `^-?\d*\.\d+$` (float), and `true`/`false` before falling back to a plain
  string; blank cells become `null`.
- The result is rendered with `JSON.stringify(data, null, indent)`, or with
  no indent argument for the minified option.
- **Upload** and drag-and-drop both read the file with `FileReader.
  readAsText`, then feed the same textarea and conversion path as pasting.
- **Copy** uses `navigator.clipboard.writeText`, which works from an
  extension popup on a user click without any `clipboardWrite` permission.

## Permissions

None. The manifest requests no permissions and no host access — the
extension never makes a network request. CSV files are read locally via
`FileReader` and never leave the popup.
