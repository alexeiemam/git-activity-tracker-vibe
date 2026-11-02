import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {buildAnalysis, withWeekAggregation} from '../assets/domain.js';
import {autoMatchGithubPublishers,impactAnalysis} from '../assets/impact.js';

const demoCommit=(hash,email,parents=[],date='2025-05-01',name='Person')=>({
  hash,email,name,parents,parentsKnown:true,date,hour:10,minute:5,
  authoredAt:Date.parse(`${date}T10:05:00Z`),committedAt:Date.parse(`${date}T10:05:00Z`),
  subject:'fix: something',isMerge:false,isRevert:false,touchesVersion:false,
  files:[{path:'src/main.rb',added:5,deleted:2}],
});
const published=(tag,publisher)=>({tag,publisher,publishedAt:Date.parse('2025-06-01T12:00:00Z'),publishedDate:'2025-06-01',draft:false});
const groups=[
  {displayName:'Alice',emails:['alice@company.com','121+alice-gh@users.noreply.github.com']},
  {displayName:'Bob',emails:['bob@company.com']},
];

test('automatic GitHub release-driver matching uses merged Git identities and exact evidence',()=>{
  const commits=[demoCommit('aa11111',groups[0].emails[0],[],'2025-05-01','Alice'),
    demoCommit('bb22222',groups[0].emails[1],['aa11111'],'2025-05-02','Alice'),
    demoCommit('cc33333',groups[1].emails[0],['bb22222'],'2025-05-03','Bob')];
  const matches=autoMatchGithubPublishers([published('v1','alice-gh'),published('v2','bob'),published('v3','unknown')],
    groups.map((g,id)=>({...g,id:String(id)})),commits);
  assert.equal(matches.get('alice-gh').source,'github-noreply');
  assert.equal(matches.get('alice-gh').group.displayName,'Alice');
  assert.equal(matches.get('bob').source,'email-local');
  assert.equal(matches.get('unknown').group,null);
  const view=buildAnalysis(commits,groups,{start:'2025-05-01',end:'2025-06-30'});
  const impact=impactAnalysis(view,commits,[{name:'v1',hash:'bb22222',taggedAt:Date.parse('2025-05-02T12:00:00Z'),taggedDate:'2025-05-02'}],
    {githubReleases:[published('v1','alice-gh')]});
  assert.equal(impact.releases[0].driver.groupName,'Alice');
  assert.equal(impact.ghActors[0].matchSource,'github-noreply');
  assert.equal(impact.profiles.find(p=>p.name==='Alice').driven,1);
});

test('conflicting exact matches remain unassigned; manual override and explicit exclusion take precedence',()=>{
  const conflicted=[{id:'0',displayName:'Alice',emails:['alex@one.test']},
    {id:'1',displayName:'Alex',emails:['alex@two.test']}];
  const gh=[published('v1','alex')];
  const guess=autoMatchGithubPublishers(gh,conflicted,[]).get('alex');
  assert.equal(guess.source,'ambiguous');assert.equal(guess.group,null);
  const manual=autoMatchGithubPublishers(gh,conflicted,[],{alex:'alex@two.test'}).get('alex');
  assert.equal(manual.group.id,'1');assert.equal(manual.source,'manual');
  assert.equal(autoMatchGithubPublishers(gh,conflicted,[],{alex:''}).get('alex').source,'excluded');
  const twoNames=[{id:'1',displayName:'Alice',emails:['user1@corp.test']},
    {id:'2',displayName:'Bob',emails:['user2@corp.test']}];
  const nameMatches=autoMatchGithubPublishers([published('v2','alice')],twoNames,[]);
  assert.equal(nameMatches.get('alice').source,'author-name');
  assert.equal(nameMatches.get('alice').group.id,'1');
});

test('release reconstruction works for hundreds of tagged snapshots with bounded runtime',()=>{
  const n=5000,tags=[];const commits=[];
  for(let i=0;i<n;i++){
    const hash=i.toString(16).padStart(40,'0');const p=i?(i-1).toString(16).padStart(40,'0'):null;
    const date=new Date(Date.UTC(2023,0,1)+i*3600_000).toISOString().slice(0,10);
    commits.push(demoCommit(hash,groups[i%groups.length].emails[0],p?[p]:[],date));
    if(i>0&&i%25===0)tags.push({name:`v1.0.${i/25}`,hash,taggedAt:Date.parse(`${date}T13:00:00Z`),taggedDate:date});
  }
  const view=buildAnalysis(commits,groups,{start:'2023-01-01',end:'2026-01-01'});
  const started=performance.now();
  const result=impactAnalysis(view,commits,tags);
  const elapsed=performance.now()-started;
  assert.equal(result.releases.length,tags.length);
  assert.equal(result.releases.at(-1).selectedFootprint.commits,25);
  assert.ok(elapsed<10000,`Release analysis should not stall on a modest archive: ${Math.round(elapsed)} ms`);
});

test('module worker parses and aggregates data without blocking the caller or losing week aggregation',async()=>{
  const worker=new Worker(new URL('./worker-entry.mjs',import.meta.url),{type:'module'});
  let serial=0;const reports=[];
  const run=(type,payload)=>new Promise((resolve,reject)=>{
    const id=++serial;
    const onMessage=message=>{
      if(message.id!==id)return;
      if(message.type==='progress'){reports.push(message.phase);return;}
      worker.off('message',onMessage);
      if(message.type==='error') reject(new Error(message.message));
      else resolve(message.result);
    };
    worker.on('message',onMessage);
    worker.postMessage({id,type,...payload});
  });
  try {
    const raw=`TAG|v1.0.0||a001001|commit|2025-06-01T12:00:00Z\nCOMMIT|a001001|alice@company.com|Alice|2025-05-01T10:00:00Z|2025-05-01T12:00:00Z|feat: make it|\n5\t2\tsrc/a.rb`;
    const history=await run('parse',{raw});
    assert.equal(history.commits.length,1);
    // The caller can run other JavaScript while the worker is calculating.
    let spin=0;for(let i=0;i<100;i++)spin+=i;assert.equal(spin,4950);
    const result=await run('build',{groups:[{displayName:'Alice',emails:['alice@company.com']}],
      scope:{start:'2025-05-01',end:'2025-06-30',selectedIds:new Set(['0'])},
      impactOptions:{metric:'commits',actorMap:{}}});
    assert.equal(result.view.selectedCommits.length,1);
    assert.equal(result.impact.releases.length,1);
    assert.equal(result.primaryIndex.releases.length,1,'worker must also return complete tag-defined evidence');
    assert.equal(result.primaryIndex.releases[0].tag,'v1.0.0');
    assert.equal(result.primaryIndex.activity.length,1);
    assert.equal(typeof result.view.sumsByWeek,'undefined','worker boundary should contain structured data only');
    assert.equal(typeof withWeekAggregation(result.view).sumsByWeek,'function');
    assert.ok(reports.includes('Reading history') && reports.includes('Reconstructing releases'));
  } finally {await worker.terminate();}
});

test('progress status, background processing and the manual-identity override are visible in the shipped assets',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const view=readFileSync(new URL('../assets/impact-view.js',import.meta.url),'utf8');
  assert.match(html,/id="work-progress"/);
  assert.match(html,/id="work-phase"/);
  assert.match(html,/id="work-progress-value"/);
  assert.match(app,/new Worker\(new URL/);
  assert.match(app,/workerFaulted/);
  assert.match(app,/run!==renderGeneration/);
  assert.match(view,/Automatic matching/);
  assert.match(view,/Do not attribute/);
});
