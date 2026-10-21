// Git-log style view: each window is a lane, each tab a commit (newest first).
const LANE_W = 30, ROW_H = 44, PAD = 24, HEAD_H = 56;
const COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#12b5cb", "#c26401", "#e52592"];
const SVGNS = "http://www.w3.org/2000/svg";

function svg(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.append(n);
  return n;
}

function renderGraph(wins, openedAt, query, { ago }) {
  const laneOf = new Map(wins.map((w, i) => [w.id, i]));
  const laneX = (i) => PAD + i * LANE_W;
  const q = query.toLowerCase();

  // One row per tab, newest first. Tabs with no record sort to the bottom.
  const rows = wins.flatMap((w, lane) => w.tabs.map((tab) => ({ tab, lane, win: w, rec: openedAt[tab.id] })))
    .sort((a, b) => (b.rec?.t ?? 0) - (a.rec?.t ?? 0));
  const urlCount = {};
  rows.forEach((r) => { urlCount[r.tab.url] = (urlCount[r.tab.url] || 0) + 1; });
  const matches = (r) => !q || `${r.tab.title} ${r.tab.url}`.toLowerCase().includes(q);

  const root = document.createElement("div");
  root.className = "graph";
  const graphW = PAD * 2 + Math.max(0, wins.length - 1) * LANE_W;
  const height = HEAD_H + rows.length * ROW_H + 12;
  const rowY = (i) => HEAD_H + i * ROW_H + ROW_H / 2;

  const s = svg("svg", { width: graphW, height, class: "gsvg" });
  const hl = (lane) => {
    root.querySelectorAll("[data-lane]").forEach((n) => n.classList.toggle("dim", lane !== null && +n.dataset.lane !== lane));
  };

  // Lane lines + headers (headers click to focus the window; lanes accept drops).
  wins.forEach((w, i) => {
    const x = laneX(i), color = COLORS[i % COLORS.length];
    const idx = rows.map((r, n) => (r.lane === i ? n : -1)).filter((n) => n >= 0);
    const g = svg("g", { "data-lane": i }, s);
    const drop = svg("rect", { x: x - LANE_W / 2, y: HEAD_H - 8, width: LANE_W, height: height - HEAD_H + 8, class: "lane-drop", fill: "transparent" }, g);
    drop.addEventListener("dragover", (e) => { if (root.dragTab) { e.preventDefault(); drop.classList.add("over"); } });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      if (root.dragTab) chrome.tabs.move(root.dragTab, { windowId: w.id, index: -1 });
    });
    if (idx.length) svg("line", { x1: x, x2: x, y1: HEAD_H - 4, y2: rowY(idx[idx.length - 1]), stroke: color, "stroke-width": 3, "stroke-linecap": "round", opacity: 0.85 }, g);
    const label = svg("g", { class: "lane-label", transform: `translate(${x},${HEAD_H - 24})` }, g);
    svg("circle", { r: 11, fill: color }, label);
    const t = svg("text", { "text-anchor": "middle", dy: 4, fill: "#fff", "font-size": 11, "font-weight": 600 }, label);
    t.textContent = `W${i + 1}`;
    svg("title", {}, label).textContent = `Window ${i + 1}: ${w.tabs.length} tabs${w.incognito ? " (incognito)" : ""} — click to focus`;
    label.addEventListener("click", () => chrome.windows.update(w.id, { focused: true }));
    if (w.focused) svg("circle", { r: 14, fill: "none", stroke: color, "stroke-width": 2 }, label);
  });

  // Dashed curve for tabs moved away from the window they were opened in.
  rows.forEach((r, n) => {
    const from = laneOf.get(r.rec?.w);
    if (from === undefined || from === r.lane) return;
    const x1 = laneX(from), x2 = laneX(r.lane), y = rowY(n);
    const c = svg("g", { "data-lane": r.lane, class: "moved" }, s);
    svg("path", { d: `M${x1} ${y} C${x1} ${y - 18} ${x2} ${y - 18} ${x2} ${y}`, fill: "none", stroke: COLORS[from % COLORS.length], "stroke-width": 2, "stroke-dasharray": "4 3" }, c);
    svg("circle", { cx: x1, cy: y, r: 4, fill: "var(--card)", stroke: COLORS[from % COLORS.length], "stroke-width": 2 }, c);
  });

  // Commit dots.
  const dots = rows.map((r, n) => {
    const color = COLORS[r.lane % COLORS.length];
    const g = svg("g", { "data-lane": r.lane, "data-row": n, opacity: matches(r) ? 1 : 0.2 }, s);
    svg("circle", { cx: laneX(r.lane), cy: rowY(n), r: r.tab.active ? 8 : 6, fill: r.tab.pinned ? color : "var(--card)", stroke: color, "stroke-width": 3 }, g);
    if (r.tab.active) svg("circle", { cx: laneX(r.lane), cy: rowY(n), r: 3, fill: color }, g);
    return g;
  });

  // Text column, one row per commit, aligned to the SVG by fixed row height.
  const list = document.createElement("ol");
  list.className = "glist";
  list.style.paddingTop = `${HEAD_H}px`;
  rows.forEach((r, n) => {
    const li = document.createElement("li");
    li.className = "grow" + (matches(r) ? "" : " faded");
    li.style.height = `${ROW_H}px`;
    li.draggable = true;
    li.dataset.lane = r.lane;
    li.style.setProperty("--lane", COLORS[r.lane % COLORS.length]);
    const o = r.rec;
    const age = [o && `open ${o.approx ? "≥" : ""}${ago(Date.now() - o.t)}`,
      r.tab.lastAccessed && !r.tab.active && `used ${ago(Date.now() - r.tab.lastAccessed)} ago`].filter(Boolean).join(" · ");
    const host = (() => { try { return new URL(r.tab.url).host; } catch { return r.tab.url; } })();
    const flags = [r.tab.pinned && "📌", r.tab.audible && "🔊", r.tab.discarded && "💤", urlCount[r.tab.url] > 1 && "⧉ dup"].filter(Boolean).join(" ");
    li.innerHTML = `<div class="gmeta"><div class="title"></div><div class="host"></div></div><span class="flags"></span><button class="btn close" title="Close tab">✕</button>`;
    li.querySelector(".title").textContent = r.tab.title || r.tab.url;
    li.querySelector(".host").textContent = `${host}${age ? " · " + age : ""}`;
    li.querySelector(".flags").textContent = flags;
    li.addEventListener("mouseenter", () => { hl(r.lane); dots[n].classList.add("hot"); });
    li.addEventListener("mouseleave", () => { hl(null); dots[n].classList.remove("hot"); });
    li.addEventListener("click", async () => {
      await chrome.tabs.update(r.tab.id, { active: true });
      await chrome.windows.update(r.tab.windowId, { focused: true });
    });
    li.querySelector(".close").addEventListener("click", (e) => { e.stopPropagation(); chrome.tabs.remove(r.tab.id); });
    li.addEventListener("dragstart", () => { root.dragTab = r.tab.id; dragTabId = r.tab.id; });
    li.addEventListener("dragend", () => { root.dragTab = null; dragTabId = null; });
    list.append(li);
  });

  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No tabs";
    return e;
  }
  root.append(s, list);
  return root;
}
