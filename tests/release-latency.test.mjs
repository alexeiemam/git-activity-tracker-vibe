import assert from 'node:assert/strict';
import test from 'node:test';
import {releaseAgeDays,releaseAgeDistribution,firstReleaseByCommit,commitReleaseAges,RELEASE_AGE_BUCKETS} from '../assets/release-latency.js';
import {parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex,contributorPortrait,releaseDetails} from '../assets/perspectives.js';
import {renderPrimaryExplorer} from '../assets/perspective-view.js';
import {primaryDefaults} from '../assets/perspective-state.js';

const DAY=86400000;

test('age is elapsed days from authoring to release; unknown or reversed times are unmeasurable',()=>{
  assert.equal(releaseAgeDays(0,3*DAY),3);
  assert.equal(releaseAgeDays(null,DAY),null);
  assert.equal(releaseAgeDays(2*DAY,DAY),null,'a release recorded before authorship is not a negative wait');
});

test('distribution buckets ages and reports percentiles over released commits only',()=>{
  const d=releaseAgeDistribution([0.5,2,2,5,10,20,40,100,400],{waiting:[3,30],undated:1});
  assert.deepEqual(d.buckets.map(b=>b.count),[1,2,1,1,1,1,1,1]);
  assert.equal(d.buckets.length,RELEASE_AGE_BUCKETS.length);
  assert.equal(d.released,9);
  assert.equal(d.median,10);
  assert.equal(d.unreleased,2);
  assert.equal(d.medianWaiting,16.5);
  assert.equal(d.oldestWaiting,30);
  assert.equal(d.undated,1);
  assert.equal(releaseAgeDistribution([]).median,null);
});

test('a commit is aged at its earliest shipping release across lineages; unshipped commits wait until asOf',()=>{
  const first=firstReleaseByCommit([
    {tag:'v2',timestamp:10*DAY,commits:['a']},
    {tag:'v1',timestamp:4*DAY,commits:['a','b']},
  ]);
  assert.equal(first.get('a').tag,'v1');
  const d=commitReleaseAges([{hash:'a',authoredAt:DAY},{hash:'b',authoredAt:3*DAY},{hash:'c',authoredAt:5*DAY}],first,12*DAY);
  assert.equal(d.released,2);
  assert.equal(d.median,2);
  assert.equal(d.unreleased,1);
  assert.equal(d.oldestWaiting,7);
});

const at=day=>`2026-01-${String(day).padStart(2,'0')}T09:00:00+00:00`;
const row=(hash,email,day,parent)=>`COMMIT|${hash}|${email}|${email}|${at(day)}|${at(day)}|change ${hash}|${parent}\n2\t1\tapp/${hash}.ts`;
const history=parseGitHistory([
  `TAG|v1.0.0||b000002|commit|${at(2)}`,
  `TAG|v1.1.0||d000004|commit|${at(20)}`,
  row('a000001','ada@work',1,''),
  row('b000002','ada@work',2,'a000001'),
  row('c000003','ben@work',6,'b000002'),
  row('d000004','ada@work',18,'c000003'),
  row('e000005','ada@work',25,'d000004'),
].join('\n'));
const GROUPS=[{displayName:'Ada',emails:['ada@work']},{displayName:'Ben',emails:['ben@work']}];
const bounds={min:'2026-01-01',max:'2026-01-31'};
const view=buildAnalysis(history.commits,GROUPS,{start:bounds.min,end:bounds.max});
const index=buildEvidenceIndex(view,impactAnalysis(view,history.commits,history.tags),bounds);

test('a person\'s time to release includes not-yet-released commits and a same-window comparison',()=>{
  const ada=contributorPortrait(index,'0',{from:'2026-01-01',to:'2026-01-31'});
  // a, b ship in v1.0.0 (baseline); d ships in v1.1.0 two days later; e is unreleased.
  assert.equal(ada.releaseAge.released,3);
  assert.equal(ada.releaseAge.unreleased,1);
  assert.ok(Math.abs(ada.releaseAge.oldestWaiting-(31-25+15/24))<.01,'waits until the end of the imported history');
  assert.equal(ada.teamReleaseAge.released,4,'comparison includes Ben');
  const html=renderPrimaryExplorer(index,{...primaryDefaults(),mode:'contributors',contributorFocus:'0',contributorTab:'delivery'});
  assert.match(html,/COMMIT AGE AT RELEASE/);
  assert.match(html,/Not yet released/);
  const compare=renderPrimaryExplorer(index,{...primaryDefaults(),mode:'contributors',contributorFocus:'0',contributorTab:'compare',compareB:'1'});
  assert.match(compare,/Median time to release/);
});

test('release anatomy shows how long its included commits waited',()=>{
  const release=index.releases.find(r=>r.tag==='v1.1.0');
  const details=releaseDetails(index,release.hash);
  assert.equal(details.releaseAge.released,2);
  assert.equal(details.releaseAge.unreleased,0);
  assert.equal(details.releaseAge.median,8,'c waited 14 days, d waited 2 days');
  const html=renderPrimaryExplorer(index,{...primaryDefaults(),mode:'observatory',releaseHash:release.hash});
  assert.match(html,/How long had its changes waited\?/);
  assert.match(html,/Median time to release/);
});
