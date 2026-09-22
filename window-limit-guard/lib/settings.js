// Shared settings storage for the configurable window limit.
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
