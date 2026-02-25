/** @file tooltip.js */

import { state } from "./state.js";
import { COLORS, DAYS_LONG } from "./constants.js";
import { esc } from "./utils.js";

/** Main heatmap tooltip element (exists in HTML). */
export function getTooltipEl() {
  return document.getElementById("tooltip");
}

export function moveTip(e, tooltip) {
  const tw = tooltip.offsetWidth || 300;
  const th = tooltip.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = e.clientX + 16;
  let y = e.clientY - 12;

  if (x + tw > vw - 8) x = e.clientX - tw - 12;
  if (y + th > vh - 8) y = vh - th - 8;
  if (y < 8) y = 8;

  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

export function attachGlobalTooltipMousemove() {
  const tooltip = getTooltipEl();
  document.addEventListener("mousemove", (e) => {
    if (tooltip && tooltip.style.display === "block") moveTip(e, tooltip);
  }, { passive: true });
}

/**
 * Heatmap cell tooltip handler.
 * Expects cell.dataset: date, ci.
 */
export function tipForHeatmapCell(e) {
  const tooltip = getTooltipEl();
  if (!tooltip) return;

  const cell = e.currentTarget;
  const d2 = cell.dataset.date;
  const ci = +cell.dataset.ci;

  const c = state.parsedData?.committers?.[ci];
  if (!c) return;

  const color = COLORS[c.colorIndex];

  const dt = new Date(d2 + "T00:00:00");
  const dow = DAYS_LONG[dt.getDay()];
  const dateStr = dt.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });

  const nCommits = c.commits[d2] || 0;
  const nAdded = c.lines_added[d2] || 0;
  const nDeleted = c.lines_deleted[d2] || 0;
  const nFiles = c.files[d2] || 0;

  let html = `
    <div class="tip-header" style="padding:10px 14px 8px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:baseline;justify-content:space-between;gap:10px">
      <span class="tip-date" style="font-size:0.7rem;font-weight:600;color:#f5f2eb;letter-spacing:0.02em">${esc(dateStr)}</span>
      <span class="tip-dow" style="font-size:0.58rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.08em">${esc(dow)}</span>
    </div>

    <div class="tip-summary" style="padding:6px 14px 8px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:14px;align-items:center">
      <div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
        <span class="tip-stat-val" style="font-size:0.72rem;font-weight:600;color:${color}">${nCommits}</span>
        <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">commit${nCommits !== 1 ? "s" : ""}</span>
      </div>
  `;

  if (nAdded || nDeleted) {
    html += `
      <div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
        <span class="tip-stat-val added" style="font-size:0.72rem;font-weight:600;color:#7ec87e">+${nAdded.toLocaleString()}</span>
        <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">added</span>
      </div>
      <div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
        <span class="tip-stat-val deleted" style="font-size:0.72rem;font-weight:600;color:#e08080">−${nDeleted.toLocaleString()}</span>
        <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">deleted</span>
      </div>
    `;
  }

  if (nFiles) {
    html += `
      <div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
        <span class="tip-stat-val" style="font-size:0.72rem;font-weight:600">${nFiles}</span>
        <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">file${nFiles !== 1 ? "s" : ""}</span>
      </div>
    `;
  }
  html += `</div>`;

  const emailSet = new Set(c.emails);
  const dayCommits = (state.commitsByDate[d2] || []).filter(rc => emailSet.has(rc.email));
  dayCommits.sort((a, b) => {
    const at = a.hour >= 0 ? a.hour * 60 + (a.minute >= 0 ? a.minute : 0) : 9999;
    const bt = b.hour >= 0 ? b.hour * 60 + (b.minute >= 0 ? b.minute : 0) : 9999;
    return at - bt;
  });

  const byAuthor = new Map();
  for (const rc of dayCommits) {
    const key = rc.email || "?";
    if (!byAuthor.has(key)) byAuthor.set(key, []);
    byAuthor.get(key).push(rc);
  }

  const MAX_COMMITS_TOTAL = 8;
  const MAX_FILES_PER_COMMIT = 3;
  let shownTotal = 0;

  html += `<div class="tip-commits" style="max-height:280px;overflow-y:auto">`;

  for (const [authorEmail, commits] of byAuthor) {
    const penalisedCount = state.penaliseReverts ? commits.filter(x => x.isRevert).length : 0;

    html += `
      <div class="tip-author-header" style="padding:7px 14px 4px;display:flex;align-items:center;gap:7px">
        <div class="tip-author-dot" style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${color}"></div>
        <span class="tip-author-name" style="font-size:0.62rem;color:rgba(245,242,235,0.8);font-weight:600">${esc(authorEmail)}</span>
        ${penalisedCount ? `<span class="tip-revert-pill" style="margin-left:6px">penalised×${penalisedCount}</span>` : ""}
        <span class="tip-author-sub" style="font-size:0.55rem;color:rgba(245,242,235,0.3);margin-left:auto">${commits.length} commit${commits.length !== 1 ? "s" : ""}</span>
      </div>
    `;

    for (const rc of commits) {
      if (shownTotal >= MAX_COMMITS_TOTAL) break;
      shownTotal++;

      const hash = rc.hash ? rc.hash.slice(0, 7) : "";
      const timeStr =
        rc.hour >= 0 ? `${String(rc.hour).padStart(2, "0")}:${String(rc.minute >= 0 ? rc.minute : 0).padStart(2, "0")}` : "";

      const fa = rc.files.reduce((s, f) => s + f.added, 0);
      const fd = rc.files.reduce((s, f) => s + f.deleted, 0);

      const subj = rc.subject ? (rc.subject.length > 48 ? rc.subject.slice(0, 47) + "…" : rc.subject) : "";

      const topFiles = [...rc.files]
        .sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))
        .slice(0, MAX_FILES_PER_COMMIT);

      html += `
        <div class="tip-commit-row" style="padding:4px 14px 6px 27px">
          <div class="tip-commit-meta" style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px">
            <span class="tip-hash" style="font-size:0.57rem;color:rgba(245,242,235,0.3);letter-spacing:0.04em">${esc(hash)}</span>
            ${timeStr ? `<span class="tip-time" style="font-size:0.57rem;color:rgba(245,242,235,0.3)">${esc(timeStr)}</span>` : ""}
            <span class="tip-changes" style="font-size:0.57rem;display:flex;gap:6px;margin-left:auto">
              ${fa ? `<span class="a" style="color:#7ec87e">+${fa}</span>` : ""}
              ${fd ? `<span class="d" style="color:#e08080">−${fd}</span>` : ""}
            </span>
          </div>

          ${
            subj
              ? `<div class="tip-subject" style="font-size:0.63rem;color:rgba(245,242,235,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px">
                ${esc(subj)}
                ${rc.isMerge ? '<span class="tip-merge-pill">merge</span>' : ""}
                ${rc.touchesVersion ? `<span class="tip-release-pill">release${rc.releaseVersion ? " v" + esc(rc.releaseVersion) : ""}</span>` : ""}
                ${(state.penaliseReverts && rc.isRevert) ? '<span class="tip-revert-pill">penalised</span>' : ""}
              </div>`
              : ""
          }

          <div class="tip-files" style="display:flex;flex-direction:column;gap:1px">
            ${topFiles
              .map(f => {
                const pathParts = f.path.split("/");
                const basename = pathParts[pathParts.length - 1];
                const dir = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") + "/" : "";
                const chgA = f.added ? `<span class="tip-file-chg a" style="color:rgba(126,200,126,0.6)">+${f.added}</span>` : "";
                const chgD = f.deleted ? `<span class="tip-file-chg d" style="color:rgba(224,128,128,0.6)">−${f.deleted}</span>` : "";
                return `
                  <div class="tip-file" style="font-size:0.55rem;color:rgba(245,242,235,0.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px">
                    <span class="tip-file-name" title="${esc(f.path)}" style="overflow:hidden;text-overflow:ellipsis">
                      <span style="opacity:0.4">${esc(dir)}</span>${esc(basename)}
                    </span>
                    ${chgA}${chgD}
                  </div>
                `;
              })
              .join("")}
            ${rc.files.length > MAX_FILES_PER_COMMIT
              ? `<div class="tip-file" style="font-style:italic">+${rc.files.length - MAX_FILES_PER_COMMIT} more file${(rc.files.length - MAX_FILES_PER_COMMIT) !== 1 ? "s" : ""}</div>`
              : ""}
          </div>
        </div>
      `;
    }
  }

  const hiddenCount = dayCommits.length - shownTotal;
  if (hiddenCount > 0) {
    html += `<div class="tip-more" style="padding:6px 14px;color:rgba(245,242,235,0.35);font-family:IBM Plex Mono,monospace;font-size:0.58rem">+${hiddenCount} more commit${hiddenCount !== 1 ? "s" : ""}</div>`;
  }

  html += `</div>`;

  tooltip.innerHTML = html;
  tooltip.style.display = "block";
  moveTip(e, tooltip);
}

