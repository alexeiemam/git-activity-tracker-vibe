import assert from 'node:assert/strict';
import test from 'node:test';
import { generateDemoLog } from '../assets/demo-data.js';
import {
  parseGitLog, buildAnalysis, periodForPreset, validDate, longestStreak, moveContributorIdentities,
  longestConsecutiveWorkdays, dayOfWeek, sum, valueInMode, fileArea, seriesForAnalysis, pulseDayDetails,
} from '../assets/domain.js';

const GROUPS = [
  { displayName:'Alex', emails:['a@example.test','alias@example.test'] },
  { displayName:'Blair', emails:['b@example.test'] },
];
const log = [
  'COMMIT|a1|a@example.test|Alex|2026-10-28T08:45:00+01:00|feat: add a | tricky subject|1111111',
  '10\t3\tapp/models/user.rb',
  '1\t0\tVERSION',
  'COMMIT|a2|alias@example.test|Alex|2026-10-28T11:00:00+01:00|Revert "feat: add a"|2222222',
  '2\t4\tapp/models/user.rb',
  'COMMIT|a3|a@example.test|Alex|2026-10-30T19:00:00+01:00|merge feature|2222222 3333333',
  '5\t2\tREADME.md',
  'COMMIT|b1|b@example.test|Blair|2026-10-28T22:00:00+00:00|fix API|4444444',
  '4\t8\tapp/controllers/api.rb',
  'COMMIT|b2|b@example.test|Blair|2026-10-29|binary update',
  '-\t-\tlogo.png',
].join('\n');
const commits = parseGitLog(log);
const base = { start:'2026-10-28',end:'2026-10-30',includeMerges:false,includeReverts:true,metric:'commits',denominator:'repository' };

test('parser preserves subjects with pipes, detects merges via parents and handles binary file touches',()=>{
  assert.equal(commits.length,5);
  assert.equal(commits[0].subject,'feat: add a | tricky subject');
  assert.equal(commits[0].touchesVersion,true);
  assert.equal(commits[2].isMerge,true);
  assert.equal(commits[4].hour,null);
  assert.equal(commits[4].files[0].binary,true);
  assert.equal(commits[4].files[0].added,0);
  assert.equal(parseGitLog(`${log}\n${log}`).length,5,'duplicate commit hashes are ignored');
});

test('global author selection applies to every derived quantity while repository remains reference',()=>{
  const a=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0']});
  assert.equal(a.selectedCommits.length,2);
  assert.equal(a.referenceCommits.length,4);
  assert.equal(a.contributors.length,1);
  assert.equal(a.contributors[0].totals.commits,2);
  assert.equal(a.contributors[0].totals.active_days,1);
  assert.equal(a.contributors[0].totals.lines_added,13);
  assert.equal(a.contributors[0].totals.lines_deleted,7);
  assert.equal(a.contributors[0].totals.files,3);
  assert.equal(a.contributors[0].totals.reverts,1);
  assert.equal(a.contributors[0].totals.releases,1);
  assert.equal(a.contributors[0].weekdays[2],2); // Wednesday
  assert.equal(a.contributors[0].hours[8],1);
  assert.equal(a.contributors[0].areas.get('app/').touches,2);
  assert.equal(a.selectedSummary.totals.commits,2);
  assert.equal(a.referenceSummary.totals.commits,4);
  assert.equal(a.referenceTotal,4);
  assert.equal(valueInMode(2,{mode:'share',reference:a.referenceTotal}),50);
  assert.equal(sum([...a.sumsByWeek(a.contributors,'commits').values()]),a.selectedSummary.totals.commits);
});

test('reference changes shares without changing any selected data',()=>{
  const whole=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],denominator:'repository'});
  const cohort=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],denominator:'selection'});
  assert.deepEqual(whole.selectedCommits.map(c=>c.hash),cohort.selectedCommits.map(c=>c.hash));
  assert.equal(cohort.referenceTotal,2);
  assert.equal(valueInMode(2,{mode:'share',reference:cohort.referenceTotal}),100);
});

