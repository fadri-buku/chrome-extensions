import * as store from "../lib/storage.js";

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const COLOR_HEX = {
  grey: "#9aa0a6",
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8bcb",
  purple: "#d7aefb",
  cyan: "#78d9ec",
  orange: "#fcad70",
};

const statusEl = document.getElementById("status");
const openGroupsEl = document.getElementById("open-groups");
const closedSectionEl = document.getElementById("closed-pinned-section");
const closedListEl = document.getElementById("closed-pinned");
const emptyStateEl = document.getElementById("empty-state");

let state = { windows: [], groups: [], pinnedDefs: [], liveMap: {}, customTitles: {} };
let renderTimer = null;

function scheduleLoad() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(loadState, 150);
}

async function loadState() {
  renderTimer = null;
  const [windows, groups, pinnedDefs, liveMap, customTitles] = await Promise.all([
    chrome.windows.getAll({ populate: true }),
    chrome.tabGroups.query({}),
    store.getAllPinnedGroups(),
    store.getLiveMap(),
    store.getCustomTitles(),
  ]);
  state = { windows, groups, pinnedDefs, liveMap, customTitles };
  render();
}

function tabsForGroup(groupId) {
  const tabs = [];
  for (const w of state.windows) {
    for (const t of w.tabs || []) {
      if (t.groupId === groupId) tabs.push(t);
    }
  }
  return tabs.sort((a, b) => a.index - b.index);
}

function pinnedIdForGroup(groupId) {
  const entry = Object.entries(state.liveMap).find(([, v]) => v === groupId);
  return entry ? entry[0] : null;
}

function openGroupIds() {
  return new Set(state.groups.map((g) => g.id));
}

function displayTitle(tab) {
  return state.customTitles[tab.url] || tab.title || tab.url;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function render() {
  openGroupsEl.innerHTML = "";
  closedListEl.innerHTML = "";

  const byWindow = new Map();
  for (const g of state.groups) {
    if (!byWindow.has(g.windowId)) byWindow.set(g.windowId, []);
    byWindow.get(g.windowId).push(g);
  }

  let windowIndex = 0;
  let anyGroups = false;
  for (const w of state.windows) {
    windowIndex += 1;
    const groups = byWindow.get(w.id) || [];
    if (groups.length === 0) continue;
    anyGroups = true;
    const block = el("div", { class: "window-block" }, [
      el("p", { class: "window-label" }, `Window ${windowIndex}`),
      ...groups.map((g) => renderGroupCard(g)),
    ]);
    openGroupsEl.appendChild(block);
  }
  emptyStateEl.hidden = anyGroups;

  const open = openGroupIds();
  const closed = state.pinnedDefs.filter((p) => {
    const liveId = state.liveMap[p.id];
    return !liveId || !open.has(liveId);
  });
  closedSectionEl.hidden = closed.length === 0;
  for (const p of closed) closedListEl.appendChild(renderClosedPinnedCard(p));
}

function renderGroupCard(group) {
  const pinnedId = pinnedIdForGroup(group.id);
  const tabs = tabsForGroup(group.id);

  const colorSelect = el(
    "select",
    {
      class: "color-select",
      title: "Color",
      onchange: (e) => setColor(group.id, e.target.value),
    },
    GROUP_COLORS.map((c) => el("option", { value: c, selected: c === group.color ? "selected" : undefined }, c))
  );

  const titleInput = el("input", {
    class: "group-title",
    value: group.title || "(unnamed group)",
    onchange: (e) => renameGroup(group.id, e.target.value),
  });

  const pinBtn = el(
    "button",
    {
      class: "icon-btn" + (pinnedId ? " active" : ""),
      title: pinnedId ? "Unpin (stop tracking & syncing this group)" : "Pin (keep this group across restarts & sync it)",
      onclick: () => togglePin(group, pinnedId, tabs),
    },
    pinnedId ? "★" : "☆"
  );

  const collapseBtn = el(
    "button",
    {
      class: "icon-btn",
      title: group.collapsed ? "Expand" : "Collapse",
      onclick: () => setCollapsed(group.id, !group.collapsed),
    },
    group.collapsed ? "▸" : "▾"
  );

  const focusBtn = el(
    "button",
    { class: "icon-btn", title: "Focus this group's window", onclick: () => focusGroup(group) },
    "⤢"
  );

  const closeBtn = el(
    "button",
    { class: "icon-btn danger", title: "Close all tabs in this group", onclick: () => closeGroup(group.id) },
    "✕"
  );

  const header = el("div", { class: "group-header" }, [
    pinBtn,
    titleInput,
    colorSelect,
    collapseBtn,
    focusBtn,
    closeBtn,
  ]);

  const list = el(
    "ul",
    { class: "tab-list" },
    tabs.map((t) => renderTabRow(t, group))
  );

  const card = el("div", { class: "group-card" }, [header, list]);
  card.style.setProperty("--group-color", COLOR_HEX[group.color] || COLOR_HEX.grey);
  return card;
}

function renderTabRow(tab, ownerGroup) {
  const otherGroups = state.groups.filter((g) => g.id !== ownerGroup.id);
  const title = displayTitle(tab);
  const isCustom = !!state.customTitles[tab.url];

  const titleSpan = el(
    "span",
    {
      class: "tab-title" + (isCustom ? " custom" : ""),
      title: isCustom ? `Custom title (real: ${tab.title})` : "Click to set a custom title",
      onclick: () => beginTitleEdit(row, tab, titleSpan),
    },
    title
  );

  const row = el("li", { class: "tab-row" }, [
    tab.favIconUrl
      ? el("img", { class: "tab-favicon", src: tab.favIconUrl, alt: "" })
      : el("span", { class: "tab-favicon" }),
    titleSpan,
    otherGroups.length
      ? el(
          "select",
          {
            class: "move-select",
            title: "Move to another group",
            onchange: (e) => {
              if (e.target.value) moveTabToGroup(tab.id, Number(e.target.value));
              e.target.value = "";
            },
          },
          [
            el("option", { value: "" }, "Move…"),
            ...otherGroups.map((g) =>
              el("option", { value: String(g.id) }, g.title || "(unnamed)")
            ),
          ]
        )
      : null,
  ]);
  return row;
}

function beginTitleEdit(row, tab, titleSpan) {
  const input = el("input", {
    class: "tab-title-input",
    value: state.customTitles[tab.url] || tab.title || "",
  });
  row.replaceChild(input, titleSpan);
  input.focus();
  input.select();

  const commit = async () => {
    const value = input.value.trim();
    if (!value || value === tab.title) {
      await store.clearCustomTitle(tab.url);
    } else {
      await store.setCustomTitle(tab.url, value);
    }
    loadState();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      loadState();
    }
  });
}

