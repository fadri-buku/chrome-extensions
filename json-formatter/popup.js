const input = document.getElementById("input");
const status = document.getElementById("status");

function setStatus(message, kind) {
  status.textContent = message;
  status.className = kind ? `status ${kind}` : "status";
}

function format(indent) {
  const text = input.value.trim();
  if (!text) {
    setStatus("Nothing to format", "error");
    return;
  }
  try {
    const parsed = JSON.parse(text);
    input.value = indent === null
      ? JSON.stringify(parsed)
      : JSON.stringify(parsed, null, indent);
    setStatus(`Valid JSON — ${input.value.length} chars`, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

document.getElementById("beautify").addEventListener("click", () => format(2));
document.getElementById("minify").addEventListener("click", () => format(null));

document.getElementById("copy").addEventListener("click", async () => {
  if (!input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    setStatus("Copied to clipboard", "ok");
  } catch {
    setStatus("Copy failed", "error");
  }
});

document.getElementById("clear").addEventListener("click", () => {
  input.value = "";
  setStatus("");
  input.focus();
});

// ---------- JSON -> CSV ----------

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Flatten nested objects into dotted keys; leaf values stay primitives.
function flatten(value, prefix, out) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out[prefix] = "";
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value)) {
    const simple = value.every((x) => x === null || typeof x !== "object");
    out[prefix || "value"] = simple ? value.join(", ") : JSON.stringify(value);
  } else {
    out[prefix || "value"] = value;
  }
  return out;
}

function toCsv(data) {
  let rows;
  if (Array.isArray(data)) rows = data;
  else if (isPlainObject(data)) {
    // {"items": [...]} wrapper: use its only array-of-objects property.
    const keys = Object.keys(data);
    rows = keys.length === 1 && Array.isArray(data[keys[0]]) && data[keys[0]].every(isPlainObject)
      ? data[keys[0]]
      : [data];
  } else rows = [data];

  const headers = [];
  const seen = new Set();
  const flat = rows.map((r) => {
    const f = flatten(r, "", {});
    for (const k of Object.keys(f)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
    return f;
  });
  if (!headers.length) throw new Error("Nothing to convert");

  const cell = (v) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralise spreadsheet formula injection for text values.
    if (typeof v === "string" && /^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...flat.map((f) => headers.map((h) => f[h]))]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}

function csvFromInput() {
  const text = input.value.trim();
  if (!text) throw new Error("Nothing to convert");
  try {
    return toCsv(JSON.parse(text));
  } catch (err) {
    throw err;
  }
}

document.getElementById("csv-download").addEventListener("click", () => {
  try {
    const csv = csvFromInput();
    // BOM so Excel reads UTF-8 correctly.
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "data.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(`CSV downloaded — ${csv.split("\r\n").length - 1} rows`, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
});

document.getElementById("csv-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(csvFromInput());
    setStatus("CSV copied to clipboard", "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// ---------- Create a Google Sheet in the user's Drive ----------
// Uses the narrow drive.file scope: the extension can only see files it
// created itself, and the new sheet is private to the signed-in account.

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "Sign-in failed"));
      } else resolve(token);
    });
  });
}

function uploadSheet(csv, token) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `JSON export ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const boundary = "jsonfmt" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, mimeType: "application/vnd.google-apps.spreadsheet" }) +
    `\r\n--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${csv}\r\n--${boundary}--`;
  return fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
}

document.getElementById("sheet-create").addEventListener("click", async () => {
  let csv;
  try {
    csv = csvFromInput();
  } catch (err) {
    setStatus(err.message, "error");
    return;
  }
  try {
    setStatus("Creating sheet…");
    let token = await getToken(true);
    let res = await uploadSheet(csv, token);
    if (res.status === 401) {
      // Cached token expired/revoked: drop it and retry once.
      await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
      token = await getToken(true);
      res = await uploadSheet(csv, token);
    }
    if (!res.ok) throw new Error(`Drive error ${res.status}`);
    const file = await res.json();
    chrome.tabs.create({ url: file.webViewLink });
    setStatus("Sheet created in your Drive", "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
});
