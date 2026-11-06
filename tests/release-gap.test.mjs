import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {releaseGapScore,releaseContributionCredit,releaseGapMatrix,ATTENTION_THRESHOLD} from '../assets/release-gap.js';
import {buildAnalysis,parseGitHistory} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';

const person=(id,name,commits={})=>({id,displayName:name,daily:{commits}});
const member=(id,commits,lines=200)=>({id,commits,releaseLineChurn:lines,releaseLinesAdded:lines,releaseLinesDeleted:0,drove:commits===0});
const released=(tag,date,members,{baseline=false,lineageComplete=true}={})=>({tag,date,hash:tag,members,baseline,lineageComplete});
const index={bounds:{min:'2026-01-01',max:'2026-04-30'},releases:[
  released('v1.0.0','2026-01-01',[member('0',8),member('1',6)],{baseline:true}),
  released('v1.1.0','2026-01-05',[member('0',2),member('1',0)]),
  released('v1.1.1','2026-02-04',[member('0',1,10)]),
  released('v1.1.2','2026-03-02',[member('1',3)]),
]};
const date=(model,id,day)=>model.byId.get(id).daily.get(day);

test('effective gap and quiet-day factors preserve the original scoring boundaries',()=>{
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

test('tiny release earns proportional credit instead of resetting the gap; earlier releases survive date filters',()=>{
  const model=releaseGapMatrix(index,[person('0','Ada',{'2026-02-02':0,'2026-02-03':4})],{from:'2026-02-02',to:'2026-02-06'});
  const before=date(model,'0','2026-02-02');
  assert.equal(before.lastRelease.tag,'v1.1.0');
  assert.equal(before.daysSinceRelease,28);
  assert.equal(before.score,46.7);
  assert.equal(date(model,'0','2026-02-03').score,0,'busy authored day neutralises the gap');
  assert.equal(date(model,'0','2026-02-04').score,47.5,'10 out of 200 changed lines remove only 5% of accumulated gap');
  assert.equal(date(model,'0','2026-02-04').effectiveGapDays,28.5);
  assert.equal(date(model,'0','2026-02-04').lastRelease.credit,0.05);
  assert.equal(date(model,'0','2026-02-05').daysSinceRelease,1);
  assert.equal(date(model,'0','2026-02-05').score,49.2);
  assert.equal(model.byId.get('0').latestRelease.tag,'v1.1.1');
  assert.equal(model.byId.get('0').latestRelease.linesChanged,10);
  assert.equal(model.fullCreditLines,200);
});

test('driver-only, baseline, zero-line contributions and weekends do not falsely reset the gap',()=>{
  const model=releaseGapMatrix(index,[person('1','Ben')],{from:'2026-01-30',to:'2026-03-04'});
  assert.equal(date(model,'1','2026-01-30').reason,'no-prior-contribution');
  assert.equal(date(model,'1','2026-01-30').score,null);
  assert.equal(date(model,'1','2026-01-31').reason,'weekend');
  assert.equal(date(model,'1','2026-03-02').score,0,'first genuine incremental contribution resets the gap');
  assert.equal(model.byId.get('1').latestRelease.tag,'v1.1.2');
  assert.equal(date(model,'1','2026-03-03').score,1.7);
  const withZero={...index,releases:[released('v1.1.0','2026-02-02',[member('0',1,0)])]};
  assert.equal(date(releaseGapMatrix(withZero,[person('0','Ada')],{from:'2026-02-02',to:'2026-02-04'}),'0','2026-02-02').reason,'no-prior-contribution');
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
  assert.equal(model.fullCreditLines,200);
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
  assert.equal(evidence.releases[1].members.find(m=>m.id==='0').releaseLineChurn,4);
  assert.equal(date(model,'0','2026-02-02').score,98,'4 of 200 changed lines earn only a 2% reset through reconciled identity');
  assert.equal(date(model,'0','2026-02-03').score,99.7);
  assert.equal(model.rows.length,1);
});

test('absolute line threshold yields proportional credit, never uses percentage of the overall release',()=>{
  assert.equal(releaseContributionCredit(0),0);
  assert.equal(releaseContributionCredit(10),0.05);
  assert.equal(releaseContributionCredit(100),0.5);
  assert.equal(releaseContributionCredit(200),1);
  assert.equal(releaseContributionCredit(10_000),1);
  assert.equal(releaseContributionCredit(10,50),0.2);
  assert.equal(releaseContributionCredit(-1),null);
  assert.equal(releaseContributionCredit(2,0),null);
  const both={...index,releases:[released('v2','2026-01-05',[
    {...member('0',1,20),share:0.01}, {...member('1',1,20),share:0.99},
  ])]};
  const model=releaseGapMatrix(both,[person('0','Ada'),person('1','Ben')],{from:'2026-01-05',to:'2026-01-05'});
  assert.equal(date(model,'0','2026-01-05').score,90);
  assert.equal(date(model,'1','2026-01-05').score,90);
  assert.equal(date(model,'0','2026-01-05').lastRelease.credit,0.1);
});

test('several small releases accumulate relief, and a full-sized release still clears the gap',()=>{
  const events={bounds:{min:'2026-01-01',max:'2026-04-30'},releases:[
    released('v1','2026-01-05',[member('0',1,20)]),
    released('v2','2026-01-06',[member('0',1,20)]),
    released('v3','2026-01-07',[member('0',1,200)]),
  ]};
  const model=releaseGapMatrix(events,[person('0','Ada')],{from:'2026-01-05',to:'2026-01-09'});
  assert.equal(date(model,'0','2026-01-05').score,90);
  assert.equal(date(model,'0','2026-01-06').score,82.5,'aged gap gets another 10% reduction');
  assert.equal(date(model,'0','2026-01-07').score,0,'200 changed lines fully reset');
  assert.equal(date(model,'0','2026-01-08').score,1.7);
  assert.equal(date(model,'0','2026-01-09').score,3.3);
  assert.equal(model.byId.get('0').months.get('2026-01').score,35.5);
  assert.equal(model.byId.get('0').latestEffectiveGap,2);
});

test('a tiny event after an already saturated gap still softens it immediately',()=>{
  const events={bounds:{min:'2026-01-01',max:'2026-05-01'},releases:[
    released('v1','2026-01-05',[member('0',1,200)]),
    released('v2','2026-04-06',[member('0',1,20)]),
  ]};
  const model=releaseGapMatrix(events,[person('0','Ada')],{from:'2026-04-03',to:'2026-04-09'});
  assert.equal(date(model,'0','2026-04-03').score,100);
  assert.equal(date(model,'0','2026-04-06').score,90);
  assert.equal(date(model,'0','2026-04-07').score,91.7);
  assert.equal(date(model,'0','2026-04-06').effectiveGapDays,54);
  const stronger=releaseGapMatrix(events,[person('0','Ada')],{from:'2026-04-06',to:'2026-04-06'},{fullCreditLines:50});
  assert.equal(date(stronger,'0','2026-04-06').score,60,'20 lines is 40% credit at a 50-line threshold');
});

test('text lines exclude VERSION release markers, while docs and test files count',()=>{
  const h=ch=>ch.repeat(40);
  const raw=[
    `TAG|v1.0.0||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v1.1.0||${h('b')}|commit|2026-02-02T12:00:00Z`,
    `TAG|v1.2.0||${h('c')}|commit|2026-02-03T12:00:00Z`,
    `COMMIT|${h('c')}|ada@work|Ada|2026-02-01T12:00:00Z|2026-02-01T12:00:00Z|docs|${h('b')}`,
    `8\t3\tdocs/readme.md`,
    `COMMIT|${h('b')}|ada@work|Ada|2026-01-10T12:00:00Z|2026-01-10T12:00:00Z|version|${h('a')}`,
    `100\t0\tVERSION`,
    `COMMIT|${h('a')}|ada@work|Ada|2026-01-04T12:00:00Z|2026-01-04T12:00:00Z|initial|`,
    `200\t0\tapp/main.rb`,
  ].join('\n');
  const history=parseGitHistory(raw);
  const scope=buildAnalysis(history.commits,[{displayName:'Ada',emails:['ada@work']}],{
    start:'2026-01-01',end:'2026-02-10',selectedIds:new Set(['0']),includeMerges:false,includeReverts:true,
  });
  const evidence=buildEvidenceIndex(scope,impactAnalysis(scope,history.commits,history.tags,{skipFollowup:true}),{min:'2026-01-04',max:'2026-02-10'});
  assert.equal(evidence.releases[1].members[0].churn,100);
  assert.equal(evidence.releases[1].members[0].releaseLineChurn,0);
  assert.equal(evidence.releases[2].members[0].releaseLineChurn,11);
  const model=releaseGapMatrix(evidence,scope.contributors,{from:'2026-02-02',to:'2026-02-04'});
  assert.equal(date(model,'0','2026-02-02').reason,'no-prior-contribution');
  assert.equal(date(model,'0','2026-02-03').score,94.5);
  assert.equal(model.byId.get('0').latestRelease.tag,'v1.2.0');
  assert.equal(model.byId.get('0').latestRelease.linesAdded,8);
  assert.equal(model.byId.get('0').latestRelease.linesDeleted,3);
});

test('Pulse lens and knobs have a complete UI and session round-trip',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  for (const id of ['pulse-gap-settings','pulse-gap-horizon','pulse-busy-day','pulse-release-lines','pulse-gap-summary'])
    assert.ok(html.includes(`id="${id}"`));
  assert.match(html,/data-pulse-lens="release-gap"/);
  assert.match(app,/pulseLens:state\.pulseLens,pulseGapHorizon:state\.pulseGapHorizon,pulseBusyDay:state\.pulseBusyDay,pulseReleaseLines:state\.pulseReleaseLines/);
  assert.match(app,/state\.pulseLens=s\.pulseLens/);
  assert.match(app,/pulseReleaseGap=gapMode\?releaseGapMatrix\(perspectiveIndex,view\.contributors/);
  assert.match(app,/fullCreditLines:state\.pulseReleaseLines/);
  assert.match(app,/RELEASE_LINE_THRESHOLDS\.includes\(s\.pulseReleaseLines\)/);
});

test('ordinary-day churn independently softens release-gap concern without changing release credit',()=>{
  assert.equal(releaseGapScore(60,0,{churn:0}),100);
  assert.equal(releaseGapScore(60,0,{churn:50}),75);
  assert.equal(releaseGapScore(60,1,{churn:50}),56.3);
  assert.equal(releaseGapScore(60,0,{churn:200}),0);
  assert.equal(releaseGapScore(60,4,{churn:0}),0);
  assert.equal(releaseGapScore(60,1,{churn:-1}),null);
  assert.equal(releaseGapScore(60,1,{churn:20,busyChurn:0}),null);
  const history={...index,activity:[
    {groupId:'0',date:'2026-02-04',files:[{path:'VERSION',added:9999,deleted:0}]},
    {groupId:'0',date:'2026-02-05',files:[{path:'app/feature.rb',added:40,deleted:10}]},
  ]};
  const model=releaseGapMatrix(history,[person('0','Ada')],{from:'2026-02-04',to:'2026-02-05'});
  assert.equal(date(model,'0','2026-02-04').churn,0);
  assert.equal(date(model,'0','2026-02-05').churn,50);
  assert.equal(date(model,'0','2026-02-04').score,47.5);
  assert.equal(date(model,'0','2026-02-05').score,36.9);
  const stricter=releaseGapMatrix(history,[person('0','Ada')],{from:'2026-02-05',to:'2026-02-05'},{busyChurn:50});
  assert.equal(date(stricter,'0','2026-02-05').score,0);
  assert.equal(model.busyChurn,200);
});
