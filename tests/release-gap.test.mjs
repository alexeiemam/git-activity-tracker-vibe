import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {releaseGapScore,releaseGapMatrix,ATTENTION_THRESHOLD} from '../assets/release-gap.js';
import {buildAnalysis,parseGitHistory} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';

const person=(id,name,commits={})=>({id,displayName:name,daily:{commits}});
const member=(id,commits)=>({id,commits,drove:commits===0});
const released=(tag,date,members,{baseline=false,lineageComplete=true}={})=>({tag,date,hash:tag,members,baseline,lineageComplete});
const index={bounds:{min:'2026-01-01',max:'2026-04-30'},releases:[
  released('v1.0.0','2026-01-01',[member('0',8),member('1',6)],{baseline:true}),
  released('v1.1.0','2026-01-05',[member('0',2),member('1',0)]),
  released('v1.1.1','2026-02-04',[member('0',1)]),
  released('v1.1.2','2026-03-02',[member('1',3)]),
]};
const date=(model,id,day)=>model.byId.get(id).daily.get(day);

test('recency factor resets at authored release; a busy day neutralises even a very old gap',()=>{
  assert.equal(releaseGapScore(0,0),0);
  assert.equal(releaseGapScore(60,0),100);
  assert.equal(releaseGapScore(120,0),100);
  assert.equal(releaseGapScore(60,1),75);
  assert.equal(releaseGapScore(60,2),50);
  assert.equal(releaseGapScore(60,4),0);
  assert.equal(releaseGapScore(180,10),0);
  assert.equal(releaseGapScore(30,0,{horizon:30}),100);
  assert.equal(releaseGapScore(30,0,{horizon:90}),33.3);
  assert.equal(releaseGapScore(60,2,{busyDay:2}),0);
  assert.equal(releaseGapScore(null,0),null);
  assert.equal(releaseGapScore(-1,0),null);
});

test('carries full-history release involvement into a narrower authored-date scope and resets on event day',()=>{
  const model=releaseGapMatrix(index,[person('0','Ada',{'2026-02-02':0,'2026-02-03':4})],{from:'2026-02-02',to:'2026-02-06'});
  const before=date(model,'0','2026-02-02');
  assert.equal(before.lastRelease.tag,'v1.1.0');
  assert.equal(before.daysSinceRelease,28);
  assert.equal(before.score,46.7);
  assert.equal(date(model,'0','2026-02-03').score,0,'busy authored day neutralises the gap');
  assert.equal(date(model,'0','2026-02-04').score,0,'release event resets even without an authored commit that day');
  assert.equal(date(model,'0','2026-02-05').daysSinceRelease,1);
  assert.equal(date(model,'0','2026-02-05').score,1.7);
  assert.equal(model.byId.get('0').latestRelease.tag,'v1.1.1');
});

test('unproven release membership, driver alone, baseline and weekends are not scored',()=>{
  const model=releaseGapMatrix(index,[person('1','Ben')],{from:'2026-01-30',to:'2026-03-04'});
  assert.equal(date(model,'1','2026-01-30').reason,'no-prior-contribution');
  assert.equal(date(model,'1','2026-01-30').score,null);
  assert.equal(date(model,'1','2026-01-31').reason,'weekend');
  assert.equal(date(model,'1','2026-03-02').score,0,'first genuine incremental contribution resets the gap');
  assert.equal(model.byId.get('1').latestRelease.tag,'v1.1.2');
  assert.equal(date(model,'1','2026-03-03').score,1.7);
  const withoutRelease=releaseGapMatrix({...index,releases:[]},[person('0','Ada')],{from:'2026-02-02',to:'2026-02-04'});
  assert.equal(withoutRelease.byId.get('0').scoredDays,0);
  assert.equal(withoutRelease.byId.get('0').averageScore,null);
  assert.equal(withoutRelease.byId.get('0').months.size,0);
});

