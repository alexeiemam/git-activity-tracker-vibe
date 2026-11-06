/** UI fragments for the independent QA environments and production evidence. */
import { DEPLOYMENT_ENVS } from './deployments.js?v=git-temporal-contribution-20261106-1';
import { comparisonWindow } from './perspectives.js?v=git-temporal-contribution-20261106-1';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const nf=new Intl.NumberFormat('en-GB');
const f=v=>Number.isFinite(v)?nf.format(v):'—';
const when=ms=>ms==null?'Unknown':new Date(ms).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const short=sha=>sha?sha.slice(0,9):'Unresolved';
import { targetUrl } from './route-state.js?v=git-temporal-contribution-20261106-1';
const href=(index,changes)=>esc(targetUrl(index.navigation?.path||'./index.html',index.navigation?.ui||{},index.navigation?.groups||index.groups,index.navigation?.datasetId,changes));
const LINK=(index,{id,text})=>`<a class="deployment-link" href="${href(index,{view:'deployments',event:id})}" data-action="deployment-open" data-deployment-id="${esc(id)}">${esc(text)} ↗</a>`;
const panel=(eyebrow,title,body)=>`<section class="primary-panel deployment-panel"><div class="primary-card-heading"><span class="primary-eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3></div>${body}</section>`;
const safe=index=>index?.deployments||{available:false,events:[],releaseLinks:[],people:[],envs:{},status:{}};
const envName=env=>env==='PROD'?'Production':`${env} · QA`;
const kindLabel=e=>({code:'Code change',baseline:'First observed snapshot',redeploy:'Same code redeployed',config:'Configuration','config-and-code':'Configuration + code','revision-rollback':'Earlier code revision','divergent-revision':'Divergent code revision',rollback:'Rollback',unsuccessful:'Not deployed',unknown:'Unknown code state','same-revision':'Same observed code'})[e.type]||e.type;
const linkedPerson=(index,id,text)=>{
  const group=index.groups.find(g=>g.id===id);
  return group?`<a href="${href(index,{view:'contributors',person:group.emails[0],tab:'delivery'})}" data-action="primary-open-person" data-person="${esc(id)}">${esc(text||group.displayName)} ↗</a>`:esc(text||'Unmatched actor');
};
const actorLabel=(index,event)=>event.actorEmail?
  (event.actorGroupId!=null?linkedPerson(index,event.actorGroupId,event.actorName):`<span title="Heroku actor not yet reconciled with a contributor">${esc(event.actorEmail)} · review identities</span>`):
  '<span>Actor not recorded</span>';
const eventTag=(index,event)=>{
  const introduced=event.introducedReleaseTags||[];
  const tag=introduced.at(-1)||event.releaseTags?.at(-1);
  const release=tag?index.releases.find(r=>r.tag===tag):null;
  return release?`<a class="deployment-link" href="${href(index,{view:'observatory',release:release.hash})}" data-action="primary-open-release" data-hash="${esc(release.hash)}" title="${introduced.length?'Tag introduced by this revision transition':'Tag present in this observed Git ancestry'}">${introduced.length?'Introduced':'Contains'} ${esc(tag)} ↗</a>`:'<small>No linked tag</small>';
};
const releaseEvent=(index,e)=>`<div class="deployment-event"><span class="deployment-env deployment-env-${esc(e.env.toLowerCase())}">${esc(e.env)}</span><span class="deployment-event-time">${esc(when(e.at))}</span><span class="deployment-event-kind">${esc(kindLabel(e))}<small>${esc(e.description)}</small></span><span class="deployment-event-actor">${actorLabel(index,e)}</span><span class="deployment-event-related">${eventTag(index,e)}</span>${LINK(index,{id:e.id,text:e.version!=null?`Heroku v${e.version}`:'Inspect'})}</div>`;
const stat=(number,label,note='')=>`<div class="deployment-stat"><strong>${esc(number)}</strong><span>${esc(label)}</span>${note?`<small>${esc(note)}</small>`:''}</div>`;
const summary=index=>{
  const model=safe(index);
  if(!model.available)return `<div class="deployment-quiet"><strong>No Heroku deployment history in this import</strong><p>The standard capture command can collect STAG, BETA and PROD histories. Existing Git-only sessions still work; reimport to see what reached actual environments.</p>${DEPLOYMENT_ENVS.map(env=>`<span class="deployment-status">${env}: ${esc(model.envs[env]?.status||model.status?.[env]||'not captured')}</span>`).join(' ')}</div>`;
  return null;
};
const codeEvents=(model,env)=>model.events.filter(e=>e.env===env&&(['code','config-and-code','revision-rollback','divergent-revision','rollback','baseline'].includes(e.type)));

