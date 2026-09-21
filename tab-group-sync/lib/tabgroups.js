// Shared helpers for reading/restoring live browser tab groups, used by
// both the background service worker and the side panel.

import * as store from "./storage.js";

const REOPENABLE_URL = /^(https?|file|ftp):/;

export async function snapshotGroupTabs(chromeGroupId) {
  const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
  tabs.sort((a, b) => a.index - b.index);
  return tabs.map((t) => ({ url: t.url, title: t.title }));
}

export async function refreshLivePinnedGroup(pinnedId, chromeGroupId) {
  let group;
  try {
    group = await chrome.tabGroups.get(chromeGroupId);
  } catch (err) {
    // The group no longer exists (all its tabs were closed) — stop tracking
    // it as "live", but keep the pinned definition around for manual restore.
    await store.removeLiveMapEntry(pinnedId);
    return;
  }
  const tabs = await snapshotGroupTabs(chromeGroupId);
  if (tabs.length === 0) return; // avoid persisting a transient empty snapshot
  await store.savePinnedGroup({
    id: pinnedId,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    tabs,
  });
}

export async function refreshAllLivePinnedGroups() {
  const liveMap = await store.getLiveMap();
  await Promise.all(
    Object.entries(liveMap).map(([pinnedId, groupId]) =>
      refreshLivePinnedGroup(pinnedId, groupId)
    )
  );
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

export async function restorePinnedGroup(pinnedGroup, windowId) {
  const tabIds = [];
  for (const t of pinnedGroup.tabs) {
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
    title: pinnedGroup.title,
    color: pinnedGroup.color,
    collapsed: pinnedGroup.collapsed,
  });
  await store.setLiveMapEntry(pinnedGroup.id, chromeGroupId);
  return chromeGroupId;
}
