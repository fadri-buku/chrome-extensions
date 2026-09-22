import * as store from "./lib/storage.js";
import * as tg from "./lib/tabgroups.js";
import * as windowLimit from "./lib/windowLimit.js";

const FORCED_URLS_KEY = "forcedUrls";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  recomputeForcedUrls();
});

// Only normal, non-incognito windows count toward the configured cap.
chrome.windows.onCreated.addListener((win) => {
  if (win.type !== "normal" || win.incognito) return;
  windowLimit.enforceOnNewWindow(win);
});

// The list of URLs currently protected by a force-pinned tab/group is kept
// in chrome.storage.local so the content script (a separate context) can
// read it without message-passing. Recomputed whenever a pinned item
// changes.
async function recomputeForcedUrls() {
  const items = await store.getAllPinnedItems();
  const urls = items.filter((i) => i.forced).flatMap((i) => i.tabs.map((t) => t.url));
  await chrome.storage.local.set({ [FORCED_URLS_KEY]: urls });
}

chrome.storage.onChanged.addListener((changes) => {
  if (Object.keys(changes).some((k) => k.startsWith("pin:"))) {
    recomputeForcedUrls();
  }
});

// Keep pinned-and-currently-open items' stored snapshot up to date even
// while the side panel is closed (or, for force-pinned items, heal them by
// reopening whatever got closed). Debounced so a burst of tab events (e.g.
// closing several tabs at once) only triggers one pass.
let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    tg.syncAllLiveItems();
  }, 400);
}

chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
chrome.tabGroups.onRemoved.addListener(async (group) => {
  const liveMap = await store.getLiveMap();
  const entry = Object.entries(liveMap).find(([, ref]) => ref?.kind === "group" && ref.id === group.id);
  if (!entry) return;
  const [pinnedId] = entry;
  const items = await store.getAllPinnedItems();
  const item = items.find((p) => p.id === pinnedId);
  if (item?.forced) {
    // Don't clear the mapping — let the debounced sync pass detect the
    // group is gone and reopen it from its last-known definition.
    scheduleRefresh();
    return;
  }
  await store.removeLiveMapEntry(pinnedId);
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if ("url" in changeInfo || "title" in changeInfo || "groupId" in changeInfo) {
    scheduleRefresh();
  }
});
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onMoved.addListener(scheduleRefresh);
chrome.tabs.onAttached.addListener(scheduleRefresh);
chrome.tabs.onDetached.addListener(scheduleRefresh);

// Runs once per actual browser cold start (not on extension install/reload).
// For each pinned item: if a live counterpart already exists (e.g. Chrome's
// own "continue where you left off" already restored it), adopt that
// instead of duplicating it; otherwise reopen it.
chrome.runtime.onStartup.addListener(async () => {
  recomputeForcedUrls();
  const pinnedItems = await store.getAllPinnedItems();
  if (pinnedItems.length === 0) return;

  const liveGroups = await chrome.tabGroups.query({});
  const claimedGroups = new Set();
  const allTabs = (await chrome.tabs.query({})) || [];
  const claimedTabs = new Set();

  for (const pinned of pinnedItems) {
    if (pinned.kind === "tab") {
      const t = pinned.tabs[0];
      const match = t && allTabs.find((tab) => !claimedTabs.has(tab.id) && tab.url === t.url);
      if (match) {
        claimedTabs.add(match.id);
        await store.setLiveMapEntry(pinned.id, { kind: "tab", id: match.id });
        await tg.syncLiveItem(pinned.id, { kind: "tab", id: match.id });
      } else {
        const windowId = await tg.findWindowForRestore();
        await tg.restorePinnedItem(pinned, windowId);
      }
      continue;
    }

    const match = liveGroups.find(
      (g) => !claimedGroups.has(g.id) && g.title === pinned.title && g.color === pinned.color
    );
    if (match) {
      claimedGroups.add(match.id);
      await store.setLiveMapEntry(pinned.id, { kind: "group", id: match.id });
      await tg.syncLiveItem(pinned.id, { kind: "group", id: match.id });
    } else {
      const windowId = await tg.findWindowForRestore();
      await tg.restorePinnedItem(pinned, windowId);
    }
  }
});
