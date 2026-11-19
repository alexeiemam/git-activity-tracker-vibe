import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGitHistory,buildAnalysis,METRICS} from '../assets/domain.js';
import {impactAnalysis,applyReleaseMeasures} from '../assets/impact.js';

const at=day=>`2026-01-${String(day).padStart(2,'0')}T11:00:00+00:00`;
const row=(hash,email,day,parents,files)=>[`COMMIT|${hash}|${email}|${email}|${at(day)}|${at(day)}|change ${hash}|${parents}`,
  ...files.map(([a,d,path])=>`${a}\t${d}\t${path}`)].join('\n');
// Annotated tags record ada@work as tagger, i.e. the release lead.
const tag=(name,hash,day,tagger='')=>`TAG|${name}|${tagger?hash:''}|${hash}|${tagger?'tag':'commit'}|${at(day)}${tagger?`|${tagger}|${tagger}`:''}`;
const history=parseGitHistory([
  tag('v1.0.0','b000002',3,'ada@work'),
  tag('v1.1.0','c000003',6),
  tag('v1.1.1','c000003',6),
  row('a000001','ada@work',1,'',[[10,2,'app/a.ts']]),
  row('b000002','ben@work',2,'a000001',[[5,5,'app/b.ts']]),
  row('c000003','ben@work',5,'b000002',[[3,0,'app/c.ts']]),
  row('d000004','ada@work',8,'c000003',[[50,0,'app/unreleased.ts']]),
].join('\n'));
const GROUPS=[{displayName:'Ada',emails:['ada@work']},{displayName:'Ben',emails:['ben@work']}];

function model(scope={}) {
  const view=buildAnalysis(history.commits,GROUPS,{start:'2026-01-01',end:'2026-01-31',...scope});
  return applyReleaseMeasures(view,impactAnalysis(view,history.commits,history.tags));
}

test('release measures appear in the comparison lens as a separate delivery group', () => {
  for(const key of ['release_participation','release_leadership','released_churn'])
    assert.equal(METRICS[key].source,'releases');
  assert.equal(METRICS.release_participation.label,'Release participation');
  assert.equal(METRICS.release_leadership.label,'Release leadership');
  assert.equal(METRICS.released_churn.label,'Released churn');
});

test('participation and leadership count releases per person; shares are of releases in scope', () => {
  const view=model({metric:'release_participation'});
  const [ada,ben]=view.allContributors;
  const releases=view.referenceSummary.totals.release_participation;
  assert.ok(releases>=2);
  assert.equal(ada.totals.release_participation,1,'Ada only authored into the first release');
  assert.equal(ben.totals.release_participation,releases,'Ben authored into every release');
  assert.equal(ada.daily.release_participation['2026-01-03'],1,'dated by the release, not the commit');
  assert.equal(view.referenceTotal,releases);
  assert.equal(view.selectedSummary.totals.release_participation,releases,'team total counts distinct releases');
  assert.equal(ada.totals.release_leadership,1);
  assert.equal(ben.totals.release_leadership,0);
});

test('released churn counts shipped lines once, at the first release, and excludes unreleased work', () => {
  const view=model({metric:'released_churn'});
  const [ada,ben]=view.allContributors;
  assert.equal(ada.totals.released_churn,12,'50 unreleased lines are not shipped');
  assert.equal(ben.totals.released_churn,13,'a commit under two tags still counts once');
  assert.deepEqual(ben.daily.released_churn,{'2026-01-03':10,'2026-01-06':3});
  assert.equal(view.referenceTotal,25);
  assert.equal(ada.totals.churn,62,'authored churn is unchanged');
});

test('authored measures are unaffected and release measures respect the selection', () => {
  const view=model({selectedIds:new Set(['0'])});
  assert.equal(view.referenceTotal,view.referenceSummary.totals.commits);
  assert.equal(view.selectedSummary.totals.released_churn,12);
  assert.equal(view.selectedSummary.totals.release_participation,1);
});
