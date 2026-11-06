import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {impactAnalysis} from '../assets/impact.js';
import {releaseGapMatrix,releaseGapScore} from '../assets/release-gap.js';
import {contributionUnits,momentumMatrix,momentumScore} from '../assets/momentum.js';
import {
  temporalDay,temporalActivityByPerson,temporalActivitySummary,temporalOptions,
  nonVersionChurn,emptyTemporalDay,MAX_GAP_DISTRIBUTION_RELIEF,
} from '../assets/temporal-activity.js';

const c=(hour,minute,lines=50,path='src/change.rb',date='2026-02-02',id='0')=>({
  groupId:id,date,hour,minute,files:[{path,added:lines,deleted:0}],
});
const contributor=(id='0')=>({id,displayName:id==='0'?'Ada':'Ben',daily:{commits:{},churn:{}}});
const release={date:'2026-01-05',tag:'v1',baseline:false,members:[{id:'0',commits:1,releaseLineChurn:200}]};
const workdays=(date,count)=>{
  const rows=[];let next=Date.parse(`${date}T12:00:00Z`);
  while(rows.length<count){const d=new Date(next),dow=d.getUTCDay();if(dow!==0&&dow!==6)rows.push(d.toISOString().slice(0,10));next+=86_400_000;}
  return rows;
};

test('captured local minutes, not UTC hour rounding, determine distinct time windows and first/last span',()=>{
  const day=temporalDay([c(9,10),c(10,45),c(12,20),c(16,10)]);
  assert.equal(day.firstMinute,9*60+10);
  assert.equal(day.lastMinute,16*60+10);
  assert.equal(day.spanMinutes,420);
  assert.equal(day.activePeriods,4);
  assert.equal(day.substantivePeriods,4);
  assert.equal(day.weightedPeriodUnits,4);
  assert.equal(day.spread,1);
  assert.equal(day.distribution,1);
  assert.equal(day.distributed,true);
  assert.equal(day.status,'observed');
});

test('one large commit has unmeasurable spread yet retains full churn credit',()=>{
  const day=temporalDay([c(10,45,1200)]);
  assert.equal(day.churn,1200);
  assert.equal(day.spanMinutes,null);
  assert.equal(day.spread,null);
  assert.equal(day.distribution,null);
  assert.equal(day.weightedPeriodUnits,1);
  assert.equal(day.meaningful,true);
  assert.equal(contributionUnits({commits:1,churn:day.churn,distribution:day.distribution}),.25/4+.45);
  assert.equal(releaseGapScore(60,1,{churn:200,distribution:day.distribution}),0);
});

test('two tiny far-apart commits do not masquerade as a full day of sustained work',()=>{
  const tiny=temporalDay([c(9,0,1),c(18,0,1)]);
  const substantial=temporalDay([c(9,0,50),c(18,0,50)]);
  const singleBigAndNoise=temporalDay([c(9,0,500),c(18,0,1)]);
  assert.equal(tiny.spanMinutes,540);
  assert.equal(tiny.spread,0.333);
  assert.ok(tiny.distribution<0.01);
  assert.equal(tiny.distributed,false);
  assert.ok(substantial.distribution>tiny.distribution);
  assert.ok(singleBigAndNoise.distribution<substantial.distribution);
  assert.equal(releaseGapScore(60,0,{distribution:1}),85);
  assert.ok(releaseGapScore(60,0,{distribution:tiny.distribution})>99);
  assert.equal(MAX_GAP_DISTRIBUTION_RELIEF,.15);
});

test('multiple commits within one window do not generate distribution credit',()=>{
  const day=temporalDay([c(9,0,100),c(9,3,100),c(9,10,100)]);
  assert.equal(day.activePeriods,1);
  assert.equal(day.spread,0);
  assert.equal(day.distribution,0);
  assert.equal(day.distributed,false);
});

test('VERSION-only and missing-clock evidence never inflate churn or fabricate span',()=>{
  const item=temporalDay([c(9,0,10_000,'VERSION'),c(17,0,20,'src/a.rb'),{...c(null,null,100),minute:null}]);
  assert.equal(item.churn,120);
  assert.equal(item.untimedCommits,1);
  assert.equal(item.status,'partial');
  assert.equal(item.distribution,0);
  assert.equal(nonVersionChurn(c(9,0,999,'dir/VERSION')),0);
  assert.equal(emptyTemporalDay().status,'no-commits');
  assert.equal(temporalDay([c(null,null,100)]).status,'no-time');
  assert.equal(temporalDay([c(9,0,10),c(17,0,10,'VERSION')]).weightedPeriodUnits,.2);
});

