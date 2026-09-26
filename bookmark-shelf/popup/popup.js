import * as store from "../lib/bookmarks.js";

const $ = (id) => document.getElementById(id);

const searchInput = $("search-input");
const searchResultsEl = $("search-results");
const shelfView = $("shelf-view");
const categoriesListEl = $("categories-list");
const categoriesEmptyEl = $("categories-empty");
const addCategoryForm = $("add-category-form");
const newCategoryInput = $("new-category-input");
const expandAllBtn = $("expand-all-btn");
const qrOverlay = $("qr-overlay");
const qrCanvas = $("qr-canvas");
const qrTitleEl = $("qr-title");
const qrUrlEl = $("qr-url");
const qrCloseBtn = $("qr-close-btn");
const qrDownloadBtn = $("qr-download-btn");

// Everything lives on one screen: categories expand in place to show their
// bookmarks nested underneath, instead of drilling into a separate view.
let categoriesCache = [];
let itemsByCategory = new Map(); // categoryId -> items array, only for expanded categories
let expandedIds = new Set();
let pendingDelete = null; // { type: 'category' | 'item', id }
let renamingCategoryId = null;
let addFormOpenFor = null; // categoryId currently showing its inline add-bookmark form
let editingItem = null; // { id, categoryId }
let movingItem = null; // itemId currently showing its "move to" picker
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

// --- Data loading ------------------------------------------------------

async function loadAndRender() {
  categoriesCache = await store.listCategories();
  const validIds = new Set(categoriesCache.map((c) => c.id));
  for (const id of [...expandedIds]) {
    if (!validIds.has(id)) {
      expandedIds.delete(id);
      itemsByCategory.delete(id);
    }
  }
  await Promise.all(
    [...expandedIds].map(async (id) => {
      itemsByCategory.set(id, await store.listItems(id));
    })
  );
  render();
}

function render() {
  categoriesListEl.innerHTML = "";
  categoriesEmptyEl.classList.toggle("hidden", categoriesCache.length > 0);
  for (const cat of categoriesCache) {
    categoriesListEl.appendChild(buildCategorySection(cat));
  }
  const allExpanded = categoriesCache.length > 0 && expandedIds.size === categoriesCache.length;
  expandAllBtn.textContent = allExpanded ? "Collapse all" : "Expand all";
}

// --- Category sections ---------------------------------------------------

function buildCategorySection(cat) {
  const section = document.createElement("div");
  section.className = "category-section";

  const header = document.createElement("div");
  header.className = "category-header2";
  header.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes("text/bookmark-item-id")) return;
    e.preventDefault();
    header.classList.add("drag-over");
  });
  header.addEventListener("dragleave", () => header.classList.remove("drag-over"));
  header.addEventListener("drop", async (e) => {
    header.classList.remove("drag-over");
    const itemId = e.dataTransfer.getData("text/bookmark-item-id");
    if (!itemId) return;
    e.preventDefault();
    await store.moveItem(itemId, cat.id);
    expandedIds.add(cat.id);
    await loadAndRender();
  });

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
      await loadAndRender();
    });
    const cancel = iconButton("✕", "Cancel rename", () => {
      renamingCategoryId = null;
      render();
    });
    wrap.append(input, save, cancel);
    header.appendChild(wrap);
    requestAnimationFrame(() => input.focus());
  } else {
    const main = document.createElement("button");
    main.type = "button";
    main.className = "row-main";
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.textContent = expandedIds.has(cat.id) ? "▾" : "▸";
    const titleSpan = document.createElement("span");
    titleSpan.className = "row-title";
    titleSpan.textContent = cat.title;
    const countSpan = document.createElement("span");
    countSpan.className = "row-count";
    countSpan.textContent = String(cat.count);
    main.append(chevron, titleSpan, countSpan);
    main.addEventListener("click", () => toggleExpand(cat.id));
    header.appendChild(main);

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
        await loadAndRender();
      });
      const no = document.createElement("button");
      no.type = "button";
      no.className = "confirm-no";
      no.textContent = "Cancel";
      no.addEventListener("click", () => {
        pendingDelete = null;
        render();
      });
      actions.append(yes, no);
    } else {
      actions.append(
        iconButton("＋", "Add bookmark to this category", () => {
          expandedIds.add(cat.id);
          addFormOpenFor = addFormOpenFor === cat.id ? null : cat.id;
          loadAndRender();
        }),
        iconButton("✎", "Rename category", () => {
          renamingCategoryId = cat.id;
          render();
        }),
        iconButton(
          "🗑",
          "Delete category",
          () => {
            pendingDelete = { type: "category", id: cat.id };
            render();
          },
          "danger"
        )
      );
    }
    header.appendChild(actions);
  }
  section.appendChild(header);

  if (expandedIds.has(cat.id)) {
    const body = document.createElement("div");
    body.className = "category-body";

    if (addFormOpenFor === cat.id) {
      body.appendChild(buildAddItemForm(cat.id));
    }

    const items = itemsByCategory.get(cat.id) || [];
    if (items.length === 0 && addFormOpenFor !== cat.id) {
      const empty = document.createElement("p");
      empty.className = "empty small";
      empty.textContent = "No bookmarks in this category yet.";
      body.appendChild(empty);
    }
    for (const item of items) {
      body.appendChild(buildItemRow(item, cat));
    }
    section.appendChild(body);
  }

  return section;
}

