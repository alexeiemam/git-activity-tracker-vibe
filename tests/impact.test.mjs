import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseGitHistory,parseGitLog,buildAnalysis,getHistoryDateBounds,periodForPreset} from '../assets/domain.js';
import {parseTagVersion,releaseKind,fileKind,changeFootprint,changeCategory,impactAnalysis} from '../assets/impact.js';
import {impactTimeline,impactReleaseMatrix,impactReleaseDetail,impactReach,impactDurability} from '../assets/impact-view.js';
import {generateDemoLog} from '../assets/demo-data.js';

const author=(day,month=1)=>`2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T11:00:00+00:00`;
const row=(hash, email, authored, committed, subject, parents='',files=[])=>[
  `COMMIT|${hash}|${email}|${email}|${authored}|${committed}|${subject}|${parents}`,
  ...files.map(([adds,dels,path])=>`${adds}\t${dels}\t${path}`),
].join('\n');
const tag=(name,hash,date,annotated=true)=>`TAG|${name}|${annotated?hash:''}|${hash}|${annotated?'tag':'commit'}|${date}`;
const H={a:'a000001',b:'b000002',c:'c000003',d:'d000004',e:'e000005',f:'f000006',g:'f000007',h:'f000008'};
const lines=[
  tag('v1.0.0',H.b,author(3)),
  tag('v1.0.1',H.c,author(5),false),
  tag('v1.1.0',H.e,author(9)),
  tag('prod/v1.1.0',H.e,author(10),false),
  tag('v1.1.1',H.f,author(25)),
  tag('v1.1.2',H.g,author(20,3)),
  row(H.a,'ada@work',author(1),author(1),'chore: candidate VERSION','',[[1,1,'VERSION']]),
  row(H.b,'ada@work',author(2),author(2),'feat: add API',H.a,[[4,2,'app/api.ts'],[2,0,'test/api.test.ts']]),
  row(H.c,'ben@work',author(4),author(4),'fix: API bug',H.b,[[1,1,'app/api.ts']]),
  row(H.d,'ada@work',author(6),author(6),'refactor: client',H.b,[[6,3,'app/client.ts']]),
  row(H.e,'ben@work',author(7),author(7),'Merge pull request #7',`${H.c} ${H.d}`,[]),
  row(H.f,'ben@work',author(19),author(19),'docs: revised API',H.e,[[3,1,'app/client.ts'],[1,0,'docs/readme.md']]),
  row(H.g,'ada@work',author(20,3),author(20,3),'feat: new module',H.f,[[9,1,'app/new.ts']]),
  row(H.h,'ben@work',author(22,3),author(22,3),'fix: post-release',H.g,[[2,0,'app/api.ts']]),
];
const hist=parseGitHistory(lines.join('\n'));
const GROUPS=[{displayName:'Ada',emails:['ada@work']},{displayName:'Ben',emails:['ben@work']}];
const view=(scope={})=>buildAnalysis(hist.commits,GROUPS,{start:'2026-01-01',end:'2026-04-30',includeMerges:false,includeReverts:true,...scope});
const impact=(scope={},opts={})=>impactAnalysis(view(scope),hist.commits,hist.tags,opts);
const release=(model,name)=>model.releases.find(r=>r.tag===name);

test('tag import peels annotated tags, keeps lightweight dates distinct, and preserves legacy format',()=>{
  assert.equal(hist.tags.length,6);
  assert.equal(hist.tags[0].hash,H.b);
  assert.equal(hist.tags[0].timestampSource,'tagger');
  assert.equal(hist.tags[1].timestampSource,'tagged-commit');
  assert.equal(hist.commits.find(c=>c.hash===H.e).parents.length,2);
  assert.equal(hist.commits.find(c=>c.hash===H.e).isMerge,true);
  assert.equal(hist.commits.find(c=>c.hash===H.a).touchesVersion,true);
  const legacy=parseGitLog('COMMIT|abc1234|dev@work|Dev|2023-01-01T12:00:00Z|A subject | with pipe|bcdef01');
  assert.equal(legacy[0].subject,'A subject | with pipe');
  assert.equal(legacy[0].committedAt,null);
});