test('period length and churn cap are configurable, validated, and produce independently cached fingerprints',()=>{
  const commits=[c(9,10,25),c(10,20,25),c(11,35,25),c(12,50,25)];
  const hour=temporalDay(commits,{period:60,churnCap:25});
  const twoHour=temporalDay(commits,{period:120,churnCap:100});
  assert.equal(hour.activePeriods,4);
  assert.equal(twoHour.activePeriods,3);
  assert.ok(hour.distribution>twoHour.distribution);
  assert.deepEqual(temporalOptions({period:17,churnCap:-1,meaningfulLines:1000}),{period:90,churnCap:50,meaningfulLines:20});
  const idx={activity:commits,bounds:{min:'2026-02-02',max:'2026-02-06'}};
  const first=temporalActivityByPerson(idx,{period:60,churnCap:25});
  assert.equal(first,temporalActivityByPerson(idx,{period:60,churnCap:25}));
  assert.notEqual(first,temporalActivityByPerson(idx,{period:120,churnCap:25}));
});

test('daily and monthly consistency counts covered workdays, excludes weekends, respects full filtered history and unknown clock',()=>{
  const idx={activity:[c(9,0,50),c(15,0,50),c(9,0,30,'src/a.rb','2026-02-03'),c(null,null,300,'src/a.rb','2026-02-04'),c(9,0,200,'src/a.rb','2026-02-07')],bounds:{min:'2026-02-02',max:'2026-02-10'}};
  const summary=temporalActivitySummary(idx,[contributor()],{from:'2026-02-01',to:'2026-02-12'});
  const row=summary.byId.get('0');
  assert.equal(row.coveredDays,7); // Mon 2 to Tue 10
  assert.equal(row.meaningfulDays,3); // Mon, Tue, Wed
  assert.equal(row.distributedDays,1);
  assert.equal(row.daysWithClock,2);
  assert.equal(row.daysWithMeasuredSpan,1);
  assert.equal(row.meanSpanMinutes,360);
  assert.equal(row.months.get('2026-02').meaningfulDays,3);
  assert.equal(temporalActivitySummary(idx,[contributor()],{from:'2026-02-03',to:'2026-02-03'}).byId.get('0').daily.get('2026-02-02').churn,100,'raw evidence is retained despite selected date range');
});

test('release-gap independently softens high concern for multi-period churn without altering tagged credit',()=>{
  const idx={activity:[c(9,10,20),c(11,10,20),c(13,10,20),c(16,10,20)],releases:[release],bounds:{min:'2026-01-05',max:'2026-03-20'}};
  // all changes occurred on Feb 2, long after a release, without affecting its credit
  const withSpread=releaseGapMatrix(idx,[contributor()],{from:'2026-02-02',to:'2026-02-02'});
  const day=withSpread.byId.get('0').daily.get('2026-02-02');
  assert.ok(day.temporal.distribution>0);
  assert.ok(day.score<releaseGapScore(day.effectiveGapDays,0,{churn:0}));
  assert.equal(day.lastRelease.credit,1);
  const withNoClock=releaseGapMatrix({...idx,activity:idx.activity.map(({hour,minute,...rest})=>rest)},[contributor()],{from:'2026-02-02',to:'2026-02-02'});
  assert.ok(withNoClock.byId.get('0').daily.get('2026-02-02').score>=day.score);
  assert.equal(withNoClock.byId.get('0').daily.get('2026-02-02').lastRelease.credit,1);
});

test('momentum rewards growing meaningful-day consistency over same total churn in a concentrated period',()=>{
  const days=workdays('2026-01-05',20);
  const even=days.slice(10).flatMap(d=>[c(9,0,20,'src/a.rb',d),c(16,0,20,'src/a.rb',d)]);
  const concentrated=days.slice(10).flatMap((d,i)=>i===0?[c(9,0,400,'src/a.rb',d)]:[]);
  const base={bounds:{min:days[0],max:days.at(-1)},releases:[]};
  const steady=momentumMatrix({...base,activity:even},[contributor()],{from:days.at(-1),to:days.at(-1)});
  const burst=momentumMatrix({...base,activity:concentrated},[contributor()],{from:days.at(-1),to:days.at(-1)});
  const s=steady.byId.get('0').daily.get(days.at(-1)),b=burst.byId.get('0').daily.get(days.at(-1));
  assert.equal(s.recent.meaningfulDays,10);
  assert.equal(b.recent.meaningfulDays,1);
  assert.equal(s.previous.consistency,0);
  assert.ok(s.recent.pace>b.recent.pace);
  assert.ok(s.score>b.score);
  assert.equal(s.temporal.distributed,true);
  assert.equal(b.temporal.status,'no-commits');
});

