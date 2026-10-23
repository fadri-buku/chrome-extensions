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
