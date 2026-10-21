const $windows = document.getElementById("windows");
const $search = document.getElementById("search");
const $summary = document.getElementById("summary");
let dragTabId = null;
let openedAt = {};
let view = localStorage.getItem("view") || "graph";
document.querySelectorAll("#views button").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view;
  localStorage.setItem("view", view);
  render();
}));

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ageText(tab) {
  const parts = [];
  const o = openedAt[tab.id];
  if (o) parts.push(`open ${o.approx ? "≥" : ""}${ago(Date.now() - o.t)}`);
  if (tab.lastAccessed && !tab.active) parts.push(`used ${ago(Date.now() - tab.lastAccessed)} ago`);
  return parts.join(" · ");
}

function host(url) {
  try { return new URL(url).host || url; } catch { return url || ""; }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tabRow(tab, wins) {
  const li = el("li", "tab" + (tab.active ? " active" : ""));
  li.draggable = true;
  li.addEventListener("dragstart", () => { dragTabId = tab.id; li.classList.add("dragging"); });
  li.addEventListener("dragend", () => { dragTabId = null; li.classList.remove("dragging"); });
  li.addEventListener("click", async () => {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  });

  const fav = el("img", "fav");
  if (tab.favIconUrl) fav.src = tab.favIconUrl;
  fav.onerror = () => fav.removeAttribute("src");

  const meta = el("div", "meta");
  const age = ageText(tab);
  meta.append(el("div", "title", tab.title || tab.url), el("div", "host", host(tab.url)));
  if (age) meta.append(el("div", "host age", age));

  const flags = el("span", "flags", [tab.pinned && "📌", tab.audible && "🔊", tab.discarded && "💤"].filter(Boolean).join(" "));

  const newWin = el("button", "btn", "⧉");
  newWin.title = "Move to new window";
  newWin.addEventListener("click", (e) => { e.stopPropagation(); chrome.windows.create({ tabId: tab.id }); });

  const close = el("button", "btn close", "✕");
  close.title = "Close tab";
  close.addEventListener("click", (e) => { e.stopPropagation(); chrome.tabs.remove(tab.id); });

  li.append(fav, meta, flags, newWin, close);
  return li;
}

function windowCard(win, index, query) {
  const tabs = win.tabs.filter((t) => !query || `${t.title} ${t.url}`.toLowerCase().includes(query));
  if (query && !tabs.length) return null;

  const card = el("section", "win" + (win.focused ? " focused" : ""));
  card.addEventListener("dragover", (e) => { if (dragTabId !== null) { e.preventDefault(); card.classList.add("dragover"); } });
  card.addEventListener("dragleave", () => card.classList.remove("dragover"));
  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    card.classList.remove("dragover");
    if (dragTabId !== null) await chrome.tabs.move(dragTabId, { windowId: win.id, index: -1 });
  });

  const head = el("div", "win-head", `Window ${index + 1}`);
  if (win.focused) head.append(el("span", "badge", "focused"));
  if (win.incognito) head.append(el("span", "badge", "incognito"));
  head.append(el("span", "count", query ? `${tabs.length} of ${win.tabs.length}` : `${win.tabs.length} tabs`));

  const list = el("ul", "tabs");
  tabs.forEach((t) => list.append(tabRow(t)));
  card.append(head, list);
  return card;
}

async function render() {
  openedAt = (await chrome.storage.local.get("openedAt")).openedAt || {};
  const query = $search.value.trim().toLowerCase();
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const total = wins.reduce((n, w) => n + w.tabs.length, 0);
  $summary.textContent = `${wins.length} windows · ${total} tabs`;

  document.querySelectorAll("#views button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $windows.classList.toggle("graph-mode", view === "graph");
  if (view === "graph") {
    $windows.replaceChildren(renderGraph(wins, openedAt, query, { ago }));
    return;
  }
  const cards = wins.map((w, i) => windowCard(w, i, query)).filter(Boolean);
  $windows.replaceChildren(...(cards.length ? cards : [el("div", "empty", "No matching tabs")]));
}

let timer;
const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { if (dragTabId === null) render(); }, 100); };

$search.addEventListener("input", render);
[chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
 chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated,
 chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged]
  .forEach((ev) => ev.addListener(refresh));

chrome.storage.onChanged.addListener(refresh);
setInterval(refresh, 30000); // keep durations ticking
render();
