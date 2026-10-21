const $windows = document.getElementById("windows");
const $search = document.getElementById("search");
const $summary = document.getElementById("summary");
let dragTabId = null;

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
  meta.append(el("div", "title", tab.title || tab.url), el("div", "host", host(tab.url)));

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
  const query = $search.value.trim().toLowerCase();
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const total = wins.reduce((n, w) => n + w.tabs.length, 0);
  $summary.textContent = `${wins.length} windows · ${total} tabs`;

  const cards = wins.map((w, i) => windowCard(w, i, query)).filter(Boolean);
  $windows.replaceChildren(...(cards.length ? cards : [el("div", "empty", "No matching tabs")]));
}

let timer;
const refresh = () => { clearTimeout(timer); timer = setTimeout(render, 100); };

$search.addEventListener("input", render);
[chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
 chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated,
 chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged]
  .forEach((ev) => ev.addListener(refresh));

render();
