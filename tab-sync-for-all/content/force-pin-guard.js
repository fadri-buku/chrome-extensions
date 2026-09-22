// Adds a native "leave site?" confirmation before a force-pinned tab is
// closed or navigated away. This is only a deterrent, not a real block —
// Chrome requires the page to have been interacted with at least once for
// the dialog to show, and it never fires for closing the whole browser
// process. The extension's own auto-reopen (background.js) is the real
// safety net; this is just an extra "are you sure" moment on top of it.
(() => {
  const KEY = "forcedUrls";
  let guarding = false;

  function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = "";
    return "";
  }

  function setGuard(active) {
    if (active === guarding) return;
    guarding = active;
    if (active) window.addEventListener("beforeunload", onBeforeUnload);
    else window.removeEventListener("beforeunload", onBeforeUnload);
  }

  async function check() {
    const res = await chrome.storage.local.get(KEY).catch(() => ({}));
    const urls = res[KEY] || [];
    setGuard(urls.includes(location.href));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) check();
  });

  check();
})();