function qaDivergence(model){
  const labels={'same':'Same recorded revision','ahead-of-prod':'QA revision contains PROD','behind-prod':'QA revision is an ancestor of PROD',
    'diverged':'Different Git ancestries','unknown-ancestry':'History insufficient to compare','unavailable':'No comparable SHA'};
  return `<div class="deployment-qa-context"><strong>Last recorded QA versus PROD revisions</strong><div>${['STAG','BETA'].map(env=>{
    const r=model.qaComparison?.[env]||{};
    return `<div class="deployment-qa-compare"><span>${env}</span><b>${esc(labels[r.relation]||'Not available')}</b><small>${esc(short(r.qaSha))} (${esc(r.qaDate||'unknown date')}) / PROD ${esc(short(r.prodSha))} (${esc(r.prodDate||'unknown date')})</small></div>`;
  }).join('')}</div><p class="deployment-note">This compares the last known SHAs in imported history. The observations can have different dates; it is not a live environment-status query.</p></div>`;
}

function historyLanes(index,from=null,to=null){
  const model=safe(index);if(!model.available)return '';
  const events=model.events.filter(e=>(!from||e.date>=from)&&(!to||e.date<=to));
  const releaseEvents=index.releases.filter(r=>r.date&&(!from||r.date>=from)&&(!to||r.date<=to));
  const allDates=[...events.map(e=>e.date),...releaseEvents.map(r=>r.date)].filter(Boolean);
  if(!allDates.length)return '<p class="deployment-note">No deployment or tag events in these dates.</p>';
  const spanDays=Math.max(1,(Date.parse(`${allDates.reduce((a,b)=>a>b?a:b)}T00:00:00Z`)-Date.parse(`${allDates.reduce((a,b)=>a<b?a:b)}T00:00:00Z`))/86400000);
  const buckets=Math.min(28,Math.max(7,Math.ceil(spanDays/30)));
  const first=Date.parse(`${allDates.reduce((a,b)=>a<b?a:b)}T00:00:00Z`);
  const slot=date=>Math.min(buckets-1,Math.max(0,Math.floor((Date.parse(`${date}T00:00:00Z`)-first)/86400000/Math.max(1,spanDays+1)*buckets)));
  const make=(items)=>{const counts=Array(buckets).fill(0);for(const item of items)counts[slot(item.date)]++;return counts;};
  const rows=[{name:'GitHub / tags',items:releaseEvents,cls:'release'},{name:'STAG · QA',items:events.filter(e=>e.env==='STAG'),cls:'stag'},
    {name:'BETA · QA',items:events.filter(e=>e.env==='BETA'),cls:'beta'},
    {name:'PROD · code',items:events.filter(e=>e.env==='PROD'&&['code','config-and-code','revision-rollback','divergent-revision','baseline','rollback'].includes(e.type)),cls:'prod'},
    {name:'PROD · config',items:events.filter(e=>e.env==='PROD'&&e.type==='config'),cls:'config'}];
  const max=Math.max(1,...rows.flatMap(r=>make(r.items)));
  return `<div class="deployment-lanes" role="img" aria-label="Time-aligned release and independent environment event counts. All lanes share the same time buckets.">${rows.map(row=>`<div class="deployment-lane"><span>${esc(row.name)}</span><div class="deployment-lane-bars">${make(row.items).map(v=>`<i class="deployment-lane-bar ${row.cls}" style="--height:${v?Math.max(12,v/max*100):0}%" title="${v} events in aligned time bucket"></i>`).join('')}</div><b>${f(row.items.length)}</b></div>`).join('')}</div><p class="deployment-note">Shared chronological buckets · ${esc(allDates.reduce((a,b)=>a<b?a:b))} to ${esc(allDates.reduce((a,b)=>a>b?a:b))}. Bar heights use one shared count scale; empty buckets are zero. QA lanes have no implied order.</p>`;
}