test('tag version transitions are labels, not quantitative impact scores',()=>{
  assert.deepEqual(parseTagVersion('release/v8.9.1'),{major:8,minor:9,patch:1,prerelease:null});
  assert.equal(parseTagVersion('build-123'),null);
  assert.equal(releaseKind(parseTagVersion('v2.0.0'),parseTagVersion('v1.9.9')),'major');
  assert.equal(releaseKind(parseTagVersion('v1.2.0'),parseTagVersion('v1.1.99')),'minor');
  assert.equal(releaseKind(parseTagVersion('v1.2.3'),parseTagVersion('v1.2.2')),'patch');
  assert.equal(releaseKind(parseTagVersion('v1.0.0-rc.2'),parseTagVersion('v1.0.0-rc.1')),'prerelease');
  assert.equal(releaseKind(parseTagVersion('v1.0.0'),parseTagVersion('v2.0.0')),'divergent');
  assert.equal(releaseKind(parseTagVersion('v1.0.0'),null),'unclassified');
});

test('merge ancestry includes branch changes, excludes structural merge by global policy, groups alias tags',()=>{
  const i=impact();
  assert.equal(i.releases.length,6-1,'two names for same tagged SHA are one release');
  const e=release(i,'v1.1.0');
  assert.equal(e.previousTag,'v1.0.1');
  assert.equal(e.transition,'minor');
  assert.equal(e.totalIntroduced,2,'merge and unmerged feature branch introduced');
  assert.deepEqual(e.selected.map(c=>c.hash),[H.d],'the merge commit is excluded by global policy');
  assert.equal(e.selectedFootprint.versionTouches,0,'VERSION on an older commit is not a new tag');
  assert.equal(e.aliases.length,2);
  const merges=impact({includeMerges:true});
  assert.equal(release(merges,'v1.1.0').selected.length,2);
  assert.equal(release(i,'v1.0.1').selected[0].hash,H.c);
});

test('date + person filters apply to all impact evidence, reference choice changes denominators only',()=>{
  const repo=impact({selectedIds:['0']},{metric:'share'});
  const r=release(repo,'v1.1.0');
  assert.equal(r.selected.length,1);
  assert.equal(r.selected[0].groupId,'0');
  assert.equal(r.cells[0].value,100,'only Ada made an eligible non-merge commit in this release');
  const restricted=impact({selectedIds:['0'],end:'2026-01-06'},{metric:'share'});
  assert.equal(restricted.releases.some(x=>x.tag==='v1.1.0'),false,'tag date respects global date range');
  const scoped=impact({selectedIds:['1'],end:'2026-01-30'});
  assert.ok(scoped.releases.every(r=>r.selected.every(c=>c.email==='ben@work')));
  assert.equal(release(scoped,'v1.1.0').selected.length,0);
  const onlySelected=impact({selectedIds:['0'],denominator:'selection'},{metric:'share'});
  assert.equal(release(onlySelected,'v1.0.1').cells[0].value,null,'zero scoped reference is undefined, not 0%');
  assert.equal(release(onlySelected,'v1.1.0').cells[0].value,100);
});

test('revisitation tracks descendant commit paths and censors horizons with insufficient follow-up',()=>{
  const i=impact();
  const e=release(i,'v1.1.0');
  assert.equal(e.nextTag,'v1.1.1');
  assert.deepEqual([...e.selectedFootprint.paths],['app/client.ts']);
  assert.equal(e.nextTagFootprint.count,1);
  assert.equal(e.nextTagFootprint.share,100);
  assert.equal(e.followup[0].observed,true);
  assert.equal(e.followup[0].count,1);
  assert.equal(e.followup[1].observed,false);
  assert.equal(e.followup[1].share,null);
  assert.equal(release(i,'v1.1.2').followup[0].observed,false);
});

test('partial DAGs never present a definitive release difference or survival rate',()=>{
  const stripped=hist.commits.filter(c=>c.hash!==H.d);
  const v=buildAnalysis(stripped,GROUPS,{start:'2026-01-01',end:'2026-04-30'});
  const i=impactAnalysis(v,stripped,hist.tags);
  const e=release(i,'v1.1.0');
  assert.equal(e.lineageComplete,false);
  assert.equal(e.followup[0].observed,false);
});

