import * as store from "./lib/storage.js";
import * as tg from "./lib/tabgroups.js";
import * as windowLimit from "./lib/windowLimit.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Only normal, non-incognito windows count toward the configured cap.
chrome.windows.onCreated.addListener((win) => {
  if (win.type !== "normal" || win.incognito) return;
  windowLimit.enforceOnNewWindow(win);
});

// Keep pinned-and-currently-open groups' stored snapshot up to date even
// while the side panel is closed. Debounced so a burst of tab events (e.g.
// closing several tabs at once) only triggers one refresh.
let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    tg.refreshAllLivePinnedGroups();
  }, 400);
}

chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
chrome.tabGroups.onRemoved.addListener((group) => {
  store.removeLiveMapEntryByGroupId(group.id);
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
// For each pinned group: if a live group with the same title+color already
// exists (e.g. Chrome's own "continue where you left off" already restored
// it), adopt that instead of duplicating it; otherwise reopen its tabs.
chrome.runtime.onStartup.addListener(async () => {
  const pinnedGroups = await store.getAllPinnedGroups();
  if (pinnedGroups.length === 0) return;

  const liveGroups = await chrome.tabGroups.query({});
  const claimed = new Set();

  for (const pinned of pinnedGroups) {
    const match = liveGroups.find(
      (g) => !claimed.has(g.id) && g.title === pinned.title && g.color === pinned.color
    );
    if (match) {
      claimed.add(match.id);
      await store.setLiveMapEntry(pinned.id, match.id);
      await tg.refreshLivePinnedGroup(pinned.id, match.id);
    } else {
      const windowId = await tg.findWindowForRestore();
      await tg.restorePinnedGroup(pinned, windowId);
    }
  }
});
