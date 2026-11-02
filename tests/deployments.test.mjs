import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodeHerokuBatch,buildDeploymentIndex,DEPLOYMENT_ENVS} from '../assets/deployments.js';
import {parseGitHistory,buildAnalysis,getHistoryDateBounds} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {renderPrimaryExplorer,periodBriefingForUi} from '../assets/perspective-view.js';
import {primaryDefaults,restorePrimaryState,primaryStateForExport} from '../assets/perspective-state.js';
const b64=value=>Buffer.from(JSON.stringify(value),'utf8').toString('base64');
const hash=n=>n.toString(16).padStart(7,'0')+'f'.repeat(33);
const sha=n=>hash(n).slice(0,12);
const at=(day,hour='12')=>`${day}T${hour}:00:00Z`;
const event=(version,day,description,commit)=>({version,created_at:at(day),description,...(commit?{commit}:{}),unexpected_confidential_token:'NEVER_SHOW_ME'});
function fixture(overrides={}){
  const commits=[
    {n:1,email:'old@dev.test',name:'Mara',date:'2025-01-01',files:['app/api.rb']},
    {n:2,email:'new@dev.test',name:'Mara',date:'2025-01-08',files:['app/api.rb']},
    {n:3,email:'lee@dev.test',name:'Lee',date:'2025-01-10',files:['test/api_test.rb']},
    {n:4,email:'old@dev.test',name:'Mara',date:'2025-02-02',files:['app/ui.js']},
    {n:5,email:'lee@dev.test',name:'Lee',date:'2025-02-08',files:['app/api.rb']},
    {n:6,email:'new@dev.test',name:'Mara',date:'2025-03-07',files:['app/ui.js']},
  ];
  const gitCommits=commits.slice().reverse().map(c=>[
    `COMMIT|${hash(c.n)}|${c.email}|${c.name}|${at(c.date)}|${at(c.date)}|feat: test ${c.n}|${c.n===1?'':hash(c.n-1)}`,
    ...c.files.map(path=>`9\t3\t${path}`),
  ].join('\n'));
  const data={
    STAG:[event(1,'2025-01-20',`Deploy ${sha(3)}`,sha(3)),event(2,'2025-03-11',`Deploy ${sha(6)}`,sha(6))],
    BETA:[event(1,'2025-02-10',`Deploy ${sha(5)}`,sha(5))],
    PROD:[event(1,'2025-01-21',`Deploy ${sha(1)}`,sha(1)),event(2,'2025-02-20',`Deploy ${sha(5)}`,sha(5)),
      event(3,'2025-02-21','Config add SECRET_KEY=oops'),event(4,'2025-02-23',`Deploy ${sha(5)}`,sha(5)),
      event(5,'2025-03-15',`Deploy ${sha(6)}`,sha(6))],
    ...overrides,
  };
  const records=Object.entries(data).flatMap(([env,releases])=>[`HEROKU|${env}|${b64(releases)}`,`HEROKUSTATUS|${env}|ok`]);
  const raw=[`TAG|v1.0.0||${hash(3)}|commit|${at('2025-01-12')}`,
    `TAG|v1.1.0||${hash(5)}|commit|${at('2025-02-12')}`,...records,...gitCommits].join('\n');
  const history=parseGitHistory(raw);
  const groups=[{displayName:'Mara',emails:['old@dev.test','new@dev.test']},{displayName:'Lee',emails:['lee@dev.test']}];
  const bounds=getHistoryDateBounds(history.commits,history.tags,history.githubReleases,history.herokuReleases);
  const view=buildAnalysis(history.commits,groups,{start:bounds.min,end:bounds.max,selectedIds:new Set(['0','1']),includeMerges:false,includeReverts:true,metric:'commits',denominator:'repository'});
  const impact=impactAnalysis(view,history.commits,history.tags,{skipFollowup:true});
  const index=buildEvidenceIndex(view,impact,bounds);
  index.deployments=buildDeploymentIndex(history.herokuReleases,history.commits,index,history.herokuStatus);
  return {history,index,raw,bounds};
}

test('decode per-environment JSON without requiring jq; retain only safe release fields',()=>{
  assert.deepEqual(DEPLOYMENT_ENVS,['STAG','BETA','PROD']);
  const rows=decodeHerokuBatch(b64([event('v42','2025-01-02','Config add SECRET=TOPSECRET'),event(43,'2025-01-03','Deploy aabbccc')]),'PROD');
  assert.equal(rows.length,2);
  assert.equal(rows[0].description,'Configuration change');
  assert.equal(rows[0].kind,'config');
  assert.equal(rows[1].rawSha,'aabbccc');
  assert.doesNotMatch(JSON.stringify(rows),/TOPSECRET|NEVER_SHOW_ME/);
  assert.equal(decodeHerokuBatch(b64([event(1,'2025-01-01','Deploy aaaaaaa')]),'UNKNOWN'),null);
  assert.equal(decodeHerokuBatch('garbage','PROD'),null);
  assert.equal(decodeHerokuBatch(b64({releases:[event(1,'2025-01-01','Deploy aaaaaaa')]}),'STAG')?.length,1);
  assert.equal(decodeHerokuBatch(b64([{version:12,created_at:'invalid'}]),'STAG')?.length,0);
});