export function deploymentStatusGuide(){
  return `<details class="deployment-status-guide"><summary>What do these statuses mean? · First observed, code change, config, rollback, unknown</summary>
    <div class="deployment-status-items">
      <div><strong>First observed snapshot</strong><span>The earliest imported Heroku revision. It proves the code was present by that date, not when it first arrived.</span></div>
      <div><strong>Code change</strong><span>A different resolvable Git SHA. New contributors and commits are attributed only where both ancestries are complete.</span></div>
      <div><strong>Config change</strong><span>Heroku explicitly recorded setting, unsetting or updating config vars. It is a release event, not new Git code; variable keys and values are not displayed.</span></div>
      <div><strong>Same revision / redeploy</strong><span>A Heroku event without an observed change of Git SHA. It is not automatically a config update.</span></div>
      <div><strong>Rollback / divergent code</strong><span>The revision moved backwards in known Git ancestry, or between branches; that does not prove a bad deployment.</span></div>
      <div><strong>Unknown code state</strong><span>SHA missing, ambiguous or not imported. We preserve the event but do not guess which code or people it introduced.</span></div>
    </div></details>`;
}

export function deploymentOverviewPanel(index){
  const model=safe(index);
  const missing=summary(index);
  if(missing)return panel('ENVIRONMENT EVIDENCE','Published ≠ deployed',missing);
  const rows=DEPLOYMENT_ENVS.map(env=>{
    const item=model.envs[env]||{};
    return `<div class="deployment-env-card ${env==='PROD'?'production':''}"><span class="deployment-env-heading">${esc(envName(env))}</span><strong>${f(item.count)} <small>Heroku events</small></strong><span>${f(item.codeEvents)} code transitions · ${f(item.configEvents)} config events</span><small>${item.lastDate?`Observed through ${esc(item.lastDate)}`:'No dated history'}</small>${item.possibleTruncation?'<small>Earlier history may be missing (3,000-event window or partial capture).</small>':''}</div>`;
  });
  const prod=model.events.filter(e=>e.env==='PROD');
  const code=prod.filter(e=>['code','config-and-code','divergent-revision','revision-rollback'].includes(e.type));
  const config=prod.filter(e=>e.type==='config'||e.type==='config-and-code');
  const links=model.releaseLinks.filter(r=>r.byEnv.PROD).length;
  const newCommits=model.people.reduce((n,p)=>n+p.commits,0);
  const unresolved=prod.filter(e=>e.type==='unknown'||e.type==='unsuccessful').length;
  const matchedReleases=model.releaseLinks.filter(r=>r.byEnv.PROD).slice().sort((a,b)=>b.byEnv.PROD.at-a.byEnv.PROD.at).slice(0,6);
  return panel('PUBLICATION & DEPLOYMENT EVIDENCE','Published versus production',`
    <div class="deployment-overview-hero"><div><h4>A GitHub release is not necessarily a production deployment.</h4><p>Tags identify published code snapshots. Heroku records what happened in each environment, including code changes and configuration-only events. We connect them by Git SHA ancestry—not by date or a matching version number.</p></div><aside><strong>How to explore</strong><div>Open a linked tag to see its release anatomy; open Heroku vN to inspect the deployment event, its actor and any attributable contributors. STAG and BETA are independent QA environments.</div></aside></div>
    <div class="deployment-env-grid">${rows.join('')}</div>
    <div class="deployment-factline">${stat(f(links),'Tagged revisions observed in PROD','Includes snapshots already present at first observation')}${stat(f(newCommits),'First-observed new PROD commits','Credited only after verifiable revision transitions')}${stat(f(config.length),'PROD configuration events','Explicit Heroku descriptions; no new-code credit')}${stat(f(unresolved),'Unresolved PROD events','No invented ancestry or author attribution')}</div>
    <h4 class="deployment-visual-heading">How publication and deployments overlap in time</h4>
    <p class="deployment-note">Each column represents the same period across lanes. Bars are event counts, not a mandatory promotion sequence. Use the linked events below to inspect specific versions and people.</p>
    ${historyLanes(index)}
    ${deploymentStatusGuide()}
    <div class="deployment-insight-columns"><div class="deployment-insight"><h4>Recent production code events</h4><p>Resolved Git revisions; earliest snapshots aren't claimed as first deployments.</p><div class="deployment-recent">${(code.length?code:prod.filter(e=>e.type==='baseline')).slice(-5).reverse().map(e=>releaseEvent(index,e)).join('')||'<p>No recorded code transitions in PROD.</p>'}</div></div>
      <div class="deployment-insight"><h4>Recent configuration events</h4><p>These Heroku releases matter even when the deployed code SHA does not change.</p><div class="deployment-recent">${config.slice(-5).reverse().map(e=>releaseEvent(index,e)).join('')||'<p>No explicitly described config changes in captured PROD history.</p>'}</div></div></div>
    <div class="deployment-insight"><h4>From tagged release to observed PROD revision</h4><p>Each relationship is supported by Git ancestry. “Present by” doesn't establish the exact initial deployment date.</p>
      <div class="deployment-release-links">${matchedReleases.map(entry=>{const release=index.releases.find(r=>r.hash===entry.releaseHash);const prodEvent=model.events.find(e=>e.id===entry.byEnv.PROD.eventId);return `<div class="deployment-release-match"><div><strong><a class="deployment-link" href="${href(index,{view:'observatory',release:entry.releaseHash})}" data-action="primary-open-release" data-hash="${esc(entry.releaseHash)}">${esc(entry.tag)} ↗</a></strong><small>${esc(release?.date||'Unknown publication date')} · ${esc(release?.driver?.groupName||release?.driver?.name||'Publisher not matched')}</small></div><span aria-hidden="true">→</span><div><strong>${prodEvent?LINK(index,{id:prodEvent.id,text:`PROD Heroku v${prodEvent.version??'?'}`}):'PROD event not available'}</strong><small>${esc(when(entry.byEnv.PROD.at))} · ${esc(entry.byEnv.PROD.certainty==='introduced'?'First introduced in a verifiable transition':'Present by an observed snapshot')}</small></div></div>`;}).join('')||'<p class="deployment-note">No tagged revision could be linked to the imported PROD Git history. Explore the unresolved events and SHA coverage below.</p>'}</div></div>
    <details class="deployment-status-guide"><summary>Compare last-known QA and PROD revisions</summary>${qaDivergence(model)}</details>
    <div class="primary-card-footer"><a class="button soft" href="${href(index,{view:'deployments'})}" data-action="primary-nav" data-to="deployments">Browse all deployment events, actors and releases →</a></div>`);
}

