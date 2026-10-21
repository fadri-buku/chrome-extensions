const PAGE = chrome.runtime.getURL("overview/overview.html");

// Clicking the icon focuses an existing dashboard tab, or opens a new one.
chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.tabs.query({ url: PAGE });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PAGE });
  }
});
