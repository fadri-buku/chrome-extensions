const $ = (id) => document.getElementById(id);
const A = $("app");
const COLORS = ["#4f6bed", "#f08a24", "#2fa56b", "#a142f4", "#d93025", "#12b5cb", "#c26401", "#e52592"];
const BADGES = [
  { id: "spring", emoji: "🧹", name: "Spring Cleaner", desc: "Closed 5+ tabs in one session" },
  { id: "speed", emoji: "⚡", name: "Speed Reader", desc: "10+ tabs in under 60s" },
  { id: "fresh", emoji: "🌱", name: "Fresh Start", desc: "Nothing idle over 7 days" },
  { id: "zero", emoji: "👑", name: "Zero Debt", desc: "Tab debt at 0" },
];
const THRESHOLDS = [[60, "1 hour"], [1440, "1 day"], [4320, "3 days"], [10080, "7 days"]];
const BASE = { close: 10, snooze: 8, keep: 3 };

let phase = "start"; // start | play | done | snoozed
let wins = [], all = [], kept = {}, opened = {}, snoozed = [];
let game = { points: 0, days: [], badges: {} };
let queue = [], idx = 0, session = null, undoStack = [], busy = false;
let threshold = +localStorage.getItem("thr") || 1440;
let snoozeDays = +localStorage.getItem("snz") || 7;
let shownDebt = 0, newBadges = [];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hue = (s) => { let n = 0; for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 360; return n; };
const idle = (t) => idleMin(t, kept, opened);
const totalDebt = () => all.reduce((n, t) => n + debtOf(idle(t)), 0);
const winIndex = (id) => Math.max(0, wins.findIndex((w) => w.id === id));
const save = (obj) => chrome.storage.local.set(obj);

function note(msg) {
  $("note").textContent = msg;
  $("note").hidden = false;
  clearTimeout(note.t);
  note.t = setTimeout(() => ($("note").hidden = true), 3500);
}

async function load() {
  const s = await chrome.storage.local.get(["kept", "openedAt", "snoozed", "game"]);
  kept = s.kept || {};
  opened = s.openedAt || {};
  snoozed = s.snoozed || [];
  game = { points: 0, days: [], badges: {}, ...(s.game || {}) };
  wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  all = wins.flatMap((w) => w.tabs).filter(triageable);
  // drop stale "kept" entries for tabs that no longer exist
  const live = new Set(wins.flatMap((w) => w.tabs).map((t) => String(t.id)));
  Object.keys(kept).forEach((id) => { if (!live.has(id)) delete kept[id]; });
  header(true);
  render();
}

// ---------- header ----------
function header(instant) {
  const target = totalDebt();
  if (instant) shownDebt = target;
  const from = shownDebt, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / 600);
    shownDebt = Math.round(from + (target - from) * p);
    $("debt").textContent = shownDebt.toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  $("streak").textContent = streakOf(game.days);
  const l = levelOf(game.points);
  $("lvl").textContent = `Lv ${l.lv}`;
  $("lvlname").textContent = l.name;
}

// ---------- screens ----------
function render() {
  if (phase === "start") return renderStart();
  if (phase === "play") return renderPlay();
  if (phase === "done") return renderDone();
  renderSnoozed();
}

function eligible() {
  return all.filter((t) => !t.active && idle(t) >= threshold).sort((a, b) => idle(b) - idle(a));
}

function renderStart() {
  const list = eligible();
  const debt = list.reduce((n, t) => n + debtOf(idle(t)), 0);
  const opts = THRESHOLDS.map(([v, l]) => `<option value="${v}" ${v === threshold ? "selected" : ""}>${l}</option>`).join("");
  A.innerHTML = `<div class="center">
    ${list.length
      ? `<div class="kicker">READY WHEN YOU ARE</div><h2>${list.length} tab${list.length > 1 ? "s" : ""} to review</h2>
         <div class="cap">Together they carry <b style="color:var(--warn)">${debt.toLocaleString()}</b> tab debt. Keep, snooze or close each one.</div>
         <button class="go" id="start">Start triage</button>`
      : `<div class="kicker">ALL CLEAR 🌱</div><h2>No tabs idle that long</h2>
         <div class="cap">Nothing has been sitting for ${THRESHOLDS.find(([v]) => v === threshold)?.[1] || "that long"}. Try a lower threshold.</div>`}
    <div class="setrow">Review tabs idle for at least <select id="thr">${opts}</select></div>
    ${snoozed.length ? `<div class="row"><button class="link" id="seesnz">💤 ${snoozed.length} snoozed tab${snoozed.length > 1 ? "s" : ""} waiting</button></div>` : ""}
  </div>`;
  $("thr").onchange = (e) => { threshold = +e.target.value; localStorage.setItem("thr", threshold); renderStart(); };
  if (list.length) $("start").onclick = start;
  if (snoozed.length) $("seesnz").onclick = () => { phase = "snoozed"; render(); };
}

