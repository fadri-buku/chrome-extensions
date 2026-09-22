// Mirrors pinned items into real Chrome bookmarks, under one root folder.
// This is a persistence layer independent of chrome.storage.sync: bookmarks
// have their own (much larger-quota) native sync, show up in Chrome's
// Bookmark Manager, and are even visible on Chrome mobile, which can't run
// extensions at all. It's one-way (pinned item -> bookmark); edits made
// directly in the Bookmark Manager are not read back into the pinned item.

const ROOT_TITLE = "Tab Sync for All";

let rootFolderIdCache = null;

async function getOtherBookmarksParentId() {
  // '2' is the stable id for "Other Bookmarks" on desktop Chrome, '1' for
  // the Bookmarks Bar. Try both before falling back to whatever the tree
  // actually reports, in case a Chromium variant differs.
  for (const id of ["2", "1"]) {
    try {
      await chrome.bookmarks.get(id);
      return id;
    } catch (err) {
      // try the next candidate
    }
  }
  const tree = await chrome.bookmarks.getTree();
  return tree[0]?.children?.[0]?.id;
}

async function getOrCreateRootFolderId() {
  if (rootFolderIdCache) {
    try {
      await chrome.bookmarks.get(rootFolderIdCache);
      return rootFolderIdCache;
    } catch (err) {
      rootFolderIdCache = null;
    }
  }
  const results = await chrome.bookmarks.search({ title: ROOT_TITLE });
  const existing = results.find((n) => !n.url);
  if (existing) {
    rootFolderIdCache = existing.id;
    return existing.id;
  }
  const parentId = await getOtherBookmarksParentId();
  const created = await chrome.bookmarks.create({ parentId, title: ROOT_TITLE });
  rootFolderIdCache = created.id;
  return created.id;
}

async function ensureFolder(item, rootId) {
  const title = item.title || "(unnamed group)";
  if (item.bookmarkFolderId) {
    try {
      const [node] = await chrome.bookmarks.get(item.bookmarkFolderId);
      if (node.title !== title) await chrome.bookmarks.update(item.bookmarkFolderId, { title });
      return item.bookmarkFolderId;
    } catch (err) {
      // The user deleted the folder — fall through and recreate it.
    }
  }
  const created = await chrome.bookmarks.create({ parentId: rootId, title });
  return created.id;
}

async function syncGroupBookmark(item, rootId) {
  const folderId = await ensureFolder(item, rootId);
  const children = await chrome.bookmarks.getChildren(folderId);
  const byUrl = new Map(children.map((c) => [c.url, c]));
  const wantedUrls = new Set(item.tabs.map((t) => t.url));

  for (const t of item.tabs) {
    const existing = byUrl.get(t.url);
    if (!existing) {
      await chrome.bookmarks.create({ parentId: folderId, title: t.title || t.url, url: t.url });
    } else if (t.title && existing.title !== t.title) {
      await chrome.bookmarks.update(existing.id, { title: t.title });
    }
  }
  for (const child of children) {
    if (child.url && !wantedUrls.has(child.url)) {
      await chrome.bookmarks.remove(child.id).catch(() => {});
    }
  }
  return { bookmarkFolderId: folderId };
}

async function syncSoloTabBookmark(item, rootId) {
  const t = item.tabs[0];
  if (!t) return {};
  const title = item.title || t.title || t.url;
  if (item.bookmarkId) {
    try {
      await chrome.bookmarks.update(item.bookmarkId, { title, url: t.url });
      return { bookmarkId: item.bookmarkId };
    } catch (err) {
      // The user deleted the bookmark — fall through and recreate it.
    }
  }
  const created = await chrome.bookmarks.create({ parentId: rootId, title, url: t.url });
  return { bookmarkId: created.id };
}

// Creates/updates the bookmark(s) mirroring this pinned item's current
// tabs, reusing the previously-created folder/bookmark id when possible.
// Returns whichever id field(s) apply, to be merged back into the stored
// pinned record so future syncs reuse the same bookmark(s).
export async function syncItemBookmark(item) {
  const rootId = await getOrCreateRootFolderId();
  return item.kind === "tab" ? syncSoloTabBookmark(item, rootId) : syncGroupBookmark(item, rootId);
}

export async function removeItemBookmark(item) {
  const id = item.kind === "tab" ? item.bookmarkId : item.bookmarkFolderId;
  if (!id) return;
  try {
    if (item.kind === "tab") await chrome.bookmarks.remove(id);
    else await chrome.bookmarks.removeTree(id);
  } catch (err) {
    // Already gone — nothing to do.
  }
}
