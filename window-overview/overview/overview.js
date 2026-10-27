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
let thumbSize = localStorage.getItem("thumbsize") || "3x3"; // "6" / "4" per row, or "3x3" = nine fill the screen
let focusId = null; // keyboard cursor
let sessions = [];
let sweeping = false;
let live = localStorage.getItem("live") === "1";
let liveIdx = 0, liveTimer;
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
  const li = el("div", "tile" + (t.active ? " active" : "") + (selected.has(t.id) ? " sel" : "") + (focusId === t.id ? " kfocus" : ""));
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
    if (live && t.active && savable(t)) li.append(el("span", "livedot", "● LIVE"));
  }

  li.addEventListener("click", async (e) => {
    focusId = t.id;
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
  $("thumbsize").hidden = !thumbsOn;
  $("sweepbtn").hidden = !thumbsOn;
  $("livebtn").hidden = !thumbsOn;
  $("livebtn").classList.toggle("on", live);
  if ($("sessions").open) renderSessions();
  document.querySelectorAll("#thumbsize button").forEach((b) => b.classList.toggle("on", b.dataset.size === thumbSize));
  document.body.style.setProperty("--cols", thumbSize === "3x3" ? 3 : thumbSize);
  document.body.classList.toggle("fit", thumbsOn && thumbSize === "3x3");

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
  if (focusId !== null && !order.includes(focusId)) focusId = null;
  const mv = $("moveto");
  mv.replaceChildren(new Option("Choose…", ""), ...wins.map((w, i) => new Option(`Window ${i + 1}`, w.id)), new Option("New window", "new"));
}

// ---------- saved sessions ----------
const savable = (t) => /^(https?|file|ftp):/.test(t.url || "");

async function saveSession(list, name, close) {
  const byWin = new Map();
  list.filter(savable).forEach((t) => {
    if (!byWin.has(t.windowId)) byWin.set(t.windowId, []);
    byWin.get(t.windowId).push({ url: t.url, title: t.title || t.url, pinned: t.pinned, fav: t.favIconUrl && !t.favIconUrl.startsWith("data:") ? t.favIconUrl : "" });
  });
  const groups = [...byWin.values()];
  const n = groups.reduce((c, g) => c + g.length, 0);
  if (!n) { toast("Nothing to save"); return; }
  const sess = { id: String(Date.now()), name: name || `${new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`, savedAt: Date.now(), windows: groups };
  await chrome.storage.local.set({ sessions: [sess, ...sessions] });
  if (close) await closeTabs(list.filter(savable).map((t) => t.id));
  else toast(`Saved ${n} tab${n > 1 ? "s" : ""} as "${sess.name}"`);
}

async function restoreSession(sess) {
  for (const urls of sess.windows) {
    const w = await chrome.windows.create({ url: urls.map((t) => t.url), focused: false });
    await Promise.all(w.tabs.map((tab, i) => urls[i]?.pinned ? chrome.tabs.update(tab.id, { pinned: true }) : null));
  }
  toast(`Restored "${sess.name}"`);
}

function fillScope() {
  const sel = $("sessscope");
  const prev = sel.value;
  sel.replaceChildren(
    ...(selected.size ? [new Option(`Selected tabs (${selected.size})`, "sel")] : []),
    new Option("All windows", "all"),
    ...wins.map((w, i) => new Option(`Window ${i + 1} (${w.tabs.length} tabs)`, w.id)),
  );
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderSessions() {
  fillScope();
  const box = $("sesslist");
  box.replaceChildren();
  if (!sessions.length) box.append(el("div", "empty", "No saved sessions yet"));
  sessions.forEach((s) => {
    const n = s.windows.reduce((c, g) => c + g.length, 0);
    const row = el("div", "sess");
    const info = el("div", "sinfo");
    info.append(el("div", "sname", s.name), el("div", "ssub", `${n} tabs · ${s.windows.length} window${s.windows.length > 1 ? "s" : ""} · saved ${ago(Date.now() - s.savedAt)} ago`));
    const sites = [...new Set(s.windows.flat().map((t) => hostOf(t.url)))].slice(0, 4).join(", ");
    info.append(el("div", "ssub", sites));
    const open = el("button", "", "Restore");
    open.addEventListener("click", () => restoreSession(s));
    const del = el("button", "plain", "Delete");
    del.addEventListener("click", () => chrome.storage.local.set({ sessions: sessions.filter((x) => x.id !== s.id) }));
    row.append(info, open, del);
    box.append(row);
  });
}

// ---------- live previews ----------
// Chrome can only screenshot the visible tab of each window, and allows ~2 shots a second,
// so "live" means: round-robin over every window's active tab, refreshing its tile in place.
function liveTargets() {
  return wins.filter((w) => w.state !== "minimized")
    .map((w) => w.tabs.find((t) => t.active))
    .filter((t) => t && savable(t));
}

async function liveTick() {
  clearTimeout(liveTimer);
  if (!live || !thumbsOn) return;
  if (!document.hidden && !sweeping) {
    const targets = liveTargets();
    if (targets.length) {
      const t = targets[liveIdx++ % targets.length];
      try { await chrome.runtime.sendMessage({ type: "capture", tabId: t.id, windowId: t.windowId }); } catch {}
    }
  }
  liveTimer = setTimeout(liveTick, 550);
}

// Thumbnail writes update the image in place; anything else reloads the board.
function onStorage(changes) {
  const keys = Object.keys(changes);
  if (keys.length && keys.every((k) => k.startsWith("thumb:"))) {
    for (const k of keys) {
      const id = k.slice(6), url = changes[k].newValue;
      if (!url) { delete thumbs[id]; continue; }
      thumbs[id] = url;
      const img = document.querySelector(`.tile[data-id="${id}"] img.thumb`);
      if (img) img.src = url;
      else if (thumbsOn) refresh();
    }
  } else refresh();
}

// ---------- capture sweep ----------
async function sweep() {
  if (sweeping) { sweeping = false; return; }
  const todo = tabs.filter((t) => !thumbs[t.id] && /^(https?|file):/.test(t.url));
  if (!todo.length) { toast("Every tab already has a preview"); return; }
  sweeping = true;
  const here = await chrome.tabs.getCurrent();
  const prevActive = wins.map((w) => ({ windowId: w.id, tabId: w.tabs.find((t) => t.active)?.id }));
  let done = 0;
  for (const t of todo) {
    if (!sweeping) break;
    $("sweepbtn").textContent = `⏹ Stop (${done}/${todo.length})`;
    try {
      await chrome.tabs.update(t.id, { active: true });
      for (let i = 0; i < 20; i++) { if ((await chrome.tabs.get(t.id)).status === "complete") break; await new Promise((r) => setTimeout(r, 250)); }
      await new Promise((r) => setTimeout(r, 500));
      await chrome.runtime.sendMessage({ type: "capture", tabId: t.id, windowId: t.windowId });
    } catch {}
    done++;
  }
  for (const p of prevActive) if (p.tabId) { try { await chrome.tabs.update(p.tabId, { active: true }); } catch {} }
  try { await chrome.tabs.update(here.id, { active: true }); await chrome.windows.update(here.windowId, { focused: true }); } catch {}
  sweeping = false;
  $("sweepbtn").textContent = "📸 Capture previews";
  toast(`Captured previews for ${done} tab${done > 1 ? "s" : ""}`);
}

// ---------- keyboard cursor ----------
function moveFocus(dir) {
  if (!order.length) return;
  let i = order.indexOf(focusId);
  if (i < 0) i = 0;
  else {
    const perRow = document.body.classList.contains("thumbs") ? (thumbSize === "3x3" ? 3 : +thumbSize) : 1;
    const step = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? -perRow : perRow;
    i = Math.min(order.length - 1, Math.max(0, i + step));
  }
  focusId = order[i];
  render();
  document.querySelector(".tile.kfocus")?.scrollIntoView({ block: "nearest" });
}

async function load() {
  const s = await chrome.storage.local.get(["openedAt", "kept", "sessions"]);
  sessions = s.sessions || [];
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
  liveTick();
});
document.querySelectorAll("#thumbsize button").forEach((b) => b.addEventListener("click", () => {
  thumbSize = b.dataset.size;
  localStorage.setItem("thumbsize", thumbSize);
  render();
}));
$("search").addEventListener("input", render);
$("selclose").addEventListener("click", () => closeTabs([...selected]));
$("selclear").addEventListener("click", () => { selected.clear(); render(); });
$("selall").addEventListener("click", () => { order.forEach((id) => selected.add(id)); render(); });
$("moveto").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v) moveTabs([...selected], v === "new" ? v : +v);
});
$("undo").addEventListener("click", undoLast);
$("sweepbtn").addEventListener("click", sweep);
$("livebtn").addEventListener("click", () => {
  live = !live;
  localStorage.setItem("live", live ? "1" : "0");
  liveTick();
  render();
});
$("sessbtn").addEventListener("click", () => { $("sessions").showModal(); renderSessions(); });
$("sessx").addEventListener("click", () => $("sessions").close());
$("sessions").addEventListener("click", (e) => { if (e.target === $("sessions")) $("sessions").close(); });
$("sesssave").addEventListener("click", async () => {
  const sc = $("sessscope").value;
  const list = sc === "sel" ? tabs.filter((t) => selected.has(t.id)) : sc === "all" ? tabs : tabs.filter((t) => t.windowId === +sc);
  const close = $("sessclose").checked;
  await saveSession(list, $("sessname").value.trim(), close);
  $("sessname").value = "";
  if (close) $("sessions").close();
});
$("selsave").addEventListener("click", () => saveSession(tabs.filter((t) => selected.has(t.id)), "", true));

