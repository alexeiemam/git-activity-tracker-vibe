/**
 * Auditable co-participation in *incremental* tagged releases.
 * A pair participates together only when both authored eligible commits in
 * the same complete release. Publication/driver roles are tracked separately.
 * No inference of direct collaboration, co-authoring or interpersonal work.
 */
const memberIds = release => new Set(release.members.filter(m => m.commits > 0).map(m => m.id));
const relevant = (release, window) =>
  !!release.date && release.date >= window.from && release.date <= window.to &&
  !release.baseline && release.lineageComplete !== false;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

export function coReleasePatterns(index, focusId, window) {
  const candidates = index.releases.filter(r => r.date && r.date >= window.from && r.date <= window.to);
  const eligible = candidates.filter(r => relevant(r, window));
  const counts = new Map(index.groups.map(g => [g.id, 0]));
  const shared = new Map(index.groups.map(g => [g.id, 0]));
  let focusReleases = 0;
  for (const release of eligible) {
    const members = memberIds(release);
    for (const id of members) counts.set(id, (counts.get(id) || 0) + 1);
    if (!members.has(focusId)) continue;
    focusReleases++;
    for (const id of members) if (id !== focusId) shared.set(id, (shared.get(id) || 0) + 1);
  }
  const partners = index.groups.filter(g => g.id !== focusId).map(group => {
    const together = shared.get(group.id) || 0;
    const theirs = counts.get(group.id) || 0;
    const union = focusReleases + theirs - together;
    return {id: group.id, name: group.displayName, shared: together, theirs,
      ofMine: ratio(together, focusReleases), ofTheirs: ratio(together, theirs),
      overlap: ratio(together, union)};
  }).sort((a, b) => b.shared - a.shared || (b.overlap ?? 0) - (a.overlap ?? 0) || a.name.localeCompare(b.name));
  return {
    focusId, window, releaseEvents: candidates.length, eligible: eligible.length,
    omitted: candidates.length - eligible.length, mine: focusReleases,
    partners, withPartners: partners.filter(p => p.shared > 0).length,
  };
}

export function coReleaseEvidence(index, first, second, window) {
  if (first == null || second == null || first === second) return [];
  return index.releases.filter(r => relevant(r, window) &&
    r.members.some(m => m.id === first && m.commits > 0) &&
    r.members.some(m => m.id === second && m.commits > 0))
    .slice().reverse().map(r => ({hash: r.hash, tag: r.tag, date: r.date,
      firstCommits: r.members.find(m => m.id === first)?.commits || 0,
      secondCommits: r.members.find(m => m.id === second)?.commits || 0,
      driverId: r.driver.groupId}));
}
