const $ = (id) => document.getElementById(id);
const COLORS = ["#4f6bed", "#f08a24", "#2fa56b", "#a142f4", "#d93025", "#12b5cb", "#c26401", "#e52592"];
const BUCKETS = [
  { key: "now", name: "Now", test: (m) => m < 60 },
  { key: "today", name: "Today", test: (m) => m < 1440 },
  { key: "week", name: "This week", test: (m) => m < 10080 },
  { key: "old", name: "Forgotten", test: () => true, bad: true },
];

let view = localStorage.getItem("view2") || "fresh";
let thumbsOn = localStorage.getItem("thumbs") === "1";
let thumbs = {};
let wins = [], tabs = [], openedAt = {}, kept = {};
let selected = new Set();
let winFilter = new Set();
let lastClicked = null;
let dragIds = null;
let undoInfo = null, toastTimer;
let order = []; // tab ids in the order they are rendered, for shift-range select

const winColor = (i) => COLORS[i % COLORS.length];
const hue = (s) => { let n = 0; for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 360; return n; };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const idleOf = (t) => idleMin(t, kept, openedAt);

// ---------- actions ----------
function toast(msg, undo) {
  undoInfo = undo || null; // async function that reverses the action
  $("toastmsg").textContent = msg;
  $("undo").hidden = !undo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; undoInfo = null; }, 9000);
}

async function closeTabs(ids) {
  if (!ids.length) return;
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const saved = ids.map((id) => byId.get(id)).filter(Boolean)
    .map((t) => ({ url: t.url, windowId: t.windowId, pinned: t.pinned }));
  ids.forEach((id) => selected.delete(id));
  await chrome.tabs.remove(ids);
  toast(`Closed ${ids.length} tab${ids.length > 1 ? "s" : ""}`, async () => {
    const live = new Set(wins.map((w) => w.id));
    for (const t of saved) {
      try { await chrome.tabs.create({ url: t.url, windowId: live.has(t.windowId) ? t.windowId : undefined, pinned: t.pinned, active: false }); } catch {}
    }
  });
}

async function undoLast() {
  const fn = undoInfo;
  if (!fn) return;
  $("toast").hidden = true;
  undoInfo = null;
  await fn();
}

// Put each list of tabs (same site, same incognito state) into a window of its own.
async function siteWindows(groups) {
  const flat = groups.flat();
  const saved = flat.map((t) => ({ id: t.id, windowId: t.windowId, index: t.index }));
  try {
    for (const g of groups) {
      const ids = g.map((t) => t.id);
      const w = await chrome.windows.create({ tabId: ids[0], focused: false });
      if (ids.length > 1) await chrome.tabs.move(ids.slice(1), { windowId: w.id, index: -1 });
    }
  } catch (err) {
    toast(`Could not move tabs: ${err.message}`);
    return;
  }
  selected.clear();
  toast(`Grouped ${flat.length} tabs into ${groups.length} window${groups.length > 1 ? "s" : ""}`, () => restoreTabs(saved));
}

async function restoreTabs(saved) {
  const byWin = new Map();
  saved.forEach((s) => { if (!byWin.has(s.windowId)) byWin.set(s.windowId, []); byWin.get(s.windowId).push(s); });
  for (const [wid, list] of byWin) {
    list.sort((a, b) => a.index - b.index);
    const alive = await chrome.windows.get(wid).then(() => true, () => false);
    try {
      if (alive) {
        for (const s of list) await chrome.tabs.move(s.id, { windowId: wid, index: s.index });
      } else {
        const w = await chrome.windows.create({ tabId: list[0].id, focused: false });
        if (list.length > 1) await chrome.tabs.move(list.slice(1).map((s) => s.id), { windowId: w.id, index: -1 });
      }
    } catch {}
  }
}

// Tabs of one site can only share a window with tabs of the same incognito state.
const incognitoOf = (t) => !!wins.find((w) => w.id === t.windowId)?.incognito;
const movable = (t) => !(t.url || "").startsWith("chrome-extension://");

