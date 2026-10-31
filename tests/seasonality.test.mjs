import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGitLog, buildAnalysis, seasonalityAnalysis, seasonalMonthValue } from '../assets/domain.js';

const GROUPS = [{displayName:'Ada',emails:['ada@local','ada@work']},{displayName:'Ben',emails:['ben@work']}];
const row = (hash,email,at,subject='Change') => `COMMIT|${hash}|${email}|${email}|${at}|${subject}|0123456`;
const log = entries => parseGitLog(entries.join('\n'));
const viewOf = (entries,scope={}) => buildAnalysis(log(entries),GROUPS,{start:'2023-01-01',end:'2026-12-31',metric:'commits',includeMerges:true,includeReverts:true,...scope});

test('year × month consumes only globally selected authored commits, not the reference group',()=>{
  const entries=[
    row('1','ada@local','2024-01-01T08:00:00+01:00'),
    row('2','ada@work','2024-01-21T20:20:00+00:00'),
    row('3','ben@work','2024-01-21T20:20:00+00:00'),
    row('4','ada@local','2025-02-02T12:00:00Z'),
  ];
  const view=viewOf(entries,{start:'2024-01-01',end:'2025-02-02',selectedIds:['0']});
  const model=seasonalityAnalysis(view,'0');
  assert.equal(model.years.length,2);
  assert.equal(model.years[0].months[0].count,2);
  assert.equal(model.years[0].months[0].referenceCount,3);
  assert.equal(model.years[0].count,2);
  assert.equal(model.years[1].months[1].count,1);
  assert.equal(model.years[0].months[1].count,0,'in-scope quiet months are a real zero');
  assert.equal(model.years[1].months[2].days,0,'future months are not invented zeroes');
  assert.equal(model.years.reduce((a,y)=>a+y.count,0),view.selectedSummary.commits);
  assert.equal(seasonalityAnalysis(view,'1'),null,'cannot secretly focus on an unselected person');
});

test('calendar exposure accounts for leap days, month length, and partial months',()=>{
  const v=viewOf([
    row('a','ada@local','2024-02-01T09:00:00+00:00'),
    row('b','ada@local','2024-02-29T10:00:00+00:00'),
    row('c','ada@local','2024-03-15T10:00:00+00:00'),
    row('d','ada@local','2024-03-31T10:00:00+00:00'),
  ],{start:'2024-02-14',end:'2024-03-20'});
  const y=seasonalityAnalysis(v).years[0];
  assert.equal(y.exposureDays,36);
  assert.deepEqual([y.months[1].days,y.months[2].days],[16,20]);
  assert.equal(y.months[1].count,1);
  assert.equal(y.months[2].count,1);
  assert.equal(seasonalMonthValue(y.months[1]),7/16);
  assert.ok(Math.abs(seasonalMonthValue(y.months[2])-7/20)<1e-12);
  assert.equal(y.months[0].days,0);
  assert.equal(y.full,false);
});

test('each year has separate volume, share and annual-baseline index denominators',()=>{
  const entries=[
    row('a','ada@local','2025-01-01T08:00:00Z'),
    row('b','ada@local','2025-01-05T08:00:00Z'),
    row('c','ada@local','2025-02-02T08:00:00Z'),
    row('d','ada@local','2026-01-01T08:00:00Z'),
  ];
  const years=seasonalityAnalysis(viewOf(entries,{start:'2025-01-01',end:'2026-01-01'})).years;
  const jan=years[0].months[0], feb=years[0].months[1];
  assert.ok(Math.abs(jan.share-200/3)<1e-10);
  assert.ok(Math.abs(feb.share-100/3)<1e-10);
  assert.ok(Math.abs(seasonalMonthValue(jan,'shape')-200/3)<1e-10);
  assert.equal(seasonalMonthValue(jan,'rate'),14/31);
  assert.ok(Math.abs(jan.index-(2/31)/(3/365))<1e-12);
  assert.equal(years[1].months[0].share,100);
  assert.equal(years[1].months[0].index,1,'single observed day is a 1x baseline, but clearly partial');
});

test('relative share and index are undefined, not 0%, for a year with no focus commits',()=>{
  const v=viewOf([
    row('a','ada@local','2024-03-01T10:00:00Z'),
    row('b','ben@work','2025-03-01T10:00:00Z'),
  ],{start:'2024-03-01',end:'2025-03-01',selectedIds:['0']});
  const y=seasonalityAnalysis(v,'0').years[1];
  assert.equal(y.count,0);
  assert.equal(y.months[2].count,0);
  assert.equal(y.months[2].share,null);
  assert.equal(y.months[2].index,null);
  assert.equal(y.months[2].pace,0);
  assert.equal(y.weekendShare,null);
  assert.equal(y.perActiveDay,null);
});

