import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continuityMatrix} from '../assets/continuity.js';
import {normalizeWorkingDays,workingPatternLabel,isScheduledDay,
  continuityScheduleStatus,missingDayColour,extraDayColour} from '../assets/working-patterns.js';
const person={id:'0',displayName:'Contributor'};
const fullWeek={from:'2026-10-05',to:'2026-10-11'};
const dates=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'];
const commit=date=>({groupId:'0',date,files:[{path:'app.rb',added:30,deleted:0}]});
function week(active,days=[1,2,3,4],bounds=fullWeek){
  const index={bounds:{min:bounds.from,max:bounds.to},activity:active.map(n=>commit(dates[n])),releases:[]};
  return continuityMatrix(index,[person],fullWeek,{workingDaysById:{0:days},meaningfulLines:20,weeks:8}).rows[0];
}
test('working-day patterns validate weekday numbers, preserve zero-day patterns and default old sessions',()=>{
  assert.deepEqual(normalizeWorkingDays(undefined),[1,2,3,4,5]);
  assert.deepEqual(normalizeWorkingDays([]),[]);
  assert.deepEqual(normalizeWorkingDays([6,3,3,0]),[0,3,6]);
  assert.deepEqual(normalizeWorkingDays([8]),[1,2,3,4,5]);
  assert.deepEqual(normalizeWorkingDays(['1']),[1,2,3,4,5]);
  assert.match(workingPatternLabel([]),/0-day/);
  assert.equal(isScheduledDay('2026-10-10',[0,6]),true);
  assert.equal(isScheduledDay('2026-10-10',[1,2,3,4]),false);
});
test('four scheduled dates: 4/4 met, 3/4 modest missing, 2/4 below',()=>{
  const met=week([0,1,2,3]);
  const slight=week([0,1,2]);
  const below=week([0,1]);
  assert.deepEqual([met.expectedDays,met.onScheduleDays,met.missedDays,met.extraDays,met.status],[4,4,0,0,'met']);
  assert.deepEqual([slight.expectedDays,slight.onScheduleDays,slight.missedDays,slight.extraDays,slight.status],[4,3,1,0,'slightly-under']);
  assert.deepEqual([below.expectedDays,below.onScheduleDays,below.missedDays,below.extraDays,below.status],[4,2,2,0,'under']);
  assert.notEqual(missingDayColour(1,4),missingDayColour(2,4));
  assert.equal(missingDayColour(2,20),missingDayColour(1,4),'two missing dates in a 20-day month are modest, not equivalent to two of four');
  assert.equal(continuityScheduleStatus({observedDays:31,expectedDays:20,missedDays:2}),'slightly-under');
});
test('extra unscheduled activity never conceals a missed planned date',()=>{
  const row=week([0,1,2,4]); // Mon–Wed + Fri, but Thursday missed
  assert.equal(row.expectedDays,4);
  assert.equal(row.meaningfulDays,4);
  assert.equal(row.coverage,1,'raw total is equal yet does not imply that the plan was met');
  assert.equal(row.missedDays,1);
  assert.equal(row.extraDays,1);
  assert.equal(row.status,'slightly-under');
  assert.equal(row.daily.get('2026-10-09').extra,true);
  assert.equal(row.daily.get('2026-10-08').missing,true);
  assert.notEqual(extraDayColour(0),extraDayColour(1));
  assert.notEqual(extraDayColour(1),extraDayColour(2));
});
test('planned weekends count as expected; an unscheduled weekday earns extra credit',()=>{
  const row=week([0,1,4,5,6],[1,2,3,6]);
  assert.equal(row.expectedDays,4);
  assert.equal(row.onScheduleDays,3);
  assert.equal(row.missedDays,1);
  assert.equal(row.extraDays,2);
  assert.equal(row.daily.get('2026-10-10').workday,true);
  assert.equal(row.daily.get('2026-10-11').workday,false);
  assert.equal(row.weekendMeaningfulDays,2,'calendar weekend facts remain separate from configured days');
});
test('zero-, one-, two- and three-day patterns have safe denominators and meaningful statuses',()=>{
  const none=week([5,6],[]);
  assert.equal(none.expectedDays,0);
  assert.equal(none.missedDays,0);
  assert.equal(none.extraDays,2);
  assert.equal(none.coverage,null);
  assert.equal(none.status,'extra-only');
  const empty=week([],[]);
  assert.equal(empty.status,'no-schedule');
  assert.equal(empty.longestGap.workdays,0);
  const one=week([],[4]);
  assert.deepEqual([one.expectedDays,one.missedDays,one.status],[1,1,'under']);
  const two=week([0],[1,2]);
  assert.deepEqual([two.expectedDays,two.missedDays,two.status],[2,1,'under']);
  const three=week([0,1],[1,2,3]);
  assert.deepEqual([three.expectedDays,three.missedDays,three.status],[3,1,'slightly-under']);
  assert.equal(continuityScheduleStatus({observedDays:0,expectedDays:3,missedDays:3}),'unknown');
});
test('seven scheduled days have a seven-day denominator, with no artificial weekend bonus',()=>{
  const all=week([0,1,2,3,4,5,6],[0,1,2,3,4,5,6]);
  assert.equal(all.expectedDays,7);
  assert.equal(all.onScheduleDays,7);
  assert.equal(all.extraDays,0);
  assert.equal(all.coverage,1);
  assert.equal(all.status,'met');
});
test('partial history and filtered dates do not fabricate missing scheduled days',()=>{
  const partial=week([2],[1,2,3,4],{from:'2026-10-07',to:'2026-10-09'});
  assert.equal(partial.expectedDays,2);
  assert.equal(partial.missedDays,1);
  assert.equal(partial.unknownDays,4);
  assert.equal(partial.partialHistory,true);
  assert.equal(partial.rollingMissingDays,null);
  const index={bounds:{min:'2026-10-01',max:'2026-10-31'},activity:[commit('2026-10-07')],releases:[]};
  const chosen=continuityMatrix(index,[person],{from:'2026-10-07',to:'2026-10-08'},
    {workingDaysById:{0:[1,2,3,4]}}).rows[0];
  assert.equal(chosen.expectedDays,2);
  assert.equal(chosen.missedDays,1);
});
test('rolling expectation counts the complete prior period on each contributor-specific pattern',()=>{
  const start='2026-01-01',end='2026-10-31';
  const index={bounds:{min:start,max:end},activity:[commit('2026-10-05'),commit('2026-10-09')],releases:[]};
  const row=continuityMatrix(index,[person],fullWeek,{weeks:8,workingDaysById:{0:[1,2,3,4]}}).rows[0];
  assert.equal(row.missedDays,3);
  assert.equal(row.extraDays,1);
  assert.ok(row.rollingMissingDays>3);
  assert.equal(row.rollingExtraDays,1);
});
test('UI, identity persistence and import contracts expose contributor-specific patterns',()=>{
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const external=readFileSync(new URL('../assets/external-identities.js',import.meta.url),'utf8');
  assert.match(app,/workingDaysById:Object.fromEntries/);
  assert.match(app,/workingDays:normalizeWorkingDays\(g\.workingDays\)/);
  assert.match(app,/workingDays:normalizeWorkingDays\(group\.workingDays\)/);
  assert.match(app,/renderWorkingPatterns\(view\)/);
  assert.match(app,/data-action="toggle-pattern-day"/);
  assert.match(app,/const continuityBandStyle=colour=>/,'continuity cell rendering helper must be defined');
  assert.match(app,/data-action="pattern-preset"/);
  assert.match(html,/id="continuity-pattern-editor"/);
  assert.match(html,/id="continuity-schedule-details"/);
  assert.match(external,/\.\.\.g,emails:/);
});
