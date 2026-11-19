import assert from 'node:assert/strict';
import test from 'node:test';
import {releaseAgeDays,releaseAgeDistribution,firstReleaseByCommit,commitReleaseAges,RELEASE_AGE_BUCKETS,releaseShape,allReleasesShape,fresherThan,shapeReference,shapeNote} from '../assets/release-latency.js';
import {parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex,contributorPortrait,releaseDetails,releaseFingerprints} from '../assets/perspectives.js';
import {restorePrimaryState} from '../assets/perspective-state.js';
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
  assert.match(html,/Release fingerprint/);
  assert.match(html,/Median time to release/);
});

test('lines weighting moves shares and percentiles towards large changes; commit counts are kept',()=>{
  const d=releaseAgeDistribution([0.5,40],{weights:[10,990]});
  assert.equal(d.weighted,true);
  assert.equal(d.total,1000);
  assert.deepEqual(d.buckets.map(b=>b.count),[1,0,0,0,0,1,0,0]);
  assert.equal(d.buckets[5].share,.99);
  assert.equal(d.median,40,'half the lines had waited 40 days, though half the commits were fresh');
});

test('shapes are relative to all shipped commits pooled, once there are enough releases',()=>{
  const pooled=releaseAgeDistribution([40,50,60,70,80].flatMap(m=>[m-10,m,m+10]));
  const reference=shapeReference(pooled,5);
  assert.equal(reference.relative,true);
  assert.equal(reference.median,60);
  assert.equal(reference.commits,15);
  const shape=ages=>releaseShape(releaseAgeDistribution(ages),{reference});
  assert.equal(shape([35,45,55]),'steady','a month-old median is normal for a quarterly project');
  assert.equal(shape([1,5,10,20]),'hotfix');
  assert.equal(shape([130,150,170]),'backlog');
  assert.match(shapeNote('backlog',reference),/120 days: twice the median across all releases/);
  const few=shapeReference(pooled,4);
  assert.equal(few.relative,false,'fewer than five releases fall back to fixed thresholds');
  assert.match(shapeNote('steady',few),/fixed thresholds/);
});

test('release shapes describe the age of shipped work (fixed thresholds)',()=>{
  const shape=ages=>releaseShape(releaseAgeDistribution(ages));
  assert.equal(shape([0.1,0.5,1,2]),'hotfix');
  assert.equal(shape([2,4,6,9,12]),'steady');
  assert.equal(shape([1,1,2,2,3,3,4,90,120,150]),'long-tail');
  assert.equal(shape([35,40,60,90]),'backlog');
  assert.equal(shape([]),'unmeasured');
  assert.equal(releaseShape(releaseAgeDistribution([1]),{baseline:true}),'initial');
});

test('pooled reference weights releases by size, unlike a median of release medians',()=>{
  const small=releaseAgeDistribution([0.5]),big=releaseAgeDistribution(Array(99).fill(40));
  const pooled=releaseAgeDistribution([0.5,...Array(99).fill(40)]);
  const all=allReleasesShape(pooled,[small,big]);
  assert.equal(all.shares[0],.01,'one of 100 shipped commits was fresh');
  assert.equal(all.shares[5],.99);
  assert.deepEqual(all.medians,[0.5,40],'each release keeps its own median for freshness ranking');
  assert.equal(shapeReference(pooled,5).median,40);
  assert.equal(fresherThan(2,[1,3,5,8,13]),.8);
  assert.equal(fresherThan(2,[1,3]),null,'too few releases to compare');
});

test('fingerprints exclude the first tag from the all-releases reference and drive the shape filter',()=>{
  const fps=releaseFingerprints(index);
  assert.strictEqual(releaseFingerprints(index),fps,'cached per index');
  const [v1,v11]=['v1.0.0','v1.1.0'].map(tag=>index.releases.find(r=>r.tag===tag));
  assert.equal(fps.releases.get(v1.hash).shape,'initial');
  assert.equal(fps.releases.get(v11.hash).shape,'steady');
  assert.equal(fps.typical.commits.releases,1);
  const filtered=renderPrimaryExplorer(index,{...primaryDefaults(),mode:'observatory',releaseShape:'initial'});
  assert.match(filtered,/Initial history \(1\)/);
  assert.match(filtered,new RegExp(`data-hash="${v1.hash}" aria-current="true"`),'filter narrows the release index');
});

test('each fingerprint view renders, with lines weighting and the typical overlay',()=>{
  const hash=index.releases.find(r=>r.tag==='v1.1.0').hash;
  const view=changes=>renderPrimaryExplorer(index,{...primaryDefaults(),mode:'observatory',releaseHash:hash,...changes});
  assert.match(view({fingerprintView:'arrival'}),/class="primary-arrival"[\s\S]*v1\.1\.0 released/);
  assert.match(view({fingerprintView:'arrival',fingerprintWeight:'lines'}),/weighted by lines added \+ deleted/);
  const histogram=view({fingerprintView:'histogram'});
  assert.match(histogram,/All releases<\/span>/);
  assert.match(histogram,/aria-pressed="true">Compare with all releases/);
  assert.match(histogram,/Shapes (compare with all|use fixed thresholds)/);
  assert.doesNotMatch(view({fingerprintView:'histogram',fingerprintTypical:'off'}),/<u style/);
  const strip=view({fingerprintView:'strip',releaseShape:'steady'});
  assert.equal((strip.match(/data-action="primary-fingerprint-release"/g)||[]).length,2);
  assert.match(strip,/primary-fp-col selected/);
  assert.match(strip,/primary-fp-col is-dim/,'releases outside the shape filter are dimmed');
});

test('fingerprint settings and shape filter persist and reject unknown values',()=>{
  const restored=restorePrimaryState({primary:{fingerprintView:'strip',fingerprintWeight:'lines',fingerprintTypical:'off',releaseShape:'backlog'}});
  assert.deepEqual([restored.fingerprintView,restored.fingerprintWeight,restored.fingerprintTypical,restored.releaseShape],['strip','lines','off','backlog']);
  const bad=restorePrimaryState({primary:{fingerprintView:'pie',releaseShape:'urgent'}});
  assert.equal(bad.fingerprintView,'arrival');
  assert.equal(bad.releaseShape,'all');
});
