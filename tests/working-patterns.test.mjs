import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continuityMatrix} from '../assets/continuity.js';
import {normalizeWorkingDays,workingPatternLabel,isScheduledDay,
  continuityScheduleStatus,continuityCountBalance,missingDayColour,extraDayColour,normalizeLeave,workedDaysBalance} from '../assets/working-patterns.js';
import {buildIdentityConfig,parseIdentityConfig} from '../assets/identity-config.js';
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
  assert.equal(continuityScheduleStatus({observedDays:31,expectedDays:20,meaningfulDays:18}),'slightly-under');
});
test('a substitute weekday fulfils the weekly count without hiding named-date evidence',()=>{
  const row=week([0,1,2,4]); // Mon–Wed + Fri, Thursday not matched
  assert.deepEqual([row.expectedDays,row.meaningfulDays,row.status],[4,4,'met']);
  assert.deepEqual([row.shortfallDays,row.overageDays,row.substitutionDays],[0,0,1]);
  assert.deepEqual([row.onScheduleDays,row.missedDays,row.extraDays],[3,1,1],
    'the named weekday mismatch remains inspectable, but is not an overall deficit');
  assert.equal(row.daily.get('2026-10-09').extra,true);
  assert.equal(row.daily.get('2026-10-08').missing,true);
  assert.equal(row.daily.get('2026-10-08').weeklyStatus,'met',
    'daily detail must report the eventual weekly result');
  assert.notEqual(extraDayColour(0),extraDayColour(1));
  assert.notEqual(extraDayColour(1),extraDayColour(2));
});
test('primary weekly status distinguishes 2/4, 3/4, 4/4 and 5/4 with off-pattern dates',()=>{
  const under2=week([0,4]);
  const under1=week([0,1,4]);
  const matched=week([0,1,2,4]);
  const over=week([0,1,2,3,4]);
  assert.deepEqual([under2.shortfallDays,under2.overageDays,under2.status],[2,0,'under']);
  assert.deepEqual([under1.shortfallDays,under1.overageDays,under1.status],[1,0,'slightly-under']);
  assert.deepEqual([matched.shortfallDays,matched.overageDays,matched.status],[0,0,'met']);
  assert.deepEqual([over.shortfallDays,over.overageDays,over.status],[0,1,'above']);
  assert.equal(over.extraDays,1);
  assert.equal(matched.extraDays,1);
  assert.equal(continuityCountBalance({observedDays:0,expectedDays:4,meaningfulDays:4}).status,'unknown');
});
test('planned weekends count as expected; an unscheduled weekday earns extra credit',()=>{
  const row=week([0,1,4,5,6],[1,2,3,6]);
  assert.equal(row.expectedDays,4);
  assert.equal(row.onScheduleDays,3);
  assert.equal(row.missedDays,1);
  assert.equal(row.extraDays,2);
  assert.equal(row.substitutionDays,1);
  assert.equal(row.shortfallDays,0);
  assert.equal(row.overageDays,1);
  assert.equal(row.status,'above');
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
  assert.equal(none.overageDays,0,'zero baseline is no quota: recorded activity is not overage');
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
  assert.equal(all.shortfallDays,0);
  assert.equal(all.overageDays,0);
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
test('overage in another week does not cancel the shortfall in a quiet week or month',()=>{
  const first=['2026-10-05','2026-10-06','2026-10-07']; // 3 / 4
  const second=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16']; // 5 / 4
  const index={bounds:{min:'2026-10-05',max:'2026-10-18'},
    activity:[...first,...second].map(commit),releases:[]};
  const row=continuityMatrix(index,[person],{from:'2026-10-05',to:'2026-10-18'},
    {workingDaysById:{0:[1,2,3,4]}}).rows[0];
  assert.deepEqual([row.meaningfulDays,row.expectedDays],[8,8]);
  assert.deepEqual([row.shortfallDays,row.overageDays,row.status],[1,1,'mixed']);
  const october=row.months.get('2026-10');
  assert.deepEqual([october.shortfallDays,october.overageDays,october.status],[1,1,'mixed']);
  assert.deepEqual([row.weeks.get('2026-10-05').shortfallDays,row.weeks.get('2026-10-12').overageDays],[1,1]);
});
test('monthly buckets show week slices; the complete cross-month week remains authoritative',()=>{
  const active=['2026-10-26','2026-10-29','2026-10-30','2026-10-31'];
  const index={bounds:{min:'2026-10-26',max:'2026-11-01'},activity:active.map(commit),releases:[]};
  const row=continuityMatrix(index,[person],{from:'2026-10-26',to:'2026-11-01'},
    {workingDaysById:{0:[4,5,6,0]}}).rows[0]; // Thu–Sun reference
  assert.deepEqual([row.expectedDays,row.meaningfulDays,row.shortfallDays,row.overageDays],[4,4,0,0]);
  assert.equal(row.weeks.get('2026-10-26').status,'met');
  assert.equal(row.months.get('2026-10').overageDays,1);
  assert.equal(row.months.get('2026-11').shortfallDays,1);
});
test('rolling continuity aggregates each week separately across the complete lookback',()=>{
  const start='2026-09-07',end='2026-11-01',active=[];
  for(let i=0;i<56;i++){
    const date=new Date(Date.parse(`${start}T12:00:00Z`)+i*86400000).toISOString().slice(0,10);
    const dow=new Date(`${date}T12:00:00Z`).getUTCDay();
    if([1,2,3,4].includes(dow)&&date!=='2026-09-09')active.push(date);
  }
  active.push('2026-09-18'); // one extra day in a *different* week
  const index={bounds:{min:start,max:end},activity:active.map(commit),releases:[]};
  const row=continuityMatrix(index,[person],{from:'2026-10-26',to:end},
    {weeks:8,workingDaysById:{0:[1,2,3,4]}}).rows[0];
  assert.equal(row.rollingCoverage,1);
  assert.equal(row.rollingShortfallDays,1);
  assert.equal(row.rollingOverageDays,1);
  assert.equal(row.rollingWeeksUnder,1);
  assert.equal(row.rollingWeeksOver,1);
});
test('UI, identity persistence and import contracts expose contributor-specific patterns',()=>{
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const external=readFileSync(new URL('../assets/external-identities.js',import.meta.url),'utf8');
  assert.match(app,/const workingDaysById=\(\)=>Object.fromEntries\(mergeGroups/,'every model measures against the same identity working days');
  assert.match(app,/const groupSettings=g=>\(\{workingDays:normalizeWorkingDays\(g\.workingDays\),leave:normalizeLeave\(g\.leave\)\}\)/,'working days and leave are saved together');
  assert.match(app,/mergeGroups:mergeGroups\.map\(g=>\(\{displayName:g\.displayName,emails:\[\.\.\.g\.emails\],\.\.\.groupSettings\(g\)\}\)\)/,'sessions keep each identity\'s schedule and leave');
  assert.match(app,/data-leave-field="\$\{field\}"/);
  assert.match(app,/renderWorkingPatterns\(view\)/);
  assert.match(app,/data-action="toggle-pattern-day"/);
  assert.match(app,/const continuityBandStyle=colour=>/,'continuity cell rendering helper must be defined');
  assert.match(app,/data-action="pattern-preset"/);
  assert.match(html,/id="continuity-pattern-editor"/);
  assert.match(html,/id="continuity-schedule-details"/);
  assert.match(external,/\.\.\.g,emails:/);
});

test('non-working-day share follows each identity\'s working days and never counts people without any as off',async()=>{
  const {buildAnalysis,offDayShare}=await import('../assets/domain.js');
  const commits=[['2026-01-10','a@x'],['2026-01-12','a@x'],['2026-01-11','b@x'],['2026-01-12','b@x'],['2026-01-10','c@x']]
    .map(([date,email],i)=>({hash:`h${i}`,email,name:email,date,authoredAt:Date.parse(`${date}T10:00:00Z`),hour:10,minute:0,subject:'x',parents:[],files:[{path:'a.rb',added:1,deleted:0}]}));
  const view=buildAnalysis(commits,[{displayName:'A',emails:['a@x']},{displayName:'B',emails:['b@x'],workingDays:[0,1,2,3,4]},{displayName:'C',emails:['c@x'],workingDays:[]}],{start:'2026-01-01',end:'2026-01-31'});
  const [a,b,c]=['0','1','2'].map(id=>view.byId.get(id));
  assert.equal(a.offDayCommits,1,'Saturday is off for a Mon–Fri identity');
  assert.equal(b.offDayCommits,0,'Sunday is a working day for a Sun–Thu identity');
  assert.equal(c.offDayCommits,0,'nobody is "off" without working days set');
  assert.equal(offDayShare(view,view.selectedCommits),25,'1 of the 4 commits by people with working days set');
  assert.ok(structuredClone(view.byId.get('0')),'analysis stays plain data so the worker can post it');
});

test('leave defaults to 24 holiday and 8 bank-holiday days a year, in whole or half days',()=>{
  assert.deepEqual(normalizeLeave(undefined),{holidays:24,bankHolidays:8});
  assert.deepEqual(normalizeLeave({holidays:'25.5',bankHolidays:0}),{holidays:25.5,bankHolidays:0});
  assert.deepEqual(normalizeLeave({holidays:-1,bankHolidays:'x'}),{holidays:24,bankHolidays:8});
  assert.deepEqual(normalizeLeave({holidays:'',bankHolidays:400}),{holidays:24,bankHolidays:8});
});

test('worked days are measured per calendar year against working days less a share of yearly leave',()=>{
  // A full 2025 and the first half of 2026, Mon–Thu, with work on every Monday plus one Saturday.
  const activity=[];
  for(let d=Date.parse('2025-01-01T00:00:00Z');d<=Date.parse('2026-06-30T00:00:00Z');d+=86400000){
    const date=new Date(d).toISOString().slice(0,10),day=new Date(d).getUTCDay();
    if(day===1)activity.push({groupId:'0',date});
  }
  activity.push({groupId:'0',date:'2025-03-08'},{groupId:'0',date:'2025-01-01'},{groupId:'0',date:'2026-06-30'});
  const index={bounds:{min:'2025-01-01',max:'2026-06-30'},activity};
  const model=workedDaysBalance(index,[{id:'0',displayName:'Ada',workingDays:[1,2,3,4]}],{from:'2024-06-01',to:'2026-12-31'});
  assert.deepEqual(model.years.map(y=>y.year),[2025,2026],'dates outside imported history are left out');
  const [y2025,y2026]=model.rows[0].years;
  assert.equal(y2025.scheduled,209,'Mon–Thu days in 2025');
  assert.equal(y2025.allowance,32,'a full year carries all 24 + 8 days of leave');
  assert.equal(y2025.expected,177);
  assert.equal(y2025.worked,54,'52 Mondays, New Year\'s Day and a Saturday: work on a non-working day counts');
  assert.equal(y2025.offSchedule,1);
  assert.equal(y2025.balance,-123);
  assert.equal(y2026.allowance,15.9,'half a year carries half the leave');
  const total=model.rows[0].total;
  assert.equal(total.expected,Math.round((y2025.expected+y2026.expected)*10)/10);
  assert.equal(total.balance,Math.round((total.worked-total.expected)*10)/10);
});

test('each identity has its own leave, and leave travels in identity configurations',()=>{
  const index={bounds:{min:'2025-01-01',max:'2025-12-31'},activity:['0','1'].flatMap(groupId=>[{groupId,date:'2025-01-01'},{groupId,date:'2025-12-31'}])};
  const people=[{id:'0',displayName:'A',workingDays:[1,2,3,4,5]},{id:'1',displayName:'B',workingDays:[1,2,3,4,5],leave:{holidays:30,bankHolidays:8}}];
  const [a,b]=workedDaysBalance(index,people,{from:'2025-01-01',to:'2025-12-31'},{leaveById:{0:{holidays:0,bankHolidays:0}}}).rows;
  assert.equal(a.years[0].expected,261,'no leave: every Mon–Fri day of 2025');
  assert.equal(a.years[0].worked,2);
  assert.equal(b.years[0].expected,261-38);
  const config=buildIdentityConfig([{displayName:'B',emails:['b@x'],workingDays:[1,2,3,4],leave:{holidays:30,bankHolidays:8}}],[],'2026-01-01');
  assert.deepEqual(config.groups[0].leave,{holidays:30,bankHolidays:8});
  assert.deepEqual(parseIdentityConfig(config)[0].leave,{holidays:30,bankHolidays:8});
});

test('a person is only measured between their first and last recorded commit',()=>{
  const index={bounds:{min:'2024-01-01',max:'2026-12-31'},activity:[{groupId:'0',date:'2025-07-01'},{groupId:'0',date:'2025-12-31'}]};
  const row=workedDaysBalance(index,[{id:'0',displayName:'New',workingDays:[1,2,3,4,5]}],{from:'2024-01-01',to:'2026-12-31'}).rows[0];
  assert.deepEqual(row.years.map(y=>y.measured),[false,true,false],'no shortfall before joining or after the last commit');
  assert.equal(row.years[1].from,'2025-07-01');
  assert.equal(row.total.allowance,16.1,'half a year of leave');
  assert.equal(row.total.expected,row.years[1].expected);
});