export function deploymentReleasePanel(index,release){
  const model=safe(index),record=model.releaseLinks.find(r=>r.releaseHash===release.hash);
  if(!model.available)return '';
  return `<div class="deployment-release-journey"><div class="deployment-section-heading"><strong>Where is this tagged revision observed?</strong><small>Git ancestry links a tag to deployed SHAs; presence is not proof of a particular deployment process.</small></div>
    <div class="deployment-release-envs">${DEPLOYMENT_ENVS.map(env=>{
      const observation=record?.byEnv?.[env];
      return `<div class="deployment-release-env ${env==='PROD'?'is-prod':''}"><span>${esc(envName(env))}</span>${observation?`<strong>${esc(when(observation.at))}</strong><small>${observation.certainty==='introduced'?'First introduced in observed transition':'Present by this observed snapshot'}</small>${env==='PROD'&&observation.certainty==='introduced'&&observation.hoursSincePublication!=null?`<small>${esc(observation.hoursSincePublication<0?'Deployment predates publication':`${f(observation.hoursSincePublication)} hours after publication`)}</small>`:''}${LINK(index,{id:observation.eventId,text:'Inspect event'})}`:'<strong>Not observed</strong><small>Within imported environment history</small>'}</div>`;
    }).join('')}</div><p class="deployment-note">An earlier first snapshot or incomplete Heroku history gives only an “observed by” date, not an exact first deployment date. QA exposure is optional, not a gate to PROD.</p></div>`;
}

