/** @file render.js */

import { $, qs, qsa } from "./dom.js";
import { state } from "./state.js";
import { COLORS, DAYS_SHORT, METRICS, COMP_TABS } from "./constants.js";
import { ds, esc, mkInit, shortName, sumMap, clamp } from "./utils.js";
import { yrSum, metricLabel, metricValueForContributor } from "./aggregate.js";
import { tipForHeatmapCell, getTooltipEl, hideDhTip, dhTip } from "./tooltip.js";
import { savePinnedContributors } from "./storage.js";

/* ───────────────────────────── */
/* Legacy UI suppression          */
/* ───────────────────────────── */

export function hideExternalControls() {
  const yf = $("year-filter");
  if (yf) yf.style.display = "none";

  const cs = $("contrib-strip");
  if (cs) cs.style.display = "none";

  qsa(".metric-tab, .share-metric-btn").forEach(el => {
    const parent =
      el.closest("#metric-tabs, .metric-tabs, .metric-tabs-wrap, #share-metrics, .share-metrics") || el;
    parent.style.display = "none";
  });

  ["metric-tabs", "share-metrics", "year-filter", "contrib-strip"].forEach(id => {
    const el = $(id);
    if (el) el.style.display = "none";
  });
}

/* ───────────────────────────── */
/* Render entrypoint              */
/* ───────────────────────────── */

export function render() {
  if (!state.parsedData) return;

  const { committers, minDate, maxDate } = state.parsedData;

  hideExternalControls();

  const minY = +minDate.slice(0, 4);
  const maxY = +maxDate.slice(0, 4);
  const years = [];
  for (let y = minY; y <= maxY; y++) years.push(y);

  // summary bar
  const tc = committers.reduce((a, c) => a + yrSum(c.commits), 0);
  const ta = committers.reduce((a, c) => a + yrSum(c.lines_added), 0);
  const td = committers.reduce((a, c) => a + yrSum(c.lines_deleted), 0);

  const activeCommitters = (state.activeYear === "all")
    ? committers
    : committers.filter(c => metricValueForContributor(c, state.currentMetric) > 0);

  $("summary-bar").innerHTML = `
    <div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">Contributors</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-ink">${activeCommitters.length}</div>
    </div>
    <div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">${state.activeYear === "all" ? "Total" : "Year"} Commits</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-ink">${tc.toLocaleString()}</div>
    </div>
    <div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">Lines Added</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-added">+${ta.toLocaleString()}</div>
    </div>
    <div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">Lines Deleted</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-deleted">−${td.toLocaleString()}</div>
    </div>
  `;

  // comparison panel
  renderComparisonPanel();

  // heatmaps + table
  renderHeatmaps(committers, years);
  renderTable(committers);

  // sidebar
  renderSidebarDock();

  hideExternalControls();
}

/* ───────────────────────────── */
/* Comparison panel               */
/* ───────────────────────────── */

export function setCompTab(tab, btn) {
  state.activeCompTab = tab;
  qsa(".comp-tab").forEach(t => t.classList.remove("active"));
  if (btn?.classList) btn.classList.add("active");
  for (const t of COMP_TABS) {
    const el = $(`comp-${t}`);
    if (el) el.style.display = (t === tab ? "" : "none");
  }
  renderComparisonPanel();
}

export function renderComparisonPanel() {
  if (!state.parsedData) return;
  if (state.activeCompTab === "timeline") renderTimeline();
  else if (state.activeCompTab === "share") renderShare();
  else if (state.activeCompTab === "pace") renderPace();
  else if (state.activeCompTab === "h2h") {
    populateH2HSelects();
    renderH2H();
  }
}

/* Timeline */
export function toggleSeries(gi) {
  if (state.hiddenSeries.has(gi)) state.hiddenSeries.delete(gi);
  else state.hiddenSeries.add(gi);
  renderTimeline();
}

