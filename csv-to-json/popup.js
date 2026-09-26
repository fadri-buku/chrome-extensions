const EXAMPLE_CSV = 'id,name,department,salary,is_manager,notes\n' +
  '1,"Alameda, Priya",Engineering,98500,true,"Promoted in Q2"\n' +
  '2,Chen Wei,Design,87200,false,\n' +
  '3,"O\'Brien, Sam",Engineering,102000,true,"Leads platform team"\n' +
  '4,Fatima Noor,Product,91000,false,"On parental leave"\n';

const csvInput = document.getElementById("csvInput");
const output = document.getElementById("output");
const status = document.getElementById("status");
const delimiterSel = document.getElementById("delimiter");
const indentSel = document.getElementById("indent");
const headerRowChk = document.getElementById("headerRow");
const inferTypesChk = document.getElementById("inferTypes");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

function setStatus(message, kind) {
  status.textContent = message;
  status.className = kind ? `status ${kind}` : "status";
}

function parseCSV(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  if (inQuotes) {
    throw new Error('An opening quote is never closed. Check for a stray " in the data.');
  }
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split("\n")[0] || "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function convertValue(raw, infer) {
  const v = raw.trim();
  if (!infer) return raw;
  if (v === "") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return v;
}

function render() {
  const raw = csvInput.value;

  if (!raw.trim()) {
    output.textContent = "";
    setStatus("");
    return;
  }

  const delimChoice = delimiterSel.value;
  const delimiter = delimChoice === "auto" ? detectDelimiter(raw) : delimChoice === "\\t" ? "\t" : delimChoice;
  const useHeader = headerRowChk.checked;
  const infer = inferTypesChk.checked;
  const indentValue = indentSel.value === "0" ? 0 : parseInt(indentSel.value, 10);

  let rows;
  try {
    rows = parseCSV(raw, delimiter);
  } catch (err) {
    setStatus(err.message, "error");
    return;
  }

  if (!rows.length) {
    output.textContent = "[]";
    setStatus("0 rows");
    return;
  }

  const colCount = Math.max.apply(null, rows.map((r) => r.length));
  let data;
  let dataRowCount;

  if (useHeader) {
    const headers = rows[0].map((h, idx) => h.trim() || `column_${idx + 1}`);
    const body = rows.slice(1);
    data = body.map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = convertValue(r[idx] !== undefined ? r[idx] : "", infer);
      });
      return obj;
    });
    dataRowCount = body.length;
  } else {
    data = rows.map((r) => r.map((cell) => convertValue(cell, infer)));
    dataRowCount = rows.length;
  }

  const json = indentValue === 0 ? JSON.stringify(data) : JSON.stringify(data, null, indentValue);
  output.textContent = json;
  setStatus(`${dataRowCount} rows · ${colCount} cols`, "ok");
}

function loadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    csvInput.value = String(reader.result || "");
    render();
  };
  reader.onerror = () => setStatus("Could not read that file", "error");
  reader.readAsText(file);
}

csvInput.addEventListener("input", render);
[delimiterSel, indentSel, headerRowChk, inferTypesChk].forEach((el) => el.addEventListener("change", render));

document.getElementById("uploadBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));

document.getElementById("exampleBtn").addEventListener("click", () => {
  csvInput.value = EXAMPLE_CSV;
  render();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  csvInput.value = "";
  output.textContent = "";
  setStatus("");
  csvInput.focus();
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  if (!output.textContent) return;
  try {
    await navigator.clipboard.writeText(output.textContent);
    setStatus("Copied to clipboard", "ok");
  } catch {
    setStatus("Copy failed", "error");
  }
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

csvInput.value = EXAMPLE_CSV;
render();