function siteBuckets(list) {
  const m = new Map();
  list.filter(movable).forEach((t) => {
    const k = `${incognitoOf(t)}|${hostOf(t.url)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  });
  return [...m.values()];
}

// Already sitting alone together in one window: nothing to do.
const isOwnWindow = (g) => g.every((t) => t.windowId === g[0].windowId) && wins.find((w) => w.id === g[0].windowId)?.tabs.length === g.length;

async function moveTabs(ids, windowId) {
  if (!ids.length) return;
  if (windowId === "new") {
    const w = await chrome.windows.create({ tabId: ids[0] });
    if (ids.length > 1) await chrome.tabs.move(ids.slice(1), { windowId: w.id, index: -1 });
  } else {
    await chrome.tabs.move(ids, { windowId, index: -1 });
  }
  selected.clear();
  toast(`Moved ${ids.length} tab${ids.length > 1 ? "s" : ""}`);
}

function toggle(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  lastClicked = id;
}

// ---------- rendering ----------
function tile(t, dupCount) {
  const wi = wins.findIndex((w) => w.id === t.windowId);
  const li = el("div", "tile" + (t.active ? " active" : "") + (selected.has(t.id) ? " sel" : ""));
  li.draggable = true;
  li.dataset.id = t.id;

  const chk = el("div", "chk");
  chk.append(el("i"));

  let icon;
  if (t.favIconUrl) {
    icon = el("img", "ico");
    icon.src = t.favIconUrl;
    icon.onerror = () => icon.replaceWith(letter(t));
  } else icon = letter(t);

  const info = el("div", "info");
  const sub = el("div", "sub2");
  const o = openedAt[t.id];
  const parts = [hostOf(t.url)];
  if (o) parts.push(`open ${o.approx ? "≥" : ""}${ago(Date.now() - o.t)}`);
  if (!t.active) parts.push(`used ${ago(idleOf(t) * 60000)} ago`);
  sub.textContent = parts.join(" · ");
  if (dupCount > 1) sub.append(" · ", el("span", "dup", `${dupCount}× open`));
  info.append(el("div", "title", t.title || t.url), sub);

  const badge = el("span", "wb", `W${wi + 1}`);
  badge.style.background = winColor(wi);
  badge.title = `Window ${wi + 1}`;

  const flags = el("span", "flags", [t.pinned && "📌", t.audible && "🔊", t.mutedInfo?.muted && "🔇", t.discarded && "💤"].filter(Boolean).join(" "));

  const acts = el("div", "acts");
  const pin = el("button", "", t.pinned ? "Unpin" : "Pin");
  pin.addEventListener("click", (e) => { e.stopPropagation(); chrome.tabs.update(t.id, { pinned: !t.pinned }); });
  const mute = el("button", "", t.mutedInfo?.muted ? "Unmute" : "Mute");
  mute.addEventListener("click", (e) => { e.stopPropagation(); chrome.tabs.update(t.id, { muted: !t.mutedInfo?.muted }); });
  const x = el("button", "x", "✕");
  x.title = "Close tab";
  x.addEventListener("click", (e) => { e.stopPropagation(); closeTabs([t.id]); });
  acts.append(...(t.audible || t.mutedInfo?.muted ? [mute] : []), pin, x);

  li.append(chk, icon, info, flags, badge, acts);
  if (thumbsOn) {
    li.classList.add("withthumb");
    const th = thumbs[t.id] ? el("img", "thumb") : el("div", "thumb none", t.discarded ? "💤 not loaded" : "no preview yet");
    if (thumbs[t.id]) th.src = thumbs[t.id];
    li.prepend(th);
  }

  li.addEventListener("click", async (e) => {
    if (e.shiftKey && lastClicked !== null) {
      const a = order.indexOf(lastClicked), b = order.indexOf(t.id);
      if (a >= 0 && b >= 0) order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((id) => selected.add(id));
    } else if (e.ctrlKey || e.metaKey || e.target.closest(".chk") || selected.size) {
      toggle(t.id);
    } else {
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return;
    }
    render();
  });
  li.addEventListener("dragstart", (e) => {
    dragIds = selected.has(t.id) ? [...selected] : [t.id];
    e.dataTransfer.setData("text/plain", String(dragIds.length));
    e.dataTransfer.effectAllowed = "move";
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => { dragIds = null; li.classList.remove("dragging"); render(); });
  return li;
}

function letter(t) {
  const d = el("div", "ico", (hostOf(t.url)[0] || "?").toUpperCase());
  d.style.background = `hsl(${hue(hostOf(t.url))} 55% 48%)`;
  return d;
}

function group(name, list, opts, dupMap) {
  const g = el("section", "group" + (opts.bad ? " bad" : ""));
  const head = el("div", "ghead");
  const cb = el("input", "gsel");
  cb.type = "checkbox";
  const n = list.filter((t) => selected.has(t.id)).length;
  cb.checked = n === list.length;
  cb.indeterminate = n > 0 && n < list.length;
  cb.title = "Select group";
  cb.addEventListener("click", () => {
    list.forEach((t) => (n === list.length ? selected.delete(t.id) : selected.add(t.id)));
    render();
  });
  head.append(cb, document.createTextNode(name), el("span", "count", String(list.length)));
  if (opts.sub) head.append(el("span", "sub", opts.sub));
  if (opts.ownWindow) {
    const parts = siteBuckets(list).filter((g) => !isOwnWindow(g));
    if (parts.length) {
      const mv = el("button", "gmove", "Own window");
      mv.title = "Move these tabs into a new window";
      mv.addEventListener("click", () => siteWindows(parts));
      head.append(mv);
    }
  }
  const close = el("button", "gclose", "Close all");
  close.addEventListener("click", () => closeTabs(list.map((t) => t.id)));
  head.append(close);
  g.append(head);
  list.forEach((t) => { order.push(t.id); g.append(tile(t, dupMap[t.url])); });
  return g;
}

function renderChips() {
  const chips = $("chips");
  chips.replaceChildren();
  wins.forEach((w, i) => {
    const c = el("button", "chip" + (winFilter.has(w.id) ? " on" : ""));
    const b = el("span", "wb", `W${i + 1}`);
    b.style.background = winColor(i);
    c.append(b, `${w.tabs.length} tabs`);
    if (w.focused) c.append(el("small", "", "· focused"));
    if (w.incognito) c.append(el("small", "", "· incognito"));
    c.title = "Click to filter. Drop tabs here to move them.";
    c.addEventListener("click", () => { winFilter.has(w.id) ? winFilter.delete(w.id) : winFilter.add(w.id); render(); });
    wireDrop(c, w.id);
    chips.append(c);
  });
  const nw = el("button", "chip newwin", "＋ New window (drop here)");
  nw.addEventListener("click", () => { if (selected.size) moveTabs([...selected], "new"); });
  wireDrop(nw, "new");
  chips.append(nw);
}

function wireDrop(node, target) {
  node.addEventListener("dragover", (e) => { if (dragIds) { e.preventDefault(); node.classList.add("drop"); } });
  node.addEventListener("dragleave", () => node.classList.remove("drop"));
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    node.classList.remove("drop");
    const ids = dragIds;
    dragIds = null;
    if (ids) moveTabs(ids, target);
  });
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  tabs = wins.flatMap((w) => w.tabs);
  const urlCount = {};
  tabs.forEach((t) => { if (!t.url.startsWith("chrome://newtab")) urlCount[t.url] = (urlCount[t.url] || 0) + 1; });
  const shown = tabs.filter((t) => (!winFilter.size || winFilter.has(t.windowId)) && (!q || `${t.title} ${t.url}`.toLowerCase().includes(q)));
  selected = new Set([...selected].filter((id) => tabs.some((t) => t.id === id)));

  $("summary").textContent = `${wins.length} windows · ${tabs.length} tabs`;
  document.querySelectorAll("#views button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  document.body.classList.toggle("selecting", selected.size > 0);
  document.body.classList.toggle("thumbs", thumbsOn);
  $("thumbbtn").classList.toggle("on", thumbsOn);

  // duplicates banner
  const extras = [];
  const byUrl = {};
  tabs.forEach((t) => { if (urlCount[t.url] > 1) (byUrl[t.url] = byUrl[t.url] || []).push(t); });
  Object.values(byUrl).forEach((l) => l.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).slice(1).forEach((t) => extras.push(t.id)));
  $("dups").hidden = !extras.length;
  $("dups").textContent = `⧉ Close ${extras.length} duplicate${extras.length > 1 ? "s" : ""}`;
  $("dups").onclick = () => closeTabs(extras);

  // one window per site (only sites with 2+ tabs, so single tabs don't each get a window)
  const scope = tabs.filter((t) => !winFilter.size || winFilter.has(t.windowId));
  const plan = view === "site" ? siteBuckets(scope).filter((g) => g.length > 1 && !isOwnWindow(g)) : [];
  $("groupwin").hidden = !plan.length;
  $("groupwin").textContent = `▦ Group windows by site (${plan.length})`;
  $("groupwin").onclick = () => {
    const n = plan.reduce((c, g) => c + g.length, 0);
    if (confirm(`Move ${n} tabs into ${plan.length} new window${plan.length > 1 ? "s" : ""}, one per site? You can undo this.`)) siteWindows(plan);
  };

  const debt = tabs.filter(triageable).reduce((n, t) => n + debtOf(idleOf(t)), 0);
  $("debtnum").textContent = debt.toLocaleString();
  renderChips();

  order = [];
  const main = $("main");
  main.className = view;
  const groups = [];
  if (view === "fresh") {
    const buckets = BUCKETS.map((b) => ({ ...b, list: [] }));
    shown.forEach((t) => buckets.find((b) => b.test(idleOf(t))).list.push(t));
    buckets.forEach((b) => { b.list.sort((a, c) => idleOf(a) - idleOf(c)); groups.push(group(b.name, b.list, { bad: b.bad }, urlCount)); });
  } else {
    const bySite = {};
    shown.forEach((t) => (bySite[hostOf(t.url)] = bySite[hostOf(t.url)] || []).push(t));
    Object.entries(bySite).sort((a, b) => b[1].length - a[1].length).forEach(([h, list]) => {
      list.sort((a, c) => idleOf(a) - idleOf(c));
      groups.push(group(h, list, { ownWindow: true, sub: `oldest ${ago(Math.max(...list.map((t) => idleOf(t))) * 60000)}` }, urlCount));
    });
  }
  main.replaceChildren(...(shown.length ? groups : [el("div", "empty", "No matching tabs")]));

  // selection bar
  $("selbar").hidden = !selected.size;
  $("selcount").textContent = `${selected.size} selected`;
  const mv = $("moveto");
  mv.replaceChildren(new Option("Choose…", ""), ...wins.map((w, i) => new Option(`Window ${i + 1}`, w.id)), new Option("New window", "new"));
}

async function load() {
  const s = await chrome.storage.local.get(["openedAt", "kept"]);
  openedAt = s.openedAt || {};
  kept = s.kept || {};
  wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const keys = wins.flatMap((w) => w.tabs.map((t) => `thumb:${t.id}`));
  const got = thumbsOn ? await chrome.storage.local.get(keys) : {};
  thumbs = Object.fromEntries(Object.entries(got).map(([k, v]) => [k.slice(6), v]));
  render();
}

let timer;
const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { if (!dragIds) load(); }, 120); };

// ---------- wiring ----------
document.querySelectorAll("#views button").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view;
  localStorage.setItem("view2", view);
  render();
}));
$("thumbbtn").addEventListener("click", () => {
  thumbsOn = !thumbsOn;
  localStorage.setItem("thumbs", thumbsOn ? "1" : "0");
  load();
});
$("search").addEventListener("input", render);
$("selclose").addEventListener("click", () => closeTabs([...selected]));
$("selclear").addEventListener("click", () => { selected.clear(); render(); });
$("selall").addEventListener("click", () => { order.forEach((id) => selected.add(id)); render(); });
$("moveto").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v) moveTabs([...selected], v === "new" ? v : +v);
});
$("undo").addEventListener("click", undoLast);

document.addEventListener("keydown", (e) => {
  const typing = document.activeElement === $("search");
  if (e.key === "/" && !typing) { e.preventDefault(); $("search").focus(); }
  else if (e.key === "Escape") {
    if (typing && $("search").value) { $("search").value = ""; render(); }
    else { selected.clear(); winFilter.clear(); $("search").blur(); render(); }
  } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && selected.size) { e.preventDefault(); closeTabs([...selected]); }
  else if (!typing && (e.ctrlKey || e.metaKey) && e.key === "a") { e.preventDefault(); order.forEach((id) => selected.add(id)); render(); }
  else if (!typing && (e.ctrlKey || e.metaKey) && e.key === "z" && undoInfo) { e.preventDefault(); undoLast(); }
});

[chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
 chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated,
 chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged,
 chrome.storage.onChanged].forEach((ev) => ev.addListener(refresh));
setInterval(refresh, 30000); // keep durations ticking
load();
