import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAnalysis,parseGitHistory,dayNumber,dateAtDay} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex,comparisonWindow,windowOf,periodDigest,contributorPortrait,releaseLandscape,releaseDetails,codebasePortrait,briefingText} from '../assets/perspectives.js';
import {renderPrimaryExplorer,periodBriefingForUi} from '../assets/perspective-view.js';

const h=ch=>ch.repeat(40);
const tagged=(tag,hash,date)=>`TAG|${tag}||${hash}|commit|${date}T12:00:00Z`;
const commit=(hash,email,name,authored,committed,subject,parents='',file='app/models/model.rb')=>
  `COMMIT|${hash}|${email}|${name}|${authored}T10:00:00Z|${committed}T16:00:00Z|${subject}|${parents}\n5\t2\t${file}`;
const log=[
 tagged('v1.0.0',h('a'),'2025-01-10'),
 tagged('v1.1.0',h('c'),'2025-02-20'),
 tagged('v1.1.1',h('e'),'2025-03-04'),
 commit(h('e'),'ada@work','Ada','2025-03-03','2025-03-04','fix: patch',h('d')),
 commit(h('d'),'ben@work','Ben','2025-02-17','2025-02-19','test: integration',h('c'),'test/model_test.rb'),
 commit(h('c'),'ada@personal','Ada','2025-02-18','2025-02-19','feat: authored around release',h('b'),'app/controllers/action.rb'),
 commit(h('b'),'ben@work','Ben','2025-01-18','2025-01-19','refactor: process',h('a')),
 commit(h('a'),'ada@work','Ada','2025-01-09','2025-01-09','feat: initial work','','app/models/model.rb'),
].join('\n');
const history=parseGitHistory(log);
const groups=[{displayName:'Ada',emails:['ada@work','ada@personal']},{displayName:'Ben',emails:['ben@work']}];
function makeIndex(scope={}) {
 const window={start:'2025-01-01',end:'2025-04-30',includeMerges:false,includeReverts:true,
  selectedIds:new Set(['0','1']),metric:'commits',denominator:'repository',...scope};
 const view=buildAnalysis(history.commits,groups,window);
 const impact=impactAnalysis(view,history.commits,history.tags,{metric:'commits',skipFollowup:true});
 return buildEvidenceIndex(view,impact,{min:'2025-01-09',max:'2025-03-04'});
}
const index=makeIndex();
const ui=(changes={})=>({mode:'observatory',releaseHash:index.releases.at(-1)?.hash,
 releaseType:'all',releaseYear:'all',releaseQuery:'',releasePage:0,releaseBin:null,
 periodPreset:'14',periodFrom:'2025-02-16',periodTo:'2025-02-28',periodComparison:'previous',
 compareFrom:null,compareTo:null,periodBucket:null,periodFocusPerson:null,periodFocusArea:null,
 periodSelectedId:null,contributorFocus:'0',contributorTab:'delivery',contributorRange:'all',
 compareB:'1',compareC:null,codeArea:null,codebaseRange:'all',trail:[],...changes});

test('complete tagged release is independent of the authored-date window',()=>{
 const partial=buildAnalysis(history.commits,groups,{start:'2025-02-16',end:'2025-02-28',selectedIds:new Set(['0','1'])});
 const partialImpact=impactAnalysis(partial,history.commits,history.tags,{skipFollowup:true});
 assert.equal(partialImpact.releases.find(r=>r.tag==='v1.1.0').eligibleIntroduced,1);
 const full=index.releases.find(r=>r.tag==='v1.1.0');
 assert.equal(full.eligibleIntroduced,2,'Jan authored work still belongs to Feb tagged release');
 assert.equal(full.members.find(m=>m.id==='0').commits,1,'merged author identities attribute the contribution to Ada');
 assert.equal(full.members.find(m=>m.id==='1').commits,1);
 assert.equal(full.previousTag,'v1.0.0');
});

test('period independently counts authored activity and release publication events',()=>{
 const value=periodDigest(index,{from:'2025-02-16',to:'2025-02-28'},{comparison:'none'});
 assert.equal(value.summary.commits,2,'Ada and Ben authored changes in this window');
 assert.equal(value.events.releases,1,'the minor tag is in the window');
 assert.equal(value.releases[0].eligibleIntroduced,2,'release contents are never trimmed by authored dates');
 assert.equal(value.summary.people.length,2);
 assert.equal(value.events.includedCommits,2);
 assert.match(briefingText(index,value),/tagged release events/);
});

test('focus changes authored observations, not the release count or ancestry',()=>{
 const window={from:'2025-02-16',to:'2025-03-05'};
 const all=periodDigest(index,window,{comparison:'none'});
 const ada=periodDigest(index,window,{comparison:'none',selectedIds:['0']});
 assert.ok(all.summary.commits>ada.summary.commits);
 assert.equal(ada.events.releases,all.events.releases);
 assert.equal(ada.releases[0].eligibleIntroduced,all.releases[0].eligibleIntroduced);
});

