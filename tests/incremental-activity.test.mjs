import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {mergeGitHistories,isCompleteRecapture,compactAdditionalCapture} from '../assets/history-merge.js';
import {extendContributorGroups} from '../assets/external-identities.js';

const hash=n=>n.toString(16).padStart(40,'0');
const commit=(n,email='alice@demo.test',name='Alice',day='2026-11-01',files='3\t1\tsrc/app.rb')=>
  `COMMIT|${hash(n)}|${email}|${name}|${day}T09:00:00Z|${day}T09:30:00Z|feat: item ${n}|\n${files}`;
const tag=(name,sha,at='2026-11-01T10:00:00Z')=>`TAG|${name}||${sha}|commit|${at}`;
const release=(tag_name,body='Initial',author='alice')=>`GHRELEASE|${Buffer.from(JSON.stringify({tag_name,name:tag_name,body,published_at:'2026-11-01T11:00:00Z',author:{login:author}})).toString('base64')}`;
const heroku=(env,records)=>`HEROKU|${env}|${Buffer.from(JSON.stringify(records)).toString('base64')}`;
const event=(version,sha,desc='Deploy')=>({version,created_at:'2026-11-02T09:00:00Z',description:`${desc} ${sha}`,status:'succeeded',user:{email:'ops@demo.test'}});

const original=[commit(1),commit(2),tag('v1',hash(2)),release('v1'),'GHSTATUS|ok',
  heroku('PROD',[event(1,hash(2))]),'HEROKUSTATUS|PROD|ok'].join('\n');
const addition=[commit(2),commit(3,'bob@demo.test','Bob','2026-11-12'),tag('v1',hash(2)),
  tag('v2',hash(3),'2026-11-12T14:00:00Z'),release('v1','Updated notes'),release('v2','New'),
  'GHSTATUS|unavailable',heroku('PROD',[event(1,hash(2)),event(2,hash(3))]),'HEROKUSTATUS|PROD|unavailable'].join('\n');

test('incremental capture deduplicates overlaps and updates release metadata without status regression',()=>{
  const a=parseGitHistory(original),b=parseGitHistory(addition);
  const {history:merged,changes,changed}=mergeGitHistories(a,b);
  assert.ok(changed);
  assert.deepEqual(changes.commits,{added:1,updated:0});
  assert.equal(merged.commits.length,3);
  assert.deepEqual(merged.commits.map(c=>c.hash),[hash(1),hash(2),hash(3)]);
  assert.equal(merged.tags.length,2);
  assert.equal(merged.githubReleases.length,2);
  assert.equal(merged.githubReleases.find(r=>r.tag==='v1').notes,'Updated notes');
  assert.equal(merged.herokuReleases.length,2);
  assert.equal(merged.githubStatus,'ok','a failed later GH fetch must not erase a successful earlier capture');
  assert.equal(merged.herokuStatus.PROD,'ok');
  assert.deepEqual(parseGitHistory(`${original}\n${addition}`),merged,'session rawLog reparsing matches active union');
  assert.equal(isCompleteRecapture(a,b,merged),false,'a partial capture cannot replace the old raw history');
  const overlapping=mergeGitHistories(merged,b);
  assert.equal(overlapping.changed,false,'re-pasting the same capture is idempotent');
  assert.equal(overlapping.history.commits.length,3);
});

test('a complete newer capture can replace stored raw log; metadata-only updates remain valid',()=>{
  const a=parseGitHistory(original);
  const complete=parseGitHistory(`${original}\n${addition}`);
  const result=mergeGitHistories(a,complete);
  assert.equal(isCompleteRecapture(a,complete,result.history),true);
  assert.equal(parseGitHistory(release('v1','Metadata only'),{allowEmpty:true}).commits.length,0);
  assert.throws(()=>parseGitHistory(release('v1','Metadata only')),/No dated commits/);
  const updated=mergeGitHistories(complete,parseGitHistory(release('v1','Metadata only'),{allowEmpty:true}));
  assert.equal(updated.history.githubReleases.find(r=>r.tag==='v1').notes,'Metadata only');
});

test('a partially overlapping full capture is compacted without losing session reparsing fidelity',()=>{
  const a=parseGitHistory(original);
  // The refresh does not include the earlier GitHub Releases (e.g. gh is
  // temporarily unavailable) but does include every old commit and one new.
  const refresh=[commit(1),commit(2),commit(3,'bob@demo.test','Bob','2026-11-12'),
    tag('v1',hash(2)),tag('v2',hash(3),'2026-11-12T14:00:00Z'),
    'GHSTATUS|unavailable','HEROKUSTATUS|PROD|unavailable'].join('\n');
  const incoming=parseGitHistory(refresh),merged=mergeGitHistories(a,incoming);
  assert.equal(isCompleteRecapture(a,incoming,merged.history),false);
  const compact=compactAdditionalCapture(original,refresh,a,merged.history);
  assert.equal(compact.match(/COMMIT\|/g)?.length,1,'overlapping commit bodies are not stored again');
  assert.ok(compact.includes(hash(3)));
  assert.deepEqual(parseGitHistory(`${original}\n${compact}`),merged.history);
  const second=mergeGitHistories(merged.history,incoming);
  assert.equal(second.changed,false);
  assert.deepEqual(compactAdditionalCapture(original,refresh,a,merged.history),compact);
});

