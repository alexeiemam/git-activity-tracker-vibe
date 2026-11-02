import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadFilename} from '../assets/download-names.js';

test('session and matrix exports use short descriptive local timestamps', () => {
  const at = new Date(2026, 10, 2, 10, 21, 44);
  assert.equal(downloadFilename('session', at), 'git-signals-session-2026-11-02_10-21-44.json.gz');
  assert.equal(downloadFilename('session-json', at), 'git-signals-session-2026-11-02_10-21-44.json');
  assert.equal(downloadFilename('release-matrix', at), 'git-signals-release-matrix-2026-11-02_10-21-44.csv');
});

test('filenames have a bounded, content-independent shape', () => {
  const name = downloadFilename('session', new Date(2026, 0, 1, 0, 0, 2));
  assert.match(name, /^git-signals-session-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json\.gz$/);
  assert.ok(name.length < 64);
  assert.throws(() => downloadFilename('../../some-user-content', new Date()), RangeError);
  assert.throws(() => downloadFilename('session', new Date('invalid')), TypeError);
});
