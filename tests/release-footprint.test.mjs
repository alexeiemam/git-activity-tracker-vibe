import assert from 'node:assert/strict';
import test from 'node:test';
import {footprintArea,buildCodebaseMap,releaseFootprint,typicalFootprint,footprintReference,footprintShape,footprintNote,footprintSimilarity,similarReleases} from '../assets/release-footprint.js';
import {parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex,releaseFootprints} from '../assets/perspectives.js';
import {renderPrimaryExplorer} from '../assets/perspective-view.js';
import {primaryDefaults,restorePrimaryState} from '../assets/perspective-state.js';

const commit=(...paths)=>({files:paths.map(p=>typeof p==='string'?{path:p,added:5,deleted:1}:p)});

test('areas are up to three directories deep',()=>{
  assert.equal(footprintArea('app/models/user/profile/edit.rb'),'app/models/user/');
  assert.equal(footprintArea('app/models/user/profile.rb'),'app/models/user/');
  assert.equal(footprintArea('app/models/user.rb'),'app/models/');
  assert.equal(footprintArea('app/x.rb'),'app/');
  assert.equal(footprintArea('README.md'),'(root)');
});

test('the map keeps the busiest areas and folds the rest into one cell per top-level directory',()=>{
  const map=buildCodebaseMap([commit('app/models/a.rb','app/models/b.rb','app/views/x.erb','spec/models/a_spec.rb','spec/models/b_spec.rb','app/jobs/j.rb')],{maxCells:2});
  assert.deepEqual(map.groups.map(g=>g.top),['app/','spec/']);
  assert.deepEqual(map.groups[0].cells.map(c=>c.key),['app/models/','app/…']);
  assert.equal(map.cellOf.get('app/jobs/'),'app/…');
  assert.equal(map.groups[0].cells[1].areas,2,'views and jobs were folded together');
});

test('a footprint records shares, spread and concentration on the shared map',()=>{
  const map=buildCodebaseMap([commit('app/models/a.rb','app/views/v.erb','spec/models/s.rb','lib/x/y.rb')]);
  const fp=releaseFootprint([commit('app/models/a.rb','app/models/b.rb','app/models/c.rb',{path:'spec/models/s.rb',added:90,deleted:0})],map);
  assert.equal(fp.touches,4);
  assert.equal(fp.cells,2);
  assert.equal(fp.topLevels,2);
  assert.equal(fp.top2Share,1);
  assert.equal(fp.shares.files[map.keys.indexOf('app/models/')],.75);
  assert.ok(fp.shares.lines[map.keys.indexOf('spec/models/')]>.8,'lines weighting favours the big change');
});

test('footprint shapes are relative to the average release and fall back to fixed thresholds',()=>{
  const reference={touches:10,topLevels:2,linesPerTouch:30,relative:true};
  const fp=(over)=>({touches:10,topLevels:2,top2Share:.5,linesPerTouch:30,...over});
  assert.equal(footprintShape(fp({top2Share:.9}),{reference}),'focused');
  assert.equal(footprintShape(fp({topLevels:3}),{reference}),'cross-cutting');
  assert.equal(footprintShape(fp({touches:25,linesPerTouch:4,topLevels:5}),{reference}),'broad-sweep','broad sweep wins over cross-cutting');
  assert.equal(footprintShape(fp({}),{reference}),'spread');
  assert.equal(footprintShape(fp({}),{baseline:true}),'initial');
  assert.equal(footprintShape({touches:0}),'unmeasured');
  assert.equal(footprintReference(typicalFootprint([])).relative,false);
  assert.match(footprintNote('cross-cutting',reference),/3\+ top-level directories, compared with 2 for the average release/);
});

test('the all-releases footprint pools changes, so bigger releases count for more',()=>{
  const t=typicalFootprint([
    {touches:1,lines:10,topLevels:1,files:[1,0],lineCounts:[10,0]},
    {touches:9,lines:9,topLevels:3,files:[0,9],lineCounts:[0,9]},
  ]);
  assert.deepEqual(t.shares.files,[.1,.9]);
  assert.equal(t.touches,5);
  assert.equal(t.topLevels,2);
  assert.equal(t.linesPerTouch,1.9);
});

