import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {buildAnalysis, parseGitHistory, dateAtDay, dayNumber} from '../assets/domain.js';
import {generateDemoLog} from '../assets/demo-data.js';
import {impactAnalysis} from '../assets/impact.js';
import {percentile,calendarGapStats,buildStoryAnalysis} from '../assets/stories.js';
import {storyCopyText,renderStoryExplorer} from '../assets/story-view.js';

const commit=(id,date,email='alice@demo.test',path='app/main.rb')=>({
  hash:id.toString(16).padStart(40,'0'),parents:id>1?[(id-1).toString(16).padStart(40,'0')]:[],parentsKnown:true,
  date,email,name:email.includes('alice')?'Alice':'Bob',hour:12,minute:30,
  authoredAt:Date.parse(`${date}T12:30:00Z`),committedAt:Date.parse(`${date}T14:00:00Z`),
  subject:'feat: record a change',isMerge:false,isRevert:false,touchesVersion:false,
  files:[{path,added:3,deleted:1}],
});
const groups=[{displayName:'Alice',emails:['alice@demo.test']},{displayName:'Bob',emails:['bob@demo.test']}];
const viewFor=(commits,options={})=>buildAnalysis(commits,groups,{
  selectedIds:new Set(['0','1']),start:'2023-01-01',end:'2025-12-31',
  includeMerges:false,includeReverts:true,metric:'commits',denominator:'repository',...options,
});
const noRelease={releases:[],allReleaseCount:0};

test('gap detector uses only internal author-day gaps, never start/end of the observation window',()=>{
  const rows=[commit(1,'2025-04-02'),commit(2,'2025-04-05'),commit(3,'2025-04-15')];
  const g=calendarGapStats(rows,'2025-01-01','2025-12-31');
  assert.equal(g.activeDays,3);
  assert.equal(g.gapCount,2);
  assert.equal(g.median,5.5);
  assert.deepEqual(g.longest,{from:'2025-04-05',to:'2025-04-15',days:9});
  assert.equal(percentile([1,2,100],.9),80.4);
  assert.equal(percentile([],.8),null);
});

test('equal-duration author periods do not include releases outside the global event-date window',()=>{
  const rows=[];
  for(let i=0;i<70;i++)rows.push(commit(i+1,dateAtDay(dayNumber('2025-02-01')+i*3)));
  const view=viewFor(rows,{start:'2025-02-01',end:'2025-12-31'});
  const future={releases:[{date:'2026-05-01',driver:{groupId:'0'},lineageComplete:true,baseline:false,
    cells:[{id:'0',footprint:{commits:1}}],selectedFootprint:{commits:1},tag:'future'}]};
  const result=buildStoryAnalysis(view,future);
  const alice=result.people.find(p=>p.id==='0');
  assert.equal(alice.to,rows.at(-1).date);
  assert.equal(alice.months.some(m=>m.month==='2026-05'),false);
  assert.equal(result.coverage.scopeEnd,'2025-12-31');
  assert.ok(result.allFindings.every(f=>f.basis && f.limitations.length));
});

test('insufficient evidence does not produce a speculative story',()=>{
  const rows=[commit(1,'2025-03-01'),commit(2,'2025-03-03')];
  const story=buildStoryAnalysis(viewFor(rows,{start:'2025-02-01',end:'2025-04-01'}),noRelease);
  assert.equal(story.allFindings.filter(f=>!f.context).length,0);
  assert.ok(story.allFindings.every(f=>f.context));
  assert.equal(story.coverage.authorCommits,2);
});

test('long internal quiet gap can surface as an observation with explicit limitation',()=>{
  const rows=[];
  let id=1;
  for(let i=0;i<16;i++)rows.push(commit(id++,dateAtDay(dayNumber('2025-01-10')+i*2)));
  for(let i=0;i<16;i++)rows.push(commit(id++,dateAtDay(dayNumber('2025-04-15')+i*2)));
  const story=buildStoryAnalysis(viewFor(rows,{start:'2025-01-01',end:'2025-06-01'}),noRelease);
  const finding=story.allFindings.find(f=>f.id==='0:unusual-gap');
  assert.ok(finding);
  assert.match(finding.summary,/calendar days without an authored commit/);
  assert.match(finding.limitations.join(' '),/not an absence from work/);
});

