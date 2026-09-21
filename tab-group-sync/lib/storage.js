// Persistence layer. Pinned groups and custom titles are written to
// chrome.storage.sync first (so they follow the signed-in Chrome profile to
// other devices) and fall back to chrome.storage.local only when a write
// trips sync's quota (QUOTA_BYTES_PER_ITEM ~8KB, QUOTA_BYTES ~100KB total).
// A "live" mapping of pinned-group-id -> currently-open tabGroup id lives in
// chrome.storage.session, which is shared between background and side panel
// but cleared automatically when the browser closes.

const PIN_PREFIX = "pin:";
const TITLES_KEY = "customTitles";
const LIVE_MAP_KEY = "liveMap";

export async function getAllPinnedGroups() {
  const [syncItems, localItems] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(null),
  ]);
  const merged = new Map();
  for (const [key, value] of Object.entries(localItems)) {
    if (key.startsWith(PIN_PREFIX)) {
      merged.set(key.slice(PIN_PREFIX.length), { ...value, storageArea: "local" });
    }
  }
  // Sync wins over a stale local fallback copy of the same id.
  for (const [key, value] of Object.entries(syncItems)) {
    if (key.startsWith(PIN_PREFIX)) {
      merged.set(key.slice(PIN_PREFIX.length), { ...value, storageArea: "sync" });
    }
  }
  return [...merged.values()];
}

export async function savePinnedGroup(group) {
  const key = PIN_PREFIX + group.id;
  const record = {
    id: group.id,
    title: group.title || "",
    color: group.color || "grey",
    collapsed: !!group.collapsed,
    tabs: group.tabs || [],
    updatedAt: Date.now(),
  };
  try {
    await chrome.storage.sync.set({ [key]: record });
    await chrome.storage.local.remove(key);
    return "sync";
  } catch (err) {
    await chrome.storage.local.set({ [key]: record });
    return "local";
  }
}

export async function deletePinnedGroup(id) {
  const key = PIN_PREFIX + id;
  await Promise.allSettled([
    chrome.storage.sync.remove(key),
    chrome.storage.local.remove(key),
  ]);
}

export async function getCustomTitles() {
  const [syncRes, localRes] = await Promise.all([
    chrome.storage.sync.get(TITLES_KEY),
    chrome.storage.local.get(TITLES_KEY),
  ]);
  return { ...(localRes[TITLES_KEY] || {}), ...(syncRes[TITLES_KEY] || {}) };
}

async function writeCustomTitles(map) {
  try {
    await chrome.storage.sync.set({ [TITLES_KEY]: map });
    await chrome.storage.local.remove(TITLES_KEY);
    return "sync";
  } catch (err) {
    await chrome.storage.local.set({ [TITLES_KEY]: map });
    return "local";
  }
}

export async function setCustomTitle(url, title) {
  const all = await getCustomTitles();
  all[url] = title;
  return writeCustomTitles(all);
}

export async function clearCustomTitle(url) {
  const all = await getCustomTitles();
  delete all[url];
  return writeCustomTitles(all);
}

export async function getLiveMap() {
  const res = await chrome.storage.session.get(LIVE_MAP_KEY);
  return res[LIVE_MAP_KEY] || {};
}

export async function setLiveMapEntry(pinnedId, chromeGroupId) {
  const map = await getLiveMap();
  map[pinnedId] = chromeGroupId;
  await chrome.storage.session.set({ [LIVE_MAP_KEY]: map });
}

export async function removeLiveMapEntry(pinnedId) {
  const map = await getLiveMap();
  delete map[pinnedId];
  await chrome.storage.session.set({ [LIVE_MAP_KEY]: map });
}

export async function removeLiveMapEntryByGroupId(chromeGroupId) {
  const map = await getLiveMap();
  let changed = false;
  for (const [pinnedId, groupId] of Object.entries(map)) {
    if (groupId === chromeGroupId) {
      delete map[pinnedId];
      changed = true;
    }
  }
  if (changed) await chrome.storage.session.set({ [LIVE_MAP_KEY]: map });
}
