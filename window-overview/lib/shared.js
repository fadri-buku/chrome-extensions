// Helpers shared by the board and the triage game (plain globals, loaded via <script>).
const MIN = 60000;

function hostOf(u) {
  try { return new URL(u).host || u; } catch { return u || ""; }
}

function ago(ms) {
  const m = Math.floor(ms / MIN);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Minutes since a tab was last used. `kept` (tabId -> ts) holds "Keep" decisions from
// triage, which reset a tab's idle timer without touching it.
function idleMin(t, kept = {}, opened = {}) {
  if (t.idleOverride !== undefined) return t.idleOverride;
  if (t.active) return 0;
  const last = Math.max(t.lastAccessed || 0, kept[t.id] || 0) || opened[t.id]?.t || Date.now();
  return Math.max(0, (Date.now() - last) / MIN);
}

// "Tab debt": grows with idle time (12/day, capped at 400), 0 for anything used in the last hour.
function debtOf(idle) {
  return idle < 60 ? 0 : Math.min(400, Math.round((idle / 1440) * 12));
}

// Tabs that count toward debt / appear in triage: not pinned, not playing audio, not our own pages.
function triageable(t) {
  return !t.pinned && !t.audible && !(t.url || "").startsWith("chrome-extension://");
}

function dayKey(d = new Date()) {
  return d.toLocaleDateString("en-CA");
}

// Consecutive days (ending today, or yesterday if today isn't done yet) with a recorded session.
function streakOf(days) {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const LEVELS = ["Tab Newbie", "Tab Tidier", "Tab Wrangler", "Tidy Tamer", "Tab Master", "Tab Zen"];
function levelOf(points) {
  const lv = Math.min(LEVELS.length, Math.floor(Math.sqrt(points / 40)) + 1);
  return { lv, name: LEVELS[lv - 1] };
}