test('calendar years, rolling windows, and merge/revert filters agree across sources',()=>{
  const narrow=buildAnalysis(commits,GROUPS,{...base,start:'2026-10-29',includeMerges:true,includeReverts:false});
  assert.deepEqual(new Set(narrow.selectedCommits.map(c=>c.hash)),new Set(['a3','b2']));
  assert.equal(narrow.selectedSummary.totals.commits,2);
  assert.equal(narrow.selectedSummary.totals.merges,1);
  assert.equal(narrow.selectedSummary.totals.reverts,0);
  assert.equal(narrow.selectedSummary.calendarDays,2);
  assert.equal(narrow.contributors.reduce((n,c)=>n+c.totals.active_days,0),2);
  assert.equal(narrow.contributors.reduce((n,c)=>n+c.weekdays.reduce((a,b)=>a+b,0),0),narrow.selectedCommits.length);
  assert.ok(narrow.contributors.every(c=>[...c.activeDays].every(d=>d>=narrow.start&&d<=narrow.end)));
  const none=buildAnalysis(commits,GROUPS,{...base,start:'2022-01-01',end:'2022-02-01',selectedIds:[]});
  assert.equal(none.selectedCommits.length,0);
  assert.equal(none.contributors.length,0);
  assert.equal(none.selectedSummary.totals.commits,0);
  assert.ok(none.weeks.length>0);
});

test('active day share counts contributor-days, not union calendar days',()=>{
  const data=buildAnalysis(commits,GROUPS,{...base,metric:'active_days'});
  assert.equal(data.referenceTotal,3); // Alex one + Blair two
  assert.equal(data.selectedSummary.calendarDays,2); // shared Oct 28
  assert.equal(data.selectedSummary.totals.active_days,3);
  assert.equal(sum(data.contributors.map(c=>c.totals.active_days)),3);
  assert.equal(sum([...data.sumsByWeek(data.contributors,'active_days').values()]),3);
});

test('rates never divide by zero and observed versus elapsed time stay distinct',()=>{
  assert.equal(valueInMode(15,{mode:'per_active_day',activeDays:0}),0);
  assert.equal(valueInMode(15,{mode:'share',reference:0}),0);
  assert.equal(valueInMode(15,{mode:'per_week',calendarDays:7}),15);
  assert.equal(valueInMode(15,{mode:'per_week',calendarDays:14}),7.5);
  assert.equal(valueInMode(3,{mode:'per_active_day',activeDays:2}),1.5);
});

test('period anchors to latest imported authored date and ignores browser clock',()=>{
  assert.deepEqual(periodForPreset(commits,'90d'),{start:'2026-08-02',end:'2026-10-30'});
  assert.deepEqual(periodForPreset(commits,'year-2025'),{start:'2025-01-01',end:'2025-12-31'});
  assert.equal(validDate('2026-02-30'),false);
  assert.equal(validDate('2024-02-29'),true);
  assert.equal(dayOfWeek('2026-10-28'),2);
});

test('streaks are date-safe without unexplained hardcoded workweek changes',()=>{
  assert.equal(longestStreak(new Set(['2026-01-01','2026-01-01','2026-01-02','2026-01-04'])),2);
  assert.equal(longestConsecutiveWorkdays(new Set(['2026-09-24','2026-09-25','2026-09-28'])),3);
  assert.equal(longestConsecutiveWorkdays(new Set(['2026-09-24','2026-09-28']),[0,1,2,3]),2);
});

test('demo provides varied identities, releases, reversals and non-empty scopes',()=>{
  const demo=parseGitLog(generateDemoLog({years:3,commits:140}));
  assert.equal(demo.length,140);
  assert.ok(demo.some(c=>c.isMerge));
  assert.ok(demo.some(c=>c.isRevert));
  assert.ok(demo.some(c=>c.touchesVersion));
  assert.equal(fileArea('README.md'),'(root)');
  assert.equal(fileArea('app/models/f.rb'),'app/');
});


test('rolling and cumulative trends compute weighted shares, not averages of weekly ratios',()=>{
  const shortLog=[
    'COMMIT|aa|a@example.test|Alex|2026-01-05T09:00:00Z|one|1234567',
    'COMMIT|ab|a@example.test|Alex|2026-01-12T09:00:00Z|two|1234567',
    ...Array.from({length:8},(_,i)=>`COMMIT|b${i}|b@example.test|Blair|2026-01-13T09:00:00Z|their commit ${i}|1234567`),
  ].join('\n');
  const view=buildAnalysis(parseGitLog(shortLog),GROUPS,{...base,start:'2026-01-05',end:'2026-01-18',selectedIds:['0']});
  const weekly=seriesForAnalysis(view,{mode:'share',trend:'weekly'}).lines[0].vals;
  const rolling=seriesForAnalysis(view,{mode:'share',trend:'rolling'}).lines[0].vals;
  const cumulative=seriesForAnalysis(view,{mode:'share',trend:'cumulative'}).lines[0].vals;
  assert.deepEqual(weekly,[100,100/9]);
  assert.deepEqual(rolling,[100,20]);
  assert.deepEqual(cumulative,[100,20]);
  // Four-week rolling absolute values are totals over those weeks, not an
  // arbitrarily smoothed average disconnected from the numbers in tooltips.
  assert.deepEqual(seriesForAnalysis(view,{mode:'total',trend:'rolling'}).lines[0].vals,[1,2]);
  assert.deepEqual(seriesForAnalysis(view,{mode:'total',trend:'weekly'}).lines[0].vals,[1,1]);
  assert.deepEqual(seriesForAnalysis(view,{mode:'per_week',trend:'rolling'}).lines[0].vals,[1,1]);
});

