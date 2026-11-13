import {
  METRICS, DAY_NAMES, TIME_BANDS, buildAnalysis, getDateBounds, pulseDayDetails, workingRhythm, mondayOf, dayNumber, dateAtDay,
  periodForPreset, seriesForAnalysis, moveContributorIdentities,
  valueInMode, displayModeLabel, sum, seasonalityAnalysis, seasonalMonthValue,
  parseGitHistory, getHistoryDateBounds, withWeekAggregation,
} from './domain.js?v=git-ingest-input-20261113-1';
import { generateDemoLog } from './demo-data.js?v=git-ingest-input-20261113-1';
import { impactAnalysis, IMPACT_METRICS } from './impact.js?v=git-ingest-input-20261113-1';
import { releaseGapMatrix, DEFAULT_GAP_HORIZON, DEFAULT_BUSY_DAY, DEFAULT_RELEASE_LINES, GAP_HORIZONS, BUSY_DAY_THRESHOLDS, RELEASE_LINE_THRESHOLDS, DAILY_CHURN_THRESHOLDS, DEFAULT_DAILY_CHURN, ATTENTION_THRESHOLD } from './release-gap.js?v=git-ingest-input-20261113-1';
import { momentumMatrix, DEFAULT_MOMENTUM_WINDOW, MOMENTUM_WINDOWS, MOMENTUM_DIRECTION_THRESHOLD } from './momentum.js?v=git-ingest-input-20261113-1';
import { contributionLevelMatrix, DEFAULT_LEVEL_WINDOW, LEVEL_WINDOWS } from './contribution-level.js?v=git-ingest-input-20261113-1';
import { velocityStyle,velocityCellText,velocityLegend } from './absolute-velocity.js?v=git-ingest-input-20261113-1';
import { releaseScorecard } from './release-scorecard.js?v=git-ingest-input-20261113-1';
import { signatureMatrix, SIGNATURE_MODES, DEFAULT_SIGNATURE_MODE } from './contribution-signature.js?v=git-ingest-input-20261113-1';
import { renderContributionSignature, renderSignatureLegend, renderSignatureSummary, renderSignatureQuadrant, bindSignatureQuadrant } from './contribution-signature-view.js?v=git-ingest-input-20261113-1';
import { continuityMatrix, continuityReleaseColour, CONTINUITY_WINDOWS, DEFAULT_CONTINUITY_WINDOW } from './continuity.js?v=git-ingest-input-20261113-1';
import {WEEKDAY_LABELS,normalizeWorkingDays,workingPatternLabel,missingDayColour,extraDayColour} from './working-patterns.js?v=git-ingest-input-20261113-1';
import { TEMPORAL_PERIODS, TEMPORAL_PERIOD_DEFAULT, TEMPORAL_CHURN_CAPS, TEMPORAL_CHURN_DEFAULT, MEANINGFUL_CHURN_THRESHOLDS, MEANINGFUL_CHURN_DEFAULT, MAX_GAP_DISTRIBUTION_RELIEF, temporalActivitySummary, temporalDay, emptyTemporalDay } from './temporal-activity.js?v=git-ingest-input-20261113-1';
import { impactSelectMessage, impactSummary, impactTimeline, impactReleasePicker, impactReleaseDetail, impactReleaseMatrix, impactMatrixWindow, impactMatrixPageForRelease, impactReleaseMatrixCsv, impactReach, impactDurability, impactGithubStatus, impactIndividualProfiles } from './impact-view.js?v=git-ingest-input-20261113-1';
import { impactTimelineWindow, impactTimelineZoom, impactTimelineReveal, impactTimelineCustomRange, impactTimelinePan, impactReleasePosition } from './impact-window.js?v=git-ingest-input-20261113-1';
import { makeIntensityScale, intensityColour, intensityStyle, intensityLegend } from './value-colour.js?v=git-ingest-input-20261113-1';
import { buildStoryAnalysis } from './stories.js?v=git-ingest-input-20261113-1';
import { renderStoryExplorer, storyCopyText } from './story-view.js?v=git-ingest-input-20261113-1';
import { buildEvidenceIndex, windowOf } from './perspectives.js?v=git-ingest-input-20261113-1';
import { renderPrimaryExplorer, periodBriefingForUi } from './perspective-view.js?v=git-ingest-input-20261113-1';
import { primaryDefaults, restorePrimaryState, primaryStateForExport } from './perspective-state.js?v=git-ingest-input-20261113-1';
import { downloadFilename } from './download-names.js?v=git-ingest-input-20261113-1';
import { encodeSessionArchive, decodeSessionArchive } from './session-archive.js?v=git-ingest-input-20261113-1';
import { buildDeploymentIndex } from './deployments.js?v=git-ingest-input-20261113-1';
import { externalIdentities, reconcileProviderGroups, extendContributorGroups } from './external-identities.js?v=git-ingest-input-20261113-1';
import { mergeGitHistories, isCompleteRecapture, compactAdditionalCapture, hasImportableEvidence } from './history-merge.js?v=git-ingest-input-20261113-1';
import { reorderContributors, reorderLinkedIdentity, rebaseContributorId, contributorColourIndex, contributorKey } from './identity-order.js?v=git-ingest-input-20261113-1';
import { readRoute, routeFromState, applyRoute, routeUrl, targetUrl } from './route-state.js?v=git-ingest-input-20261113-1';
import { saveLocalHistory, readLocalHistory, deleteLocalHistory } from './local-history.js?v=git-ingest-input-20261113-1';
import { buildMotionScenes, MOTION_WINDOWS, MOTION_STEPS, MOTION_TRAILS, MOTION_LABELS, MOTION_MODES, DEFAULT_MOTION_VIEWS } from './motion-explorer.js?v=git-ingest-input-20261113-1';
import { renderMotionExplorer, bindMotionExplorer } from './motion-view.js?v=git-ingest-input-20261113-1';

const COLORS = ['#13735a','#dd7853','#5379ba','#9170ac','#b88b3c','#3f9a9a','#c66887','#687e41','#c07648','#5376a0','#8c5c79','#508e65'];
// The analysis worker owns the expensive import and release-DAG calculations.
// Main-thread fallback keeps local/file deployments usable if module workers
// are unavailable; it is not the normal path for sizeable histories.
let analysisWorker = null, workerSerial = 0, workerFaulted = false;
const workerJobs = new Map();
let renderGeneration = 0, progressGeneration = 0, progressTimer = null;
let computedKey = null, computedResult = null, importRevision = 0;
let sessionTransferBusy = false, appendBusy = false;
let parsedHistory = null, activeRawLog = ''; // Canonical imported text, independent of editable replacement field.
let scopeFollowsLatest = true;

function createAnalysisWorker() {
  if (workerFaulted || typeof Worker === 'undefined') return null;
  if (analysisWorker) return analysisWorker;
  try {
    analysisWorker = new Worker(new URL('./analysis-worker.js?v=git-ingest-input-20261113-1', import.meta.url), {type:'module'});
    analysisWorker.onmessage = ({data}) => {
      const job = workerJobs.get(data.id);
      if (!job) return;
      if (data.type === 'progress') return job.progress?.(data);
      workerJobs.delete(data.id);
      if (data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data.result);
    };
    analysisWorker.onerror = event => {
      console.warn('Git analysis worker unavailable; using fallback', event.message);
      workerFaulted = true;
      analysisWorker?.terminate(); analysisWorker = null;
      for (const [,job] of workerJobs) job.reject(new Error('Analysis worker unavailable'));
      workerJobs.clear();
    };
    return analysisWorker;
  } catch (error) {
    console.warn('Git analysis worker unavailable; using fallback',error);
    workerFaulted = true;
    return null;
  }
}
function askWorker(type, payload, progress) {
  const worker = createAnalysisWorker();
  if (!worker) return null;
  return new Promise((resolve,reject) => {
    const id = ++workerSerial;
    workerJobs.set(id,{resolve,reject,progress});
    try { worker.postMessage({id,type,...payload}); }
    catch (error) {workerJobs.delete(id);reject(error);}
  });
}
function showProgress(phase, value=0, message='', generation=progressGeneration) {
  if (generation !== progressGeneration) return;
  clearTimeout(progressTimer);
  const root=document.getElementById('work-progress');
  root.hidden=false;
  root.classList.remove('is-complete','is-error');
  document.getElementById('work-phase').textContent=phase;
  document.getElementById('work-detail').textContent=message;
  document.getElementById('work-progress-value').value=Math.max(0,Math.min(100,value));
  document.getElementById('work-percent').textContent=`${Math.round(value)}%`;
}
function finishProgress(generation, error=null, successTitle='Dashboard ready', successDetail='All views use the same filtered evidence.') {
  if (generation !== progressGeneration) return;
  const root=document.getElementById('work-progress');
  root.classList.add(error?'is-error':'is-complete');
  document.getElementById('work-phase').textContent=error?'Analysis failed':successTitle;
  document.getElementById('work-detail').textContent=error?.message||successDetail;
  document.getElementById('work-percent').textContent=error?'!':'100%';
  document.getElementById('work-progress-value').value=error?0:100;
  if (!error) progressTimer=setTimeout(()=>{if(generation===progressGeneration)root.hidden=true;},1800);
}
const yieldToUI = () => new Promise(resolve => setTimeout(resolve,0));
async function processImportedHistory(raw, generation) {
  const request=askWorker('parse',{raw},data=>showProgress(data.phase,Math.round(data.value*.9),data.message,generation));
  if (request) {
    try {return await request;} catch (error) {
      if (!workerFaulted) throw error; // A malformed import is not a worker failure.
    }
  }
  showProgress('Reading history',8,'Using compatibility processing on this browser',generation);
  await yieldToUI();
  return parseGitHistory(raw);
}
function analysisScope() {
  return {selectedIds:new Set(state.selectedIds),start:state.start,end:state.end,
    includeMerges:state.includeMerges,includeReverts:state.includeReverts,
    metric:state.metric,denominator:state.denominator};
}
function analysisCacheKey(scope,groups,impactOptions) {
  return JSON.stringify([importRevision,groups, [...scope.selectedIds].sort(),scope.start,scope.end,
    scope.includeMerges,scope.includeReverts,scope.metric,scope.denominator,
    impactOptions.metric, impactOptions.actorMap]);
}
async function computeViewAndImpact(groups,scope,impactOptions,generation) {
  const key=analysisCacheKey(scope,groups,impactOptions);
  if (computedKey===key && computedResult) return computedResult;
  const request=askWorker('build',{groups,scope,impactOptions},data=>{
    showProgress(data.phase,12+Math.round(data.value*.64),data.message,generation);
  });
  let result;
  if (request) {
    try {result=await request;} catch(error) {
      if (!workerFaulted) throw error;
    }
  }
  if (!result) {
    showProgress('Building comparisons',17,'Using compatibility processing on this browser',generation);
    await yieldToUI();
    const view=buildAnalysis(rawCommits,groups,scope);
    showProgress('Reconstructing releases',32,'Calculating tagged-release evidence',generation);
    await yieldToUI();
    const impact=impactAnalysis(view,rawCommits,rawTags,{...impactOptions,githubReleases:rawGithubReleases});
    const stories=buildStoryAnalysis(view,impact);
    const bounds=sourceDateBounds();
    const fullView=buildAnalysis(rawCommits,groups,{
      start:bounds.min,end:bounds.max,selectedIds:new Set(groups.map((_,i)=>String(i))),
      includeMerges:scope.includeMerges,includeReverts:scope.includeReverts,
      metric:'commits',denominator:'repository',
    });
    const fullImpact=impactAnalysis(fullView,rawCommits,rawTags,{
      ...impactOptions,githubReleases:rawGithubReleases,metric:'commits',skipFollowup:true,
    });
    const primaryIndex=buildEvidenceIndex(fullView,fullImpact,bounds);
    primaryIndex.deployments=buildDeploymentIndex(rawHerokuReleases,rawCommits,primaryIndex,herokuStatus);
    primaryIndex.historyEnrichment=rawHistoryEnrichment;
    result={view,impact,stories,primaryIndex};
  }
  withWeekAggregation(result.view);
  if (generation===progressGeneration) {computedKey=key;computedResult=result;}
  return result;
}

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const percent = n => `${Math.abs(n) > 0 && Math.abs(n) < .01 ? Number(n.toPrecision(2)) : decimal.format(n)}%`;
const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const color = id => COLORS[mergeGroups[Number(id)] ? contributorColourIndex(mergeGroups[Number(id)], COLORS.length) : (Number(id) || 0) % COLORS.length];
const style = id => `--person:${color(id)}`;
const empty = (msg) => `<div class="empty-state">${esc(msg)}</div>`;
const formatDate = d => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }) : '—';
const metricValue = (c, key) => c?.totals[key] || 0;

let rawCommits = [];
let rawTags = [];
let rawGithubReleases = [];
let githubStatus = 'not-captured';
let githubWarnings = [];
let rawHerokuReleases = [];
let herokuStatus = {};
let impactModel = null;
let storyModel = null;
let perspectiveIndex = null;
let evidenceRenderedRun = -1, evidenceRenderPromise = null;
// Tag events may be later than the newest authored commit. The shared
// window includes their dates, while all contributor counts remain author-based.
const sourceDateBounds=()=>getHistoryDateBounds(rawCommits,rawTags,rawGithubReleases,rawHerokuReleases);
let mergeGroups = [];
let identityMeta = new Map();
let identityPicker = null; // { targetIndex, selected: Set, query } — staged until Apply
let mergeUndo = null;
const linkedOrderEditors = new Set();
let analysis = null;
let pendingImport = null;
let rawHistoryEnrichment=[];
let tableRows = [];
const defaultMotionState = () => ({motionViews:{...DEFAULT_MOTION_VIEWS},motionWeeks:8,motionStep:1,motionTrail:'short',motionLabels:'hover',motionLevelDisplay:'strip',motionFrameIndex:-1,motionSelectedId:null});
const state = {
  ...defaultMotionState(),
  selectedIds: new Set(), search: '',
  period: 'all', start: null, end: null,
  includeMerges: false, includeReverts: true,
  metric: 'commits', mode: 'total', denominator: 'repository',
  trend: 'rolling', pulseMode: 'monthly', pulseLens:'activity',continuityView:DEFAULT_SIGNATURE_MODE, pulseGapHorizon:DEFAULT_GAP_HORIZON, pulseBusyDay:DEFAULT_BUSY_DAY, pulseReleaseLines:DEFAULT_RELEASE_LINES, pulseDailyChurn:DEFAULT_DAILY_CHURN, pulseMomentumWorkdays:DEFAULT_MOMENTUM_WINDOW,pulseLevelWorkdays:DEFAULT_LEVEL_WINDOW,pulseContinuityWeeks:DEFAULT_CONTINUITY_WINDOW, pulseTemporalPeriod:TEMPORAL_PERIOD_DEFAULT,pulseTemporalChurn:TEMPORAL_CHURN_DEFAULT,pulseMeaningfulLines:MEANINGFUL_CHURN_DEFAULT, rhythmFocus: 'selection', rhythmDisplay: 'heatmap',
  rhythmTab: 'weekly', seasonMode: 'rate', seasonYears: null, sortKey: 'lens', sortDesc: true,
  impactTab:'timeline',impactMetric:'commits',impactAreaMode:'touches',impactReleaseHash:null,impactShowAll:false,impactMatrixMode:'all',impactMatrixPage:0,impactMatrixYear:'all',impactMatrixSize:18,
  impactTimelineMode:'all',impactTimelineFrom:null,impactTimelineTo:null,
  impactFocus:'selection', impactActorMap:{},
  viewMode:'observatory', storyPerspective:'team', storyFocus:'selection', storyTopic:'all', storyCategory:'noteworthy',
  storyShowAll:false, storyFindingId:null, storyMonth:null, storyDismissed:new Set(),storyTrail:[],
  storyPairA:null,storyPairB:null,
};

let primary=primaryDefaults();
let localDatasetId=null, routePushPending=false, routeRestoring=false;
const routePath=()=>window.location.pathname||'./index.html';
function currentRouteHref(){
  const mode=state.viewMode==='evidence'?'evidence':primary.mode;
  return routeUrl(routePath(),routeFromState({...primary,mode},mergeGroups.map((g,i)=>({...g,id:String(i)})),localDatasetId));
}
function syncBrowserRoute(){
  if(!perspectiveIndex||routeRestoring)return;
  const href=currentRouteHref();
  if(href!==window.location.pathname+window.location.search){
    const method=routePushPending?'pushState':'replaceState';
    window.history[method]({gitSignals:true},'',href);
  }
  routePushPending=false;
}
function applyBrowserRoute(){
  if(!perspectiveIndex)return;
  const query=readRoute(new URL(window.location.href));routePushPending=false;
  const groups=mergeGroups.map((g,i)=>({...g,id:String(i)}));
  primary=applyRoute(primary,query,groups);
  state.viewMode=primary.mode;
  routeRestoring=true;
  setExperienceVisibility();renderPrimary();
  routeRestoring=false;
}
function historyNotice(message){
  const root=$('local-link-status');if(root)root.textContent=message;
  if($('dashboard')?.hidden&&$('parse-error'))$('parse-error').textContent=message;
}
async function enableLocalLinks(){
  if(!rawCommits.length){historyNotice('Import history and build the dashboard first.');return;}
  const key=localDatasetId||crypto.randomUUID();
  try {
    await saveLocalHistory(key,sessionPayload());localDatasetId=key;
    syncBrowserRoute();renderPrimary();setExperienceVisibility();
    historyNotice('Saved only in this browser for 30 days. Links can now reopen in other tabs.');
  }catch(error){historyNotice(`Local saving failed: ${error.message}. Current-tab history still works.`);}
}
async function forgetLocalLinks(){
  if(localDatasetId)await deleteLocalHistory(localDatasetId).catch(()=>{});
  localDatasetId=null;syncBrowserRoute();renderPrimary();setExperienceVisibility();
  historyNotice('Browser-local copy cleared. Saved links will require an imported session.');
}
async function restoreFromLocalLink(){
  const id=readRoute(new URL(window.location.href)).dataset;
  if(!id)return;
  try{
    const payload=await readLocalHistory(id);
    if(!payload){
      $('dashboard').hidden=true;$('source-details').open=true;
      historyNotice('This link needs its original imported session, which is not available locally. Import the matching session JSON.');return;
    }
    localDatasetId=id;
    await restoreSessionPayload(payload,'saved browser history');
    historyNotice('Reopened your locally saved history. Nothing was fetched from a server.');
  }catch(error){historyNotice(`Could not reopen saved history: ${error.message}. Import a session file instead.`);}
}
function restorePrimary(scope){ primary=restorePrimaryState(scope,mergeGroups); }

function initialisePrimary(){
  if(!perspectiveIndex)return;
  if(!primary.periodFrom||!primary.periodTo){
    const window=windowOf(perspectiveIndex,14);primary.periodFrom=window.from;primary.periodTo=window.to;
  }
  const groups=perspectiveIndex.groups;
  if(!groups.some(g=>g.id===primary.contributorFocus))primary.contributorFocus=groups[0]?.id??null;
  if(primary.compareB && !groups.some(g=>g.id===primary.compareB))primary.compareB=null;
  if(primary.compareC && !groups.some(g=>g.id===primary.compareC))primary.compareC=null;
  if(primary.coReleasePartner && (!groups.some(g=>g.id===primary.coReleasePartner)||primary.coReleasePartner===primary.contributorFocus))primary.coReleasePartner=null;
  if(!perspectiveIndex.releases.some(r=>r.hash===primary.releaseHash))
    primary.releaseHash=perspectiveIndex.releases.at(-1)?.hash||null;
}
function renderPrimary(){
  if(!perspectiveIndex)return;
  initialisePrimary();
  primary.mode=state.viewMode==='evidence'?primary.mode:state.viewMode;
  perspectiveIndex.navigation={ui:primary,groups:mergeGroups.map((g,i)=>({...g,id:String(i)})),datasetId:localDatasetId,path:routePath()};
  $('stories-view').innerHTML=renderPrimaryExplorer(perspectiveIndex,primary);
  syncBrowserRoute();
}
function primarySnapshot(){
  const {trail,...snapshot}=primary;
  return {...snapshot,label:({observatory:'Observatory',periods:'Periods',contributors:'Contributors',codebase:'Codebase',deployments:'Deployments'})[primary.mode]};
}

