"use strict";

const input = document.getElementById("input");
const statusEl = document.getElementById("status");
const fileInput = document.getElementById("file");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// ---------- JSON -> table ----------

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Flatten nested objects into dotted keys; leaf values stay primitives.
function flatten(value, prefix, out) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out[prefix] = "";
    for (const k of keys) flatten(value[k], prefix ? prefix + "." + k : k, out);
  } else if (Array.isArray(value)) {
    const simple = value.every((x) => x === null || typeof x !== "object");
    out[prefix] = simple ? value.join(", ") : JSON.stringify(value);
  } else {
    out[prefix || "value"] = value;
  }
  return out;
}

function toTable(data) {
  let rows;
  if (Array.isArray(data)) rows = data;
  else if (isPlainObject(data)) {
    // {"items": [...]} style wrapper: use the only array-of-objects property.
    const arrays = Object.values(data).filter(
      (v) => Array.isArray(v) && v.length && v.every(isPlainObject)
    );
    rows = arrays.length === 1 && Object.keys(data).length === 1 ? arrays[0] : [data];
  } else rows = [data];

  const headers = [];
  const seen = new Set();
  const flat = rows.map((r) => {
    const f = flatten(r, "", {});
    for (const k of Object.keys(f)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
    return f;
  });
  const body = flat.map((f) => headers.map((h) => (h in f ? f[h] : null)));
  return { headers, body };
}

function parseInput() {
  const text = input.value.trim();
  if (!text) throw new Error("Paste some JSON first");
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // Fall back to JSON Lines / NDJSON.
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    try {
      data = lines.map((l) => JSON.parse(l));
      if (lines.length < 2) throw e;
    } catch {
      throw new Error("Invalid JSON: " + e.message);
    }
  }
  const t = toTable(data);
  if (!t.headers.length) throw new Error("Nothing to convert");
  return t;
}

// ---------- minimal .xlsx writer (ZIP "stored", no dependencies) ----------

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255];
  const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const DOS_TIME = 0, DOS_DATE = (2024 - 1980) << 9 | 1 << 5 | 1;

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const head = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0),
    ]);
    chunks.push(head, name, data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(DOS_TIME), ...u16(DOS_DATE),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset),
      ]),
      name
    );
    offset += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  return new Blob([...chunks, ...central, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function xmlEscape(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function cellXml(v, ref, style) {
  const s = style ? ` s="${style}"` : "";
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  const str = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    str.slice(0, 32767)
  )}</t></is></c>`;
}

function buildXlsx({ headers, body }) {
  const all = [headers, ...body];
  const rowsXml = all
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(v, colName(c) + (r + 1), r === 0 ? 1 : 0)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const widths = headers
    .map((h, c) => {
      let w = String(h).length;
      for (const row of body.slice(0, 200)) {
        const v = row[c];
        if (v != null) w = Math.max(w, String(typeof v === "object" ? JSON.stringify(v) : v).length);
      }
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(Math.max(w + 2, 8), 60)}" customWidth="1"/>`;
    })
    .join("");

  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zip([
    {
      name: "[Content_Types].xml",
      content: `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `${HDR}<workbook ${NS} xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      content: `${HDR}<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `${HDR}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rowsXml}</sheetData></worksheet>`,
    },
  ]);
}

// ---------- TSV (paste into Google Sheets / Excel) ----------

function toTsv({ headers, body }) {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...body].map((r) => r.map(cell).join("\t")).join("\n");
}

// ---------- UI ----------

document.getElementById("download").addEventListener("click", () => {
  try {
    const t = parseInput();
    const url = URL.createObjectURL(buildXlsx(t));
    const a = document.createElement("a");
    a.href = url;
    a.download = "data.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(`${t.body.length} rows × ${t.headers.length} cols`, "ok");
  } catch (e) {
    setStatus(e.message, "error");
  }
});

document.getElementById("copy").addEventListener("click", async () => {
  try {
    const t = parseInput();
    await navigator.clipboard.writeText(toTsv(t));
    setStatus("Copied — paste into a sheet", "ok");
  } catch (e) {
    setStatus(e.message, "error");
  }
});

document.getElementById("open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const f = fileInput.files[0];
  if (!f) return;
  input.value = await f.text();
  fileInput.value = "";
  setStatus(f.name, "");
});

document.getElementById("clear").addEventListener("click", () => {
  input.value = "";
  setStatus("", "");
  input.focus();
});
