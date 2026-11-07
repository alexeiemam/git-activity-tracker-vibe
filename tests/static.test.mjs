import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
  assert.match(html, /href="\.\/assets\/app\.css\?v=[^"]+"/);
  assert.match(html, /type="module" src="\.\/assets\/app\.js\?v=[^"]+"/);
});

test('all Pulse signal modules expose every named export requested by the entrypoint', async () => {
  for(const file of ['release-gap.js','momentum.js','temporal-activity.js','contribution-level.js','absolute-velocity.js','release-scorecard.js','continuity.js','working-patterns.js']) {
    const escaped=file.replace('.', '\\.');
    const statement=app.match(new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]\\./${escaped}\\?v=[^'"]+['"]`));
    assert.ok(statement, `app.js must import ${file}`);
    const module=await import(`../assets/${file}`);
    for(const imported of statement[1].split(',')) {
      const name=imported.trim().split(/\s+as\s+/)[0];
      assert.ok(Object.hasOwn(module,name), `${file} must export ${name}`);
    }
  }
});

test('favicon is linked to a packaged SVG asset', async () => {
  assert.match(html, /<link rel="icon" href="\.\/assets\/favicon\.svg" type="image\/svg\+xml">/);
  const svg = await readFile(new URL('assets/favicon.svg', root), 'utf8');
  assert.match(svg, /<svg\b/);
});

test('UI actions are dispatched centrally rather than through global functions', () => {
  assert.match(app, /const ACTIONS\s*=\s*\{/);
  assert.match(app, /document\.addEventListener\('click',\s*handleDocumentClick\)/);
  assert.doesNotMatch(app, /window\.[A-Za-z_$][\w$]*\s*=/);
});

test('visible, copyable Git capture command imports tags and complete authored history', () => {
  const command = html.match(/<code id="git-cmd">([^<]+)<\/code>/)?.[1];
  assert.ok(command, 'capture command must be available without JavaScript');
  assert.match(command, /git for-each-ref.*refs\/tags/);
  assert.match(command, /git log HEAD --tags/);
  assert.match(command, /%aI/);
  assert.match(command, /%ae/);
  assert.match(command, /%an/);
  assert.match(command, /%cI/);
  assert.match(command, /%P/);
  assert.doesNotMatch(command, /--since|--until/);
  assert.match(app, /clipboard\.writeText\(\$\('git-cmd'\)\.textContent\)/);
  assert.doesNotMatch(app, /setText\('git-cmd',/);
});

test('all versioned assets use the same revision, including ES module dependencies', async () => {
  const entryVersion = html.match(/assets\/app\.js\?v=([^"\s]+)/)?.[1];
  const cssVersion = html.match(/assets\/app\.css\?v=([^"\s]+)/)?.[1];
  assert.ok(entryVersion);
  assert.equal(cssVersion, entryVersion);
  for (const filename of await readdir(new URL('assets/',root))) {
    if (!filename.endsWith('.js')) continue;
    const file=`assets/${filename}`;
    const source = await readFile(new URL(file, root), 'utf8');
    const imports = [...source.matchAll(/from ['"]\.\/[^'"?]+\.js\?v=([^'"]+)['"]/g)];
    for (const match of imports) assert.equal(match[1], entryVersion);
  }
});

test('Impact panel shows an actionable startup state rather than silent empty markup', () => {
  assert.match(html, /id="impact-empty"[^>]*>[\s\S]*?Preparing release intelligence/);
  assert.match(html, /id="impact-panels" hidden/);
  assert.match(app, /Impact Explorer rendering failed/);
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


test('Impact timeline controls and focus navigation are wired to session-persistent state',()=>{
  assert.match(app,/impactTimelineMode:'all'/);
  assert.match(app,/impactTimelineFrom:state\.impactTimelineFrom/);
  assert.match(app,/impactTimelineTo:state\.impactTimelineTo/);
  assert.match(app,/case 'impact-release-select':chooseImpactRelease\(t.value/);
  assert.match(app,/impactTimelineReveal\(impactModel,timelinePreference\(\),hash\)/);
  assert.match(app,/scrollToImpactMarker\(hash/);
  assert.match(app,/case 'impact-timeline-from':case 'impact-timeline-to'/);
  assert.match(app,/case 'impact-timeline-pan'/);
  assert.match(app,/data\.impactRange|dataset\.impactRange/);
});