export function deploymentPeriodPanel(index,ui){
  const model=safe(index);if(!model.available)return '';
  const from=ui.periodFrom,to=ui.periodTo;
  if(!from||!to)return '';
  const matches=model.events.filter(e=>e.date>=from&&e.date<=to);
  const comp=comparisonWindow({from,to},ui.periodComparison,{from:ui.compareFrom,to:ui.compareTo});
  const comparison=comp&&comp.from>=index.bounds.min&&comp.to<=index.bounds.max
    ?model.events.filter(e=>e.date>=comp.from&&e.date<=comp.to):null;
  const showComparison=(env)=>{
    if(comparison===null)return '';
    const current=matches.filter(e=>e.env===env).length;
    const previous=comparison.filter(e=>e.env===env).length;
    const delta=current-previous;
    return `Compared with ${esc(comp.from)} to ${esc(comp.to)}: ${f(previous)} (${delta>0?'+':''}${f(delta)})`;
  };
  const prod=matches.filter(e=>e.env==='PROD'),code=prod.filter(e=>['code','config-and-code','revision-rollback','divergent-revision','rollback'].includes(e.type));
  const people=new Map();
  for(const e of code)for(const person of e.people)people.set(person.id,(people.get(person.id)||0)+person.commits);
  const top=[...people].sort((a,b)=>b[1]-a[1]).slice(0,6);
  return panel('DEPLOYMENT EVENTS / SELECTED INTERVAL','What actually changed in the environments?',`<p class="deployment-intro">${esc(from)} to ${esc(to)}. These events use Heroku timestamps, not Git author dates or GitHub publication dates. A code transition may introduce commits authored outside this window.</p>
    <div class="deployment-factline">${stat(f(matches.filter(e=>e.env==='STAG').length),'STAG events',showComparison('STAG'))}${stat(f(matches.filter(e=>e.env==='BETA').length),'BETA events',showComparison('BETA'))}${stat(f(prod.length),'PROD events',showComparison('PROD'))}${stat(f(prod.filter(e=>['config','config-and-code'].includes(e.type)).length),'PROD config events')}</div>
    ${comp&&comparison===null?'<p class="deployment-note">The comparison window lies partly outside the imported history; no misleading zero-baseline change is shown.</p>':''}
    ${historyLanes(index,from,to)}<div class="primary-two-col"><div class="deployment-inset"><strong>Production changes</strong>${prod.slice(-12).reverse().map(e=>releaseEvent(index,e)).join('')||'<p>Nothing recorded in PROD for this interval.</p>'}</div><div class="deployment-inset"><strong>Who authored newly introduced production commits?</strong><p class="deployment-note">Only verifiable ancestry differences from consecutive observed code revisions.</p>${top.map(([id,n])=>`<div class="deployment-person"><a href="${href(index,{view:'contributors',person:index.groups.find(g=>g.id===id)?.emails?.[0],tab:'delivery'})}" data-action="primary-open-person" data-person="${esc(id)}">${esc(index.groups.find(g=>g.id===id)?.displayName||'Unknown')}</a><b>${f(n)} commits</b></div>`).join('')||'<p>No attributable new code transitions in this window.</p>'}</div></div>
    <div class="primary-card-footer"><a class="button soft" href="${href(index,{view:'deployments'})}" data-action="primary-nav" data-to="deployments">Examine environment history →</a></div>`);
}

export function deploymentContributorPanel(index,personId,ui){
  const model=safe(index);if(!model.available)return '';
  const period=ui.contributorRange==='period'?{from:ui.periodFrom,to:ui.periodTo}:ui.contributorRange==='year'?{from:new Date(Date.parse(index.bounds.max+'T00:00:00Z')-364*86400000).toISOString().slice(0,10),to:index.bounds.max}:null;
  const matching=model.events.filter(e=>e.env==='PROD'&&['code','config-and-code','divergent-revision'].includes(e.type)&&(!period||(e.date>=period.from&&e.date<=period.to))&&e.people.some(p=>p.id===personId));
  const person=model.people.find(p=>p.id===personId);
  const observed=matching.reduce((total,e)=>total+(e.people.find(p=>p.id===personId)?.commits||0),0);
  const firstObserved=person?person.events.reduce((n,[id,count])=>{const event=model.events.find(e=>e.id===id);return n+(!period||(event?.date>=period.from&&event?.date<=period.to)?count:0);},0):0;
  return panel('INDIVIDUAL PRODUCTION EVIDENCE','Where did their changes reach production?',`<div class="deployment-factline">${stat(f(observed),'Commits in observed PROD transitions','Can include repeat code after rollback')}${stat(f(matching.length),'PROD code transitions involving this person')}${stat(f(firstObserved),'First-observed PROD commits','Deduplicated across imported history')}</div>
    <p class="deployment-note">These are authored commits introduced between resolvable production revisions; attribution uses the merged contributor identity. Missing earlier history, squashes and unknown deployment SHAs can reduce coverage. Repeated deployment is not a new contribution.</p>
    <div class="deployment-recent">${matching.slice(-8).reverse().map(e=>releaseEvent(index,e)).join('')||'<p>No attributable new production revision in the selected window. This does not establish that the person had no work deployed.</p>'}</div>
    <div class="primary-card-footer"><a class="button outline" href="${href(index,{view:'deployments'})}" data-action="primary-nav" data-to="deployments">Open deployment evidence →</a></div>`);
}

