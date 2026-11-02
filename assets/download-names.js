/** Stable, human-readable local timestamps; filenames never incorporate user content. */
export function downloadFilename(kind, date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('A valid date is required');
  const types = {
    session: ['git-signals-session', 'json'],
    'release-matrix': ['git-signals-release-matrix', 'csv'],
  };
  const type = types[kind];
  if (!type) throw new RangeError('Unknown export type');
  const pad = v => String(v).padStart(2, '0');
  const stamp = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-')
    + '_' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('-');
  return `${type[0]}-${stamp}.${type[1]}`;
}
