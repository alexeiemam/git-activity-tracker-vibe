import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseGitHistory,decodeGithubRelease,buildAnalysis,getHistoryDateBounds} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {impactReleaseDetail,impactReleaseMatrix,impactGithubStatus,impactIndividualProfiles} from '../assets/impact-view.js';

const hashes={base:'a000001',next:'b000002',late:'c000003'};
const tag=(name,hash,date,who='',email='')=>`TAG|${name}|${hash}|${hash}|tag|${date}|${who}|${email}`;
const log=(hash,email,date,parent,subject,path)=>`COMMIT|${hash}|${email}|${email}|${date}|${date}|${subject}|${parent}\n5\t2\t${path}`;
const github=(tagName,login,publishedAt,extras={})=>({tag_name:tagName,name:`Release ${tagName}`,author:login?{login,type:'User'}:null,published_at:publishedAt,draft:false,prerelease:false,
  body:'Release notes:\n- Mostly API | UI 🚀\n- Ship reliable changes',html_url:`https://github.com/org/repo/releases/tag/${tagName}`,...extras});
const encoded=record=>`GHRELEASE|${Buffer.from(JSON.stringify(record),'utf8').toString('base64')}`;
const input=(releases=[],status='ok')=>[
  tag('v1.0.0',hashes.base,'2026-01-03T09:00:00+00:00','Casey','<casey@work>'),
  tag('v1.0.1',hashes.next,'2026-02-05T09:00:00+00:00','Casey','<casey@work>'),
  tag('v1.0.2',hashes.late,'2026-03-02T09:00:00+00:00','Lin','<lin@work>'),
  ...releases.map(encoded),`GHSTATUS|${status}`,
  log(hashes.late,'lin@work','2026-02-26T11:00:00+00:00',hashes.next,'fix: follow-up','app/a.ts'),
  log(hashes.next,'casey@work','2026-02-01T10:00:00+00:00',hashes.base,'feat: build API','app/a.ts'),
  log(hashes.base,'lin@work','2026-01-02T10:00:00+00:00','','feat: first release','app/b.ts'),
].join('\n');
const groups=[{displayName:'Casey',emails:['casey@work','casey@home']},{displayName:'Lin',emails:['lin@work']}];
const model=(raw,actorMap={})=>{
  const h=parseGitHistory(raw);
  const v=buildAnalysis(h.commits,groups,{start:'2026-01-01',end:'2026-05-01'});
  return {h,v,i:impactAnalysis(v,h.commits,h.tags,{githubReleases:h.githubReleases,githubStatus:h.githubStatus,actorMap})};
};

test('UTF-8 base64 release notes preserve newlines, pipes and Unicode without corrupting Git numstat',()=>{
  const rich=github('v1.0.1','casey-gh','2026-02-18T11:00:00Z');
  const history=parseGitHistory(input([rich]));
  assert.equal(history.githubStatus,'ok');
  assert.equal(history.githubReleases.length,1);
  assert.equal(history.githubReleases[0].notes,rich.body);
  assert.equal(history.commits.length,3);
  assert.equal(history.commits[0].files[0].path,'app/a.ts');
  assert.equal(history.tags[0].taggerEmail,'casey@work');
  assert.equal(decodeGithubRelease('not-base64'),null);
  assert.equal(decodeGithubRelease(Buffer.from('{"tag_name": ""}').toString('base64')),null);
  assert.equal(parseGitHistory(input().replace('GHSTATUS|ok','GHRELEASE|broken\nGHSTATUS|unavailable')).captureWarnings.length,1);
});

test('GitHub publication time supersedes tagger time, but code membership and authorship remain Git-derived',()=>{
  const r=github('v1.0.1','casey-gh','2026-04-20T09:10:00Z');
  const {h,i}=model(input([r]));
  const target=i.releases.find(x=>x.tag==='v1.0.1');
  assert.equal(target.timeSource,'github-published');
  assert.equal(target.date,'2026-04-20');
  assert.equal(target.published,true);
  assert.equal(target.selected[0].date,'2026-02-01');
  assert.equal(target.selected[0].email,'casey@work');
  assert.equal(target.selectedFootprint.commits,1);
  assert.equal(target.previousTag,'v1.0.0');
  assert.equal(target.driver.login,'casey-gh');
  assert.equal(target.driver.groupId,null,'never infer GitHub identity from Git author name');
  assert.equal(getHistoryDateBounds(h.commits,h.tags,h.githubReleases).max,'2026-04-20');
});

test('publisher mapping credits driver independently of authored contribution and survives multi-email grouping',()=>{
  const release=github('v1.0.1','casey-gh','2026-02-12T10:00:00Z');
  const {i}=model(input([release]),{'casey-gh':'casey@home'});
  const r=i.releases.find(item=>item.tag==='v1.0.1');
  assert.equal(r.driver.groupId,'0');
  assert.equal(r.cells[0].drove,true);
  assert.equal(r.cells[0].share,100);
  const profile=i.profiles.find(p=>p.id==='0');
  assert.equal(profile.driven,2,'annotated tag on v1.0.0 plus mapped published release');
  assert.equal(profile.contributed,1,'first release authored by Lin, not Casey');
  assert.equal(profile.both,1);
  assert.equal(profile.drivenOnly,1);
  assert.equal(i.ghActors.find(a=>a.login==='casey-gh').groupName,'Casey');
  assert.match(impactIndividualProfiles(i,'0'),/DRIVEN/);
  assert.match(impactReleaseMatrix(i),/impact-matrix-driver-mark/);
  assert.match(impactGithubStatus(i),/publishers matched/);
});