function start() {
  queue = eligible();
  idx = 0;
  undoStack = [];
  session = { startDebt: totalDebt(), closed: 0, snoozed: 0, kept: 0, reviewed: 0, t0: Date.now(), combo: 0, lastAt: 0, points: 0, lastPts: 0 };
  phase = "play";
  render();
}

function card(t, cls, extra = "") {
  const host = hostOf(t.url), wi = winIndex(t.windowId), m = idle(t), d = debtOf(m);
  const o = opened[t.id];
  const icon = t.favIconUrl
    ? `<img class="ico" src="${esc(t.favIconUrl)}" alt="">`
    : `<div class="ico" style="background:hsl(${hue(host)} 55% 48%)">${esc((host[0] || "?").toUpperCase())}</div>`;
  const same = all.filter((x) => hostOf(x.url) === host && x.id !== t.id).length;
  return `<div class="card ${cls}">${extra}
    <div class="site">${icon}<div><div class="h">${esc(host)}</div><div class="m">Window ${wi + 1}</div></div>
      <span class="wb" style="background:${COLORS[wi % COLORS.length]}">W${wi + 1}</span></div>
    <div class="title">${esc(t.title || t.url)}</div>
    <div class="url">${esc(t.url)}</div>
    <div class="facts">
      <div class="fact ${m > 10080 ? "hot" : ""}"><small>Idle</small><b>${ago(m * MIN)}</b></div>
      <div class="fact"><small>Open for</small><b>${o ? (o.approx ? "≥ " : "") + ago(Date.now() - o.t) : "?"}</b></div>
      <div class="fact"><small>Same site</small><b>${same} other tab${same === 1 ? "" : "s"}</b></div>
      <div class="fact"><small>Debt</small><b>+${d}</b></div>
    </div>
    <div class="cost">Acting on this pays down <b>${d}</b> debt</div>
    <button class="peek" id="peek">Open tab ↗</button></div>`;
}

function renderPlay() {
  if (idx >= queue.length) return finish();
  const t = queue[idx];
  const pct = Math.round((idx / queue.length) * 100);
  const combo = session.combo >= 2 ? `<div class="combo">×${Math.min(session.combo, 10)} combo<small>+${session.lastPts} pts</small></div>` : "";
  const snzOpts = [[1, "1 day"], [3, "3 days"], [7, "7 days"]].map(([v, l]) => `<option value="${v}" ${v === snoozeDays ? "selected" : ""}>${l}</option>`).join("");
  A.innerHTML = `
    <div class="meter"><span class="n">Reviewed</span><div class="bar"><i style="width:${pct}%"></i></div><span class="n"><b style="color:var(--text)">${idx}</b> / ${queue.length}</span></div>
    <div class="stage">
      ${queue[idx + 2] ? '<div class="card b3"></div>' : ""}${queue[idx + 1] ? '<div class="card b2"></div>' : ""}
      ${card(t, "front", combo)}
    </div>
    <div class="acts">
      <button class="act" data-act="keep">Keep<small><kbd>K</kbd> · resets idle timer</small></button>
      <button class="act" data-act="snooze">Snooze<small><kbd>S</kbd> · back in ${snoozeDays}d</small></button>
      <button class="act" data-act="close">Close<small><kbd>C</kbd> · +${BASE.close} pts</small></button>
    </div>
    <div class="row">Snooze for <select id="snz">${snzOpts}</select>
      <span>·</span><button class="link" id="skip"><kbd>Space</kbd> skip</button>
      <button class="link" id="undo" ${undoStack.length ? "" : "disabled"}><kbd>Z</kbd> undo</button>
      <button class="link" id="end">End session</button></div>`;
  A.querySelectorAll(".act").forEach((b) => (b.onclick = () => act(b.dataset.act)));
  $("snz").onchange = (e) => { snoozeDays = +e.target.value; localStorage.setItem("snz", snoozeDays); renderPlay(); };
  $("skip").onclick = skip;
  $("undo").onclick = undo;
  $("end").onclick = finish;
  $("peek").onclick = () => { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); };
}

const EXIT = { keep: "out-left", close: "out-right", snooze: "out-down" };