test('shallow boundaries in later metadata apply to existing commits and survive session restore',()=>{
  const a=parseGitHistory(`COMMIT|${hash(4)}|a@demo.test|Alice|2026-11-01T10:00:00Z|2026-11-01T10:10:00Z|feat: parent known|${hash(3)}`);
  assert.equal(a.commits[0].parentsKnown,true);
  const incoming=parseGitHistory(`HISTORYSHALLOW|${hash(4)}`,{allowEmpty:true});
  const merged=mergeGitHistories(a,incoming);
  assert.equal(merged.changed,true);
  assert.equal(merged.history.commits[0].parentsKnown,false);
  const raw=`COMMIT|${hash(4)}|a@demo.test|Alice|2026-11-01T10:00:00Z|2026-11-01T10:10:00Z|feat: parent known|${hash(3)}\nHISTORYSHALLOW|${hash(4)}`;
  assert.deepEqual(parseGitHistory(raw),merged.history);
});

test('rich duplicate rows can improve numstat without double counting, but never reassign authors',()=>{
  const a=parseGitHistory(commit(1,'alice@demo.test','Alice','2026-11-01',''));
  const richer=parseGitHistory(commit(1,'alice@demo.test','Alice','2026-11-01','9\t4\tsrc/new.rb'));
  const result=mergeGitHistories(a,richer);
  assert.equal(result.history.commits.length,1);
  assert.equal(result.history.commits[0].files[0].path,'src/new.rb');
  const conflict=parseGitHistory(commit(1,'unknown@demo.test','Unrelated'));
  assert.equal(mergeGitHistories(result.history,conflict).history.commits[0].email,'alice@demo.test');
});

test('new identities stay reviewable without changing manual grouping, names, schedules or order',()=>{
  const groups=[
    {displayName:'Release captain',emails:['alice@demo.test','alice+other@demo.test','github:alice'],workingDays:[0,1,2]},
    {displayName:'Operations',emails:['heroku:ops@demo.test'],workingDays:[1,2,3,4]},
  ];
  const catalogue=new Map([
    ['alice@demo.test',{name:'Alice'}],['alice+other@demo.test',{name:'Alice'}],
    ['bob@demo.test',{name:'Alice',commits:2}], // same display name is not a safe identity match
    ['heroku:ops@demo.test',{name:'ops@demo.test'}],
    ['github:alice',{name:'@alice'}],['github:newcomer',{name:'@newcomer'}],
  ]);
  const gh=[{tag:'v1',publisher:'alice',draft:false},{tag:'v2',publisher:'newcomer',draft:false}];
  const {groups:extended,added}=extendContributorGroups(groups,catalogue,gh,[],[]);
  assert.deepEqual(extended.slice(0,2),groups);
  assert.equal(extended[2].displayName,'Alice');
  assert.deepEqual(extended[2].emails,['bob@demo.test']);
  assert.ok(extended.some(g=>g.emails.includes('github:newcomer')));
  assert.deepEqual(new Set(added),new Set(['bob@demo.test','github:newcomer']));
  const repeat=extendContributorGroups(extended,catalogue,gh,[],[]);
  assert.deepEqual(repeat.groups,extended);
  assert.equal(repeat.added.length,0);
  const view=buildAnalysis(parseGitHistory(`${original}\n${commit(3,'bob@demo.test','Bob','2026-11-12')}`).commits,
    extended,{start:'2026-11-01',end:'2026-11-12',selectedIds:new Set(['0','1','2'])});
  assert.equal(view.allContributors.length,extended.length);
});

test('incremental update worker changes its cached source only after validated merge',async()=>{
  const worker=new Worker(new URL('./worker-entry.mjs',import.meta.url),{type:'module'});
  let next=0;
  const run=(type,payload={})=>new Promise((resolve,reject)=>{
    const id=++next;
    const receive=message=>{
      if(message.id!==id||message.type==='progress')return;
      worker.off('message',receive);
      if(message.type==='error')reject(new Error(message.message));else resolve(message.result);
    };
    worker.on('message',receive);
    worker.postMessage({id,type,...payload});
  });
  try {
    const initial=await run('parse',{raw:original});assert.equal(initial.commits.length,2);
    const merged=await run('append',{raw:addition});
    assert.equal(merged.history.commits.length,3);
    assert.equal(merged.changes.commits.added,1);
    const noChange=await run('append',{raw:'COMMIT|bad'});
    assert.equal(noChange.changed,false,'malformed/unrecognised lines cannot mutate the existing worker dataset');
    const second=await run('append',{raw:addition});assert.equal(second.changed,false);
    const view=await run('build',{
      groups:[{displayName:'Alice',emails:['alice@demo.test']},{displayName:'Bob',emails:['bob@demo.test']}],
      scope:{start:'2026-11-01',end:'2026-11-13',selectedIds:new Set(['0','1'])},
      impactOptions:{metric:'commits',actorMap:{}},
    });
    assert.equal(view.view.selectedCommits.length,3);
    assert.equal(view.primaryIndex.releases.length,2);
  }finally{await worker.terminate();}
});

test('the shipped dashboard exposes incremental import independently of identity review',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  assert.match(html,/id="add-activity-toggle"[^>]*aria-controls="append-history-panel"/);
  assert.match(html,/id="append-log-input"/);
  assert.match(html,/id="append-activity-btn"/);
  assert.match(app,/'append-activity':\(\)=>appendActivity\(\)/);
  assert.match(app,/extendContributorGroups\(mergeGroups,identityMeta/);
  assert.match(app,/if\(localDatasetId\)\{[\s\S]*saveLocalHistory\(localDatasetId,sessionPayload\(\)\)/);
  assert.match(app,/importRevision\+\+;computedKey=null;computedResult=null;/);
});