test('file categories and change signals use only evidenced paths and conventional subject hints',()=>{
  assert.equal(fileKind('spec/models/user_spec.rb'),'test');
  assert.equal(fileKind('assets/tests/dashboard.test.ts'),'test');
  assert.equal(fileKind('docs/manual.md'),'docs');
  assert.equal(fileKind('app/api.rb'),'code');
  assert.equal(changeCategory({subject:'feat(ui)!: new explorer'}),'feat');
  assert.equal(changeCategory({subject:'Fixed release'}),'other');
  const f=changeFootprint(view().selectedCommits);
  assert.equal(f.versionTouches,1);
  assert.equal(f.codeAndTestCommits,1);
  assert.equal(f.testAccompaniment,100*f.codeAndTestCommits/f.codeCommits);
  assert.equal(f.areaTouches.get('app/')>0,true);
});

test('renderers encode Git-controlled content and keep percentages and censored data legible',()=>{
  const i=impact({selectedIds:['0']},{metric:'share'}), r=release(i,'v1.1.0');
  assert.match(impactTimeline(i,r.hash),/VERSION touched/);
  assert.match(impactReleaseMatrix(i),/—|100%/);
  assert.match(impactDurability(i,r.hash),/Not fully observed/);
  assert.match(impactReach(i,'within'),/within-person/i);
  assert.match(impactReleaseDetail(r,i.referenceLabel,i.metric),/First tagged|Introduced after/);
  const malicious={...r,tag:'<img src=x onerror=alert(1)>'};
  const markup=impactReleaseDetail(malicious,i.referenceLabel,i.metric);
  assert.ok(markup.includes('&lt;img'));
  assert.ok(!markup.includes('<img src=x'));
});

test('demo exports tagged release history, merge parents, and enough categories to explore',()=>{
  const h=parseGitHistory(generateDemoLog({years:3,commits:720}));
  assert.ok(h.tags.length>=10);
  assert.ok(h.commits.some(c=>c.parents.length>1));
  const groups=[...new Set(h.commits.map(c=>c.email))].map(email=>({displayName:email,emails:[email]}));
  const v=buildAnalysis(h.commits,groups,{start:'2023-01-01',end:'2026-12-31'});
  const i=impactAnalysis(v,h.commits,h.tags);
  assert.ok(i.releases.length>=10);
  assert.equal(i.overall.commits, h.commits.filter(c=>!c.isMerge && c.hash!=='unreleased').length);
  assert.ok(i.releases.some(r=>r.transition==='major'));
  assert.ok(i.releases.every(r=>r.lineageComplete));
});

test('generated capture command runs on real Git tags, including annotated, lightweight and backdated authors',()=>{
  const repo=mkdtempSync(join(tmpdir(),'git-signals-impact-'));
  try {
    const git=(args,env={})=>execFileSync('git',args,{cwd:repo,env:{...process.env,...env},encoding:'utf8'}).trim();
    git(['init','-q']);git(['config','user.name','Impact Tester']);git(['config','user.email','test@example.com']);
    writeFileSync(join(repo,'VERSION'),'1.0.0\n');git(['add','.']);
    git(['commit','-q','-m','initial'],{GIT_AUTHOR_DATE:'2025-01-01T08:00:00+00:00',GIT_COMMITTER_DATE:'2025-01-02T08:00:00+00:00'});
    git(['tag','-a','v1.0.0','-m','release'],{GIT_COMMITTER_DATE:'2025-01-03T08:00:00+00:00'});
    writeFileSync(join(repo,'file.ts'),'hello\n');git(['add','.']);
    git(['commit','-q','-m','feat: authored before commit'],{GIT_AUTHOR_DATE:'2024-12-30T08:00:00+00:00',GIT_COMMITTER_DATE:'2025-02-03T08:00:00+00:00'});
    git(['tag','v1.0.1']);
    const command=`(git for-each-ref --format="TAG|%(refname:short)|%(*objectname)|%(objectname)|%(objecttype)|%(creatordate:iso-strict)" refs/tags; git log HEAD --tags --pretty=format:"COMMIT|%H|%ae|%an|%aI|%cI|%s|%P" --numstat)`;
    const output=execFileSync('bash',['-lc',command],{cwd:repo,encoding:'utf8'});
    const h=parseGitHistory(output);
    assert.equal(h.tags.length,2);
    assert.equal(h.commits.length,2);
    const v1=h.tags.find(t=>t.name==='v1.0.0'),v2=h.tags.find(t=>t.name==='v1.0.1');
    assert.equal(v1.timestampSource,'tagger');
    assert.equal(v1.taggedDate,'2025-01-03');
    assert.equal(v2.timestampSource,'tagged-commit');
    assert.equal(v2.taggedDate,'2025-02-03');
    const backdated=h.commits.find(c=>c.hash===v2.hash);
    assert.equal(backdated.date,'2024-12-30');
    assert.equal(new Date(backdated.committedAt).toISOString().slice(0,10),'2025-02-03');
    const scopes=buildAnalysis(h.commits,[{displayName:'Tester',emails:['test@example.com']}],{start:'2024-12-01',end:'2025-02-28'});
    const model=impactAnalysis(scopes,h.commits,h.tags);
    assert.equal(release(model,'v1.0.1').selected.length,1);
  } finally { rmSync(repo,{force:true,recursive:true}); }
});