test('a pre-contribution run of tagged releases is never diagnosed as a gap in participation',()=>{
  const rows=[];
  for(let i=0;i<21;i++)rows.push(commit(i+1,dateAtDay(dayNumber('2024-01-01')+i*30),i>=18?'alice@demo.test':'bob@demo.test'));
  const view=viewFor(rows,{start:'2024-01-01',end:'2025-12-31'});
  const releases=rows.map((c,i)=>({hash:c.hash,tag:`v1.0.${i}`,date:c.date,
    baseline:i===0,lineageComplete:true,driver:{groupId:null},
    selectedFootprint:{commits:1},
    cells:[{id:'0',footprint:{commits:c.email.includes('alice')?1:0}},
      {id:'1',footprint:{commits:c.email.includes('bob')?1:0}}]}));
  const story=buildStoryAnalysis(view,{releases});
  assert.equal(story.allFindings.some(f=>f.id==='0:release-gap'),false);
});

test('release participation, driving and authored change are separate comparable counts',()=>{
  const rows=[];
  for(let i=0;i<30;i++) rows.push(commit(i+1,dateAtDay(dayNumber('2024-01-01')+i*18),i%2?'alice@demo.test':'bob@demo.test'));
  const view=viewFor(rows,{start:'2024-01-01',end:'2025-12-31'});
  const releaseRows=rows.filter((_,i)=>i%3===0).map((c,i)=>({hash:c.hash,date:c.date,tag:`v2.0.${i}`,
    lineageComplete:true,baseline:false,driver:{groupId:'0'},
    selectedFootprint:{commits:1},
    cells:[{id:'0',footprint:{commits:i%2?1:0}},{id:'1',footprint:{commits:i%2?0:1}}]}));
  const result=buildStoryAnalysis(view,{releases:releaseRows});
  const a=result.comparison.find(p=>p.id==='0');
  assert.ok(a.releasesEligible>0);
  assert.notEqual(a.releases,a.driven);
  assert.ok(result.people.find(p=>p.id==='0').months.some(m=>m.driven));
});

test('story model is computed once from the demo release graph and is safe to clone across a worker',()=>{
  const raw=parseGitHistory(generateDemoLog({years:4,commits:720}));
  const emailGroups=[...new Set(raw.commits.map(c=>c.email))].map(email=>({displayName:email,emails:[email]}));
  const view=buildAnalysis(raw.commits,emailGroups,{selectedIds:new Set(emailGroups.map((_,i)=>String(i))),
    start:'2022-01-01',end:'2027-01-01'});
  const impact=impactAnalysis(view,raw.commits,raw.tags,{githubReleases:raw.githubReleases});
  const started=performance.now(),stories=buildStoryAnalysis(view,impact);
  const elapsed=performance.now()-started;
  const copied=structuredClone(stories);
  assert.equal(copied.people.length,emailGroups.length+1);
  assert.ok(stories.coverage.releasesInScope>0);
  assert.ok(copied.people.every(p=>Array.isArray(p.months)));
  assert.ok(elapsed<2500,`Stories should render from aggregated evidence, ${Math.round(elapsed)}ms`);
});

test('story HTML escapes names, titles and explanatory text; copy summary includes caveats',()=>{
  const malicious=`<img src=x onerror="alert(1)">`;
  const f={id:'0:test',subject:'0',type:'activity',title:malicious,
    summary:`Observed ${malicious}`,evidence:[{label:malicious,value:'2 < 3'}],
    period:{from:'2025-01-01',to:'2025-06-01'},score:1,link:'pulse-heading',
    limitations:['Not a work absence'],basis:'Author timestamps',unit:'commits',why:'Check sources'};
  const model={people:[{id:'0',name:malicious,findings:[f],months:[],years:[],commits:2}],
    allFindings:[f],comparison:[],coverage:{selectedPeople:1,authorCommits:2,releasesEligible:0,
      releasesInScope:0,incompleteReleases:0,driversMapped:0,scopeStart:'2025-01-01',scopeEnd:'2025-06-01'}};
  const html=renderStoryExplorer(model,{perspective:'person',focus:'0',dismissed:new Set(),topic:'all',category:'noteworthy',
    findingId:f.id});
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/&lt;img/);
  assert.match(html,/aria-labelledby="story-detail-title"/);
  assert.match(html,/data-action="story-evidence"/);
  assert.match(storyCopyText(f,model),/Limitation: Not a work absence/);
});

