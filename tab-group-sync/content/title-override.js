// Applies a user-set custom title for this exact page URL, and keeps
// re-applying it if the site's own JS overwrites document.title (common on
// SPAs that update the title on route/data changes).
(() => {
  const TITLES_KEY = "customTitles";
  let currentTitle = null;
  let observer = null;

  async function readStoredTitle() {
    const [syncRes, localRes] = await Promise.all([
      chrome.storage.sync.get(TITLES_KEY).catch(() => ({})),
      chrome.storage.local.get(TITLES_KEY).catch(() => ({})),
    ]);
    const map = { ...(localRes[TITLES_KEY] || {}), ...(syncRes[TITLES_KEY] || {}) };
    return map[location.href] || null;
  }

  function applyTitle(title) {
    currentTitle = title;
    if (document.title !== title) document.title = title;
  }

  function startWatching() {
    if (observer) return;
    const target = document.querySelector("head") || document.documentElement;
    observer = new MutationObserver(() => {
      if (currentTitle && document.title !== currentTitle) {
        document.title = currentTitle;
      }
    });
    observer.observe(target, { subtree: true, childList: true, characterData: true });
  }

  function stopWatching() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    currentTitle = null;
  }

  async function init() {
    const title = await readStoredTitle();
    if (!title) return;
    applyTitle(title);
    startWatching();
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes[TITLES_KEY]) return;
    const map = changes[TITLES_KEY].newValue || {};
    const title = map[location.href];
    if (title) {
      applyTitle(title);
      startWatching();
    } else {
      stopWatching();
    }
  });

  init();
})();
