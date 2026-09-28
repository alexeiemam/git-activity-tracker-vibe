import assert from 'node:assert/strict';
import test from 'node:test';

import { generateDemoLog } from '../assets/demo-data.js';
import {
  aggregate,
  longestConsecutiveWorkdays,
  longestStreak,
  parseGitLog,
} from '../assets/domain.js';

const GROUPS = [
  { displayName: 'Casey Moran', emails: ['casey@example.test', 'c.moran@example.test'] },
  { displayName: 'Priya Shah', emails: ['priya@example.test'] },
  { displayName: 'Hugo Martin', emails: ['hugo@example.test'] },
  { displayName: 'Lin Chen', emails: ['lin@example.test'] },
  { displayName: "Sam O'Neil", emails: ['sam@example.test'] },
];

test('demo log exercises merges, reverts and releases', () => {
  const commits = parseGitLog(generateDemoLog({ years: 3, commits: 120 }));

  assert.equal(commits.length, 120);
  assert.ok(commits.some(commit => commit.isMerge));
  assert.ok(commits.some(commit => commit.isRevert));
  assert.ok(commits.some(commit => commit.touchesVersion));
});

test('merge filtering is explicit aggregation state', () => {
  const commits = parseGitLog(generateDemoLog({ years: 3, commits: 120 }));
  const withoutMerges = aggregate(commits, GROUPS, { colorCount: 10 });
  const withMerges = aggregate(commits, GROUPS, { includeMerges: true, colorCount: 10 });

  const total = data => data.committers.reduce((sum, contributor) => sum + contributor.totalCommits, 0);
  assert.ok(total(withMerges) > total(withoutMerges));
});

test('streak calculations retain their original semantics', () => {
  assert.equal(longestStreak(new Set(['2026-01-01', '2026-01-02', '2026-01-04'])), 2);
  assert.equal(
    longestConsecutiveWorkdays(new Set(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-28'])),
    5,
  );
});
