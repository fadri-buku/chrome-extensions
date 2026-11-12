# JSON to Excel

Chrome extension (Manifest V3) that converts JSON into a spreadsheet.

- **Download .xlsx** – real Excel file (bold, frozen header row, auto column widths). Opens in Excel, Google Sheets, Numbers.
- **Copy table** – copies tab-separated text; paste straight into Google Sheets or Excel.
- **Open file** – load a `.json` file into the box.

Input: an array of objects (best), a single object, `{"items": [...]}`, or JSON Lines.
Nested objects become dotted columns (`address.city`); arrays of values are joined with `, `; other nested arrays stay as JSON text.

No permissions, no network calls, no dependencies (the .xlsx/ZIP writer is built in).

## Install
`chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