test('similarity compares area mixes, most similar first',()=>{
  assert.equal(footprintSimilarity([1,0],[1,0]),1);
  assert.equal(footprintSimilarity([1,0],[0,1]),0);
  const fps=new Map([
    ['a',{touches:4,shares:{files:[.75,.25,0]}}],
    ['b',{touches:2,shares:{files:[.7,.3,0]}}],
    ['c',{touches:2,shares:{files:[0,0,1]}}],
    ['d',{touches:2,shares:{files:[.5,.5,0]},baseline:true}],
  ]);
  assert.deepEqual(similarReleases('a',fps).map(x=>x.hash),['b'],'unrelated and baseline releases are excluded');
});

const at=day=>`2026-01-${String(day).padStart(2,'0')}T09:00:00+00:00`;
const row=(hash,day,parent,paths)=>`COMMIT|${hash}|ada@work|Ada|${at(day)}|${at(day)}|change ${hash}|${parent}\n${paths.map(p=>`3\t1\t${p}`).join('\n')}`;
const history=parseGitHistory([
  `TAG|v1.0.0||a000001|commit|${at(2)}`,`TAG|v1.1.0||b000002|commit|${at(5)}`,`TAG|v1.2.0||c000003|commit|${at(9)}`,
  row('a000001',1,'',['app/models/a.rb','README.md']),
  row('b000002',4,'a000001',['app/models/a.rb','app/models/b.rb']),
  row('c000003',8,'b000002',['app/models/c.rb','spec/models/c_spec.rb','lib/tasks/t.rake','config/app.yml']),
].join('\n'));
const view=buildAnalysis(history.commits,[{displayName:'Ada',emails:['ada@work']}],{start:'2026-01-01',end:'2026-01-31'});
const index=buildEvidenceIndex(view,impactAnalysis(view,history.commits,history.tags),{min:'2026-01-01',max:'2026-01-31'});
const hashOf=tag=>index.releases.find(r=>r.tag===tag).hash;

test('release footprints share one map, are cached and drive the footprint filter',()=>{
  const fps=releaseFootprints(index);
  assert.strictEqual(releaseFootprints(index),fps);
  assert.equal(fps.releases.get(hashOf('v1.0.0')).shape,'initial');
  assert.equal(fps.releases.get(hashOf('v1.1.0')).shape,'focused');
  assert.equal(fps.releases.get(hashOf('v1.2.0')).shape,'cross-cutting');
  const html=renderPrimaryExplorer(index,{...primaryDefaults(),mode:'observatory',releaseFootprint:'cross-cutting'});
  assert.match(html,/Cross-cutting \(1\)/);
  assert.match(html,new RegExp(`data-hash="${hashOf('v1.2.0')}" aria-current="true"`));
});

test('the footprint half renders the map, similar releases and lines weighting',()=>{
  const render=changes=>renderPrimaryExplorer(index,{...primaryDefaults(),mode:'observatory',releaseHash:hashOf('v1.2.0'),...changes});
  const map=render({});
  assert.match(map,/Where they landed/);
  assert.match(map,/class="primary-map"/);
  assert.match(map,/data-action="primary-open-area" data-area="app\/"/);
  assert.match(map,/Releases like this one/);
  assert.match(render({shapeWeight:'lines'}),/of this release's lines changed/);
  assert.match(map,/data-browse="footprint" data-shape="cross-cutting"/);
  const strip=render({releaseBrowse:'footprint'});
  assert.equal((strip.match(/data-action="primary-strip-release"/g)||[]).length,3);
});

test('footprint filter persists and rejects unknown values',()=>{
  assert.equal(restorePrimaryState({primary:{releaseFootprint:'focused'}}).releaseFootprint,'focused');
  assert.equal(restorePrimaryState({primary:{releaseFootprint:'huge'}}).releaseFootprint,'all');
});
