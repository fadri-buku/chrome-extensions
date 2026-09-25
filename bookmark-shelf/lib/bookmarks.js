// Thin wrapper around chrome.bookmarks: everything the extension manages
// lives under one root folder, with categories as its direct child folders
// and items as bookmarks inside those. Being real chrome.bookmarks, all of
// it rides Chrome's own bookmark sync (tied to the signed-in Google
// account) with no extra storage or network layer of our own.

const ROOT_TITLE = "Bookmark Shelf";

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

export async function getOrCreateRootFolderId() {
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

export async function listCategories() {
  const rootId = await getOrCreateRootFolderId();
  const children = await chrome.bookmarks.getChildren(rootId);
  const folders = children.filter((c) => !c.url);
  return Promise.all(
    folders.map(async (f) => {
      const items = await chrome.bookmarks.getChildren(f.id);
      return { id: f.id, title: f.title, count: items.filter((i) => i.url).length };
    })
  );
}

export async function createCategory(title) {
  const rootId = await getOrCreateRootFolderId();
  const created = await chrome.bookmarks.create({ parentId: rootId, title: title.trim() });
  return { id: created.id, title: created.title, count: 0 };
}

export async function renameCategory(categoryId, title) {
  await chrome.bookmarks.update(categoryId, { title: title.trim() });
}

export async function deleteCategory(categoryId) {
  await chrome.bookmarks.removeTree(categoryId);
}

export async function listItems(categoryId) {
  const children = await chrome.bookmarks.getChildren(categoryId);
  return children
    .filter((c) => c.url)
    .map((c) => ({ id: c.id, title: c.title || c.url, url: c.url }));
}

function normalizeUrl(url) {
  const trimmed = url.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function addItem(categoryId, title, url) {
  const normalizedUrl = normalizeUrl(url);
  const created = await chrome.bookmarks.create({
    parentId: categoryId,
    title: title.trim() || normalizedUrl,
    url: normalizedUrl,
  });
  return { id: created.id, title: created.title, url: created.url };
}

export async function updateItem(itemId, { title, url }) {
  await chrome.bookmarks.update(itemId, { title: title.trim(), url: normalizeUrl(url) });
}

export async function deleteItem(itemId) {
  await chrome.bookmarks.remove(itemId);
}

export async function moveItem(itemId, targetCategoryId) {
  await chrome.bookmarks.move(itemId, { parentId: targetCategoryId });
}

// Searches every item under the root folder (across all categories) by
// substring match on title or URL, returning each match alongside its
// parent category id so the UI can jump to it.
export async function searchItems(query) {
  const rootId = await getOrCreateRootFolderId();
  const categories = await chrome.bookmarks.getChildren(rootId);
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results = [];
  for (const category of categories) {
    if (category.url) continue;
    const items = await chrome.bookmarks.getChildren(category.id);
    for (const item of items) {
      if (!item.url) continue;
      if (item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)) {
        results.push({
          id: item.id,
          title: item.title || item.url,
          url: item.url,
          categoryId: category.id,
          categoryTitle: category.title,
        });
      }
    }
  }
  return results;
}
