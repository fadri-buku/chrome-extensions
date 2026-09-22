import * as store from "../lib/storage.js";
import * as tg from "../lib/tabgroups.js";
import * as bookmarks from "../lib/bookmarks.js";
import * as windowLimit from "../lib/windowLimit.js";

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
const windowLimitInputEl = document.getElementById("window-limit-input");
const windowLimitCountEl = document.getElementById("window-limit-count");

let state = { windows: [], groups: [], pinnedDefs: [], liveMap: {}, customTitles: {}, windowLimit: windowLimit.DEFAULT_LIMIT };
let renderTimer = null;

function scheduleLoad() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(loadState, 150);
}

async function loadState() {
  renderTimer = null;
  const [windows, groups, pinnedDefs, liveMap, customTitles, limit] = await Promise.all([
    chrome.windows.getAll({ populate: true }),
    chrome.tabGroups.query({}),
    store.getAllPinnedItems(),
    store.getLiveMap(),
    store.getCustomTitles(),
    windowLimit.getLimit(),
  ]);
  state = { windows, groups, pinnedDefs, liveMap, customTitles, windowLimit: limit };
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
  const entry = Object.entries(state.liveMap).find(([, ref]) => ref?.kind === "group" && ref.id === groupId);
  return entry ? entry[0] : null;
}

function pinnedIdForTab(tabId) {
  const entry = Object.entries(state.liveMap).find(([, ref]) => ref?.kind === "tab" && ref.id === tabId);
  return entry ? entry[0] : null;
}

function pinnedRecordFor(pinnedId) {
  return pinnedId ? state.pinnedDefs.find((p) => p.id === pinnedId) || null : null;
}

function openGroupIds() {
  return new Set(state.groups.map((g) => g.id));
}

function openTabIds() {
  return new Set(state.windows.flatMap((w) => (w.tabs || []).map((t) => t.id)));
}

function ungroupedTabsForWindow(windowId) {
  return (state.windows.find((w) => w.id === windowId)?.tabs || [])
    .filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
    .sort((a, b) => a.index - b.index);
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
  let anyContent = false;
  for (const w of state.windows) {
    windowIndex += 1;
    const groups = byWindow.get(w.id) || [];
    const ungrouped = ungroupedTabsForWindow(w.id);
    if (groups.length === 0 && ungrouped.length === 0) continue;
    anyContent = true;
    const block = el("div", { class: "window-block" }, [
      el("p", { class: "window-label" }, `Window ${windowIndex}`),
      ...groups.map((g) => renderGroupCard(g)),
      ungrouped.length ? renderUngroupedCard(w.id, ungrouped) : null,
    ]);
    openGroupsEl.appendChild(block);
  }
  emptyStateEl.hidden = anyContent;

  const openGroups = openGroupIds();
  const openTabs = openTabIds();
  const closed = state.pinnedDefs.filter((p) => {
    const ref = state.liveMap[p.id];
    if (!ref) return true;
    if (ref.kind === "group") return !openGroups.has(ref.id);
    if (ref.kind === "tab") return !openTabs.has(ref.id);
    return true;
  });
  closedSectionEl.hidden = closed.length === 0;
  for (const p of closed) closedListEl.appendChild(renderClosedPinnedCard(p));

  renderWindowLimit();
}

function renderWindowLimit() {
  if (document.activeElement !== windowLimitInputEl) {
    windowLimitInputEl.value = state.windowLimit;
  }
  const openCount = state.windows.filter((w) => !w.incognito).length;
  windowLimitCountEl.textContent = `${openCount} window${openCount === 1 ? "" : "s"} open now`;
}