function goPrimary(mode,change={}, {remember=true,scroll=true}={}){
  if(!['observatory','periods','contributors','codebase','deployments'].includes(mode))return;
  if(remember && (mode!==primary.mode||Object.keys(change).length))primary.trail=[...primary.trail,primarySnapshot()].slice(-8);
  Object.assign(primary,change,{mode});state.viewMode=mode;
  routePushPending=true;setExperienceVisibility();renderPrimary();
  if(scroll)$('stories-view').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetPrimaryOnLoad(){
  restorePrimary(pendingImport?.scope);
  if(pendingImport?.scope?.primary && state.viewMode!=='evidence')state.viewMode=primary.mode;
  // A permalink takes precedence over the imported session's last-view preference.
  if(new URL(window.location.href).searchParams.has('view')){
    const groups=mergeGroups.map((g,i)=>({...g,id:String(i)}));
    primary=applyRoute(primary,readRoute(new URL(window.location.href)),groups);
    state.viewMode=primary.mode;
  }
}

function setText(id, content) { $(id).textContent = content; }
// The capture command is static HTML, so it remains visible even if a
// previously cached JavaScript module fails before it can initialise the UI.
// The lookback selector affects only the dashboard's initial author-date scope.
function copyCommand() {
  if (!navigator.clipboard) return setText('parse-error', 'Clipboard unavailable. Select and copy the command manually.');
  navigator.clipboard.writeText($('git-cmd').textContent)
    .then(() => { setText('parse-error', 'Command copied.'); })
    .catch(() => setText('parse-error', 'Clipboard blocked. Select and copy the command manually.'));
}

// ---- Identity reconciliation: email is the durable identity key. ----
function makeIdentityCatalogue(commits,github=[],heroku=[]) {
  const catalogue = new Map();
  for (const commit of commits) {
    if (!catalogue.has(commit.email)) catalogue.set(commit.email, {
      nameCounts: new Map(), commits: 0, date: commit.date,
    });
    const item = catalogue.get(commit.email);
    item.commits++;
    item.nameCounts.set(commit.name, (item.nameCounts.get(commit.name) || 0) + 1);
    if (commit.date > item.date) item.date = commit.date;
  }
  const authors=new Map([...catalogue].map(([email, item]) => {
    const best = [...item.nameCounts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || email;
    return [email, { name: best, aliases: [...item.nameCounts.keys()], commits: item.commits, date: item.date,kind:'Git author' }];
  }));
  for(const [key,entry] of externalIdentities(github,heroku))authors.set(key,entry);
  return authors;
}
function makeMergeSuggestions() {
  const byName = new Map();
  for (const [email, meta] of identityMeta) {
    const key = meta.name.trim().toLocaleLowerCase();
    if (!byName.has(key)) byName.set(key, { displayName: meta.name, emails: [] });
    byName.get(key).emails.push(email);
  }
  const git=[...byName.values()].filter(group=>group.emails.some(email=>!email.startsWith('github:')&&!email.startsWith('heroku:')));
  return reconcileProviderGroups(git,externalIdentities(rawGithubReleases,rawHerokuReleases),rawGithubReleases,rawCommits)
    .sort((a,b)=>a.displayName.localeCompare(b.displayName));
}
function mergeCandidates(index, query = '') {
  const text = query.trim().toLocaleLowerCase();
  return mergeGroups.flatMap((g, i) => i === index ? [] : [{ index: i, group: g,
    emails: g.emails.filter(email => {
      const meta = identityMeta.get(email);
      return !text || [email, g.displayName, meta?.name, ...(meta?.aliases || [])]
        .some(value => String(value || '').toLocaleLowerCase().includes(text));
    }),
  }]).filter(entry => entry.emails.length);
}
function countWord(n, singular, plural = `${singular}s`) { return `${number.format(n)} ${n === 1 ? singular : plural}`; }
function renderMergeFeedback(message = '', canUndo = false) {
  const el = $('merge-feedback');
  el.hidden = !message;
  el.innerHTML = message ? `<span>${esc(message)}</span>${canUndo ? '<button type="button" data-action="undo-identity-merge" class="text-button">Undo merge</button>' : ''}` : '';
}
function forgetUndo() {
  mergeUndo = null;
  renderMergeFeedback();
}
function identityRows(index) {
  const picker = identityPicker;
  const groups = mergeCandidates(index, picker.query);
  if (!groups.length) return '<div class="identity-picker-empty">No matching identities. Try a name or email address.</div>';
  return groups.map(({group, emails}) => `<div class="identity-source" role="group" aria-label="Identities currently under ${esc(group.displayName)}">
    <div class="identity-source-head"><span>${esc(group.displayName)}</span><span>${countWord(emails.length, 'identity', 'identities')}</span></div>
    ${emails.map(email => {
      const meta = identityMeta.get(email);
      const checked = picker.selected.has(email);
      return `<label class="identity-option ${checked ? 'is-selected' : ''}">
        <input type="checkbox" data-identity-email="${esc(email)}" ${checked ? 'checked' : ''}>
        <span class="identity-option-text"><strong>${esc(meta?.name || group.displayName)}</strong><small title="${esc(email)}">${esc(email)}</small></span>
        <span class="identity-option-count">${meta?.kind==='Git author'?countWord(meta.commits,'commit'):countWord(meta?.events||0,'event')}</span>
      </label>`;
    }).join('')}
  </div>`).join('');
}
function renderIdentityPicker(index) {
  const all = mergeCandidates(index).flatMap(g => g.emails).length;
  return `<div id="identity-picker-${index}" class="identity-picker" aria-label="Add identities to ${esc(mergeGroups[index].displayName)}">
    <div class="identity-picker-heading"><div><span class="eyebrow">RECONCILE IDENTITIES</span><h3>Add multiple identities</h3><p>Select Git author emails, GitHub publishers or Heroku release actors. Only checked identities will move.</p></div><button type="button" class="identity-picker-close" data-action="cancel-identity-picker" aria-label="Close identity picker">×</button></div>
    <label for="identity-search-${index}" class="identity-search-label">FIND IDENTITIES <span>${number.format(all)} available</span></label>
    <input id="identity-search-${index}" class="identity-search" type="search" data-identity-search placeholder="Search contributor or email…" autocomplete="off" spellcheck="false">
    <div class="identity-picker-utilities"><span id="identity-visible-${index}" class="helper">${countWord(all, 'identity', 'identities')} shown</span><div><button type="button" class="text-button" data-action="select-visible-identities">Select shown</button><button type="button" class="text-button" data-action="clear-identity-selection">Clear selection</button></div></div>
    <div class="identity-option-list" id="identity-list-${index}" role="group" aria-label="Available Git and provider identities">${identityRows(index)}</div>
    <div class="identity-picker-bottom"><div class="identity-picker-recap" id="identity-recap-${index}" role="status" aria-live="polite"></div><div class="identity-picker-buttons"><button type="button" class="button outline" data-action="cancel-identity-picker">Cancel</button><button type="button" class="button primary" id="identity-apply-${index}" data-action="apply-identity-picker" disabled>Move selected identities</button></div></div>
  </div>`;
}
function linkedOrderRows(group, index) {
  return `<div class="linked-order-panel" role="group" aria-label="Linked identity order for ${esc(group.displayName)}">
    <p class="linked-order-note">These are already the same contributor. Rearranging them does not change attribution or which releases they contributed to.</p>
    <ol class="linked-order-list">${group.emails.map((email, position) => {
      const meta = identityMeta.get(email);
      return `<li class="linked-order-row" data-linked-email="${esc(email)}">
        <span class="linked-order-rank">${position + 1}</span>
        <div class="linked-order-info"><strong>${esc(meta?.name || group.displayName)}</strong><span>${esc(meta?.kind || 'Git author')} · ${esc(email)}</span></div>
        <div class="linked-order-actions">
          <button type="button" class="order-button" data-action="move-linked-identity" data-group="${index}" data-position="${position}" data-step="-1" ${position === 0 ? 'disabled' : ''} aria-label="Move ${esc(email)} earlier" title="Move earlier">↑</button>
          <button type="button" class="order-button" data-action="move-linked-identity" data-group="${index}" data-position="${position}" data-step="1" ${position === group.emails.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(email)} later" title="Move later">↓</button>
        </div>
      </li>`;
    }).join('')}</ol>
  </div>`;
}
const WORKDAY_ORDER=[1,2,3,4,5,6,0];
function patternControls(group,index) {
  const days=normalizeWorkingDays(group.workingDays);
  return `<div class="pattern-controls" role="group" aria-label="Expected contribution weekdays for ${esc(group.displayName)}">
    <div class="pattern-weekdays">${WORKDAY_ORDER.map(day=>`<button type="button" class="pattern-day ${days.includes(day)?'is-scheduled':''}" data-action="toggle-pattern-day" data-group="${index}" data-weekday="${day}" aria-pressed="${days.includes(day)}" title="${esc(WEEKDAY_LABELS[day])}: ${days.includes(day)?'expected':'not scheduled'}">${WEEKDAY_LABELS[day]}</button>`).join('')}</div>
    <div class="pattern-presets"><button type="button" class="text-button" data-action="pattern-preset" data-group="${index}" data-pattern="four">Mon–Thu</button><button type="button" class="text-button" data-action="pattern-preset" data-group="${index}" data-pattern="five">Mon–Fri</button><button type="button" class="text-button" data-action="pattern-preset" data-group="${index}" data-pattern="none">None</button></div>
  </div>`;
}
function renderWorkingPatterns(view) {
  const editor=$('continuity-pattern-editor');
  if(!editor)return;
  const shown=new Set((view?.contributors||[]).map(c=>String(c.id)));
  const rows=mergeGroups.map((group,index)=>({group,index})).filter(({index})=>shown.has(String(index)));
  editor.innerHTML=rows.length?rows.map(({group,index})=>`<div class="continuity-pattern-row"><div><strong>${esc(group.displayName)}</strong><small>${esc(workingPatternLabel(group.workingDays))}</small></div>${patternControls(group,index)}</div>`).join(''):'<p>Select a contributor in the filters to set a working-day pattern.</p>';
}
function updateWorkingPattern(index,workingDays,origin) {
  const group=mergeGroups[index];if(!group)return;
  group.workingDays=normalizeWorkingDays(workingDays);
  if(mergeUndo)forgetUndo();
  const expandedMerge=origin?.closest('.merge-working-pattern')?.open===true;
  if(!$('merge-step').hidden){
    renderMergeUI();
    if(expandedMerge){const details=document.querySelector(`[data-merge-card="${index}"] .merge-working-pattern`);if(details)details.open=true;}
  }
  if(analysis&&state.pulseLens==='continuity')renderPulse(analysis);
  const selector=origin?.dataset.weekday!==undefined?`[data-action="toggle-pattern-day"][data-group="${index}"][data-weekday="${origin.dataset.weekday}"]`:
    `[data-action="pattern-preset"][data-group="${index}"][data-pattern="${origin?.dataset.pattern||''}"]`;
  // Re-rendering does not discard focus or force a full evidence rebuild.
  const controls=[...document.querySelectorAll(selector)];
  controls.find(el=>el.closest('#continuity-pattern-editor'))?.focus({preventScroll:true})||controls[0]?.focus({preventScroll:true});
}
function renderMergeUI() {
  $('merge-groups').innerHTML = mergeGroups.map((group, index) => {
    const open = identityPicker?.targetIndex === index;
    const available = mergeGroups.some((g, i) => i !== index && g.emails.length);
    const groupCommits = sum(group.emails.map(email => identityMeta.get(email)?.commits || 0));
    const orderOpen = linkedOrderEditors.has(contributorKey(group));
    const groupName = esc(group.displayName);
    return `<article class="merge-group ${open ? 'merge-group-open' : ''}" data-merge-card="${index}">
      <div class="merge-group-order-bar">
        <span class="merge-order-label"><span class="merge-order-position">${index + 1} / ${mergeGroups.length}</span><span>Contributor order</span></span>
        <div class="merge-order-buttons" role="group" aria-label="Reorder ${groupName}">
          <button type="button" class="order-button" data-action="move-contributor" data-group="${index}" data-position="0" ${index === 0 ? 'disabled' : ''} aria-label="Move ${groupName} to first" title="Move to first">⇤</button>
          <button type="button" class="order-button" data-action="move-contributor" data-group="${index}" data-position="${index - 1}" ${index === 0 ? 'disabled' : ''} aria-label="Move ${groupName} up" title="Move up">↑</button>
          <button type="button" class="order-button" data-action="move-contributor" data-group="${index}" data-position="${index + 1}" ${index === mergeGroups.length - 1 ? 'disabled' : ''} aria-label="Move ${groupName} down" title="Move down">↓</button>
          <button type="button" class="order-button" data-action="move-contributor" data-group="${index}" data-position="${mergeGroups.length - 1}" ${index === mergeGroups.length - 1 ? 'disabled' : ''} aria-label="Move ${groupName} to last" title="Move to last">⇥</button>
        </div>
      </div>
      <div class="merge-group-main">
        <div class="merge-group-name"><label for="merge-name-${index}">CONTRIBUTOR NAME</label><input id="merge-name-${index}" data-merge-name="${index}" value="${groupName}" placeholder="Name this contributor" maxlength="160"><p class="merge-group-caption">${countWord(groupCommits, 'authored commit')} in imported history</p></div>
        <div class="merge-group-identities"><div class="merge-identity-heading"><span>LINKED IDENTITIES</span><span class="merge-identity-total">${countWord(group.emails.length, 'identity', 'identities')}</span></div>
          <div class="identity-chips">${group.emails.length ? group.emails.map(email => `<span class="chip"><span title="${esc(email)}">${esc(identityMeta.get(email)?.kind||'Git author')} · ${esc(identityMeta.get(email)?.name||email)}</span>${group.emails.length > 1 ? `<button type="button" data-action="split-email" data-group="${index}" data-email="${esc(email)}" aria-label="Separate ${esc(email)} from ${groupName}" title="Separate this identity">×</button>` : ''}</span>`).join('') : '<span class="merge-group-caption">No identities yet. Select author emails to build this contributor.</span>'}</div>
          <div class="merge-add"><button type="button" class="merge-add-trigger" data-action="toggle-identity-picker" data-group="${index}" aria-expanded="${open}" ${open ? `aria-controls="identity-picker-${index}"` : ''} ${!available ? 'disabled title="No other identities available"' : ''}><span class="merge-plus" aria-hidden="true">${open ? '−' : '+'}</span>${open ? 'Close selector' : 'Add identities'}<span class="merge-plus-chevron" aria-hidden="true">${open ? '⌃' : '⌄'}</span></button>${group.emails.length > 1 ? `<button type="button" class="mini-button identity-arrange-toggle" data-action="toggle-linked-order" data-group="${index}" aria-expanded="${orderOpen}" ${orderOpen ? `aria-controls="linked-order-${index}"` : ''}>${orderOpen ? 'Close ordering' : 'Arrange linked identities'}</button><button class="mini-button" type="button" data-action="split-group" data-group="${index}">Separate all</button>` : ''}</div>
          ${orderOpen && group.emails.length > 1 ? `<div id="linked-order-${index}">${linkedOrderRows(group,index)}</div>` : ''}
          <details class="merge-working-pattern"><summary>Expected contribution days · ${normalizeWorkingDays(group.workingDays).length}/week</summary><p class="merge-group-caption">Choose the weekly reference used by Contribution Continuity. Unscheduled dates can still earn extra credit.</p>${patternControls(group,index)}</details>
        </div>
      </div>
      ${open ? renderIdentityPicker(index) : ''}
    </article>`;
  }).join('');
  if (identityPicker) updateIdentityPickerSummary();
}

/** Changing the cards' order also changes their numeric UI IDs. Rebase every
 * focused/selected contributor by a stable linked identity, not by position. */
function rebaseContributorViews(before, after) {
  const rebase = id => rebaseContributorId(id, before, after);
  state.selectedIds = new Set([...state.selectedIds].map(rebase).filter(id => id !== null));
  for (const key of ['rhythmFocus','impactFocus','storyFocus','storyPairA','storyPairB']) state[key] = rebase(state[key]);
  const keys = ['contributorFocus','compareB','compareC','coReleasePartner','periodSelectedId','periodFocusPerson'];
  for (const key of keys) primary[key] = rebase(primary[key]);
  for (const snapshot of primary.trail || []) for (const key of keys) if (Object.hasOwn(snapshot,key)) snapshot[key] = rebase(snapshot[key]);
}
function moveContributorCard(index, position) {
  if (requireResolvedIdentitySelection()) return;
  const before = mergeGroups;
  const after = reorderContributors(before, index, position);
  if (after === before) return;
  forgetUndo();
  identityPicker = null; // Its index would otherwise point to a different card.
  rebaseContributorViews(before, after);
  mergeGroups = after;
  renderMergeUI();
  const card = $('merge-groups').querySelector(`[data-merge-card="${position}"]`);
  card?.querySelector('[data-action="move-contributor"]:not([disabled])')?.focus({preventScroll:true});
  renderMergeFeedback(`${mergeGroups[position].displayName} moved to position ${position+1}. Use Build dashboard to apply the updated order.`);
}
function toggleLinkedOrder(index) {
  if (requireResolvedIdentitySelection()) return;
  const group = mergeGroups[index];
  if (!group || group.emails.length < 2) return;
  const key = contributorKey(group);
  if (linkedOrderEditors.has(key)) linkedOrderEditors.delete(key);
  else linkedOrderEditors.add(key);
  renderMergeUI();
  $('merge-groups').querySelector(`[data-action="toggle-linked-order"][data-group="${index}"]`)?.focus({preventScroll:true});
}
function moveLinkedIdentity(index, position, step) {
  if (requireResolvedIdentitySelection()) return;
  const before = mergeGroups;
  const group = before[index];
  const email = group?.emails[position];
  const after = reorderLinkedIdentity(before,index,position,position+step);
  if (after === before) return;
  forgetUndo();
  identityPicker = null; // Rebuilding this panel must not reset an open search.
  mergeGroups = after;
  renderMergeUI();
  const row = [...$('merge-groups').querySelectorAll('[data-linked-email]')].find(el=>el.dataset.linkedEmail===email);
  row?.querySelector('[data-action="move-linked-identity"]:not([disabled])')?.focus({preventScroll:true});
  renderMergeFeedback(`Reordered linked identities for ${group.displayName}. Authorship and group membership are unchanged.`);
}

function requireResolvedIdentitySelection() {
  if (!identityPicker?.selected.size) return false;
  renderMergeFeedback('Apply or cancel the pending identity selection before another edit.');
  $(`identity-apply-${identityPicker.targetIndex}`)?.focus();
  return true;
}
function openIdentityPicker(index) {
  if (!mergeGroups[index] || !mergeCandidates(index).length) return;
  if (identityPicker?.targetIndex === index) return closeIdentityPicker();
  if (requireResolvedIdentitySelection()) return;
  identityPicker = {targetIndex:index, selected:new Set(), query:''};
  renderMergeUI();
  $(`identity-search-${index}`)?.focus();
}
function closeIdentityPicker({ restoreFocus = true } = {}) {
  if (!identityPicker) return;
  const index = identityPicker.targetIndex;
  identityPicker = null;
  renderMergeUI();
  if (restoreFocus) $('merge-groups').querySelector(`[data-action="toggle-identity-picker"][data-group="${index}"]`)?.focus({preventScroll:true});
}
function refreshIdentityOptions() {
  if (!identityPicker) return;
  const index = identityPicker.targetIndex;
  $(`identity-list-${index}`).innerHTML = identityRows(index);
  const shown = mergeCandidates(index, identityPicker.query).flatMap(g => g.emails).length;
  setText(`identity-visible-${index}`, `${countWord(shown, 'identity', 'identities')} shown`);
  updateIdentityPickerSummary();
}
function updateIdentityPickerSummary() {
  if (!identityPicker) return;
  const {targetIndex, selected} = identityPicker;
  const sourceEntries = mergeCandidates(targetIndex);
  const sourceGroups = sourceEntries.filter(entry => entry.emails.some(email => selected.has(email)));
  const removedGroups = sourceGroups.filter(entry => entry.emails.every(email => selected.has(email)));
  const commits = sum([...selected].map(email => identityMeta.get(email)?.commits || 0));
  const recap = $(`identity-recap-${targetIndex}`);
  recap.innerHTML = selected.size
    ? `<strong>${countWord(selected.size, 'identity', 'identities')} · ${countWord(commits, 'commit')}</strong><span>Move from ${countWord(sourceGroups.length, 'contributor')}${removedGroups.length ? ` · ${countWord(removedGroups.length, 'source group')} will be emptied` : ''}. Changes apply to every chart when you build the dashboard.</span>`
    : `<strong>No identities selected</strong><span>Select one or more author emails above. Your existing identities will be kept.</span>`;
  const apply = $(`identity-apply-${targetIndex}`);
  apply.disabled = !selected.size;
  apply.textContent = selected.size ? `Move ${countWord(selected.size, 'identity', 'identities')}` : 'Move selected identities';
}
function applyIdentityPicker() {
  if (!identityPicker?.selected.size) return;
  const {targetIndex, selected} = identityPicker;
  const target = mergeGroups[targetIndex];
  const original = mergeGroups.map(g => ({displayName:g.displayName, emails:[...g.emails],workingDays:normalizeWorkingDays(g.workingDays)}));
  const moved = [...selected];
  // Reference the destination by email, not by its old array index: groups
  // before it may disappear as their final identities move.
  const targetEmail = target.emails[0] || moved[0];
  const next = moveContributorIdentities(mergeGroups, targetIndex, moved);
  if (next === mergeGroups) return closeIdentityPicker();
  mergeGroups = next;
  state.storyDismissed.clear();state.storyTrail=[];state.storyFindingId=null;
  identityPicker = null;
  mergeUndo = original;
  renderMergeUI();
  const newIndex = mergeGroups.findIndex(g => g.emails.includes(targetEmail));
  const btn = $('merge-groups').querySelector(`[data-action="toggle-identity-picker"][data-group="${newIndex}"]`);
  btn?.focus({preventScroll:true});
  renderMergeFeedback(`Moved ${countWord(moved.length, 'identity', 'identities')} into ${mergeGroups[newIndex]?.displayName || 'the contributor'}.`, true);
}
function undoIdentityMerge() {
  if (!mergeUndo || requireResolvedIdentitySelection()) return;
  mergeGroups = mergeUndo;
  state.storyDismissed.clear();state.storyTrail=[];state.storyFindingId=null;
  mergeUndo = null;
  identityPicker = null;
  renderMergeUI();
  renderMergeFeedback('Identity move undone.');
}
function splitEmail(index, email) {
  const group = mergeGroups[index];
  if (!group || group.emails.length <= 1 || !group.emails.includes(email) || requireResolvedIdentitySelection()) return;
  identityPicker = null;
  forgetUndo();
  group.emails = group.emails.filter(e => e !== email);
  state.storyDismissed.clear();state.storyTrail=[];state.storyFindingId=null;
  if (!group.emails.length) mergeGroups.splice(index, 1);
  mergeGroups.push({displayName: identityMeta.get(email)?.name || email, emails:[email],workingDays:normalizeWorkingDays(group.workingDays)});
  renderMergeUI();
}
function splitGroup(index) {
  const group = mergeGroups[index];
  if (!group || group.emails.length <= 1 || requireResolvedIdentitySelection()) return;
  identityPicker = null;
  forgetUndo();
  const emails = [...group.emails];
  state.storyDismissed.clear();state.storyTrail=[];state.storyFindingId=null;
  mergeGroups.splice(index, 1);
  for (const email of emails) mergeGroups.push({displayName: identityMeta.get(email)?.name || email, emails:[email],workingDays:normalizeWorkingDays(group.workingDays)});
  renderMergeUI();
}
function skipMerge() {
  identityPicker = null;
  mergeUndo = null;
  // Keep every known identity separate, including GitHub/Heroku-only actors.
  mergeGroups = [...identityMeta].map(([email,meta])=>({displayName:meta.name,emails:[email]}));
  buildDashboard();
}
async function analyse() {
  if(appendBusy || sessionTransferBusy)return;
  setText('parse-error','');
  const raw = $('log-input').value.trim();
  if (!raw) return setText('parse-error','Paste a git log or load the demo.');
  renderGeneration++; // Invalidate unfinished renders of an older import.
  const generation=++progressGeneration;
  showProgress('Reading history',2,'Decoding Git records without blocking the dashboard',generation);
  let history;
  try {history=await processImportedHistory(raw,generation);}
  catch(error) {finishProgress(generation,error);return setText('parse-error',error.message);}
  if (generation!==progressGeneration) return;
  parsedHistory=history;activeRawLog=raw;
  // The imported capture is retained independently for session export and future merges.
  // Clear only after parsing succeeds; on failure, leave the paste editable.
  $('log-input').value='';
  $('append-history-panel').hidden=true;$('add-activity-toggle').setAttribute('aria-expanded','false');
  $('append-status').hidden=true;$('append-log-input').value='';
  ({commits:rawCommits,tags:rawTags,githubReleases:rawGithubReleases,
    githubStatus,herokuReleases:rawHerokuReleases,herokuStatus,historyEnrichment:rawHistoryEnrichment,captureWarnings:githubWarnings}=history);
  importRevision++;computedKey=null;computedResult=null;
  finishProgress(generation,null,'History ready','Review the proposed contributor identities, then build your dashboard.');
  pendingImport = null;localDatasetId=null;
  identityMeta = makeIdentityCatalogue(rawCommits,rawGithubReleases,rawHerokuReleases);
  identityPicker = null;
  mergeUndo = null;
  linkedOrderEditors.clear();
  renderMergeFeedback();
  mergeGroups = makeMergeSuggestions();
  $('merge-step').hidden = false;
  $('dashboard').hidden = true;
  $('export-btn').hidden = true;
  renderMergeUI();
  $('merge-step').scrollIntoView({ behavior:'smooth', block:'start' });
}
function toggleAddActivity(open = $('append-history-panel').hidden) {
  if(appendBusy)return;
  $('append-history-panel').hidden=!open;
  $('add-activity-toggle').setAttribute('aria-expanded',String(open));
  if(open){$('append-log-input').focus({preventScroll:true});$('append-history-panel').scrollIntoView({behavior:'smooth',block:'nearest'});}
  else $('add-activity-toggle').focus({preventScroll:true});
}
function setAppendBusy(busy) {
  appendBusy=busy;
  $('append-activity-btn').disabled=busy || sessionTransferBusy;
  $('add-activity-toggle').disabled=busy;
  document.querySelector('[data-action="analyse"]').disabled=busy;
  document.querySelector('[data-action="load-demo"]').disabled=busy;
  document.querySelector('[data-action="choose-import"]').disabled=busy || sessionTransferBusy;
  $('export-btn').disabled=busy || sessionTransferBusy;
}
async function processAdditionalHistory(raw,generation) {
  const request=askWorker('append',{raw},progress=>showProgress(progress.phase,Math.round(progress.value*.76),progress.message,generation));
  if(request){
    try{return await request;}catch(error){if(!workerFaulted)throw error;}
  }
  showProgress('Reading additional history',10,'Using compatibility processing on this browser',generation);
  await yieldToUI();
  const incoming=parseGitHistory(raw,{allowEmpty:true});
  if(!hasImportableEvidence(incoming))throw new Error('No usable activity found in the pasted capture.');
  const merged=mergeGitHistories(parsedHistory,incoming);
  return {...merged,replaceRaw:isCompleteRecapture(parsedHistory,incoming,merged.history)};
}
/** Append evidence without entering the destructive initial-import identity flow. */
async function appendActivity() {
  if(appendBusy||sessionTransferBusy||!parsedHistory||$('dashboard').hidden)return;
  const raw=$('append-log-input').value.trim();
  if(!raw){setText('append-error','Paste new Git history or release activity first.');return;}
  setText('append-error','');
  const previousBounds=sourceDateBounds();
  const selectedAll=mergeGroups.length>0&&mergeGroups.every((_,i)=>state.selectedIds.has(String(i)));
  const generation=++progressGeneration;
  setAppendBusy(true);
  showProgress('Adding activity',4,'Comparing additional evidence with the imported history',generation);
  let result;
  try {result=await processAdditionalHistory(raw,generation);}
  catch(error){
    if(generation===progressGeneration){finishProgress(generation,error);setText('append-error',`Nothing was changed: ${error.message}`);}
    setAppendBusy(false);return;
  }
  if(generation!==progressGeneration){setAppendBusy(false);return;}
  if(!result.changed){
    finishProgress(generation,null,'Already up to date','Overlapping commits and release events were not counted twice.');
    $('append-status').hidden=false;
    setText('append-status','No new activity found. Your current identities, filters and session are unchanged.');
    $('append-log-input').value='';
    setAppendBusy(false);
    toggleAddActivity(false);
    return;
  }

  // From this point forward the combined, validated evidence becomes active.
  const parsedHistoryBeforeAppend=parsedHistory;
  parsedHistory=result.history;
  ({commits:rawCommits,tags:rawTags,githubReleases:rawGithubReleases,
    githubStatus,herokuReleases:rawHerokuReleases,herokuStatus,
    historyEnrichment:rawHistoryEnrichment,captureWarnings:githubWarnings}=parsedHistory);
  const previousRaw=activeRawLog;
  const delta=result.replaceRaw ? raw : compactAdditionalCapture(previousRaw,raw,parsedHistoryBeforeAppend,result.history);
  activeRawLog=result.replaceRaw ? raw : `${previousRaw.trimEnd()}\n${delta}`;
  // The replacement field is not a mirror of the imported evidence. Keep it
  // empty (or preserve a separately drafted replacement capture).
  const oldGroups=mergeGroups.length;
  identityMeta=makeIdentityCatalogue(rawCommits,rawGithubReleases,rawHerokuReleases);
  const extended=extendContributorGroups(mergeGroups,identityMeta,rawGithubReleases,rawHerokuReleases,rawCommits);
  mergeGroups=extended.groups;
  if(selectedAll)for(let i=oldGroups;i<mergeGroups.length;i++)state.selectedIds.add(String(i));
  identityPicker=null;mergeUndo=null;linkedOrderEditors.clear();
  const bounds=sourceDateBounds();
  // Preserve explicit historical windows. A live/latest window advances to
  // include new dates; older fixed windows remain exactly where the user set them.
  if(state.period!=='custom'){
    const window=periodForPreset(rawCommits,state.period,bounds);
    state.start=window.start;state.end=window.end;
  }else if(scopeFollowsLatest && state.end===previousBounds.max && bounds.max>previousBounds.max){
    state.end=bounds.max;
  }
  if(primary.periodPreset!=='custom'&&primary.periodTo===previousBounds.max &&
      primary.periodFrom&&bounds.max>previousBounds.max){
    const span=dayNumber(primary.periodTo)-dayNumber(primary.periodFrom);
    primary.periodTo=bounds.max;
    primary.periodFrom=dateAtDay(dayNumber(bounds.max)-span);
  }
  importRevision++;computedKey=null;computedResult=null;
  configureOptions();
  setText('source-status',`${number.format(rawCommits.length)} commits · ${number.format(rawTags.length)} tags · ${number.format(rawGithubReleases.length)} GitHub Releases · ${number.format(rawHerokuReleases.length)} Heroku events · identities retained`);
  $('append-log-input').value='';
  setAppendBusy(false);
  toggleAddActivity(false); // Keep navigation in place rather than reopening step 02.
  const changes=result.changes;
  const label=(name,count,plural=`${name}s`)=>`${number.format(count)} ${count===1?name:plural}`;
  const additions=[label('commit',changes.commits.added),label('tag',changes.tags.added),
    label('GitHub Release',changes.githubReleases.added),label('Heroku event',changes.herokuReleases.added)];
  const updated=Object.entries(changes).filter(([name,v])=>v?.updated>0).reduce((total,[,v])=>total+v.updated,0);
  let notice=`Added ${additions.join(' · ')}`;
  if(updated)notice+=` · ${label('updated record',updated)}`;
  if(extended.added.length)notice+=` · ${label('new identity',extended.added.length,'new identities')} kept separate or safely linked. Review identities whenever you like.`;
  else notice+=' · Existing identity choices preserved.';
  if(changes.statusChanged)notice+=' · Capture availability updated.';
  $('append-status').hidden=false;setText('append-status',notice);
  setText('append-error','');
  // Update only a previously opt-in local copy. Never silently enable storage.
  if(localDatasetId){
    try {await saveLocalHistory(localDatasetId,sessionPayload());historyNotice('Updated the browser-local copy with the appended activity.');}
    catch(error){historyNotice(`Activity added, but browser-local copy could not be updated: ${error.message}`);}
  }
  await renderDashboard();
}
function loadDemo() {
  $('range-select').value='3';
  $('log-input').value=generateDemoLog({years:3,commits:720});
  analyse();
}
function syncScopeAfterLoad() {
  scopeFollowsLatest=true;
  const { min,max } = sourceDateBounds();
  const years = Math.max(1, Math.min(5, Number($('range-select').value) || 3));
  const anchored = new Date(`${max}T12:00:00Z`);
  const y = anchored.getUTCFullYear() - years, m = anchored.getUTCMonth();
  const maxDay = new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const anniversary = new Date(Date.UTC(y,m,Math.min(anchored.getUTCDate(),maxDay))).toISOString().slice(0,10);
  const desiredStart = dateAtDay(dayNumber(anniversary)+1);
  const initialStart = min > desiredStart ? min : desiredStart;
  Object.assign(state, { period:initialStart===min?'all':'custom',start:initialStart,end:max,includeMerges:false,includeReverts:true,
    ...defaultMotionState(),metric:'commits',mode:'total',denominator:'repository',trend:'rolling',pulseMode:'monthly',pulseLens:'activity',continuityView:DEFAULT_SIGNATURE_MODE,pulseGapHorizon:DEFAULT_GAP_HORIZON,pulseBusyDay:DEFAULT_BUSY_DAY, pulseReleaseLines:DEFAULT_RELEASE_LINES,pulseDailyChurn:DEFAULT_DAILY_CHURN,pulseMomentumWorkdays:DEFAULT_MOMENTUM_WINDOW,pulseLevelWorkdays:DEFAULT_LEVEL_WINDOW,pulseContinuityWeeks:DEFAULT_CONTINUITY_WINDOW, pulseTemporalPeriod:TEMPORAL_PERIOD_DEFAULT,pulseTemporalChurn:TEMPORAL_CHURN_DEFAULT,pulseMeaningfulLines:MEANINGFUL_CHURN_DEFAULT,rhythmFocus:'selection',rhythmDisplay:'heatmap',rhythmTab:'weekly',seasonMode:'rate',seasonYears:null,sortKey:'lens',sortDesc:true,search:'',impactTab:'timeline',impactMetric:'commits',impactAreaMode:'touches',impactReleaseHash:null,impactShowAll:false,impactMatrixMode:'all',impactMatrixPage:0,impactMatrixYear:'all',impactMatrixSize:18,
    impactTimelineMode:'all',impactTimelineFrom:null,impactTimelineTo:null,impactFocus:'selection',impactActorMap:{},
    viewMode:'observatory',storyPerspective:'team',storyFocus:'selection',storyTopic:'all',storyCategory:'noteworthy',storyShowAll:false,
    storyFindingId:null,storyMonth:null,storyPairA:null,storyPairB:null,storyTrail:[],storyDismissed:new Set() });
  state.selectedIds = new Set(mergeGroups.map((_,i)=>String(i)));
  if (!pendingImport)restorePrimary(null);
  if (pendingImport?.scope) {
    const s = pendingImport.scope;
    scopeFollowsLatest=typeof s.followsLatest==='boolean' ? s.followsLatest : s.period!=='custom';
    if (METRICS[s.metric]) state.metric=s.metric;
    if (['total','share','per_active_day','per_week'].includes(s.mode)) state.mode=s.mode;
    if (['selection','repository'].includes(s.denominator)) state.denominator=s.denominator;
    state.includeMerges=!!s.includeMerges;
    state.includeReverts=s.includeReverts !== false;
    if (typeof s.period==='string') state.period=s.period;
    if (['rolling','weekly','cumulative'].includes(s.trend)) state.trend=s.trend;
    if (['monthly','daily','weekly'].includes(s.pulseMode)) state.pulseMode=s.pulseMode;
    if (['activity','release-gap','momentum','level','continuity'].includes(s.pulseLens)) state.pulseLens=s.pulseLens;
    if (SIGNATURE_MODES.includes(s.continuityView)) state.continuityView=s.continuityView;
    if(s.motionViews&&typeof s.motionViews==='object'&&!Array.isArray(s.motionViews)) for(const lens of MOTION_MODES){if(['cells','motion'].includes(s.motionViews[lens]))state.motionViews[lens]=s.motionViews[lens];}
    if(MOTION_WINDOWS.includes(s.motionWeeks))state.motionWeeks=s.motionWeeks;
    if(MOTION_STEPS.includes(s.motionStep))state.motionStep=s.motionStep;
    if(MOTION_TRAILS.includes(s.motionTrail))state.motionTrail=s.motionTrail;
    if(MOTION_LABELS.includes(s.motionLabels))state.motionLabels=s.motionLabels;
    if(['strip','map'].includes(s.motionLevelDisplay))state.motionLevelDisplay=s.motionLevelDisplay;
    if (state.pulseMode==='weekly'&&state.pulseLens!=='continuity')state.pulseMode='monthly';
    if (GAP_HORIZONS.includes(s.pulseGapHorizon)) state.pulseGapHorizon=s.pulseGapHorizon;
    if (BUSY_DAY_THRESHOLDS.includes(s.pulseBusyDay)) state.pulseBusyDay=s.pulseBusyDay;
    if (RELEASE_LINE_THRESHOLDS.includes(s.pulseReleaseLines)) state.pulseReleaseLines=s.pulseReleaseLines;
    if (DAILY_CHURN_THRESHOLDS.includes(s.pulseDailyChurn)) state.pulseDailyChurn=s.pulseDailyChurn;
    if (MOMENTUM_WINDOWS.includes(s.pulseMomentumWorkdays)) state.pulseMomentumWorkdays=s.pulseMomentumWorkdays;
    if (LEVEL_WINDOWS.includes(s.pulseLevelWorkdays)) state.pulseLevelWorkdays=s.pulseLevelWorkdays;
    if (CONTINUITY_WINDOWS.includes(s.pulseContinuityWeeks)) state.pulseContinuityWeeks=s.pulseContinuityWeeks;
    if (TEMPORAL_PERIODS.includes(s.pulseTemporalPeriod)) state.pulseTemporalPeriod=s.pulseTemporalPeriod;
    if (TEMPORAL_CHURN_CAPS.includes(s.pulseTemporalChurn)) state.pulseTemporalChurn=s.pulseTemporalChurn;
    if (MEANINGFUL_CHURN_THRESHOLDS.includes(s.pulseMeaningfulLines)) state.pulseMeaningfulLines=s.pulseMeaningfulLines;
    if (['heatmap','clock','bars'].includes(s.rhythmDisplay)) state.rhythmDisplay=s.rhythmDisplay;
    if (['weekly','years','seasonal'].includes(s.rhythmTab)) state.rhythmTab=s.rhythmTab;
    if (['rate','shape','index'].includes(s.seasonMode)) state.seasonMode=s.seasonMode;
    if (['timeline','matrix','reach','durability'].includes(s.impactTab)) state.impactTab=s.impactTab;
    if (IMPACT_METRICS[s.impactMetric]) state.impactMetric=s.impactMetric;
    if (['touches','within'].includes(s.impactAreaMode)) state.impactAreaMode=s.impactAreaMode;
    if (typeof s.impactReleaseHash==='string') state.impactReleaseHash=s.impactReleaseHash;
    if (typeof s.impactFocusEmail==='string') {
      const focusIndex=mergeGroups.findIndex(g=>g.emails.includes(s.impactFocusEmail.toLowerCase()));
      state.impactFocus=focusIndex<0?'selection':String(focusIndex);
    }
    if (s.impactActorMap && typeof s.impactActorMap==='object' && !Array.isArray(s.impactActorMap)) {
      const knownEmails=new Set(mergeGroups.flatMap(g=>g.emails));
      state.impactActorMap=Object.fromEntries(Object.entries(s.impactActorMap).filter(([login,email])=>
        /^[\w-]{1,100}$/.test(login) && typeof email==='string' && (!email || knownEmails.has(email.toLowerCase())))
        .map(([login,email])=>[login.toLowerCase(),email.toLowerCase()]));
    }
    state.impactShowAll=!!s.impactShowAll;
    if(['all','latest'].includes(s.impactMatrixMode)) state.impactMatrixMode=s.impactMatrixMode;
    if(Number.isInteger(s.impactMatrixPage) && s.impactMatrixPage>=0) state.impactMatrixPage=Math.min(100000,s.impactMatrixPage);
    if(s.impactMatrixYear==='all' || (typeof s.impactMatrixYear==='string' && /^\d{4}$/.test(s.impactMatrixYear)))state.impactMatrixYear=s.impactMatrixYear;
    if([18,36,54].includes(s.impactMatrixSize))state.impactMatrixSize=s.impactMatrixSize;
    if (['all','latest','custom'].includes(s.impactTimelineMode))state.impactTimelineMode=s.impactTimelineMode;
    if (typeof s.impactTimelineFrom==='string' && /^\d{4}-\d\d-\d\d$/.test(s.impactTimelineFrom))state.impactTimelineFrom=s.impactTimelineFrom;
    if (typeof s.impactTimelineTo==='string' && /^\d{4}-\d\d-\d\d$/.test(s.impactTimelineTo))state.impactTimelineTo=s.impactTimelineTo;
    if (Array.isArray(s.seasonYears)) state.seasonYears=new Set(s.seasonYears.filter(y=>Number.isInteger(y)&&y>=1900&&y<=2200));
    if (s.start && s.end && s.start <= s.end && /^\d{4}-\d\d-\d\d$/.test(s.start) && /^\d{4}-\d\d-\d\d$/.test(s.end)) {
      state.start=s.start; state.end=s.end;
    }
    if (typeof s.rhythmFocusEmail === 'string') {
      const i=mergeGroups.findIndex(g=>g.emails.includes(s.rhythmFocusEmail));
      state.rhythmFocus=i<0?'selection':String(i);
    }
    if (['observatory','periods','contributors','codebase','deployments','evidence'].includes(s.viewMode))state.viewMode=s.viewMode;
    if (['team','person','compare'].includes(s.storyPerspective))state.storyPerspective=s.storyPerspective;
    if (['all','activity','rhythm','delivery','focus','seasonality','context'].includes(s.storyTopic))state.storyTopic=s.storyTopic;
    if (['noteworthy','hidden'].includes(s.storyCategory))state.storyCategory=s.storyCategory;
    state.storyShowAll=!!s.storyShowAll;
    if (Array.isArray(s.storyDismissed))state.storyDismissed=new Set(s.storyDismissed.filter(id=>typeof id==='string' && id.length<180).slice(0,300));
    const idForEmail=email=>{const index=mergeGroups.findIndex(g=>g.emails.includes(String(email||'').toLowerCase()));return index<0?null:String(index);};
    state.storyFocus=idForEmail(s.storyFocusEmail)||'selection';
    state.storyPairA=idForEmail(s.storyPairAEmail);
    state.storyPairB=idForEmail(s.storyPairBEmail);
    if (typeof s.storyMonth==='string' && /^\d{4}-\d\d$/.test(s.storyMonth))state.storyMonth=s.storyMonth;
    if (Array.isArray(s.storyTrail))state.storyTrail=s.storyTrail.filter(id=>typeof id==='string'&&id.length<180).slice(-8);
    if (typeof s.storyFindingId==='string'&&s.storyFindingId.length<180)state.storyFindingId=s.storyFindingId;
    if (Array.isArray(s.selectedEmails)) {
      const emails = new Set(s.selectedEmails);
      state.selectedIds = new Set(mergeGroups.flatMap((g,i)=>g.emails.some(e=>emails.has(e)) ? [String(i)] : []));
    }
  }
  resetPrimaryOnLoad();
  pendingImport=null;
}
function buildDashboard() {
  if (requireResolvedIdentitySelection()) return;
  identityPicker = null;
  mergeUndo = null;
  mergeGroups=mergeGroups.filter(g=>g.emails.length);
  // A reorder performed from Review identities must not reset the existing
  // date scope, selected contributors, or release/contributor navigation.
  if ($('dashboard').hidden || !analysis || pendingImport) syncScopeAfterLoad();
  $('merge-step').hidden=true;
  $('dashboard').hidden=false;
  $('export-btn').hidden=false;
  $('source-details').open=false;
  setText('source-status',`${number.format(rawCommits.length)} commits · ${number.format(rawTags.length)} tags · ${number.format(rawGithubReleases.length)} GitHub Releases · ${number.format(rawHerokuReleases.length)} Heroku events · identities reviewed`);
  $('contributor-search').value='';
  configureOptions();
  renderDashboard();
  $('dashboard').scrollIntoView({ behavior:'smooth',block:'start' });
}
function configureOptions() {
  const years=[...new Set([...rawCommits.map(c=>c.date?.slice(0,4)),...rawTags.map(t=>t.taggedDate?.slice(0,4)),...rawGithubReleases.filter(r=>!r.draft).map(r=>r.publishedDate?.slice(0,4)),...rawHerokuReleases.map(r=>r.date?.slice(0,4))].filter(Boolean))].sort().reverse();
  $('period-select').innerHTML=`<option value="all">All imported dates</option><option value="90d">Latest 90 days</option><option value="365d">Latest 365 days</option><option value="730d">Latest 730 days</option>${years.map(y=>`<option value="year-${y}">Calendar year ${y}</option>`).join('')}<option value="custom">Custom date range</option>`;
  $('metric-select').innerHTML=Object.entries(METRICS).map(([key,m])=>`<option value="${key}">${esc(m.label)}</option>`).join('');
}
function updatePeriod(preset) {
  state.period=preset;scopeFollowsLatest=preset!=='custom';
  if (preset !== 'custom') {
    const dates=periodForPreset(rawCommits,preset,sourceDateBounds());
    state.start=dates.start;state.end=dates.end;
  }
  renderDashboard();
}
function changeDate() {
  const start=$('date-from').value, end=$('date-to').value;
  if (!start || !end || start > end) {
    setText('scope-error','Please choose a valid start date on or before the end date. Previous valid range remains active.');
    // Avoid showing a date range on the controls which differs from the charts.
    $('date-from').value=state.start || '';
    $('date-to').value=state.end || '';
    return;
  }
  state.period='custom';scopeFollowsLatest=false;state.start=start;state.end=end;
  setText('scope-error','');
  renderDashboard();
}
function resetFilters() {
  scopeFollowsLatest=true;
  Object.assign(state,{ period:'all',start:sourceDateBounds().min,end:sourceDateBounds().max,
    ...defaultMotionState(),includeMerges:false,includeReverts:true,metric:'commits',mode:'total',denominator:'repository',trend:'rolling',pulseMode:'monthly',pulseLens:'activity',continuityView:DEFAULT_SIGNATURE_MODE,pulseGapHorizon:DEFAULT_GAP_HORIZON,pulseBusyDay:DEFAULT_BUSY_DAY, pulseReleaseLines:DEFAULT_RELEASE_LINES,pulseDailyChurn:DEFAULT_DAILY_CHURN,pulseMomentumWorkdays:DEFAULT_MOMENTUM_WINDOW,pulseLevelWorkdays:DEFAULT_LEVEL_WINDOW,pulseContinuityWeeks:DEFAULT_CONTINUITY_WINDOW, pulseTemporalPeriod:TEMPORAL_PERIOD_DEFAULT,pulseTemporalChurn:TEMPORAL_CHURN_DEFAULT,pulseMeaningfulLines:MEANINGFUL_CHURN_DEFAULT,rhythmFocus:'selection',rhythmDisplay:'heatmap',rhythmTab:'weekly',seasonMode:'rate',seasonYears:null,sortKey:'lens',sortDesc:true,search:'',impactTab:'timeline',impactMetric:'commits',impactAreaMode:'touches',impactReleaseHash:null,impactShowAll:false,impactMatrixMode:'all',impactMatrixPage:0,impactMatrixYear:'all',impactMatrixSize:18,
    impactTimelineMode:'all',impactTimelineFrom:null,impactTimelineTo:null,impactFocus:'selection',impactActorMap:{} });
  state.selectedIds=new Set(mergeGroups.map((_,i)=>String(i)));
  $('contributor-search').value='';
  setText('scope-error','');
  renderDashboard();
}
function selectedCountText(view) {
  const name = view.selectedIds.size === 1 ? 'person' : 'people';
  return `${view.selectedIds.size} ${name} selected of ${view.groupDefs.length}`;
}
function renderPicker() {
  const query=state.search.trim().toLocaleLowerCase();
  const view=analysis;
  const oldScroll=$('contributor-picker').scrollTop;
  setText('people-count', `${view.selectedIds.size} / ${view.groupDefs.length} selected`);
  const groups=view.groupDefs.filter(g=>`${g.displayName} ${g.emails.join(' ')}`.toLocaleLowerCase().includes(query));
  $('contributor-picker').innerHTML = groups.length ? groups.map(g => {
    const checked=view.selectedIds.has(g.id);
    return `<div class="picker-person" style="${style(g.id)}"><label><input type="checkbox" data-person-id="${g.id}" ${checked?'checked':''}><i class="person-dot" aria-hidden="true"></i><span class="picker-person-name" title="${esc(g.displayName)}">${esc(g.displayName)}</span></label><button type="button" class="solo-button" data-action="solo" data-person-id="${g.id}" aria-label="Select only ${esc(g.displayName)}">Solo</button></div>`;
  }).join('') : `<div class="picker-empty">No matching names. Search only affects this picker.</div>`;
  $('contributor-picker').scrollTop=oldScroll;
}
function updateControls() {
  $('period-select').value=state.period;
  if ($('period-select').selectedIndex === -1) $('period-select').value='custom';
  $('date-from').value=state.start||'';$('date-to').value=state.end||'';
  $('filter-merges').checked=state.includeMerges;
  $('filter-reverts').checked=state.includeReverts;
  $('metric-select').value=state.metric;
  $('mode-select').value=state.mode;
  $('denominator-select').value=state.denominator;
  $('denominator-select').disabled=false;
  $('metric-explanation').textContent=`${METRICS[state.metric].note}. ${state.mode==='share' ? 'Share uses the reference selected below.' : 'Reference is used for percent context and hotspots.'}`;
  document.querySelectorAll('[data-trend]').forEach(btn=>{const yes=btn.dataset.trend===state.trend;btn.classList.toggle('active',yes);btn.setAttribute('aria-pressed',String(yes));});
  document.querySelectorAll('[data-pulse-mode]').forEach(btn=>{if(btn.dataset.pulseMode==='weekly')btn.hidden=state.pulseLens!=='continuity';const yes=btn.dataset.pulseMode===state.pulseMode;btn.classList.toggle('active',yes);btn.setAttribute('aria-pressed',String(yes));});
  document.querySelectorAll('[data-pulse-lens]').forEach(btn=>{const yes=btn.dataset.pulseLens===state.pulseLens;btn.classList.toggle('active',yes);btn.setAttribute('aria-pressed',String(yes));});
}
function renderScope(view) {
  const policy=`${view.includeMerges?'merges included':'merges excluded'} · ${view.includeReverts?'reverts included':'reverts excluded'}`;
  const lens=`${METRICS[view.metric].label.toLowerCase()} · ${displayModeLabel(state.mode).toLowerCase()}`;
  const reference=` · reference: ${view.denominator==='repository'?'all contributors':'selected people'}`;
  setText('scope-description', `${selectedCountText(view)} · ${view.start} to ${view.end} · ${policy} · ${lens}${reference}`);
  const total = rawCommits.length;
  setText('data-coverage', `Dataset: ${number.format(total)} deduplicated, dated commits · ${formatDate(view.min)} – ${formatDate(view.max)} · ${view.groupDefs.length} reconciled identities`);
}
function formatLens(v, mode=state.mode) {return v==null?'—':mode==='share' ? percent(v) : decimal.format(v);}
function lensFor(c,view=analysis) {
  return valueInMode(metricValue(c,view.metric),{mode:state.mode,reference:view.referenceTotal,activeDays:c.totals.active_days,calendarDays:view.spanDays});
}
function renderStats(view) {
  const selected=view.selectedSummary, ref=view.referenceSummary;
  const selectedMetric=selected.totals[view.metric];
  const lens=(state.mode==='share' && !ref.totals[view.metric]) || (state.mode==='per_active_day' && !selected.totals.active_days)
    ? null : valueInMode(selectedMetric,{mode:state.mode,reference:ref.totals[view.metric],activeDays:selected.totals.active_days,calendarDays:view.spanDays});
  const lensFooter=lens===null?'No activity to form a valid denominator'
    :state.mode==='total'?'Across all selected contributors'
    :state.mode==='share'? `Of ${view.denominator==='repository'?'all repository':'selected'} ${METRICS[view.metric].unit}`
    :state.mode==='per_active_day'? `Per selected contributor-day · ${number.format(selected.totals.active_days)} days`
    : `Over ${view.spanDays} calendar days (including quiet days)`;
  const metrics=[
    ['PEOPLE WITH ACTIVITY',number.format(selected.contributingPeople),`${view.selectedIds.size} selected · ${view.groupDefs.length} in repository`,false],
    [METRICS[view.metric].label.toUpperCase() + (state.mode==='total'?'':` · ${displayModeLabel(state.mode).toUpperCase()}`),formatLens(lens),lensFooter,true],
    ['CONTRIBUTOR-DAYS',number.format(selected.totals.active_days),`${selected.calendarDays} distinct calendar dates with activity`,false],
    ['TOTAL LINE CHURN',number.format(selected.totals.churn),`${number.format(selected.totals.lines_added)} added / ${number.format(selected.totals.lines_deleted)} deleted`,false],
  ];
  $('overview-stats').innerHTML=metrics.map(([title,value,foot,featured])=>`<div class="stat-card ${featured?'emphasis':''}"><div class="eyebrow">${esc(title)}</div><div class="stat-number">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></div>`).join('');
  if (!view.selectedIds.size) return setText('insight-strip','Select one or more contributors above to reveal the comparisons.');
  if (!selected.commits) return setText('insight-strip','No commits match this exact scope. Try another date window or change the merge/revert policy.');
  if (!selectedMetric) return setText('insight-strip', `No ${METRICS[view.metric].label.toLowerCase()} were recorded in this scope. Choose another measure or broaden the selection.`);
  const ranked=[...view.contributors].sort((a,b)=>metricValue(b,view.metric)-metricValue(a,view.metric));
  const first=ranked[0];
  const second=ranked[1];
  const refMetric=view.referenceTotal;
  const figure=refMetric ? percent(metricValue(first,view.metric)/refMetric*100) : '0%';
  $('insight-strip').innerHTML=`<strong>${esc(first.displayName)}</strong> accounts for <strong>${esc(figure)}</strong> of ${esc(METRICS[view.metric].label.toLowerCase())} in the ${view.denominator==='repository'?'repository':'selected cohort'}${second?`; <strong>${esc(second.displayName)}</strong> follows at <strong>${esc(number.format(metricValue(second,view.metric)))}</strong>.`:'.'} These are measures of recorded activity, not a ranking of performance.`;
}
function renderRanking(view) {
  const label=METRICS[view.metric].label;
  setText('ranking-context',`${label.toUpperCase()} / ${displayModeLabel(state.mode).toUpperCase()}`);
  setText('ranking-scale',state.mode==='share'? view.referenceTotal ? 'Bar width: 100% = entire reference group' : 'No reference activity; shares are undefined' : 'Bar width: longest = largest selected value (same scale for all)');
  if(!view.contributors.length) return $('ranking').innerHTML=empty('No people selected. Select one or many above.');
  const ordered=[...view.contributors].sort((a,b)=>lensFor(b,view)-lensFor(a,view) || a.displayName.localeCompare(b.displayName));
  const maximum=state.mode==='share'?100:Math.max(...ordered.map(c=>lensFor(c,view)),1);
  $('ranking').innerHTML=ordered.map((c,i)=>{
    const metric=metricValue(c,view.metric);
    const share=view.referenceTotal ? metric/view.referenceTotal*100 : 0;
    const val=(state.mode==='share'&&!view.referenceTotal)||(state.mode==='per_active_day'&&!c.totals.active_days)?null:lensFor(c,view);
    const side=state.mode==='total'?(view.referenceTotal?`${percent(share)} of reference`:'No reference activity')
      :state.mode==='share'?`${number.format(metric)} ${METRICS[view.metric].unit}`
      :state.mode==='per_active_day'?`${number.format(metric)} / ${c.totals.active_days} active days`
      :`${number.format(metric)} over ${view.spanDays} days`;
    return `<div class="ranking-row" style="${style(c.id)}"><div class="ranking-person"><span class="ranking-index">${String(i+1).padStart(2,'0')}</span><i class="person-dot" aria-hidden="true"></i><span class="ranking-name" title="${esc(c.displayName)}">${esc(c.displayName)}</span></div><div class="ranking-track" title="${esc(c.displayName)}: ${esc(formatLens(val))}"><div class="ranking-fill" style="width:${maximum&&val!==null?Math.min(100,Math.max(0,val/maximum*100)):0}%"></div></div><div class="ranking-value">${esc(formatLens(val))}<small>${esc(side)}</small></div></div>`;
  }).join('');
}


function chartTicks(view,lines,axisMax) {
  const out=[];
  for(let i=0;i<=4;i++){
    const val=axisMax*i/4;
    out.push({ v:val,label:state.mode==='share'?`${number.format(val)}%`:val>=1000?new Intl.NumberFormat('en-GB',{notation:'compact',maximumFractionDigits:1}).format(val):decimal.format(val) });
  }
  return out;
}
function renderTrend(view) {
  setText('trend-axis-label',`${displayModeLabel(state.mode).toUpperCase()} / ${METRICS[view.metric].label.toUpperCase()}`);
  const note=state.trend==='rolling' ? 'Trailing 4 calendar weeks · totals or rates calculated from summed evidence'
    : state.trend==='weekly' ? 'Raw calendar weeks · edge weeks use only dates within the selection'
    : 'Cumulative from the start of the selected period';
  setText('trend-note',note+(state.mode==='per_week'?' · partial weeks annualised to 7-day equivalents':''));
  if(!view.contributors.length || !view.weeks.length || (state.mode==='share' && !view.referenceTotal)) {
    $('trend-chart').innerHTML=empty(state.mode==='share'&&!view.referenceTotal?'No reference events for this measure; a percentage cannot be calculated.':'No matching time series for this scope.');
    $('trend-legend').innerHTML='';return;
  }
  const {weeks,lines}=seriesForAnalysis(view,{mode:state.mode,trend:state.trend});
  const W=990,H=266,L=56,R=18,T=14,B=39;
  const cw=W-L-R,ch=H-T-B;
  const mx=state.mode==='share'?100:Math.max(1,...lines.flatMap(s=>s.vals.filter(v=>v!==null)));
  const x=i=>L+(weeks.length===1?.5:i/(weeks.length-1))*cw;
  const y=v=>T+ch-(v/mx)*ch;
  let svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(state.trend==='rolling'?'Trailing four-week':state.trend==='weekly'?'Weekly':'Cumulative')} ${esc(METRICS[view.metric].label)} for ${view.contributors.length} selected contributors">`;
  for(const tick of chartTicks(view,lines,mx)){
    const py=y(tick.v);
    svg+=`<line x1="${L}" y1="${py}" x2="${W-R}" y2="${py}" stroke="#e4e9e1" stroke-width="1"/><text x="${L-10}" y="${py}" fill="#697970" font-size="10" text-anchor="end" dominant-baseline="middle" font-family="IBM Plex Mono,monospace">${esc(tick.label)}</text>`;
  }
  const labelIndexes=new Set();
  const labels=Math.min(8,weeks.length);
  for(let i=0;i<labels;i++) labelIndexes.add(Math.round(i*(weeks.length-1)/Math.max(1,labels-1)));
  for(const index of labelIndexes){
    const week=weeks[index];
    const lbl=new Date(`${week}T12:00:00Z`).toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'});
    svg+=`<text x="${x(index)}" y="${H-15}" fill="#697970" font-size="10" text-anchor="middle" font-family="IBM Plex Mono,monospace">${esc(lbl)}</text>`;
  }
  for(const {c,vals} of lines){
    // Nulls are undefined ratios, not zero. Break the line across these
    // windows rather than drawing a deceptively continuous zero segment.
    const runs=[];let run=[];
    for(let i=0;i<vals.length;i++){
      if(vals[i]===null){if(run.length)runs.push(run);run=[];}
      else run.push({i,v:vals[i]});
    }
    if(run.length)runs.push(run);
    for(const points of runs){
      if(points.length>1)svg+=`<polyline points="${points.map(({i,v})=>`${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')}" stroke="${color(c.id)}" fill="none" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      else svg+=`<circle cx="${x(points[0].i)}" cy="${y(points[0].v)}" r="2.7" fill="${color(c.id)}"/>`;
    }
    const last=runs.at(-1)?.at(-1);
    if(last)svg+=`<circle cx="${x(last.i)}" cy="${y(last.v)}" r="3.4" fill="${color(c.id)}"/>`;
  }
  svg+=`<line id="chart-cursor" x1="${L}" x2="${L}" y1="${T}" y2="${T+ch}" stroke="#5b665e" stroke-dasharray="3 4" visibility="hidden"/><rect x="${L}" y="${T}" width="${cw}" height="${ch}" fill="transparent" data-chart-hit="true"/></svg><div class="trend-tip" id="chart-tip" role="tooltip" hidden></div>`;
  $('trend-chart').innerHTML=svg;
  $('trend-legend').innerHTML=lines.map(({c})=>`<span style="${style(c.id)}"><i class="person-dot" aria-hidden="true"></i>${esc(c.displayName)}</span>`).join('');
  const wrap=$('trend-chart'), chart=wrap.querySelector('svg'), tip=wrap.querySelector('#chart-tip'), cursor=chart.querySelector('#chart-cursor');
  chart.addEventListener('pointermove',event=>{
    const rect=chart.getBoundingClientRect();
    const rawX=(event.clientX-rect.left)*W/rect.width;
    if(rawX<L || rawX>W-R) {tip.hidden=true;cursor.setAttribute('visibility','hidden');return;}
    const i=Math.max(0,Math.min(weeks.length-1,Math.round((rawX-L)/cw*(weeks.length-1))));
    cursor.setAttribute('x1',x(i));cursor.setAttribute('x2',x(i));cursor.setAttribute('visibility','visible');
    const sorted=[...lines].sort((a,b)=>(b.vals[i]??-1)-(a.vals[i]??-1));
    tip.innerHTML=`<strong>${state.trend==='rolling'?'4-week window through week of':state.trend==='cumulative'?'Through week of':'Week of'} ${esc(formatDate(weeks[i]))}</strong>${sorted.map(({c,vals})=>`<div class="trend-tip-row"><span style="${style(c.id)}"><i></i>${esc(c.displayName)}</span><b>${esc(formatLens(vals[i]))}</b></div>`).join('')}`;
    tip.hidden=false;
    const tipWidth=tip.offsetWidth||210;
    const xPx=(event.clientX-rect.left);
    tip.style.left=`${Math.min(Math.max(4,xPx+14),Math.max(4,rect.width-tipWidth-4))}px`;
    tip.style.top='7px';
  });
  chart.addEventListener('pointerleave',()=>{tip.hidden=true;cursor.setAttribute('visibility','hidden');});
}

function sortedContributors(view,releaseEvidence) {
  const getters={
    lens: c=>lensFor(c,view),share:c=>view.referenceTotal?metricValue(c,view.metric)/view.referenceTotal*100:0,
    commits:c=>c.totals.commits,active_days:c=>c.totals.active_days,pace:c=>c.totals.active_days?c.totals.commits/c.totals.active_days:0,
    churn:c=>c.totals.churn,files:c=>c.totals.files,reverts:c=>c.totals.commits?c.totals.reverts/c.totals.commits*100:0,
    releases:c=>releaseEvidence?.available?(releaseEvidence.byId.get(String(c.id))?.releases??0):-1,
    released_commits:c=>releaseEvidence?.available?(releaseEvidence.byId.get(String(c.id))?.commits??0):-1,
    released_lines:c=>releaseEvidence?.available?(releaseEvidence.byId.get(String(c.id))?.lines??-1):-1,
    actor_events:c=>releaseEvidence?.available?(releaseEvidence.byId.get(String(c.id))?.actorEvents??0):-1,
    version:c=>c.totals.releases,weekend:c=>c.totals.commits?c.weekendCommits/c.totals.commits*100:0,
  };
  const get=getters[state.sortKey]||getters.lens;
  return [...view.contributors].sort((a,b)=>(get(a)-get(b))*(state.sortDesc?-1:1) || a.displayName.localeCompare(b.displayName));
}
function makeTableData(view) {
  const reference=view.referenceTotal;
  const releaseEvidence=releaseScorecard(perspectiveIndex,{from:view.start,to:view.end},view.contributors);
  const releaseValue=(c,key)=>releaseEvidence.available?releaseEvidence.byId.get(String(c.id))?.[key]??null:null;
  const releaseFormat=value=>value===null?'—':number.format(value);
  const columns=[
    {key:'name',label:'Contributor',value:c=>c.displayName,show:c=>`<span style="${style(c.id)}"><i class="person-dot"></i>${esc(c.displayName)}</span>`},
    {key:'lens',label:`${METRICS[view.metric].label} · ${displayModeLabel(state.mode)}`,value:c=>(state.mode==='share'&&!reference)||(state.mode==='per_active_day'&&!c.totals.active_days)?null:lensFor(c,view),format:v=>formatLens(v)},
    {key:'share',label:'Share of reference',value:c=>reference?c.totals[view.metric]/reference*100:null,format:v=>v==null?'—':percent(v)},
    {key:'commits',label:'Commits',value:c=>c.totals.commits},
    {key:'active_days',label:'Active days',value:c=>c.totals.active_days},
    {key:'pace',label:'Commits / active day',value:c=>c.totals.active_days?c.totals.commits/c.totals.active_days:null,format:v=>v==null?'—':decimal.format(v)},
    {key:'churn',label:'Line churn',value:c=>c.totals.churn},
    {key:'files',label:'File touches',value:c=>c.totals.files},
    {key:'reverts',label:'Revert %',value:c=>c.totals.commits?c.totals.reverts/c.totals.commits*100:null,format:v=>v==null?'—':percent(v)},
    {key:'releases',label:'Tagged releases',value:c=>releaseValue(c,'releases'),format:releaseFormat},
    {key:'released_commits',label:'Commits in releases',value:c=>releaseValue(c,'commits'),format:releaseFormat},
    {key:'released_lines',label:'Released changed lines',value:c=>releaseValue(c,'lines'),format:releaseFormat},
    {key:'actor_events',label:'Tag/publish actor events',value:c=>releaseValue(c,'actorEvents'),format:releaseFormat},
    {key:'version',label:'VERSION touches · proxy',value:c=>c.totals.releases},
    {key:'weekend',label:'Weekend %',value:c=>c.totals.commits?c.weekendCommits/c.totals.commits*100:null,format:v=>v==null?'—':percent(v)},
  ];
  const format=(col,raw)=>col.format?col.format(raw):number.format(raw);
  return {columns, rows:sortedContributors(view,releaseEvidence).map(c=>({ c, vals:columns.map(col=>col.value(c)) })), format,releaseEvidence};
}
function renderTable(view) {
  if(!view.contributors.length){ $('scorecard-wrap').innerHTML=empty('No selected contributors.');tableRows=[];return; }
  const data=makeTableData(view);
  tableRows=data.rows;
  $('scorecard-wrap').innerHTML=`<table class="data-table"><thead><tr>${data.columns.map((col,i)=>`<th class="${i?'right':''}" scope="col" ${col.key===state.sortKey?`aria-sort="${state.sortDesc?'descending':'ascending'}"`:''}>${col.key==='name'?esc(col.label):`<button type="button" class="sort-button" data-action="sort-table" data-sort="${col.key}">${esc(col.label)}${state.sortKey===col.key?(state.sortDesc?' ↓':' ↑'):''}</button>`}</th>`).join('')}</tr></thead><tbody>${data.rows.map(({c,vals})=>`<tr>${vals.map((val,i)=>`<td class="${i?'right':'name-cell'}">${i ? esc(data.format(data.columns[i],val)) : data.columns[i].show(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  setText('table-note',`Authored activity and VERSION touches use commit-author dates. Tagged releases, their included commits and released changed lines use release-event dates (${view.start}–${view.end}) and full introduced Git ancestry under the selected merge/revert policy; baseline tags are excluded. Released changed lines exclude VERSION files and binary changes. Tag/publish actor events are metadata, not proof of deployment or authored contribution. ${data.releaseEvidence.available?`${data.releaseEvidence.inRange} incremental tagged release events observed; ${data.releaseEvidence.partialReleases} have partial ancestry.`:'No imported tagged-release evidence — release columns are unavailable, not zero.'} Distinct tags on divergent histories can include overlapping changes. Active days are contributor-days, not distinct team dates. Share denominator: ${view.denominator==='repository'?'repository':'selected cohort'}.`);
}
function copyCsv() {
  if (!analysis) return;
  const data=makeTableData(analysis);
  const quote=value=>`"${String(value).replace(/"/g,'""')}"`;
  const content=[data.columns.map(c=>quote(c.label)).join(','),...data.rows.map(({vals})=>vals.map((v,i)=>quote(i===0?v:data.format(data.columns[i],v))).join(','))].join('\r\n');
  if(!navigator.clipboard) return setText('table-note','Clipboard unavailable in this context.');
  navigator.clipboard.writeText(content).then(()=>setText('table-note',`${data.rows.length} comparison rows copied as CSV. Includes only the selected people and scope.`)).catch(()=>setText('table-note','Clipboard access was blocked.'));
}

function monthIndex(date) { return Number(date.slice(0,4))*12+Number(date.slice(5,7))-1; }
let pulsePreviousMode = null;
let pulsePreviousRange = null;
let pulsePopoverOrigin = null;
let pulsePopoverPinned = false;
let pulseSuppressFocus = false;
let pulseSuppressHoverCell = null;

function closePulseAndRestoreFocus() {
  const origin=pulsePopoverOrigin;
  hidePulsePopover();
  pulseSuppressHoverCell=origin;
  if(origin){
    pulseSuppressFocus=true;
    origin.focus({preventScroll:true});
    pulseSuppressFocus=false;
  }
}

function hidePulsePopover() {
  const popup = $('pulse-popover');
  if (!popup) return;
  popup.hidden = true;
  popup.classList.remove('is-pinned');
  popup.setAttribute('role', 'tooltip');
  pulsePopoverOrigin = null;
  pulsePopoverPinned = false;
}

let stopMotionExplorer = null;
let pulseReleaseGap = null;
let pulseMomentum = null;
let pulseLevel = null;
let pulseContinuity = null;
let pulseTemporal = null;
const pulseTimeSettings = () => ({period:state.pulseTemporalPeriod,churnCap:state.pulseTemporalChurn,meaningfulLines:state.pulseMeaningfulLines});
const clockLabel = minutes => minutes===null||minutes===undefined ? '—' : `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const durationLabel = minutes => minutes===null||minutes===undefined ? 'Unmeasurable' : `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;
const ratioLabel = value => value===null||value===undefined?'—':percent(value*100);
const momentumNumber = value => value == null ? '—' : `${value>0?'+':''}${pulseScore(value)}`;
const momentumState = item => ({
  building:'Building',cooling:'Cooling',steady:'Broadly steady',
  'no-observed-activity':'No observable contribution in either window',
  unknown:'Not enough comparable history',
})[item?.direction||'unknown'];

/** Cool for improving throughput, warm for cooling, neutral for unchanged. */
function pulseMomentumCellStyle(score) {
  if (score === null || !Number.isFinite(score)) return pulseGapCellStyle(null);
  const t=Math.min(1,Math.abs(score)/100);
  const mid=[237,241,236];
  const to=score>=0?[19,119,107]:[181,84,52];
  const blend=(a,b)=>Math.round(a+(b-a)*t);
  const fill=`rgb(${mid.map((c,i)=>blend(c,to[i])).join(' ')})`;
  return `background:${fill};border-color:${fill};color:${t>.65?'#fff':'#2a3933'}`;
}
function pulseMomentumLegend() {
  return `<div class="pulse-gap-legend" role="group" aria-label="Contribution momentum: negative scores indicate cooling, zero is unchanged, positive scores indicate building. Unknown dates are hatched."><span>−100 · cooling</span><span class="pulse-gap-swatches">${[-100,-50,0,50,100].map(score=>`<i style="${pulseMomentumCellStyle(score)}" title="${momentumNumber(score)}" aria-hidden="true"></i>`).join('')}</span><span>+100 · building</span><span class="pulse-gap-missing">▨ · not scored</span></div>`;
}
function pulseActivitySummary(model) {
  return `<div class="pulse-gap-summary-head"><strong>How the contribution is distributed</strong><span>Clock span, substantive activity windows and consistency are descriptive evidence—not hours worked.</span></div>
    <div class="table-scroll"><table class="pulse-gap-table pulse-temporal-table"><thead><tr><th>Contributor</th><th>Meaningful days</th><th>Distributed days</th><th>Mean clock span</th><th>Active windows / measured day</th><th>Clock coverage</th></tr></thead><tbody>
    ${model.rows.map(row=>`<tr><th>${esc(row.name)}</th><td><strong>${ratioLabel(row.consistency)}</strong><small>${number.format(row.meaningfulDays)} of ${number.format(row.coveredDays)} covered workdays</small></td><td><strong>${ratioLabel(row.distributedConsistency)}</strong><small>${number.format(row.distributedDays)} workdays with measured spread + churn</small></td><td><strong>${durationLabel(row.meanSpanMinutes)}</strong><small>${number.format(row.daysWithMeasuredSpan)} measured multi-commit days</small></td><td>${pulseScore(row.meanActivePeriods)}</td><td>${number.format(row.daysWithClock)} / ${number.format(row.coveredDays)} weekdays</td></tr>`).join('')}</tbody></table></div>
    <p class="pulse-gap-caution">Meaningful days have at least ${model.meaningfulLines} non-VERSION changed text lines. Distributed days additionally require timestamps, distinct ${model.period}-minute periods, elapsed authored-clock span and churn in more than one period. A one-commit day has <em>unmeasurable</em> spread, not zero work. Clock times may use different authored timezones; the span is not duration worked. The full available history and chosen merge/revert policy determine each observation.</p>`;
}
function pulseTemporalDailyLabel(item) {
  if(!item || item.status==='no-commits')return 'No authored commits recorded';
  const clock=item.spanMinutes===null?'spread unmeasurable':`${durationLabel(item.spanMinutes)} clock span`;
  return `${item.activePeriods} active time windows; ${clock}; ${number.format(item.churn)} non-VERSION changed lines; distribution ${item.distribution===null?'unknown':ratioLabel(item.distribution)}`;
}
function pulseTemporalDayDetails(item) {
  if(!item)return '';
  const options=pulseTimeSettings();
  const slots=Array.from({length:Math.ceil(1440/options.period)},(_,i)=>{
    const record=item.buckets.find(bucket=>bucket.index===i);
    const fraction=record?Math.min(1,record.churn/options.churnCap):0;
    const top=clockLabel(i*options.period),bottom=clockLabel(Math.min(1439,(i+1)*options.period));
    return `<span class="pulse-temporal-slot ${record?'is-present':''}" style="--period-strength:${fraction}" title="${esc(`${top}–${bottom} · ${record?.commits||0} commits · ${record?.churn||0} substantive changed lines`)}" aria-hidden="true"></span>`;
  }).join('');
  const message=({ 'no-commits':'No commits observed on this date', 'no-time':'No usable authored-clock timestamps', single:'One timed commit cannot establish a spread', partial:'Some commit times are missing; distribution is partial', 'mixed-zones':'Mixed authored timezone offsets; a continuous span cannot be inferred', observed:'Timed changes across the authored clock' })[item.status];
  const clock=item.firstMinute===null?'—':`${clockLabel(item.firstMinute)}–${clockLabel(item.lastMinute)}`;
  return `<section class="pulse-temporal-detail" aria-label="Recorded activity distribution"><div class="pulse-temporal-heading"><span class="eyebrow">ACTIVITY SPREAD · CHURN-WEIGHTED WINDOWS</span><strong>${item.distribution===null?'Unmeasurable':ratioLabel(item.distribution)}</strong></div>
    <div class="pulse-temporal-times"><span>${esc(clock)}</span><span>${item.spanMinutes===null?'Unknown clock span':`${durationLabel(item.spanMinutes)} · clock range, not working time`}</span></div>
    <div class="pulse-temporal-track" style="--period-count:${Math.ceil(1440/options.period)}" role="img" aria-label="${esc(`Authored local clock from midnight to midnight in ${options.period}-minute windows; ${item.activePeriods} active windows; ${item.substantivePeriods} with changed text lines.`)}">${slots}</div>
    <div class="pulse-temporal-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    <div class="pulse-temporal-stats"><span><b>${number.format(item.timedCommits)} / ${number.format(item.commits)}</b> timed commits</span><span><b>${number.format(item.activePeriods)}</b> active periods</span><span><b>${number.format(item.weightedPeriodUnits)}</b> capped churn-period units</span><span><b>${item.meaningful?'Yes':'No'}</b> meaningful day</span></div>
    <small>${esc(message)}. Distribution requires activity across distinct windows and substantive churn beyond the largest window; VERSION-only changes earn no churn credit. No inference of work hours or productivity.</small></section>`;
}

function levelText(value) { return value===null||!Number.isFinite(value)?'—':new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(value); }
function levelPeerText(peer,{short=false}={}) {
  if(!peer||peer.peers===0)return (pulseLevel?.rows.length||0)>1?'No comparable peer history':'No selected peers';
  if(peer.reference===null)return 'Peer median unavailable';
  if(peer.reference===0)return 'Peer median 0 · ratio unavailable';
  return peer.ratio===null?'Not comparable':`${decimal.format(peer.ratio)}× ${short?'peer median':'other-contributor median'} (${levelText(peer.reference)})`;
}
function pulseLevelSummary(model) {
  return `${!model.available?'<p class="pulse-gap-unavailable">No covered dates in this view; missing history cannot be interpreted as zero.</p>':''}
    <div class="pulse-gap-summary-head"><strong>Absolute recorded velocity</strong><span>Fixed-scale daily index; these recent values summarise the latest ${model.workdays} covered working days through the chosen end date. The coloured cells show the selected dates without peer normalisation.</span></div>
    <div class="table-scroll"><table class="pulse-gap-table pulse-level-table"><thead><tr><th>Contributor</th><th>Selected mean / calendar day</th><th>Recent velocity / workday</th><th>Authored commits</th><th>Non-VERSION lines</th><th>Lines introduced in releases</th><th>Meaningful workdays</th><th>Distributed workdays</th></tr></thead><tbody>
    ${[...model.rows].sort((a,b)=>(b.averageLevel??-1)-(a.averageLevel??-1)).map(row=>`<tr><th>${esc(row.name)}</th><td><strong>${levelText(row.averageLevel)}</strong><small>${row.coveredDays} covered dates</small></td><td><strong>${levelText(row.recentLevel)}</strong><small>${row.recent?`as of ${formatDate(row.recent.asOf)}`:'Prior history insufficient'}</small></td><td>${number.format(row.commits)}</td><td>${number.format(row.churn)}</td><td>${number.format(row.releaseLines)}</td><td>${row.consistency===null?'—':`${ratioLabel(row.consistency)}<small>${row.meaningfulDays} / ${row.coveredWorkdays}</small>`}</td><td>${row.distributedConsistency===null?'—':`${ratioLabel(row.distributedConsistency)}<small>${row.distributedDays} / ${row.coveredWorkdays}</small>`}</td></tr>`).join('')}</tbody></table></div>
    <p class="pulse-gap-caution">Daily index = 25% log-scaled authored commits (4 = 1 reference unit) + 45% log-scaled non-VERSION changed lines (200 = 1 reference unit) + 20% log-scaled authored lines introduced in incremental tagged releases (200 = 1 reference unit) + 10% churn-weighted temporal distribution. The combined reference mix gives 1.0 index unit; this is a mathematical scale, <em>not</em> a work quota. The value has no upper cap. Each monthly cell averages the day-level index over covered calendar days, including quiet days; each daily cell uses that date's index. The <strong>fixed colour legend</strong> does not depend on selected contributors, time windows or their maximum value. Recent workday velocity separately combines 80% daily index and 20% meaningful-day consistency. These are recorded change proxies, not working hours or quality.</p>`;
}
function pulseLevelDailyLabel(person,item) {
  if(!item)return `${person}: no recorded date evidence`;
  if(item.reason!=='scored')return `${person}, ${formatDate(item.date)}: outside imported history; index not available`;
  return `${person}, ${formatDate(item.date)}: absolute recorded velocity ${levelText(item.level)} index; ${item.commits} authored commits, ${number.format(item.churn)} non-VERSION changed lines, ${number.format(item.releaseLines)} authored changed lines included in tagged releases; ${pulseTemporalDailyLabel(item.temporal)}.`;
}
function pulseLevelDayDetails(item) {
  if(!item)return '';
  return `<div class="pulse-level-detail"><span class="eyebrow">ABSOLUTE VELOCITY · FIXED SCALE</span><div class="pulse-gap-detail-top"><strong>${levelText(item.level)}${item.level!==null?' index':''}</strong><span>${item.reason==='scored'?'Daily recorded contribution index':'Outside imported history · unscored'}</span></div><div class="pulse-gap-detail-facts"><span>Authored commits <b>${number.format(item.commits)}</b></span><span>Non-VERSION changed lines <b>${number.format(item.churn)}</b></span><span>Authored lines in tagged releases <b>${number.format(item.releaseLines)}</b></span><span>Churn-weighted distribution <b>${item.temporal?.distribution===null?'Unknown':ratioLabel(item.temporal.distribution)}</b></span><span>Meaningful authored day <b>${item.temporal?.meaningful?'Yes':'No'}</b></span></div><small>The same numeric index always has the same colour regardless of who is selected. This index is not a measurement of effort, hours or work quality; weekend release tags are credited on the next workday.</small></div>`;
}
function pulseLevelMonthLabel(person,month,bucket) {
  if(!bucket)return `${person}, ${month}: no imported evidence`;
  return `${person}, ${month}: absolute velocity ${levelText(bucket.score)} index per covered calendar day across ${bucket.days} days; ${bucket.commits} authored commits, ${number.format(bucket.churn)} non-VERSION changed lines, ${number.format(bucket.releaseLines)} authored lines included in releases; ${bucket.meaningfulDays} meaningful workdays.`;
}

function pulseMomentumDailyLabel(person,item) {
  const base=`${person}, ${formatDate(item.date)}: ${number.format(item.commits)} authored commits and ${number.format(item.churn)} non-VERSION changed lines`;
  if(item.reason==='outside-history')return `${base}; outside imported evidence, not scored`;
  if(item.reason==='weekend')return `${base}; weekend, not scored`;
  if(item.reason==='insufficient-history')return `${base}; insufficient prior workdays, not scored`;
  return `${base}; ${number.format(item.releaseLines)} changed lines shipped in credited releases; momentum ${momentumNumber(item.score)} (${momentumState(item)}); recent ${pulseScore(item.recent.pace)} versus prior ${pulseScore(item.previous.pace)} contribution pace; ${pulseTemporalDailyLabel(item.temporal)}; recent meaningful days ${item.recent.meaningfulDays} versus ${item.previous.meaningfulDays}`;
}
function pulseMomentumSummary(model,levelModel=null) {
  const latest=row=>row.latest ? `${momentumNumber(row.latest.score)} · ${momentumState(row.latest)} · ${formatDate(row.latest.date)}` : 'Not established';
  return `${!model.available?'<p class="pulse-gap-unavailable">No comparable full workday windows in this range. The trend requires complete prior evidence; missing history is not interpreted as a decline.</p>':''}<div class="pulse-gap-summary-head"><strong>Contribution direction and recorded velocity</strong><span>Momentum compares each person with their own earlier pace. Recent absolute recorded velocity provides a separate magnitude reference, including when directional change is near zero.</span></div>
    <div class="table-scroll"><table class="pulse-gap-table"><thead><tr><th>Contributor</th><th>Latest momentum</th><th>Recent absolute velocity</th><th>Other-contributor median (context only)</th><th>Recent pace / day</th><th>Previous pace / day</th><th>Meaningful days recent / prior</th><th>Distributed days recent / prior</th><th>Mean directional score</th><th>Building days</th><th>Cooling days</th><th>Workdays scored</th></tr></thead><tbody>
    ${model.rows.map(row=>`<tr><th>${esc(row.name)}</th><td>${latest(row)}</td><td><strong>${levelText(levelModel?.byId.get(row.id)?.recentLevel)}</strong></td><td>${esc(levelPeerText(levelModel?.byId.get(row.id)?.peer))}</td><td>${pulseScore(row.latest?.recent?.pace)}</td><td>${pulseScore(row.latest?.previous?.pace)}</td><td>${row.latest?`${row.latest.recent.meaningfulDays} / ${row.latest.previous.meaningfulDays}`:'—'}</td><td>${row.latest?`${row.latest.recent.distributedDays} / ${row.latest.previous.distributedDays}`:'—'}</td><td>${momentumNumber(row.averageScore)}</td><td>${number.format(row.buildingDays)}</td><td>${number.format(row.coolingDays)}</td><td>${number.format(row.scoredDays)}</td></tr>`).join('')}</tbody></table></div>
    <p class="pulse-gap-caution">Daily contribution units blend 25% commits (cap 4/day), 45% non-VERSION line churn (cap 200/day), 15% churn-weighted time distribution, and 15% authored lines introduced in tagged releases (cap 200/day, weekend tags credited on the next workday). Comparison pace = 75% mean daily contribution units + 25% meaningful-day consistency (workdays with at least ${model.temporal.meaningfulLines} non-VERSION changed lines). Momentum = 100 × (recent pace − previous pace) / (recent pace + previous pace + 0.1). Scores ≥ +${MOMENTUM_DIRECTION_THRESHOLD} are building, ≤ −${MOMENTUM_DIRECTION_THRESHOLD} cooling. Monthly cells average eligible daily scores; positive and negative periods can cancel. No release is required for momentum to be measurable. Squashes, pairing, reviews, binary files, generated churn, holiday schedules and unseen work can all distort this view. It is not a performance rating.</p>`;
}
function pulseMomentumDayDetails(item) {
  if(!item)return '';
  const message={weekend:'Weekend · not scored','outside-history':'Outside imported history · not scored',
    'insufficient-history':'Requires complete preceding comparison workdays · not scored'};
  const releases=item.releases.length?item.releases.map(r=>`${esc(r.tag)} (${number.format(r.lines)} lines${r.complete?'':', partial ancestry'})`).join(' · '):'None on this workday';
  return `<div class="pulse-momentum-detail"><span class="eyebrow">RECENT ACTIVITY VERSUS YOUR PRIOR PERIOD</span><div class="pulse-gap-detail-top"><strong>${momentumNumber(item.score)}</strong><span>${esc(message[item.reason]||momentumState(item))}</span></div><div class="pulse-gap-detail-facts"><span>Today's authored commits <b>${number.format(item.commits)}</b></span><span>Today's authored non-VERSION line churn <b>${number.format(item.churn)}</b></span><span>Tagged release contribution credited today <b>${number.format(item.releaseLines)} lines · ${releases}</b></span><span>Recent blended pace / workday <b>${pulseScore(item.recent?.pace)}</b></span><span>Previous blended pace / workday <b>${pulseScore(item.previous?.pace)}</b></span><span>Recent / previous authored commits <b>${item.recent?`${number.format(item.recent.commits)} / ${number.format(item.previous.commits)}`:'—'}</b></span><span>Recent / previous non-VERSION lines <b>${item.recent?`${number.format(item.recent.churn)} / ${number.format(item.previous.churn)}`:'—'}</b></span><span>Recent / previous shipped lines <b>${item.recent?`${number.format(item.recent.releaseLines)} / ${number.format(item.previous.releaseLines)}`:'—'}</b></span><span>Meaningful workdays, recent / previous <b>${item.recent?`${item.recent.meaningfulDays} / ${item.previous.meaningfulDays}`:'—'}</b></span><span>Distributed workdays, recent / previous <b>${item.recent?`${item.recent.distributedDays} / ${item.previous.distributedDays}`:'—'}</b></span></div><small>The score describes change in recorded contribution compared with this person's own earlier window, not quality, effort, or expected availability. Activity outside Git is not observed.</small></div>`;
}

const pulseScore = value => value === null || value === undefined ? '—' : decimal.format(value);
const pulseCredit = event => event ? `${decimal.format(event.credit * 100)}%` : '—';

/** Distinct warm scale for an attention signal; activity retains the green palette. */
function pulseGapCellStyle(score) {
  if (score === null || !Number.isFinite(score)) return 'background:repeating-linear-gradient(135deg,#f7f8f5 0px,#f7f8f5 5px,#e2e8e0 5px,#e2e8e0 10px);border-color:#dae1d8';
  if (score === 0) return 'background:#edf1ec;border-color:#d5ded4';
  const t = Math.min(1, Math.max(0,score/100));
  const blend=(a,b)=>Math.round(a+(b-a)*t);
  const fill=`rgb(${blend(251,146)} ${blend(225,42)} ${blend(186,37)})`;
  return `background:${fill};border-color:${fill};color:${t>.59?'#fff':'#493024'}`;
}
function pulseGapLegend() {
  return `<div class="pulse-gap-legend" role="group" aria-label="Combined signal from zero to one hundred, fixed across contributors and date ranges. Unavailable and weekend values are hatched."><span>0 · neutral</span><span class="pulse-gap-swatches">${[0,25,50,75,100].map(score=>`<i style="${pulseGapCellStyle(score)}" title="${score} of 100" aria-hidden="true"></i>`).join('')}</span><span>100 · high signal</span><span class="pulse-gap-missing">▨ · not scored</span></div>`;
}
function pulseGapDailyLabel(person,cell) {
  const base=`${person}, ${formatDate(cell.date)}: ${number.format(cell.commits)} authored commits and ${number.format(cell.churn)} non-VERSION changed lines`;
  if (cell.reason==='outside-history') return `${base}; outside imported history, no signal`;
  if (cell.reason==='weekend') return `${base}; weekend, not scored`;
  if (cell.reason==='no-prior-contribution') return `${base}; no measurable non-VERSION line changes in an earlier incremental tagged release, score unavailable`;
  const release=cell.lastRelease;
  return `${base}; ${cell.daysSinceRelease} calendar days since ${release.tag}, ${number.format(release.linesChanged)} authored changed lines (${pulseCredit(release)} reset credit); effective gap ${pulseScore(cell.effectiveGapDays)} days; ${pulseTemporalDailyLabel(cell.temporal)}; combined signal ${pulseScore(cell.score)} of 100`;
}
function pulseGapSummary(model) {
  const latest=row=>row.latestRelease ? `${esc(row.latestRelease.tag)} · ${formatDate(row.latestRelease.date)}` : 'Not observed';
  const credit=row=>row.latestRelease ? `${number.format(row.latestRelease.linesChanged)} lines · ${pulseCredit(row.latestRelease)}` : '—';
  return `${!model.rows.some(row=>row.scoredDays)?'<p class="pulse-gap-unavailable">No eligible weekdays have a measurable authored contribution to an incremental tagged release in this date range. Hatched cells are unknown, not zero.</p>':''}<div class="pulse-gap-summary-head"><strong>Individual release-gap context</strong><span>Absolute contribution credit, not a measure of performance or a contributor ranking.</span></div>
    <div class="table-scroll"><table class="pulse-gap-table"><thead><tr><th>Contributor</th><th>Latest credited release</th><th>Author's lines / credit</th><th>Calendar gap</th><th>Weighted gap</th><th>Mean daily signal</th><th>Days ≥ ${ATTENTION_THRESHOLD}</th><th>Weekdays scored</th></tr></thead><tbody>
    ${model.rows.map(row=>`<tr><th>${esc(row.name)}</th><td>${latest(row)}</td><td>${credit(row)}</td><td>${row.latestGap===null?'—':`${row.latestGap} days`}</td><td>${row.latestEffectiveGap===null?'—':`${pulseScore(row.latestEffectiveGap)} / ${model.horizon} days`}</td><td>${pulseScore(row.averageScore)}${row.averageScore===null?'':' / 100'}</td><td>${number.format(row.attentionDays)}</td><td>${number.format(row.scoredDays)}</td></tr>`).join('')}</tbody></table></div>
    <p class="pulse-gap-caution">A release reduces the accumulated gap by min(your recorded changed text lines / ${model.fullCreditLines}, 100%). Additions and deletions count; VERSION-only, zero-line and driver-only events earn no reset credit. Release ancestry is computed before the selected date window; line counts can be inflated by generated files or miss binary and unrecorded work. Daily authored churn also softens the score: the quiet-day factor multiplies max(1 − commits / ${model.busyDay}, 0) by max(1 − non-VERSION daily changed lines / ${model.busyChurn}, 0). Additionally, distributed substantive authored activity can soften at most ${Math.round(MAX_GAP_DISTRIBUTION_RELIEF*100)}% of the remaining daily signal; it cannot reset release credit, and unknown timestamps earn no extra relief. The first observed measurable release starts from an unknown earlier history, conservatively treated as a full gap before credit. A missing or quiet Git day is <em>not</em> evidence of inactivity, delivery responsibility, availability, or quality.</p>`;
}


// Compact, independent missing/extra scales. Release inclusion stays below.
const continuityPct=value=>value===null||value===undefined?'—':`${Math.round(value*100)}%`;
const continuityReleaseRatio=(count,opportunities,available)=>!available?'Unknown':!opportunities?'No eligible tags':`${count} / ${opportunities} releases`;
const continuityBandStyle=colour=>colour?`background:${colour}`:'background:repeating-linear-gradient(135deg,#f7f8f5 0,#f7f8f5 4px,#dfe5e0 4px,#dfe5e0 8px)';
const continuityStatusLabel=status=>({met:'Expected count met',above:'Above expected count', 'slightly-under':'Modest count shortfall',under:'Below expected count',mixed:'Under and over across weeks',unknown:'Unknown', 'no-schedule':'No scheduled reference','extra-only':'Recorded days, no expected baseline'})[status]||'Unknown';
const continuityCountLabel=(meaningful,expected)=>expected?`${meaningful}/${expected} qualifying days`:`${meaningful} qualifying days · no baseline`;
const continuityWeeklyLabel=day=>day?.weeklyMeaningfulDays===null?'Week not available':
  `${continuityCountLabel(day.weeklyMeaningfulDays,day.weeklyExpectedDays)}; ${continuityStatusLabel(day.weeklyStatus)}`;
function continuityDayLabel(person,item) {
  if(!item||!item.observed)return `${person}: authored history unavailable for this date`;
  const activity=item.workday?(item.meaningful?'qualifying change on a named scheduled date':item.authored?'small change on a named scheduled date, below threshold':'no qualifying change on a named scheduled date'):
    (item.meaningful?'qualifying change outside the named weekday pattern':item.authored?'small off-pattern change, below threshold':'no qualifying off-pattern change');
  return `${person}, ${formatDate(item.date)}: ${item.commits} authored commits, ${number.format(item.churn)} non-VERSION changed lines; ${activity}. Week: ${continuityWeeklyLabel(item)}. ${continuityReleaseRatio(item.events.length,item.opportunities,item.releaseAvailable)}. Rolling ${pulseContinuity.weeks}-week balance: ${item.rollingShortfallDays===null?'unknown':`−${item.rollingShortfallDays} days under`} and ${item.rollingOverageDays===null?'unknown':`+${item.rollingOverageDays} days over`}. View evidence.`;
}
function continuityPeriodLabel(person,bucket,model) {
  if(!bucket)return `${person}: period outside imported data`;
  return `${person}, ${bucket.from}–${bucket.to}: ${continuityStatusLabel(bucket.status)}; ${continuityCountLabel(bucket.meaningfulDays,bucket.expectedDays)}. Weekly count balance: −${bucket.shortfallDays} under, +${bucket.overageDays} over; weekday breakdown: ${bucket.onScheduleDays} named dates met, ${bucket.missedDays} named dates missed, ${bucket.extraDays} off-pattern qualifying days, ${bucket.substitutionDays} substitutions. ${bucket.unknownDays} dates outside imported bounds. ${continuityReleaseRatio(bucket.participations,bucket.opportunities,model.releaseAvailable)}. ${number.format(bucket.releasedCommits)} released commits, ${bucket.releasedLines===null?'unknown':number.format(bucket.releasedLines)} released changed lines. View evidence.`;
}
function continuityTile(bucket,model,{daily=false}={}) {
  const observed=daily?bucket?.observed:bucket?.observedDays>0;
  const expected=daily?Number(observed&&bucket.workday):bucket?.expectedDays||0;
  const shortfall=daily?0:bucket?.shortfallDays||0;
  const overage=daily?0:bucket?.overageDays||0;
  // A single weekday is evidence, not a failed weekly quota. Daily cells
  // therefore show whether a qualifying change was recorded; the hover gives
  // the count-first status of the containing week.
  const missingColour=daily?(observed?bucket.meaningful?'#d1e7da':bucket.authored?'#dfe9e5':'#edf1ed':null):
    missingDayColour(shortfall,expected,observed);
  const extraColour=extraDayColour(overage);
  const mainText=!observed?'':daily?(bucket.meaningful?'•':bucket.authored?'·':'–'):
    (shortfall?`−${shortfall}`:expected?'=':'—');
  const extraText=overage?`+${overage}`:'';
  const releases=daily?bucket?.events.length||0:bucket?.participations||0;
  const opportunities=bucket?.opportunities||0;
  const releaseColour=continuityReleaseColour(releases,opportunities,model.releaseAvailable);
  const releaseText=daily?'':!model.releaseAvailable?'?':!opportunities?'·':releases?`${releases}r`:'0r';
  const dark=observed&&!daily&&expected>0&&shortfall/expected>2/3;
  const extraDark=overage>=3;
  const noBaseline=!daily&&observed&&expected===0&&bucket.meaningfulDays>0;
  const secondary=noBaseline?`<span class="continuity-extra-mark" style="background:${extraDayColour(bucket.meaningfulDays)};color:${bucket.meaningfulDays>=3?'#fff':'#154660'}" title="No expected baseline; recorded days, not overage">${bucket.meaningfulDays}d</span>`:
    extraText?`<span class="continuity-extra-mark" style="background:${extraColour};color:${extraDark?'#fff':'#154660'}">${extraText}</span>`:'';
  return `<span class="continuity-schedule-balance" aria-hidden="true"><span class="continuity-missing-mark" style="${continuityBandStyle(missingColour)};color:${dark?'#fff':'#473e36'}">${mainText}</span>${secondary}</span><span class="continuity-band continuity-delivered" style="${continuityBandStyle(releaseColour)};color:${model.releaseAvailable&&opportunities>0&&releases/opportunities>=0.6?'#fff':'#193d36'}" aria-hidden="true">${releaseText}</span>`;
}
function pulseContinuityLegend() {
  return `<div class="continuity-legend" role="group" aria-label="Weekly count-first comparison: green when total qualifying days meet the expected number, amber or red for missing days, blue for days above the expected number. Exact weekday adherence is in the breakdown; tagged-release inclusion is a separate bottom track.">
    <span class="continuity-legend-label">Qualifying days vs weekly expectation</span>
    <span class="continuity-legend-key"><i style="background:${missingDayColour(0,4)}" aria-hidden="true"></i>= expected count met (including substitutions)</span>
    <span class="continuity-legend-key"><i style="background:${missingDayColour(1,4)}" aria-hidden="true"></i>− up to ⅓ of expected days · modest</span>
    <span class="continuity-legend-key"><i style="background:${missingDayColour(2,4)}" aria-hidden="true"></i>− ⅓–⅔ of expected days · below</span>
    <span class="continuity-legend-key"><i style="background:${missingDayColour(3,4)}" aria-hidden="true"></i>− over ⅔ of expected days · larger gap</span>
    <span class="continuity-legend-label">Days above expected count</span>
    <span class="continuity-legend-key"><i style="background:${extraDayColour(1)}" aria-hidden="true"></i>+1</span>
    <span class="continuity-legend-key"><i style="background:${extraDayColour(2)}" aria-hidden="true"></i>+2</span>
    <span class="continuity-legend-key"><i style="background:${extraDayColour(3)}" aria-hidden="true"></i>+3 or more</span>
    <span class="continuity-legend-key"><i style="background:${continuityReleaseColour(1,1)}" aria-hidden="true"></i>Tagged-release inclusion (bottom; r = releases)</span>
    <span class="continuity-legend-key"><i class="continuity-unknown" aria-hidden="true"></i>Unobserved / unknown</span>
  </div>`;
}
function pulseContinuitySummary(model) {
  if(!model.available)return '<p class="pulse-gap-unavailable">No comparable authored-history bounds are available. Continuity cannot treat missing observations as quiet scheduled dates.</p>';
  const overview=model.rows.map(row=>{
    const weeks=[...row.weeks.values()].filter(w=>w.observedDays>0&&w.expectedDays>0);
    const met=weeks.filter(w=>w.shortfallDays===0).length;
    const over=weeks.filter(w=>w.overageDays>0).length;
    const under=weeks.filter(w=>w.shortfallDays>0).length;
    const schedule=row.workingDays.length;
    return `<div class="continuity-overview-row"><span class="continuity-overview-person">${esc(row.name)}<small>${schedule}-day weekly reference</small></span><span class="continuity-overview-pace"><strong>${met}/${weeks.length||'—'}</strong><small>weeks meeting count</small></span><span class="continuity-overview-missing" style="background:${missingDayColour(row.shortfallDays,row.expectedDays)};color:${row.expectedDays&&row.shortfallDays/row.expectedDays>2/3?'#fff':'#35453c'}">${row.expectedDays?(row.shortfallDays?`−${row.shortfallDays}`:'='):'—'}<small>days short across weeks</small></span><span class="continuity-overview-extra" style="background:${extraDayColour(row.overageDays)};color:${row.overageDays>=3?'#fff':'#35453c'}">+${row.overageDays}<small>days over across weeks</small></span><span class="continuity-overview-weeks"><strong>${row.meaningfulDays} qualifying / ${row.expectedDays} expected dates</strong><small>${under} under · ${over} over · ${row.substitutionDays} substitutes for named dates</small></span></div>`;
  }).join('');
  return `<div class="pulse-gap-summary-head"><strong>Weekly contribution count vs personal reference</strong><span>${model.from}–${model.to} · total days meeting the weekly count take priority; named weekday differences are supporting evidence</span></div>
    <div class="continuity-overview" aria-label="Weekly count-first continuity overview by contributor">${overview}</div>
    <div class="continuity-summary-scroll table-scroll"><table class="pulse-gap-table continuity-summary-table"><thead><tr><th>Contributor</th><th>Weekly reference</th><th>Qualifying / expected days</th><th>Weekly count shortfall</th><th>Weekly count overage</th><th>Named weekday breakdown</th><th>Longest named-day gap</th><th>Release participation</th><th>Commits in releases</th><th>Released changed lines</th><th>Rolling ${model.weeks}-week balance</th></tr></thead><tbody>
    ${model.rows.map(row=>`<tr><th>${esc(row.name)}</th><td><strong>${row.expectedPerWeek}/week</strong><small>${esc(row.workingDays.map(d=>WEEKDAY_LABELS[d]).join(', ')||'No scheduled dates')}</small></td><td><strong>${row.meaningfulDays} / ${row.expectedDays||'—'}</strong><small>${row.unknownDays?`${row.unknownDays} unobserved dates`: 'All selected dates observed'}</small></td><td><strong>−${row.shortfallDays}</strong><small>${continuityStatusLabel(row.status)}</small></td><td><strong>+${row.overageDays}</strong><small>Beyond each week's expected count</small></td><td><strong>${row.onScheduleDays} named dates met</strong><small>${row.missedDays} scheduled dates missed · ${row.extraDays} off-pattern days · ${row.substitutionDays} substitutions</small></td><td><strong>${row.longestGap.workdays} scheduled dates</strong><small>${row.longestGap.from?`${row.longestGap.from}–${row.longestGap.to}`:'No measured scheduled-date gap'}</small></td><td><strong>${continuityReleaseRatio(row.participations,row.opportunities,row.releaseAvailable)}</strong><small>${row.releaseParticipation===null?'Rate undefined':`${continuityPct(row.releaseParticipation)} of eligible incremental tags`}</small></td><td>${!row.releaseAvailable?'—':number.format(row.releasedCommits)}</td><td>${!row.releaseAvailable||row.releasedLines===null?'—':number.format(row.releasedLines)}</td><td><strong>${row.rollingShortfallDays===null?'—':`−${row.rollingShortfallDays}`} / ${row.rollingOverageDays===null?'—':`+${row.rollingOverageDays}`}</strong><small>${row.rollingShortfallDays===null?'Full history unavailable':`Shortfall / overage by calendar-week segments`}</small></td></tr>`).join('')}</tbody></table></div>
    <p class="pulse-gap-caution">A qualifying date has at least ${model.meaningfulLines} authored non-VERSION changed lines. Each contributor has a 0–7-day named weekly reference (older sessions default to Mon–Fri). <strong>Primary measure:</strong> compare the number of distinct qualifying dates with the expected number for each observed week. A Friday contribution can replace a missed Thursday: four qualifying days against a four-day reference means met, regardless of dates. A fifth qualifying date is +1 overage; only two means −2 shortfall. Weekly deficits and surpluses remain separate in selected-period and rolling totals; a busy week cannot erase a quiet one. <strong>Breakdown:</strong> named dates met, named dates missed, off-pattern contributions and substitutions remain visible. Monthly cells sum each calendar-week slice inside that month, so a week crossing month boundaries can appear in both monthly breakdowns; the Weekly view is authoritative for a complete week's outcome. Unknown dates aren't counted as absence; a zero-day reference has no meaningful quota or percentage. Release participation remains a separate authored/tag-event measure. These are Git activity observations, not evidence of contracted attendance, hours worked or performance.</p>`;
}
function pulseContinuityDayDetails(item) {
  if(!item)return '';
  const ship=item.events.length?item.events.map(r=>`<li><strong>${esc(r.tag)}</strong> <span>${number.format(r.commits)} included commits · ${r.lines===null?'unknown':number.format(r.lines)} non-VERSION changed lines${r.partial?' · partial ancestry':''}</span></li>`).join(''):item.releaseAvailable?'<li>No authored contribution included in a tagged release on this date.</li>':'<li>Incremental tagged-release evidence is unavailable.</li>';
  const observation=item.workday?(item.meaningful?'Qualifying contribution on a named scheduled date.':item.authored?'Small change on a named scheduled date, below threshold.':'No qualifying contribution on a named scheduled date.'):
    (item.meaningful?'Qualifying contribution outside the named weekday pattern.':item.authored?'Small off-pattern change, below threshold.':'Unscheduled date without qualifying changes.');
  return `<section class="continuity-popover-section"><span class="eyebrow">CONTRIBUTION CONTINUITY · COUNT-FIRST WEEKLY EVIDENCE</span><div class="continuity-popover-stats"><span><strong>${item.weeklyMeaningfulDays??'—'} / ${item.weeklyExpectedDays??'—'}</strong>qualifying vs expected dates in selected week</span><span><strong>${continuityStatusLabel(item.weeklyStatus)}</strong>weekly count status</span><span><strong>${item.observed?number.format(item.churn):'—'}</strong>non-VERSION authored lines</span><span><strong>${item.observed?item.commits:'—'}</strong>authored commits</span><span><strong>${item.workday?'Named expected':'Off-pattern'}</strong>date in weekly pattern</span><span><strong>${item.rollingShortfallDays===null?'—':`−${item.rollingShortfallDays}`} / ${item.rollingOverageDays===null?'—':`+${item.rollingOverageDays}`}</strong>trailing ${pulseContinuity.weeks}-week count shortfall / overage</span><span><strong>${continuityReleaseRatio(item.events.length,item.opportunities,item.releaseAvailable)}</strong>tagged release inclusion</span></div><p>${item.observed?observation:'Outside the imported observation window; no absence is inferred.'} Named weekday adherence is supporting evidence; this single day does not determine whether the weekly quota is met.</p><ul class="continuity-release-events">${ship}</ul></section>`;
}
function pulseContinuityPeriodMarkup(person,bucket,model) {
  const events=bucket.events.length?bucket.events.map(event=>`<li><strong>${esc(event.tag)}</strong> · ${esc(event.date)}<span>${number.format(event.commits)} authored commits · ${event.lines===null?'unknown':number.format(event.lines)} changed lines${event.partial?' · partial ancestry':''}</span></li>`).join(''):model.releaseAvailable?'<li>No authored contributions to eligible tagged releases in this interval.</li>':'<li>Incremental tagged-release evidence is unavailable.</li>';
  return `<div class="pulse-tip-heading"><div><span class="eyebrow">CONTRIBUTION CONTINUITY · PERIOD EVIDENCE</span><strong>${esc(bucket.from)} – ${esc(bucket.to)}</strong><span>${esc(person)}</span></div><button type="button" class="pulse-tip-close" data-action="close-pulse" aria-label="Close period details">×</button></div><section class="continuity-popover-section"><span class="eyebrow">PRIMARY · WEEKLY DAY COUNTS</span><div class="continuity-popover-stats"><span><strong>${continuityStatusLabel(bucket.status)}</strong>count-first status</span><span><strong>${bucket.meaningfulDays} / ${bucket.expectedDays||'—'}</strong>qualifying vs expected dates</span><span><strong>−${bucket.shortfallDays}</strong>days below expected across week segments</span><span><strong>+${bucket.overageDays}</strong>days above expected across week segments</span></div><p>A named weekday can be substituted by another qualifying day within the same week. Weekly surpluses do not cancel deficits in other weeks.</p></section><section class="continuity-popover-section"><span class="eyebrow">BREAKDOWN · NAMED DAYS, SUBSTITUTIONS AND ACTIVITY</span><div class="continuity-popover-stats"><span><strong>${bucket.onScheduleDays} / ${bucket.expectedDays}</strong>named dates with meaningful activity</span><span><strong>${bucket.missedDays}</strong>named dates without qualifying activity</span><span><strong>${bucket.extraDays}</strong>off-pattern meaningful dates</span><span><strong>${bucket.substitutionDays}</strong>dates substituting for missed named dates</span><span><strong>${bucket.smallDays + bucket.weekendSmallDays}</strong>dates with smaller recorded changes</span><span><strong>${bucket.commits}</strong>authored commits</span><span><strong>${number.format(bucket.churn)}</strong>non-VERSION changed lines</span><span><strong>${bucket.rollingShortfallDays===null?'—':`−${bucket.rollingShortfallDays}`} / ${bucket.rollingOverageDays===null?'—':`+${bucket.rollingOverageDays}`}</strong>trailing ${model.weeks}-week count shortfall / overage</span></div>${bucket.unknownDays?`<p>${bucket.unknownDays} date(s) outside the imported observation window; not counted as missing.</p>`:''}${!bucket.expectedDays?'<p>No expected reference dates in this observed selection; recorded activity cannot be expressed as a percentage of zero.</p>':''}</section><section class="continuity-popover-section"><span class="eyebrow">TAG EVENT DATE · RELEASE PARTICIPATION</span><div class="continuity-popover-stats"><span><strong>${continuityReleaseRatio(bucket.participations,bucket.opportunities,model.releaseAvailable)}</strong>authored release participation</span><span><strong>${!model.releaseAvailable?'—':number.format(bucket.releasedCommits)}</strong>commits in releases</span><span><strong>${!model.releaseAvailable||bucket.releasedLines===null?'—':number.format(bucket.releasedLines)}</strong>released changed lines</span></div><ul class="continuity-release-events">${events}</ul></section><p class="pulse-tip-note">Only observed dates count toward the chosen reference. Monthly count balances group observed dates by calendar-week slices inside that month. The Weekly lens gives the complete week's outcome. Tagged releases use tag-event dates, not commit-authored dates. Git evidence is not a measure of hours worked or availability.</p>`;
}
function renderContinuityPeriodPulse(view,mode) {
  const model=pulseContinuity;
  const weeks=mode==='weekly';
  const keys=weeks?Array.from({length:Math.floor((dayNumber(view.end)-dayNumber(mondayOf(view.start)))/7)+1},(_,i)=>dateAtDay(dayNumber(mondayOf(view.start))+i*7)):
    Array.from({length:monthIndex(view.end)-monthIndex(view.start)+1},(_,i)=>{
      const month=monthIndex(view.start)+i;return `${Math.floor(month/12)}-${String(month%12+1).padStart(2,'0')}`;
    });
  const columns=`minmax(142px,176px) repeat(${keys.length}, minmax(${weeks?'68':'76'}px, 1fr))`;
  const axis=keys.map(key=>`<span class="continuity-axis-label" title="${esc(key)}">${weeks?esc(key.slice(5)):esc(key)}</span>`).join('');
  const rows=view.contributors.map(c=>{
    const record=model.byId.get(c.id);
    const bins=weeks?record?.weeks:record?.months;
    const cells=keys.map(key=>{
      const bucket=bins?.get(key),label=continuityPeriodLabel(c.displayName,bucket,model);
      return `<button type="button" class="continuity-period-tile" data-action="pulse-period" data-pulse-period="true" data-person-id="${esc(c.id)}" data-period-key="${esc(key)}" title="${esc(label)}" aria-label="${esc(label)}. View interval evidence" aria-haspopup="dialog" aria-controls="pulse-popover">${continuityTile(bucket,model)}</button>`;
    }).join('');
    return `<div class="continuity-period-person" title="${esc(c.displayName)}" style="${style(c.id)}"><i class="person-dot" aria-hidden="true"></i><span>${esc(c.displayName)}</span><small>${record?.expectedPerWeek??5}d</small></div>${cells}`;
  }).join('');
  $('pulse').innerHTML=`<div class="continuity-period-board" style="grid-template-columns:${columns}"><span class="continuity-period-corner">AUTHOR / TAG</span>${axis}${rows}</div>`;
  return null;
}
function renderContinuityDailyPulse(view) {
  const weekColumns=`repeat(${view.weeks.length},var(--pulse-week-size))`;
  const months=dailyPulseMonths(view).map(m=>`<span class="pulse-daily-month" style="grid-column:${m.index+1}">${esc(m.label)}</span>`).join('');
  const weekdays=DAY_NAMES.map((d,i)=>`<span aria-hidden="true">${i%2===0?esc(d):''}</span>`).join('');
  const rows=view.contributors.map(c=>{
    const record=pulseContinuity.byId.get(c.id);
    const cells=view.weeks.flatMap(week=>Array.from({length:7},(_,i)=>{
      const day=dateAtDay(dayNumber(week)+i);
      if(day<view.start||day>view.end)return '<span class="pulse-daily-outside" aria-hidden="true"></span>';
      const item=record?.daily.get(day),label=continuityDayLabel(c.displayName,item);
      return `<button type="button" class="pulse-cell pulse-daily-cell continuity-day-tile ${item&&!item.workday?'continuity-weekend':''} ${item&&!item.workday&&item.meaningful?'continuity-weekend-activity':''}" data-action="pulse-day" data-pulse-day="${day}" data-person-id="${esc(c.id)}" title="${esc(label)}" aria-label="${esc(label)}. View date evidence" aria-haspopup="dialog" aria-controls="pulse-popover">${continuityTile(item,pulseContinuity,{daily:true})}</button>`;
    })).join('');
    return `<div class="pulse-daily-contributor"><div class="pulse-daily-person" title="${esc(c.displayName)}" style="${style(c.id)}"><i class="person-dot" aria-hidden="true"></i><span>${esc(c.displayName)}</span></div><div class="pulse-weekdays">${weekdays}</div><div class="pulse-day-cells" style="grid-template-columns:${weekColumns}">${cells}</div></div>`;
  }).join('');
  $('pulse').innerHTML=`<div class="pulse-daily-board" style="--pulse-week-count:${view.weeks.length}"><div class="pulse-daily-axis"><span class="pulse-daily-spacer"></span><span></span><div class="pulse-daily-months" style="grid-template-columns:${weekColumns}">${months}</div></div>${rows}</div>`;
  return null;
}

function renderMonthlyPulse(view) {
  const gapMode=!!pulseReleaseGap,momentumMode=!!pulseMomentum,levelMode=state.pulseLens==='level',signalMode=gapMode||momentumMode||levelMode;
  const signal=gapMode?pulseReleaseGap:momentumMode?pulseMomentum:pulseLevel;
  const signalStyle=gapMode?pulseGapCellStyle:momentumMode?pulseMomentumCellStyle:levelMode?velocityStyle:null;
  const startMonth=monthIndex(view.start),endMonth=monthIndex(view.end);
  const months=Array.from({length:endMonth-startMonth+1},(_,i)=>startMonth+i);
  const byPerson=view.contributors.map(c=>{
    const map=new Map();
    if(signalMode){
      for (const bucket of signal.byId.get(c.id)?.months.values()||[])map.set(monthIndex(bucket.month),bucket);
    } else for(const [d,val] of Object.entries(c.daily[view.metric])) {
      const mo=monthIndex(d);
      map.set(mo,(map.get(mo)||0)+val);
    }
    return {c,map};
  });
  const scale=signalMode?null:makeIntensityScale(byPerson.flatMap(({map})=>months.map(m=>map.get(m)||0)));
  const columns=`minmax(128px,160px) repeat(${months.length}, minmax(${levelMode?'38':'22'}px, 1fr))`;
  const yearHead=[];
  let i=0;
  while(i<months.length){
    const year=Math.floor(months[i]/12);
    let end=i;
    while(end<months.length && Math.floor(months[end]/12)===year)end++;
    yearHead.push(`<span class="pulse-year" style="grid-column:${i+2}/span ${end-i}">${year}</span>`);
    i=end;
  }
  const monthLabels=months.map(m=>`<span class="pulse-month">${new Date(Date.UTC(Math.floor(m/12),m%12,1)).toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'}).slice(0,levelMode?3:1)}</span>`).join('');
  const cells=byPerson.map(({c,map})=>`<div class="pulse-label" title="${esc(c.displayName)}">${esc(c.displayName)}</div>${months.map(m=>{
    const bucket=map.get(m);
    const v=signalMode?(bucket?.score??null):(bucket||0);
    const ym=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    const label=levelMode ? pulseLevelMonthLabel(c.displayName,ym,bucket) : gapMode ? bucket ? `${c.displayName}, ${ym}: mean weighted release-gap signal ${pulseScore(v)} of 100 over ${bucket.days} eligible weekdays; ${bucket.attentionDays} days at least ${ATTENTION_THRESHOLD}; ${bucket.distributedDays} distributed days. Latest credited release ${bucket.lastRelease?.tag||'unknown'} (${bucket.lastRelease?.linesChanged??'—'} shipped changed lines); effective gap ${pulseScore(bucket.lastEffectiveGap)} days.` : `${c.displayName}, ${ym}: no eligible days with a prior credited release contribution.` :
      momentumMode ? bucket ? `${c.displayName}, ${ym}: mean momentum ${momentumNumber(v)} across ${bucket.days} comparable workdays; ${bucket.buildingDays} building and ${bucket.coolingDays} cooling days; ${bucket.distributedDays} distributed days; latest ${momentumNumber(bucket.latest.score)} on ${bucket.latest.date}.` : `${c.displayName}, ${ym}: insufficient comparable workday history.` :
      `${c.displayName} · ${ym}: ${number.format(v)} ${METRICS[view.metric].unit}; ${pulseTemporal?.byId.get(c.id)?.months.get(ym)?.meaningfulDays??0} meaningful workdays, ${pulseTemporal?.byId.get(c.id)?.months.get(ym)?.distributedDays??0} distributed workdays.`;
    return `<div class="pulse-cell ${signalMode?'pulse-gap-month':''} ${levelMode?'pulse-velocity-cell pulse-velocity-month':''}" style="${signalStyle?signalStyle(v):intensityStyle(v,scale)}" title="${esc(label)}" role="img" aria-label="${esc(label)}">${levelMode?`<span aria-hidden="true">${esc(velocityCellText(v))}</span>`:''}</div>`;
  }).join('')}`).join('');
  $('pulse').innerHTML=`<div class="pulse-grid" style="grid-template-columns:${columns}"><span></span>${yearHead.join('')}<span></span>${monthLabels}${cells}</div>`;
  return scale;
}

function dailyPulseMonths(view) {
  const markers=[];
  let previous=null;
  view.weeks.forEach((week,index)=>{
    const start=Math.max(dayNumber(week),dayNumber(view.start));
    // Label the first in-scope month and then each new month's first full
    // week; don't mislabel early-month days as the incoming month.
    const month=monthIndex(dateAtDay(start));
    if(month!==previous) {
      markers.push({index,label:new Date(`${dateAtDay(start)}T12:00:00Z`).toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'})});
      previous=month;
    }
  });
  return markers;
}

function renderDailyPulse(view) {
  const weeks=view.weeks;
  const gapMode=!!pulseReleaseGap,momentumMode=!!pulseMomentum,levelMode=state.pulseLens==='level',signalMode=gapMode||momentumMode||levelMode;
  const signal=gapMode?pulseReleaseGap:momentumMode?pulseMomentum:pulseLevel;
  const signalStyle=gapMode?pulseGapCellStyle:momentumMode?pulseMomentumCellStyle:levelMode?velocityStyle:null;
  const scale=signalMode?null:makeIntensityScale(view.contributors.flatMap(c=>Object.values(c.daily[view.metric])));
  const weekColumns=`repeat(${weeks.length}, var(--pulse-week-size))`;
  const months=dailyPulseMonths(view).map(m=>`<span class="pulse-daily-month" style="grid-column:${m.index+1}">${esc(m.label)}</span>`).join('');
  const weekdays=DAY_NAMES.map((day,i)=>`<span aria-hidden="true">${i%2===0?esc(day):''}</span>`).join('');
  const rows=view.contributors.map(c=>{
    const record=signalMode?signal.byId.get(c.id):null;
    const cells=weeks.flatMap(week=>Array.from({length:7},(_,i)=>{
      const day=dateAtDay(dayNumber(week)+i);
      if(day<view.start||day>view.end)return '<span class="pulse-daily-outside" aria-hidden="true"></span>';
      const cell=record?.daily.get(day);
      const value=signalMode?(levelMode?(cell?.level??null):(cell?.score??null)):(c.daily[view.metric][day]||0);
      const label=gapMode ? pulseGapDailyLabel(c.displayName,cell) : momentumMode ? `${pulseMomentumDailyLabel(c.displayName,cell)}; ${pulseLevelDailyLabel(c.displayName,pulseLevel?.byId.get(c.id)?.daily.get(day))}` : levelMode?pulseLevelDailyLabel(c.displayName,cell) :
        `${c.displayName}, ${formatDate(day)}: ${number.format(value)} ${METRICS[view.metric].unit}; ${pulseTemporalDailyLabel(pulseTemporal?.byId.get(c.id)?.daily.get(day)||emptyTemporalDay(pulseTimeSettings()))}. View day activity.`;
      return `<button type="button" class="pulse-cell pulse-daily-cell ${signalMode&&cell?.reason==='weekend'?'pulse-gap-weekend':''} ${levelMode?'pulse-velocity-cell pulse-velocity-day':''}" style="${signalStyle?signalStyle(value):intensityStyle(value,scale)}" data-action="pulse-day" data-pulse-day="${day}" data-person-id="${esc(c.id)}" title="${esc(label)}" aria-label="${esc(label)}. View day evidence" aria-haspopup="dialog" aria-controls="pulse-popover">${levelMode?`<span aria-hidden="true">${esc(velocityCellText(value))}</span>`:''}</button>`;
    })).join('');
    return `<div class="pulse-daily-contributor"><div class="pulse-daily-person" title="${esc(c.displayName)}" style="${style(c.id)}"><i class="person-dot" aria-hidden="true"></i><span>${esc(c.displayName)}</span></div><div class="pulse-weekdays">${weekdays}</div><div class="pulse-day-cells" style="grid-template-columns:${weekColumns}">${cells}</div></div>`;
  }).join('');
  $('pulse').innerHTML=`<div class="pulse-daily-board" style="--pulse-week-count:${weeks.length}"><div class="pulse-daily-axis"><span class="pulse-daily-spacer"></span><span></span><div class="pulse-daily-months" style="grid-template-columns:${weekColumns}">${months}</div></div>${rows}</div>`;
  return scale;
}

function renderPulse(view) {
  if(stopMotionExplorer){stopMotionExplorer();stopMotionExplorer=null;}
  hidePulsePopover();
  const daily=state.pulseMode==='daily',weekly=state.pulseMode==='weekly';
  const continuityMode=state.pulseLens==='continuity';
  const gapMode=state.pulseLens==='release-gap',momentumMode=state.pulseLens==='momentum',levelMode=state.pulseLens==='level';
  const signalMode=gapMode||momentumMode||levelMode||continuityMode;
  const timing=pulseTimeSettings();
  const container=$('pulse');
  const oldScroll=container.scrollLeft;
  const range=`${view.start}|${view.end}`;
  const scrollToLatest=(daily||weekly)&&(pulsePreviousMode!==state.pulseMode||pulsePreviousRange!==range);
  pulseTemporal=!signalMode?temporalActivitySummary(perspectiveIndex,view.contributors,{from:view.start,to:view.end},timing):null;
  pulseReleaseGap=gapMode?releaseGapMatrix(perspectiveIndex,view.contributors,{from:view.start,to:view.end},
    {horizon:state.pulseGapHorizon,busyDay:state.pulseBusyDay,fullCreditLines:state.pulseReleaseLines,busyChurn:state.pulseDailyChurn,temporal:timing}):null;
  pulseMomentum=momentumMode?momentumMatrix(perspectiveIndex,view.contributors,{from:view.start,to:view.end},
    {workdays:state.pulseMomentumWorkdays,temporal:timing}):null;
  pulseLevel=momentumMode||levelMode?contributionLevelMatrix(perspectiveIndex,view.contributors,{from:view.start,to:view.end},
    {workdays:levelMode?state.pulseLevelWorkdays:state.pulseMomentumWorkdays,temporal:timing}):null;
  pulseContinuity=continuityMode?continuityMatrix(perspectiveIndex,view.contributors,{from:view.start,to:view.end},
    {weeks:state.pulseContinuityWeeks,meaningfulLines:state.pulseMeaningfulLines,
      workingDaysById:Object.fromEntries(mergeGroups.map((g,i)=>[String(i),normalizeWorkingDays(g.workingDays)]))}):null;
  const signatureMode=continuityMode&&state.continuityView!=='days';
  const motionLens=continuityMode?state.continuityView:state.pulseLens;
  const motionPossible=MOTION_MODES.includes(motionLens);
  const motionVisible=motionPossible&&state.motionViews[motionLens]==='motion';
  const motionSelector=$('pulse-motion-selector');
  motionSelector.hidden=!motionPossible;
  document.querySelectorAll('[data-motion-view]').forEach(button=>{const on=button.dataset.motionView===(motionVisible?'motion':'cells');button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));
    button.textContent=button.dataset.motionView==='motion'?'Time explorer':(signatureMode?'Snapshot':'Cells');});
  const signature=signatureMode?signatureMatrix(perspectiveIndex,pulseContinuity,view.contributors,{from:view.start,to:view.end},{temporal:timing}):null;
  $('pulse-gap-settings').hidden=!gapMode;
  $('pulse-momentum-settings').hidden=!momentumMode;
  $('pulse-level-settings').hidden=!levelMode;
  $('pulse-continuity-settings').hidden=!continuityMode;
  if(continuityMode)renderWorkingPatterns(view);
  $('pulse-mode-control').hidden=signatureMode||motionVisible;
  document.querySelectorAll('[data-continuity-view]').forEach(btn=>{const selected=btn.dataset.continuityView===state.continuityView;btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));});
  $('pulse-temporal-settings').hidden=false;
  $('pulse-gap-horizon').value=String(state.pulseGapHorizon);
  $('pulse-busy-day').value=String(state.pulseBusyDay);
  $('pulse-release-lines').value=String(state.pulseReleaseLines);
  $('pulse-daily-churn').value=String(state.pulseDailyChurn);
  $('pulse-momentum-workdays').value=String(state.pulseMomentumWorkdays);
  $('pulse-level-workdays').value=String(state.pulseLevelWorkdays);
  $('pulse-continuity-weeks').value=String(state.pulseContinuityWeeks);
  $('pulse-temporal-period').value=String(state.pulseTemporalPeriod);
  $('pulse-temporal-churn').value=String(state.pulseTemporalChurn);
  $('pulse-meaningful-lines').value=String(state.pulseMeaningfulLines);
  setText('pulse-temporal-settings-caption',`${state.pulseTemporalPeriod}m windows · ${state.pulseTemporalChurn} lines/window · ${state.pulseMeaningfulLines} lines/day`);
  document.querySelectorAll('[data-pulse-mode]').forEach(btn=>{if(btn.dataset.pulseMode==='weekly')btn.hidden=!continuityMode;const selected=btn.dataset.pulseMode===state.pulseMode;btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));});
  document.querySelectorAll('[data-pulse-lens]').forEach(btn=>{const selected=btn.dataset.pulseLens===state.pulseLens;btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));});
  $('pulse-gap-summary').hidden=!gapMode||!view.contributors.length;
  $('pulse-gap-summary').innerHTML=gapMode&&view.contributors.length?pulseGapSummary(pulseReleaseGap):'';
  $('pulse-activity-summary').hidden=signalMode||!view.contributors.length;
  $('pulse-activity-summary').innerHTML=!signalMode&&view.contributors.length?pulseActivitySummary(pulseTemporal):'';
  $('pulse-momentum-summary').hidden=!momentumMode||!view.contributors.length;
  $('pulse-momentum-summary').innerHTML=momentumMode&&view.contributors.length?pulseMomentumSummary(pulseMomentum,pulseLevel):'';
  $('pulse-level-summary').hidden=!levelMode||!view.contributors.length;
  $('pulse-level-summary').innerHTML=levelMode&&view.contributors.length?pulseLevelSummary(pulseLevel):'';
  $('pulse-continuity-summary').hidden=!continuityMode||!view.contributors.length||(signatureMode&&!(['signature','days'].includes(state.continuityView)));
  $('pulse-continuity-summary').innerHTML=continuityMode&&view.contributors.length?(signatureMode?(state.continuityView==='signature'?renderSignatureSummary(signature):''):pulseContinuitySummary(pulseContinuity)):'';
  setText('pulse-hint',motionVisible?'Scrub or play fully observed calendar-week windows. Select a contributor by marker or legend to spotlight their path; choose fading trails to inspect movement. Coordinates retain the same scale across the whole animation. Empty or incomplete evidence is never scored as zero.' :signatureMode
    ? state.continuityView==='signature'
      ? 'Three independent weekly bands: count-first expected days, fixed-scale authored-only output per expected day, and authored inclusion in tagged releases. Partial weeks remain visible but do not enter quadrant ratios. Select a week to inspect its count-first continuity and release events.'
      : state.continuityView==='delivery'
        ? 'Delivery quadrant: horizontal position is the share of complete tagged-release opportunities containing authored commits; vertical position is non-VERSION changed lines introduced per eligible release. Partial ancestry and unknown line totals are not plotted. Dates are release events, not authorship dates.'
        : 'Contribution quadrant: horizontal position is mean capped attainment of expected meaningful-day counts across fully observed weeks; vertical position is authored-only fixed-scale output per expected contribution day, including quiet days. No release bonus is included. Zero-day schedules cannot be plotted.'
    :continuityMode
    ? `Continuity is measured against the weekday pattern selected for each contributor, not a fixed five-day week. ${weekly?'Weekly cells display count shortfalls (−) and additional qualifying dates (+). An equals sign means the total number of qualifying dates met the reference, including substitute dates.':'Daily and monthly cells preserve the same expected-versus-extra distinction.'} The lower band represents tagged-release inclusion; “r” counts distinct releases. A meaningful recorded date requires ≥ ${state.pulseMeaningfulLines} non-VERSION changed lines. A qualifying off-pattern date may substitute for a named scheduled date in the same week, but a surplus in another week cannot erase a shortfall. The rolling ${state.pulseContinuityWeeks}-week view uses complete imported history, and a zero-day reference has no percentage denominator. Click any cell for the underlying dates and release evidence. This is a Git observation, not a claim about attendance or work hours.`
    :levelMode
    ? `Absolute recorded velocity is a fixed-scale, uncapped composite of authored commits, non-VERSION changed lines, authored changes included in releases, and temporal distribution. Daily and monthly cells show their actual numeric values: monthly values are averages per covered calendar day, including quiet days. The colour thresholds never adapt to peers or filtered maxima. The table below shows selected-period averages and a separate trailing ${state.pulseLevelWorkdays}-working-day view. One reference index unit corresponds to the weighted model’s reference inputs; this is not a work quota, measure of hours or quality.`
    :gapMode
    ? `Signal (0–100) = 100 × weighted release gap × max(1 − daily commits / ${state.pulseBusyDay}, 0) × max(1 − daily non-VERSION changed lines / ${state.pulseDailyChurn}, 0) × (1 − 0.15 × churn-weighted time distribution). The gap grows to 100% in ${state.pulseGapHorizon} days; incremental tagged releases reduce it by min(your shipped changed lines / ${state.pulseReleaseLines}, 1). A busy commit day or substantial churn can neutralise the signal; meaningful changes spread across distinct ${state.pulseTemporalPeriod}-minute windows can modestly soften any remainder (max 15%). ${daily?'Each square is one date; open a cell for its evidence.':'Each monthly square averages eligible weekday signals.'} Weekends, unobserved dates and days before measurable release credit are not scored.`
    :momentumMode
    ? `Direction (−100 to +100): compare the latest ${state.pulseMomentumWorkdays} workdays with the prior ${state.pulseMomentumWorkdays} workdays for the same person. Daily contribution units blend 25% commits, 45% non-VERSION changed lines, 15% churn-weighted distribution, and 15% authored lines shipped in tagged releases. Window pace = 75% average units + 25% consistency (share of workdays with ≥ ${state.pulseMeaningfulLines} changed lines). Momentum = 100 × (recent pace − previous pace) / (recent pace + previous pace + 0.1). Positive is building; negative is cooling; zero can also mean no observed activity. The summary below separately shows absolute recent recorded contribution level. ${daily?'Open a date for both windows and today’s evidence.':'Monthly cells average scored weekdays, so opposing directions can cancel.'} At least ${2*state.pulseMomentumWorkdays} complete imported weekdays are required; weekends are not scored.`
    :daily
    ? `Each square is one authored day (Mon–Sun). Open a cell to see its first/last commit, span, active ${state.pulseTemporalPeriod}-minute windows and churn-weighted distribution. A single commit has unknown spread, not zero contribution. Scroll sideways for older weeks.`
    : 'One square per person and calendar month. Intensity still shows the selected absolute Git metric. The distribution summary underneath adds meaningful-day consistency, recorded clock span and timed-window coverage.');
  const caption=continuityMode?'CONTRIBUTION CONTINUITY':gapMode?'RELEASE GAP × ACTIVITY':momentumMode?'CONTRIBUTION MOMENTUM':levelMode?'ABSOLUTE VELOCITY':METRICS[view.metric].label.toUpperCase();
  const legend=continuityMode?pulseContinuityLegend():gapMode?pulseGapLegend():momentumMode?pulseMomentumLegend():null;
  if(!view.contributors.length||!view.spanDays){
    setText('pulse-context',signalMode?`${caption} / ${daily?'DAILY':weekly?'WEEKLY':'MONTHLY'} · ${continuityMode?'AUTHORED + TAGGED RELEASES':momentumMode?'−100 TO +100':levelMode?'FIXED ABSOLUTE INDEX':'0–100'}`:`${caption} / ${daily?'DAILY':'MONTHLY'} TOTALS · SHARED SCALE`);
    container.innerHTML=empty('Select contributors and a valid time window.');
    $('pulse-key').innerHTML=legend||intensityLegend(makeIntensityScale([]));
  } else {
    const scale=motionVisible||signatureMode?null:continuityMode?(daily?renderContinuityDailyPulse(view):renderContinuityPeriodPulse(view,weekly?'weekly':'monthly')):daily?renderDailyPulse(view):renderMonthlyPulse(view);
    if(motionVisible){
      const colours=Object.fromEntries(view.contributors.map(c=>[String(c.id),color(c.id)]));
      const motion=buildMotionScenes(perspectiveIndex,view.contributors,{from:view.start,to:view.end},motionLens,{
        weeks:state.motionWeeks,step:state.motionStep,trail:state.motionTrail,labels:state.motionLabels,
        levelDisplay:state.motionLevelDisplay,temporal:timing,meaningfulLines:state.pulseMeaningfulLines,
        workingDaysById:Object.fromEntries(mergeGroups.map((g,i)=>[String(i),normalizeWorkingDays(g.workingDays)])),
        continuityWeeks:state.pulseContinuityWeeks,gapHorizon:state.pulseGapHorizon,
        busyDay:state.pulseBusyDay,releaseLines:state.pulseReleaseLines,dailyChurn:state.pulseDailyChurn,
        momentumWorkdays:state.pulseMomentumWorkdays,levelWorkdays:state.pulseLevelWorkdays});
      const options={weeks:state.motionWeeks,step:state.motionStep,trail:state.motionTrail,labels:state.motionLabels,
        index:state.motionFrameIndex,selectedId:state.motionSelectedId};
      container.innerHTML=renderMotionExplorer(motion,options,colours);
      stopMotionExplorer=bindMotionExplorer(container,motion,options,colours,(key,value,rerender)=>{
        const fields={weeks:'motionWeeks',step:'motionStep',trail:'motionTrail',labels:'motionLabels',
          levelDisplay:'motionLevelDisplay',index:'motionFrameIndex',selectedId:'motionSelectedId'};
        if(!Object.hasOwn(fields,key))return;
        state[fields[key]]=value;
        if(rerender){state.motionFrameIndex=-1;renderPulse(view);}
      });
    }
    if(signatureMode&&!motionVisible){
      const colours=Object.fromEntries(view.contributors.map(c=>[String(c.id),color(c.id)]));
      container.innerHTML=state.continuityView==='signature'?renderContributionSignature(signature,{colours}):renderSignatureQuadrant(signature,state.continuityView,{colours});
      if(state.continuityView!=='signature')bindSignatureQuadrant(container);
    }
    $('pulse-key').innerHTML=motionVisible?'<span class="signature-axis-note">Shared plot scale across frames / observed Git evidence, not performance</span>':signatureMode?(state.continuityView==='signature'?renderSignatureLegend():
      '<span class="signature-axis-note">Fixed reference lines · no contributor rankings or inferred work hours</span>'):
      legend||(levelMode?velocityLegend():intensityLegend(scale,n=>number.format(n)));
    setText('pulse-context',motionVisible?`TIME EXPLORER / ${motionLens.toUpperCase()} / ${state.motionWeeks}-WEEK WINDOWS`:signatureMode?`CONTRIBUTION ${state.continuityView==='signature'?'SIGNATURE · THREE WEEKLY TRACKS':state.continuityView.toUpperCase()+' QUADRANT · SELECTED PERIOD'}`:signalMode?`${caption} / ${daily?'DAILY':weekly?'WEEKLY':'MONTHLY'} · ${continuityMode?'TWO SEPARATE OBSERVATION TRACKS':levelMode?'FIXED ABSOLUTE INDEX · INDEPENDENT OF COHORT':`FIXED ${momentumMode?'DIVERGING −100 TO +100':'0–100'} SCALE`}`:`${caption} / ${daily?'DAILY':'MONTHLY'} ABSOLUTE TOTALS · SHARED 0–${number.format(scale.max)} SCALE`);
    container.scrollLeft=motionVisible?0:(scrollToLatest?container.scrollWidth:oldScroll);
  }
  pulsePreviousMode=state.pulseMode;
  pulsePreviousRange=range;
}