async function act(kind) {
  if (busy || phase !== "play" || idx >= queue.length) return;
  busy = true;
  const t = queue[idx];
  const debt = debtOf(idle(t));
  const prevKept = kept[t.id];
  let rec = null;
  try {
    if (kind === "close") await chrome.tabs.remove(t.id);
    else if (kind === "keep") { kept[t.id] = Date.now(); await save({ kept }); }
    else {
      rec = { id: `${t.id}-${Date.now()}`, url: t.url, title: t.title, wakeAt: Date.now() + snoozeDays * 86400000 };
      snoozed.push(rec);
      await save({ snoozed });
      chrome.alarms.create(`snooze:${rec.id}`, { when: rec.wakeAt });
      await chrome.tabs.remove(t.id);
    }
  } catch (e) {
    if (kind !== "close") { // close failing usually means the tab is already gone, which is fine
      busy = false;
      return note(`Couldn't ${kind} that tab: ${e.message}`);
    }
  }
  const now = Date.now();
  session.combo = session.lastAt && now - session.lastAt < 6000 ? session.combo + 1 : 1;
  session.lastAt = now;
  const pts = Math.round(BASE[kind] * (1 + (Math.min(session.combo, 10) - 1) * 0.25));
  session.points += pts;
  session.lastPts = pts;
  session.reviewed++;
  session[kind === "close" ? "closed" : kind === "snooze" ? "snoozed" : "kept"]++;
  if (kind !== "keep") all = all.filter((x) => x.id !== t.id);
  undoStack.push({ kind, tab: t, debt, pts, rec, prevKept, idleAt: idle(t) });

  const el = A.querySelector(".card.front");
  if (el) el.classList.add(EXIT[kind]);
  if (debt) {
    const f = document.createElement("div");
    f.className = "float";
    f.textContent = `−${debt} debt`;
    A.querySelector(".stage")?.append(f);
  }
  header();
  await new Promise((r) => setTimeout(r, 190));
  idx++;
  busy = false;
  renderPlay();
}

function skip() {
  if (busy || idx >= queue.length - 1) return note("That's the last one");
  queue.push(queue.splice(idx, 1)[0]);
  renderPlay();
}

async function undo() {
  const u = undoStack.pop();
  if (!u || busy) return;
  busy = true;
  let tab = u.tab;
  try {
    if (u.kind === "keep") {
      if (u.prevKept) kept[tab.id] = u.prevKept; else delete kept[tab.id];
      await save({ kept });
    } else {
      const live = new Set(wins.map((w) => w.id));
      const nt = await chrome.tabs.create({ url: tab.url, windowId: live.has(tab.windowId) ? tab.windowId : undefined, active: false });
      // the reopened tab is new, so remember how stale the original was
      tab = { ...tab, id: nt.id, windowId: nt.windowId, idleOverride: u.idleAt };
      all.push(tab);
      queue[queue.indexOf(u.tab)] = tab;
      if (u.rec) {
        snoozed = snoozed.filter((s) => s.id !== u.rec.id);
        chrome.alarms.clear(`snooze:${u.rec.id}`);
        await save({ snoozed });
      }
    }
  } catch (e) {
    busy = false;
    return note(`Couldn't undo: ${e.message}`);
  }
  session.points -= u.pts;
  session.reviewed--;
  session[u.kind === "close" ? "closed" : u.kind === "snooze" ? "snoozed" : "kept"]--;
  session.combo = 0;
  idx--;
  header();
  busy = false;
  renderPlay();
}

// ---------- end of session ----------
async function finish() {
  if (phase !== "play") return;
  phase = "done";
  newBadges = [];
  const debtNow = totalDebt();
  const secs = (Date.now() - session.t0) / 1000;
  const earned = {
    spring: session.closed >= 5,
    speed: session.reviewed >= 10 && secs < 60,
    fresh: session.reviewed > 0 && !all.some((t) => idle(t) > 10080),
    zero: session.reviewed > 0 && debtNow === 0,
  };
  for (const [id, ok] of Object.entries(earned)) {
    if (ok && !game.badges[id]) { game.badges[id] = Date.now(); newBadges.push(id); }
  }
  game.points += session.points;
  if (session.reviewed >= 5 || (session.reviewed > 0 && idx >= queue.length)) {
    const k = dayKey();
    if (!game.days.includes(k)) game.days.push(k);
  }
  game.days = game.days.slice(-60);
  await save({ game, kept });
  header();
  render();
  if (session.startDebt - debtNow > 0) confetti();
}

