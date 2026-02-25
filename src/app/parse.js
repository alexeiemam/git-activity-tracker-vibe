/** @file parse.js */

import { parseVersionFromSubject } from "./utils.js";

/**
 * Parse git log output produced by:
 * git log --pretty=format:"COMMIT|%H|%ae|%an|%aI|%s" --numstat
 *
 * @param {string} raw
 * @returns {Array<{
 *   hash:string,email:string,name:string,date:string,hour:number,minute:number,subject:string,
 *   isMerge:boolean,isRevert:boolean,touchesVersion:boolean,releaseVersion:null|string,
 *   files:Array<{added:number,deleted:number,path:string}>
 * }>}
 */
export function parseGitLog(raw) {
  const commits = [];
  let cur = null;

  for (const line of raw.trim().split("\n")) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith("COMMIT|")) {
      if (cur) commits.push(cur);
      const p = t.split("|");

      const rawDate = (p[4] || "").trim();
      let date = "";
      let hour = -1;
      let minute = -1;

      if (rawDate.includes("T")) {
        date = rawDate.slice(0, 10);
        const timePart = rawDate.slice(11, 19); // HH:MM:SS
        hour = parseInt(timePart.slice(0, 2), 10);
        minute = parseInt(timePart.slice(3, 5), 10);
      } else {
        date = rawDate;
      }

      const subject = (p[5] || "").trim();

      const isRevert =
        /^revert\b/i.test(subject) ||
        /this reverts commit\b/i.test(subject);

      const isMerge =
        /^Merge (branch|pull request|remote|tag|commit)/i.test(subject) ||
        /^Merged? /i.test(subject);

      cur = {
        hash: p[1] || "",
        email: (p[2] || "?").toLowerCase().trim(),
        name: (p[3] || "?").trim(),
        date,
        hour,
        minute,
        subject,
        isMerge,
        isRevert,
        touchesVersion: false,
        releaseVersion: null,
        files: [],
      };
      continue;
    }

    if (!cur) continue;

    const m = t.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;

    const path = m[3].trim();
    cur.files.push({
      added: m[1] === "-" ? 0 : +m[1],
      deleted: m[2] === "-" ? 0 : +m[2],
      path,
    });

    if (path === "VERSION" || path.endsWith("/VERSION")) {
      cur.touchesVersion = true;
    }
  }

  if (cur) commits.push(cur);
  if (!commits.length) throw new Error("No commits found — check format.");

  // attach releaseVersion (best-effort) to commits touching VERSION
  for (const c of commits) {
    if (c.touchesVersion) c.releaseVersion = parseVersionFromSubject(c.subject);
  }

  return commits;
}

/** @param {Array<any>} rawCommits */
export function buildCommitsByDate(rawCommits) {
  /** @type {Record<string, any[]>} */
  const map = {};
  for (const c of rawCommits) {
    if (!c.date) continue;
    if (!map[c.date]) map[c.date] = [];
    map[c.date].push(c);
  }
  return map;
}