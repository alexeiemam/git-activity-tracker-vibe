import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGitHistory,buildAnalysis,dayNumber,dateAtDay} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {
  continuityMatrix,continuityAuthoredColour,continuityReleaseColour,DEFAULT_CONTINUITY_WINDOW,
  CONTINUITY_WINDOWS,mondayOfDate,
} from '../assets/continuity.js';

const people=[{id:'0',displayName:'Aster'},{id:'1',displayName:'Birch'}];
const window={from:'2026-01-01',to:'2026-05-31'};
const countWorkdays=(a,b)=>{
  let count=0;
  for(let i=dayNumber(a);i<=dayNumber(b);i++){
    const day=new Date(`${dateAtDay(i)}T12:00:00Z`).getUTCDay();
    if(day!==0&&day!==6)count++;
  }
  return count;
};
const commit=(date,lines,id='0',path='lib/product.rb')=>({
  groupId:id,date,files:[{path,added:lines,deleted:0}],
});
function sparseHistory() {
  const dates=['2026-01-09','2026-01-23','2026-02-06','2026-02-20','2026-03-06',
    '2026-03-20','2026-04-03','2026-04-17','2026-05-01','2026-05-15'];
  return {bounds:{min:'2026-01-01',max:'2026-05-31'},activity:[
    commit('2026-01-12',30),commit('2026-02-18',40),commit('2026-04-07',70),commit('2026-05-26',28),
    commit('2026-03-10',5),commit('2026-03-16',250,'0','VERSION'),
    ...dates.map(date=>commit(date,60,'1')),
  ],releases:[
    {baseline:true,tag:'v0',date:'2025-12-25',members:[{id:'0',commits:12,releaseLineChurn:5000}]},
    ...dates.map((date,i)=>({tag:`v${i+1}`,date,baseline:false,lineageComplete:i!==6,
      members:i===0||i===3||i===6||i===9?[
        {id:'0',commits:i===3?4:1,releaseLineChurn:i===6?0:20},
        {id:'1',commits:1,releaseLineChurn:60},
      ]:[{id:'1',commits:2,releaseLineChurn:120}]})),
  ]};
}

test('sparse five-month histories remain visibly sparse despite four release participations',()=>{
  const model=continuityMatrix(sparseHistory(),people,window,{weeks:20,meaningfulLines:20});
  const sparse=model.byId.get('0');
  assert.equal(model.available,true);
  assert.equal(model.releaseAvailable,true);
  assert.equal(model.eligibleReleases,10);
  assert.equal(model.partialReleases,1);
  assert.equal(sparse.coveredDays,countWorkdays(window.from,window.to));
  assert.equal(sparse.meaningfulDays,4,'VERSION-only changes and 5-line commits do not qualify');
  assert.equal(sparse.smallDays,2,'small and VERSION-only authored dates remain visible');
  assert.equal(sparse.meaningfulWeeks,4);
  assert.equal(sparse.participations,4,'count release events, not included commits');
  assert.equal(sparse.opportunities,10,'eligible releases with no authored inclusion count');
  assert.equal(sparse.releaseParticipation,0.4);
  assert.equal(sparse.releasedCommits,7,'one release contains four authored commits');
  assert.equal(sparse.releasedLines,60,'VERSION-only changed lines do not inflate release credit');
  assert.ok(sparse.longestGap.workdays>=20,'extended absence is retained, not reset by occasional releases');
  assert.ok(sparse.coverage<0.05,'all observed quiet weekdays stay in the denominator');
  assert.notEqual(sparse.rollingCoverage,null,'20 trailing weeks of complete imported history available');
  assert.equal(sparse.weeks.size>20,true);
  assert.equal(sparse.partialHistory,false);
  assert.equal(sparse.weeks.get(mondayOfDate('2026-04-07')).meaningfulDays,1);
  assert.equal(sparse.weeks.get(mondayOfDate('2026-04-07')).coveredDays,5);
  assert.equal(sparse.weeks.get(mondayOfDate('2026-04-07')).coverage,0.2);
  assert.equal(sparse.weeks.get(mondayOfDate('2026-04-03')).participations,1);
  assert.equal(sparse.weeks.get(mondayOfDate('2026-04-03')).partialReleases,1);
  assert.equal(sparse.months.get('2026-03').meaningfulDays,0);
  assert.equal(sparse.months.get('2026-03').smallDays,2);
  assert.equal(sparse.months.get('2026-01').from,'2026-01-01');
  assert.equal(sparse.months.get('2026-05').to,'2026-05-31');
});