test('monthly mean uses only in-coverage weekdays after a release, with honest denominator',()=>{
  const model=releaseGapMatrix(index,[person('0','Ada')],{from:'2026-01-01',to:'2026-01-11'});
  const row=model.byId.get('0');
  const month=row.months.get('2026-01');
  assert.equal(row.scoredDays,5,'Mon Jan 5 through Fri Jan 9, but not baseline days or weekends');
  const expected=[0,1.7,3.3,5,6.7];
  assert.deepEqual(['05','06','07','08','09'].map(d=>date(model,'0',`2026-01-${d}`).score),expected);
  assert.equal(month.score,3.3);
  assert.equal(month.days,5);
  assert.equal(month.attentionDays,0);
  assert.equal(row.attentionDays,0);
  assert.equal(ATTENTION_THRESHOLD,50);
});

test('outside imported history remains unknown; settings are bounded and no future tag may reset an earlier day',()=>{
  const limited={...index,bounds:{min:'2026-01-01',max:'2026-02-04'}};
  const model=releaseGapMatrix(limited,[person('0','Ada')],{from:'2026-02-03',to:'2026-02-06'},{horizon:999,busyDay:-5});
  assert.equal(model.horizon,60);
  assert.equal(model.busyDay,4);
  assert.equal(date(model,'0','2026-02-03').lastRelease.tag,'v1.1.0');
  assert.equal(date(model,'0','2026-02-05').reason,'outside-history');
  assert.equal(date(model,'0','2026-02-05').score,null);
  assert.equal(date(model,'0','2026-02-06').score,null);
});

test('full release evidence tracks reconciled authors, without resetting on the baseline or VERSION touches',()=>{
  const h=ch=>ch.repeat(40);
  const log=[
    `TAG|v1.0.0||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v1.0.1||${h('c')}|commit|2026-02-02T12:00:00Z`,
    `COMMIT|${h('c')}|ada@home|Ada|2026-01-20T12:00:00Z|2026-01-20T12:00:00Z|feat: code|${h('b')}`,
    `3\t1\tapp/a.rb`,
    `COMMIT|${h('b')}|ben@work|Ben|2026-01-10T12:00:00Z|2026-01-10T12:00:00Z|docs|${h('a')}`,
    `1\t0\tdocs/readme.md`,
    `COMMIT|${h('a')}|ada@work|Ada|2026-01-04T12:00:00Z|2026-01-04T12:00:00Z|release?|`,
    `2\t2\tVERSION`,
  ].join('\n');
  const history=parseGitHistory(log);
  const groups=[{displayName:'Ada',emails:['ada@work','ada@home']},{displayName:'Ben',emails:['ben@work']}];
  const full=buildAnalysis(history.commits,groups,{start:'2026-01-04',end:'2026-02-07',selectedIds:new Set(['0','1']),includeMerges:false,includeReverts:true});
  const impacts=impactAnalysis(full,history.commits,history.tags,{skipFollowup:true});
  const evidence=buildEvidenceIndex(full,impacts,{min:'2026-01-04',max:'2026-02-07'});
  const scoped=buildAnalysis(history.commits,groups,{start:'2026-02-02',end:'2026-02-07',selectedIds:new Set(['0']),includeMerges:false,includeReverts:true});
  const model=releaseGapMatrix(evidence,scoped.contributors,{from:scoped.start,to:scoped.end});
  assert.equal(evidence.releases.length,2);
  assert.equal(evidence.releases[0].baseline,true);
  assert.equal(date(model,'0','2026-02-02').score,0,'authored contribution via merged identity to incremental tag');
  assert.equal(date(model,'0','2026-02-03').score,1.7);
  assert.equal(model.rows.length,1);
});

test('Pulse lens and knobs have a complete UI and session round-trip',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  for (const id of ['pulse-gap-settings','pulse-gap-horizon','pulse-busy-day','pulse-gap-summary'])
    assert.ok(html.includes(`id="${id}"`));
  assert.match(html,/data-pulse-lens="release-gap"/);
  assert.match(app,/pulseLens:state\.pulseLens,pulseGapHorizon:state\.pulseGapHorizon,pulseBusyDay:state\.pulseBusyDay/);
  assert.match(app,/state\.pulseLens=s\.pulseLens/);
  assert.match(app,/pulseReleaseGap=gapMode\?releaseGapMatrix\(perspectiveIndex,view\.contributors/);
});
