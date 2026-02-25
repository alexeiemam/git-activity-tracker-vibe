/** @file constants.js */

export const COLORS = [
  "#c0392b", "#2980b9", "#16a085", "#8e44ad", "#d35400",
  "#27ae60", "#1a6b8a", "#b07d12", "#5d2e8c", "#c0586a",
];

export const PIN_STORAGE_KEY = "git_activity_pins_v1";

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const DEFAULTS = Object.freeze({
  currentMetric: "commits",
  activeYear: "all",
  activeCompTab: "timeline",
  includeMerges: false,
  penaliseReverts: false,
});

export const METRICS = Object.freeze([
  { key: "commits", label: "Commits" },
  { key: "lines_added", label: "Lines Added" },
  { key: "lines_deleted", label: "Lines Deleted" },
  { key: "files", label: "Files Changed" },
  { key: "active_days", label: "Active Days" },
  { key: "releases", label: "Releases" },
]);

export const COMP_TABS = Object.freeze(["timeline", "share", "pace", "h2h"]);