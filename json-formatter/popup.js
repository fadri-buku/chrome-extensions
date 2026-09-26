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
