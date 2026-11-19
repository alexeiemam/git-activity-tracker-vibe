/**
 * Identity configuration travels independently of commit evidence: contributor
 * names, linked identity keys, ordering, working-day schedules and yearly
 * leave only. Keys
 * that are not (yet) present in the loaded history are held in a reserve so a
 * later import or appended capture can still honour the user's mapping, and so
 * re-exporting never silently drops them.
 */
import { normalizeLeave } from './working-patterns.js?v=daysoff-20261119-1';

export const IDENTITY_CONFIG_FORMAT = 'git-signals-identities';
export const IDENTITY_CONFIG_VERSION = 1;
const MAX_GROUPS = 50000, MAX_KEYS = 200000, MAX_KEY_LENGTH = 320, MAX_NAME_LENGTH = 160;

const normalKey = key => typeof key === 'string' ? key.trim().toLowerCase() : '';
const validDays = days => Array.isArray(days) && days.length <= 7 &&
  days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) ? [...new Set(days)].sort((a, b) => a - b) : undefined;
const validLeave = leave => leave && typeof leave === 'object' ? normalizeLeave(leave) : undefined;
const withDays = (group, days, leave) => ({...group, ...(days ? {workingDays: days} : {}), ...(leave ? {leave} : {})});

/** Tolerant normaliser: invalid entries are skipped and each key is claimed once. */
export function sanitizeIdentityGroups(list) {
  if (!Array.isArray(list)) return [];
  const used = new Set();
  let total = 0;
  const result = [];
  for (const group of list.slice(0, MAX_GROUPS)) {
    const source = Array.isArray(group?.identities) ? group.identities : group?.emails;
    if (!Array.isArray(source)) continue;
    const emails = [];
    for (const raw of source) {
      const key = normalKey(raw);
      if (!key || key.length > MAX_KEY_LENGTH || used.has(key) || total >= MAX_KEYS) continue;
      used.add(key);emails.push(key);total++;
    }
    if (!emails.length) continue;
    const name = typeof group.displayName === 'string' && group.displayName.trim() ? group.displayName.trim().slice(0, MAX_NAME_LENGTH) : emails[0];
    result.push(withDays({displayName: name, emails}, validDays(group.workingDays), validLeave(group.leave)));
  }
  return result;
}

/** Accept a dedicated identity file, or reuse the identities from a full session export. */
export function parseIdentityConfig(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('Select a git:signals identity configuration or session file.');
  let list;
  if (payload.format === IDENTITY_CONFIG_FORMAT) {
    if (!Number.isInteger(payload.version) || payload.version > IDENTITY_CONFIG_VERSION)
      throw new Error('This identity configuration was created by a newer version of git:signals.');
    list = payload.groups;
  } else if (Array.isArray(payload.mergeGroups)) {
    list = [...payload.mergeGroups, ...(Array.isArray(payload.identityReserve) ? payload.identityReserve : [])];
  } else {
    throw new Error('The file does not contain a git:signals identity configuration.');
  }
  const groups = sanitizeIdentityGroups(list);
  if (!groups.length) throw new Error('The identity configuration does not contain any contributor identities.');
  return groups;
}

/** Fold reserved (currently unseen) keys back in so an export is a complete mapping. */
export function buildIdentityConfig(groups, reserve = [], exportedAt = new Date().toISOString()) {
  const out = groups.filter(group => group.emails.length)
    .map(group => withDays({displayName: group.displayName, emails: [...group.emails]}, validDays(group.workingDays), validLeave(group.leave)));
  const placed = new Map(out.flatMap(group => group.emails.map(key => [key, group])));
  for (const group of reserve) {
    const missing = group.emails.filter(key => !placed.has(key));
    if (!missing.length) continue;
    const target = group.emails.map(key => placed.get(key)).find(Boolean);
    const destination = target || withDays({displayName: group.displayName, emails: []}, validDays(group.workingDays), validLeave(group.leave));
    if (!target) out.push(destination);
    for (const key of missing) {destination.emails.push(key);placed.set(key, destination);}
  }
  return {
    format: IDENTITY_CONFIG_FORMAT, version: IDENTITY_CONFIG_VERSION, exportedAt,
    groups: out.map(({displayName, emails, workingDays, leave}) => withDays({displayName, identities: emails}, workingDays, leave)),
  };
}

/** Configuration groups that still mention keys absent from the loaded history. */
export function reserveFor(configGroups, knownKeys) {
  return configGroups.filter(group => group.emails.some(key => !knownKeys.has(key)))
    .map(group => withDays({displayName: group.displayName, emails: [...group.emails]}, validDays(group.workingDays), validLeave(group.leave)));
}

/**
 * Configured contributors come first, in file order, with their names and
 * schedules. Identities the file does not mention stay in their current groups.
 */
export function applyIdentityConfig(groups, configGroups, knownKeys) {
  const owner = new Map(groups.flatMap(group => group.emails.map(key => [key, group])));
  const claimed = new Set();
  const configured = [];
  let matched = 0, unmatched = 0;
  for (const group of configGroups) {
    const emails = group.emails.filter(key => knownKeys.has(key) && !claimed.has(key));
    unmatched += group.emails.filter(key => !knownKeys.has(key)).length;
    if (!emails.length) continue;
    emails.forEach(key => claimed.add(key));matched += emails.length;
    const days = validDays(group.workingDays) || validDays(owner.get(emails[0])?.workingDays);
    const leave = validLeave(group.leave) || validLeave(owner.get(emails[0])?.leave);
    configured.push(withDays({displayName: group.displayName, emails}, days, leave));
  }
  const untouched = groups.map(group => ({...group, emails: group.emails.filter(key => !claimed.has(key))}))
    .filter(group => group.emails.length);
  return {groups: [...configured, ...untouched], reserve: reserveFor(configGroups, knownKeys), matched, unmatched};
}

/**
 * When appended history introduces a reserved key, move it to the contributor
 * the configuration placed it with. Only newly added keys move, so any edits
 * made after the configuration was imported are never undone.
 */
export function adoptReservedIdentities(groups, addedKeys, reserve, knownKeys) {
  const added = new Set(addedKeys);
  let next = groups.map(group => ({...group, emails: [...group.emails]}));
  let adopted = 0;
  for (const group of reserve) {
    const arriving = group.emails.filter(key => added.has(key));
    if (!arriving.length) continue;
    const moving = new Set(arriving);
    const before = next;
    next = before.map(g => ({...g, emails: g.emails.filter(key => !moving.has(key))}))
      .filter((g, i) => g.emails.length || !before[i].emails.some(key => moving.has(key)));
    const target = next.find(g => g.emails.some(key => group.emails.includes(key)));
    if (target) target.emails.push(...arriving);
    else next.push(withDays({displayName: group.displayName, emails: arriving}, validDays(group.workingDays), validLeave(group.leave)));
    adopted += arriving.length;
  }
  return {groups: next, reserve: reserveFor(reserve, knownKeys), adopted};
}
