const PAGE = chrome.runtime.getURL("overview/overview.html");
const KEY = "openedAt"; // { [tabId]: { t: epoch ms, approx: bool } }

// Serialize read-modify-write so concurrent tab events don't clobber each other.
let queue = Promise.resolve();
function update(fn) {
  queue = queue.then(async () => {
    const data = (await chrome.storage.local.get(KEY))[KEY] || {};
    fn(data);
    await chrome.storage.local.set({ [KEY]: data });
  }).catch(console.error);
  return queue;
}

// Chrome doesn't expose a tab's creation time, so tabs that already existed when
// tracking began (install, or a browser restart that changed tab IDs) get "now"
// flagged approx — the true age is at least this long.
async function reconcileAll() {
  const tabs = await chrome.tabs.query({});
  const live = new Set(tabs.map((t) => String(t.id)));
  const stale = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("thumb:") && !live.has(k.slice(6)));
  if (stale.length) await chrome.storage.local.remove(stale);
  tabs.filter((t) => t.active).forEach((t) => scheduleThumb(t.id, t.windowId));
  await update((data) => {
    for (const id of Object.keys(data)) if (!live.has(id)) delete data[id];
    for (const t of tabs) if (!data[t.id]) data[t.id] = { t: Date.now(), approx: true, w: t.windowId };
  });
}

chrome.runtime.onInstalled.addListener(reconcileAll);
chrome.runtime.onStartup.addListener(reconcileAll);
chrome.tabs.onCreated.addListener((tab) => update((d) => { d[tab.id] = { t: Date.now(), approx: false, w: tab.windowId }; }));
chrome.tabs.onRemoved.addListener((id) => update((d) => { delete d[id]; }));
chrome.tabs.onReplaced.addListener((added, removed) => update((d) => {
  d[added] = d[removed] || { t: Date.now(), approx: true };
  delete d[removed];
}));

// ---- Thumbnails ----
// storage.local["thumb:<tabId>"]: small JPEG data URL of the tab's last visible state.
// Chrome can only screenshot the visible tab of a window, so we capture when a tab is
// activated or finishes loading while active.
const thumbTimers = {};
function scheduleThumb(tabId, windowId) {
  clearTimeout(thumbTimers[tabId]);
  thumbTimers[tabId] = setTimeout(() => captureThumb(tabId, windowId), 700);
}

async function captureThumb(tabId, windowId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || tab.windowId !== windowId || tab.url.startsWith("chrome-extension://")) return;
    const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 60 });
    const bmp = await createImageBitmap(await (await fetch(shot)).blob());
    const w = 320, h = Math.round((bmp.height / bmp.width) * w);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 });
    const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    await chrome.storage.local.set({ [`thumb:${tabId}`]: url });
  } catch {} // restricted pages (chrome://, web store), minimized windows, closed tabs
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => scheduleThumb(tabId, windowId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === "complete" && tab.active) scheduleThumb(tabId, tab.windowId); });
chrome.tabs.onRemoved.addListener((id) => chrome.storage.local.remove(`thumb:${id}`));

// ---- Snoozed tabs (created by the triage game) ----
// storage.local.snoozed: [{ id, url, title, wakeAt }]; one alarm per entry named "snooze:<id>".
async function wake(id) {
  const { snoozed = [] } = await chrome.storage.local.get("snoozed");
  const s = snoozed.find((x) => x.id === id);
  if (!s) return;
  await chrome.storage.local.set({ snoozed: snoozed.filter((x) => x.id !== id) });
  try { await chrome.tabs.create({ url: s.url, active: false }); }
  catch { await chrome.windows.create({ url: s.url }); }
}

// Alarms can be lost across restarts: wake anything overdue and re-arm the rest.
async function sweepSnoozed() {
  const { snoozed = [] } = await chrome.storage.local.get("snoozed");
  for (const s of snoozed) {
    if (s.wakeAt <= Date.now()) await wake(s.id);
    else chrome.alarms.create(`snooze:${s.id}`, { when: s.wakeAt });
  }
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name.startsWith("snooze:")) wake(a.name.slice(7)); });
chrome.runtime.onInstalled.addListener(sweepSnoozed);
chrome.runtime.onStartup.addListener(sweepSnoozed);

// Clicking the icon focuses an existing dashboard tab, or opens a new one.
chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.tabs.query({ url: PAGE });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PAGE });
  }
});
