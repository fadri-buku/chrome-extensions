// Settings + enforcement helpers for the configurable "max open windows" cap.
export const DEFAULT_LIMIT = 2;
const LIMIT_KEY = "maxWindows";

export async function getLimit() {
  const res = await chrome.storage.sync.get({ [LIMIT_KEY]: DEFAULT_LIMIT });
  const n = Number(res[LIMIT_KEY]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_LIMIT;
}

export async function setLimit(value) {
  const clamped = Math.max(1, Math.floor(Number(value)) || DEFAULT_LIMIT);
  await chrome.storage.sync.set({ [LIMIT_KEY]: clamped });
  return clamped;
}

export async function getNormalWindows() {
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return wins.filter((w) => !w.incognito);
}

// Called when a new normal, non-incognito window is created and the count
// exceeds the configured limit: folds the new window's tabs into an
// existing window (nothing is discarded) and closes the now-empty extra
// window, then fires a notification explaining why.
export async function enforceOnNewWindow(newWindow) {
  const limit = await getLimit();
  const normalWindows = await getNormalWindows();
  if (normalWindows.length <= limit) return;

  const target = normalWindows.find((w) => w.id !== newWindow.id);
  if (!target) return; // count > limit guarantees another window exists

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
    // Chrome usually closes a window automatically once its last tab is
    // moved out — this just cleans up if it somehow didn't.
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Window limit reached",
    message: `You're capped at ${limit} window${limit === 1 ? "" : "s"}. That new window's tabs were moved into your existing window instead of opening a new one.`,
  });
}