function pulseTime(c) {
  return Number.isInteger(c.hour) ? `${String(c.hour).padStart(2,'0')}:${String(c.minute??0).padStart(2,'0')}` : 'Time unknown';
}
function pulseFact(label,value,extraClass='') {
  return `<div class="pulse-fact ${extraClass}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function pulseGapDayDetails(item) {
  if (!item) return '';
  const message={weekend:'Weekend · not scored', 'outside-history':'Outside imported history · not scored',
    'no-prior-contribution':'No measurable earlier incremental release contribution · not scored'};
  const release=item.lastRelease;
  const last=release?`${esc(release.tag)} · ${formatDate(release.date)}${release.lineageComplete?'':' · partial ancestry'}`:'Not observed';
  return `<div class="pulse-gap-detail"><span class="eyebrow">RELEASE CREDIT × RECENCY × DAY ACTIVITY</span><div class="pulse-gap-detail-top"><strong>${item.score===null?'—':`${pulseScore(item.score)} / 100`}</strong><span>${esc(message[item.reason]||'Descriptive combined signal')}</span></div><div class="pulse-gap-detail-facts"><span>Calendar days since release <b>${item.daysSinceRelease===null?'—':number.format(item.daysSinceRelease)}</b></span><span>Effective weighted release gap <b>${pulseScore(item.effectiveGapDays)} days</b></span><span>Lines in last release, authored by this person <b>${release?`+${number.format(release.linesAdded)} / −${number.format(release.linesDeleted)} (${number.format(release.linesChanged)} changed)`:'—'}</b></span><span>Credit earned by this release <b>${pulseCredit(release)} gap reduction</b></span><span>Authored commits on this date <b>${number.format(item.commits)}</b></span><span>Authored non-VERSION line churn on this date <b>${number.format(item.churn)}</b></span><span>Churn-weighted activity distribution <b>${item.temporal?.distribution===null?'Unmeasurable':ratioLabel(item.temporal?.distribution)}</b></span><span>Additional distribution relief <b>${item.temporal?.distribution===null?'None (unmeasurable)':ratioLabel(MAX_GAP_DISTRIBUTION_RELIEF*item.temporal.distribution)}</b></span><span>Last credited release <b>${last}</b></span></div><small>A small release contribution reduces, but does not entirely reset, the accumulated gap. High authored commit volume or substantial non-VERSION daily churn can neutralise the signal; distributed substantive time windows can soften the remainder by up to 15%. This is not a performance judgement; line counts do not reflect all work.</small></div>`;
}

function pulseDayMarkup(d,gapItem=null,momentumItem=null,temporalItem=null,levelItem=null,continuityItem=null) {
  const measure=METRICS[d.metric];
  const signed=n=>`${n>0?'+':n<0?'−':''}${number.format(Math.abs(n))}`;
  const share=d.share===null?'— (no reference activity)':`${percent(d.share)} of ${d.reference==='repository'?'repository':'selected cohort'} for this day`;
  const areas=d.areas.length?d.areas.slice(0,6).map(a=>`<span>${esc(a.name)} <strong>${number.format(a.touches)}</strong></span>`).join(''):'<span>None</span>';
  const when=d.firstLocalTime ? d.firstLocalTime===d.lastLocalTime?d.firstLocalTime:`${d.firstLocalTime}–${d.lastLocalTime}`:'No authored clock recorded';
  const flags=[`${number.format(d.merges)} merges`,`${number.format(d.reverts)} reverts`,`${number.format(d.versionTouches)} VERSION touches`].join(' · ');
  const fileRows=d.fileChanges.map(f=>`<li><span title="${esc(f.path)}">${esc(f.path)}</span><span>${number.format(f.touches)}× · <span class="number-add">+${number.format(f.added)}</span> / <span class="number-del">−${number.format(f.deleted)}</span>${f.binaryTouches?` · ${number.format(f.binaryTouches)} binary`:''}</span></li>`).join('');
  const events=d.commits.map(c=>{
    const plus=sum(c.files.map(f=>f.added)),minus=sum(c.files.map(f=>f.deleted));
    return `<li class="pulse-commit"><span class="pulse-commit-line"><span>${esc(pulseTime(c))} · <code>${esc(c.hash?.slice(0,8)||'—')}</code></span><span><span class="number-add">+${number.format(plus)}</span> / <span class="number-del">−${number.format(minus)}</span> · ${c.files.length} files</span></span><span class="pulse-commit-subject">${esc(c.subject||'(No subject)')}${c.isMerge?'<span class="flag merge">merge</span>':''}${c.isRevert?'<span class="flag revert">revert</span>':''}${c.touchesVersion?'<span class="flag version">VERSION</span>':''}</span></li>`;
  }).join('');
  return `<div class="pulse-tip-heading"><div><span class="eyebrow">DAILY ACTIVITY · AUTHOR DATE</span><strong>${esc(new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}))}</strong><span>${esc(d.contributorName)}</span></div><button type="button" class="pulse-tip-close" data-action="close-pulse" aria-label="Close activity details">×</button></div>
    ${pulseGapDayDetails(gapItem)}
    ${pulseMomentumDayDetails(momentumItem)}
    ${pulseLevelDayDetails(levelItem)}
    ${pulseContinuityDayDetails(continuityItem)}
    ${pulseTemporalDayDetails(temporalItem)}
    <div class="pulse-tip-focus"><strong>${number.format(d.metricValue)}</strong><div><span>${esc(measure.label)} · day total</span><small>${esc(share)} · reference: ${number.format(d.referenceValue)} ${esc(measure.unit)}</small></div></div>
    <div class="pulse-tip-facts">${pulseFact('COMMITS',number.format(d.commitsCount))}${pulseFact('LINES ADDED',`+${number.format(d.added)}`)}${pulseFact('LINES REMOVED',`−${number.format(d.deleted)}`)}${pulseFact('TOTAL CHURN',number.format(d.churn))}${pulseFact('FILE TOUCHES',number.format(d.fileTouches))}${pulseFact('DISTINCT FILES',number.format(d.uniqueFiles))}</div>
    <div class="pulse-tip-extra"><span><strong>Net line change</strong> ${signed(d.net)}</span><span><strong>Binary file touches</strong> ${number.format(d.binaryTouches)}</span><span><strong>Author-local hours</strong> ${esc(when)}</span><span><strong>Commit types</strong> ${esc(flags)}</span><span><strong>Reference commits</strong> ${number.format(d.referenceCommits)} on this day</span></div>
    <div class="pulse-tip-areas"><span class="eyebrow">TOP-LEVEL AREAS · FILE TOUCHES</span><div>${areas}</div></div>
    <div class="pulse-tip-files"><details><summary>All changed file paths · ${number.format(d.uniqueFiles)} distinct (${number.format(d.fileTouches)} touches)</summary>${d.fileChanges.length?`<ul>${fileRows}</ul>`:'<p>No recorded file changes.</p>'}</details></div>
    <div class="pulse-tip-events"><span class="eyebrow">ALL ${number.format(d.commitsCount)} COMMITS IN THIS SCOPE</span>${d.commitsCount?`<ol>${events}</ol>`:'<p>No commits for this person on this day. Other contributors may have activity in the reference group.</p>'}</div>
    <p class="pulse-tip-note">All figures follow the dashboard's people, dates and merge/revert filters. Days use each commit's authored local date; hours use its authored local clock. Counts describe recorded changes, not performance.</p>`;
}
function positionPulsePopover(cell) {
  const popup=$('pulse-popover');
  const rect=cell.getBoundingClientRect();
  const width=popup.getBoundingClientRect().width;
  const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2));
  popup.style.left=`${left}px`;
  const height=popup.getBoundingClientRect().height;
  const below=rect.bottom+8;
  const above=rect.top-height-8;
  popup.style.top=`${below+height<=window.innerHeight-8 || above<8 ? Math.max(8,Math.min(below,window.innerHeight-height-8)) : above}px`;
}
function showPulsePopover(cell,{pin=false}={}) {
  if(state.pulseMode!=='daily'||!analysis || (pulsePopoverPinned && !pin)) return;
  const details=pulseDayDetails(analysis,cell.dataset.personId,cell.dataset.pulseDay);
  if(!details)return;
  const popup=$('pulse-popover');
  const same=pulsePopoverOrigin===cell;
  const gapItem=pulseReleaseGap?.byId.get(cell.dataset.personId)?.daily.get(cell.dataset.pulseDay)||null;
  const momentumItem=pulseMomentum?.byId.get(cell.dataset.personId)?.daily.get(cell.dataset.pulseDay)||null;
  const levelItem=pulseLevel?.byId.get(cell.dataset.personId)?.daily.get(cell.dataset.pulseDay)||null;
  const temporalItem=pulseTemporal?.byId.get(cell.dataset.personId)?.daily.get(cell.dataset.pulseDay)||gapItem?.temporal||momentumItem?.temporal||temporalDay(details.commits,pulseTimeSettings());
  const continuityItem=pulseContinuity?.byId.get(cell.dataset.personId)?.daily.get(cell.dataset.pulseDay)||null;
  popup.innerHTML=pulseDayMarkup(details,gapItem,momentumItem,temporalItem,levelItem,continuityItem);
  popup.hidden=false;
  popup.classList.toggle('is-pinned',pin);
  popup.setAttribute('role',pin?'dialog':'tooltip');
  popup.setAttribute('aria-label',`Day activity: ${details.contributorName}, ${formatDate(details.date)}`);
  if(!same)popup.scrollTop=0;
  pulsePopoverOrigin=cell;
  pulsePopoverPinned=pin;
  positionPulsePopover(cell);
}
function showPulsePeriodPopover(cell,{pin=false}={}) {
  if(state.pulseLens!=='continuity'||(state.continuityView==='days'&&state.pulseMode==='daily')||!pulseContinuity||
     (pulsePopoverPinned&&!pin))return;
  const row=pulseContinuity.byId.get(cell.dataset.personId);
  const bucket=((state.continuityView==='signature'||state.pulseMode==='weekly')?row?.weeks:row?.months)?.get(cell.dataset.periodKey);
  if(!row||!bucket)return;
  const popup=$('pulse-popover'),same=pulsePopoverOrigin===cell;
  popup.innerHTML=pulseContinuityPeriodMarkup(row.name,bucket,pulseContinuity);
  popup.hidden=false;popup.classList.toggle('is-pinned',pin);
  popup.setAttribute('role',pin?'dialog':'tooltip');
  popup.setAttribute('aria-label',`Continuity evidence for ${row.name}, ${bucket.from} to ${bucket.to}`);
  if(!same)popup.scrollTop=0;
  pulsePopoverOrigin=cell;pulsePopoverPinned=pin;
  positionPulsePopover(cell);
}
function onPulsePointerOver(event) {
  if(pulsePopoverPinned)return;
  const cell=event.target.closest('[data-pulse-day],[data-pulse-period]');
  if(cell && cell===pulseSuppressHoverCell)return;
  if(cell!==pulseSuppressHoverCell)pulseSuppressHoverCell=null;
  if(cell && (!pulsePopoverOrigin || pulsePopoverOrigin!==cell))(cell.hasAttribute('data-pulse-period')?showPulsePeriodPopover(cell):showPulsePopover(cell));
}
function onPulsePointerOut(event) {
  if(pulsePopoverPinned)return;
  const cell=event.target.closest('[data-pulse-day],[data-pulse-period]');
  if(!cell)return;
  if(cell===pulseSuppressHoverCell)pulseSuppressHoverCell=null;
  const to=event.relatedTarget;
  if(to && (cell.contains(to)||$('pulse-popover').contains(to)))return;
  hidePulsePopover();
}
function onPulseFocusOut(event) {
  if(pulsePopoverPinned)return;
  const to=event.relatedTarget;
  if(!to || (!to.closest('[data-pulse-day],[data-pulse-period]') && !$('pulse-popover').contains(to)))hidePulsePopover();
}

function microBars(values,labels,id,className='',maxPercent=100) {
  const total=sum(values);
  // Same percentage axis for every contributor in the quick comparison.
  return `<div class="rhythm-spark ${className}" style="${style(id)}">${values.map((v,i)=>{
    const pct=total?v/total*100:0;
    return `<div class="rhythm-piece" title="${esc(labels[i])}: ${v} timed commits (${percent(pct)})"><div class="rhythm-bar-wrap"><div class="rhythm-bar" style="height:${Math.min(100,pct/maxPercent*100)}%"></div></div><div class="rhythm-bar-label">${esc(labels[i])}</div></div>`;
  }).join('')}</div>`;
}

let rhythmModel = null;
let rhythmHover = null; // {kind:'slot'|'day',index} — ephemeral on hover / focus
let rhythmPinned = null; // same shape; click or keyboard activation pins

function rhythmFocus(view) {
  if (view.contributors.length === 1) return view.contributors[0].id;
  return view.selectedIds.has(String(state.rhythmFocus)) ? String(state.rhythmFocus) : 'selection';
}
function rhythmDatumKey(d) { return d ? `${d.kind}:${d.index}` : ''; }
function rhythmStyleFor(model) { return model.isGroup ? '#176b52' : color(model.focusId); }
function rhythmSlotTitle(cell) {
  return `${DAY_NAMES[cell.day]} ${String(cell.hour).padStart(2,'0')}:00–${String(cell.hour).padStart(2,'0')}:59 · ${cell.count} timed commits`;
}
function rhythmSlotLabel(cell, model) {
  return `${rhythmSlotTitle(cell)} · ${cell.dates} distinct authored dates · ${cell.percentage===null?'undefined':percent(cell.percentage)} of ${model.name}'s timed commits`;
}
function rhythmCellAttributes(cell,model) {
  return `data-rhythm-interactive data-rhythm-kind="slot" data-rhythm-index="${cell.index}" data-action="rhythm-inspect" aria-label="${esc(rhythmSlotLabel(cell,model))}" aria-pressed="false" title="${esc(rhythmSlotTitle(cell))}"`;
}
function rhythmWeekdayColumns(model,accent) {
  if (!model.timedCommits) return empty('No commits with authored hours in this scope. The weekday and hour charts share this same empty evidence.');
  const maximum=Math.max(1,...model.weekdays.map(d=>d.count));
  return `<div class="rhythm-weekday-chart" style="--rhythm-accent:${accent}" role="group" aria-label="Timed commits by weekday">
    ${model.weekdays.map(d=>`<button type="button" class="rhythm-weekday-column" data-rhythm-interactive data-rhythm-kind="day" data-rhythm-index="${d.day}" data-action="rhythm-inspect" aria-label="${esc(DAY_NAMES[d.day])}, ${d.count} timed commits, ${percent(d.percentage||0)} of timed commits" aria-pressed="false" title="${esc(`${DAY_NAMES[d.day]} · ${d.count} commits · ${percent(d.percentage||0)}`)}"><span class="rhythm-weekday-count">${number.format(d.count)}</span><span class="rhythm-weekday-track"><span class="rhythm-weekday-bar" style="height:${d.count/maximum*100}%"></span></span><span class="rhythm-weekday-label">${DAY_NAMES[d.day]}</span><span class="rhythm-weekday-pct">${percent(d.percentage||0)}</span></button>`).join('')}
  </div>`;
}