async function toggleExpand(catId) {
  if (expandedIds.has(catId)) {
    expandedIds.delete(catId);
    itemsByCategory.delete(catId);
    if (addFormOpenFor === catId) addFormOpenFor = null;
  } else {
    expandedIds.add(catId);
    itemsByCategory.set(catId, await store.listItems(catId));
  }
  render();
}

addCategoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = newCategoryInput.value.trim();
  if (!title) return;
  newCategoryInput.value = "";
  const created = await store.createCategory(title);
  expandedIds.add(created.id);
  await loadAndRender();
});

expandAllBtn.addEventListener("click", async () => {
  if (categoriesCache.length > 0 && expandedIds.size === categoriesCache.length) {
    expandedIds.clear();
    itemsByCategory.clear();
    addFormOpenFor = null;
  } else {
    expandedIds = new Set(categoriesCache.map((c) => c.id));
    await Promise.all(
      categoriesCache.map(async (c) => {
        itemsByCategory.set(c.id, await store.listItems(c.id));
      })
    );
  }
  render();
});

// --- Add-bookmark inline form -------------------------------------------

function buildAddItemForm(categoryId) {
  const form = document.createElement("form");
  form.className = "add-item-form";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Title";
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "URL";
  if (currentTab) {
    titleInput.value = currentTab.title;
    urlInput.value = currentTab.url;
  }

  const actionsRow = document.createElement("div");
  actionsRow.className = "add-item-actions";
  const useTabBtn = document.createElement("button");
  useTabBtn.type = "button";
  useTabBtn.textContent = "Use current tab";
  useTabBtn.addEventListener("click", async () => {
    const tab = currentTab || (await getCurrentTab());
    if (tab) {
      titleInput.value = tab.title;
      urlInput.value = tab.url;
    }
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    addFormOpenFor = null;
    render();
  });
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "primary-btn";
  saveBtn.textContent = "Add bookmark";
  actionsRow.append(useTabBtn, cancelBtn, saveBtn);

  form.append(titleInput, urlInput, actionsRow);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    await store.addItem(categoryId, titleInput.value.trim(), url);
    addFormOpenFor = null;
    await loadAndRender();
  });
  requestAnimationFrame(() => titleInput.focus());
  return form;
}

// --- Bookmark rows -------------------------------------------------------

function buildItemRow(item, cat) {
  const row = document.createElement("div");
  row.className = "item-row";

  if (editingItem && editingItem.id === item.id) {
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = item.title;
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.value = item.url;
    const actions = document.createElement("div");
    actions.className = "add-item-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-btn";
    save.textContent = "Save changes";
    save.addEventListener("click", async () => {
      const url = urlInput.value.trim();
      if (!url) return;
      await store.updateItem(item.id, { title: titleInput.value.trim() || url, url });
      editingItem = null;
      await loadAndRender();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      editingItem = null;
      render();
    });
    actions.append(cancel, save);
    row.append(titleInput, urlInput, actions);
    return row;
  }

  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/bookmark-item-id", item.id);
    e.dataTransfer.effectAllowed = "move";
  });

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
      await loadAndRender();
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "confirm-no";
    no.textContent = "Cancel";
    no.addEventListener("click", () => {
      pendingDelete = null;
      render();
    });
    actions.append(yes, no);
  } else if (movingItem === item.id) {
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.textContent = "Move to…";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    for (const other of categoriesCache) {
      if (other.id === cat.id) continue;
      const opt = document.createElement("option");
      opt.value = other.id;
      opt.textContent = other.title;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      const targetId = select.value;
      if (!targetId) return;
      await store.moveItem(item.id, targetId);
      expandedIds.add(targetId);
      movingItem = null;
      await loadAndRender();
    });
    const cancel = iconButton("✕", "Cancel move", () => {
      movingItem = null;
      render();
    });
    actions.append(select, cancel);
  } else {
    actions.append(iconButton("▦", "Show QR code", () => showQr(item.title, item.url)));
    if (categoriesCache.length > 1) {
      actions.append(
        iconButton("⇄", "Move to another category", () => {
          movingItem = item.id;
          render();
        })
      );
    }
    actions.append(
      iconButton("✎", "Edit bookmark", () => {
        editingItem = { id: item.id, categoryId: cat.id };
        render();
      }),
      iconButton(
        "🗑",
        "Delete bookmark",
        () => {
          pendingDelete = { type: "item", id: item.id };
          render();
        },
        "danger"
      )
    );
  }
  main.appendChild(actions);
  row.appendChild(main);
  return row;
}

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
    shelfView.classList.remove("hidden");
    return;
  }
  shelfView.classList.add("hidden");
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
    iconButton("→", "Open category", async () => {
      searchInput.value = "";
      expandedIds.add(result.categoryId);
      searchResultsEl.classList.add("hidden");
      shelfView.classList.remove("hidden");
      await loadAndRender();
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
  const initial = await store.listCategories();
  expandedIds = new Set(initial.map((c) => c.id));
  await loadAndRender();
})();
