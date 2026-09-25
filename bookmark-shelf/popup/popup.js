import * as store from "../lib/bookmarks.js";

const $ = (id) => document.getElementById(id);

const searchInput = $("search-input");
const searchResultsEl = $("search-results");
const categoriesView = $("categories-view");
const categoriesListEl = $("categories-list");
const categoriesEmptyEl = $("categories-empty");
const addCategoryForm = $("add-category-form");
const newCategoryInput = $("new-category-input");
const categoryView = $("category-view");
const categoryTitleEl = $("category-title");
const backBtn = $("back-btn");
const renameCategoryBtn = $("rename-category-btn");
const deleteCategoryBtn = $("delete-category-btn");
const itemForm = $("item-form");
const itemTitleInput = $("item-title-input");
const itemUrlInput = $("item-url-input");
const useCurrentTabBtn = $("use-current-tab-btn");
const cancelEditBtn = $("cancel-edit-btn");
const saveItemBtn = $("save-item-btn");
const itemsListEl = $("items-list");
const itemsEmptyEl = $("items-empty");
const qrOverlay = $("qr-overlay");
const qrCanvas = $("qr-canvas");
const qrTitleEl = $("qr-title");
const qrUrlEl = $("qr-url");
const qrCloseBtn = $("qr-close-btn");
const qrDownloadBtn = $("qr-download-btn");

let currentCategory = null; // { id, title }
let editingItemId = null;
let pendingDelete = null; // { type: 'category' | 'item', id }
let renamingCategoryId = null;
let currentTab = null; // { title, url } of the tab the popup was opened from

function iconButton(label, ariaLabel, onClick, extraClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn" + (extraClass ? ` ${extraClass}` : "");
  btn.textContent = label;
  btn.setAttribute("aria-label", ariaLabel);
  btn.addEventListener("click", onClick);
  return btn;
}

async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) {
      return { title: tab.title || tab.url, url: tab.url };
    }
  } catch (err) {
    // no active-tab access in this context; fall through
  }
  return null;
}

// --- Categories view -------------------------------------------------

async function renderCategories() {
  const categories = await store.listCategories();
  categoriesListEl.innerHTML = "";
  categoriesEmptyEl.classList.toggle("hidden", categories.length > 0);

  for (const cat of categories) {
    categoriesListEl.appendChild(buildCategoryRow(cat));
  }
}

function buildCategoryRow(cat) {
  const row = document.createElement("div");
  row.className = "row";

  if (renamingCategoryId === cat.id) {
    const wrap = document.createElement("div");
    wrap.className = "rename-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = cat.title;
    const save = iconButton("✓", "Save name", async () => {
      const title = input.value.trim();
      if (title) await store.renameCategory(cat.id, title);
      renamingCategoryId = null;
      await renderCategories();
    });
    const cancel = iconButton("✕", "Cancel rename", () => {
      renamingCategoryId = null;
      renderCategories();
    });
    wrap.append(input, save, cancel);
    row.appendChild(wrap);
    requestAnimationFrame(() => input.focus());
    return row;
  }

  const main = document.createElement("button");
  main.type = "button";
  main.className = "row-main";
  const titleSpan = document.createElement("span");
  titleSpan.className = "row-title";
  titleSpan.textContent = cat.title;
  const countSpan = document.createElement("span");
  countSpan.className = "row-count";
  countSpan.textContent = String(cat.count);
  main.append(titleSpan, countSpan);
  main.addEventListener("click", () => openCategory(cat.id, cat.title));
  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "row-actions";

  if (pendingDelete && pendingDelete.type === "category" && pendingDelete.id === cat.id) {
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "confirm-yes";
    yes.textContent = "Delete";
    yes.addEventListener("click", async () => {
      await store.deleteCategory(cat.id);
      pendingDelete = null;
      await renderCategories();
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "confirm-no";
    no.textContent = "Cancel";
    no.addEventListener("click", () => {
      pendingDelete = null;
      renderCategories();
    });
    actions.append(yes, no);
  } else {
    actions.append(
      iconButton("✎", "Rename category", () => {
        renamingCategoryId = cat.id;
        renderCategories();
      }),
      iconButton(
        "🗑",
        "Delete category",
        () => {
          pendingDelete = { type: "category", id: cat.id };
          renderCategories();
        },
        "danger"
      )
    );
  }
  row.appendChild(actions);
  return row;
}

addCategoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = newCategoryInput.value.trim();
  if (!title) return;
  newCategoryInput.value = "";
  await store.createCategory(title);
  await renderCategories();
});