test('authored and tagged-release clocks differ, including weekend releases',()=>{
  const input={bounds:{min:'2026-02-01',max:'2026-03-31'},
    activity:[commit('2026-02-04',50)],
    releases:[{tag:'v2',date:'2026-03-14',baseline:false,members:[{id:'0',commits:1,releaseLineChurn:50}]}]};
  const model=continuityMatrix(input,[people[0]],{from:'2026-03-01',to:'2026-03-31'});
  const row=model.rows[0],tagged=row.daily.get('2026-03-14');
  assert.equal(row.meaningfulDays,0,'February commit does not appear as a March authored day');
  assert.equal(row.coveredDays,countWorkdays('2026-03-01','2026-03-31'));
  assert.equal(tagged.workday,false);
  assert.equal(tagged.opportunities,1);
  assert.equal(tagged.events.length,1);
  assert.equal(row.participations,1);
  assert.equal(row.releasedLines,50);
  assert.equal(row.weeks.get('2026-03-09').participations,1,'Saturday tag belongs to its actual Monday–Sunday week');
});

test('partial imports exclude unknown weekdays rather than fabricating quiet activity',()=>{
  const input={bounds:{min:'2026-02-10',max:'2026-02-20'},activity:[commit('2026-02-12',30)],releases:[]};
  const model=continuityMatrix(input,[people[0]],{from:'2026-02-01',to:'2026-02-28'},{weeks:8});
  const row=model.rows[0];
  assert.equal(row.coveredDays,countWorkdays('2026-02-10','2026-02-20'));
  assert.equal(row.meaningfulDays,1);
  assert.ok(row.partialHistory);
  assert.equal(row.rollingCoverage,null,'no full eight-week import window');
  assert.equal(row.opportunities,0);
  assert.equal(row.releaseParticipation,null);
  assert.equal(model.releaseAvailable,false,'missing tagged release evidence is not zero participation');
  assert.equal(row.daily.get('2026-02-02').observed,false);
  assert.equal(row.daily.get('2026-02-16').meaningful,false);
});

test('eligible release with no authored involvement is zero participation, not missing release history',()=>{
  const input={bounds:{min:'2026-02-01',max:'2026-02-28'},activity:[],
    releases:[{tag:'v2',date:'2026-02-14',members:[{id:'1',commits:2,releaseLineChurn:40}]}]};
  const model=continuityMatrix(input,[people[0]],{from:'2026-02-01',to:'2026-02-28'});
  assert.equal(model.releaseAvailable,true);
  assert.equal(model.rows[0].opportunities,1);
  assert.equal(model.rows[0].participations,0);
  assert.equal(model.rows[0].releaseParticipation,0);
  assert.equal(model.rows[0].releasedLines,0);
  assert.equal(model.rows[0].longestGap.workdays,countWorkdays('2026-02-01','2026-02-28'));
});

test('a valid release feed with no incremental tags in the chosen period has no opportunities',()=>{
  const input={bounds:{min:'2026-02-01',max:'2026-02-28'},activity:[],
    releases:[{baseline:true,tag:'v1',date:'2026-01-05'},
      {tag:'v2',date:'2026-03-10',members:[{id:'0',commits:2,releaseLineChurn:80}]}]};
  const row=continuityMatrix(input,[people[0]],{from:'2026-02-01',to:'2026-02-28'}).rows[0];
  assert.equal(row.opportunities,0);
  assert.equal(row.releaseParticipation,null);
  assert.equal(row.releasedCommits,0);
});

test('partial release lineage and missing numstat are disclosed instead of inventing shipped lines',()=>{
  const index={bounds:{min:'2026-02-01',max:'2026-02-28'},activity:[],
    releases:[{tag:'v2',date:'2026-02-10',lineageComplete:false,
      members:[{id:'0',commits:1}]}]};
  const model=continuityMatrix(index,[people[0]],{from:'2026-02-01',to:'2026-02-28'});
  assert.equal(model.rows[0].participations,1);
  assert.equal(model.rows[0].partialReleases,1);
  assert.equal(model.rows[0].releasedLines,null);
  assert.equal(model.partialReleases,1);
});

test('rolling windows use complete prior import history rather than the selected display window',()=>{
  const index={bounds:{min:'2025-01-01',max:'2026-05-31'},activity:[commit('2026-04-20',40)],releases:[]};
  const chosen={from:'2026-05-04',to:'2026-05-31'};
  const model=continuityMatrix(index,[people[0]],chosen,{weeks:8});
  const row=model.rows[0];
  assert.equal(row.meaningfulDays,0,'selected May had no meaningful changes');
  assert.ok(row.rollingCoverage>0,'earlier April activity still contributes to eight-week lookback');
  const shorter=continuityMatrix(index,[people[0]],chosen,{weeks:12});
  assert.ok(shorter.rows[0].rollingCoverage>0);
  const onlyMay=continuityMatrix({...index,bounds:{min:'2026-05-04',max:'2026-05-31'}},[people[0]],chosen,{weeks:8});
  assert.equal(onlyMay.rows[0].rollingCoverage,null,'do not treat unobserved prior weeks as quiet');
});