test('previous period is equal duration, year comparison handles Feb leap days',()=>{
 assert.deepEqual(comparisonWindow({from:'2025-03-01',to:'2025-03-14'},'previous'),{from:'2025-02-15',to:'2025-02-28',days:14});
 assert.deepEqual(comparisonWindow({from:'2025-02-28',to:'2025-03-02'},'year'),{from:'2024-02-28',to:'2024-03-02',days:4});
 assert.equal(comparisonWindow({from:'2025-01-01',to:'2025-01-02'},'none'),null);
});

test('comparison outside imported history is marked non-comparable, not inferred as zero',()=>{
 const digest=periodDigest(index,{from:'2025-01-09',to:'2025-01-13'},{comparison:'previous'});
 assert.equal(digest.comparisonComparable,false);
 assert.equal(digest.comparison.summary.commits,0);
 const rendered=renderPrimaryExplorer(index,ui({mode:'periods',periodFrom:'2025-01-09',periodTo:'2025-01-13'}));
 assert.match(rendered,/beyond imported history/);
 assert.doesNotMatch(rendered,/No material multi-signal change/);
});

test('contributor portrait reconciles identities and separates authored time from delivery',()=>{
 const ada=contributorPortrait(index,'0',{from:'2025-01-09',to:'2025-03-04'});
 assert.equal(ada.profile.commits,3);
 assert.equal(ada.contributed,3);
 assert.equal(ada.driven,0);
 assert.equal(ada.shippedCommits,3);
 assert.equal(ada.emails.length,2);
 assert.equal(ada.slots.flat().reduce((a,b)=>a+b,0),3);
 assert.equal(ada.profile.areas.find(([key])=>key==='app/')[1],3);
});

test('release cohorts and codebase are based on tagged contents, not per-person rankings',()=>{
 const model=releaseLandscape(index);
 assert.equal(model.total,3);
 assert.ok(model.medianInterval>=0);
 const areas=codebasePortrait(index,{from:'2025-02-20',to:'2025-03-04'});
 assert.ok(areas.areas.some(a=>a.area==='app/'));
 assert.equal(areas.areas.find(a=>a.area==='app/').releases,2);
 const detail=releaseDetails(index,h('c'));
 assert.equal(detail.release.eligibleIntroduced,2);
 assert.equal(detail.commits.length,2);
});

test('period timeline contains all daily or monthly buckets, including empty ones',()=>{
 const short=periodDigest(index,{from:'2025-02-16',to:'2025-02-22'},{comparison:'none'});
 assert.equal(short.timeline.buckets.length,7);
 assert.equal(short.timeline.buckets.find(b=>b.key==='2025-02-21').commits,0);
 const month=periodDigest(index,{from:'2025-01-15',to:'2025-04-21'},{comparison:'none'});
 assert.equal(month.timeline.granularity,'week');
 assert.ok(month.timeline.buckets.length>=13);
 const big=periodDigest(index,{from:'2025-01-01',to:'2025-10-31'},{comparison:'none'});
 assert.equal(big.timeline.granularity,'month');
 assert.equal(big.timeline.buckets.length,10);
});

test('all views render safe labels and bounded evidence, with no fabricated impact score',()=>{
 for(const mode of ['observatory','periods','contributors','codebase']){
  const html=renderPrimaryExplorer(index,ui({mode}));
  assert.ok(html.length>500);
  assert.doesNotMatch(html,/productivity score:\s*\d/);
 }
 const evil={...index,groups:index.groups.map((g,i)=>i?g:{...g,displayName:'<script>alert(1)</script>'})};
 assert.doesNotMatch(renderPrimaryExplorer(evil,ui({mode:'contributors'})),/<script>alert/);
 assert.match(renderPrimaryExplorer(evil,ui({mode:'contributors'})),/&lt;script&gt;/);
});

test('copyable period briefing uses the same filters as the rendered period',()=>{
 const state=ui({mode:'periods',periodComparison:'previous'});
 const briefing=periodBriefingForUi(index,state);
 assert.match(briefing,/2025-02-16 to 2025-02-28/);
 assert.match(briefing,/2025-02-03 to 2025-02-15/);
 assert.match(briefing,/v1.1.0/);
});

