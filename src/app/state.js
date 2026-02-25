/** @file state.js */

import { DEFAULTS } from "./constants.js";

/**
 * Central mutable app state.
 * Keep *all* cross-module state here so it’s easy to reason about.
 */
export const state = {
  /** @type {Array<any>} */
  rawCommits: [],
  /** @type {Array<{displayName:string, emails:string[], suggested?:boolean}>} */
  mergeGroups: [],
  /** @type {{committers:any[], minDate:string, maxDate:string, hasAnyHourData:boolean}|null} */
  parsedData: null,

  /** @type {Record<string, any[]>} dateStr -> raw commit objects */
  commitsByDate: {},

  /** UI state */
  includeMerges: DEFAULTS.includeMerges,
  penaliseReverts: DEFAULTS.penaliseReverts,
  currentMetric: DEFAULTS.currentMetric,
  activeYear: DEFAULTS.activeYear,
  activeCompTab: DEFAULTS.activeCompTab,

  /** @type {Set<number>} contributor gi hidden in comparison charts */
  hiddenSeries: new Set(),
  /** @type {Set<number>} contributor gi for expanded heatmap years */
  expandedCommitDayHeatmaps: new Set(),
  /** @type {Set<number>} contributor gi pinned in sidebar */
  pinnedContributors: new Set(),
};