test('year-over-year comparisons match the same covered month/day span, not a whole vs partial year',()=>{
  const entries=[
    row('a','ada@local','2024-01-01T08:00:00Z'),
    row('b','ada@local','2024-02-15T08:00:00Z'),
    row('c','ada@local','2024-10-01T08:00:00Z'),
    row('d','ada@local','2024-12-20T08:00:00Z'),
    row('e','ada@local','2025-01-01T08:00:00Z'),
    row('f','ada@local','2025-02-15T08:00:00Z'),
    row('g','ada@local','2025-10-01T08:00:00Z'),
    row('h','ada@local','2025-10-01T08:00:00Z'),
  ];
  const model=seasonalityAnalysis(viewOf(entries,{start:'2024-01-01',end:'2025-10-01'}));
  const y=model.years[1];
  assert.equal(y.yoy.from,'01-01');
  assert.equal(y.yoy.to,'10-01');
  assert.equal(y.yoy.priorCount,3,'prior-year December must be excluded');
  assert.equal(y.yoy.currentCount,4);
  assert.ok(y.yoy.currentDays>0&&y.yoy.priorDays>0);
  assert.ok(y.yoy.change>0);
  assert.equal(y.full,false);
});

test('day × hour year grids reconcile precisely, keep author-local time and exclude date-only records',()=>{
  const entries=[
    row('a','ada@local','2025-07-07T08:30:00+08:00'),
    row('b','ada@local','2025-07-07T08:30:00-07:00'),
    row('c','ada@local','2025-07-08'),
    row('d','ben@work','2025-07-07T01:00:00Z'),
  ];
  const view=viewOf(entries,{start:'2025-07-07',end:'2025-07-08',selectedIds:['0']});
  const y=seasonalityAnalysis(view,'0').years[0];
  assert.equal(y.count,3);
  assert.equal(y.timedCount,2);
  assert.equal(y.untimedCount,1);
  assert.equal(y.slots[8],2,'Monday 8AM author-local time for two offsets');
  assert.equal(y.slots.reduce((a,b)=>a+b,0),y.timedCount);
  assert.equal(y.activeDays,2);
  assert.equal(y.weekdayExposures.reduce((a,b)=>a+b,0),y.exposureDays);
});

test('contributor trajectories and reference monthly shares share global filters',()=>{
  const entries=[
    row('a','ada@work','2025-01-01T09:00:00Z','fix'),
    row('b','ada@work','2025-01-02T09:00:00Z','Revert "fix"'),
    row('c','ben@work','2025-01-01T09:00:00Z','fix'),
    row('d','ben@work','2025-02-01T09:00:00Z','fix'),
  ];
  const base={start:'2025-01-01',end:'2025-02-10',includeReverts:false};
  const v1=viewOf(entries,{...base,denominator:'repository',selectedIds:['0']});
  const v2=viewOf(entries,{...base,denominator:'selection',selectedIds:['0']});
  const a=seasonalityAnalysis(v1,'0'),b=seasonalityAnalysis(v2,'0');
  assert.equal(a.years[0].months[0].count,1);
  assert.equal(a.years[0].months[0].referenceCount,2);
  assert.equal(b.years[0].months[0].referenceCount,1);
  assert.equal(a.years[0].months[0].count,b.years[0].months[0].count);
  const both=seasonalityAnalysis(viewOf(entries,{...base}));
  assert.equal(both.comparisons.length,2);
  assert.deepEqual(both.comparisons.map(c=>c.years[0].count),[1,2]);
  assert.equal(both.years[0].count,3);
});

test('an established seasonal mean requires at least three complete authored-calendar years',()=>{
  const entries=[row('a','ada@local','2023-01-01T09:00:00Z'),row('b','ada@local','2026-12-31T09:00:00Z')];
  for(const year of [2024,2025,2026])entries.push(row(`x${year}`,'ada@local',`${year}-03-15T09:00:00Z`));
  const model=seasonalityAnalysis(viewOf(entries,{start:'2023-01-01',end:'2026-12-31'}));
  assert.equal(model.fullYears,4);
  assert.equal(model.seasonalAverage[2].count,4);
  assert.ok(Number.isFinite(model.seasonalAverage[2].index));
  const partial=seasonalityAnalysis(viewOf(entries,{start:'2024-04-01',end:'2026-03-01'}));
  assert.equal(partial.fullYears,1);
  assert.equal(partial.seasonalAverage[2].index,null);
  assert.equal(partial.seasonalAverage[2].count,1);
});