test('Git history parsing includes independent Heroku batches and optional status',()=>{
  const {history,raw}=fixture();
  assert.equal(history.herokuReleases.length,8);
  assert.deepEqual(history.herokuStatus,{STAG:'ok',BETA:'ok',PROD:'ok'});
  assert.equal(history.commits.length,6);
  assert.equal(history.tags.length,2);
  assert.ok(raw.includes('COMMIT|'));
  assert.equal(parseGitHistory(raw.replace(/^HEROKU\|BETA\|.+$/m,'HEROKU|BETA|bad')).captureWarnings.length,1);
});

test('release-to-environment inclusion matches ancestry, not dates or matching version names',()=>{
  const {index}=fixture();
  const observed=index.deployments.releaseLinks;
  const first=observed.find(r=>r.tag==='v1.0.0');
  const second=observed.find(r=>r.tag==='v1.1.0');
  assert.equal(first.byEnv.STAG.date,'2025-01-20');
  assert.equal(first.byEnv.BETA.date,'2025-02-10');
  assert.equal(first.byEnv.PROD.date,'2025-02-20');
  assert.equal(first.byEnv.PROD.certainty,'introduced');
  assert.equal(second.byEnv.PROD.date,'2025-02-20');
  assert.equal(second.byEnv.PROD.certainty,'introduced');
  assert.equal(second.byEnv.BETA.date,'2025-02-10');
  assert.equal(second.byEnv.STAG.date,'2025-03-11');
});

test('the first imported PROD snapshot proves presence-by, not exact introduction',()=>{
  const {index}=fixture({PROD:[event(100,'2025-02-20',`Deploy ${sha(5)}`,sha(5))]});
  for(const release of index.deployments.releaseLinks){
    assert.equal(release.byEnv.PROD.certainty,'observed-by');
  }
  assert.equal(index.deployments.events.find(e=>e.env==='PROD').allNewCommits,null);
  assert.equal(index.deployments.people.reduce((n,p)=>n+p.commits,0),0);
});

test('config, same-SHA redeploy and repeated deployment never inflate new PROD code',()=>{
  const {index}=fixture();
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.deepEqual(prod.map(e=>e.type),['baseline','code','config','redeploy','code']);
  assert.equal(prod[1].allNewCommits,4);
  assert.equal(prod[1].eligibleNewCommits,4);
  assert.equal(prod[2].codeSha,prod[1].codeSha);
  assert.equal(prod[2].shaSource,'config-inferred');
  assert.equal(prod[2].allNewCommits,null);
  assert.equal(prod[3].allNewCommits,null);
  assert.equal(prod[4].allNewCommits,1);
  assert.equal(index.deployments.people.reduce((n,p)=>n+p.commits,0),5);
});

test('merged contributor emails reconcile in newly deployed production commits',()=>{
  const {index}=fixture();
  const mara=index.deployments.people.find(p=>p.name==='Mara');
  const lee=index.deployments.people.find(p=>p.name==='Lee');
  assert.ok(mara);
  assert.equal(mara.commits,3); // 2,4,6 (both author identities)
  assert.equal(lee.commits,2); // 3,5
});

test('rollback uses a known Heroku release number, but an unknown target stops ancestry inference',()=>{
  const {index}=fixture({PROD:[event(1,'2025-01-21',`Deploy ${sha(1)}`,sha(1)),
    event(2,'2025-02-20',`Deploy ${sha(5)}`,sha(5)),
    event(3,'2025-02-25','Rollback to v1'),
    event(4,'2025-03-01','Rollback to v999'),
    event(5,'2025-03-15',`Deploy ${sha(6)}`,sha(6))]});
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.equal(prod[2].type,'rollback');
  assert.equal(prod[2].codeSha,hash(1));
  assert.equal(prod[2].shaSource,'rollback-version');
  assert.equal(prod[3].codeSha,null);
  assert.equal(prod[4].deltaReliable,false);
  assert.equal(prod[4].firstProdCommits,0);
});