test('imported Git timestamps survive compact evidence indexing, identity merging and policy filtering',()=>{
  const h=char=>char.repeat(40);
  const history=parseGitHistory([
    `TAG|v1||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v2||${h('b')}|commit|2026-02-02T12:00:00Z`,
    `COMMIT|${h('b')}|ada@home|Ada|2026-02-02T16:30:00+01:00|2026-02-02T17:00:00+01:00|feat|${h('a')}`,
    '80\t0\tsrc/app.rb',
    `COMMIT|${h('a')}|ada@work|Ada|2026-02-02T09:15:00+01:00|2026-02-02T10:00:00+01:00|initial|`,
    '70\t0\tsrc/config.rb',
  ].join('\n'));
  const groups=[{displayName:'Ada',emails:['ada@work','ada@home']}];
  const view=buildAnalysis(history.commits,groups,{start:'2026-01-05',end:'2026-02-05',includeMerges:false,includeReverts:true});
  const idx=buildEvidenceIndex(view,impactAnalysis(view,history.commits,history.tags,{skipFollowup:true}),{min:'2026-01-05',max:'2026-02-05'});
  const compact=idx.activity.filter(x=>x.date==='2026-02-02');
  assert.deepEqual(compact.map(x=>x.minute).sort(),[15,30]);
  const record=temporalActivityByPerson(idx).get('0').get('2026-02-02');
  assert.equal(record.spanMinutes,435);
  assert.equal(record.churn,150);
});

test('all three Pulse lenses expose shared timing settings, detailed evidence and backward-compatible session controls',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  for(const id of ['pulse-activity-summary','pulse-temporal-settings','pulse-temporal-period','pulse-temporal-churn','pulse-meaningful-lines'])assert.ok(html.includes(`id="${id}"`));
  assert.match(app,/pulseTemporalPeriod:state\.pulseTemporalPeriod,pulseTemporalChurn:state\.pulseTemporalChurn,pulseMeaningfulLines:state\.pulseMeaningfulLines/);
  assert.match(app,/TEMPORAL_PERIODS\.includes\(s\.pulseTemporalPeriod\)/);
  assert.match(app,/TEMPORAL_CHURN_CAPS\.includes\(s\.pulseTemporalChurn\)/);
  assert.match(app,/MEANINGFUL_CHURN_THRESHOLDS\.includes\(s\.pulseMeaningfulLines\)/);
  assert.match(app,/pulseTemporalDayDetails\(temporalItem\)/);
  assert.match(app,/temporalActivitySummary\(perspectiveIndex,view\.contributors/);
  assert.match(app,/temporal:timing/);
});

test('mixed authored timezone offsets suppress misleading spans and temporal credit, but not churn or meaningful days',()=>{
  const items=[{...c(9,0,80),offsetMinutes:0},{...c(17,0,80),offsetMinutes:60}];
  const day=temporalDay(items);
  assert.equal(day.mixedOffsets,true);
  assert.equal(day.status,'mixed-zones');
  assert.equal(day.spanMinutes,null);
  assert.equal(day.distribution,null);
  assert.equal(day.churn,160);
  assert.equal(day.meaningful,true);
  assert.equal(releaseGapScore(60,1,{churn:160,distribution:day.distribution}),15);
  const sameZone=temporalDay(items.map(x=>({...x,offsetMinutes:0})));
  assert.ok(sameZone.distribution>0);
});

test('invalid or nonfinite file statistics cannot poison daily distribution or churn',()=>{
  const broken={...c(8,0,0),files:[
    {path:'src/valid.js',added:30,deleted:5},
    {path:'src/unknown.js',added:'Infinity',deleted:'not-a-number'},
    {path:'config/VERSION',added:10000,deleted:10000},
  ]};
  assert.equal(nonVersionChurn(broken),35);
  const day=temporalDay([broken,c(16,0,60)]);
  assert.equal(day.churn,95);
  assert.ok(Number.isFinite(day.distribution));
});
