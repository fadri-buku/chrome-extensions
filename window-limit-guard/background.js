import * as settings from "./lib/settings.js";

async function getNormalWindows() {
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return wins.filter((w) => !w.incognito);
}

async function handleOverLimit(newWindow, limit) {
  const others = (await getNormalWindows()).filter((w) => w.id !== newWindow.id);
  const target = others[0];
  if (!target) return; // count > limit guarantees at least one other window exists

  const tabs = await chrome.tabs.query({ windowId: newWindow.id });
  const tabIds = tabs.map((t) => t.id).filter((id) => id !== undefined);
  if (tabIds.length > 0) {
    try {
      await chrome.tabs.move(tabIds, { windowId: target.id, index: -1 });
    } catch (err) {
      // Fall through and still try to close the extra window below.
    }
  }
  try {
    await chrome.windows.remove(newWindow.id);
  } catch (err) {
    // Chrome already closes a window once its last tab is moved out —
    // this just cleans up if it somehow didn't.
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Window limit reached",
    message: `You're capped at ${limit} window${limit === 1 ? "" : "s"}. That new window's tabs were moved into your existing window instead of opening a new one.`,
  });
}

chrome.windows.onCreated.addListener(async (win) => {
  // Only normal browser windows count, and incognito windows are ignored
  // entirely (the extension usually can't see them unless the user opts in
  // via "Allow in Incognito", and mixing them into the same cap would be
  // surprising).
  if (win.type !== "normal" || win.incognito) return;

  const limit = await settings.getLimit();
  const normalWindows = await getNormalWindows();
  if (normalWindows.length > limit) {
    await handleOverLimit(win, limit);
  }
});