export function deploymentExplorer(index,ui){
  const model=safe(index);
  const missing=summary(index);
  if(missing)return `<div class="primary-heading"><span class="primary-eyebrow">ENVIRONMENT HISTORY</span><h2>What reached each environment?</h2></div>${panel('SOURCE COVERAGE','No deployment history yet',missing)}`;
  const checks=index.historyEnrichment||[];
  const historyCoverage=checks.length?panel('TARGETED HISTORY COVERAGE','Additional deployment ancestry',
    `<p class="deployment-note">Inspected ${checks.length} deployment SHA references outside the normal HEAD/tag log: ${checks.filter(x=>x.status==='complete').length} locally resolved with bounded complete side-history, ${checks.filter(x=>x.status==='bounded').length} hit the 175-commit safety limit, and ${checks.filter(x=>x.status==='unavailable').length} were unavailable. Limits and incomplete Git ancestry prevent exact attribution; re-capture with optional bounded SHA fetching if needed.</p>`):'';
  const env=['all',...DEPLOYMENT_ENVS].includes(ui.deploymentEnv)?ui.deploymentEnv:'all';
  const years=[...new Set(model.events.map(e=>e.date?.slice(0,4)).filter(Boolean))].sort().reverse();
  const selectedYear=ui.deploymentYear||'all';
  const events=model.events.filter(e=>(env==='all'||e.env===env)&&(selectedYear==='all'||e.date.startsWith(selectedYear))).slice().reverse();
  const pages=Math.max(1,Math.ceil(events.length/25));
  const selected=model.events.find(e=>e.id===ui.deploymentFocus)||null;
  const selectedPos=events.findIndex(e=>e.id===ui.deploymentFocus);
  const page=selectedPos>=0?Math.floor(selectedPos/25):Math.min(pages-1,Math.max(0,Number(ui.deploymentPage)||0));
  const visible=events.slice(page*25,page*25+25);
  const detail=selected||visible[0];
  return `<div class="primary-heading"><span class="primary-eyebrow">ENVIRONMENT HISTORY / ACTUAL HEROKU EVENTS</span><h2>What was deployed?</h2></div>
    <p class="primary-lede">STAG and BETA are independent QA environments. Production is a separate destination. Each row is an observed Heroku release, whether a code change, config update, rollback or unresolved event.</p>
    ${panel('DEPLOYMENT JOURNEY','Published versus deployed',`${historyLanes(index)}${qaDivergence(model)}<div class="deployment-env-grid">${DEPLOYMENT_ENVS.map(k=>{const v=model.envs[k];return `<div class="deployment-env-card ${k==='PROD'?'production':''}"><span class="deployment-env-heading">${esc(envName(k))}</span><strong>${f(v.count)} events</strong><span>${f(v.codeEvents)} code transitions · ${f(v.configEvents)} config events</span><small>History ${v.firstDate||'unknown'} to ${v.lastDate||'unknown'}</small>${v.possibleTruncation?'<small>Earlier history may be truncated</small>':''}</div>`;}).join('')}</div>`)}
    ${deploymentStatusGuide()}
    ${historyCoverage}
    ${panel('EVENT BROWSER','Inspect actual deployments',`<div class="deployment-controls"><label>Environment <select id="deployment-env" class="primary-select"><option value="all" ${env==='all'?'selected':''}>All environments</option>${DEPLOYMENT_ENVS.map(k=>`<option value="${k}" ${env===k?'selected':''}>${esc(envName(k))}</option>`).join('')}</select></label><label>Year <select id="deployment-year" class="primary-select"><option value="all" ${selectedYear==='all'?'selected':''}>Every year</option>${years.map(y=>`<option value="${y}" ${selectedYear===y?'selected':''}>${y}</option>`).join('')}</select></label></div>
      <div class="deployment-events">${visible.map(e=>`<a href="${href(index,{view:'deployments',event:e.id})}" class="deployment-event-choice ${e.id===detail?.id?'chosen':''}" data-action="deployment-select" data-deployment-id="${esc(e.id)}" aria-pressed="${e.id===detail?.id}"><span class="deployment-env deployment-env-${e.env.toLowerCase()}">${e.env}</span><span>${esc(when(e.at))}</span><strong>${esc(kindLabel(e))}</strong><code>${esc(short(e.codeSha))}</code><small>${e.version==null?'Version unknown':`v${e.version}`}</small></a>`).join('')||'<p>No events match these filters.</p>'}</div><div class="primary-row between"><small>${f(events.length)} events · page ${page+1} of ${pages}</small><div class="primary-pager"><button data-action="deployment-page" data-page="${Math.max(0,page-1)}" ${page===0?'disabled':''}>← Newer</button><button data-action="deployment-page" data-page="${page+1}" ${page===pages-1?'disabled':''}>Older →</button></div></div>`)}
    ${detail?panel('DEPLOYMENT ANATOMY',`${detail.env} ${detail.version==null?'event':`v${detail.version}`} · ${kindLabel(detail)}`,`<div class="deployment-detail" id="deployment-inspector" tabindex="-1"><div class="deployment-factline">${stat(when(detail.at),'Observed timestamp')}${stat(short(detail.codeSha),'Resolved commit SHA')}${stat(detail.allNewCommits==null?'—':f(detail.allNewCommits),'New commits versus preceding known SHA')}${stat(detail.eligibleNewCommits==null?'—':f(detail.eligibleNewCommits),'Within selected merge/revert policy')}</div>
      <div class="deployment-meta-row"><span>Heroku actor: ${actorLabel(index,detail)}</span><span>Related tagged snapshot: ${eventTag(index,detail)}</span></div>
      <p class="deployment-note">${esc(detail.description)} · Heroku status: ${esc(detail.outcome||'unreported')} · ${esc(detail.shaSource)} SHA provenance. ${detail.deltaReliable?'The introduced-commit difference uses complete, resolved ancestry from consecutive observed revisions.':'An exact introduced-commit difference is unavailable (first snapshot, unknown predecessor or incomplete imported ancestry).'}</p>
      ${detail.hashStatus?`<p class="primary-warning">SHA could not be matched: ${esc(detail.hashStatus)}. No contribution credit assigned.</p>`:''}
      <div class="primary-two-col"><div class="deployment-inset"><strong>Contributors in newly introduced code</strong>${detail.people.map(p=>`<div class="deployment-person"><a href="${href(index,{view:'contributors',person:index.groups.find(g=>g.id===p.id)?.emails?.[0],tab:'delivery'})}" data-action="primary-open-person" data-person="${esc(p.id)}">${esc(p.name)}</a><b>${f(p.commits)} commits</b></div>`).join('')||'<p>Insufficient data for an attributable delta.</p>'}</div><div class="deployment-inset"><strong>Codebase areas and released snapshots</strong>${detail.areas.map(([area,n])=>`<div class="deployment-person"><a href="${href(index,{view:'codebase',area})}" data-action="primary-open-area" data-area="${esc(area)}">${esc(area)}</a><b>${f(n)} touches</b></div>`).join('')||'<p>No new scoped file changes.</p>'}<div class="deployment-tag-list">${model.releaseLinks.filter(r=>detail.releaseTags.includes(r.tag)).slice(-12).map(r=>`<a class="deployment-link" href="${href(index,{view:'observatory',release:r.releaseHash})}" data-action="primary-open-release" data-hash="${esc(r.releaseHash)}">${esc(r.tag)} ↗</a>`).join('')}</div></div></div>
      <p class="deployment-note">SHA matches show code-revision ancestry, not proof of testing, approval, application health or the person performing a deployment. No configuration variable values are imported; config release descriptions are redacted.</p></div>`):''}`;
}

export function deploymentBriefing(index,from,to){
  const model=safe(index);
  if(!model.available)return 'Heroku: no deployment history in the imported evidence.';
  const records=model.events.filter(e=>e.date>=from&&e.date<=to);
  return `Heroku (${from} to ${to}): ${records.filter(e=>e.env==='STAG').length} STAG events, ${records.filter(e=>e.env==='BETA').length} BETA events, ${records.filter(e=>e.env==='PROD').length} PROD events, including ${records.filter(e=>e.env==='PROD'&&['config','config-and-code'].includes(e.type)).length} explicitly described configuration changes. Environments are independent; unresolved events and incomplete history are not inferred as deployments of specific commits.`;
}