function renderClosedPinnedCard(pinned) {
  const card = el("div", { class: "closed-pinned-card" }, [
    el("span", { class: "swatch" }),
    el("div", { class: "title" }, [
      pinned.title || "(unnamed group)",
      el("div", { class: "meta" }, `${pinned.tabs.length} tab${pinned.tabs.length === 1 ? "" : "s"} · ${pinned.storageArea === "local" ? "local only" : "synced"}`),
    ]),
    el("button", { onclick: () => restorePinned(pinned) }, "Restore"),
    el("button", { onclick: () => forgetPinned(pinned.id) }, "Forget"),
  ]);
  card.style.setProperty("--group-color", COLOR_HEX[pinned.color] || COLOR_HEX.grey);
  return card;
}

async function renameGroup(groupId, title) {
  await chrome.tabGroups.update(groupId, { title });
  loadState();
}

async function setColor(groupId, color) {
  await chrome.tabGroups.update(groupId, { color });
  loadState();
}

async function setCollapsed(groupId, collapsed) {
  await chrome.tabGroups.update(groupId, { collapsed });
  loadState();
}

async function focusGroup(group) {
  await chrome.windows.update(group.windowId, { focused: true });
  if (group.collapsed) await chrome.tabGroups.update(group.id, { collapsed: false });
  const tabs = tabsForGroup(group.id);
  if (tabs[0]) await chrome.tabs.update(tabs[0].id, { active: true });
  loadState();
}

async function closeGroup(groupId) {
  const tabs = tabsForGroup(groupId);
  await chrome.tabs.remove(tabs.map((t) => t.id));
  loadState();
}

async function togglePin(group, existingPinnedId, tabs) {
  if (existingPinnedId) {
    await store.deletePinnedGroup(existingPinnedId);
    await store.removeLiveMapEntry(existingPinnedId);
  } else {
    const id = crypto.randomUUID();
    await store.savePinnedGroup({
      id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      tabs: tabs.map((t) => ({ url: t.url, title: t.title })),
    });
    await store.setLiveMapEntry(id, group.id);
  }
  loadState();
}

async function moveTabToGroup(tabId, targetGroupId) {
  const targetGroup = state.groups.find((g) => g.id === targetGroupId);
  const tab = state.windows.flatMap((w) => w.tabs || []).find((t) => t.id === tabId);
  if (!targetGroup || !tab) return;
  if (tab.windowId !== targetGroup.windowId) {
    await chrome.tabs.move(tabId, { windowId: targetGroup.windowId, index: -1 });
  }
  await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId });
  loadState();
}

async function restorePinned(pinned) {
  setStatus(`Restoring "${pinned.title || "group"}"…`);
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const windowId = wins.length ? wins.sort((a, b) => b.id - a.id)[0].id : (await chrome.windows.create({})).id;

  const tabIds = [];
  for (const t of pinned.tabs) {
    try {
      const tab = await chrome.tabs.create({ url: t.url, active: false, windowId });
      tabIds.push(tab.id);
    } catch (err) {
      // skip URLs the browser refuses to open (e.g. chrome:// internal pages)
    }
  }
  if (tabIds.length) {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: pinned.title,
      color: pinned.color,
      collapsed: pinned.collapsed,
    });
    await store.setLiveMapEntry(pinned.id, groupId);
  }
  setStatus("");
  loadState();
}

async function forgetPinned(pinnedId) {
  await store.deletePinnedGroup(pinnedId);
  await store.removeLiveMapEntry(pinnedId);
  loadState();
}

function setStatus(text) {
  statusEl.textContent = text;
}

chrome.tabGroups.onCreated.addListener(scheduleLoad);
chrome.tabGroups.onUpdated.addListener(scheduleLoad);
chrome.tabGroups.onRemoved.addListener(scheduleLoad);
chrome.tabGroups.onMoved.addListener(scheduleLoad);
chrome.tabs.onCreated.addListener(scheduleLoad);
chrome.tabs.onUpdated.addListener(scheduleLoad);
chrome.tabs.onRemoved.addListener(scheduleLoad);
chrome.tabs.onMoved.addListener(scheduleLoad);
chrome.tabs.onAttached.addListener(scheduleLoad);
chrome.tabs.onDetached.addListener(scheduleLoad);
chrome.windows.onCreated.addListener(scheduleLoad);
chrome.windows.onRemoved.addListener(scheduleLoad);
chrome.storage.onChanged.addListener(scheduleLoad);

loadState();
