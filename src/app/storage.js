/** @file storage.js */

import { PIN_STORAGE_KEY } from "./constants.js";

export function loadPinnedContributors() {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(x => +x).filter(x => Number.isFinite(x)));
  } catch {
    return new Set();
  }
}

/** @param {Set<number>} pinned */
export function savePinnedContributors(pinned) {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...pinned]));
  } catch {
    // ignore storage failure
  }
}