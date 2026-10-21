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
