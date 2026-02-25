/** @file merge.js */

import { $, qs } from "./dom.js";
import { esc } from "./utils.js";
import { state } from "./state.js";

/** Build initial mergeGroups suggestion (by same display name). */
export function buildInitialGroups() {
  const byEmail = {};
  for (const c of state.rawCommits) {
    if (!byEmail[c.email]) byEmail[c.email] = { email: c.email, names: [] };
    if (!byEmail[c.email].names.includes(c.name)) byEmail[c.email].names.push(c.name);
  }

  const ids = Object.values(byEmail).map(i => ({
    email: i.email,
    name: i.names.sort((a, b) => b.length - a.length)[0],
  }));

  const byName = {};
  ids.forEach(id => {
    const k = id.name.toLowerCase().trim();
    if (!byName[k]) byName[k] = [];
    byName[k].push(id);
  });

  const mergeGroups = [];
  const placed = new Set();

  Object.entries(byName).forEach(([, grp]) => {
    if (grp.length > 1) {
      mergeGroups.push({
        displayName: grp[0].name,
        emails: grp.map(g => g.email),
        suggested: true,
      });
      grp.forEach(g => placed.add(g.email));
    }
  });

  ids
    .filter(i => !placed.has(i.email))
    .forEach(i =>
      mergeGroups.push({ displayName: i.name, emails: [i.email], suggested: false }),
    );

  state.mergeGroups = mergeGroups;
}

function emailsNotInGroup(gi) {
  return state.mergeGroups.flatMap((g, i) =>
    i === gi ? [] : g.emails.map(e => ({ email: e, fromGroup: i, fromName: g.displayName })),
  );
}

export function renderMergeUI() {
  const c = $("merge-groups");
  c.innerHTML = "";

  state.mergeGroups.forEach((g, gi) => {
    const avail = emailsNotInGroup(gi);
    const div = document.createElement("div");
    div.className = "merge-group flex flex-wrap items-start gap-4 border border-border bg-surface px-4 py-3.5";

    div.innerHTML = `
      <div class="mg-name-col min-w-[200px] flex-shrink-0">
        <div class="merge-group-label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
          Display name${
            g.suggested
              ? '<span class="suggestion-badge ml-2 inline-block rounded-full border border-mergeborder bg-[#e0c84a22] px-2 py-[2px] font-mono text-[0.58rem] text-[#7a5c00]">auto</span>'
              : ""
          }
        </div>
        <input class="mg-name-input w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-[0.78rem] text-ink outline-none focus:border-accent"
               type="text" value="${esc(g.displayName)}" data-gi="${gi}"/>
      </div>

      <div class="mg-emails-col min-w-[260px] flex-1">
        <div class="merge-group-label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
          Emails (${g.emails.length})
        </div>

        <div class="identity-chips mb-2 flex min-h-[28px] flex-wrap gap-1.5">
          ${g.emails
            .map(
              e => `<span class="identity-chip inline-flex items-center gap-1.5 rounded-[2px] border border-border bg-bg px-2 py-1 font-mono text-[0.65rem]">
                <span>${esc(e)}</span>
                ${
                  g.emails.length > 1
                    ? `<button class="chip-remove border-0 bg-transparent p-0 text-[0.8rem] leading-none text-muted transition hover:text-accent" data-split-gi="${gi}" data-split-email="${esc(
                        e,
                      )}">✕</button>`
                    : ""
                }
              </span>`,
            )
            .join("")}
        </div>

        <div class="merge-add-row flex items-center gap-2">
          <select class="merge-add-select flex-1 min-w-[160px] max-w-[300px] border border-border bg-bg px-2 py-1.5 font-mono text-[0.7rem] text-ink outline-none focus:border-accent" id="sel-${gi}">
            <option value="">+ merge another email…</option>
            ${avail
              .map(a => `<option value="${esc(a.email)}">${esc(a.email)} (from: ${esc(a.fromName)})</option>`)
              .join("")}
          </select>
          <button class="btn-small inline-flex items-center gap-2 whitespace-nowrap border border-border bg-transparent px-3 py-1.5 font-mono text-[0.65rem] text-muted transition hover:border-ink hover:text-ink" data-merge-into="${gi}">Merge</button>
        </div>
      </div>

      <div class="mg-actions-col flex items-start pt-5">
        ${
          g.emails.length > 1
            ? `<button class="btn-small danger inline-flex items-center gap-2 whitespace-nowrap border border-border bg-transparent px-3 py-1.5 font-mono text-[0.65rem] text-muted transition hover:border-accent hover:text-accent" data-split-all="${gi}">Split all</button>`
            : ""
        }
      </div>
    `;

    c.appendChild(div);
  });

  // wire handlers (event delegation)
  c.oninput = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (!t.classList.contains("mg-name-input")) return;
    const gi = +t.dataset.gi;
    if (!Number.isFinite(gi)) return;
    state.mergeGroups[gi].displayName = t.value;
  };

  c.onclick = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const splitGi = t.getAttribute("data-split-gi");
    const splitEmail = t.getAttribute("data-split-email");
    if (splitGi && splitEmail) {
      splitOut(+splitGi, splitEmail);
      return;
    }

    const splitAllGi = t.getAttribute("data-split-all");
    if (splitAllGi) {
      splitAll(+splitAllGi);
      return;
    }

    const mergeIntoGi = t.getAttribute("data-merge-into");
    if (mergeIntoGi) {
      mergeInto(+mergeIntoGi);
      return;
    }
  };
}

export function splitOut(gi, email) {
  state.mergeGroups[gi].emails = state.mergeGroups[gi].emails.filter(e => e !== email);
  if (!state.mergeGroups[gi].emails.length) state.mergeGroups.splice(gi, 1);
  state.mergeGroups.push({ displayName: email, emails: [email], suggested: false });
  renderMergeUI();
}

export function splitAll(gi) {
  const emails = state.mergeGroups[gi].emails;
  state.mergeGroups.splice(gi, 1);
  emails.forEach(em => state.mergeGroups.push({ displayName: em, emails: [em], suggested: false }));
  renderMergeUI();
}

export function mergeInto(gi) {
  const sel = $(`sel-${gi}`);
  const email = sel?.value;
  if (!email) return;

  const target = state.mergeGroups[gi];
  state.mergeGroups.forEach(g => {
    g.emails = g.emails.filter(e => e !== email);
  });

  for (let i = state.mergeGroups.length - 1; i >= 0; i--) {
    if (state.mergeGroups[i] !== target && state.mergeGroups[i].emails.length === 0) state.mergeGroups.splice(i, 1);
  }

  target.emails.push(email);
  renderMergeUI();
}

export function addEmptyGroup() {
  state.mergeGroups.push({ displayName: "New contributor", emails: [], suggested: false });
  renderMergeUI();
}

export function skipMerge() {
  const uniqueEmails = [...new Set(state.rawCommits.map(c => c.email))];
  const bestName = {};
  state.rawCommits.forEach(c => {
    if (!bestName[c.email]) bestName[c.email] = c.name;
  });

  state.mergeGroups = uniqueEmails.map(e => ({ displayName: bestName[e] || e, emails: [e], suggested: false }));
}

/** Convenience: show merge step and scroll. */
export function showMergeStep() {
  $("merge-step")?.classList.add("visible");
  $("dashboard")?.classList.remove("visible");
  $("merge-step")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Convenience: hide merge step, show dashboard. */
export function showDashboard() {
  $("merge-step")?.classList.remove("visible");
  $("dashboard")?.classList.add("visible");
}