import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('assets/app.js', root), 'utf8');

test('HTML has no inline event handlers or inline style/script blocks', () => {
  assert.doesNotMatch(html, /\son(?:click|change|input|mouseenter|mouseleave|keydown|keyup)\s*=/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('HTML loads external CSS and module JavaScript', () => {
  assert.match(html, /href="\.\/assets\/app\.css"/);
  assert.match(html, /type="module" src="\.\/assets\/app\.js"/);
});

test('UI actions are dispatched centrally rather than through global functions', () => {
  assert.match(app, /const ACTIONS\s*=\s*\{/);
  assert.match(app, /document\.addEventListener\('click',\s*handleDocumentClick\)/);
  assert.doesNotMatch(app, /window\.[A-Za-z_$][\w$]*\s*=/);
});

test('generated Git capture command requests author timestamps without a committer-date cutoff', () => {
  const match = app.match(/setText\('git-cmd',\s*'([^']+)'\)/);
  assert.ok(match, 'generated command must be a plainly inspectable literal');
  assert.match(match[1], /%aI/);
  assert.match(match[1], /%ae/);
  assert.match(match[1], /%an/);
  assert.match(match[1], /%cI/, 'commit-time metadata is needed to inspect post-tag follow-up, not to filter authored activity');
  assert.match(match[1], /git for-each-ref.*refs\/tags/);
  assert.match(match[1], /git log HEAD --tags/);
  assert.doesNotMatch(match[1], /--since|--until/);
});

test('Impact Explorer exposes labelled release, matrix, reach and evolution controls', () => {
  for (const id of ['impact-explorer','impact-summary','impact-scope','impact-timeline','impact-release-control','impact-content','impact-metric-select']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const tab of ['timeline','matrix','reach','durability']) {
    assert.match(html, new RegExp(`data-impact-tab="${tab}"`));
  }
  assert.match(app, /renderImpact\(analysis\)/);
  assert.match(app, /impactReleaseHash:state\.impactReleaseHash/);
  assert.match(app, /state\.impactReleaseHash=s\.impactReleaseHash/);
  assert.match(app, /rawTags=parseGitHistory|rawTags=history\.tags/);
});

test('impact import uses tag metadata but never replaces author-date scope with commit dates', async () => {
  const {parseGitHistory,buildAnalysis} = await import('../assets/domain.js');
  const {impactAnalysis} = await import('../assets/impact.js');
  const history=parseGitHistory('COMMIT|abbc001|a@b|A|2025-02-03T08:00:00Z|2025-03-03T09:00:00Z|fix: thing|');
  assert.equal(history.tags.length,0);
  const view=buildAnalysis(history.commits,[{displayName:'A',emails:['a@b']}],{start:'2025-02-03',end:'2025-02-03'});
  assert.equal(view.selectedCommits.length,1);
  assert.equal(impactAnalysis(view,history.commits,history.tags).available,false);
});