test('primary asset integration keeps release models in the analysis worker',()=>{
 const worker=readFileSync(new URL('../assets/analysis-worker.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(worker,/buildEvidenceIndex\(fullView,fullImpact,bounds\)/);
 assert.match(worker,/cachedPrimaryKey/);
 assert.match(app,/renderPrimaryExplorer\(perspectiveIndex,primary\)/);
 for(const name of ['observatory','periods','contributors'])assert.match(html,new RegExp(`data-experience="${name}"`));
 assert.match(html,/id="legacy-scope-details"/);
});

test('release landscape preserves empty intervals as true calendar gaps',()=>{
 const prior=makeIndex();
 const shifted={...prior,releases:[{...prior.releases[0],date:'2025-01-08'},{...prior.releases.at(-1),date:'2025-04-08'}]};
 const landscape=releaseLandscape(shifted);
 assert.equal(landscape.granularity,'week');
 assert.ok(landscape.bins.length>=13);
 assert.ok(landscape.bins.some(b=>b.count===0));
 assert.equal(landscape.bins.reduce((total,b)=>total+b.count,0),2);
});

test('many releases retain a bounded DOM and navigate without dropping history',()=>{
 const seed=index.releases[0];
 const releases=Array.from({length:428},(_,i)=>({...seed,
   hash:i.toString(16).padStart(40,'0'),tag:`v2.0.${i}`,
   date:new Date(Date.UTC(2020,0,1)+i*7*86400000).toISOString().slice(0,10),
 }));
 const large={...index,releases};
 const model=releaseLandscape(large);
 assert.equal(model.total,428);
 assert.ok(model.bins.length<130,'long histories aggregate to monthly/quarterly overview');
 const first=renderPrimaryExplorer(large,ui({mode:'observatory',releasePage:0}));
 const last=renderPrimaryExplorer(large,ui({mode:'observatory',releasePage:17}));
 assert.equal((first.match(/class="primary-release-entry/g)||[]).length,24);
 assert.equal((last.match(/class="primary-release-entry/g)||[]).length,20);
 assert.match(first,/v2\.0\.427/);
 assert.match(last,/v2\.0\.0/);
});

test('period inspection works when release events exist but no commits were authored in the window',()=>{
 const period=ui({mode:'periods',periodFrom:'2025-02-20',periodTo:'2025-02-20',periodBucket:'2025-02-20',periodComparison:'none'});
 const html=renderPrimaryExplorer(index,period);
 assert.match(html,/1 release events/);
 assert.match(html,/No authored commits in this bucket/);
 assert.match(html,/v1\.1\.0/);
});

test('release cohort controls offer driver and year compositions without productivity scoring',()=>{
 const driver=renderPrimaryExplorer(index,ui({mode:'observatory',cohortBy:'driver'}));
 const years=renderPrimaryExplorer(index,ui({mode:'observatory',cohortBy:'year'}));
 assert.match(driver,/Group by/);
 assert.match(driver,/Driver unknown|Unmatched:/);
 assert.match(years,/2025/);
 assert.doesNotMatch(driver,/productivity score:\s*\d+/);
});

test('codebase drill-down distinguishes authored work from missing period release events',()=>{
 const html=renderPrimaryExplorer(index,ui({mode:'codebase',codebaseRange:'period',
   periodFrom:'2025-01-17',periodTo:'2025-01-19',codeArea:'app/'}));
 assert.match(html,/Authored work in the selected period/);
 assert.match(html,/Ben/);
 assert.match(html,/No matching tagged changes/);
 assert.match(html,/No released changes for this area/);
 assert.match(html,/1 authored commits/);
});

test('release list and anatomy stay coherent when applying a historical year filter',()=>{
 const twoYear={...index,releases:[...index.releases,{...index.releases.at(-1),hash:'f'.repeat(40),date:'2026-08-18',tag:'v2.0.0'}]};
 const html=renderPrimaryExplorer(twoYear,ui({mode:'observatory',releaseYear:'2025',releaseHash:'f'.repeat(40)}));
 assert.doesNotMatch(html,/<h3>v2\.0\.0<\/h3>/);
 assert.match(html,/v1\.1\.1/);
});


test('Contributors Together displays shared released commits and traceable tag evidence',()=>{
  const page=renderPrimaryExplorer(index,ui({mode:'contributors',contributorTab:'together',coReleasePartner:'1'}));
  assert.match(page,/People who appear in the same tagged releases/);
  assert.match(page,/Jaccard overlap/);
  assert.match(page,/v1\.1\.0/);
  assert.match(page,/primary-co-release-detail/);
  assert.match(page,/data-action="primary-open-release"/);
  assert.match(page,/drivers are shown separately/i);
  const compared=renderPrimaryExplorer(index,ui({mode:'contributors',contributorTab:'compare',compareB:'1'}));
  assert.match(compared,/Who appears in releases together/);
  assert.match(compared,/primary-open-co-release-pair/);
});


test('Together escapes untrusted contributor labels and limits initial rendered release evidence',()=>{
 const hostile={...index,groups:index.groups.map((g,i)=>i===1?{...g,displayName:'<img src=x onerror=alert(1)>'}:g)};
 const html=renderPrimaryExplorer(hostile,ui({mode:'contributors',contributorTab:'together',coReleasePartner:'1'}));
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/&lt;img src=x/);
 assert.match(html,/No shared release contributions|Shared releases/);
});