test('fixed continuity colour scales distinguish quiet, small, substantive, release inclusion and unknown',()=>{
  assert.equal(DEFAULT_CONTINUITY_WINDOW,20);
  assert.deepEqual([...CONTINUITY_WINDOWS],[8,12,20]);
  assert.equal(mondayOfDate('2026-05-31'),'2026-05-25');
  assert.equal(continuityAuthoredColour(null),null);
  assert.notEqual(continuityAuthoredColour(0),continuityAuthoredColour(0,true));
  assert.notEqual(continuityAuthoredColour(.2),continuityAuthoredColour(1));
  assert.equal(continuityReleaseColour(0,0,false),null);
  assert.notEqual(continuityReleaseColour(0,0,true),continuityReleaseColour(0,1,true));
  assert.notEqual(continuityReleaseColour(0,3,true),continuityReleaseColour(1,3,true));
});

test('actual Git history keeps reconciled identities and canonical tag aliases in continuity metrics',()=>{
  const h=c=>c.repeat(40);
  const raw=[
    `TAG|v1||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v2||${h('c')}|commit|2026-03-12T12:00:00Z`,
    `TAG|alias-v2||${h('c')}|commit|2026-03-12T12:00:00Z`,
    `COMMIT|${h('c')}|ada@new|Ada|2026-02-22T13:00:00Z|2026-02-22T13:00:00Z|feat: product|${h('b')}`,
    '8\t2\tapp/main.rb',
    `COMMIT|${h('b')}|ben@work|Ben|2026-02-10T12:00:00Z|2026-02-10T12:00:00Z|fix: build|${h('a')}`,
    '2\t1\tapp/build.rb',
    `COMMIT|${h('a')}|ada@old|Ada|2026-01-03T12:00:00Z|2026-01-03T12:00:00Z|chore: version|`,
    '999\t999\tVERSION',
  ].join('\n');
  const parsed=parseGitHistory(raw);
  const full=buildAnalysis(parsed.commits,[
    {displayName:'Ada',emails:['ada@old','ada@new']},{displayName:'Ben',emails:['ben@work']},
  ],{start:'2026-01-01',end:'2026-03-31',selectedIds:new Set(['0','1']),includeMerges:false,includeReverts:true});
  const impact=impactAnalysis(full,parsed.commits,parsed.tags,{skipFollowup:true});
  const evidence=buildEvidenceIndex(full,impact,{min:'2026-01-01',max:'2026-03-31'});
  const model=continuityMatrix(evidence,people,{from:'2026-03-01',to:'2026-03-31'});
  assert.equal(model.eligibleReleases,1,'alias tags collapse to one incremental release');
  assert.equal(model.byId.get('0').participations,1,'reconciled author credit is preserved');
  assert.equal(model.byId.get('0').releasedLines,10,'VERSION-only baseline lines excluded');
  assert.equal(model.byId.get('1').releasedLines,3);
  assert.equal(model.byId.get('0').meaningfulDays,0,'March tag does not move February authored activity');
});

test('continuity UI is a fifth lens with weekly default, separate tracks and persistent options',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../assets/app.css',import.meta.url),'utf8');
  assert.match(html,/data-pulse-lens="continuity"/);
  assert.match(html,/data-pulse-mode="weekly"/);
  assert.match(html,/id="pulse-continuity-summary"/);
  assert.match(html,/id="pulse-continuity-weeks"/);
  assert.match(app,/pulseContinuity=continuityMode\?continuityMatrix\(perspectiveIndex,view\.contributors/);
  assert.match(app,/pulseContinuityWeeks:state\.pulseContinuityWeeks/);
  assert.match(app,/CONTINUITY_WINDOWS\.includes\(s\.pulseContinuityWeeks\)/);
  assert.match(app,/state\.pulseMode='weekly'/);
  assert.match(app,/renderContinuityPeriodPulse/);
  assert.match(app,/renderContinuityDailyPulse/);
  assert.match(app,/continuityAuthoredColour/);
  assert.match(app,/continuityReleaseColour/);
  assert.match(app,/data-pulse-period="true"/);
  assert.match(app,/pulseContinuityPeriodMarkup/);
  assert.match(css,/\.continuity-period-board/);
  assert.doesNotMatch(css,/\.continuity-winner/);
});

test('partially selected months and weeks use only in-window dates in evidence tooltips',()=>{
  const index={bounds:{min:'2026-02-01',max:'2026-02-28'},activity:[commit('2026-02-10',35)],releases:[]};
  const row=continuityMatrix(index,[people[0]],{from:'2026-02-10',to:'2026-02-18'}).rows[0];
  assert.equal(row.months.get('2026-02').from,'2026-02-10');
  assert.equal(row.months.get('2026-02').to,'2026-02-18');
  assert.equal(row.weeks.get('2026-02-09').from,'2026-02-10');
  assert.equal(row.weeks.get('2026-02-16').to,'2026-02-18');
  assert.equal(row.coveredDays,countWorkdays('2026-02-10','2026-02-18'));
});