function pinLockButtons(pinnedId, onTogglePin, onToggleForced, pinTitleOn, pinTitleOff) {
  const rec = pinnedRecordFor(pinnedId);
  const pinBtn = el(
    "button",
    {
      class: "icon-btn" + (pinnedId ? " active" : ""),
      title: pinnedId ? pinTitleOn : pinTitleOff,
      onclick: onTogglePin,
    },
    pinnedId ? "★" : "☆"
  );
  const lockBtn = pinnedId
    ? el(
        "button",
        {
          class: "icon-btn" + (rec?.forced ? " locked" : ""),
          title: rec?.forced
            ? "Force-pinned: reopens automatically if closed. Click to allow normal closing."
            : "Force-pin: reopen automatically if this gets closed.",
          onclick: onToggleForced,
        },
        "🔒"
      )
    : null;
  return [pinBtn, lockBtn];
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

  const [pinBtn, lockBtn] = pinLockButtons(
    pinnedId,
    () => togglePin(group, pinnedId, tabs),
    () => toggleForced(pinnedId),
    "Unpin (stop tracking & syncing this group)",
    "Pin (keep this group across restarts & sync it)"
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
    lockBtn,
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

function renderUngroupedCard(windowId, tabs) {
  const header = el("div", { class: "group-header" }, [
    el("span", { class: "group-title ungrouped-label" }, "Ungrouped tabs"),
  ]);
  const list = el(
    "ul",
    { class: "tab-list" },
    tabs.map((t) => renderTabRow(t, null))
  );
  const card = el("div", { class: "group-card neutral" }, [header, list]);
  return card;
}

function renderTabRow(tab, ownerGroup) {
  const otherGroups = ownerGroup ? state.groups.filter((g) => g.id !== ownerGroup.id) : state.groups;
  const title = displayTitle(tab);
  const isCustom = !!state.customTitles[tab.url];
  const tabPinnedId = pinnedIdForTab(tab.id);

  const titleSpan = el(
    "span",
    {
      class: "tab-title" + (isCustom ? " custom" : ""),
      title: isCustom ? `Custom title (real: ${tab.title})` : "Click to set a custom title",
      onclick: () => beginTitleEdit(row, tab, titleSpan),
    },
    title
  );

  const [pinBtn, lockBtn] = pinLockButtons(
    tabPinnedId,
    () => togglePinTab(tab, tabPinnedId),
    () => toggleForced(tabPinnedId),
    "Unpin this tab",
    "Pin this tab (keep it across restarts & sync it)"
  );

  const row = el("li", { class: "tab-row" }, [
    pinBtn,
    lockBtn,
    tab.favIconUrl
      ? el("img", {
          class: "tab-favicon clickable",
          src: tab.favIconUrl,
          alt: "",
          title: "Switch to this tab",
          onclick: () => openTab(tab),
        })
      : el("span", {
          class: "tab-favicon clickable",
          title: "Switch to this tab",
          onclick: () => openTab(tab),
        }),
    titleSpan,
    el(
      "select",
      {
        class: "move-select",
        title: "Move to a group",
        onchange: (e) => {
          const value = e.target.value;
          if (value === "new") moveTabToNewGroup(tab.id);
          else if (value) moveTabToGroup(tab.id, Number(value));
          e.target.value = "";
        },
      },
      [
        el("option", { value: "" }, "Move…"),
        el("option", { value: "new" }, "+ New group"),
        ...otherGroups.map((g) => el("option", { value: String(g.id) }, g.title || "(unnamed)")),
      ]
    ),
    el(
      "button",
      {
        class: "text-btn danger",
        title: "Close every other tab in this window (pinned/force-pinned tabs and groups are left alone)",
        onclick: () => closeOtherTabsInWindow(tab),
      },
      "Close others"
    ),
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
  const isTab = pinned.kind === "tab";
  const label = isTab ? pinned.title || pinned.tabs[0]?.url || "(tab)" : pinned.title || "(unnamed group)";
  const metaParts = [];
  if (!isTab) metaParts.push(`${pinned.tabs.length} tab${pinned.tabs.length === 1 ? "" : "s"}`);
  metaParts.push(pinned.storageArea === "local" ? "local only" : "synced");
  if (pinned.forced) metaParts.push("force-pinned");

  const card = el("div", { class: "closed-pinned-card" }, [
    el("span", { class: "swatch" }),
    el("div", { class: "title" }, [label, el("div", { class: "meta" }, metaParts.join(" · "))]),
    el("button", { onclick: () => restorePinned(pinned) }, "Restore"),
    el("button", { onclick: () => forgetPinned(pinned.id) }, "Forget"),
  ]);
  card.style.setProperty("--group-color", isTab ? COLOR_HEX.grey : COLOR_HEX[pinned.color] || COLOR_HEX.grey);
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

// A tab is "protected" from a bulk close if it's solo-pinned, or it's a
// member of a currently-pinned group — closing others shouldn't undo your
// own pins (and for a force-pinned one, would just trigger the healer to
// reopen it right back, which is pointless churn either way).
function isTabProtected(tab) {
  const isGroupPinned =
    tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
    Object.values(state.liveMap).some((ref) => ref?.kind === "group" && ref.id === tab.groupId);
  const isSoloPinned = Object.values(state.liveMap).some((ref) => ref?.kind === "tab" && ref.id === tab.id);
  return isGroupPinned || isSoloPinned;
}

async function closeOtherTabsInWindow(tab) {
  const windowTabs = state.windows.find((w) => w.id === tab.windowId)?.tabs || [];
  const idsToClose = windowTabs
    .filter((t) => t.id !== tab.id && !isTabProtected(t))
    .map((t) => t.id);
  if (idsToClose.length === 0) return;
  await chrome.tabs.remove(idsToClose);
  loadState();
}

async function togglePin(group, existingPinnedId, tabs) {
  if (existingPinnedId) {
    await store.deletePinnedItem(existingPinnedId);
    await store.removeLiveMapEntry(existingPinnedId);
  } else {
    const id = crypto.randomUUID();
    await tg.saveAndSyncBookmark({
      id,
      kind: "group",
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      tabs: tabs.map((t) => ({ url: t.url, title: t.title })),
      forced: false,
    });
    await store.setLiveMapEntry(id, { kind: "group", id: group.id });
  }
  loadState();
}

function groupHintForTab(tab) {
  if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
  const group = state.groups.find((g) => g.id === tab.groupId);
  return group ? { title: group.title, color: group.color } : null;
}

async function togglePinTab(tab, existingPinnedId) {
  if (existingPinnedId) {
    await store.deletePinnedItem(existingPinnedId);
    await store.removeLiveMapEntry(existingPinnedId);
  } else {
    const id = crypto.randomUUID();
    await tg.saveAndSyncBookmark({
      id,
      kind: "tab",
      title: tab.title,
      tabs: [{ url: tab.url, title: tab.title }],
      forced: false,
      groupHint: groupHintForTab(tab),
    });
    await store.setLiveMapEntry(id, { kind: "tab", id: tab.id });
  }
  loadState();
}

async function openTab(tab) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

async function toggleForced(pinnedId) {
  const rec = pinnedRecordFor(pinnedId);
  if (!rec) return;
  await tg.saveAndSyncBookmark({ ...rec, forced: !rec.forced });
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

async function moveTabToNewGroup(tabId) {
  await chrome.tabs.group({ tabIds: [tabId] });
  loadState();
}

async function restorePinned(pinned) {
  setStatus(`Restoring "${pinned.title || "item"}"…`);
  const windowId = await tg.findWindowForRestore();
  await tg.restorePinnedItem(pinned, windowId);
  setStatus("");
  loadState();
}

async function forgetPinned(pinnedId) {
  const rec = pinnedRecordFor(pinnedId);
  if (rec) await bookmarks.removeItemBookmark(rec);
  await store.deletePinnedItem(pinnedId);
  await store.removeLiveMapEntry(pinnedId);
  loadState();
}

function setStatus(text) {
  statusEl.textContent = text;
}

windowLimitInputEl.addEventListener("change", async () => {
  const clamped = await windowLimit.setLimit(windowLimitInputEl.value);
  windowLimitInputEl.value = clamped;
  setStatus("Window limit saved.");
  setTimeout(() => setStatus(""), 1500);
  loadState();
});

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