test('real parent hashes outrank misleading merge-like commit subjects',()=>{
  const parsed=parseGitLog([
    'COMMIT|x|a@example.test|Alex|2026-01-01T09:00:00Z|Merge branch updated tests|2222222',
    'COMMIT|y|a@example.test|Alex|2026-01-02|Merge branch old style',
  ].join('\n'));
  assert.equal(parsed[0].isMerge,false);
  assert.equal(parsed[1].isMerge,true);
});

test('authored instant is retained for correctly ordering commits from different offsets',()=>{
  const parsed=parseGitLog([
    'COMMIT|x|a@example.test|Alex|2026-01-01T23:10:00+02:00|Earlier',
    'COMMIT|y|b@example.test|Blair|2026-01-01T22:00:00+00:00|Later',
  ].join('\n'));
  assert.ok(parsed[0].authoredAt < parsed[1].authoredAt);
  assert.equal(parsed[0].hour,23);
});


test('undefined ratios are null gaps, not fabricated 0% or 0 per-active-day',()=>{
  const source=parseGitLog([
    'COMMIT|x|a@example.test|Alex|2026-01-05T09:00:00Z|feat: ordinary|2222222',
    'COMMIT|y|b@example.test|Blair|2026-01-12T09:00:00Z|Revert "broken"|2222222',
  ].join('\n'));
  const view=buildAnalysis(source,GROUPS,{...base,metric:'reverts',start:'2026-01-05',end:'2026-01-18',selectedIds:['0']});
  assert.deepEqual(seriesForAnalysis(view,{mode:'share',trend:'weekly'}).lines[0].vals,[null,0]);
  assert.deepEqual(seriesForAnalysis(view,{mode:'share',trend:'rolling'}).lines[0].vals,[null,0]);
  assert.deepEqual(seriesForAnalysis(view,{mode:'per_active_day',trend:'weekly'}).lines[0].vals,[0,null]);
  assert.deepEqual(seriesForAnalysis(view,{mode:'total',trend:'weekly'}).lines[0].vals,[0,0]);
});


test('daily pulse detail uses the same authored-date, person and commit filters as every other view',()=>{
  const view=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],denominator:'repository',metric:'churn'});
  const day=pulseDayDetails(view,'0','2026-10-28');
  assert.equal(day.contributorName,'Alex');
  assert.equal(day.metricValue,20); // (10+3+1) added + (3+0+4) deleted
  assert.equal(day.referenceValue,32); // Blair also changed 12 lines on the day
  assert.equal(day.share,62.5);
  assert.equal(day.referenceCommits,3);
  assert.equal(day.commitsCount,2);
  assert.deepEqual(new Set(day.commits.map(c=>c.hash)),new Set(['a1','a2']));
  assert.equal(day.added,13);
  assert.equal(day.deleted,7);
  assert.equal(day.churn,20);
  assert.equal(day.net,6);
  assert.equal(day.fileTouches,3);
  assert.equal(day.uniqueFiles,2);
  assert.deepEqual(day.fileChanges,[{path:'app/models/user.rb',touches:2,added:12,deleted:7,binaryTouches:0},{path:'VERSION',touches:1,added:1,deleted:0,binaryTouches:0}]);
  assert.equal(day.binaryTouches,0);
  assert.equal(day.reverts,1);
  assert.equal(day.merges,0);
  assert.equal(day.versionTouches,1);
  assert.equal(day.firstLocalTime,'08:45');
  assert.equal(day.lastLocalTime,'11:00');
  assert.deepEqual(day.areas,[{name:'app/',touches:2},{name:'(root)',touches:1}]);
  assert.deepEqual(day.commits.map(c=>c.hash),['a2','a1']);
  assert.equal(pulseDayDetails(view,'1','2026-10-28'),null,'unselected people cannot leak into a day');
  assert.equal(pulseDayDetails(view,'0','2026-10-27'),null,'out-of-scope dates are excluded');
});

