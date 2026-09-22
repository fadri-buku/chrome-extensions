import * as settings from "../lib/settings.js";

const limitInput = document.getElementById("limit");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");

async function refresh() {
  const [limit, wins] = await Promise.all([
    settings.getLimit(),
    chrome.windows.getAll({ windowTypes: ["normal"] }),
  ]);
  limitInput.value = limit;
  const openCount = wins.filter((w) => !w.incognito).length;
  countEl.textContent = `${openCount} window${openCount === 1 ? "" : "s"} open now`;
}

limitInput.addEventListener("change", async () => {
  const clamped = await settings.setLimit(limitInput.value);
  limitInput.value = clamped;
  statusEl.textContent = "Saved — synced to your Chrome profile.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
  refresh();
});

refresh();