test('tag-only and draft releases do not claim GitHub publication; annotated email is a labelled fallback',()=>{
  const draft=github('v1.0.2','lin-gh',null,{draft:true});
  const {i}=model(input([draft]));
  const r=i.releases.find(x=>x.tag==='v1.0.2');
  assert.equal(r.published,false);
  assert.equal(r.github,null);
  assert.equal(r.timeSource,'tagger');
  assert.equal(r.driver.source,'annotated-tagger');
  assert.equal(r.driver.groupId,'1');
  const text=impactReleaseDetail(r,i.referenceLabel,i.metric);
  assert.match(text,/Annotated tagger/);
  assert.doesNotMatch(text,/Read release notes/);
});

test('release notes and publisher metadata are escaped, and GitHub URLs are restricted to HTTPS',()=>{
  const r=github('v1.0.1','casey-gh','2026-02-20T12:00:00Z',{
    name:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>',html_url:'javascript:alert(1)'
  });
  const {i}=model(input([r]));
  const view=impactReleaseDetail(i.releases.find(x=>x.tag==='v1.0.1'),i.referenceLabel,i.metric);
  assert.match(view,/&lt;img/);
  assert.match(view,/&lt;script&gt;/);
  assert.doesNotMatch(view,/<script>/);
  assert.doesNotMatch(view,/href="javascript:/);
});

test('the visible command targets origin, captures GitHub releases, and falls back without an API',()=>{
  const repo=mkdtempSync(join(tmpdir(),'git-signals-gh-capture-'));
  try {
    const git=(args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'});
    git(['init','-q']);git(['config','user.name','Tester']);git(['config','user.email','tester@work']);
    writeFileSync(join(repo,'VERSION'),'1.0.0\n');git(['add','VERSION']);git(['commit','-q','-m','feat: first']);git(['tag','-a','v1.0.0','-m','release']);
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const source=html.match(/<code id="git-cmd">([^<]+)<\/code>/)?.[1];
    assert.ok(source,'command embedded in static HTML');
    const command=source.replaceAll('&gt;','>').replaceAll('&amp;','&').replace(/\s*\| pbcopy\s*$/, '');
    const sample=github('v1.0.0','tester-gh','2026-03-01T12:00:00Z');
    const shell=`git() { if [ "$1" = fetch ]; then return 0; fi; if [ "$1" = remote ] && [ "$2" = get-url ]; then printf 'git@github.com:example/repo.git\\n'; return 0; fi; command git "$@"; }
      gh() { if [ "$GH_REPO" != 'example/repo' ]; then return 12; fi; printf '%s\\n' "$GH_SAMPLE"; }
      ${command}`;
    const result=execFileSync('bash',['-c',shell],{cwd:repo,encoding:'utf8',env:{...process.env,GH_SAMPLE:Buffer.from(JSON.stringify(sample)).toString('base64')}});
    const parsed=parseGitHistory(result);
    assert.equal(parsed.githubStatus,'ok');
    assert.equal(parsed.githubReleases[0].publisher,'tester-gh');
    assert.equal(parsed.tags[0].taggerEmail,'tester@work');
    assert.equal(parsed.commits.length,1);
    const failed=execFileSync('bash',['-c',shell.replace(/gh\(\) \{[^}]+\}/, 'gh() { return 1; }')],{cwd:repo,encoding:'utf8'});
    const fall=parseGitHistory(failed);
    assert.equal(fall.githubStatus,'unavailable');
    assert.equal(fall.tags.length,1);
    assert.equal(fall.commits.length,1);
  } finally {rmSync(repo,{recursive:true,force:true});}
});

test('publication chronology never overrides Git ancestry when choosing the previous release',()=>{
  const releases=[
    github('v1.0.0','lin-gh','2026-04-15T09:00:00Z'),
    github('v1.0.1','casey-gh','2026-02-12T09:00:00Z'),
  ];
  const {i}=model(input(releases));
  const r=i.releases.find(x=>x.tag==='v1.0.1');
  assert.equal(r.previousTag,'v1.0.0');
  assert.equal(r.chronologyWarning,true);
  assert.equal(r.selectedFootprint.commits,1);
  assert.match(impactReleaseDetail(r,i.referenceLabel,i.metric),/Publication dates do not follow code ancestry/);
});

test('individual release profile reconciles yearly role counts and contextual metrics',()=>{
  const {i}=model(input([github('v1.0.1','casey-gh','2026-02-15T09:00:00Z')]),{'casey-gh':'casey@work'});
  const c=i.profiles.find(p=>p.name==='Casey');
  assert.equal(c.years.length,1);
  assert.equal(c.years[0].drivenOnly+c.years[0].contributedOnly+c.years[0].both,c.drivenOnly+c.contributedOnly+c.both);
  assert.equal(c.leadDays>=0,true);
  assert.equal(c.releaseMix.baseline,1);
  assert.equal(c.releaseMix.patch,1);
  assert.equal(c.medianCoordination,1);
  assert.match(impactIndividualProfiles(i,c.id),/Release involvement by year/);
  assert.match(impactIndividualProfiles(i,c.id),/Median non-negative elapsed time/);
});
