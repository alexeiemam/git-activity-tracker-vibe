import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAnalysis,parseGitHistory,dayNumber,dateAtDay} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex,comparisonWindow,windowOf,periodDigest,contributorPortrait,releaseLandscape,releaseDetails,codebaseCommits,areaPortrait,briefingText,shippedInWindow,shippedText,plainSubject} from '../assets/perspectives.js';
import {renderPrimaryExplorer,periodBriefingForUi,scopeHeadline} from '../assets/perspective-view.js';
import {restorePrimaryState} from '../assets/perspective-state.js';

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
 compareB:'1',compareC:null,codeArea:null,codebaseClock:'authored',trail:[],...changes});

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
 const headline=scopeHeadline(index,ui({mode:'rhythm',periodFrom:'2025-01-09',periodTo:'2025-01-13',periodComparison:'previous'}));
 assert.match(headline,/beyond imported history/);
 assert.doesNotMatch(headline,/primary-delta/,'no change is claimed against unobserved dates');
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
 const released=codebaseCommits(index,{from:'2025-02-20',to:'2025-03-04',clock:'released'});
 const app=areaPortrait(index,released,path=>path.startsWith('app/'));
 assert.ok(app.touches>0);
 assert.equal(app.releases,2,'released changes in app/ came from two tags');
 assert.equal(new Set(released.map(c=>c.hash)).size,released.length,'a commit counts once however many releases ship it');
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
 for(const mode of ['observatory','rhythm','contributors','codebase']){
  const html=renderPrimaryExplorer(index,ui({mode}));
  assert.ok(html.length>500);
  assert.doesNotMatch(html,/productivity score:\s*\d/);
 }
 const evil={...index,groups:index.groups.map((g,i)=>i?g:{...g,displayName:'<script>alert(1)</script>'})};
 assert.doesNotMatch(renderPrimaryExplorer(evil,ui({mode:'contributors'})),/<script>alert/);
 assert.match(renderPrimaryExplorer(evil,ui({mode:'contributors'})),/&lt;script&gt;/);
});

