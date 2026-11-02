/**
 * Presentation-only ordering for reconciled contributors and their linked
 * identities. No identity assignment, authorship or underlying commits change.
 * Email keys are the stable basis for remapping any index-based view state.
 */
export function reorderContributors(groups, from, to) {
  if (!Array.isArray(groups) || !Number.isInteger(from) || !Number.isInteger(to) ||
      from < 0 || to < 0 || from >= groups.length || to >= groups.length || from === to) return groups;
  const next = [...groups];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function reorderLinkedIdentity(groups, groupIndex, from, to) {
  const emails = groups?.[groupIndex]?.emails;
  if (!Array.isArray(emails) || !Number.isInteger(from) || !Number.isInteger(to) ||
      from < 0 || to < 0 || from >= emails.length || to >= emails.length || from === to) return groups;
  const nextEmails = [...emails];
  nextEmails.splice(to, 0, ...nextEmails.splice(from, 1));
  return groups.map((group, index) => index === groupIndex ? {...group, emails:nextEmails} : group);
}

/** A canonical group key does not change when linked emails are rearranged. */
export const contributorKey = group => [...(group?.emails || [])].sort().join('\u0000');

/** Rebase an existing selection/focus after contributor cards change order. */
export function rebaseContributorId(id, before, after) {
  if (typeof id !== 'string' && typeof id !== 'number') return id;
  if (!/^(0|[1-9]\d*)$/.test(String(id))) return id; // 'selection', null etc.
  const email = before?.[Number(id)]?.emails?.[0];
  if (!email) return id;
  const index = after.findIndex(group => group.emails?.includes(email));
  return index < 0 ? null : String(index);
}

/** Stable per-contributor colour across manual sorting and email display order. */
export function contributorColourIndex(group, numberOfColours) {
  if (!Number.isInteger(numberOfColours) || numberOfColours <= 0) return 0;
  const key = contributorKey(group);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % numberOfColours;
}
