/** @file main.js */

import { $ } from "./dom.js";
import { state } from "./state.js";
import { loadPinnedContributors } from "./storage.js";
import { parseGitLog, buildCommitsByDate } from "./parse.js";
import { buildInitialGroups, renderMergeUI, addEmptyGroup, skipMerge, showMergeStep, showDashboard } from "./merge.js";
import { aggregate } from "./aggregate.js";
import {
  render,
  setMetric,
  setYear,
  setCompTab,
  renderComparisonPanel,
  toggleSeries,
  toggleCS,
  toggleCommitDayHeatmap,
  jumpToCommitter,
  toggleContributorPin,
} from "./render.js";
import { attachDhTipScrollHide, attachGlobalTooltipMousemove } from "./tooltip.js";

/* ───────────────────────────── */
/* Command + toggles              */
/* ───────────────────────────── */

export function updateCmd() {
  const y = +$("range-select").value;
  const noMergesFlag = $("include-merges")?.checked ? "" : " --no-merges";
  $("git-cmd").textContent =
    `git log --since="${y * 12} months ago"${noMergesFlag} --pretty=format:"COMMIT|%H|%ae|%an|%aI|%s" --numstat | pbcopy`;
}

export function copyCmd() {
  navigator.clipboard.writeText($("git-cmd").textContent).then(() => {
    const b = document.querySelector(".cmd-copy");
    if (!b) return;
    b.textContent = "copied!";
    setTimeout(() => (b.textContent = "copy"), 1500);
  });
}

export function onMergeToggle() {
  updateCmd();
  if (!state.parsedData) {
    state.includeMerges = !!$("include-merges").checked;
    return;
  }
  state.includeMerges = !!$("include-merges").checked;
  reAggregateAndRender();
}

export function onRevertToggle() {
  state.penaliseReverts = !!$("penalise-reverts").checked;
  if (!state.parsedData) return;
  reAggregateAndRender();
}

function reAggregateAndRender() {
  const groups = state.mergeGroups.filter(g => g.emails.length > 0);
  state.parsedData = aggregate(state.rawCommits, groups);
  state.activeYear = "all";
  state.hiddenSeries = new Set();
  render();
}

/* ───────────────────────────── */
/* Parse / Apply / Render         */
/* ───────────────────────────── */

export function parseStep() {
  const raw = $("log-input").value.trim();
  const err = $("parse-error");
  err.textContent = "";

  if (!raw) {
    err.textContent = "Paste git log output first.";
    return;
  }

  try {
    state.rawCommits = parseGitLog(raw);

    state.includeMerges = !!$("include-merges").checked;
    state.penaliseReverts = !!$("penalise-reverts").checked;

    state.commitsByDate = buildCommitsByDate(state.rawCommits);

    buildInitialGroups();
    renderMergeUI();

    showMergeStep();
  } catch (e) {
    err.textContent = e?.message || String(e);
  }
}

export function applyAndRender() {
  const groups = state.mergeGroups.filter(g => g.emails.length > 0);

  state.parsedData = aggregate(state.rawCommits, groups);
  state.activeYear = "all";
  state.hiddenSeries = new Set();

  $("export-btn").style.display = "";

  state.pinnedContributors = loadPinnedContributors();

  showDashboard();
  render();

  $("dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function skipMergeAndRender() {
  skipMerge();
  applyAndRender();
}

/* ───────────────────────────── */
/* Export / Import                */
/* ───────────────────────────── */

export function exportToFile() {
  if (!state.rawCommits.length) {
    alert("Nothing to export yet.");
    return;
  }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    rangeYears: +$("range-select").value,
    rawLog: $("log-input").value,
    mergeGroups: state.mergeGroups.map(g => ({
      displayName: g.displayName,
      emails: [...g.emails],
      suggested: g.suggested || false,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (state.parsedData && state.parsedData.committers.length)
    ? state.parsedData.committers[0].displayName.toLowerCase().replace(/\s+/g, "-")
    : "repo";

  a.download = `git-activity-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

export function importFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch {
      alert("Could not parse file — make sure it is a git-activity JSON export.");
      return;
    }
    if (!payload.rawLog || !payload.mergeGroups) {
      alert("File is missing required fields (rawLog, mergeGroups).");
      return;
    }

    $("log-input").value = payload.rawLog;

    if (payload.rangeYears) {
      $("range-select").value = String(payload.rangeYears);
      updateCmd();
    }

    let commits;
    try {
      commits = parseGitLog(payload.rawLog);
    } catch (err) {
      alert("Log data in file could not be parsed: " + err.message);
      return;
    }

    state.rawCommits = commits;
    state.commitsByDate = buildCommitsByDate(state.rawCommits);

    state.mergeGroups = payload.mergeGroups.map(g => ({
      displayName: g.displayName,
      emails: [...g.emails],
      suggested: g.suggested || false,
    }));

    const knownEmails = new Set(state.rawCommits.map(c => c.email));
    state.mergeGroups = state.mergeGroups
      .map(g => ({ ...g, emails: g.emails.filter(em => knownEmails.has(em)) }))
      .filter(g => g.emails.length > 0);

    // ensure all emails covered
    const coveredEmails = new Set(state.mergeGroups.flatMap(g => g.emails));
    state.rawCommits.forEach(c => {
      if (!coveredEmails.has(c.email)) {
        state.mergeGroups.push({ displayName: c.name || c.email, emails: [c.email], suggested: false });
        coveredEmails.add(c.email);
      }
    });

    $("import-banner-filename").textContent = file.name;
    $("import-banner").classList.add("visible");

    applyAndRender();
  };

  reader.readAsText(file);
  event.target.value = "";
}

export function dismissImportBanner() {
  $("import-banner").classList.remove("visible");
}

/* ───────────────────────────── */
/* Init + legacy onclick bridge   */
/* ───────────────────────────── */

function bridgeToWindow() {
  // Keep your existing HTML working with zero edits
  Object.assign(window, {
    // input
    updateCmd,
    copyCmd,
    parseStep,
    onMergeToggle,
    onRevertToggle,

    // merge step
    addEmptyGroup,
    applyAndRender,
    skipMerge: skipMergeAndRender,

    // dashboard controls
    setMetric,
    setYear,
    setCompTab,
    renderComparisonPanel,
    toggleSeries,
    toggleCS,
    toggleCommitDayHeatmap,
    jumpToCommitter,
    toggleContributorPin,

    // import/export
    exportToFile,
    importFromFile,
    dismissImportBanner,
  });
}

export function init() {
  bridgeToWindow();

  // ensure cmd reflects current toggles on first load
  updateCmd();

  // attach tooltip housekeeping
  attachDhTipScrollHide();
  attachGlobalTooltipMousemove();

  // optional: keep sticky toggles in sync if present (your HTML has both)
  const mSticky = $("include-merges-sticky");
  const rSticky = $("penalise-reverts-sticky");

  if (mSticky) {
    mSticky.onchange = () => {
      const main = $("include-merges");
      if (main) main.checked = mSticky.checked;
      onMergeToggle();
    };
  }

  if (rSticky) {
    rSticky.onchange = () => {
      const main = $("penalise-reverts");
      if (main) main.checked = rSticky.checked;
      onRevertToggle();
    };
  }
}

init();