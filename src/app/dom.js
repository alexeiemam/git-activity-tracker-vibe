/** @file dom.js */

/** Small DOM helpers with caching. */
const byIdCache = new Map();

/** @param {string} id */
export function $(id) {
  if (byIdCache.has(id)) return byIdCache.get(id);
  const el = document.getElementById(id);
  byIdCache.set(id, el);
  return el;
}

/** @param {string} sel @param {ParentNode} [root] */
export function qs(sel, root = document) {
  return root.querySelector(sel);
}

/** @param {string} sel @param {ParentNode} [root] */
export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function clearIdCache() {
  byIdCache.clear();
}