test('daily pulse distinguishes zero activity from an undefined reference share and respects reference choice',()=>{
  const whole=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],metric:'commits'});
  const quiet=pulseDayDetails(whole,'0','2026-10-29');
  assert.equal(quiet.commitsCount,0);
  assert.equal(quiet.metricValue,0);
  assert.equal(quiet.referenceValue,1);
  assert.equal(quiet.share,0);
  assert.deepEqual(quiet.commits,[]);
  const empty=pulseDayDetails(whole,'0','2026-10-30'); // merge excluded globally
  assert.equal(empty.referenceValue,0);
  assert.equal(empty.share,null);
  const cohort=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],denominator:'selection',metric:'commits'});
  assert.equal(pulseDayDetails(cohort,'0','2026-10-28').share,100);
  assert.equal(pulseDayDetails(cohort,'0','2026-10-29').share,null);
  const excluded=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],includeReverts:false,includeMerges:true,metric:'commits'});
  assert.deepEqual(pulseDayDetails(excluded,'0','2026-10-28').commits.map(c=>c.hash),['a1']);
  assert.deepEqual(pulseDayDetails(excluded,'0','2026-10-30').commits.map(c=>c.hash),['a3']);
  assert.equal(pulseDayDetails(excluded,'0','2026-10-30').merges,1);
});

test('daily active-days compare person-days against same-date contributor-day reference',()=>{
  const view=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],metric:'active_days'});
  const day=pulseDayDetails(view,'0','2026-10-28');
  assert.equal(day.metricValue,1,'two commits still count as one active author date');
  assert.equal(day.referenceValue,2,'Blair has activity that day too');
  assert.equal(day.share,50);
});

test('identity batch moves multiple emails from multiple source contributors atomically', () => {
  const groups = [
    {displayName:'Primary',emails:['main@example.test']},
    {displayName:'Second',emails:['secondary@example.test','secondary-alt@example.test']},
    {displayName:'Third',emails:['third@example.test']},
  ];
  const original = structuredClone(groups);
  const result = moveContributorIdentities(groups,0,[
    'secondary@example.test','THIRD@example.test','third@example.test','unknown@example.test',
  ]);
  assert.deepEqual(result, [
    {displayName:'Primary',emails:['main@example.test','secondary@example.test','third@example.test']},
    {displayName:'Second',emails:['secondary-alt@example.test']},
  ]);
  assert.deepEqual(groups, original, 'the input stays unchanged for Undo');
  assert.equal(new Set(result.flatMap(g=>g.emails)).size,4);
  assert.equal(moveContributorIdentities(result,0,['secondary@example.test']),result,'repeated moves are no-ops');
});

test('identity batch preserves target when source groups before it disappear', () => {
  const groups = [
    {displayName:'Before', emails:['before@example.test']},
    {displayName:'After', emails:['after@example.test']},
    {displayName:'Destination', emails:['home@example.test']},
  ];
  assert.deepEqual(moveContributorIdentities(groups,2,['before@example.test','after@example.test']), [
    {displayName:'Destination', emails:['home@example.test','before@example.test','after@example.test']},
  ]);
  assert.deepEqual(moveContributorIdentities(groups,99,['before@example.test']),groups);
  assert.deepEqual(moveContributorIdentities(groups,2,['not-a-member@example.test']),groups);
});

test('batch identity reconciliation flows through the same dashboard aggregation', () => {
  const split = [
    {displayName:'Alex',emails:['a@example.test']},
    {displayName:'A second workstation',emails:['alias@example.test']},
    {displayName:'Blair',emails:['b@example.test']},
  ];
  const before = buildAnalysis(commits,split,{...base,selectedIds:['0']});
  const moved = moveContributorIdentities(split,0,['alias@example.test']);
  const after = buildAnalysis(commits,moved,{...base,selectedIds:['0']});
  assert.equal(before.selectedSummary.totals.commits,1);
  assert.equal(after.selectedSummary.totals.commits,2);
  assert.deepEqual(after.contributors[0].emails,['a@example.test','alias@example.test']);
  assert.equal(after.referenceSummary.totals.commits,before.referenceSummary.totals.commits);
});