function buildWeeks(startDate, endDate) {
  const weeks = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    weeks.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

export function renderTimeline() {
  const { committers, minDate, maxDate } = state.parsedData;

  const W = 1060, H = 220;
  const PAD = { top: 12, right: 24, bottom: 30, left: 48 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const startDate = (state.activeYear === "all") ? new Date(minDate + "T00:00:00") : new Date(state.activeYear + "-01-01");
  const endDate = (state.activeYear === "all") ? new Date(maxDate + "T00:00:00") : new Date(state.activeYear + "-12-31");
  startDate.setDate(startDate.getDate() - startDate.getDay()); // align to week start

  const weeks = buildWeeks(startDate, endDate);
  if (!weeks.length) return;

  const metKey = (state.currentMetric === "active_days") ? "commits" : state.currentMetric;

  const series = committers.map(c => {
    const data = weeks.map(wkStart => {
      let val = 0;
      for (let d = 0; d < 7; d++) {
        const day = new Date(wkStart);
        day.setDate(day.getDate() + d);
        const dk = ds(day);
        if (state.currentMetric === "active_days") {
          if (c.activeDays.has(dk)) val++;
        } else {
          val += (c[metKey] || {})[dk] || 0;
        }
      }
      return val;
    });

    const smooth = data.map((v, i) => {
      const sl = data.slice(Math.max(0, i - 3), i + 1);
      let s = 0; for (const x of sl) s += x;
      return s / sl.length;
    });

    return { c, data, smooth };
  });

  const visibleMax = Math.max(
    ...series.filter(s => !state.hiddenSeries.has(s.c.gi)).flatMap(s => s.smooth),
    1,
  );

  const xS = i => PAD.left + (i / (weeks.length - 1 || 1)) * chartW;
  const yS = v => PAD.top + chartH - (v / visibleMax) * chartH;

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:'IBM Plex Mono',monospace">`;

  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (i / 4) * chartH;
    const val = Math.round(visibleMax * (1 - i / 4));
    svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-width="1"/>`;
    svg += `<text x="${PAD.left - 6}" y="${y}" text-anchor="end" font-size="9" fill="var(--muted)" dominant-baseline="middle">${val}</text>`;
  }

  let lastMonth = -1;
  weeks.forEach((wk, i) => {
    const m = wk.getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      const x = xS(i);
      const lbl = wk.toLocaleString("default", { month: "short" });
      svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + chartH}" stroke="var(--border2)" stroke-width="1" opacity="0.5"/>`;
      svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${lbl}</text>`;
    }
  });

  for (const { c, smooth } of series) {
    if (state.hiddenSeries.has(c.gi)) continue;
    const color = COLORS[c.colorIndex];
    const pts = smooth.map((v, i) => `${xS(i)},${yS(v)}`).join(" ");
    const area = `${pts} ${xS(smooth.length - 1)},${PAD.top + chartH} ${xS(0)},${PAD.top + chartH}`;
    svg += `<polygon points="${area}" fill="${color}" opacity="0.08"/>`;
    svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  svg += `</svg>`;

  $("timeline-svg-wrap").innerHTML = svg;

  $("timeline-legend").innerHTML = committers.map(c => `
    <div class="legend-item inline-flex cursor-pointer select-none items-center gap-1.5 font-mono text-[0.65rem] text-ink transition ${state.hiddenSeries.has(c.gi) ? "opacity-30" : ""}"
         onclick="toggleSeries(${c.gi})">
      <div class="legend-dot h-2.5 w-2.5 flex-shrink-0 rounded-full" style="background:${COLORS[c.colorIndex]}"></div>
      ${esc(c.displayName)}
    </div>
  `).join("");

  const wrap = $("timeline-svg-wrap");
  const svgEl = wrap.querySelector("svg");
  const cursor = $("timeline-cursor");
  const tip = $("timeline-tip");

  cursor.style.height = H + "px";

  svgEl.onmousemove = (e) => {
    const rect = svgEl.getBoundingClientRect();
    const scaleX = rect.width / W;
    const relX = e.clientX - rect.left;
    const chartRelX = relX / scaleX - PAD.left;

    if (chartRelX < 0 || chartRelX > chartW) {
      cursor.style.display = "none";
      tip.style.display = "none";
      return;
    }

    const idx = clamp(Math.round(chartRelX / chartW * (weeks.length - 1)), 0, weeks.length - 1);
    const xPx = xS(idx) * scaleX;

    cursor.style.display = "block";
    cursor.style.left = xPx + "px";

    const wkLabel = weeks[idx].toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });

    const lines = series
      .filter(s => !state.hiddenSeries.has(s.c.gi))
      .sort((a, b) => b.smooth[idx] - a.smooth[idx])
      .map(s => `<span style="color:${COLORS[s.c.colorIndex]}">■</span> ${esc(s.c.displayName)}: <strong>${Math.round(s.data[idx])}</strong>`)
      .join("<br>");

    tip.innerHTML = `<strong style="display:block;margin-bottom:4px">Week of ${esc(wkLabel)}</strong>${lines}`;
    tip.style.display = "block";

    const tipW = tip.offsetWidth || 160;
    tip.style.left = (relX > rect.width * 0.6 ? relX / scaleX - tipW - 10 : relX / scaleX + 14) + "px";
  };

  svgEl.onmouseleave = () => {
    cursor.style.display = "none";
    tip.style.display = "none";
  };
}

/* Share */
export function renderShare() {
  const { committers } = state.parsedData;

  const key = state.currentMetric;
  const vals = committers.map(c => metricValueForContributor(c, key));
  const total = vals.reduce((a, b) => a + b, 0) || 1;

  const label = metricLabel(key);
  const scope = state.activeYear === "all" ? "All years" : `Year ${state.activeYear}`;

  const header = `
    <div class="mb-3 flex items-center justify-between">
      <div class="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Metric</div>
      <div class="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 font-mono text-[0.65rem] text-ink">
        <span class="opacity-70">${esc(label)}</span>
        <span class="opacity-30">·</span>
        <span class="opacity-70">${esc(scope)}</span>
      </div>
    </div>
  `;

  const barsEl = $("share-bars");
  if (!barsEl) return;

  barsEl.innerHTML = header + committers.map((c, i) => {
    const val = vals[i];
    const pct = (val / total * 100).toFixed(1);
    const color = COLORS[c.colorIndex];
    const unit = (key === "active_days") ? "days" : label.toLowerCase();

    return `
      <div class="share-row mb-2.5 flex items-center gap-3">
        <div class="share-name w-[130px] flex-shrink-0 truncate font-mono text-[0.7rem] text-ink" title="${esc(c.displayName)}">${esc(c.displayName)}</div>
        <div class="share-bar-track h-[22px] flex-1 overflow-hidden rounded-[2px] bg-c0">
          <div class="share-bar-fill flex h-full items-center rounded-[2px] transition-[width] duration-500 ease-[cubic-bezier(.22,.61,.36,1)]"
               style="width:${pct}%;background:${color}">
            ${+pct > 8 ? `<span class="share-pct pl-2 font-mono text-[0.6rem] text-white/90 whitespace-nowrap">${pct}%</span>` : ""}
          </div>
        </div>
        <div class="share-abs w-[120px] flex-shrink-0 text-right font-mono text-[0.62rem] text-muted">${val.toLocaleString()} ${esc(unit)}</div>
      </div>
    `;
  }).join("");
}

/* Pace */
export function renderPace() {
  const { committers } = state.parsedData;

  const W = 1060, H = 240;
  const PAD = { top: 12, right: 100, bottom: 30, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const metKey = (state.currentMetric === "active_days") ? "commits" : state.currentMetric;

  const allDates = [...new Set(committers.flatMap(c => Object.keys((c[metKey] || c.commits) || {})))].sort();
  const filtered = (state.activeYear === "all") ? allDates : allDates.filter(d => d.startsWith(String(state.activeYear)));

  const wrap = $("pace-svg-wrap");
  if (!filtered.length) {
    wrap.innerHTML = `<p style="font:0.7rem IBM Plex Mono,monospace;color:var(--muted);padding:20px 0">No data for this period.</p>`;
    return;
  }

  const series = committers.map(c => {
    let cum = 0;
    const pts = filtered.map(d => {
      if (state.currentMetric === "active_days") {
        if (c.activeDays.has(d)) cum++;
      } else {
        cum += ((c[metKey] || {})[d] || 0);
      }
      return cum;
    });
    return { c, pts };
  });

  const maxVal = Math.max(...series.map(s => s.pts[s.pts.length - 1] || 0), 1);
  const xS = i => PAD.left + (i / (filtered.length - 1 || 1)) * chartW;
  const yS = v => PAD.top + chartH - (v / maxVal) * chartH;

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:'IBM Plex Mono',monospace">`;

  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (i / 4) * chartH;
    const val = Math.round(maxVal * (1 - i / 4));
    svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-width="1"/>`;
    svg += `<text x="${PAD.left - 6}" y="${y}" text-anchor="end" font-size="9" fill="var(--muted)" dominant-baseline="middle">${val}</text>`;
  }

  let lastMonth = -1;
  filtered.forEach((d, i) => {
    const m = new Date(d + "T00:00:00").getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      const x = xS(i);
      const lbl = new Date(d + "T00:00:00").toLocaleString("default", { month: "short" });
      svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(lbl)}</text>`;
    }
  });

  for (const { c, pts } of series) {
    if (state.hiddenSeries.has(c.gi)) continue;
    const color = COLORS[c.colorIndex];
    const polyPts = pts.map((v, i) => `${xS(i)},${yS(v)}`).join(" ");
    svg += `<polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    const lx = xS(pts.length - 1);
    const ly = yS(pts[pts.length - 1]);
    svg += `<circle cx="${lx}" cy="${ly}" r="4" fill="${color}"/>`;
    svg += `<text x="${lx + 8}" y="${ly}" font-size="10" fill="${color}" dominant-baseline="middle" font-weight="600">${esc(c.displayName.split(" ")[0])}</text>`;
  }

  svg += `</svg>`;
  wrap.innerHTML = svg;

  const labels = {
    commits: "commits",
    lines_added: "lines added",
    lines_deleted: "lines deleted",
    files: "files changed",
    active_days: "active days",
    releases: "releases",
  };
  $("pace-info").textContent =
    `Cumulative ${labels[state.currentMetric] || state.currentMetric} over time — a steeper slope means a faster pace. Click contributors in the Timeline legend to show/hide.`;
}

/* H2H */
function longestStreak(days) {
  const sorted = [...days].sort();
  if (!sorted.length) return 0;
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00");
    const curr = new Date(sorted[i] + "T00:00:00");
    if ((curr - prev) / 86400000 === 1) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 1;
  }
  return max;
}

function longestConsecutiveWorkdays(days) {
  const CUTOVER = "2024-08-01";
  const uniqSorted = [...new Set(days)].sort();
  if (!uniqSorted.length) return 0;

  const dowOf = d => new Date(d + "T12:00:00").getDay();
  const daysDiff = (a, b) => (new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000;

  const isCounted = (dateStr, dow) => {
    if (dateStr < CUTOVER) return dow >= 1 && dow <= 5;
    return dow >= 1 && dow <= 4;
  };

  const isNextWorkday = (prevDate, prevDow, curDate, curDow) => {
    const diff = daysDiff(prevDate, curDate);

    if (prevDate < CUTOVER) {
      if (prevDow >= 1 && prevDow <= 4) return diff === 1 && curDow === prevDow + 1;
      if (prevDow === 5) return diff === 3 && curDow === 1;
      return false;
    } else {
      if (prevDow >= 1 && prevDow <= 3) return diff === 1 && curDow === prevDow + 1;
      if (prevDow === 4) return diff === 4 && curDow === 1;
      return false;
    }
  };

  const workdays = uniqSorted.filter(d => isCounted(d, dowOf(d)));
  if (!workdays.length) return 0;

  let max = 1, cur = 1;
  for (let i = 1; i < workdays.length; i++) {
    const prev = workdays[i - 1];
    const currD = workdays[i];
    const prevDow = dowOf(prev);
    const currDow = dowOf(currD);

    if (isNextWorkday(prev, prevDow, currD, currDow)) {
      cur++;
      if (cur > max) max = cur;
    } else cur = 1;
  }
  return max;
}

export function populateH2HSelects() {
  const { committers } = state.parsedData;
  ["h2h-a", "h2h-b"].forEach((id, idx) => {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = committers.map((c, i) =>
      `<option value="${i}" ${(prev === String(i) || (prev === "" && i === idx)) ? "selected" : ""}>${esc(c.displayName)}</option>`
    ).join("");
  });
}

export function renderH2H() {
  const { committers } = state.parsedData;
  const ai = +$("h2h-a").value;
  const bi = +$("h2h-b").value;
  const a = committers[ai];
  const b = committers[bi];
  if (!a || !b) return;

  const cA = COLORS[a.colorIndex];
  const cB = COLORS[b.colorIndex];

  const mkInit2 = c => c.displayName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  $("h2h-header").innerHTML = [a, b].map((c, idx) => {
    const col = idx === 0 ? cA : cB;
    return `
      <div class="h2h-header-cell bg-surface px-5 py-4" style="border-top:3px solid ${col}">
        <div class="label mb-2 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted">${idx === 0 ? "Contributor A" : "Contributor B"}</div>
        <div class="h2h-name-row flex items-center gap-2.5">
          <div class="avatar flex h-7 w-7 items-center justify-center rounded-full font-mono text-[0.65rem] font-semibold text-white" style="background:${col}">${mkInit2(c)}</div>
          <div>
            <div class="h2h-name font-mono text-[0.82rem] font-semibold" style="color:${col}">${esc(c.displayName)}</div>
            <div class="h2h-email font-mono text-[0.58rem] text-muted">${c.emails.slice(0, 2).map(esc).join(", ")}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  function getV(c, key) {
    const scopedDays = (state.activeYear === "all") ? [...c.activeDays] : [...c.activeDays].filter(d => d.startsWith(String(state.activeYear)));
    if (key === "active_days") return scopedDays.length;
    if (key === "streak") return longestStreak(scopedDays);
    if (key === "workday_streak") return longestConsecutiveWorkdays(scopedDays);
    if (key === "avg_commit_size") {
      const commits = yrSum(c.commits) || 1;
      return Math.round((yrSum(c.lines_added) + yrSum(c.lines_deleted)) / commits);
    }
    if (key === "avg_daily") {
      const ad = scopedDays.length || 1;
      return +(yrSum(c.commits) / ad).toFixed(2);
    }
    return yrSum(c[key] || c.commits);
  }

  const metrics = [
    { key: "commits", label: "Commits", fmt: v => v.toLocaleString() },
    { key: "lines_added", label: "Lines Added", fmt: v => "+" + v.toLocaleString() },
    { key: "lines_deleted", label: "Lines Deleted", fmt: v => "−" + v.toLocaleString() },
    { key: "files", label: "Files Changed", fmt: v => v.toLocaleString() },
    { key: "active_days", label: "Active Days", fmt: v => v + " days" },
    { key: "streak", label: "Longest Streak", fmt: v => v + " days" },
    { key: "workday_streak", label: "Longest Consecutive Workdays (Mon–Thu)", fmt: v => v + " days" },
    { key: "avg_daily", label: "Commits / Active Day", fmt: v => v.toFixed(2) },
    { key: "avg_commit_size", label: "Avg Lines / Commit", fmt: v => v.toLocaleString() },
    { key: "releases", label: "Releases", fmt: v => v.toLocaleString() },
  ];

  $("h2h-metrics").innerHTML = metrics.map(m => {
    const av = getV(a, m.key);
    const bv = getV(b, m.key);

    const aWin = av > bv;
    const bWin = bv > av;
    const tie = av === bv;

    const mx = Math.max(av, bv) || 1;
    const aW = (av / mx) * 44;
    const bW = (bv / mx) * 44;

    return `
      <div class="h2h-metric-row grid grid-cols-[1fr_auto_1fr] items-stretch border-b border-border2 last:border-b-0">
        <div class="h2h-val left flex items-center justify-end px-4 py-3.5 font-mono text-[0.8rem] font-semibold ${aWin ? "win" : ""}" style="${aWin ? "color:" + cA : ""}">
          ${aWin ? `<span style="font-size:0.55rem;margin-right:6px;color:${cA}">▲</span>` : ""}${m.fmt(av)}
        </div>

        <div class="h2h-mid flex min-w-[120px] flex-col items-center justify-center gap-1.5 border-x border-border2 bg-bg px-4 py-3.5 text-center font-mono text-[0.58rem] uppercase tracking-[0.08em] text-muted">
          <span>${esc(m.label)}</span>
          <div class="h2h-sparkbar relative h-1.5 w-[90px] overflow-hidden rounded-full bg-c0">
            <div class="h2h-sparkbar-l absolute right-1/2 top-0 h-full rounded-l-full" style="width:${aW}%;background:${cA};opacity:0.8"></div>
            <div class="h2h-sparkbar-r absolute left-1/2 top-0 h-full rounded-r-full" style="width:${bW}%;background:${cB};opacity:0.8"></div>
          </div>
          ${tie ? `<span style="font-size:0.55rem;color:var(--muted)">tie</span>` : ""}
        </div>

        <div class="h2h-val right flex items-center justify-start px-4 py-3.5 font-mono text-[0.8rem] font-semibold ${bWin ? "win" : ""}" style="${bWin ? "color:" + cB : ""}">
          ${m.fmt(bv)}${bWin ? `<span style="font-size:0.55rem;margin-left:6px;color:${cB}">▲</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

/* ───────────────────────────── */
/* Heatmaps + charts              */
/* ───────────────────────────── */

function buildYearWeeks(year) {
  const s = new Date(year, 0, 1);
  s.setDate(s.getDate() - s.getDay());
  const e = new Date(year, 11, 31);
  e.setDate(e.getDate() + (6 - e.getDay()));

  const weeks = [];
  let cur = new Date(s);
  let wk = [];
  while (cur <= e) {
    wk.push(new Date(cur));
    if (cur.getDay() === 6) {
      weeks.push(wk);
      wk = [];
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (wk.length) weeks.push(wk);
  return weeks;
}

function monthLabels(weeks) {
  let lm = -1;
  return weeks.map(w => {
    const m = w[0].getMonth();
    if (m !== lm) {
      lm = m;
      return w[0].toLocaleString("default", { month: "short" });
    }
    return "";
  });
}

function level(val, max) {
  if (!val || max === 0) return 0;
  const r = val / max;
  return r < 0.15 ? 1 : r < 0.4 ? 2 : r < 0.7 ? 3 : 4;
}

function metricMap(c) {
  if (state.currentMetric === "active_days") {
    const m = {};
    c.activeDays.forEach(d => (m[d] = 1));
    return m;
  }
  return c[state.currentMetric === "files" ? "files" : state.currentMetric] || c.commits;
}

function maxForMetric(map) {
  if (state.activeYear === "all") return Math.max(...Object.values(map || {}), 1);
  const p = String(state.activeYear);
  const vals = Object.entries(map || {}).filter(([d]) => d.startsWith(p)).map(([, v]) => v);
  return Math.max(...vals, 1);
}

export function toggleCommitDayHeatmap(gi, e) {
  if (e?.stopPropagation) e.stopPropagation();
  gi = +gi;
  if (!Number.isFinite(gi)) return;

  if (state.expandedCommitDayHeatmaps.has(gi)) state.expandedCommitDayHeatmaps.delete(gi);
  else state.expandedCommitDayHeatmaps.add(gi);

  render();
}

export function toggleCS(ci) {
  $(`cs-${ci}`)?.classList.toggle("collapsed");
}

export function jumpToCommitter(gi) {
  const idx = state.parsedData.committers.findIndex(c => c.gi === gi);
  if (idx < 0) return;

  const el = $(`cs-${idx}`);
  if (!el) return;

  el.classList.remove("collapsed");
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function renderHeatmaps(committers, years) {
  const container = $("committer-heatmaps");
  container.innerHTML = "";

  const tooltip = getTooltipEl();

  committers.forEach((c, ci) => {
    const color = COLORS[c.colorIndex];
    const initials = mkInit(c.displayName);

    const section = document.createElement("div");
    section.className = "committer-section mb-9 overflow-hidden border border-border bg-surface";
    section.id = `cs-${ci}`;

    const tc = yrSum(c.commits);
    const ta = yrSum(c.lines_added);
    const td = yrSum(c.lines_deleted);
    const tad = state.activeYear === "all"
      ? c.totalActiveDays
      : [...c.activeDays].filter(d => d.startsWith(String(state.activeYear))).length;

    section.innerHTML = `
      <div class="committer-header flex cursor-pointer select-none items-center gap-4 border-b border-border2 px-6 py-4 hover:bg-bg" onclick="toggleCS(${ci})">
        <div class="avatar flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-mono text-[0.75rem] font-semibold text-white" style="background:${color}">${initials}</div>
        <div class="min-w-0">
          <div class="committer-name font-mono text-[0.85rem] font-semibold text-ink">${esc(c.displayName)}</div>
          <div class="committer-emails mt-0.5 font-mono text-[0.63rem] text-muted">${c.emails.map(esc).join(" · ")}</div>
        </div>
        <div class="committer-meta ml-auto flex flex-wrap justify-end gap-4 font-mono text-[0.7rem] text-muted">
          <span><span class="hi font-semibold text-ink">${tc.toLocaleString()}</span> commits</span>
          <span><span class="hi font-semibold" style="color:var(--added)">+${ta.toLocaleString()}</span></span>
          <span><span class="hi font-semibold" style="color:var(--deleted)">−${td.toLocaleString()}</span></span>
          <span><span class="hi font-semibold text-ink">${tad}</span> active days</span>
        </div>
        <span class="chevron ml-2 flex-shrink-0 text-[0.65rem] text-muted">▼</span>
      </div>

      <div class="committer-body px-6 pb-7 pt-6">
        ${
          (state.activeYear === "all" && years.length > 1)
            ? `
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">--</div>
                <button
                  class="border border-border bg-transparent px-3 py-1 font-mono text-[0.62rem] text-muted transition hover:border-ink hover:text-ink"
                  onclick="toggleCommitDayHeatmap(${c.gi}, event)"
                >
                  ${
                    state.expandedCommitDayHeatmaps.has(c.gi)
                      ? `<span class="text-ink">Showing all years</span><span class="opacity-60"> · Collapse to 1 year</span>`
                      : `<span class="text-ink">Showing ${years[years.length - 1]}</span><span class="opacity-60"> · Show all years</span>`
                  }
                </button>
              </div>
            `
            : `<div class="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">--</div>`
        }

        <div id="yr-${ci}"></div>

        <div class="legend mt-4 flex items-center gap-1.5 font-mono text-[0.6rem] text-muted">
          Less
          <div class="legend-cells flex gap-1.5">
            ${[0,1,2,3,4].map(l => `<div class="legend-cell h-3 w-3 rounded-[2px]" style="background:var(--c${l})"></div>`).join("")}
          </div>
          More
        </div>
      </div>
    `;

    container.appendChild(section);

    const latestYear = years[years.length - 1];

    let displayYears;
    if (state.activeYear === "all") {
      displayYears = state.expandedCommitDayHeatmaps.has(c.gi) ? years : [latestYear];
    } else {
      displayYears = [+state.activeYear];
    }

    const metMap = metricMap(c);
    const mxVal = maxForMetric(metMap);
    const yrContainer = section.querySelector(`#yr-${ci}`);

    for (const year of displayYears) {
      const wks = buildYearWeeks(year);
      const mls = monthLabels(wks);

      const rowDiv = document.createElement("div");
      rowDiv.className = "year-row mb-5";

      if (displayYears.length > 1) {
        rowDiv.innerHTML =
          `<div class="year-row-label mb-2 border-l-[3px] border-border pl-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted">${year}</div>`;
      }

      const wrap = document.createElement("div");
      wrap.className = "heatmap-wrap overflow-x-auto pb-1";

      const DL_W = 30;
      const weekSlot = 15;

      const mlRow = document.createElement("div");
      mlRow.className = "month-labels relative mb-1 h-[14px] min-w-[580px]";
      mls.forEach((ml, wi) => {
        if (!ml) return;
        const s = document.createElement("div");
        s.className = "month-label-item absolute top-0 whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-[0.05em] text-muted";
        s.textContent = ml;
        s.style.left = (DL_W + wi * weekSlot) + "px";
        mlRow.appendChild(s);
      });
      wrap.appendChild(mlRow);

      const grid = document.createElement("div");
      grid.className = "heatmap-grid-row flex min-w-[580px] items-start gap-1.5";

      const dlCol = document.createElement("div");
      dlCol.className = "day-labels-col flex w-6 flex-shrink-0 flex-col gap-[3px] pt-[1px]";
      for (let d = 0; d < 7; d++) {
        const el = document.createElement("div");
        el.className = "day-label h-3 pr-1 text-right font-mono text-[0.55rem] leading-3 text-muted";
        el.textContent = d % 2 === 1 ? DAYS_SHORT[d] : "";
        dlCol.appendChild(el);
      }
      grid.appendChild(dlCol);

      const weeksDiv = document.createElement("div");
      weeksDiv.className = "heatmap-weeks flex flex-1 gap-[3px]";

      wks.forEach(week => {
        const wkDiv = document.createElement("div");
        wkDiv.className = "heatmap-week flex flex-col gap-[3px]";
        week.forEach(day => {
          const d2 = ds(day);
          const inYear = d2.startsWith(String(year));
          const val = metMap[d2] || 0;

          const cell = document.createElement("div");
          cell.className = "heatmap-cell" + (inYear ? "" : " faded");
          cell.dataset.level = inYear ? level(val, mxVal) : 0;
          cell.dataset.date = d2;
          cell.dataset.val = val;
          cell.dataset.ci = String(ci);

          if (inYear) {
            cell.addEventListener("mouseenter", tipForHeatmapCell);
            cell.addEventListener("mouseleave", () => { if (tooltip) tooltip.style.display = "none"; });
          }

          wkDiv.appendChild(cell);
        });
        weeksDiv.appendChild(wkDiv);
      });

      grid.appendChild(weeksDiv);
      wrap.appendChild(grid);
      rowDiv.appendChild(wrap);
      yrContainer.appendChild(rowDiv);
    }
  });
}

/* Table */
export function renderTable(committers) {
  const mc = Math.max(...committers.map(c => yrSum(c.commits)), 1);

  $("summary-tbody").innerHTML = committers.map(c => {
    const color = COLORS[c.colorIndex];

    const tc = yrSum(c.commits);
    const ta = yrSum(c.lines_added);
    const td = yrSum(c.lines_deleted);
    const tf = yrSum(c.files);
    const tr = yrSum(c.releases);

    const tad = state.activeYear === "all"
      ? c.totalActiveDays
      : [...c.activeDays].filter(d => d.startsWith(String(state.activeYear))).length;

    const bw = Math.round((tc / mc) * 80);

    return `
      <tr class="hover:bg-bg">
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">
          <span class="inline-flex items-center gap-2">
            <span class="avatar inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[0.6rem] font-semibold text-white" style="background:${color}">${mkInit(c.displayName)}</span>
            ${esc(c.displayName)}
            ${c.emails.length > 1 ? `<span class="text-[0.6rem] text-muted">(${c.emails.length} emails)</span>` : ""}
          </span>
        </td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">
          ${tc.toLocaleString()}
          <span class="bar-inline ml-2 inline-block h-2 align-middle opacity-60" style="width:${bw}px;background:${color};border-radius:1px;"></span>
        </td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle" style="color:var(--added)">+${ta.toLocaleString()}</td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle" style="color:var(--deleted)">−${td.toLocaleString()}</td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${tf.toLocaleString()}</td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${tad}</td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${tr.toLocaleString()}</td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${c.firstCommit || "—"}</td>
        <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${c.lastCommit || "—"}</td>
      </tr>
    `;
  }).join("");
}

/* Sidebar */
export function toggleContributorPin(e, gi) {
  if (e?.stopPropagation) e.stopPropagation();
  gi = +gi;
  if (!Number.isFinite(gi)) return;

  if (state.pinnedContributors.has(gi)) state.pinnedContributors.delete(gi);
  else state.pinnedContributors.add(gi);

  savePinnedContributors(state.pinnedContributors);
  renderSidebarContributors();
}

function renderSidebarContributors() {
  const pinnedSlot = $("sticky-contrib-pinned");
  const activeSlot = $("sticky-contrib-active");
  const metaEl = $("sidebar-contrib-meta");
  if (!pinnedSlot || !activeSlot) return;

  if (!state.parsedData) {
    pinnedSlot.innerHTML = "";
    activeSlot.innerHTML = "";
    if (metaEl) metaEl.textContent = "";
    return;
  }

  const { committers } = state.parsedData;

  const pinnedList = committers
    .filter(c => state.pinnedContributors.has(c.gi))
    .sort((a, b) => metricValueForContributor(b, state.currentMetric) - metricValueForContributor(a, state.currentMetric));

  const activeList = (state.activeYear === "all" ? committers : committers.filter(c => metricValueForContributor(c, state.currentMetric) > 0))
    .filter(c => !state.pinnedContributors.has(c.gi))
    .sort((a, b) => metricValueForContributor(b, state.currentMetric) - metricValueForContributor(a, state.currentMetric));

  if (metaEl) {
    const count = (state.activeYear === "all")
      ? committers.length
      : committers.filter(c => metricValueForContributor(c, state.currentMetric) > 0).length;
    metaEl.textContent = state.activeYear === "all" ? `${count} total` : `${count} active in ${state.activeYear}`;
  }

  const rowHTML = (c, isPinned) => {
    const color = COLORS[c.colorIndex];
    const label = shortName(c.displayName);

    const v = metricValueForContributor(c, state.currentMetric);
    const unit = (state.currentMetric === "active_days") ? "days" : metricLabel(state.currentMetric).toLowerCase();
    const sub = `${v.toLocaleString()} ${unit}` + (state.activeYear === "all" ? "" : ` · ${state.activeYear}`);

    return `
      <div class="sidebar-btn" role="button" tabindex="0" onclick="jumpToCommitter(${c.gi})" title="${esc(c.displayName)}">
        <span class="sidebar-mini" style="background:${color}">${mkInit(c.displayName)}</span>
        <span class="sidebar-main">
          <span class="sidebar-name">${esc(label)}</span>
          <span class="sidebar-subtxt">${esc(sub)}</span>
        </span>
        <button class="sidebar-pin ${isPinned ? "pinned" : ""}"
                title="${isPinned ? "Unpin" : "Pin"}"
                aria-label="${isPinned ? "Unpin contributor" : "Pin contributor"}"
                onclick="toggleContributorPin(event, ${c.gi})">
          ${isPinned ? "★" : "☆"}
        </button>
      </div>
    `;
  };

  pinnedSlot.innerHTML = pinnedList.length
    ? pinnedList.map(c => rowHTML(c, true)).join("")
    : `<div class="sidebar-empty">Pin contributors to keep them visible across years.</div>`;

  activeSlot.innerHTML = activeList.length
    ? activeList.map(c => rowHTML(c, false)).join("")
    : `<div class="sidebar-empty">No active contributors in this ${state.activeYear === "all" ? "range" : "year"}.</div>`;
}

function renderSidebarMetricList() {
  const slot = $("sticky-metric-slot");
  if (!slot) return;

  slot.innerHTML = METRICS.map(it => `
    <button class="sidebar-btn ${state.currentMetric === it.key ? "active" : ""}" onclick="setMetric('${it.key}', this)">
      <span class="sidebar-dot" style="background:${state.currentMetric === it.key ? "rgba(245,242,235,0.35)" : "rgba(26,24,20,0.18)"}"></span>
      <span class="sidebar-name">${esc(it.label)}</span>
    </button>
  `).join("");
}

function renderSidebarYearPills() {
  const slot = $("sticky-year-slot");
  if (!slot || !state.parsedData) return;

  const { minDate, maxDate } = state.parsedData;
  const minY = +minDate.slice(0, 4);
  const maxY = +maxDate.slice(0, 4);

  let html = `<button class="sidebar-pill ${state.activeYear === "all" ? "active" : ""}" onclick="setYear('all', this)">All</button>`;
  for (let y = minY; y <= maxY; y++) {
    html += `<button class="sidebar-pill ${state.activeYear == y ? "active" : ""}" onclick="setYear(${y}, this)">${y}</button>`;
  }
  slot.innerHTML = html;
}

export function renderSidebarDock() {
  renderSidebarContributors();
  renderSidebarMetricList();
  renderSidebarYearPills();
}

/* Metric/year setters */
export function refreshCells() {
  if (!state.parsedData) return;

  state.parsedData.committers.forEach((c, ci) => {
    const mm = metricMap(c);
    const mx = maxForMetric(mm);
    qsa(`#cs-${ci} .heatmap-cell:not(.faded)`).forEach(cell => {
      const v = mm[cell.dataset.date] || 0;
      cell.dataset.level = level(v, mx);
      cell.dataset.val = v;
    });
  });
}

export function setMetric(m, btn) {
  state.currentMetric = m;

  qsa(".metric-tab").forEach(t => t.classList.remove("active"));
  if (btn?.classList) btn.classList.add("active");

  refreshCells();
  renderTable(state.parsedData.committers);
  renderComparisonPanel();
  renderSidebarDock();
}

export function setYear(y, btn) {
  state.activeYear = y;
  qsa(".year-btn").forEach(b => b.classList.remove("active"));
  if (btn?.classList) btn.classList.add("active");
  render();
}