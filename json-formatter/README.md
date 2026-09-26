# JSON Formatter (Chrome Extension)

A tiny toolbar popup that minifies or beautifies JSON. Manifest V3, no build
step, no external dependencies, **zero permissions** — it only touches the
text you paste into it.

## Features

- **Beautify** — pretty-prints with 2-space indent.
- **Minify** — strips all whitespace down to a single line.
- Validates as it formats: invalid JSON shows the parser's error message
  instead of silently failing.
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

## Permissions

None. The manifest requests no permissions and no host access — the
extension never makes a network request and never touches browser APIs
beyond rendering its own popup.
