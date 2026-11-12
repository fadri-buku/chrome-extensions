# JSON Formatter (Chrome Extension)

A tiny toolbar popup that minifies or beautifies JSON. Manifest V3, no build
step, no external dependencies, **zero permissions** — it only touches the
text you paste into it.

## Features

- **Beautify** — pretty-prints with 2-space indent.
- **Minify** — strips all whitespace down to a single line.
- Validates as it formats: invalid JSON shows the parser's error message
  instead of silently failing.
- **Download CSV / Copy CSV** — converts JSON (array of objects, a single
  object, or `{"items": [...]}`) to a spreadsheet-ready CSV. Nested objects
  become dotted columns (`address.city`); arrays of values are joined with
  `, `; other nested arrays stay as JSON text. Everything runs locally, so
  your data never leaves your browser. Text starting with `= + - @` is
  prefixed with `'` to avoid spreadsheet formula injection.
- **Create Google Sheet** — converts the JSON and creates a Google Sheet in
  *your* Drive in one click, then opens it. Uses the `drive.file` scope, so the
  extension can only touch files it created and the sheet is private to you.
  Requires one-time setup, see below.
- **Copy** button to grab the result, **Clear** to reset the textarea.
- Light/dark theme, follows your OS preference.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge,
   Brave, etc. use the same flow).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `json-formatter` folder.
4. Pin the extension so it's always one click away.
5. Click the toolbar icon, paste JSON, and click **Beautify** or **Minify**.

No `npm install`, no bundler — it's plain HTML/CSS/JS, loaded directly by
Chrome.

## Project structure

```
json-formatter/
├── manifest.json   # Manifest V3 config: toolbar action + icons, no permissions
├── popup.html      # Textarea + toolbar buttons
├── popup.css       # Styling, including a dark-mode variant
├── popup.js        # Formatting logic (JSON.parse/JSON.stringify + clipboard copy)
├── icons/          # Toolbar/extension icons (16/48/128 px)
└── README.md
```

## How it works

All the logic lives in `popup.js` and relies entirely on the JS built-ins
`JSON.parse` / `JSON.stringify` — there's no JSON library to keep this
lightweight:

- **Beautify** calls `JSON.stringify(parsed, null, 2)`.
- **Minify** calls `JSON.stringify(parsed)` (no indent argument), which
  drops all insignificant whitespace.
- Both first run the text through `JSON.parse`, so a syntax error surfaces
  the native parser's message (e.g. `Unexpected token } in JSON at position
  42`) in the status line instead of formatting garbage.
- **Copy** uses `navigator.clipboard.writeText`, which works from an
  extension popup on a user click without any `clipboardWrite` permission.

## Google Sheets setup (one time)

The extension has a fixed ID (set by the `key` in `manifest.json`) so the
OAuth client can be tied to it. Chrome only (`chrome.identity.getAuthToken`).

1. Load unpacked; the extension ID on `chrome://extensions` should be
   `imakgnbbpbckjacpdajbgimepmaolnmn`.
2. In Google Cloud Console create a project, enable the **Google Drive API**,
   and configure the OAuth consent screen (External, add yourself as a test user).
3. Create credentials -> **OAuth client ID** -> application type **Chrome
   extension**, with the ID from step 1.
4. Put the client ID in `manifest.json` under `oauth2.client_id`, reload the
   extension, and click **Create Google Sheet**.

## Permissions

`identity` (Google sign-in) and host access to `www.googleapis.com` (Drive
upload). Nothing is sent anywhere unless you click Create Google Sheet.
