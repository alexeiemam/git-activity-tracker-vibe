/** @file utils.js */

/** Escape HTML for safe innerHTML. */
export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {Date|string} d */
export function ds(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
}

/** @param {string} name */
export function mkInit(name) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** @param {string} name */
export function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

/** Sum values of a map-like object */
export function sumMap(obj) {
  if (!obj) return 0;
  let s = 0;
  for (const v of Object.values(obj)) s += v;
  return s;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** @param {string} subject */
export function parseVersionFromSubject(subject) {
  const s = String(subject || "");
  const re = /\bv?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b/;
  const m = s.match(re);
  return m ? m[1] : null;
}