test('unresolvable and ambiguous Git SHA values cannot generate author credit',()=>{
  const {history,index}=fixture({PROD:[event(1,'2025-01-01','Deploy badc0de','badc0de'),event(2,'2025-02-02','Deploy ab12345','ab12345')]});
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.ok(prod.every(e=>e.codeSha===null));
  assert.equal(index.deployments.people.length,0);
  assert.ok(prod.every(e=>e.hashStatus==='not-imported'));
});

test('the event and release views distinguish independent QA vs PROD and preserve data safety',()=>{
  const {index,bounds}=fixture();const ui=primaryDefaults();ui.periodFrom=bounds.min;ui.periodTo=bounds.max;ui.contributorFocus='0';
  for(const mode of ['observatory','periods','contributors','deployments']){
    ui.mode=mode;
    const html=renderPrimaryExplorer(index,ui);
    assert.ok(html.length>1500,mode);
    assert.doesNotMatch(html,/NEVER_SHOW_ME|TOPSECRET/);
    if(mode==='deployments'){
      assert.match(html,/STAG · QA/);
      assert.match(html,/BETA · QA/);
      assert.match(html,/Production/);
      assert.match(html,/Deployment anatomy|DEPLOYMENT ANATOMY/i);
      assert.match(html,/data-action="deployment-select"/);
    }
  }
  const anatomy=renderPrimaryExplorer(index,{...ui,mode:'observatory',releaseHash:index.releases[1].hash});
  assert.match(anatomy,/Where is this tagged revision observed/);
  assert.match(anatomy,/Present by this observed snapshot|First introduced in observed transition/);
  assert.match(periodBriefingForUi(index,{...ui,mode:'periods'}),/Heroku .* STAG events/);
});

test('deployment browser state is session-exportable, bounded and restored',()=>{
  const state=primaryDefaults();Object.assign(state,{mode:'deployments',deploymentEnv:'PROD',deploymentYear:'2025',deploymentPage:3});
  const restored=restorePrimaryState({primary:primaryStateForExport(state)},[]);
  assert.equal(restored.mode,'deployments');assert.equal(restored.deploymentEnv,'PROD');
  assert.equal(restored.deploymentPage,3);
  assert.equal(restorePrimaryState({primary:{mode:'deployments',deploymentEnv:'BOGUS',deploymentPage:1e9}},[]).deploymentEnv,'all');
});

test('the shared source date scope extends to Heroku events occurring after authored history',()=>{
  const {history}=fixture({PROD:[event(1,'2025-12-23',`Deploy ${sha(6)}`,sha(6))]});
  const bounds=getHistoryDateBounds(history.commits,history.tags,history.githubReleases,history.herokuReleases);
  assert.equal(bounds.max,'2025-12-23');
});


test('failed and pending Heroku releases are events, not code deployments',()=>{
  const f=event(2,'2025-02-20',`Deploy ${sha(5)}`,sha(5));f.status='failed';
  const p=event(3,'2025-02-22',`Deploy ${sha(5)}`,sha(5));p.status='pending';
  const {index}=fixture({PROD:[event(1,'2025-01-21',`Deploy ${sha(1)}`,sha(1)),f,p,
    event(4,'2025-03-15',`Deploy ${sha(6)}`,sha(6))]});
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.deepEqual(prod.map(e=>e.type),['baseline','unsuccessful','unsuccessful','code']);
  assert.equal(prod[1].codeSha,null);
  assert.equal(prod[2].codeSha,null);
  assert.equal(prod[3].allNewCommits,5);
  assert.equal(index.deployments.releaseLinks.find(r=>r.tag==='v1.1.0').byEnv.PROD.date,'2025-03-15');
});

test('missing Heroku metadata retains a working release-first dashboard',()=>{
  const {history,index,bounds}=fixture();
  const gitOnly=buildDeploymentIndex([],history.commits,index,{STAG:'missing-cli',BETA:'missing-cli',PROD:'missing-cli'});
  assert.equal(gitOnly.available,false);
  index.deployments=gitOnly;
  const ui={...primaryDefaults(),mode:'observatory'};
  assert.match(renderPrimaryExplorer(index,ui),/No Heroku deployment history/);
  assert.match(renderPrimaryExplorer(index,{...ui,mode:'deployments'}),/No deployment history yet/);
});

test('latest QA-versus-PROD ancestry is descriptive, not a promotion inference',()=>{
  const {index}=fixture();
  assert.equal(index.deployments.qaComparison.BETA.relation,'behind-prod');
  assert.equal(index.deployments.qaComparison.STAG.relation,'same');
  assert.ok(index.deployments.releaseLinks.some(r=>r.firstQa?.env==='STAG'));
});


