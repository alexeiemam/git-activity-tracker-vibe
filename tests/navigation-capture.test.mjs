import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {routeFromState,routeUrl,readRoute,applyRoute,targetUrl} from '../assets/route-state.js';
import {parseGitHistory} from '../assets/domain.js';
const groups=[{id:'0',displayName:'A',emails:['first@work.io','alias@work.io']},{id:'1',displayName:'B',emails:['b@work.io']}];
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const command=html.match(/<code id="git-cmd">([^<]+)<\/code>/)?.[1]?.replaceAll('&gt;','>').replaceAll('&amp;','&').replace(/\s*\| pbcopy\s*$/,'');
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();

test('URL route preserves stable merged identities, scopes and deployment targets without serialising evidence',()=>{
  const state={mode:'contributors',contributorFocus:'0',compareB:'1',contributorTab:'compare',contributorRange:'period',periodFrom:'2026-01-01',periodTo:'2026-02-01'};
  const route=routeFromState(state,groups,'local-123456789');
  const url=routeUrl('/index.html',route);
  assert.match(url,/person=first%40work.io/);
  assert.match(url,/dataset=local-123456789/);
  assert.doesNotMatch(url,/alias%40work.io|JSON|COMMIT%7C/);
  const read=readRoute(new URL('https://example.test'+url));
  const reversed=[{...groups[1],id:'0'},{...groups[0],id:'1'}];
  const restored=applyRoute({mode:'observatory'},read,reversed);
  assert.equal(restored.contributorFocus,'1');
  assert.equal(restored.compareB,'0');
  assert.equal(restored.periodFrom,'2026-01-01');
  assert.equal(restored.contributorRange,'period');
  assert.equal(restored.contributorTab,'compare');
});

test('URL route safely rejects untrusted query values and does not manufacture contributor identities',()=>{
  const r=readRoute('view=evil&release=%3Cscript%3E&person=someone&from=2026-12-31&to=2026-01-01&dataset=bad!&area='+'x'.repeat(220));
  assert.equal(r.view,'observatory');
  assert.equal(r.release,undefined);
  assert.equal(r.person,undefined);
  assert.equal(r.from,undefined);
  assert.equal(r.dataset,undefined);
  assert.equal(r.area,undefined);
  const missing=applyRoute({mode:'contributors',contributorFocus:'1'},{view:'contributors',person:'unknown@work.io'},groups);
  assert.equal(missing.contributorFocus,'1');
});

test('native deep links retain period context when following a person or codebase area',()=>{
  const state={mode:'periods',periodFrom:'2025-02-01',periodTo:'2025-02-14'};
  const link=targetUrl('/index.html',state,groups,'local-123456789',{view:'contributors',person:'alias@work.io',tab:'delivery'});
  assert.match(link,/from=2025-02-01/);
  assert.match(link,/to=2025-02-14/);
  assert.match(link,/person=alias%40work.io/);
  const context=applyRoute({mode:'observatory'},readRoute(link.split('?')[1]),groups);
  assert.equal(context.contributorFocus,'0');
  assert.equal(context.contributorRange,'period');
  const code=targetUrl('/index.html',state,groups,null,{view:'codebase',area:'app/services'});
  assert.equal(applyRoute({mode:'observatory'},readRoute(code.split('?')[1]),groups).codebaseRange,'period');
});

test('rendering produces ordinary anchors for release, contributor and deployment evidence',async()=>{
  const {renderPrimaryExplorer}=await import('../assets/perspective-view.js');
  const {buildEvidenceIndex}=await import('../assets/perspectives.js');
  const {impactAnalysis}=await import('../assets/impact.js');
  const {buildAnalysis}=await import('../assets/domain.js');
  const raw=['COMMIT|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|first@work.io|A|2026-01-05T10:00:00Z|2026-01-05T11:00:00Z|fix: one|', '3\t2\tapp/a.rb', 'COMMIT|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|b@work.io|B|2026-01-06T10:00:00Z|2026-01-06T11:00:00Z|feat: two|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','5\t4\tapp/b.rb','TAG|v1.0.0||bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|commit|2026-01-07T10:00:00Z'].join('\n');
  const h=parseGitHistory(raw);
  const view=buildAnalysis(h.commits,groups,{start:'2026-01-01',end:'2026-01-31',selectedIds:new Set(['0','1']),includeMerges:false,includeReverts:true});
  const impact=impactAnalysis(view,h.commits,h.tags);
  const index=buildEvidenceIndex(view,impact,{min:'2026-01-01',max:'2026-01-31'});
  index.navigation={ui:{mode:'observatory'},groups,path:'/index.html',datasetId:'local-123456789'};
  const markup=renderPrimaryExplorer(index,{mode:'observatory',releaseHash:impact.releases?.[0]?.hash||null,cohortBy:'type',releaseType:'all',releaseYear:'all',releaseQuery:'',releasePage:0,trail:[]});
  assert.match(markup,/<a [^>]*href="\/index\.html\?view=contributors/);
  assert.match(markup,/<a [^>]*href="\/index\.html\?view=deployments/);
  assert.match(markup,/data-action="local-copy-url"/);
  assert.match(markup,/dataset=local-123456789/);
});

test('capture enriches a deployed side-branch SHA not reachable from HEAD or tags, without cloning every branch',()=>{
  assert.ok(command);
  const dir=mkdtempSync(join(tmpdir(),'git-signals-branch-'));
  try{
    git(dir,'init','-q');git(dir,'config','user.email','tester@work.io');git(dir,'config','user.name','Tester');
    writeFileSync(join(dir,'README'),'root');git(dir,'add','README');git(dir,'commit','-q','-m','root');
    const main=git(dir,'branch','--show-current');
    git(dir,'checkout','-q','-b','qa-deployment');
    writeFileSync(join(dir,'app.rb'),'qa');git(dir,'add','app.rb');git(dir,'commit','-q','-m','test: side-branch');
    const side=git(dir,'rev-parse','HEAD');git(dir,'checkout','-q',main);
    const rows=JSON.stringify([{created_at:'2026-10-31T09:00:00Z',version:5,status:'succeeded',description:`Deploy ${side}`,commit:side}]);
    const sh=`git() { if [ "$1" = fetch ]; then return 0; fi; if [ "$1" = remote ] && [ "$2" = get-url ]; then printf '%s\\n' "$3"; return 0; fi; command git "$@"; }
      gh() { return 1; }
      heroku() { printf '%s\\n' "$HEROKU_TEST"; }
      ${command}`;
    const output=execFileSync('sh',['-c',sh],{cwd:dir,encoding:'utf8',env:{...process.env,HEROKU_TEST:rows}});
    const parsed=parseGitHistory(output);
    assert.ok(parsed.commits.some(c=>c.hash===side));
    assert.ok(parsed.commits.some(c=>c.subject==='root'));
    assert.equal(parsed.historyEnrichment.some(e=>e.sha===side&&e.status==='complete'),true);
    assert.equal(parsed.commits.length,2,'all three Heroku records refer to the same SHA, never duplicate commits');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('explicitly marked shallow boundaries cannot masquerade as complete root ancestry',()=>{
  const sha='a'.repeat(40);
  const record=`HISTORYSHALLOW|${sha}\nHISTORYENRICH|${sha}|bounded|176\nCOMMIT|${sha}|test@work.io|A|2026-01-03T10:00:00Z|2026-01-03T10:00:00Z|test: truncated|`;
  const result=parseGitHistory(record);
  assert.equal(result.commits[0].parentsKnown,false);
  assert.equal(result.historyEnrichment[0].status,'bounded');
});