function renderDone() {
  const debtNow = totalDebt(), paid = session.startDebt - debtNow;
  const week = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { on: game.days.includes(dayKey(d)), label: d.toLocaleDateString("en", { weekday: "narrow" }), today: i === 6 };
  });
  const badges = BADGES.map((b) => {
    const has = !!game.badges[b.id], isNew = newBadges.includes(b.id);
    const sub = has ? b.desc + (isNew ? " · NEW" : "") : b.id === "zero" ? `Locked · ${debtNow.toLocaleString()} to go` : `Locked · ${b.desc}`;
    return `<div class="badge ${isNew ? "new" : has ? "" : "lock"}"><div class="e">${b.emoji}</div><b>${b.name}</b><small>${sub}</small></div>`;
  }).join("");
  A.innerHTML = `<div class="center">
    <div class="kicker">${idx >= queue.length ? "BOARD CLEARED 🎉" : "SESSION ENDED"}</div>
    <div class="big"><span class="from">${session.startDebt.toLocaleString()}</span><span class="to">${debtNow.toLocaleString()}</span></div>
    <div class="cap">${paid > 0 ? `Tab debt paid down by <b style="color:var(--text)">${paid.toLocaleString()}</b> · +${session.points} pts` : "No debt paid this time"}</div>
    <div class="stats">
      <div class="stat"><b>${session.reviewed}</b><small>tabs reviewed</small></div>
      <div class="stat"><b style="color:var(--bad)">${session.closed}</b><small>closed</small></div>
      <div class="stat"><b style="color:var(--accent)">${session.snoozed}</b><small>snoozed</small></div>
      <div class="stat"><b style="color:var(--good)">${session.kept}</b><small>kept</small></div>
    </div>
    <div class="badges">${badges}</div>
    <div class="week">${week.map((d) => `<div class="day ${d.on ? "on" : ""} ${d.today ? "today" : ""}">${d.label}</div>`).join("")}</div>
    <div class="cap">🔥 ${streakOf(game.days)}-day streak${game.days.includes(dayKey()) ? "" : " · review 5 tabs today to extend it"}</div>
    <div class="row">${snoozed.length ? '<button class="go" id="seesnz">Review snoozed tabs</button>' : ""}<button class="ghost" id="again">Triage again</button><a class="ghost" style="text-decoration:none" href="../overview/overview.html">Back to board</a></div>
  </div>`;
  if ($("seesnz")) $("seesnz").onclick = () => { phase = "snoozed"; render(); };
  $("again").onclick = async () => { phase = "start"; await load(); };
}

function confetti() {
  const box = $("confetti");
  const cols = ["#ff9d4d", "#3ddc97", "#7c8cff", "#ff5d7a", "#ffd24d"];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = cols[i % cols.length];
    p.style.animationDelay = Math.random() * 0.6 + "s";
    p.style.animationDuration = 1.8 + Math.random() * 1.2 + "s";
    box.append(p);
  }
  setTimeout(() => box.replaceChildren(), 3600);
}

// ---------- snoozed list ----------
function renderSnoozed() {
  const list = [...snoozed].sort((a, b) => a.wakeAt - b.wakeAt);
  A.innerHTML = `<div class="center"><div class="kicker">SNOOZED 💤</div><h2>${list.length} tab${list.length === 1 ? "" : "s"} coming back later</h2>
    <div class="snz">${list.map((s) => `<div class="snzrow"><div class="info"><div class="t">${esc(s.title || s.url)}</div>
      <div class="m">${esc(hostOf(s.url))} · returns in ${ago(Math.max(0, s.wakeAt - Date.now()))}</div></div>
      <button data-open="${esc(s.id)}">Reopen now</button><button data-del="${esc(s.id)}">Remove</button></div>`).join("") || '<div class="cap">Nothing snoozed.</div>'}</div>
    <div class="row"><button class="ghost" id="back">Back</button></div></div>`;
  $("back").onclick = () => { phase = "start"; render(); };
  A.querySelectorAll("[data-open]").forEach((b) => (b.onclick = async () => {
    const s = snoozed.find((x) => x.id === b.dataset.open);
    if (s) { await chrome.tabs.create({ url: s.url, active: false }); await drop(s.id); }
  }));
  A.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => drop(b.dataset.del)));
}

async function drop(id) {
  snoozed = snoozed.filter((s) => s.id !== id);
  chrome.alarms.clear(`snooze:${id}`);
  await save({ snoozed });
  renderSnoozed();
}

// ---------- keys ----------
document.addEventListener("keydown", (e) => {
  if (phase !== "play" || e.target.tagName === "SELECT" || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === "k" || e.key === "ArrowLeft") act("keep");
  else if (k === "c" || e.key === "ArrowRight") act("close");
  else if (k === "s" || e.key === "ArrowDown") act("snooze");
  else if (k === "z") undo();
  else if (e.key === " ") { e.preventDefault(); skip(); }
});

load();