test('weekly rhythm reconciles weekdays, 24 hours and 168 slots from the same timed commits', async () => {
  const { workingRhythm } = await import('../assets/domain.js');
  const view=buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],denominator:'repository'});
  const r=workingRhythm(view,'0');
  assert.equal(r.totalCommits,2);
  assert.equal(r.timedCommits,2);
  assert.equal(r.missingTime,0);
  assert.equal(r.cells.length,168);
  assert.equal(sum(r.cells.map(c=>c.count)),2);
  assert.equal(sum(r.weekdays.map(d=>d.count)),2);
  assert.equal(sum(r.hourTotals),2);
  assert.deepEqual(r.weekdays.map(d=>d.count),[0,0,2,0,0,0,0]);
  assert.equal(r.cells[2*24+8].count,1);
  assert.equal(r.cells[2*24+8].dates,1);
  assert.equal(r.cells[2*24+8].added,11);
  assert.equal(r.cells[2*24+8].fileTouches,2);
  assert.equal(r.cells[2*24+8].referenceCount,1);
  assert.equal(r.cells[2*24+8].referenceShare,100);
  assert.equal(r.cells[2*24+11].count,1,'merged alias contributes to the same person');
  assert.equal(r.cells[2*24+22].count,0,'other contributor is not part of focus');
  assert.equal(r.cells[2*24+22].referenceCount,1,'reference still includes other contributors');
  assert.equal(r.cells[2*24+22].referenceShare,0);
  assert.equal(r.weekdays[2].referenceCount,3);
  assert.ok(Math.abs(r.weekdays[2].referenceShare-(2/3*100))<1e-9);
  assert.equal(workingRhythm(view,'1'),null,'an unselected contributor cannot be inspected');
});

test('weekly rhythm selection uses identical scoped records, excluding date-only hours everywhere', async () => {
  const { workingRhythm } = await import('../assets/domain.js');
  const view=buildAnalysis(commits,GROUPS,{...base,metric:'churn'});
  const r=workingRhythm(view);
  assert.equal(r.totalCommits,4);
  assert.equal(r.timedCommits,3);
  assert.equal(r.missingTime,1);
  assert.deepEqual(r.weekdays.map(d=>d.count),[0,0,3,0,0,0,0], 'date-only Thursday does not get a fabricated time in weekday view');
  assert.equal(r.cells[2*24+22].count,1);
  assert.equal(r.peakDay.day,2);
  assert.equal(r.peakDay.percentage,100);
  assert.equal(r.peakDay.dates,1);
  assert.equal(r.showReference,false,'selection equals reference when everyone is selected');
  const filtered=buildAnalysis(commits,GROUPS,{...base,includeReverts:false,selectedIds:['0'],metric:'files'});
  const focused=workingRhythm(filtered,'0');
  assert.equal(focused.timedCommits,1);
  assert.equal(focused.cells[2*24+11].count,0);
  assert.equal(focused.cells[2*24+8].count,1);
  assert.equal(focused.showReference,true);
  const benchmark=workingRhythm(buildAnalysis(commits,GROUPS,{...base,selectedIds:['0'],denominator:'selection'}),'0');
  assert.equal(benchmark.referenceTimed,2);
  assert.equal(benchmark.cells[2*24+22].referenceCount,0);
  assert.equal(benchmark.cells[2*24+22].referenceShare,null);
  assert.equal(benchmark.showReference,false);
});

test('authored local dates and clock offsets define weekday and hour slots, not UTC conversion', async () => {
  const { workingRhythm } = await import('../assets/domain.js');
  const history=parseGitLog([
    'COMMIT|z1|a@example.test|Alex|2026-10-26T00:30:00+12:00|Monday local|2222222',
    'COMMIT|z2|a@example.test|Alex|2026-10-25T23:30:00-07:00|Sunday local|2222222',
    'COMMIT|z3|a@example.test|Alex|2026-10-26|Date only',
  ].join('\n'));
  const view=buildAnalysis(history,GROUPS,{start:'2026-10-25',end:'2026-10-26',includeMerges:true,includeReverts:true});
  const r=workingRhythm(view,'0');
  assert.equal(r.totalCommits,3);
  assert.equal(r.timedCommits,2);
  assert.deepEqual(r.weekdays.map(d=>d.count),[1,0,0,0,0,0,1]);
  assert.equal(r.cells[0].count,1);
  assert.equal(r.cells[6*24+23].count,1);
  assert.equal(r.peakHour,0,'tie breaks toward earliest author-local hour');
  assert.equal(r.missingTime,1);
});

test('weekly timing remains empty and undefined when all scoped commits lack an authored hour', async () => {
  const { workingRhythm } = await import('../assets/domain.js');
  const view=buildAnalysis(commits,GROUPS,{...base,start:'2026-10-29',end:'2026-10-29',selectedIds:['1']});
  const r=workingRhythm(view,'1');
  assert.equal(r.totalCommits,1);
  assert.equal(r.timedCommits,0);
  assert.equal(r.missingTime,1);
  assert.equal(r.peakSlot,null);
  assert.equal(r.peakDay,null);
  assert.equal(r.weekendShare,null);
  assert.equal(sum(r.weekdays.map(d=>d.count)),0);
  assert.equal(sum(r.cells.map(d=>d.count)),0);
  assert.equal(r.cells[0].percentage,null);
});
