// Shared helpers for reading/restoring/protecting live pinned items (whole
// tab groups, or individual tabs), used by both the background service
// worker and the side panel.

import * as store from "./storage.js";

const REOPENABLE_URL = /^(https?|file|ftp):/;

export async function snapshotGroupTabs(chromeGroupId) {
  const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
  tabs.sort((a, b) => a.index - b.index);
  return tabs.map((t) => ({ url: t.url, title: t.title }));
}

export async function findWindowForRestore() {
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (wins.length > 0) {
    wins.sort((a, b) => b.id - a.id);
    return wins[0].id;
  }
  const created = await chrome.windows.create({});
  return created.id;
}

// Fully (re)opens a pinned item from its stored definition: a group's tabs
// reopened and re-grouped, or a solo tab's single URL. Used for browser
// startup restore, the panel's manual "Restore" button, and healing a
// force-pinned group that got completely closed.
export async function restorePinnedItem(pinned, windowId) {
  if (pinned.kind === "tab") {
    const t = pinned.tabs[0];
    if (!t || !REOPENABLE_URL.test(t.url)) return null;
    try {
      const tab = await chrome.tabs.create({ url: t.url, active: false, windowId });
      await store.setLiveMapEntry(pinned.id, { kind: "tab", id: tab.id });
      return { kind: "tab", id: tab.id };
    } catch (err) {
      return null;
    }
  }

  const tabIds = [];
  for (const t of pinned.tabs) {
    if (!t.url || !REOPENABLE_URL.test(t.url)) continue;
    try {
      const tab = await chrome.tabs.create({ url: t.url, active: false, windowId });
      tabIds.push(tab.id);
    } catch (err) {
      // Skip tabs the browser refuses to (re)open and keep going.
    }
  }
  if (tabIds.length === 0) return null;
  const chromeGroupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(chromeGroupId, {
    title: pinned.title,
    color: pinned.color,
    collapsed: pinned.collapsed,
  });
  await store.setLiveMapEntry(pinned.id, { kind: "group", id: chromeGroupId });
  return { kind: "group", id: chromeGroupId };
}

function notifyForcedRestore(name) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Force-pinned item reopened",
    message: `"${name}" is force-pinned — it was reopened automatically. Unpin it in the panel to close it for good.`,
  });
}

// Re-snapshots a normal (non-forced) pinned item's stored definition from
// its current live state, so pinning stays a live sync rather than a
// one-time snapshot.
async function refreshLiveSnapshot(existing, ref) {
  if (ref.kind === "group") {
    let group;
    try {
      group = await chrome.tabGroups.get(ref.id);
    } catch (err) {
      await store.removeLiveMapEntry(existing.id);
      return;
    }
    const tabs = await snapshotGroupTabs(ref.id);
    if (tabs.length === 0) return; // avoid persisting a transient empty snapshot
    await store.savePinnedItem({
      id: existing.id,
      kind: "group",
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      tabs,
      forced: false,
    });
  } else {
    let tab;
    try {
      tab = await chrome.tabs.get(ref.id);
    } catch (err) {
      await store.removeLiveMapEntry(existing.id);
      return;
    }
    await store.savePinnedItem({
      id: existing.id,
      kind: "tab",
      title: tab.title,
      tabs: [{ url: tab.url, title: tab.title }],
      forced: false,
    });
  }
}

// Heals a force-pinned item: reopens whatever part of it is missing rather
// than letting the stored definition shrink to match a deliberate close.
async function enforceForcedItem(existing, ref) {
  if (ref.kind === "tab") {
    try {
      await chrome.tabs.get(ref.id);
      return; // still open, nothing to do
    } catch (err) {
      // fall through to reopen it
    }
    const windowId = await findWindowForRestore();
    const restored = await restorePinnedItem(existing, windowId);
    if (restored) notifyForcedRestore(existing.title || existing.tabs[0]?.url || "tab");
    return;
  }

  let group;
  try {
    group = await chrome.tabGroups.get(ref.id);
  } catch (err) {
    group = null;
  }

  if (!group) {
    const windowId = await findWindowForRestore();
    const restored = await restorePinnedItem(existing, windowId);
    if (restored) notifyForcedRestore(existing.title || "Group");
    return;
  }

  const currentTabs = await chrome.tabs.query({ groupId: ref.id });
  const currentUrls = new Set(currentTabs.map((t) => t.url));
  const missing = existing.tabs.filter((t) => !currentUrls.has(t.url));
  if (missing.length === 0) return;

  const newTabIds = [];
  for (const t of missing) {
    if (!REOPENABLE_URL.test(t.url)) continue;
    try {
      const tab = await chrome.tabs.create({ url: t.url, active: false, windowId: group.windowId });
      newTabIds.push(tab.id);
    } catch (err) {
      // Skip tabs the browser refuses to reopen.
    }
  }
  if (newTabIds.length > 0) {
    await chrome.tabs.group({ tabIds: newTabIds, groupId: ref.id });
    notifyForcedRestore(existing.title || "Group");
  }
}

// Single entry point for the periodic live-sync pass: dispatches to either
// the normal live-snapshot refresh or the force-pin healing logic depending
// on the item's stored `forced` flag.
export async function syncLiveItem(pinnedId, ref) {
  const items = await store.getAllPinnedItems();
  const existing = items.find((p) => p.id === pinnedId);
  if (!existing) {
    await store.removeLiveMapEntry(pinnedId);
    return;
  }
  if (existing.forced) {
    await enforceForcedItem(existing, ref);
  } else {
    await refreshLiveSnapshot(existing, ref);
  }
}

export async function syncAllLiveItems() {
  const liveMap = await store.getLiveMap();
  await Promise.all(
    Object.entries(liveMap).map(([pinnedId, ref]) => (ref ? syncLiveItem(pinnedId, ref) : null))
  );
}