/* ─────────────────────────────────────────────────────────────── */
/* Shared floating tooltip for dow-hour cells                       */
/* ─────────────────────────────────────────────────────────────── */

let _dhTipEl = null;

export function ensureDhTipEl() {
  if (_dhTipEl) return _dhTipEl;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;background:var(--ink);color:#f5f2eb;font-family:IBM Plex Mono,monospace;font-size:0.62rem;padding:8px 12px;pointer-events:none;z-index:2000;display:none;white-space:nowrap;line-height:1.8;box-shadow:0 4px 16px rgba(0,0,0,.25)";
  document.body.appendChild(el);
  _dhTipEl = el;
  return el;
}

export function dhTip(e, dayName, hour, val, total) {
  const el = ensureDhTipEl();
  const fmtH = (h) => {
    const ap = h < 12 ? "am" : "pm";
    const h12 = h % 12 || 12;
    return `${h12}:00${ap}`;
  };
  const pct = total ? (val / total * 100).toFixed(1) : "0.0";

  el.innerHTML = `<strong>${esc(dayName)}, ${fmtH(hour)}–${fmtH(hour + 1)}</strong><br>${
    val
  } commit${val !== 1 ? "s" : ""}${val ? ` · ${pct}% of timed activity` : ""}`;

  el.style.display = "block";
  el.style.left = (e.clientX + 14) + "px";
  el.style.top = (e.clientY - 10) + "px";
}

export function hideDhTip() {
  const el = ensureDhTipEl();
  el.style.display = "none";
}

export function attachDhTipScrollHide() {
  document.addEventListener("scroll", hideDhTip, { passive: true });
}