test('all-imported date bounds include later tagger dates without changing authored-date metrics',()=>{
  const h=parseGitHistory([
    tag('v1.0.0',H.a,'2026-07-01T12:00:00+00:00'),
    row(H.a,'ada@work',author(1),author(2),'feat: authored in January','',[[1,0,'app/a.ts']]),
  ].join('\n'));
  assert.equal(h.commits[0].date,'2026-01-01');
  const bounds=getHistoryDateBounds(h.commits,h.tags);
  assert.deepEqual(bounds,{min:'2026-01-01',max:'2026-07-01'});
  assert.deepEqual(periodForPreset(h.commits,'all',bounds),{start:bounds.min,end:bounds.max});
  assert.equal(periodForPreset(h.commits,'90d',bounds).end,'2026-07-01');
  const v=buildAnalysis(h.commits,GROUPS,{start:bounds.min,end:bounds.max});
  const i=impactAnalysis(v,h.commits,h.tags);
  assert.equal(i.releases.length,1);
  assert.equal(i.releases[0].selected.length,1);
});

test('mainline previous tag wins over closer tag on a merged feature branch',()=>{
  // a->b(main tag)->c->e (first parent); branch b->d (feature tag); e merges d.
  const h=parseGitHistory([
    tag('v2.0.0',H.b,author(5)),
    tag('feature-test',H.d,author(7)),
    tag('v2.0.1',H.e,author(10)),
    row(H.a,'ada@work',author(1),author(1),'base','',[[2,0,'app/base.ts']]),
    row(H.b,'ada@work',author(2),author(2),'feat: main release',H.a,[[3,0,'app/a.ts']]),
    row(H.c,'ada@work',author(6),author(6),'fix: mainline',H.b,[[2,0,'app/a.ts']]),
    row(H.d,'ben@work',author(6),author(6),'feat: branch',H.b,[[2,0,'app/b.ts']]),
    row(H.e,'ada@work',author(9),author(9),'Merge branch',`${H.c} ${H.d}`,[]),
  ].join('\n'));
  const v=buildAnalysis(h.commits,GROUPS,{start:'2026-01-01',end:'2026-04-30'});
  const model=impactAnalysis(v,h.commits,h.tags);
  const release=model.releases.find(r=>r.tag==='v2.0.1');
  assert.equal(release.previousTag,'v2.0.0');
  assert.equal(release.totalIntroduced,3,'include both lines of work and merge commit, but not already-released mainline');
  assert.deepEqual(new Set(release.selected.map(c=>c.hash)),new Set([H.c,H.d]));
});

test('impact timeline retains authored activity after the latest tag as unreleased evidence',()=>{
  const h=parseGitHistory([
    tag('v1.0.0',H.a,author(3)),
    row(H.a,'ada@work',author(1),author(2),'feat: baseline','',[[3,0,'app/a.ts']]),
    row(H.b,'ben@work',author(4,4),author(4,4),'feat: still unreleased',H.a,[[5,1,'app/b.ts']]),
  ].join('\n'));
  const v=buildAnalysis(h.commits,GROUPS,{start:'2026-01-01',end:'2026-05-01'});
  const model=impactAnalysis(v,h.commits,h.tags);
  assert.equal(model.releases.length,1);
  assert.equal(model.overall.commits,1,'newer unreleased commit must not enter released footprint');
  const markup=impactTimeline(model,model.releases[0].hash);
  assert.match(markup,/2026-04 · 1 authored commits/);
  assert.match(markup,/including unreleased/);
});