test('code redeployed after rollback is not counted as a second first production introduction',()=>{
  const {index}=fixture({PROD:[event(1,'2025-01-21',`Deploy ${sha(1)}`,sha(1)),
    event(2,'2025-02-20',`Deploy ${sha(5)}`,sha(5)),
    event(3,'2025-02-25','Rollback to v1'),
    event(4,'2025-03-10',`Deploy ${sha(5)}`,sha(5))]});
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.equal(prod[3].allNewCommits,4);
  assert.equal(prod[3].firstProdCommits,0);
  assert.equal(index.deployments.people.reduce((n,p)=>n+p.commits,0),4);
});

test('commits present in the earliest PROD snapshot do not become first introductions after a rollback',()=>{
  const {index}=fixture({PROD:[
    event(1,'2025-02-01',`Deploy ${sha(4)}`,sha(4)),
    event(2,'2025-02-05',`Deploy ${sha(2)}`,sha(2)),
    event(3,'2025-02-20',`Deploy ${sha(5)}`,sha(5)),
  ]});
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.deepEqual(prod.map(e=>e.firstProdCommits),[0,0,1]);
  assert.equal(prod[2].allNewCommits,3); // 3, 4 and 5: only 5 is first seen in production.
  assert.equal(index.deployments.people.reduce((sum,p)=>sum+p.commits,0),1);
});

test('a config-described release with a genuinely different SHA retains both signals',()=>{
  const {index}=fixture({PROD:[event(1,'2025-01-21',`Deploy ${sha(1)}`,sha(1)),
    event(2,'2025-02-20','Config add SECRET_KEY=hidden',sha(5))]});
  const prod=index.deployments.events.filter(e=>e.env==='PROD');
  assert.equal(prod[1].type,'config-and-code');
  assert.equal(prod[1].eligibleNewCommits,4);
  assert.equal(prod[1].description,'Configuration change');
  assert.equal(prod[1].firstProdCommits,4);
});

test('a successful unknown release invalidates the last confirmed environment code state',()=>{
  const {index}=fixture({STAG:[event(1,'2025-01-20',`Deploy ${sha(3)}`,sha(3)),
    event(2,'2025-02-20','Unknown slug event')]});
  assert.equal(index.deployments.envs.STAG.latestKnownSha,null);
  assert.equal(index.deployments.qaComparison.STAG.relation,'unavailable');
});

test('capture command queries all remote release histories and can execute with Bash and sh',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const source=html.match(/<code id="git-cmd">([^<]+)<\/code>/)?.[1];
  assert.ok(source);
  const script=source.replaceAll('&gt;','>').replaceAll('&amp;','&').replace(/\s*\| pbcopy\s*$/,'');
  assert.match(script,/heroku releases --json --num 1000 -r "\$environment"/);
  assert.doesNotMatch(script,/^\s*#/m);
  const repo=mkdtempSync(join(tmpdir(),'signals-heroku-capture-'));
  try{
    execFileSync('git',['init','-q'],{cwd:repo});
    execFileSync('git',['config','user.email','capture@test'],{cwd:repo});
    execFileSync('git',['config','user.name','Test'],{cwd:repo});
    writeFileSync(join(repo,'VERSION'),'v1');execFileSync('git',['add','VERSION'],{cwd:repo});
    execFileSync('git',['commit','-q','-m','test: baseline'],{cwd:repo});
    const sample=b64([event(1,'2025-02-10','Deploy 1234abc','1234abc')]);
    const shell=`git() { if [ "$1" = fetch ]; then return 0; fi; if [ "$1" = remote ] && [ "$2" = get-url ]; then printf '%s\\n' "$3"; return 0; fi; command git "$@"; }
      gh() { return 1; }
      heroku() { printf '%s\\n' "$HEROKU_SAMPLE"; }
      ${script}`;
    for(const sh of ['bash','sh']){
      const result=execFileSync(sh,['-c',shell],{cwd:repo,encoding:'utf8',env:{...process.env,HEROKU_SAMPLE:Buffer.from(JSON.stringify([event(1,'2025-02-10','Deploy 1234abc','1234abc')]),'utf8').toString()}});
      const parsed=parseGitHistory(result);
      assert.equal(parsed.herokuReleases.length,3,sh);
      assert.equal(parsed.herokuStatus.PROD,'ok',sh);
      assert.equal(parsed.commits.length,1,sh);
    }
    const failed=execFileSync('sh',['-c',shell.replace('heroku() { printf', 'heroku() { return 1; }\n  heroku_unused() { printf')],{cwd:repo,encoding:'utf8'});
    assert.equal(parseGitHistory(failed).herokuStatus.PROD,'unavailable');
  }finally{rmSync(repo,{recursive:true,force:true});}
});