test('story mode and lazy evidence panels are wired to global filters, export and worker',async()=>{
  const root=new URL('../',import.meta.url);
  const [app,worker,html]=await Promise.all([
    readFile(new URL('assets/app.js',root),'utf8'),
    readFile(new URL('assets/analysis-worker.js',root),'utf8'),
    readFile(new URL('index.html',root),'utf8')]);
  assert.match(html,/id="stories-view"/);
  assert.match(html,/id="evidence-view" hidden/);
  assert.match(app,/function ensureEvidenceRendered/);
  assert.match(app,/state.viewMode==='evidence'/);
  assert.match(app,/storyFocusEmail:/);
  assert.match(app,/storyDismissed:\[\.\.\.state\.storyDismissed\]/);
  assert.match(worker,/buildStoryAnalysis\(view,impact\)/);
});

test('two-person rhythm comparison uses complete author-local hourly slots and one shared intensity range',()=>{
  const monday='2025-01-06';
  const commits=[
    {...commit(1,monday),hour:8},
    {...commit(2,monday),hour:8},
    {...commit(3,monday),hour:null},
    {...commit(4,monday,'bob@demo.test'),hour:10},
    {...commit(5,'2025-01-07','bob@demo.test'),hour:17},
  ];
  const view=viewFor(commits,{start:'2025-01-01',end:'2025-02-01'});
  const model=buildStoryAnalysis(view,noRelease);
  const a=model.people.find(p=>p.id==='0'),b=model.people.find(p=>p.id==='1');
  assert.equal(a.rhythm.counts.length,168);
  assert.equal(a.rhythm.counts[8],2);
  assert.equal(a.rhythm.timed,2);
  assert.equal(a.rhythm.unknown,1);
  assert.equal(b.rhythm.timed,2);
  assert.equal(b.rhythm.counts[10],1);
  assert.equal(b.rhythm.counts[24+17],1);
  assert.equal(a.rhythm.counts.reduce((x,y)=>x+y),a.rhythm.timed);
  assert.equal(b.rhythm.counts.reduce((x,y)=>x+y),b.rhythm.timed);
  const html=renderStoryExplorer(model,{perspective:'compare',focus:'0',dismissed:new Set(),topic:'all',category:'noteworthy',pairA:'0',pairB:'1'});
  assert.match(html,/Two weekly rhythms, one shared scale/);
  assert.match(html,/100% of timed commits/);
  assert.match(html,/Monday|Mon 08:00/);
  assert.equal((html.match(/class="story-rhythm-cell"/g)||[]).length,336);
  assert.match(html,/0 · none/);
  assert.doesNotMatch(html,/NaN|undefined%/);
});

test('missing author hour is unknown rather than silently treated as midnight',()=>{
  const rows=[{...commit(1,'2025-01-06'),hour:null},commit(2,'2025-01-07','bob@demo.test')];
  const model=buildStoryAnalysis(viewFor(rows,{start:'2025-01-01',end:'2025-03-01'}),noRelease);
  const a=model.people.find(p=>p.id==='0');
  assert.equal(a.rhythm.timed,0);
  assert.equal(a.rhythm.unknown,1);
  const html=renderStoryExplorer(model,{perspective:'compare',focus:'0',dismissed:new Set(),topic:'all',category:'noteworthy',pairA:'0',pairB:'1'});
  assert.match(html,/timed data unavailable/);
  assert.match(html,/unavailable/);
});