// --- Category detail view --------------------------------------------

async function openCategory(id, title) {
  currentCategory = { id, title };
  pendingDelete = null;
  editingItemId = null;
  categoriesView.classList.add("hidden");
  categoryView.classList.remove("hidden");
  categoryTitleEl.textContent = title;
  resetItemForm();
  if (currentTab && !itemTitleInput.value && !itemUrlInput.value) {
    itemTitleInput.value = currentTab.title;
    itemUrlInput.value = currentTab.url;
  }
  await renderItems();
}

function closeCategory() {
  currentCategory = null;
  categoryView.classList.add("hidden");
  categoriesView.classList.remove("hidden");
  renderCategories();
}

backBtn.addEventListener("click", closeCategory);

deleteCategoryBtn.addEventListener("click", async () => {
  if (!currentCategory) return;
  if (deleteCategoryBtn.dataset.confirming === "1") {
    await store.deleteCategory(currentCategory.id);
    closeCategory();
    return;
  }
  deleteCategoryBtn.dataset.confirming = "1";
  deleteCategoryBtn.textContent = "Confirm?";
  setTimeout(() => {
    deleteCategoryBtn.dataset.confirming = "0";
    deleteCategoryBtn.textContent = "🗑";
  }, 2500);
});

function resetItemForm() {
  editingItemId = null;
  itemTitleInput.value = "";
  itemUrlInput.value = "";
  saveItemBtn.textContent = "Add bookmark";
  cancelEditBtn.classList.add("hidden");
}

cancelEditBtn.addEventListener("click", () => {
  resetItemForm();
});

useCurrentTabBtn.addEventListener("click", async () => {
  const tab = currentTab || (await getCurrentTab());
  if (tab) {
    itemTitleInput.value = tab.title;
    itemUrlInput.value = tab.url;
  }
});

itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentCategory) return;
  const title = itemTitleInput.value.trim();
  const url = itemUrlInput.value.trim();
  if (!url) return;
  if (editingItemId) {
    await store.updateItem(editingItemId, { title: title || url, url });
  } else {
    await store.addItem(currentCategory.id, title, url);
  }
  resetItemForm();
  await renderItems();
});

async function renderItems() {
  if (!currentCategory) return;
  const items = await store.listItems(currentCategory.id);
  itemsListEl.innerHTML = "";
  itemsEmptyEl.classList.toggle("hidden", items.length > 0);
  for (const item of items) {
    itemsListEl.appendChild(buildItemRow(item));
  }
}