function rhythmHeatmap(model,accent) {
  const scale=makeIntensityScale(model.cells.map(c=>c.count));
  const ticks=Array.from({length:24},(_,h)=>`<span class="rhythm-grid-hour">${h%3===0?String(h).padStart(2,'0'):''}</span>`).join('');
  return `<div class="rhythm-grid-scroll" aria-label="Day by hour heatmap, scroll horizontally if needed"><div class="rhythm-grid-board" style="--rhythm-accent:${accent}"><div class="rhythm-grid-heading"><span>LOCAL</span><div class="rhythm-grid-hours">${ticks}</div></div>${DAY_NAMES.map((name,day)=>`<div class="rhythm-grid-row"><span class="rhythm-grid-day">${name}</span><div class="rhythm-grid-hours">${model.cells.slice(day*24, day*24+24).map(cell=>`<button type="button" class="rhythm-grid-cell" ${rhythmCellAttributes(cell,model)} style="${intensityStyle(cell.count,scale)}"></button>`).join('')}</div></div>`).join('')}<div class="rhythm-grid-tail"><span></span><div>00:00 <span>→</span> 23:00 · each square is one authored hour</div></div></div></div>`;
}
function rhythmArc(cx,cy,inner,outer,start,end) {
  const xy=(r,theta)=>[cx+r*Math.cos(theta),cy+r*Math.sin(theta)];
  const a=xy(outer,start),b=xy(outer,end),c=xy(inner,end),d=xy(inner,start);
  return `M${a[0].toFixed(2)},${a[1].toFixed(2)} A${outer},${outer} 0 0 1 ${b[0].toFixed(2)},${b[1].toFixed(2)} L${c[0].toFixed(2)},${c[1].toFixed(2)} A${inner},${inner} 0 0 0 ${d[0].toFixed(2)},${d[1].toFixed(2)} Z`;
}
function rhythmClock(model,accent) {
  const scale=makeIntensityScale(model.cells.map(c=>c.count));
  const cx=204,cy=199;
  const ticks=[0,6,12,18].map(h=>{
    const angle=h/24*Math.PI*2-Math.PI/2;
    const a=(r)=>[cx+Math.cos(angle)*r,cy+Math.sin(angle)*r];
    const inner=a(43),outer=a(168);
    return `<line x1="${inner[0]}" y1="${inner[1]}" x2="${outer[0]}" y2="${outer[1]}" class="rhythm-clock-guide"/>`;
  }).join('');
  const cells=model.cells.map(cell=>{
    const start=cell.hour/24*Math.PI*2-Math.PI/2+.016;
    const end=(cell.hour+1)/24*Math.PI*2-Math.PI/2-.016;
    const inner=48+cell.day*17;
    const outer=inner+12;
    return `<path d="${rhythmArc(cx,cy,inner,outer,start,end)}" fill="${intensityColour(cell.count,scale)}" class="rhythm-clock-cell" ${rhythmCellAttributes(cell,model)} tabindex="0" role="button"><title>${esc(rhythmSlotTitle(cell))}</title></path>`;
  }).join('');
  const clockLabels=[[0,204,18],[6,395,203],[12,204,401],[18,11,203]].map(([h,x,y])=>`<text x="${x}" y="${y}" text-anchor="middle" class="rhythm-clock-label">${String(h).padStart(2,'0')}:00</text>`).join('');
  const legend=DAY_NAMES.map((d,i)=>`<span><i style="--ring:${i+1}"></i>${d}</span>`).join('');
  return `<div class="rhythm-clock-layout"><svg class="rhythm-clock" viewBox="0 0 408 412" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Circular 168-hour week. Monday is the innermost ring, Sunday the outermost, and hours advance clockwise from midnight at the top.">${ticks}${cells}<text x="${cx}" y="${cy-3}" class="rhythm-clock-centre" text-anchor="middle">WEEKLY</text><text x="${cx}" y="${cy+13}" class="rhythm-clock-centre-secondary" text-anchor="middle">CLOCK</text>${clockLabels}</svg><div class="rhythm-clock-explanation"><strong>Seven rings, one week.</strong><span>Monday on the inside; Sunday on the outside. Midnight starts at the top, then hours run clockwise.</span><div class="rhythm-clock-rings">${legend}</div></div></div>`;
}
function rhythmBars(model,accent) {
  const scale=makeIntensityScale(model.cells.map(c=>c.count));
  const max=Math.max(1,scale.max);
  return `<div class="rhythm-bars-scroll" aria-label="Seven consecutive 24-hour bar charts, scroll horizontally if needed"><div class="rhythm-bars-week" style="--rhythm-accent:${accent}">${DAY_NAMES.map((name,day)=>`<div class="rhythm-bars-day"><span class="rhythm-bars-dayname">${name} <small>${number.format(model.weekdays[day].count)} commits</small></span><div class="rhythm-bars-bars">${model.cells.slice(day*24,day*24+24).map(cell=>`<button type="button" class="rhythm-bars-column" ${rhythmCellAttributes(cell,model)}><span class="rhythm-bars-fill" style="height:${cell.count/max*100}%;background:${intensityColour(cell.count,scale)}"></span></button>`).join('')}</div><div class="rhythm-bars-hour-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>`).join('')}</div></div>`;
}
function rhythmDetailMarkup(model,datum) {
  if(!model.timedCommits) return `<div class="rhythm-detail-empty">No timed commit activity can be plotted. ${number.format(model.missingTime)} of ${number.format(model.totalCommits)} commits lack an authored hour.</div>`;
  const d=datum?.kind==='day' ? model.weekdays[datum.index] : model.cells[datum?.index ?? model.peakSlot.index];
  if(!d)return '';
  const byDay=datum?.kind==='day';
  const label=byDay?`${DAY_NAMES[d.day]} · all authored hours`:`${DAY_NAMES[d.day]} · ${String(d.hour).padStart(2,'0')}:00–${String(d.hour).padStart(2,'0')}:59`;
  const isPeak=!datum;
  const ratio=model.showReference && d.referenceCount
    ? `${number.format(d.count)} of ${number.format(d.referenceCount)} ${model.referenceName} commits (${percent(d.referenceShare)}) in this ${byDay?'weekday':'hour'}`
    : model.showReference ? (d.referenceCount===0?`No commits in this ${byDay?'weekday':'hour'} for the ${model.referenceName}`:'Reference share unavailable') : 'Reference and focused contributors are the same group';
  const examples=d.examples?.length ? `<div class="rhythm-evidence"><span class="eyebrow">MOST RECENT MATCHING COMMITS</span><ul>${d.examples.map(c=>`<li><span>${esc(`${c.date} ${String(c.hour).padStart(2,'0')}:${String(c.minute??0).padStart(2,'0')}`)} · <code>${esc(c.hash?.slice(0,8)||'—')}</code></span><strong>${esc(c.subject||'(No subject)')}</strong></li>`).join('')}</ul></div>` : '';
  return `<div class="rhythm-detail-head"><div><span class="eyebrow">${rhythmPinned?'PINNED INSPECTION':isPeak?'PEAK HOUR · HOVER, FOCUS OR CLICK TO EXPLORE':'HOUR-BY-HOUR EVIDENCE'}</span><h5>${esc(label)}</h5><p>${esc(model.name)} · ${number.format(d.count)} recorded ${d.count===1?'commit':'commits'} at ${byDay?'these weekday hours':'this weekday and hour'} across the filtered period.</p></div>${rhythmPinned?'<button type="button" class="rhythm-unpin" data-action="rhythm-unpin">Unpin <span aria-hidden="true">×</span></button>':'<span class="rhythm-detail-help">Click any cell to pin ↗</span>'}</div><div class="rhythm-detail-facts"><div><span>COMMITS</span><strong>${number.format(d.count)}</strong></div><div><span>SHARE OF TIMED</span><strong>${d.percentage===null?'—':percent(d.percentage)}</strong></div><div><span>ACTIVE AUTHOR DATES</span><strong>${number.format(d.dates)}</strong></div><div><span>FILE TOUCHES</span><strong>${number.format(d.fileTouches)}</strong></div><div><span>TEXT LINES + / −</span><strong><em class="number-add">+${number.format(d.added)}</em> / <em class="number-del">−${number.format(d.deleted)}</em></strong></div></div><p class="rhythm-detail-reference">${esc(ratio)}</p>${examples}`;
}
function renderRhythmDetail() {
  if(!rhythmModel) return;
  const datum=rhythmPinned || rhythmHover;
  $('rhythm-detail').innerHTML=rhythmDetailMarkup(rhythmModel,datum);
  const current=rhythmDatumKey(datum || (rhythmModel.peakSlot ? {kind:'slot',index:rhythmModel.peakSlot.index} : null));
  document.querySelectorAll('#rhythm-explorer [data-rhythm-interactive]').forEach(node=>{
    const active=rhythmDatumKey({kind:node.dataset.rhythmKind,index:Number(node.dataset.rhythmIndex)})===current;
    node.classList.toggle('is-active',active);
    node.setAttribute('aria-pressed',String(Boolean(rhythmPinned && active)));
  });
}
function renderRhythmExplorer(view) {
  const target=$('rhythm-explorer');
  target.hidden = !view.contributors.length;
  if (!view.contributors.length) {rhythmModel=null;return;}
  const focus=rhythmFocus(view);
  if(rhythmModel?.focusId!==focus){rhythmHover=null;rhythmPinned=null;}
  state.rhythmFocus=focus;
  rhythmModel=workingRhythm(view,focus);
  const model=rhythmModel;
  const accent=rhythmStyleFor(model);
  const picker=[...(view.contributors.length>1 ? [{id:'selection',displayName:'All selected'}] : []),...view.contributors].map(c=>{
    const active=focus===c.id;
    return `<button type="button" data-action="rhythm-focus" data-rhythm-focus="${c.id}" class="rhythm-focus-chip ${active?'is-active':''}" ${c.id!=='selection'?`style="${style(c.id)}"`:''} aria-pressed="${active}">${c.id!=='selection'?'<i class="person-dot" aria-hidden="true"></i>':''}${esc(c.displayName)}</button>`;
  }).join('');
  $('rhythm-focus-picker').innerHTML=picker;
  setText('rhythm-focus-name',model.isGroup?'The selected group’s week':`${model.name}'s week`);
  setText('rhythm-focus-caption',`${view.start} to ${view.end} · ${view.includeMerges?'merges included':'merges excluded'} · ${view.includeReverts?'reverts included':'reverts excluded'} · ${model.isGroup?'all selected contributors':'one selected contributor'}. Changing this focus only affects this explorer.`);
  const peak=model.peakSlot;
  const mini=(label,value,desc)=>`<div class="rhythm-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(desc)}</small></div>`;
  $('rhythm-kpis').innerHTML=mini('TIMED COMMITS',number.format(model.timedCommits),`${number.format(model.totalCommits)} total · ${model.totalCommits?percent(model.timedCommits/model.totalCommits*100):'—'} recorded times`)+
    mini('BUSIEST WEEKDAY',model.peakDay?DAY_NAMES[model.peakDay.day]:'—',model.peakDay?`${number.format(model.peakDay.count)} commits · ${percent(model.peakDay.percentage)}`:'No authored hours recorded')+
    mini('BUSIEST WEEK-HOUR',peak?`${DAY_NAMES[peak.day]} ${String(peak.hour).padStart(2,'0')}:00`:'—',peak?`${number.format(peak.count)} commits across ${number.format(peak.dates)} dates`:'No authored hours recorded')+
    mini('WEEKEND SHARE',model.weekendShare===null?'—':percent(model.weekendShare),'Of timed commits · Sat + Sun');
  $('rhythm-weekday-columns').innerHTML=rhythmWeekdayColumns(model,accent);
  const captions={
    heatmap:'Day × hour · 7 rows × 24 hourly slots. Colour shows commit counts; scroll sideways for all hours on small screens.',
    clock:'Circular week · seven weekday rings × 24 hours. Monday is innermost; hours run clockwise.',
    bars:'Continuous hour-of-week · 168 hourly bars grouped into seven days. One shared scale; scroll sideways on small screens.',
  };
  setText('rhythm-display-caption',captions[state.rhythmDisplay]);
  document.querySelectorAll('[data-rhythm-display]').forEach(btn=>{
    const active=btn.dataset.rhythmDisplay===state.rhythmDisplay;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  $('rhythm-week-chart').innerHTML=!model.timedCommits?empty('No timed commits in this selection. No hours are inferred from date-only Git records.')
    :state.rhythmDisplay==='clock'?rhythmClock(model,accent)
    :state.rhythmDisplay==='bars'?rhythmBars(model,accent):rhythmHeatmap(model,accent);
  const scale=makeIntensityScale(model.cells.map(c=>c.count));
  $('rhythm-legend').innerHTML=`${intensityLegend(scale,n=>number.format(n))}<span>${number.format(model.missingTime)} commits without authored hours omitted · all views share these ${number.format(model.timedCommits)} timed events</span>`;
  renderRhythmDetail();
  renderSeasonality(view);
}
function renderRhythm(view) {
  $('rhythm-comparison-details').hidden=view.contributors.length<=1;
  if(!view.contributors.length){$('rhythm').innerHTML=empty('No contributors selected.');renderRhythmExplorer(view);return;}
  const sharedScale=(accessor,total)=>{
    const highest=Math.max(0,...view.contributors.flatMap(c=>{
      const n=total(c);return accessor(c).map(v=>n?v/n*100:0);
    }));
    return Math.min(100,Math.max(10,Math.ceil(highest/10)*10));
  };
  const weekdayMax=sharedScale(c=>c.timedWeekdays,c=>c.timedCommits);
  const timeMax=sharedScale(c=>c.timeBands,c=>c.timedCommits);
  const heading=`<div class="rhythm-header"><span>CONTRIBUTOR</span><span>DAY OF WEEK · % TIMED · 0–${weekdayMax}%</span><span>LOCAL HOUR · % TIMED · 0–${timeMax}%</span><span>WEEKEND / COVERAGE</span></div>`;
  const focus=rhythmFocus(view);
  const rows=view.contributors.map(c=>{
    const count=c.totals.commits;
    const weekend=c.timedCommits?percent(c.timedWeekendCommits/c.timedCommits*100):'—';
    const timed=count?percent(c.timedCommits/count*100):'—';
    return `<div class="rhythm-row ${focus===c.id?'is-focused':''}"><div class="rhythm-name"><strong style="${style(c.id)}"><i class="person-dot"></i> ${esc(c.displayName)}</strong><small>${number.format(count)} commits · ${number.format(c.timedCommits)} timed</small><button type="button" data-action="rhythm-focus" data-rhythm-focus="${c.id}" class="rhythm-explore-link" aria-label="Explore the weekly timing of ${esc(c.displayName)}">Explore ↗</button></div><div class="rhythm-mobile-label">Weekday share · timed commits · scale 0–${weekdayMax}%</div>${c.timedCommits?microBars(c.timedWeekdays,DAY_NAMES,c.id,'',weekdayMax):'<div class="helper">No timed commits.</div>'}<div class="rhythm-mobile-label">Time band share · timed commits · scale 0–${timeMax}%</div>${c.timedCommits?microBars(c.timeBands,TIME_BANDS.map(b=>b.label),c.id,'time',timeMax):'<div class="helper">No timed commits.</div>'}<div class="rhythm-summary">${weekend}<small>${timed} time coverage</small></div></div>`;
  }).join('');
  $('rhythm').innerHTML=`<div class="rhythm-list-wrap">${heading}${rows}</div>`;
  renderRhythmExplorer(view);
}


// Historical behaviour is a second representation of the same authored-date
// evidence; year chips and contributor focus change only this explorer's view.
const SEASON_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let seasonModel = null;
let seasonHover = null;
let seasonPinned = null;
function seasonKey(d) { return d ? `${d.kind}:${d.year}:${d.index}` : ''; }
function seasonValueText(value, mode=state.seasonMode) {
  if (value == null || !Number.isFinite(value)) return '—';
  return mode === 'rate' ? `${decimal.format(value)}/wk` : mode === 'shape' ? percent(value) : `${decimal.format(value)}×`;
}
function seasonModeTitle() {
  return state.seasonMode === 'rate' ? 'Commits per calendar week'
    : state.seasonMode === 'shape' ? 'Share of authored commits within that year'
    : 'Monthly intensity vs that year’s average daily rate';
}
function seasonShownYears(model) {
  if (!model) return [];
  if (state.seasonYears) {
    const valid = new Set(model.years.map(y => y.year));
    state.seasonYears = new Set([...state.seasonYears].filter(y => valid.has(y)));
    if (!state.seasonYears.size) state.seasonYears = null;
  }
  return model.years.filter(y => !state.seasonYears || state.seasonYears.has(y.year));
}
function seasonEmpty(message) { return `<div class="season-empty">${esc(message)}</div>`; }

function monthTitle(month) {
  return `${SEASON_MONTHS[month.month]} ${month.year} · ${month.count} authored commits · ${month.days} observed calendar days · ${month.full?'complete':'partial'} month · ${seasonValueText(seasonalMonthValue(month),state.seasonMode)}`;
}
function seasonCellAttributes(kind,year,index,title) {
  return `data-season-cell data-season-kind="${kind}" data-season-year="${year}" data-season-index="${index}" data-action="season-inspect" aria-pressed="false" aria-label="${esc(title)}" title="${esc(title)}"`;
}
function renderSeasonYearPicker(model) {
  const displayed = seasonShownYears(model);
  const all = state.seasonYears === null;
  $('season-year-picker').innerHTML=`<span class="eyebrow">YEARS IN VIEW</span><button type="button" class="season-year-chip ${all?'is-active':''}" data-action="season-all-years" aria-pressed="${all}">All years</button>${model.years.map(y=>`<button type="button" class="season-year-chip ${displayed.includes(y)?'is-active':''}" data-action="season-toggle-year" data-season-year="${y.year}" aria-pressed="${displayed.includes(y)}">${y.year}${y.full?'':' <span aria-hidden="true">◔</span>'}</button>`).join('')}<span class="season-years-note">${displayed.length} of ${model.years.length} · ◔ partial-year coverage</span>`;
}
function renderSeasonMonthMatrix(model,years) {
  const values = years.flatMap(y=>y.months.filter(m=>m.days).map(m=>seasonalMonthValue(m)));
  const scale = makeIntensityScale(values);
  const heading = `<div class="season-month-head"><span>YEAR</span><div class="season-month-labels">${SEASON_MONTHS.map(m=>`<span>${m}</span>`).join('')}</div><span>CALENDAR COVERAGE</span></div>`;
  const lines = [...years].reverse().map(y=>{
    const maxYearDays=new Date(Date.UTC(y.year+1,0,1))-new Date(Date.UTC(y.year,0,1));
    return `<div class="season-month-row"><span class="season-month-year"><strong>${y.year}</strong><small>${number.format(y.count)} commits</small></span><div class="season-month-cells">${y.months.map(m=>m.days?`<button type="button" class="season-month-cell ${m.full?'':'is-partial'} " ${seasonCellAttributes('month',y.year,m.month,monthTitle(m))} style="${intensityStyle(seasonalMonthValue(m),scale)}"><span>${esc(seasonValueText(seasonalMonthValue(m)))}</span></button>`:`<span class="season-month-missing" title="${SEASON_MONTHS[m.month]} ${y.year}: outside imported author dates or global scope" aria-label="${SEASON_MONTHS[m.month]} ${y.year}: not observed">—</span>`).join('')}</div><span class="season-month-coverage"><strong>${y.exposureDays}d</strong><small>${y.full?'Full year':`${Math.round(y.exposureDays/(maxYearDays/86400000)*100)}% of year`}</small></span></div>`;
  }).join('');
  const legend=`<div class="season-chart-key">${intensityLegend(scale,n=>seasonValueText(n),{missing:true})}<em>Dashed outline = partial month; hatched = outside selected/imported dates.</em></div>`;
  $('season-month-matrix').innerHTML = years.length ? `<p class="season-scroll-hint">Swipe sideways to see all 12 months ↔</p><div class="season-month-scroll"><div class="season-month-board">${heading}${lines}</div></div>${legend}` : seasonEmpty('Select at least one year to compare.');
}
function seasonYoYText(year, years) {
  if (!year.yoy || !years.some(y=>y.year===year.year-1)) return '<span class="season-dash">—</span>';
  const a=year.yoy;
  const value=a.change === null ? (a.currentCount ? 'New activity' : 'No baseline') : `${a.change>=0?'+':''}${percent(a.change)}`;
  const cls=a.change===null?'':a.change>0?'season-up':a.change<0?'season-down':'';
  return `<span class="${cls}">${esc(value)}</span><small>${esc(a.from)} → ${esc(a.to)} · ${a.currentDays}/${a.priorDays} days · vs ${year.year-1}</small>`;
}
function renderSeasonAnnualScorecard(years) {
  if(!years.length){$('season-annual-scorecard').innerHTML='';return;}
  const th=['YEAR / OBSERVED', 'COMMITS', 'COMMITS / WEEK', 'ACTIVE DAY FREQUENCY', 'COMMITS / ACTIVE DAY', 'WEEKEND SHARE', 'EVENING SHARE', 'HOUR COVERAGE', 'YEAR-ON-YEAR PACE'];
  const tr=[...years].reverse().map(y=>`<tr><th scope="row"><strong>${y.year}</strong><small>${y.exposureDays} calendar days${y.full?'':' · partial'}</small></th><td>${number.format(y.count)}</td><td><strong>${decimal.format(y.pace)}</strong></td><td>${percent(y.activeFrequency)}<small>${y.activeDays} distinct dates</small></td><td>${y.perActiveDay===null?'—':decimal.format(y.perActiveDay)}</td><td>${y.weekendShare===null?'—':percent(y.weekendShare)}</td><td>${y.eveningShare===null?'—':percent(y.eveningShare)}</td><td>${y.timeCoverage===null?'—':percent(y.timeCoverage)}<small>${y.timedCount} timed / ${y.count} total</small></td><td>${seasonYoYText(y,years)}</td></tr>`).join('');
  $('season-annual-scorecard').innerHTML=`<table class="season-annual-table"><thead><tr>${th.map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>${tr}</tbody></table><p class="season-table-footnote">Year-on-year changes compare identical calendar-day portions of adjacent years, using commits per calendar week. Active day frequency = distinct authored dates / observed calendar days; evening = 18:00–23:59 author-local among timed commits. “—” means undefined or outside scope. These are activity measures, not performance scores.</p>`;
}
function renderSeasonRhythmYears(model,years) {
  if (!years.length) { $('season-rhythm-years').innerHTML='';return; }
  const scale = makeIntensityScale(years.flatMap(y=>y.slots.map(v=>y.timedCount?v/y.timedCount*100:0)));
  const hours=Array.from({length:24},(_,i)=>`<span>${i%3===0?String(i).padStart(2,'0'):''}</span>`).join('');
  $('season-rhythm-years').innerHTML=`<div class="season-rhythm-gallery">${[...years].reverse().map(y=>`<div class="season-rhythm-year"><div class="season-rhythm-heading"><strong>${y.year}</strong><span>${number.format(y.timedCount)} timed · ${y.timeCoverage===null?'—':percent(y.timeCoverage)} coverage ${y.full?'':'· partial year'}</span></div>${y.timedCount?`<div class="season-rhythm-scroll"><div class="season-rhythm-board"><div class="season-rhythm-labelrow"><span>LOCAL</span><div>${hours}</div></div>${DAY_NAMES.map((d,day)=>`<div class="season-rhythm-row"><span>${d}</span><div>${y.slots.slice(day*24,day*24+24).map((count,h)=>{const idx=day*24+h;const share=count/y.timedCount*100;return `<button type="button" ${seasonCellAttributes('slot',y.year,idx,`${y.year} ${d} ${String(h).padStart(2,'0')}:00 · ${count} timed commits · ${percent(share)} of that year's timed commits`)} class="season-rhythm-cell" style="${intensityStyle(share,scale)}"></button>`;}).join('')}</div></div>`).join('')}</div></div>`:seasonEmpty('No authored hours in this year; no time slots inferred.')}</div>`).join('')}</div><div class="season-chart-key">${intensityLegend(scale,n=>percent(n))}<em>Share of each year’s timed commits · shared scale across years, not total volume.</em></div>`;
}
function renderSeasonPeople(model,years) {
  const target=$('season-person-comparison');
  if(model.comparisons.length<=1 || !years.length){target.innerHTML='';return;}
  const order=[...years].reverse();
  const rows=model.comparisons.map(person=>`<tr><th scope="row"><span style="${style(person.id)}"><i class="person-dot"></i> ${esc(person.name)}</span></th>${order.map(y=>{const row=person.years.find(p=>p.year===y.year);return `<td><strong>${row?.pace===null?'—':decimal.format(row.pace)}</strong><small>${row.count} commits · ${row.weekendShare===null?'—':percent(row.weekendShare)} weekend</small></td>`;}).join('')}</tr>`).join('');
  target.innerHTML=`<div class="season-section-head"><div><span class="eyebrow">04 / ONE OR MANY CONTRIBUTORS</span><h5>Individual annual trajectories.</h5></div><span class="helper">Commits per calendar week · selected contributors only</span></div><div class="season-table-scroll"><table class="season-annual-table season-person-table"><thead><tr><th>CONTRIBUTOR</th>${order.map(y=>`<th>${y.year}${y.full?'':' · PARTIAL'}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><p class="season-table-footnote">Each person uses the same calendar exposure as every other person in that year, including inactive dates. Cell details give total commits and weekend share; focus on a contributor above to inspect their complete historical rhythms.</p>`;
}
function seasonalSeriesPath(points, x, y) {
  const runs=[];let run=[];
  for (let i=0;i<12;i++) {
    if(points[i]===null){if(run.length)runs.push(run);run=[];}
    else run.push(i);
  }
  if(run.length) runs.push(run);
  return runs.filter(r=>r.length>1).map(run=>`<polyline points="${run.map(i=>`${x(i)},${y(points[i])}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}
function renderSeasonOverlay(model,years) {
  const target=$('season-overlay');
  if (!years.length){target.innerHTML=seasonEmpty('Select years to overlay.');return;}
  const visible=[...years].sort((a,b)=>a.year-b.year);
  const yearsData=visible.map((year,i)=>({year,colour:COLORS[i%COLORS.length],points:year.months.map(m=>m.days?seasonalMonthValue(m):null)}));
  const baseline=Array.from({length:12},(_,month)=>{
    const eligible=visible.filter(y=>y.full&&y.count>0).map(y=>y.months[month]);
    return eligible.length>=3?sum(eligible.map(m=>seasonalMonthValue(m)))/eligible.length:null;
  });
  const allValues=yearsData.flatMap(d=>d.points).concat(baseline).filter(v=>v!==null);
  const max=Math.max(state.seasonMode==='index'?1.5:1,...allValues)*1.1;
  const W=960,H=330,L=62,R=24,T=18,B=48,cw=W-L-R,ch=H-T-B;
  const x=i=>L+cw*i/11, y=n=>T+ch-(n/max)*ch;
  let svg=`<svg class="season-overlay-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Monthly seasonal lines from January to December, each line one selected year">`;
  for(let i=0;i<=4;i++){
    const v=max*i/4;
    svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" class="season-axis-line"/><text x="${L-12}" y="${y(v)+3.5}" text-anchor="end" class="season-axis-label">${esc(seasonValueText(v))}</text>`;
  }
  if(state.seasonMode==='index') svg+=`<line x1="${L}" x2="${W-R}" y1="${y(1)}" y2="${y(1)}" stroke="#a56f4b" stroke-width="1.3" stroke-dasharray="5 4"/>`;
  for(let m=0;m<12;m++) svg+=`<text x="${x(m)}" y="${H-15}" text-anchor="middle" class="season-axis-label">${SEASON_MONTHS[m]}</text>`;
  for(const {year,colour,points} of yearsData){
    svg+=`<g style="color:${colour}">${seasonalSeriesPath(points,x,y)}`;
    for(let i=0;i<12;i++){
      if(points[i]===null)continue;
      const month=year.months[i];
      const title=monthTitle(month);
      svg+=`<circle cx="${x(i)}" cy="${y(points[i])}" r="${month.full?5:5.5}" class="season-overlay-point ${month.full?'':'is-partial'}" stroke="${colour}" fill="${month.full?colour:'#fffefa'}" ${seasonCellAttributes('month',year.year,i,title)} role="button" tabindex="0"><title>${esc(title)}</title></circle>`;
    }
    svg+='</g>';
  }
  if(baseline.some(n=>n!==null))svg+=`<g style="color:#273c31"><path d="${baseline.map((v,i)=>v===null?'':`${i===0||baseline[i-1]===null?'M':'L'}${x(i)} ${y(v)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="6 5"/></g>`;
  svg+='</svg>';
  const legend=yearsData.map(({year,colour})=>`<span class="season-legend-item"><i style="background:${colour}"></i>${year.year}${year.full?'':' · partial'}</span>`).join('');
  const hasBaseline=baseline.some(n=>n!==null);
  target.innerHTML=`<p class="season-scroll-hint">Swipe sideways to compare Jul–Dec ↔</p><div class="season-overlay-scroll">${svg}</div><div class="season-legend">${legend}${hasBaseline?'<span class="season-legend-item"><i class="season-baseline-marker"></i>Mean · 3+ complete years</span>':''}</div><p class="season-table-footnote">Filled dots: complete calendar months. Hollow dots: partial months inside the global authored-date window. Lines never bridge unobserved months. The ${state.seasonMode==='index'?'1× dashed baseline is the year’s average rate; an actual multi-year seasonal mean appears only with ≥3 complete years.':'line values reflect the selected measure and observed days; no extrapolation is performed.'}</p>`;
}
function renderSeasonSignals(model,years) {
  const target=$('season-signals');
  const full=years.filter(y=>y.full&&y.count>0);
  const completeMonthRates=SEASON_MONTHS.map((name,month)=>{
    const eligible=years.map(y=>y.months[month]).filter(m=>m.full);
    return {name,month,count:eligible.length,average:eligible.length?sum(eligible.map(m=>m.pace))/eligible.length:null};
  }).filter(m=>m.count);
  const sorted=[...completeMonthRates].sort((a,b)=>b.average-a.average);
  const busiest=sorted[0],quietest=sorted.at(-1);
  const recurring=full.length>=3;
  const metric=(label,value,desc)=>`<div class="season-signal"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(desc)}</small></div>`;
  target.innerHTML=`<div class="season-section-head"><div><span class="eyebrow">02 / WHAT CAN WE CONCLUDE?</span><h5>${recurring?'Repeated signals, with caveats.':'Patterns to investigate, not proven seasonality.'}</h5></div></div><div class="season-signal-grid">${metric('FULL YEARS',`${full.length}`,recurring?'Enough for a descriptive seasonal mean':'Three or more complete years recommended')}${metric('HIGHEST RECORDED MONTH',busiest?busiest.name:'—',busiest?`${decimal.format(busiest.average)} commits/week · ${busiest.count} complete months`:'No complete months')}${metric('LOWEST RECORDED MONTH',quietest?quietest.name:'—',quietest?`${decimal.format(quietest.average)} commits/week · ${quietest.count} complete months`:'No complete months')}</div><p class="season-table-footnote">${recurring?'The overlaid profile supports a descriptive multi-year baseline, not a prediction.':'The lines are exploratory; a repeated month in only one or two years cannot establish seasonality.'} High/low months summarise calendar-week rates for <em>complete observed months only</em>. Different amounts of imported history, changes in team size and release cycles may explain these patterns.</p>`;
}
function seasonDetailMarkup(model,selection) {
  if(!selection) return `<div class="season-inspector-placeholder"><strong>Pick a month or an hourly square to inspect.</strong><span>Hover or focus for a quick breakdown. Click to pin the evidence and inspect individual authored commits. This does not alter dashboard filters.</span></div>`;
  const year=model.years.find(y=>y.year===selection.year);
  if(!year) return seasonDetailMarkup(model,null);
  let items=[],title='',sub='',referenceCount=0,exposure='';
  if(selection.kind==='month'){
    const m=year.months[selection.index];
    if(!m?.days)return seasonDetailMarkup(model,null);
    items=m.commits;
    title=`${SEASON_MONTHS[m.month]} ${m.year}`;
    sub=`${m.days} of ${m.calendarDays} calendar days in scope · ${m.full?'complete':'partial'} month · ${model.name}`;
    exposure=`${decimal.format(m.pace)} commits/week · ${m.share===null?'undefined':percent(m.share)} of ${m.year} commits · ${m.index===null?'undefined':decimal.format(m.index)+'×'} annual daily baseline`;
    referenceCount=m.referenceCount;
  } else if(selection.kind==='slot'){
    const day=Math.floor(selection.index/24),hour=selection.index%24;
    items=year.commits.filter(c=>Number.isInteger(c.hour)&&dayOfWeek(c.date)===day&&c.hour===hour);
    title=`${year.year} · ${DAY_NAMES[day]} ${String(hour).padStart(2,'0')}:00–${String(hour).padStart(2,'0')}:59`;
    sub=`${year.timedCount} timed commits in ${year.year} · ${year.untimedCount} without an authored hour`;
    exposure=`${year.timedCount?percent(items.length/year.timedCount*100):'undefined'} of ${year.year} timed commits · ${number.format(year.weekdayExposures[day])} observed ${DAY_NAMES[day]} occurrences`;
    referenceCount=analysis.referenceCommits.filter(c=>Number(c.date.slice(0,4))===year.year&&Number.isInteger(c.hour)&&dayOfWeek(c.date)===day&&c.hour===hour).length;
  } else return seasonDetailMarkup(model,null);
  const uniqueDates=new Set(items.map(c=>c.date)).size;
  const files=items.flatMap(c=>c.files);
  const added=sum(files.map(f=>f.added)),deleted=sum(files.map(f=>f.deleted));
  const evidence=[...items].sort((a,b)=>(b.authoredAt??-1)-(a.authoredAt??-1)).slice(0,8);
  const share=referenceCount ? `${percent(items.length/referenceCount*100)} of ${model.referenceName} activity in this slice` : 'No commits in reference slice; percentage undefined';
  const facts=(label,value)=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`;
  const m=selection.kind==='month'?year.months[selection.index]:null;
  return `<div class="season-detail-header"><div><span class="eyebrow">${seasonPinned?'PINNED EVIDENCE':'HOVER OR FOCUS · CLICK TO PIN'} / AUTHOR DATES</span><h5>${esc(title)}</h5><p>${esc(sub)}</p></div><div class="season-detail-actions">${m?`<button type="button" class="season-detail-scope" data-action="season-apply-month" data-season-year="${year.year}" data-season-index="${selection.index}">View this month across dashboard ↗</button>`:''}${seasonPinned?'<button type="button" class="rhythm-unpin" data-action="season-unpin">Unpin ×</button>':''}</div></div><div class="season-detail-facts">${facts('COMMITS',number.format(items.length))}${facts('AUTHOR DATES',number.format(uniqueDates))}${facts('FILE TOUCHES',number.format(files.length))}${facts('TEXT + / −',`+${number.format(added)} / −${number.format(deleted)}`)}${facts('REFERENCE SHARE',referenceCount?percent(items.length/referenceCount*100):'—')}</div><p class="season-detail-description">${esc(exposure)} · ${esc(share)}</p>${evidence.length?`<div class="season-evidence"><span class="eyebrow">${evidence.length} MOST RECENT OF ${items.length} MATCHING COMMITS</span><ol>${evidence.map(c=>`<li><span>${esc(`${c.date}${Number.isInteger(c.hour)?' '+String(c.hour).padStart(2,'0')+':'+String(c.minute??0).padStart(2,'0'):''}`)} · ${esc(c.hash?.slice(0,8)||'—')}</span><strong>${esc(c.subject||'(No subject)')}</strong></li>`).join('')}</ol></div>`:'<p class="season-table-footnote">No authored commits in this observed slice.</p>'}`;
}
function renderSeasonDetail() {
  if (!seasonModel || state.rhythmTab==='weekly') return;
  const selection=seasonPinned||seasonHover;
  $('season-detail').innerHTML=seasonDetailMarkup(seasonModel,selection);
  const key=seasonKey(selection);
  $('season-explorer').querySelectorAll('[data-season-cell]').forEach(node=>{
    const active=key===seasonKey({kind:node.dataset.seasonKind,year:Number(node.dataset.seasonYear),index:Number(node.dataset.seasonIndex)});
    node.classList.toggle('is-active',active);
    node.setAttribute('aria-pressed',String(Boolean(seasonPinned && active)));
  });
}
function renderSeasonality(view) {
  const shown = state.rhythmTab !== 'weekly';
  $('rhythm-weekly-content').hidden = shown;
  $('season-explorer').hidden = !shown;
  document.querySelectorAll('[data-rhythm-tab]').forEach(button=>{
    const active=button.dataset.rhythmTab===state.rhythmTab;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  if (!shown) return;
  const focus=rhythmFocus(view);
  if(seasonModel?.focusId!==focus){seasonPinned=null;seasonHover=null;}
  seasonModel=seasonalityAnalysis(view,focus);
  const model=seasonModel;
  const years=seasonShownYears(model);
  $('season-year-content').hidden=state.rhythmTab!=='years';
  $('season-seasonal-content').hidden=state.rhythmTab!=='seasonal';
  setText('rhythm-focus-name',model.focusId==='selection'?`Selected contributors, across time`:`${model.name}, across time`);
  setText('season-view-title',state.rhythmTab==='years'?'Across years':'Recurring seasonal patterns');
  setText('season-explanation',state.rhythmTab==='years'?'Separate changes in activity level from changes in timing and composition.': 'Compare January with January and examine whether seasonal swings recur.');
  document.querySelectorAll('[data-season-mode]').forEach(button=>{
    const active=button.dataset.seasonMode===state.seasonMode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const descriptions={
    rate:'Commits per seven calendar days, including quiet days, normalised by observed dates. Each cell also retains its original commit count.',
    shape:'Percentage of that year’s authored commits. Compares the distribution, not volume; partial years are explicitly marked.',
    index:'Monthly daily rate ÷ that same year’s daily average. 1× means typical for the observed portion of the year; undefined when a year has no commits.',
  };
  setText('season-mode-help',`${seasonModeTitle()}. ${descriptions[state.seasonMode]} All three modes use the same global scope and contributor focus.`);
  renderSeasonYearPicker(model);
  if(!model.years.length){$('season-month-matrix').innerHTML=seasonEmpty('No authored dates in the selected and imported period.');$('season-overlay').innerHTML=seasonEmpty('No historic data in scope.');return;}
  if(state.rhythmTab==='years') {
    renderSeasonMonthMatrix(model,years);
    renderSeasonAnnualScorecard(years);
    renderSeasonRhythmYears(model,years);
    renderSeasonPeople(model,years);
  } else {
    renderSeasonOverlay(model,years);
    renderSeasonSignals(model,years);
  }
  renderSeasonDetail();
}

// Independent behaviour slice from the exact same commit cohort. Commit
// footprint is categorical and so intentionally ignores the metric-rate lens.
const SIZE_BANDS=[
  {label:'0 text lines',min:0,max:0,color:'#c6d3c9'},
  {label:'1–19 lines',min:1,max:19,color:'#84b5a4'},
  {label:'20–199 lines',min:20,max:199,color:'#36886f'},
  {label:'200+ lines',min:200,max:Infinity,color:'#d47c56'},
];
// Timeline viewport is a presentation preference, independent of the shared
// author-date and release-date filters used to calculate Git evidence.
function timelinePreference() {
  return {mode:state.impactTimelineMode,from:state.impactTimelineFrom,to:state.impactTimelineTo};
}
function setTimelinePreference(next) {
  state.impactTimelineMode=next.mode;
  state.impactTimelineFrom=next.from || null;
  state.impactTimelineTo=next.to || null;
}
function scrollToImpactMarker(hash, {restoreFocus=null,showTimeline=true}={}) {
  requestAnimationFrame(()=>{
    const container=$('impact-timeline').querySelector('.impact-timeline-scroll');
    const marker=[...(container?.querySelectorAll('[data-impact-hash]')||[])].find(dot=>dot.dataset.impactHash===hash);
    if(marker && container){
      const box=container.getBoundingClientRect(), rect=marker.getBoundingClientRect();
      if(rect.left<box.left+24 || rect.right>box.right-24){
        const centre=(rect.left+rect.right)/2-(box.left+box.right)/2;
        container.scrollTo({left:Math.max(0,container.scrollLeft+centre),behavior:'smooth'});
      }
    }
    // Rebuilding the select/marker replaces its DOM node. Retain keyboard
    // focus without stealing it when the user selected from another view.
    if(restoreFocus==='select')$('impact-release-select')?.focus({preventScroll:true});
    else if(restoreFocus==='marker')marker?.focus({preventScroll:true});
    if(showTimeline){
      const target=$('impact-timeline');
      const rect=target.getBoundingClientRect();
      if(rect.top<0 || rect.bottom>window.innerHeight)target.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
  });
}
function chooseImpactRelease(hash, {focus=null,showTimeline=true}={}) {
  if(!impactModel?.releases.some(r=>r.hash===hash))return;
  state.impactReleaseHash=hash;
  state.impactTab='timeline';
  setTimelinePreference(impactTimelineReveal(impactModel,timelinePreference(),hash));
  renderImpact(analysis);
  scrollToImpactMarker(hash,{restoreFocus:focus,showTimeline});
}
function selectImpactReleaseWithinWindow() {
  const window=impactTimelineWindow(impactModel,timelinePreference());
  if(!window)return;
  const candidates=impactModel.releases.filter(r=>impactReleasePosition(r)>=window.start&&impactReleasePosition(r)<=window.end);
  if(candidates.length && !candidates.some(r=>r.hash===state.impactReleaseHash))state.impactReleaseHash=candidates.at(-1).hash;
}
function matrixOptions() {
  return {mode:state.impactMatrixMode,page:state.impactMatrixPage,year:state.impactMatrixYear,
    size:state.impactMatrixSize,selectedHash:state.impactReleaseHash};
}
function revealMatrixSelection() {
  const scroll=$('impact-matrix-section')?.querySelector('.impact-matrix-scroll');
  const column=[...(scroll?.querySelectorAll('[data-matrix-release]')||[])].find(th=>th.dataset.matrixRelease===state.impactReleaseHash);
  if(scroll && column) {
    const outer=scroll.getBoundingClientRect(), inner=column.getBoundingClientRect();
    if(inner.left<outer.left+20 || inner.right>outer.right-20)
      scroll.scrollLeft+=((inner.left+inner.right)-(outer.left+outer.right))/2;
  }
}
function refreshImpactMatrix({reveal=false,focus=null}={}) {
  const region=$('impact-matrix-section');
  if(!region || !impactModel)return renderImpact(analysis);
  region.innerHTML=impactReleaseMatrix(impactModel,matrixOptions());
  if(reveal || focus)requestAnimationFrame(()=>{
    if(reveal)revealMatrixSelection();
    if(focus) {
      let target;
      if(focus.kind==='page') {
        target=[...region.querySelectorAll('[data-action="impact-matrix-page"]')].find(btn=>btn.dataset.matrixPage===focus.value&&!btn.disabled);
        target ||= region.querySelector('[data-action="impact-matrix-page"]:not([disabled])');
      } else if(focus.kind==='mode') {
        target=[...region.querySelectorAll('[data-action="impact-matrix-mode"]')].find(btn=>btn.dataset.matrixMode===focus.value);
      } else target=region.querySelector(focus.kind==='year'?'#impact-matrix-year':'#impact-matrix-size');
      target?.focus({preventScroll:true});
    }
  });
}
function matrixJump(hash) {
  const index=impactModel?.releases.findIndex(r=>r.hash===hash)??-1;
  if(index<0)return;
  state.impactReleaseHash=hash;
  state.impactMatrixMode='all';
  // An explicit tag jump takes precedence over an earlier year restriction.
  state.impactMatrixYear='all';
  state.impactMatrixPage=impactMatrixPageForRelease(impactModel.releases,hash,state.impactMatrixSize);
  setTimelinePreference(impactTimelineReveal(impactModel,timelinePreference(),hash));
  renderImpact(analysis);
  requestAnimationFrame(revealMatrixSelection);
}
function exportImpactMatrix() {
  if(!impactModel?.releases.length)return;
  const blob=new Blob(['\ufeff',impactReleaseMatrixCsv(impactModel)],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;
  link.download=downloadFilename('release-matrix');
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderImpact(view) {
  // The expensive release reconstruction is computed once in the worker.
  // Interacting with the timeline, tab, or release picker only rerenders HTML.
  if (!view || !impactModel) return;
  const model=impactModel;
  $('impact-empty').innerHTML=impactSelectMessage(model);
  $('impact-panels').hidden=!model.releases.length;
  if(!model.releases.length)return;
  if(!model.releases.some(r=>r.hash===state.impactReleaseHash)) state.impactReleaseHash=model.releases.at(-1).hash;
  const selected=model.releases.find(r=>r.hash===state.impactReleaseHash);
  $('impact-summary').innerHTML=impactSummary(model);
  const mappingOpen=$('impact-github-status').querySelector('details.impact-identity-mapping')?.open;
  $('impact-github-status').innerHTML=impactGithubStatus(model);
  if(mappingOpen)$('impact-github-status').querySelector('details.impact-identity-mapping')?.setAttribute('open','');
  if(!view.contributors.some(c=>c.id===state.impactFocus))state.impactFocus='selection';
  setText('impact-scope',`Release-event dates: ${view.start}–${view.end} · Author dates: same range · ${view.includeMerges?'Merges included':'Merges excluded'} · ${view.includeReverts?'Reverts included':'Reverts excluded'} · ${model.referenceLabel} reference · ${model.allReleaseCount-model.releases.length} tagged snapshots outside the selected release-event window${model.unresolved.length?` · ${model.unresolved.length} unresolved tag refs`:''}. Tag boundaries are graph-based.`);
  const timelineScroll=$('impact-timeline').querySelector('.impact-timeline-scroll')?.scrollLeft || 0;
  $('impact-timeline').innerHTML=impactTimeline(model,state.impactReleaseHash,timelinePreference());
  const newScroll=$('impact-timeline').querySelector('.impact-timeline-scroll');
  if(newScroll)newScroll.scrollLeft=timelineScroll;
  $('impact-release-control').innerHTML=impactReleasePicker(model,state.impactReleaseHash);
  document.querySelectorAll('[data-impact-tab]').forEach(btn=>{const active=btn.dataset.impactTab===state.impactTab;btn.classList.toggle('is-active',active);btn.setAttribute('aria-pressed',String(active));});
  const titles={timeline:'A release, under the microscope.',matrix:'Who drove and contributed to each release?',reach:'Where did the changes reach?',durability:'What happened after the release?'};
  setText('impact-tab-title',titles[state.impactTab]);

  $('impact-area-toolbar').hidden=state.impactTab!=='reach';
  if(state.impactTab==='timeline') $('impact-content').innerHTML=impactReleaseDetail(selected,model.referenceLabel,state.impactMetric);
  else if(state.impactTab==='matrix') $('impact-content').innerHTML=impactIndividualProfiles(model,state.impactFocus)+`<div id="impact-matrix-section">${impactReleaseMatrix(model,matrixOptions())}</div>`;
  else if(state.impactTab==='reach') $('impact-content').innerHTML=impactReach(model,state.impactAreaMode);
  else $('impact-content').innerHTML=impactDurability(model,state.impactReleaseHash,state.impactShowAll);
  if($('impact-metric-select'))$('impact-metric-select').value=state.impactMetric;
  document.querySelectorAll('[data-impact-area-mode]').forEach(btn=>{const active=btn.dataset.impactAreaMode===state.impactAreaMode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
}

function renderFootprint(view) {
  if(!view.contributors.length){$('footprint').innerHTML=empty('No contributors selected.');return;}
  const rows=view.contributors.map(c=>{
    const sizes=c.commits.map(commit=>sum(commit.files.map(f=>f.added+f.deleted))).sort((a,b)=>a-b);
    const counts=SIZE_BANDS.map(b=>sizes.filter(n=>n>=b.min&&n<=b.max).length);
    const median=sizes.length?(sizes.length%2?sizes[(sizes.length-1)/2]:(sizes[sizes.length/2-1]+sizes[sizes.length/2])/2):null;
    const segments=counts.map((n,i)=>n?`<div class="footprint-segment" style="width:${n/sizes.length*100}%;background:${SIZE_BANDS[i].color}" title="${esc(SIZE_BANDS[i].label)}: ${n} commits (${percent(n/sizes.length*100)})"></div>`:'').join('');
    const labels=counts.map((n,i)=>`${SIZE_BANDS[i].label}: ${n}`).join('; ');
    return `<div class="footprint-row"><span class="footprint-person" style="${style(c.id)}"><i class="person-dot"></i>${esc(c.displayName)}</span><div class="footprint-bar" role="img" aria-label="${esc(c.displayName)}: ${esc(labels)}">${segments}</div><span class="footprint-value">${number.format(sizes.length)} commits <small>median ${median===null?'—':number.format(median)} lines</small></span></div>`;
  }).join('');
  const legend=SIZE_BANDS.map(b=>`<span><i style="background:${b.color}"></i>${esc(b.label)}</span>`).join('');
  $('footprint').innerHTML=`<div class="footprint-rows">${rows}</div><div class="footprint-legend">${legend}</div>`;
}

function renderAreas(view) {
  if(!view.contributors.length) { $('areas').innerHTML=empty('No contributors selected.');return; }
  const allAreaNames=new Set();
  for(const c of view.referenceContributors) for(const name of c.areas.keys()) allAreaNames.add(name);
  const selectedAreas=new Map();
  const refAreas=new Map();
  for(const name of allAreaNames){
    const selected=sum(view.contributors.map(c=>c.areas.get(name)?.touches||0));
    if(!selected) continue;
    selectedAreas.set(name,selected);
    refAreas.set(name,sum(view.referenceContributors.map(c=>c.areas.get(name)?.touches||0)));
  }
  const top=[...selectedAreas.keys()].sort((a,b)=>selectedAreas.get(b)-selectedAreas.get(a)||a.localeCompare(b)).slice(0,10);
  if(!top.length){$('areas').innerHTML=empty('No file changes in this filtered set (some commits have no numstat records).');return;}
  const mx=Math.max(...top.map(name=>refAreas.get(name)),1);
  const rows=top.map(name=>{
    const selected=selectedAreas.get(name), ref=refAreas.get(name);
    const blocks=view.contributors.map(c=>({id:c.id,name:c.displayName,n:c.areas.get(name)?.touches||0})).filter(b=>b.n);
    const others=Math.max(0,ref-selected);
    return `<div class="area-row"><span class="area-name" title="${esc(name)}">${esc(name)}</span><div class="area-track" aria-label="${esc(name)}: ${selected} selected file touches of ${ref} reference"><div class="area-segment" style="width:${(ref/mx)*100}%;display:flex">${blocks.map(b=>`<div style="width:${b.n/ref*100}%;background:${color(b.id)}" title="${esc(b.name)}: ${b.n} touches"></div>`).join('')}${others?`<div class="area-segment other" style="width:${others/ref*100}%" title="Unselected contributors: ${others} touches"></div>`:''}</div></div><span class="area-value" title="Selected / reference file touches">${number.format(selected)}${view.denominator==='repository'?` / ${number.format(ref)}`:''}</span></div>`;
  }).join('');
  const legend=view.contributors.map(c=>`<span style="${style(c.id)}"><i></i>${esc(c.displayName)}</span>`).join('');
  $('areas').innerHTML=`<div class="viz-top"><span class="eyebrow">FILE TOUCHES BY TOP-LEVEL AREA</span><span class="helper">${view.denominator==='repository'?'Selected / entire repository':'Selected contributor totals'}</span></div>${rows}<div class="area-legend">${legend}${view.denominator==='repository'&&view.referenceContributors.length>view.contributors.length?'<span><i style="background:#c6cdc6"></i>Other contributors</span>':''}</div>`;
}
function renderRecent(view) {
  const commits=[...view.selectedCommits].sort((a,b)=>(b.authoredAt??0)-(a.authoredAt??0)||b.date.localeCompare(a.date)).slice(0,18);
  if(!commits.length){$('recent-commits').innerHTML=empty('No commits in this scope.');return;}
  $('recent-commits').innerHTML=`<table class="data-table"><thead><tr><th scope="col">AUTHORED</th><th scope="col">CONTRIBUTOR</th><th scope="col">COMMIT / SUBJECT</th><th scope="col" class="right">LINES + / −</th><th scope="col" class="right">FILES</th></tr></thead><tbody>${commits.map(c=>{
    const author=view.byId.get(c.groupId);
    const added=sum(c.files.map(f=>f.added)),deleted=sum(c.files.map(f=>f.deleted));
    const hour=c.hour===null?'':` ${String(c.hour).padStart(2,'0')}:${String(c.minute??0).padStart(2,'0')}`;
    return `<tr><td>${esc(c.date+hour)}</td><td class="name-cell"><span style="${style(c.groupId)}"><i class="person-dot"></i>${esc(author?.displayName||c.name)}</span></td><td><span class="commit-subject" title="${esc(c.subject)}">${esc(c.hash?.slice(0,7)||'—')} · ${esc(c.subject)}${c.isMerge?'<span class="flag merge">merge</span>':''}${c.isRevert?'<span class="flag revert">revert</span>':''}${c.touchesVersion?'<span class="flag version">VERSION</span>':''}</span></td><td class="right"><span class="number-add">+${number.format(added)}</span> / <span class="number-del">−${number.format(deleted)}</span></td><td class="right">${c.files.length}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function storyPerson() {
  if(!storyModel)return null;
  if(state.storyPerspective==='team')return storyModel.people.find(p=>p.id==='selection');
  return storyModel.people.find(p=>p.id===state.storyFocus&&p.id!=='selection') ||
    storyModel.people.find(p=>p.id!=='selection') || null;
}
function setExperienceVisibility() {
  const stories=state.viewMode!=='evidence';
  $('stories-view').hidden=!stories;
  $('evidence-view').hidden=stories;
  for(const button of document.querySelectorAll('[data-experience]')){
    const active=button.dataset.experience===state.viewMode;
    button.classList.toggle('is-current',active);
    if(button.tagName==='A'){
      button.setAttribute('aria-current',active?'page':'false');
      button.href=targetUrl(routePath(),{...primary,mode:state.viewMode},mergeGroups.map((g,i)=>({...g,id:String(i)})),localDatasetId,{view:button.dataset.experience});
    }else button.setAttribute('aria-pressed',String(active));
  }
  const saved=$('local-link-toggle');
  if(saved)saved.textContent=localDatasetId?'Update saved history for other tabs':'Enable multi-tab links';
  const forget=$('local-link-clear');if(forget)forget.hidden=!localDatasetId;
}
function renderStories() {
  if(!storyModel)return;
  const model=storyModel;
  const eligible=new Set(model.allFindings.map(f=>f.id));
  if(state.storyFindingId&&!eligible.has(state.storyFindingId))state.storyFindingId=null;
  if(!model.people.some(p=>p.id===state.storyFocus&&p.id!=='selection'))state.storyFocus=model.people.find(p=>p.id!=='selection')?.id||'selection';
  const person=storyPerson();
  if(state.storyMonth&&!person?.months.some(m=>m.month===state.storyMonth))state.storyMonth=null;
  const root=$('stories-view');
  const scroller=$('story-journey-scroll');
  const previousScroll=scroller?.scrollLeft||0;
  root.innerHTML=renderStoryExplorer(model,{
    perspective:state.storyPerspective,focus:state.storyFocus,topic:state.storyTopic,category:state.storyCategory,
    showAll:state.storyShowAll,findingId:state.storyFindingId,month:state.storyMonth,
    dismissed:state.storyDismissed,trail:state.storyTrail,pairA:state.storyPairA,pairB:state.storyPairB,
  });
  const nextScroll=$('story-journey-scroll');
  if(nextScroll)nextScroll.scrollLeft=previousScroll;
  const a=$('story-person-a'),b=$('story-person-b');
  if(a&&b){
    const rows=model.comparison;
    if(!rows.some(r=>r.id===state.storyPairA))state.storyPairA=rows[0]?.id||null;
    if(!rows.some(r=>r.id===state.storyPairB&&r.id!==state.storyPairA))state.storyPairB=rows.find(r=>r.id!==state.storyPairA)?.id||null;
    if(state.storyPairA)a.value=state.storyPairA;
    if(state.storyPairB)b.value=state.storyPairB;
  }
}
function focusStoryMonth() {
  const cell=[...document.querySelectorAll('.story-month')].find(t=>t.dataset.storyMonth===state.storyMonth);
  if(cell){cell.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});cell.focus({preventScroll:true});}
}
let evidencePendingRun=-1;
async function ensureEvidenceRendered(run=renderGeneration,generation=progressGeneration) {
  if(evidenceRenderedRun===run || !analysis)return;
  if(evidenceRenderPromise && evidencePendingRun===run)return evidenceRenderPromise;
  evidencePendingRun=run;
  const job=(async()=>{
    const stages=[
      ['Preparing comparisons',79,'Summary, trends and contributor scorecard',()=>{
        renderStats(analysis);renderRanking(analysis);renderTrend(analysis);renderTable(analysis);
      }],
      ['Rendering activity pulse',84,'Comparing authored dates',()=>renderPulse(analysis)],
      ['Rendering weekly rhythms',89,'Weekdays, hours and seasonality',()=>renderRhythm(analysis)],
      ['Rendering impact evidence',94,'Tagged releases and contributor roles',()=>renderImpact(analysis)],
      ['Finishing the evidence',98,'Footprint, codebase areas and commit history',()=>{
        renderFootprint(analysis);renderAreas(analysis);renderRecent(analysis);
      }],
    ];
    for(const [label,value,help,render] of stages){
      if(run!==renderGeneration)return;
      showProgress(label,value,help,generation);
      await yieldToUI();
      if(run!==renderGeneration)return;
      try{render();}
      catch(error){
        if(label==='Rendering impact evidence'){
          console.error('Impact Explorer rendering failed',error);
          $('impact-panels').hidden=true;
          $('impact-empty').innerHTML=`<div class="impact-empty" role="alert"><strong>Impact Explorer could not render</strong><p>${esc(error.message||'Unknown error')}</p></div>`;
        } else throw error;
      }
    }
    if(run===renderGeneration)evidenceRenderedRun=run;
  })();
  evidenceRenderPromise=job;
  try{await job;}finally{if(evidencePendingRun===run){evidencePendingRun=-1;evidenceRenderPromise=null;}}
}
async function switchExperience(next,{target=null}={}) {
  if(!['observatory','periods','contributors','codebase','deployments','evidence'].includes(next))return;
  state.viewMode=next;
  if(next!=='evidence')primary.mode=next;
  setExperienceVisibility();
  if(!routeRestoring)routePushPending=true;
  if(next!=='evidence')renderPrimary();
  else if(evidenceRenderedRun!==renderGeneration && analysis){
    const generation=++progressGeneration;
    showProgress('Opening the evidence workbench',76,'Rendering the requested charts in manageable stages',generation);
    try{await ensureEvidenceRendered(renderGeneration,generation);finishProgress(generation);}
    catch(error){finishProgress(generation,error);$('scope-error').textContent=`Evidence rendering failed: ${error.message}`;}
  }
  if(next==='evidence')syncBrowserRoute();
  if(target){
    const node=$(target);
    if(node && !node.closest('[hidden]'))node.scrollIntoView({behavior:'smooth',block:'start'});
  } else $('dashboard-heading').scrollIntoView({behavior:'smooth',block:'start'});
}
async function storyOpenEvidence(anchor='ranking-heading',releaseHash=null) {
  if(releaseHash) {state.impactTab='timeline';state.impactReleaseHash=releaseHash;}
  await switchExperience('evidence',{target:anchor});
  if(releaseHash&&impactModel?.releases.some(r=>r.hash===releaseHash))chooseImpactRelease(releaseHash,{showTimeline:false});
  if(anchor==='rhythm-heading' && state.storyPerspective==='person' && analysis?.selectedIds.has(state.storyFocus)){
    state.rhythmFocus=state.storyFocus;
    if(evidenceRenderedRun===renderGeneration)renderRhythm(analysis);
  }
  if(anchor==='impact-explorer' && evidenceRenderedRun===renderGeneration)renderImpact(analysis);
}
async function renderDashboard() {
  if(!rawCommits.length || $('dashboard').hidden)return;
  const generation=++progressGeneration;
  const run=++renderGeneration;
  const scope=analysisScope();
  const groups=mergeGroups.map(g=>({displayName:g.displayName,emails:[...g.emails]}));
  const impactOptions={metric:state.impactMetric,githubStatus,
    actorMap:{...state.impactActorMap},captureWarningsCount:githubWarnings.length};
  $('dashboard').setAttribute('aria-busy','true');
  showProgress('Building comparisons',6,'Reconstructing evidence in the background',generation);
  await yieldToUI();
  try {
    const result=await computeViewAndImpact(groups,scope,impactOptions,generation);
    if(run!==renderGeneration||$('dashboard').hidden)return;
    analysis=result.view;impactModel=result.impact;storyModel=result.stories||buildStoryAnalysis(analysis,impactModel);
    perspectiveIndex=result.primaryIndex;
    evidenceRenderedRun=-1;
    updateControls();renderPicker();renderScope(analysis);
    setExperienceVisibility();
    showProgress('Composing the story',78,'Checking baselines, sample sizes and supporting releases',generation);
    await yieldToUI();
    if(run!==renderGeneration)return;
    renderPrimary();
    if(state.viewMode==='evidence')await ensureEvidenceRendered(run,generation);
    if(run===renderGeneration)finishProgress(generation,null,state.viewMode==='evidence'?'Evidence ready':'Repository ready',
      'Tag-defined releases and authored activity are ready to explore.');
  }catch(error){
    if(run!==renderGeneration)return;
    console.error('Git analysis failed',error);
    finishProgress(generation,error);
    $('scope-error').textContent=`Analysis failed: ${error.message}. Check your history import and try again.`;
  }finally{
    if(run===renderGeneration)$('dashboard').removeAttribute('aria-busy');
  }
}

function sessionPayload() {
  if(!rawCommits.length)return null;
  const selectedEmails=mergeGroups.flatMap((g,i)=>state.selectedIds.has(String(i))?g.emails:[]);
  const emailForId = id => /^(0|[1-9]\d*)$/.test(String(id)) ? mergeGroups[Number(id)]?.emails[0]||null : null;
  const payload={version:3,exportedAt:new Date().toISOString(),rangeYears:Number($('range-select').value),rawLog:activeRawLog,
    mergeGroups:mergeGroups.map(g=>({displayName:g.displayName,emails:[...g.emails],workingDays:normalizeWorkingDays(g.workingDays)})),
    scope:{selectedEmails,period:state.period,start:state.start,end:state.end,followsLatest:scopeFollowsLatest,metric:state.metric,mode:state.mode,denominator:state.denominator,
      includeMerges:state.includeMerges,includeReverts:state.includeReverts,trend:state.trend,pulseMode:state.pulseMode,
      pulseLens:state.pulseLens,motionViews:state.motionViews,motionWeeks:state.motionWeeks,motionStep:state.motionStep,motionTrail:state.motionTrail,motionLabels:state.motionLabels,motionLevelDisplay:state.motionLevelDisplay,pulseGapHorizon:state.pulseGapHorizon,pulseBusyDay:state.pulseBusyDay,pulseReleaseLines:state.pulseReleaseLines,pulseDailyChurn:state.pulseDailyChurn,pulseMomentumWorkdays:state.pulseMomentumWorkdays,pulseLevelWorkdays:state.pulseLevelWorkdays,pulseContinuityWeeks:state.pulseContinuityWeeks,continuityView:state.continuityView,pulseTemporalPeriod:state.pulseTemporalPeriod,pulseTemporalChurn:state.pulseTemporalChurn,pulseMeaningfulLines:state.pulseMeaningfulLines,
      rhythmDisplay:state.rhythmDisplay,rhythmTab:state.rhythmTab,seasonMode:state.seasonMode,seasonYears:state.seasonYears?[...state.seasonYears]:null,
      rhythmFocusEmail:emailForId(state.rhythmFocus),
      impactTab:state.impactTab,impactMetric:state.impactMetric,impactAreaMode:state.impactAreaMode,
      impactReleaseHash:state.impactReleaseHash,impactShowAll:state.impactShowAll,
      impactMatrixMode:state.impactMatrixMode,impactMatrixPage:state.impactMatrixPage,
      impactMatrixYear:state.impactMatrixYear,impactMatrixSize:state.impactMatrixSize,
      impactFocusEmail:emailForId(state.impactFocus),
      impactActorMap:state.impactActorMap,
      impactTimelineMode:state.impactTimelineMode,impactTimelineFrom:state.impactTimelineFrom,impactTimelineTo:state.impactTimelineTo,
      viewMode:state.viewMode,storyPerspective:state.storyPerspective,storyTopic:state.storyTopic,storyCategory:state.storyCategory,
      storyShowAll:state.storyShowAll,storyFocusEmail:emailForId(state.storyFocus),
      storyPairAEmail:emailForId(state.storyPairA),
      storyPairBEmail:emailForId(state.storyPairB),
      storyMonth:state.storyMonth,storyDismissed:[...state.storyDismissed].slice(0,300),
      storyFindingId:state.storyFindingId,storyTrail:state.storyTrail.slice(-8),
      primary:primaryStateForExport(primary,mergeGroups)}};
  return payload;
}
function setSessionTransferBusy(busy) {
  sessionTransferBusy=busy;
  $('export-btn').disabled=busy;
  document.querySelector('[data-action="choose-import"]').disabled=busy;
  $('append-activity-btn').disabled=busy || appendBusy;
}
function downloadSessionBlob(blob, compressed) {
  const uri=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=uri;a.download=downloadFilename(compressed?'session':'session-json');
  document.body.appendChild(a);
  a.click();a.remove();
  // Allow browsers time to consume large object URLs before releasing them.
  setTimeout(()=>URL.revokeObjectURL(uri),60000);
}
const formatSize = bytes => bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MiB` : `${Math.max(1,Math.round(bytes/1024))} KiB`;
async function exportSession() {
  if(sessionTransferBusy || appendBusy)return;
  const payload=sessionPayload();if(!payload)return;
  setSessionTransferBusy(true);
  const generation=++progressGeneration;
  showProgress('Preparing session export',4,'Packaging imported history and session preferences locally',generation);
  await yieldToUI();
  try {
    const request=askWorker('session-export',{payload},p=>showProgress(p.phase,p.value,p.message,generation));
    let archive;
    if(request) {
      try {archive=await request;} catch(error) {if(!workerFaulted)throw error;}
    }
    if(!archive){
      showProgress('Preparing session export',12,'Using browser compatibility processing',generation);
      await yieldToUI();
      archive=await encodeSessionArchive(payload,{onProgress:p=>showProgress(p.phase,p.value,p.message,generation)});
    }
    downloadSessionBlob(archive.blob,archive.compressed);
    const ratio=archive.compressed?` (${Math.round(100*(1-archive.blob.size/archive.originalBytes))}% smaller)`:' (uncompressed fallback)';
    finishProgress(generation,null,'Session archive ready',`${formatSize(archive.blob.size)}${ratio}. Download prepared locally.`);
  }catch(error){
    finishProgress(generation,error);
    setText('scope-error',`Could not export session: ${error.message}`);
  }finally{setSessionTransferBusy(false);}
}
async function importSession(event) {
  const file=event.target.files?.[0];event.target.value='';
  if(!file||sessionTransferBusy||appendBusy)return;
  setSessionTransferBusy(true);
  const generation=++progressGeneration;
  showProgress('Opening session',4,'Detecting JSON or gzip archive format',generation);
  await yieldToUI();
  try {
    const request=askWorker('session-import',{file},p=>showProgress(p.phase,p.value,p.message,generation));
    let payload;
    if(request){
      try {payload=await request;} catch(error){if(!workerFaulted)throw error;}
    }
    if(!payload){
      showProgress('Opening session',12,'Using browser compatibility processing',generation);
      await yieldToUI();
      payload=await decodeSessionArchive(file,{onProgress:p=>showProgress(p.phase,p.value,p.message,generation)});
    }
    localDatasetId=null;
    await restoreSessionPayload(payload,file.name);
  }catch(error){
    finishProgress(generation,error);
    setText('parse-error',`Could not import session: ${error.message}`);
  }finally{setSessionTransferBusy(false);}
}
async function restoreSessionPayload(payload,filename='imported session') {
  if(typeof payload?.rawLog!=='string' || !Array.isArray(payload.mergeGroups)) return setText('parse-error','Invalid session: rawLog and mergeGroups required.');
  renderGeneration++; // Prevent an earlier session build from rendering over this one.
  const generation=++progressGeneration;
  showProgress('Restoring session',3,'Reading Git history from the session export',generation);
  let history;
  try {history=await processImportedHistory(payload.rawLog,generation);}
  catch(err){finishProgress(generation,err);return setText('parse-error',err.message);}
  if (generation!==progressGeneration)return;
  parsedHistory=history;activeRawLog=payload.rawLog;
  $('append-history-panel').hidden=true;$('add-activity-toggle').setAttribute('aria-expanded','false');
  $('append-status').hidden=true;$('append-log-input').value='';
  rawHistoryEnrichment=history.historyEnrichment||[];
  rawCommits=history.commits;rawTags=history.tags;
  rawGithubReleases=history.githubReleases;githubStatus=history.githubStatus;rawHerokuReleases=history.herokuReleases;herokuStatus=history.herokuStatus;githubWarnings=history.captureWarnings;
  importRevision++;computedKey=null;computedResult=null;
  identityMeta = makeIdentityCatalogue(rawCommits,rawGithubReleases,rawHerokuReleases);
  identityPicker = null;
  mergeUndo = null;
  linkedOrderEditors.clear();
  renderMergeFeedback();
  // Restoring a session does not need to populate the paste field again.
  $('log-input').value='';
  if(Number.isInteger(Number(payload.rangeYears)) && +payload.rangeYears>=1 && +payload.rangeYears<=5) $('range-select').value=String(payload.rangeYears);
  const emails=new Set(identityMeta.keys());
  const used=new Set();
  mergeGroups=payload.mergeGroups.flatMap(g=>{
    if(!g || !Array.isArray(g.emails)) return [];
    const local=new Set();
    const valid=g.emails.filter(e=>{if(typeof e!=='string')return false;const key=e.toLowerCase();if(!emails.has(key)||used.has(key)||local.has(key))return false;local.add(key);return true;}).map(e=>e.toLowerCase());
    valid.forEach(e=>used.add(e));
    return valid.length?[{displayName:String(g.displayName||valid[0]),emails:valid,workingDays:normalizeWorkingDays(g.workingDays)}]:[];
  });
  // Preserve historical manual assignments; add provider accounts that were
  // introduced in a newer import or an older session format without duplication.
  mergeGroups=reconcileProviderGroups(mergeGroups,externalIdentities(rawGithubReleases,rawHerokuReleases),rawGithubReleases,rawCommits);
  const restoredKeys=new Set(mergeGroups.flatMap(g=>g.emails));
  for(const [email,meta] of identityMeta){if(restoredKeys.has(email))continue;
    mergeGroups.push({displayName:meta.name,emails:[email]});restoredKeys.add(email);
  }
  pendingImport=payload;
  buildDashboard();
  setText('source-status',`${number.format(rawCommits.length)} commits · ${number.format(rawTags.length)} tags · ${number.format(rawHerokuReleases.length)} Heroku events restored from ${filename}`);
  setText('parse-error','');
}

const ACTIONS={
  'experience-mode':(_event,target)=>{
    if(target.dataset.experience==='evidence')switchExperience('evidence');
    else goPrimary(target.dataset.experience,{}, {remember:true});
  },
  'toggle-add-activity':()=>toggleAddActivity(),
  'cancel-add-activity':()=>toggleAddActivity(false),
  'append-activity':()=>appendActivity(),
  'review-identities':()=>{identityPicker=null;renderMergeUI();$('merge-step').hidden=false;$('merge-step').scrollIntoView({behavior:'smooth',block:'start'});},
  'primary-evidence-filters':async()=>{
    $('legacy-scope-details').open=true;
    await switchExperience('evidence',{target:'scope-heading'});
  },
  'primary-nav':(_e,t)=>goPrimary(t.dataset.to),
  'local-link-enable':()=>enableLocalLinks(),
  'local-link-clear':()=>forgetLocalLinks(),
  'local-copy-url':()=>{
    const value=window.location.href;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value).then(()=>historyNotice(localDatasetId?'Link copied. It opens here and in other tabs on this browser.':'Link copied. Another tab requires a session import unless you enable multi-tab links.')).catch(()=>historyNotice('Select and copy the address from your browser.'));
    else historyNotice('Select and copy the address from your browser.');
  },
  'deployment-open':(_e,t)=>{const entry=perspectiveIndex?.deployments?.events.find(e=>e.id===t.dataset.deploymentId);if(!entry)return;
    goPrimary('deployments',{deploymentFocus:entry.id,deploymentEnv:'all',deploymentYear:'all',deploymentPage:0},{scroll:false});
    $('deployment-inspector')?.scrollIntoView({behavior:'smooth',block:'start'});},
  'deployment-select':(_e,t)=>{primary.deploymentFocus=t.dataset.deploymentId;routePushPending=true;renderPrimary();$('deployment-inspector')?.scrollIntoView({behavior:'smooth',block:'nearest'});},
  'deployment-page':(_e,t)=>{primary.deploymentPage=Math.max(0,Number(t.dataset.page)||0);primary.deploymentFocus=null;renderPrimary();},
  'primary-back':()=>window.history.back(),
  'primary-open-release':(_e,t)=>{goPrimary('observatory',{releaseHash:t.dataset.hash,releaseType:'all',releaseYear:'all',releaseBin:null,releaseQuery:'',releasePage:0},{scroll:false});$('primary-release-anatomy')?.scrollIntoView({behavior:'smooth',block:'start'});},
  'primary-select-release':(_e,t)=>{primary.releaseHash=t.dataset.hash;routePushPending=true;renderPrimary();$('primary-release-anatomy')?.scrollIntoView({behavior:'smooth',block:'start'});},
  'primary-open-person':(_e,t)=>goPrimary('contributors',{contributorFocus:t.dataset.person,contributorTab:'delivery',contributorRange:primary.mode==='periods'?'period':'all'}),
  'primary-open-area':(_e,t)=>goPrimary('codebase',{codeArea:t.dataset.area,codebaseRange:primary.mode==='periods'?'period':'all'}),
  'primary-select-area':(_e,t)=>{primary.codeArea=t.dataset.area;routePushPending=true;renderPrimary();},
  'primary-release-page':(_e,t)=>{primary.releasePage=Math.max(0,Number(t.dataset.page)||0);renderPrimary();},
  'primary-reset-release-search':()=>{Object.assign(primary,{releaseBin:null,releaseYear:'all',releaseType:'all',releaseQuery:'',releasePage:0});renderPrimary();},
  'primary-reset-release-bin':()=>{primary.releaseBin=null;renderPrimary();},
  'primary-filter-release-type':(_e,t)=>{primary.releaseType=t.dataset.type;primary.releasePage=0;renderPrimary();},
  'primary-observatory-bin':(_e,t)=>{primary.releaseBin=t.dataset.bin;primary.releasePage=0;renderPrimary();$('primary-release-type')?.scrollIntoView({behavior:'smooth',block:'center'});},
  'primary-release-period':(_e,t)=>{
    const date=t.dataset.date;if(!date)return;
    const at=dayNumber(date);
    goPrimary('periods',{periodFrom:dateAtDay(at-6),periodTo:dateAtDay(at+7),periodPreset:'custom'});
  },
  'primary-period-preset':(_e,t)=>{
    const length=Number(t.dataset.days),window=windowOf(perspectiveIndex,length);
    Object.assign(primary,{periodPreset:String(length),periodFrom:window.from,periodTo:window.to,periodBucket:null});renderPrimary();
  },
  'primary-period-custom':()=>{primary.periodPreset='custom';renderPrimary();$('primary-period-from')?.focus({preventScroll:true});},
  'primary-period-bin':(_e,t)=>{primary.periodBucket=t.dataset.bin;renderPrimary();},
  'primary-period-reset':()=>{primary.periodBucket=null;renderPrimary();},
  'primary-period-cell':(_e,t)=>{primary.periodFocusPerson=t.dataset.person;primary.periodFocusArea=t.dataset.area;renderPrimary();$('primary-copy-status')?.closest('.primary-panel')?.previousElementSibling?.scrollIntoView({behavior:'smooth',block:'nearest'});},
  'primary-contributor-tab':(_e,t)=>{primary.contributorTab=t.dataset.tab;if(primary.contributorTab==='compare'&&!primary.compareB)primary.compareB=perspectiveIndex.groups.find(g=>g.id!==primary.contributorFocus)?.id||null;renderPrimary();},
  'primary-co-release-partner':(_e,t)=>{primary.coReleasePartner=t.dataset.person;primary.contributorTab='together';renderPrimary();$('primary-co-release-detail')?.scrollIntoView({behavior:'smooth',block:'nearest'});},
  'primary-open-co-release-pair':(_e,t)=>{goPrimary('contributors',{contributorFocus:t.dataset.first,coReleasePartner:t.dataset.second,contributorTab:'together'},{scroll:false});$('primary-co-release-detail')?.scrollIntoView({behavior:'smooth',block:'nearest'});},
  'primary-open-month':(_e,t)=>{
    const [y,m]=t.dataset.month.split('-').map(Number),to=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    goPrimary('periods',{periodFrom:`${y}-${String(m).padStart(2,'0')}-01`,periodTo:to,periodPreset:'custom'});
  },
  'primary-open-year':(_e,t)=>goPrimary('periods',{periodFrom:`${t.dataset.year}-01-01`,periodTo:`${t.dataset.year}-12-31`,periodPreset:'custom'}),
  'primary-person-period':(_e,t)=>{const window=windowOf(perspectiveIndex,30);goPrimary('periods',{periodFrom:window.from,periodTo:window.to,periodPreset:'30',periodSelectedId:t.dataset.person});},
  'primary-open-rhythm':async()=>{state.viewMode='evidence';state.rhythmFocus=primary.contributorFocus;await switchExperience('evidence',{target:'rhythm-heading'});},
  'primary-evidence-person':async(_e,t)=>{state.rhythmFocus=t.dataset.person;await switchExperience('evidence',{target:'ranking-heading'});renderRhythm(analysis);},
  'primary-evidence-release':async(_e,t)=>storyOpenEvidence('impact-explorer',t.dataset.hash),
  'primary-copy-briefing':()=>{
    const text=periodBriefingForUi(perspectiveIndex,primary);
    if(!text)return;
    const status=$('primary-copy-status');
    if(!navigator.clipboard?.writeText){
      if(status)status.textContent='Clipboard is unavailable in this browser; use a localhost HTTP server or select the briefing below.';
      let fallback=$('primary-briefing-fallback');
      if(!fallback && status){fallback=document.createElement('textarea');fallback.id='primary-briefing-fallback';fallback.className='primary-briefing-fallback';fallback.setAttribute('aria-label','Period briefing to copy');status.after(fallback);}
      if(fallback){fallback.value=text;fallback.select();}
      return;
    }
    navigator.clipboard.writeText(text).then(()=>{if(status)status.textContent='Briefing copied';})
      .catch(()=>{if(status)status.textContent='Clipboard blocked. Select the briefing below.';let fallback=$('primary-briefing-fallback');if(!fallback&&status){fallback=document.createElement('textarea');fallback.id='primary-briefing-fallback';fallback.className='primary-briefing-fallback';fallback.setAttribute('aria-label','Period briefing to copy');status.after(fallback);}if(fallback){fallback.value=text;fallback.select();}});
  },
  'story-perspective':(_event,target)=>{state.storyPerspective=target.dataset.storyPerspective;state.storyFindingId=null;state.storyMonth=null;state.storyShowAll=false;renderStories();document.querySelector(`[data-story-perspective=\"${state.storyPerspective}\"]`)?.focus({preventScroll:true});},
  'story-inspect':(_event,target)=>{
    const id=target.dataset.storyId;
    if(!storyModel?.allFindings.some(f=>f.id===id))return;
    state.storyFindingId=id;
    state.storyTrail=[...state.storyTrail.filter(key=>key!==id),id].slice(-6);
    renderStories();
    $('story-detail-title')?.focus({preventScroll:true});
    $('story-investigation-panel')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  },
  'story-back':()=>{state.storyFindingId=null;renderStories();},
  'story-close-detail':()=>{const id=state.storyFindingId;state.storyFindingId=null;renderStories();const button=[...document.querySelectorAll('[data-action=\"story-inspect\"]')].find(b=>b.dataset.storyId===id);button?.focus({preventScroll:true});},
  'story-dismiss':(_event,target)=>{state.storyDismissed.add(target.dataset.storyId);if(state.storyFindingId===target.dataset.storyId)state.storyFindingId=null;renderStories();document.querySelector('.story-card [data-action=\"story-inspect\"]')?.focus({preventScroll:true});},
  'story-restore':(_event,target)=>{state.storyDismissed.delete(target.dataset.storyId);renderStories();},
  'story-more':()=>{state.storyShowAll=true;renderStories();},
  'story-less':()=>{state.storyShowAll=false;renderStories();},
  'story-month':(_event,target)=>{state.storyMonth=target.dataset.storyMonth;renderStories();focusStoryMonth();},
  'story-year':(_event,target)=>{
    const selected=storyPerson()?.months.find(m=>m.month.startsWith(target.dataset.storyYear));
    if(selected){state.storyMonth=selected.month;renderStories();focusStoryMonth();}
  },
  'story-release':(_event,target)=>storyOpenEvidence('impact-explorer',target.dataset.storyRelease),
  'story-evidence':(_event,target)=>{
    const finding=storyModel?.allFindings.find(f=>f.id===target.dataset.storyId);
    if(finding)storyOpenEvidence(finding.link,finding.releaseHash);
  },
  'story-evidence-general':()=>storyOpenEvidence('ranking-heading'),
  'story-copy':async(_event,target)=>{
    const finding=storyModel?.allFindings.find(f=>f.id===target.dataset.storyId);
    if(!finding)return;
    const notice=$('story-notice');
    try {await navigator.clipboard.writeText(storyCopyText(finding,storyModel));notice.textContent='Evidence summary copied.';}
    catch {notice.textContent='Clipboard access was blocked by the browser. Try another browser context or use the visible evidence details.';}
  },
  'choose-import':()=> $('file-import-input').click(),
  'export':exportSession,'copy-command':copyCommand,'analyse':analyse,'load-demo':loadDemo,
  'add-merge-group':()=>{if(requireResolvedIdentitySelection())return;forgetUndo();mergeGroups.push({displayName:'New contributor',emails:[]});identityPicker=null;renderMergeUI();openIdentityPicker(mergeGroups.length-1);},
  'toggle-pattern-day':(_event,target)=>{const i=Number(target.dataset.group),day=Number(target.dataset.weekday),group=mergeGroups[i];if(!group||!Number.isInteger(day)||day<0||day>6)return;const current=normalizeWorkingDays(group.workingDays);updateWorkingPattern(i,current.includes(day)?current.filter(d=>d!==day):[...current,day],target);},
  'pattern-preset':(_event,target)=>{const patterns={four:[1,2,3,4],five:[1,2,3,4,5],none:[]};if(Object.hasOwn(patterns,target.dataset.pattern))updateWorkingPattern(Number(target.dataset.group),patterns[target.dataset.pattern],target);},
  'move-contributor':(_e,t)=>moveContributorCard(Number(t.dataset.group), Number(t.dataset.position)),
  'toggle-linked-order':(_e,t)=>toggleLinkedOrder(Number(t.dataset.group)),
  'move-linked-identity':(_e,t)=>moveLinkedIdentity(Number(t.dataset.group),Number(t.dataset.position),Number(t.dataset.step)),
  'split-email':(_e,t)=>splitEmail(Number(t.dataset.group),t.dataset.email),
  'split-group':(_e,t)=>splitGroup(Number(t.dataset.group)),
  'toggle-identity-picker':(_e,t)=>openIdentityPicker(Number(t.dataset.group)),
  'cancel-identity-picker':()=>closeIdentityPicker(),
  'select-visible-identities':()=>{if(!identityPicker)return;mergeCandidates(identityPicker.targetIndex,identityPicker.query).forEach(entry=>entry.emails.forEach(email=>identityPicker.selected.add(email)));refreshIdentityOptions();},
  'clear-identity-selection':()=>{if(!identityPicker)return;identityPicker.selected.clear();refreshIdentityOptions();},
  'apply-identity-picker':applyIdentityPicker,
  'undo-identity-merge':undoIdentityMerge,
  'skip-merge':skipMerge,'render-dashboard':buildDashboard,
  'select-all':()=>{state.selectedIds=new Set(mergeGroups.map((_,i)=>String(i)));renderDashboard();},
  'select-none':()=>{state.selectedIds=new Set();renderDashboard();},
  'solo':(_e,t)=>{state.selectedIds=new Set([t.dataset.personId]);renderDashboard();},
  'reset-filters':resetFilters,
  'trend-mode':(_e,t)=>{state.trend=t.dataset.trend;if(analysis)renderTrend(analysis);},
  'pulse-mode':(_e,t)=>{if(t.dataset.pulseMode==='weekly'&&state.pulseLens!=='continuity')return;state.pulseMode=t.dataset.pulseMode;updateControls();if(analysis)renderPulse(analysis);},
  'pulse-motion-view':(_e,t)=>{const lens=state.pulseLens==='continuity'?state.continuityView:state.pulseLens;if(!MOTION_MODES.includes(lens))return;if(!['cells','motion'].includes(t.dataset.motionView))return;state.motionViews[lens]=t.dataset.motionView;state.motionFrameIndex=-1;if(analysis)renderPulse(analysis);},
  'pulse-lens':(_e,t)=>{const previous=state.pulseLens;state.pulseLens=t.dataset.pulseLens;if(previous!=='continuity'&&state.pulseLens==='continuity')state.pulseMode='weekly';else if(state.pulseMode==='weekly'&&state.pulseLens!=='continuity')state.pulseMode='monthly';updateControls();if(analysis)renderPulse(analysis);},
  'continuity-view':(_e,t)=>{if(!SIGNATURE_MODES.includes(t.dataset.continuityView))return;state.continuityView=t.dataset.continuityView;updateControls();if(analysis)renderPulse(analysis);},
  'rhythm-tab':(_e,t)=>{state.rhythmTab=t.dataset.rhythmTab;seasonHover=null;seasonPinned=null;renderRhythmExplorer(analysis);},
  'season-mode':(_e,t)=>{state.seasonMode=t.dataset.seasonMode;seasonHover=null;seasonPinned=null;renderSeasonality(analysis);},
  'season-all-years':()=>{state.seasonYears=null;seasonHover=null;seasonPinned=null;renderSeasonality(analysis);},
  'season-toggle-year':(_e,t)=>{
    const year=Number(t.dataset.seasonYear);
    const all=seasonModel?.years.map(y=>y.year)||[];
    if(!all.includes(year))return;
    const selected=state.seasonYears?new Set(state.seasonYears):new Set(all);
    if(selected.has(year)){if(selected.size===1)return;selected.delete(year);}
    else selected.add(year);
    state.seasonYears=selected.size===all.length?null:selected;
    seasonHover=null;seasonPinned=null;renderSeasonality(analysis);
  },
  'season-inspect':(_e,t)=>{
    const next={kind:t.dataset.seasonKind,year:Number(t.dataset.seasonYear),index:Number(t.dataset.seasonIndex)};
    seasonPinned=seasonKey(next)===seasonKey(seasonPinned)?null:next;
    seasonHover=next;renderSeasonDetail();
  },
  'season-unpin':()=>{seasonPinned=null;seasonHover=null;renderSeasonDetail();},
  'season-apply-month':(_e,t)=>{
    const year=seasonModel?.years.find(y=>y.year===Number(t.dataset.seasonYear));
    const month=year?.months[Number(t.dataset.seasonIndex)];
    if(!month?.days)return;
    state.start=month.start;state.end=month.end;state.period='custom';
    state.seasonYears=null;seasonPinned=null;seasonHover=null;
    renderDashboard();$('pulse-heading').scrollIntoView({behavior:'smooth',block:'start'});
  },
  'impact-tab':(_e,t)=>{state.impactTab=t.dataset.impactTab;renderImpact(analysis);},
  'impact-release':(event,t)=>{
    const fromMarker=!!t.closest('.impact-timeline-scroll');
    chooseImpactRelease(t.dataset.impactHash,{focus:event.type==='keydown'&&fromMarker?'marker':null,showTimeline:!fromMarker});
    if(fromMarker && event.type!=='keydown')$('impact-content').scrollIntoView({behavior:'smooth',block:'nearest'});
  },
  'impact-range-preset':(_event,t)=>{
    setTimelinePreference({mode:t.dataset.impactRange});
    selectImpactReleaseWithinWindow();renderImpact(analysis);
  },
  'impact-zoom':(_event,t)=>{
    const anchorRelease=impactModel?.releases.find(r=>r.hash===state.impactReleaseHash);
    const anchor=anchorRelease?impactReleasePosition(anchorRelease):null;
    setTimelinePreference(impactTimelineZoom(impactModel,timelinePreference(),t.dataset.impactZoom==='in'?0.6:1.7,anchor));
    renderImpact(analysis);
    scrollToImpactMarker(state.impactReleaseHash,{showTimeline:false});
  },
  'impact-toggle-all':()=>{state.impactShowAll=!state.impactShowAll;renderImpact(analysis);},
  'impact-matrix-mode':(_event,t)=>{state.impactMatrixMode=t.dataset.matrixMode==='latest'?'latest':'all';refreshImpactMatrix({focus:{kind:'mode',value:state.impactMatrixMode}});},
  'impact-matrix-page':(_event,t)=>{
    const w=impactMatrixWindow(impactModel.releases,matrixOptions());
    if(t.dataset.matrixPage==='oldest')state.impactMatrixPage=w.pages-1;
    else if(t.dataset.matrixPage==='older')state.impactMatrixPage=Math.min(w.pages-1,w.page+1);
    else if(t.dataset.matrixPage==='newer')state.impactMatrixPage=Math.max(0,w.page-1);
    else if(t.dataset.matrixPage==='latest')state.impactMatrixPage=0;
    refreshImpactMatrix({focus:{kind:'page',value:t.dataset.matrixPage}});
  },
  'impact-export-matrix':exportImpactMatrix,
  'impact-profile-focus':(_event,t)=>{state.impactFocus=t.dataset.impactFocus;renderImpact(analysis);},
  'impact-area-mode':(_e,t)=>{state.impactAreaMode=t.dataset.impactAreaMode;renderImpact(analysis);},
  'rhythm-focus':(_e,t)=>{state.rhythmFocus=t.dataset.rhythmFocus;rhythmHover=null;rhythmPinned=null;renderRhythm(analysis);if(t.classList.contains('rhythm-explore-link'))$('rhythm-explorer').scrollIntoView({behavior:'smooth',block:'start'});},
  'rhythm-display':(_e,t)=>{state.rhythmDisplay=t.dataset.rhythmDisplay;rhythmHover=null;renderRhythmExplorer(analysis);},
  'rhythm-inspect':(_e,t)=>{const next={kind:t.dataset.rhythmKind,index:Number(t.dataset.rhythmIndex)};rhythmPinned=rhythmDatumKey(rhythmPinned)===rhythmDatumKey(next)?null:next;rhythmHover=next;renderRhythmDetail();},
  'rhythm-unpin':()=>{rhythmPinned=null;rhythmHover=null;renderRhythmDetail();},
  'pulse-day':(_e,t)=>{if(pulsePopoverPinned&&pulsePopoverOrigin===t)hidePulsePopover();else showPulsePopover(t,{pin:true});},
  'pulse-period':(_e,t)=>{if(pulsePopoverPinned&&pulsePopoverOrigin===t)hidePulsePopover();else showPulsePeriodPopover(t,{pin:true});},
  'close-pulse':closePulseAndRestoreFocus,
  'sort-table':(_e,t)=>{const key=t.dataset.sort;state.sortDesc=state.sortKey===key?!state.sortDesc:true;state.sortKey=key;renderTable(analysis);},
  'copy-csv':copyCsv,
};
function handleDocumentClick(event) {
  const trigger=event.target.closest('[data-action]');
  if(trigger){
    // Real anchors retain browser-native Cmd/Ctrl-click, middle-click, context
    // menus, drag-to-tab, and copy-link behaviour. Intercept only plain same-tab clicks.
    if(trigger.tagName==='A'){
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||trigger.target==='_blank')return;
      event.preventDefault();
    }
    const fn=ACTIONS[trigger.dataset.action];if(fn)fn(event,trigger);
  }
  else if(pulsePopoverPinned && !$('pulse-popover').contains(event.target))hidePulsePopover();
}
function handleDocumentChange(event) {
  const t=event.target;
  if(t.dataset.mergeName!==undefined) {
    const group=mergeGroups[Number(t.dataset.mergeName)];
    if (group) {
      group.displayName=t.value.trim() || identityMeta.get(group.emails[0])?.name || 'New contributor';
      t.value=group.displayName;
    }
    return;
  }
  if(t.matches('[data-identity-email]') && identityPicker) {
    const email = t.dataset.identityEmail;
    if (t.checked) identityPicker.selected.add(email);
    else identityPicker.selected.delete(email);
    t.closest('.identity-option')?.classList.toggle('is-selected', t.checked);
    updateIdentityPickerSummary();
    return;
  }
  if(t.dataset.ghActor!==undefined){
    const login=t.dataset.ghActor.toLowerCase();
    const group=analysis?.allContributors.find(g=>g.emails.includes(t.value.toLowerCase()));
    if (t.value==='__auto__') delete state.impactActorMap[login];
    else if(t.value==='__none__')state.impactActorMap[login]='';
    else if(group)state.impactActorMap[login]=t.value.toLowerCase();
    renderDashboard();return;
  }
  if(t.dataset.personId!==undefined && t.type==='checkbox') {
    if(t.checked)state.selectedIds.add(t.dataset.personId);else state.selectedIds.delete(t.dataset.personId);
    renderDashboard();return;
  }
  const primaryFields={
    'primary-release-type':'releaseType','primary-release-year':'releaseYear','primary-cohort-by':'cohortBy',
    'primary-period-from':'periodFrom','primary-period-to':'periodTo',
    'primary-period-comparison':'periodComparison','primary-compare-from':'compareFrom','primary-compare-to':'compareTo',
    'primary-contributor-focus':'contributorFocus','primary-contributor-range':'contributorRange',
    'primary-period-person':'periodSelectedId','primary-codebase-range':'codebaseRange',
    'primary-compare-a':'contributorFocus','primary-compare-b':'compareB','primary-compare-c':'compareC',
    'primary-together-partner':'coReleasePartner','primary-together-sort':'coReleaseSort',
  };
  if(primaryFields[t.id]){
    const key=primaryFields[t.id];
    primary[key]=t.value||null;
    if(t.id==='primary-period-from'||t.id==='primary-period-to'){primary.periodPreset='custom';primary.periodBucket=null;primary.periodFocusPerson=null;primary.periodFocusArea=null;}
    if(t.id==='primary-period-person'){primary.periodBucket=null;primary.periodFocusPerson=null;primary.periodFocusArea=null;}
    if(t.id==='primary-release-type'||t.id==='primary-release-year')primary.releasePage=0;
    if(['primary-contributor-focus','primary-period-from','primary-period-to'].includes(t.id))routePushPending=true;
    if(t.id==='primary-contributor-focus'&&primary.compareB===primary.contributorFocus)primary.compareB=null;
    if(t.id==='primary-contributor-focus'&&primary.coReleasePartner===primary.contributorFocus)primary.coReleasePartner=null;
    renderPrimary();
    if(t.id==='primary-together-partner'||t.id==='primary-together-sort')$(t.id)?.focus({preventScroll:true});
    return;
  }
  switch(t.id){
    case 'story-focus':state.storyFocus=t.value;state.storyFindingId=null;state.storyMonth=null;renderStories();$('story-focus')?.focus({preventScroll:true});break;
    case 'story-topic':state.storyTopic=t.value;state.storyShowAll=false;state.storyFindingId=null;renderStories();$('story-topic')?.focus({preventScroll:true});break;
    case 'story-card-filter':state.storyCategory=t.value;state.storyShowAll=false;state.storyFindingId=null;renderStories();$('story-card-filter')?.focus({preventScroll:true});break;
    case 'story-person-a':state.storyPairA=t.value;if(state.storyPairA===state.storyPairB)state.storyPairB=null;renderStories();break;
    case 'story-person-b':state.storyPairB=t.value;if(state.storyPairA===state.storyPairB)state.storyPairA=null;renderStories();break;
    case 'story-journey-pan':{
      const person=storyPerson();const month=person?.months[Number(t.value)];
      if(month){state.storyMonth=month.month;renderStories();focusStoryMonth();}break;
    }
    case 'file-import-input':importSession(event);break;
    case 'period-select':updatePeriod(t.value);break;
    case 'date-from':case 'date-to':changeDate();break;
    case 'filter-merges':state.includeMerges=t.checked;renderDashboard();break;
    case 'filter-reverts':state.includeReverts=t.checked;renderDashboard();break;
    case 'metric-select':state.metric=t.value;state.sortKey='lens';state.sortDesc=true;renderDashboard();break;
    case 'pulse-gap-horizon':state.pulseGapHorizon=GAP_HORIZONS.includes(Number(t.value))?Number(t.value):DEFAULT_GAP_HORIZON;renderPulse(analysis);break;
    case 'pulse-busy-day':state.pulseBusyDay=BUSY_DAY_THRESHOLDS.includes(Number(t.value))?Number(t.value):DEFAULT_BUSY_DAY;renderPulse(analysis);break;
    case 'pulse-release-lines':state.pulseReleaseLines=RELEASE_LINE_THRESHOLDS.includes(Number(t.value))?Number(t.value):DEFAULT_RELEASE_LINES;renderPulse(analysis);break;
    case 'pulse-daily-churn':state.pulseDailyChurn=DAILY_CHURN_THRESHOLDS.includes(Number(t.value))?Number(t.value):DEFAULT_DAILY_CHURN;renderPulse(analysis);break;
    case 'pulse-momentum-workdays':state.pulseMomentumWorkdays=MOMENTUM_WINDOWS.includes(Number(t.value))?Number(t.value):DEFAULT_MOMENTUM_WINDOW;renderPulse(analysis);break;
    case 'pulse-level-workdays':state.pulseLevelWorkdays=LEVEL_WINDOWS.includes(Number(t.value))?Number(t.value):DEFAULT_LEVEL_WINDOW;renderPulse(analysis);break;
    case 'pulse-temporal-period':state.pulseTemporalPeriod=TEMPORAL_PERIODS.includes(Number(t.value))?Number(t.value):TEMPORAL_PERIOD_DEFAULT;renderPulse(analysis);break;
    case 'pulse-temporal-churn':state.pulseTemporalChurn=TEMPORAL_CHURN_CAPS.includes(Number(t.value))?Number(t.value):TEMPORAL_CHURN_DEFAULT;renderPulse(analysis);break;
    case 'pulse-meaningful-lines':state.pulseMeaningfulLines=MEANINGFUL_CHURN_THRESHOLDS.includes(Number(t.value))?Number(t.value):MEANINGFUL_CHURN_DEFAULT;renderPulse(analysis);break;
    case 'pulse-continuity-weeks':state.pulseContinuityWeeks=CONTINUITY_WINDOWS.includes(Number(t.value))?Number(t.value):DEFAULT_CONTINUITY_WINDOW;renderPulse(analysis);break;
    case 'deployment-env':primary.deploymentEnv=t.value;primary.deploymentFocus=null;primary.deploymentPage=0;renderPrimary();break;
    case 'deployment-year':primary.deploymentYear=t.value;primary.deploymentFocus=null;primary.deploymentPage=0;renderPrimary();break;
    case 'impact-metric-select':state.impactMetric=t.value;renderDashboard();break;
    case 'impact-profile-select':state.impactFocus=t.value;renderImpact(analysis);$('impact-profile-select')?.focus({preventScroll:true});break;
    case 'impact-matrix-year':state.impactMatrixYear=t.value;state.impactMatrixPage=0;refreshImpactMatrix({focus:{kind:'year'}});break;
    case 'impact-matrix-size':state.impactMatrixSize=[18,36,54].includes(Number(t.value))?Number(t.value):18;state.impactMatrixPage=0;refreshImpactMatrix({focus:{kind:'size'}});break;
    case 'impact-matrix-release-select':if(t.value)matrixJump(t.value);break;
    case 'impact-release-select':chooseImpactRelease(t.value,{focus:'select'});break;
    case 'impact-timeline-from':case 'impact-timeline-to':{
      let from=$('impact-timeline-from').value,to=$('impact-timeline-to').value;
      if(from>to){if(t.id==='impact-timeline-from')to=from;else from=to;}
      const next=impactTimelineCustomRange(impactModel,from,to);
      if(next){setTimelinePreference(next);selectImpactReleaseWithinWindow();}
      renderImpact(analysis);break;
    }
    case 'impact-timeline-pan':{
      setTimelinePreference(impactTimelinePan(impactModel,timelinePreference(),Number(t.value)));
      selectImpactReleaseWithinWindow();renderImpact(analysis);break;
    }
    case 'mode-select':state.mode=t.value;state.sortKey='lens';state.sortDesc=true;renderDashboard();break;
    case 'denominator-select':state.denominator=t.value;renderDashboard();break;
  }
}
function handleDocumentInput(event) {
  const t=event.target;
  if(t.dataset.mergeName!==undefined){const g=mergeGroups[Number(t.dataset.mergeName)];if(g){g.displayName=t.value; if(mergeUndo)forgetUndo();}}
  if(t.matches('[data-identity-search]') && identityPicker){identityPicker.query=t.value;refreshIdentityOptions();}
  if(t.id==='contributor-search'){state.search=t.value;renderPicker();}
  if(t.id==='primary-release-query'){primary.releaseQuery=t.value;primary.releasePage=0;renderPrimary();$('primary-release-query')?.focus({preventScroll:true});}
  if(t.id==='story-journey-pan'){
    const person=storyPerson(),index=Number(t.value);
    const scroll=$('story-journey-scroll');
    const cell=scroll?.querySelectorAll('.story-month')[index];
    if(cell && scroll)scroll.scrollLeft=Math.max(0,cell.offsetLeft-scroll.clientWidth/2+cell.clientWidth/2);
  }
}
function init() {
  document.addEventListener('click',handleDocumentClick);
  window.addEventListener('popstate',async()=>{
    const route=readRoute(new URL(window.location.href));
    if(route.dataset&&route.dataset!==localDatasetId){await restoreFromLocalLink();return;}
    if(!perspectiveIndex)return;
    const view=route.view;
    if(view==='evidence'){routeRestoring=true;routePushPending=false;switchExperience('evidence').finally(()=>{routeRestoring=false;routePushPending=false;});}
    else applyBrowserRoute();
  });
  document.addEventListener('change',handleDocumentChange);
  document.addEventListener('input',handleDocumentInput);
  $('rhythm-explorer').addEventListener('pointerover',event=>{
    if (rhythmPinned) return;
    const target=event.target.closest('[data-rhythm-interactive]');
    if (!target) return;
    const next={kind:target.dataset.rhythmKind,index:Number(target.dataset.rhythmIndex)};
    if (rhythmDatumKey(next)!==rhythmDatumKey(rhythmHover)) {rhythmHover=next;renderRhythmDetail();}
  });
  $('rhythm-explorer').addEventListener('pointerout',event=>{
    if (rhythmPinned || !event.target.closest('[data-rhythm-interactive]')) return;
    if (event.relatedTarget?.closest?.('[data-rhythm-interactive]')) return;
    rhythmHover=null;renderRhythmDetail();
  });
  $('rhythm-explorer').addEventListener('focusin',event=>{
    if (rhythmPinned) return;
    const target=event.target.closest('[data-rhythm-interactive]');
    if (target){rhythmHover={kind:target.dataset.rhythmKind,index:Number(target.dataset.rhythmIndex)};renderRhythmDetail();}
  });
  $('rhythm-explorer').addEventListener('keydown',event=>{
    const target=event.target.closest('[data-rhythm-kind="slot"]');
    if (!target) return;
    if (target.matches('svg *') && (event.key==='Enter' || event.key===' ')) {
      event.preventDefault();ACTIONS['rhythm-inspect'](event,target);return;
    }
    const shifts={ArrowLeft:-1,ArrowRight:1,ArrowUp:-24,ArrowDown:24};
    const delta=shifts[event.key];
    if (delta===undefined) return;
    const next=Math.max(0,Math.min(167,Number(target.dataset.rhythmIndex)+delta));
    const matching=$('rhythm-week-chart').querySelector(`[data-rhythm-index="${next}"]`);
    if(matching){event.preventDefault();matching.focus();}
  });
  $('impact-timeline').addEventListener('keydown',event=>{
    const dot=event.target.closest('[data-impact-hash]');
    if(dot && (event.key==='Enter'||event.key===' ')) {event.preventDefault();ACTIONS['impact-release'](event,dot);return;}
    if(dot && (event.key==='ArrowLeft'||event.key==='ArrowRight')) {
      event.preventDefault();const dots=[...$('impact-timeline').querySelectorAll('[data-impact-hash]')];
      const index=dots.indexOf(dot);dots[Math.max(0,Math.min(dots.length-1,index+(event.key==='ArrowRight'?1:-1)))].focus();
    }
  });
  $('season-explorer').addEventListener('pointerover',event=>{
    if(seasonPinned)return;
    const target=event.target.closest('[data-season-cell]');
    if(!target)return;
    const next={kind:target.dataset.seasonKind,year:Number(target.dataset.seasonYear),index:Number(target.dataset.seasonIndex)};
    if(seasonKey(next)!==seasonKey(seasonHover)){seasonHover=next;renderSeasonDetail();}
  });
  $('season-explorer').addEventListener('pointerout',event=>{
    if(seasonPinned||!event.target.closest('[data-season-cell]'))return;
    if(event.relatedTarget?.closest?.('[data-season-cell]'))return;
    seasonHover=null;renderSeasonDetail();
  });
  $('season-explorer').addEventListener('focusin',event=>{
    if(seasonPinned)return;
    const target=event.target.closest('[data-season-cell]');
    if(target){seasonHover={kind:target.dataset.seasonKind,year:Number(target.dataset.seasonYear),index:Number(target.dataset.seasonIndex)};renderSeasonDetail();}
  });
  $('season-explorer').addEventListener('keydown',event=>{
    const target=event.target.closest('[data-season-cell]');
    if(!target)return;
    if(target.matches('svg *')&&(event.key==='Enter'||event.key===' ')){
      event.preventDefault();ACTIONS['season-inspect'](event,target);return;
    }
    const shift={ArrowLeft:-1,ArrowRight:1,ArrowUp:target.dataset.seasonKind==='slot'?-24:-1,ArrowDown:target.dataset.seasonKind==='slot'?24:1}[event.key];
    if(shift===undefined)return;
    const max=target.dataset.seasonKind==='slot'?167:11;
    const next=Math.max(0,Math.min(max,Number(target.dataset.seasonIndex)+shift));
    const match=$('season-explorer').querySelector(`[data-season-kind="${target.dataset.seasonKind}"][data-season-year="${target.dataset.seasonYear}"][data-season-index="${next}"]`);
    if(match){event.preventDefault();match.focus();}
  });
  $('pulse').addEventListener('pointerover',onPulsePointerOver);
  $('pulse').addEventListener('pointerout',onPulsePointerOut);
  $('pulse').addEventListener('focusin',event=>{const cell=event.target.closest('[data-pulse-day],[data-pulse-period]');if(cell&&!pulsePopoverPinned&&!pulseSuppressFocus)(cell.hasAttribute('data-pulse-period')?showPulsePeriodPopover(cell):showPulsePopover(cell));});
  $('pulse').addEventListener('focusout',onPulseFocusOut);
  $('pulse').addEventListener('scroll',()=>hidePulsePopover(),{passive:true});
  $('pulse-popover').addEventListener('pointerleave',event=>{if(!pulsePopoverPinned&&!pulsePopoverOrigin?.contains(event.relatedTarget))hidePulsePopover();});
  document.addEventListener('keydown',event=>{
    if (event.key !== 'Escape') return;
    if (seasonPinned) {event.preventDefault();seasonPinned=null;seasonHover=null;renderSeasonDetail();}
    else if (rhythmPinned) {event.preventDefault();rhythmPinned=null;rhythmHover=null;renderRhythmDetail();}
    else if (identityPicker) {event.preventDefault();closeIdentityPicker();}
    else if (!$('pulse-popover').hidden) closePulseAndRestoreFocus();
  });
}
init();
restoreFromLocalLink();