test('copyable period briefing uses the same filters as the rendered period',()=>{
 const state=ui({mode:'rhythm',periodComparison:'previous'});
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
 for(const name of ['observatory','contributors','codebase'])assert.match(html,new RegExp(`data-experience="${name}"`));
 assert.doesNotMatch(html,/data-experience="(evidence|rhythm)"/,'Evidence and Rhythm folded into People');
 assert.match(html,/<details id="scope-commits"[\s\S]*id="recent-commits"/,'the scope\'s commits sit in the scope bar');
 assert.match(html,/id="scope-bar"/);
 assert.match(html,/id="scope-comparison"/,'the comparison window is part of the scope');
 assert.doesNotMatch(html,/data-tabs=/,'sections are placed by slot, not shown by tab');
 assert.match(html,/id="pulse-metric-select"/);
 assert.doesNotMatch(app,/PULSE_VIEWS/,'all five pulse lenses sit together on People');
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
 const first=renderPrimaryExplorer(large,ui({mode:'observatory',releaseBrowse:'list',releaseRange:'all',releasePage:0}));
 const last=renderPrimaryExplorer(large,ui({mode:'observatory',releaseBrowse:'list',releaseRange:'all',releasePage:17}));
 assert.equal((first.match(/class="primary-release-entry/g)||[]).length,24);
 assert.equal((last.match(/class="primary-release-entry/g)||[]).length,20);
 assert.match(first,/v2\.0\.427/);
 assert.match(last,/v2\.0\.0/);
});

test('period inspection works when release events exist but no commits were authored in the window',()=>{
 const period=ui({mode:'rhythm',periodFrom:'2025-02-20',periodTo:'2025-02-20',periodBucket:'2025-02-20',periodComparison:'none'});
 const html=renderPrimaryExplorer(index,period);
 assert.match(html,/1 release events/);
 assert.match(html,/No authored commits in this bucket/);
 assert.match(html,/v1\.1\.0/);
});

test('release cohort controls offer lead and year compositions without productivity scoring',()=>{
 const driver=renderPrimaryExplorer(index,ui({mode:'observatory',releaseBrowse:'groups',cohortBy:'driver'}));
 const years=renderPrimaryExplorer(index,ui({mode:'observatory',releaseBrowse:'groups',cohortBy:'year'}));
 assert.match(driver,/Group by/);
 assert.match(driver,/Lead unknown|Unmatched:/);
 assert.match(years,/data-action="primary-filter-release-year" data-year="2025">List these releases/);
 assert.doesNotMatch(driver,/productivity score:\s*\d+/);
});

test('codebase opens a folder: its path, a map of what is inside, its contents and who works there',()=>{
 const scoped=changes=>renderPrimaryExplorer(index,ui({mode:'codebase',periodFrom:'2025-01-17',periodTo:'2025-01-19',codeArea:'app/',...changes}));
 const authored=scoped({});
 assert.match(authored,/aria-label="Location in the codebase"><ol><li><a [^>]*data-area=""[^>]*>repository<\/a><\/li><li><span aria-current="page">app\/<\/span>/,'the path goes back up to the repository');
 assert.match(authored,/Map of app\//);
 assert.match(authored,/<a class="primary-map-top" href="[^"]*area=app%2Fmodels%2F[^"]*" data-action="primary-select-area" data-area="app\/models\/" data-jump="codebase-here">models\/<\/a>/,'each folder inside is a real link that opens it');
 assert.match(authored,/Inside app\/[\s\S]*data-area="app\/controllers\/"[\s\S]*1 file/,'contents list every folder ever changed, even quiet in the scope');
 assert.match(authored,/Who works where in app\/[\s\S]*Ben/);
 const released=scoped({codebaseClock:'released'});
 assert.match(released,/aria-pressed="true">Released/);
 assert.match(released,/No file changes in this scope/,'no release was published in these dates');
});

test('release list and anatomy stay coherent when applying a historical year filter',()=>{
 const twoYear={...index,releases:[...index.releases,{...index.releases.at(-1),hash:'f'.repeat(40),date:'2026-08-18',tag:'v2.0.0'}]};
 const html=renderPrimaryExplorer(twoYear,ui({mode:'observatory',releaseBrowse:'list',releaseYear:'2025',releaseHash:'f'.repeat(40)}));
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

test('the scope headline shows changes against a comparison window inside the imported history',()=>{
 const headline=scopeHeadline(index,ui({periodFrom:'2025-02-16',periodTo:'2025-02-28',periodComparison:'previous'}));
 assert.match(headline,/Authored commits/);
 assert.match(headline,/class="primary-delta">Previous: /);
 assert.match(headline,/Compared with 3 Feb 2025 – 15 Feb 2025/);
 assert.doesNotMatch(scopeHeadline(index,ui({periodFrom:'2025-02-16',periodTo:'2025-02-28',periodComparison:'none'})),/primary-delta/);
});

test('scope people narrow the Rhythm timeline and the codebase who-changed-what grid',()=>{
 const scoped={...index,navigation:{...index.navigation,scope:{ids:['1']}}};
 const everyone=renderPrimaryExplorer(index,ui({mode:'codebase',periodFrom:'2025-01-09',periodTo:'2025-03-04'}));
 const one=renderPrimaryExplorer(scoped,ui({mode:'codebase',periodFrom:'2025-01-09',periodTo:'2025-03-04'}));
 assert.match(everyone,/Who works where/);
 assert.ok((everyone.match(/data-action="primary-period-cell"/g)||[]).length>(one.match(/data-action="primary-period-cell"/g)||[]).length);
 assert.match(one,/Everyone else/,'a narrowed scope keeps everyone else as context');
 assert.doesNotMatch(everyone,/Everyone else/);
 assert.match(renderPrimaryExplorer(scoped,ui({mode:'rhythm'})),/The scope, unfolding/);
});

test('each tab has one reading guide instead of caveats repeated under every chart',async()=>{
 const {readingGuide}=await import('../assets/perspective-view.js');
 assert.match(readingGuide(index,'contributors'),/not a ranking of performance/);
 assert.match(readingGuide(index,'contributors'),/not hours worked/,'working-pattern caveats joined People');
 assert.match(readingGuide(index,'observatory'),/merges excluded/,'the evidence policy is part of every guide');
 const html=renderPrimaryExplorer(index,ui({mode:'contributors'}));
 assert.doesNotMatch(html,/primary-footnote|Not a productivity ranking/);
 assert.doesNotMatch(html,/class="primary-eyebrow">DELIVERED CONTRIBUTIONS/,'cards carry one heading, not an eyebrow and a title');
});

test('Releases opens on the timeline; the list sits beside the release it opens and other views pick one above it',()=>{
 const browse=renderPrimaryExplorer(index,ui({mode:'observatory',releaseBrowse:'list'}));
 assert.match(renderPrimaryExplorer(index,ui({mode:'observatory'})),/data-mode="timeline"/,'Releases opens on the timeline');
 assert.match(browse,/class="primary-release-browse"><div class="primary-release-sidebar"><div id="primary-browse-releases"/);
 assert.match(browse,/<div class="primary-release-detail"><section class="primary-anatomy/);
 assert.doesNotMatch(browse,/The release landscape/);
 const strips=renderPrimaryExplorer(index,ui({mode:'observatory',releaseBrowse:'wait'}));
 assert.doesNotMatch(strips,/primary-release-sidebar/,'strips need the full width');
 assert.match(browse,/class="primary-browse-summary">(\d+ of )?3 tagged releases/,'the overview numbers lead the browse card');
 for(const mode of ['timeline','people','followup']){
  const html=renderPrimaryExplorer(index,ui({mode:'observatory',releaseBrowse:mode}));
  assert.match(html,new RegExp(`class="primary-slot" data-slot="impact" data-mode="${mode}"`),'the impact explorer is placed here');
  assert.match(html,/primary-anatomy/,'the release it picks opens below');
 }
 assert.equal(restorePrimaryState({primary:{releaseView:'overview'}}).releaseView,'browse','sessions saved on Overview open Browse');
});

test('views sit with their subject: change evolution with releases, commit sizes with people',()=>{
 const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(app,/const IMPACT_BROWSE=\{timeline:'timeline',people:'matrix',followup:'durability'\}/);
 assert.match(html,/id="impact-explorer" data-slot-section="impact"/);
 assert.match(html,/aria-labelledby="footprint-heading" data-slot-section="sizes"/);
});

test('People is one page in reading order, and every slot a view renders has a section to fill it',()=>{
 const html=renderPrimaryExplorer(index,ui({mode:'contributors'}));
 const order=[...html.matchAll(/id="(people-[a-z-]+)" tabindex="-1"|data-slot="([a-z]+)"/g)].map(m=>m[1]||m[2]);
 assert.deepEqual(order,['people-contribution','measure','stats','insight','ranking','table','sizes','people-over-time','trend','pulse','people-patterns','rhythm','people-portrait','people-delivery','people-together','people-focus','people-evolution','people-compare']);
 assert.doesNotMatch(html,/data-action="primary-contributor-tab"/,'portrait sections are all shown; links jump between them');
 assert.match(html,/<nav class="primary-jump-links" aria-label="This portrait: jump to a section"><a href="#people-delivery" data-action="primary-jump"/);
 assert.match(html,/id="people-compare"[\s\S]*Person B[\s\S]*selected/,'Compare is shown with a second person already chosen');
 assert.match(html,/class="primary-section-nav" aria-label="People: jump to a section"><a href="#people-contribution" data-action="primary-jump"/);
 const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const sections=new Set([...page.matchAll(/data-slot-section="([a-z]+)"/g)].map(m=>m[1]));
 const slots=new Set();
 for(const mode of ['observatory','contributors','codebase'])for(const browse of ['timeline','list'])for(const m of renderPrimaryExplorer(index,ui({mode,releaseBrowse:browse})).matchAll(/data-slot="([a-z]+)"/g))slots.add(m[1]);
 assert.deepEqual([...slots].sort(),[...sections].sort(),'no orphan slots and no unreachable sections');
 assert.match(renderPrimaryExplorer(index,ui({mode:'observatory'})),/id="releases-over-time"[\s\S]*The scope, unfolding/,'the scope timeline is a Releases section');
});

test('Releases is one page: browse, over time, then environments when deployment history exists',()=>{
 const html=renderPrimaryExplorer(index,ui({mode:'observatory'}));
 assert.match(html,/aria-label="Releases: jump to a section"><a href="#releases-shipped"[^>]*>What shipped<\/a><a href="#releases-browse"[^>]*>Browse releases<\/a><a href="#releases-over-time"/);
 assert.doesNotMatch(html,/data-key="releaseView"/,'no Browse/Environments switch');
 assert.ok(html.indexOf('id="releases-browse"')<html.indexOf('id="releases-over-time"'));
 assert.doesNotMatch(html,/releases-environments/,'without deployment history there is no Environments section');
});

test('Codebase follows one folder from the repository down to a file',()=>{
 const at=(codeArea,changes={})=>renderPrimaryExplorer(index,ui({mode:'codebase',periodFrom:'2025-01-01',periodTo:'2025-03-31',codeArea,...changes}));
 const root=at(null);
 const order=html=>[...html.matchAll(/id="(codebase-[a-z]+)" tabindex="-1"/g)].map(m=>m[1]);
 assert.deepEqual(order(root),['codebase-here','codebase-signals','codebase-map','codebase-contents','codebase-who']);
 assert.match(root,/Knowledge concentration<\/span><strong>\d+ of \d+ busy folders and files rely mostly on one person/,'with the denominator for context');
 assert.match(root,/data-area="app\/"[^>]*>app\/<\/a>[\s\S]*data-area="test\/"/,'the repository lists its top-level folders');
 assert.match(root,/<svg class="primary-spark"/,'each changed row has a trend');
 assert.equal(at('(root)'),root,'older links to the root area land on the repository');
 assert.match(at('app'),/aria-current="page">app\/</,'a folder named without its slash still opens');
 const file=at('app/models/model.rb');
 assert.deepEqual(order(file),['codebase-here','codebase-file']);
 assert.match(file,/data-area="app\/"[^>]*>app\/<\/a><\/li><li><a [^>]*data-area="app\/models\/"[^>]*>models\/<\/a><\/li><li><span aria-current="page">model\.rb</);
 assert.match(file,/Who changed it[\s\S]*Ada/);
 assert.match(file,/Releases that shipped these changes/);
 assert.match(at('app/',{codeSort:'name'}),/aria-pressed="true">Name/);
 // The path rides in the sticky section bar, and Contents starts with a way up.
 const models=at('app/models/');
 assert.match(models,/<nav class="primary-section-nav has-lead"[^>]*><div class="primary-breadcrumb"[\s\S]*?<span aria-current="page">models\/<\/span>[\s\S]*?<\/div><a href="#codebase-here"/);
 assert.match(models,/<tr class="is-up"><th colspan="5"><a [^>]*data-area="app\/"[^>]*>↑ app\/<\/a>/);
 assert.match(at('app/'),/<tr class="is-up"><th colspan="5"><a [^>]*data-area=""[^>]*>↑ repository<\/a>/);
 assert.doesNotMatch(root,/class="is-up"/,'the repository has nowhere to go up to');
});

test('Browse releases follows the scope dates, with all of history one switch away',()=>{
 const dates=index.releases.map(r=>r.date).sort();
 const scoped=ui({mode:'observatory',releaseBrowse:'list',periodFrom:dates.at(-1),periodTo:dates.at(-1)});
 const html=renderPrimaryExplorer(index,scoped);
 const inDates=index.releases.filter(r=>r.date===dates.at(-1)).length;
 assert.equal((html.match(/class="primary-release-entry/g)||[]).length,inDates,'only releases in the scope dates are listed');
 assert.match(html,new RegExp(`In these dates \\(${inDates}\\)`));
 assert.match(html,/data-key="releaseRange" data-value="all"/,'all of history is offered');
 const everything=renderPrimaryExplorer(index,{...scoped,releaseRange:'all'});
 assert.equal((everything.match(/class="primary-release-entry/g)||[]).length,index.releases.length);
 const wide=renderPrimaryExplorer(index,ui({mode:'observatory',releaseBrowse:'list',periodFrom:dates[0],periodTo:dates.at(-1)}));
 assert.doesNotMatch(wide,/data-key="releaseRange"/,'no switch when the dates already hold every release');
});

test('what shipped lists releases in the dates with plain, grouped changes and the work not yet released',()=>{
 assert.equal(plainSubject('feat(ui)!: new explorer'),'ui: New explorer');
 assert.equal(plainSubject('fix: handle empty tags'),'Handle empty tags');
 assert.equal(plainSubject('Tidy the readme'),'Tidy the readme');
 const dates=index.releases.map(r=>r.date).sort();
 const all=shippedInWindow(index,{from:dates[0],to:dates.at(-1)});
 assert.equal(all.releases.length,index.releases.length);
 assert.ok(all.releases.every((r,i,a)=>i===0||(a[i-1].date>=r.date)),'newest first');
 for(const r of all.releases)for(const g of r.groups)assert.ok(g.items.length&&g.label);
 const latest=shippedInWindow(index,{from:dates.at(-1),to:dates.at(-1)});
 assert.ok(latest.releases.every(r=>r.date===dates.at(-1)),'only releases dated in the window');
 const text=shippedText(all);
 assert.match(text,/^What shipped, /);
 for(const r of all.releases)assert.ok(text.includes(r.tag));
 const html=renderPrimaryExplorer(index,ui({mode:'observatory',periodFrom:dates[0],periodTo:dates.at(-1)}));
 assert.ok(html.indexOf('id="releases-shipped"')<html.indexOf('id="releases-browse"'),'What shipped leads the Releases page');
 assert.match(html,/data-action="copy-shipped"/);
 assert.match(periodBriefingForUi(index,ui({periodFrom:dates[0],periodTo:dates.at(-1)})),/What shipped, /,'the scope summary says what shipped');
});