function buildItemRow(item) {
  const row = document.createElement("div");
  row.className = "item-row";

  const main = document.createElement("div");
  main.className = "item-main";

  const link = document.createElement("button");
  link.type = "button";
  link.className = "item-link";
  const titleDiv = document.createElement("div");
  titleDiv.className = "item-title";
  titleDiv.textContent = item.title;
  const urlDiv = document.createElement("div");
  urlDiv.className = "item-url";
  urlDiv.textContent = item.url;
  link.append(titleDiv, urlDiv);
  link.addEventListener("click", () => chrome.tabs.create({ url: item.url }));
  main.appendChild(link);

  const actions = document.createElement("div");
  actions.className = "row-actions";

  if (pendingDelete && pendingDelete.type === "item" && pendingDelete.id === item.id) {
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "confirm-yes";
    yes.textContent = "Delete";
    yes.addEventListener("click", async () => {
      await store.deleteItem(item.id);
      pendingDelete = null;
      await renderItems();
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "confirm-no";
    no.textContent = "Cancel";
    no.addEventListener("click", () => {
      pendingDelete = null;
      renderItems();
    });
    actions.append(yes, no);
  } else {
    actions.append(
      iconButton("▦", "Show QR code", () => showQr(item.title, item.url)),
      iconButton("✎", "Edit bookmark", () => {
        editingItemId = item.id;
        itemTitleInput.value = item.title;
        itemUrlInput.value = item.url;
        saveItemBtn.textContent = "Save changes";
        cancelEditBtn.classList.remove("hidden");
        itemTitleInput.focus();
      }),
      iconButton(
        "🗑",
        "Delete bookmark",
        () => {
          pendingDelete = { type: "item", id: item.id };
          renderItems();
        },
        "danger"
      )
    );
  }
  main.appendChild(actions);
  row.appendChild(main);
  return row;
}

// --- Category rename (header) ------------------------------------------
// Replaces the header title with an inline input + save/cancel, matching
// the list-row rename pattern (window.prompt() is unsupported inside a
// Chrome extension popup, so every edit here has to be inline UI).

function startHeaderRename() {
  if (!currentCategory) return;
  const wrap = document.createElement("div");
  wrap.className = "rename-row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentCategory.title;
  const save = iconButton("✓", "Save name", async () => {
    const title = input.value.trim();
    if (title) {
      await store.renameCategory(currentCategory.id, title);
      currentCategory.title = title;
    }
    restoreHeader();
  });
  const cancel = iconButton("✕", "Cancel rename", () => restoreHeader());
  wrap.append(input, save, cancel);
  categoryTitleEl.replaceWith(wrap);
  input.focus();

  function restoreHeader() {
    wrap.replaceWith(categoryTitleEl);
    categoryTitleEl.textContent = currentCategory.title;
  }
}

renameCategoryBtn.addEventListener("click", startHeaderRename);

// --- Search --------------------------------------------------------------

let searchDebounce = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 150);
});

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchResultsEl.classList.add("hidden");
    categoriesView.classList.toggle("hidden", !!currentCategory);
    categoryView.classList.toggle("hidden", !currentCategory);
    return;
  }
  categoriesView.classList.add("hidden");
  categoryView.classList.add("hidden");
  searchResultsEl.classList.remove("hidden");

  const results = await store.searchItems(query);
  searchResultsEl.innerHTML = "";
  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No matching bookmarks.";
    searchResultsEl.appendChild(empty);
    return;
  }
  for (const result of results) {
    searchResultsEl.appendChild(buildSearchRow(result));
  }
}

function buildSearchRow(result) {
  const row = document.createElement("div");
  row.className = "item-row";
  const main = document.createElement("div");
  main.className = "item-main";

  const link = document.createElement("button");
  link.type = "button";
  link.className = "item-link";
  const titleDiv = document.createElement("div");
  titleDiv.className = "item-title";
  titleDiv.textContent = result.title;
  const urlDiv = document.createElement("div");
  urlDiv.className = "item-url";
  urlDiv.textContent = result.url;
  link.append(titleDiv, urlDiv);
  link.addEventListener("click", () => chrome.tabs.create({ url: result.url }));
  main.appendChild(link);

  const badge = document.createElement("span");
  badge.className = "search-badge";
  badge.textContent = result.categoryTitle;
  main.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    iconButton("▦", "Show QR code", () => showQr(result.title, result.url)),
    iconButton("→", "Open category", () => {
      searchInput.value = "";
      searchResultsEl.classList.add("hidden");
      openCategory(result.categoryId, result.categoryTitle);
    })
  );
  main.appendChild(actions);
  row.appendChild(main);
  return row;
}

// --- QR overlay ------------------------------------------------------

function showQr(title, url) {
  qrTitleEl.textContent = title;
  qrUrlEl.textContent = url;

  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();

  const cellSize = 6;
  const margin = 2;
  const size = (qr.getModuleCount() + margin * 2) * cellSize;
  qrCanvas.width = size;
  qrCanvas.height = size;
  const ctx = qrCanvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(margin * cellSize, margin * cellSize);
  qr.renderTo2dContext(ctx, cellSize);
  ctx.restore();

  qrOverlay.classList.remove("hidden");
}

function hideQr() {
  qrOverlay.classList.add("hidden");
}

qrCloseBtn.addEventListener("click", hideQr);
qrOverlay.addEventListener("click", (e) => {
  if (e.target === qrOverlay) hideQr();
});

qrDownloadBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  const safeName = (qrTitleEl.textContent || "qrcode").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60);
  link.download = `${safeName || "qrcode"}.png`;
  link.href = qrCanvas.toDataURL("image/png");
  link.click();
});

// --- Init --------------------------------------------------------------

(async function init() {
  currentTab = await getCurrentTab();
  await renderCategories();
})();