document.addEventListener("keydown", (e) => {
  const typing = document.activeElement === $("search") || document.activeElement?.closest("dialog");
  if (typing && document.activeElement.closest("dialog")) return;
  if (e.key === "/" && !typing) { e.preventDefault(); $("search").focus(); }
  else if (e.key === "Escape") {
    if (typing && $("search").value) { $("search").value = ""; render(); }
    else { selected.clear(); winFilter.clear(); $("search").blur(); render(); }
  } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && selected.size) { e.preventDefault(); closeTabs([...selected]); }
  else if (!typing && (e.ctrlKey || e.metaKey) && e.key === "a") { e.preventDefault(); order.forEach((id) => selected.add(id)); render(); }
  else if (!typing && !e.ctrlKey && !e.metaKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); moveFocus(e.key.slice(5).toLowerCase()); }
  else if (!typing && !e.ctrlKey && !e.metaKey && e.key === " " && focusId !== null) { e.preventDefault(); toggle(focusId); render(); }
  else if (!typing && e.key === "Enter" && focusId !== null) {
    const t = tabs.find((x) => x.id === focusId);
    if (t) { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); }
  }
  else if (!typing && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "x" && (selected.size || focusId !== null)) {
    const ids = selected.size ? [...selected] : [focusId];
    const i = order.indexOf(focusId);
    closeTabs(ids);
    focusId = order.filter((id) => !ids.includes(id))[Math.min(i, order.length - ids.length - 1)] ?? null;
  }
  else if (!typing && (e.ctrlKey || e.metaKey) && e.key === "z" && undoInfo) { e.preventDefault(); undoLast(); }
});

[chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
 chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated,
 chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged,
 ].forEach((ev) => ev.addListener(refresh));
chrome.storage.onChanged.addListener(onStorage);
setInterval(refresh, 30000); // keep durations ticking
load();
liveTick();
