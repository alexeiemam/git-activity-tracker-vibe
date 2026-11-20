/** Presentational HTML helpers for the tag-first impact explorer. */
import { IMPACT_METRICS } from './impact.js?v=codetree-20261120-1';
import { impactTimelineWindow, impactTimelineExtent, impactTimelineDates, impactReleasePosition, workInFlight } from './impact-window.js?v=codetree-20261120-1';
import { makeIntensityScale, intensityStyle, intensityLegend } from './value-colour.js?v=codetree-20261120-1';

const e = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const n = new Intl.NumberFormat('en-GB', {maximumFractionDigits:1});
const p = x => x==null?'—':`${Math.abs(x) > 0 && Math.abs(x) < .1 ? Number(x.toPrecision(2)) : n.format(x)}%`;
const amount = x => x==null?'—':n.format(x);
const clockText = r => Number.isFinite(r?.clock) ? ` ${String(Math.floor(r.clock/3600000)).padStart(2,'0')}:${String(Math.floor(r.clock/60000)%60).padStart(2,'0')}` : '';
/**
 * Releases sit at their time of day; where dots would still overlap, a later
 * one moves right just far enough to clear the earlier ones, never up or down
 * (height is the measure) and never more than a few dot widths. Its stem still
 * starts at its true time, so a moved dot leans back to where it belongs.
 * Only when zoomed in far enough that a day has room (MIN_DODGE_DAY pixels):
 * across years nothing can be separated, and leaning stems would only hatch.
 */
const DOT_CLEARANCE=13,MAX_DODGE=3*DOT_CLEARANCE,MIN_DODGE_DAY=8;
export function dodgeReleases(records,xOf,yOf,right,dodge=true) {
  const placed=[],layout=new Map();
  const ordered=[...records].sort((a,b)=>xOf(a)-xOf(b));
  for(const r of ordered){
    const at=xOf(r),cy=yOf(r);
    let cx=at;
    if(dodge)for(const p of placed){
      if(p.cx<at-DOT_CLEARANCE)continue;
      const dy=Math.abs(p.cy-cy);
      if(dy>=DOT_CLEARANCE)continue;
      cx=Math.max(cx,p.cx+Math.sqrt(DOT_CLEARANCE**2-dy**2));
    }
    cx=Math.min(cx,at+MAX_DODGE,Math.max(at,right));
    const item={at,cx:Math.round(cx*10)/10,cy};
    placed.push(item);layout.set(r.hash,item);
  }
  return layout;
}
const shortDate = x => x ? new Date(`${x}T12:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) : 'Undated';
const typeLabel = s => ({baseline:'First tag on lineage',major:'Major',minor:'Minor',patch:'Patch',prerelease:'Pre-release',divergent:'Version decreased',unclassified:'Unclassified', 'same-version':'Same version'})[s] || 'Unclassified';
const color = s => ({major:'#b65e49',minor:'#4d70a4',patch:'#2b7957',prerelease:'#a47833',baseline:'#707e70'})[s] || '#84708f';
const humanMetric = (value,metric) => metric==='share'?p(value):amount(value);
const precise = x => x < 1 && x > 0 ? Number(x.toPrecision(3)).toString() : n.format(x);
const releaseClock = r => r.timeSource==='github-published'?'GitHub publication · verified timestamp':r.timeSource==='tagger'?'Annotated tag · tagger date':r.timeSource==='tagged-commit'?'Lightweight tag · commit date (estimate)':'Tagged commit date (estimate)';
const driverText = r => r.driver?.source==='github-publisher' ? `GitHub publisher @${r.driver.login}${r.driver.groupName?` · ${r.driver.groupName}`:' · not matched to a Git author'}` : r.driver?.source==='annotated-tagger' ? `Annotated tagger ${r.driver.name}${r.driver.groupName?` · ${r.driver.groupName}`:''}` : 'Release lead unknown';

export function impactSelectMessage(model) {
  if(!model.available) return `<div class="impact-empty"><strong>No resolvable release tags in this import</strong><p>Paste a fresh capture using the updated Git command to include annotated and lightweight tags, parent hashes and commit times. Legacy logs and partial Git history still work for activity, but cannot prove release membership. Existing charts remain available.</p></div>`;
  if(!model.releases.length) return `<div class="impact-empty"><strong>No release tags within this date range</strong><p>Release events use GitHub publication dates when available, otherwise tag or tagged-commit dates. Widen the global date range to see earlier releases; author dates still control which contributing commits count.</p></div>`;
  return '';
}
export function impactSummary(model) {
  if (!model.releases.length) return '';
  const releases=model.releases;
  const selectedCommits=model.overall.commits;
  const versionTouches=model.overall.versionTouches;
  const areas=model.overall.areas;
  const majors=releases.filter(r=>r.transition==='major').length;
  return `<div class="impact-stats">
    <div><span>TAGGED RELEASES</span><strong>${amount(releases.length)}</strong><small>${majors} major transitions · ${model.allReleaseCount} distinct tagged snapshots in import</small></div>
    <div><span>SCOPED CONTRIBUTIONS</span><strong>${amount(selectedCommits)}</strong><small>Authored commits included in these releases</small></div>
    <div><span>AREAS REACHED</span><strong>${amount(areas.size)}</strong><small>Across selected contributor releases</small></div>
    <div><span>GH-PUBLISHED</span><strong>${amount(model.githubLinkedCount)}</strong><small>${amount(releases.length-model.githubLinkedCount)} tag-only · ${amount(versionTouches)} VERSION touches</small></div>
  </div>`;
}

/** Import provenance and explicit GitHub account -> Git author identity matching. */
export function impactGithubStatus(model) {
  const status=model.githubStatus;
  const hasMeta=model.githubCount>0;
  const matched=model.ghActors.filter(actor=>actor.groupId).length;
  const count=model.ghActors.length;
  const subtitle=status==='ok' ? `${amount(model.githubPublishedCount)} published GitHub Release records · ${amount(model.githubLinkedCount)} matched tagged snapshots in this date scope${model.githubUnresolvedCount?` · ${amount(model.githubUnresolvedCount)} with no matching imported tag`:''}`
    : status==='missing-cli' ? 'GitHub CLI was not available. Git tags and author history are still usable.'
    : status==='unsupported-origin' ? 'Origin is not a recognised github.com remote. Git-only release evidence remains available.'
    : status==='unavailable' ? 'The GitHub API was unavailable during capture. Git-only release evidence remains available.'
    : 'This import contains Git tags but no GitHub Release enrichment. Re-run the updated Copy command to add publisher and release-note metadata.';
  const automatic=model.ghActors.filter(actor=>actor.groupId && !['manual','excluded'].includes(actor.matchSource)).length;
  const manual=model.ghActors.filter(actor=>actor.groupId && actor.matchSource==='manual').length;
  const description={
    'github-noreply':'Exact GitHub noreply address',
    'email-local':'Exact email username',
    'author-name':'Exact contributor/author name',
    'manual':'Manually confirmed',
    'ambiguous':'Conflicting contributor identities · review',
    'unmatched':'No matching author identity',
    'excluded':'Explicitly unassigned',
  };
  return `<div class="impact-gh-banner"><div class="impact-gh-banner-top"><div><span class="impact-gh-mark">${hasMeta?'GITHUB · ENRICHED':'GIT · TAG-ONLY'}</span><p>${e(subtitle)}</p></div>${hasMeta?`<span class="impact-gh-matched">${matched} / ${count} publishers matched · ${automatic} automatic · ${manual} confirmed</span>`:''}</div>
    ${model.captureWarningsCount?`<p class="impact-gh-warning">${amount(model.captureWarningsCount)} GitHub metadata records could not be decoded. The remaining evidence is still available.</p>`:''}
    ${count?`<details class="impact-identity-mapping"><summary>Publisher identity matches <span>${count-matched} require review · affects lead attribution only</span></summary>
      <p class="impact-muted">Release-lead credit is inferred only from exact, unambiguous Git author identities already grouped under a contributor. GitHub noreply addresses are strongest; exact email usernames or author aliases can also match. Manual choices override automatic matches. Similar names are never guessed.</p>
      <div class="impact-actor-grid">${model.ghActors.map(actor=>`<label><span class="impact-gh-login">@${e(actor.login)} <small>${amount(actor.releases)} releases · ${e(description[actor.matchSource] || 'Unmatched')}${actor.groupName?` · ${e(actor.groupName)}`:''}</small></span><select data-gh-actor="${e(actor.login)}" aria-label="Match GitHub publisher ${e(actor.login)} to a contributor"><option value="__auto__" ${actor.matchSource!=='manual'&&actor.matchSource!=='excluded'?'selected':''}>Automatic matching${actor.groupName?` · ${e(actor.groupName)}`:''}</option><option value="__none__" ${actor.matchSource==='excluded'?'selected':''}>Do not attribute</option>${model.groups.map(g=>`<option value="${e(g.emails[0])}" ${g.id===actor.groupId&&actor.matchSource==='manual'?'selected':''}>${e(g.name)} · ${e(g.emails.length===1?g.emails[0]:`${g.emails.length} author identities`)}</option>`).join('')}</select></label>`).join('')}</div>
    </details>`:''}</div>`;
}

export function impactIndividualProfiles(model, focus='selection') {
  const profiles=model.profiles;
  if(!profiles.length) return '<div class="impact-empty-mini">Select a contributor to compare release involvement.</div>';
  const chosen=profiles.find(person=>person.id===focus);
  const picker=`<div class="impact-profile-bar"><div><span class="eyebrow">CONTRIBUTOR LENS</span><h6>Leading releases and shipping changes</h6></div><label for="impact-profile-select">VIEW <select id="impact-profile-select"><option value="selection" ${!chosen?'selected':''}>All selected contributors</option>${profiles.map(p=>`<option value="${e(p.id)}" ${chosen?.id===p.id?'selected':''}>${e(p.name)}</option>`).join('')}</select></label></div>`;
  if(!chosen) return `${picker}<p class="impact-muted">Role counts use distinct tagged releases. Shipped commits are deduplicated across release branches; commit share always uses the chosen reference group. Lead = mapped GitHub publisher or an annotated-tag email fallback.</p>
   <div class="impact-person-summary-table"><table><thead><tr><th>CONTRIBUTOR</th><th>LEADERSHIP</th><th>PARTICIPATION</th><th>BOTH ROLES</th><th>SHIPPED COMMITS</th><th>MEDIAN SHARE</th><th>PATHS REACHED</th></tr></thead><tbody>${profiles.map(person=>`<tr><th><button type="button" data-action="impact-profile-focus" data-impact-focus="${e(person.id)}" class="impact-text-link">${e(person.name)}</button></th><td>${amount(person.driven)}</td><td>${amount(person.contributed)}</td><td>${amount(person.both)}</td><td>${amount(person.shippedCommits)}</td><td>${p(person.medianShare)}</td><td>${amount(person.footprint.pathsCount)}</td></tr>`).join('')}</tbody></table></div>`;
  const involvement=model.releases.filter(r=>r.driver.groupId===chosen.id || r.cells.some(c=>c.id===chosen.id && c.footprint.commits>0));
  const yearlyMax=Math.max(1,...chosen.years.map(y=>y.drivenOnly+y.contributedOnly+y.both));
  const yearly=chosen.years.map(y=>{const total=y.drivenOnly+y.contributedOnly+y.both;return `<div class="impact-involvement-year"><strong>${e(y.year)}</strong><div class="impact-involvement-track" role="img" aria-label="${e(y.year)}: ${y.drivenOnly} led only, ${y.both} both roles, ${y.contributedOnly} participated only">${y.drivenOnly?`<i class="as-driver" style="width:${100*y.drivenOnly/yearlyMax}%"></i>`:''}${y.both?`<i class="as-both" style="width:${100*y.both/yearlyMax}%"></i>`:''}${y.contributedOnly?`<i class="as-contributor" style="width:${100*y.contributedOnly/yearlyMax}%"></i>`:''}</div><span>${total} distinct releases</span></div>`;}).join('');
  const releaseMix=Object.entries(chosen.releaseMix).filter(([,n])=>n).map(([kind,count])=>`${amount(count)} ${typeLabel(kind).toLowerCase()}`).join(' · ') || 'No releases led in scope';
  return `${picker}<div class="impact-person-hero"><div class="impact-person-name"><span class="eyebrow">RELEASE INVOLVEMENT · ${e(chosen.name)}</span><h5>${e(chosen.name)}</h5><p>Distinct published/tagged snapshots in the global date scope. Roles are shown independently; no combined productivity score.</p></div>
    <div class="impact-person-facts"><div><span>LEADERSHIP</span><strong>${amount(chosen.driven)}</strong></div><div><span>PARTICIPATION</span><strong>${amount(chosen.contributed)}</strong></div><div><span>BOTH</span><strong>${amount(chosen.both)}</strong></div><div><span>SHIPPED COMMITS</span><strong>${amount(chosen.shippedCommits)}</strong></div><div><span>MEDIAN COMMIT SHARE</span><strong>${p(chosen.medianShare)}</strong></div><div><span>DISTINCT PATHS</span><strong>${amount(chosen.footprint.pathsCount)}</strong></div></div></div>
    <div class="impact-person-secondary"><div><span>MEDIAN CONTRIBUTORS IN RELEASES LED</span><strong>${amount(chosen.medianCoordination)}</strong><small>Within reference cohort; measures breadth, not effort</small></div><div><span>AUTHOR → RELEASE EVENT</span><strong>${chosen.leadDays==null?'—':`${n.format(chosen.leadDays)} days`}</strong><small>Median non-negative elapsed time for shipped commits</small></div><div><span>TEST ACCOMPANIMENT</span><strong>${p(chosen.footprint.testAccompaniment)}</strong><small>Same commit touched code and test paths</small></div></div>
    <p class="impact-person-mix"><strong>Releases led by kind</strong> · ${e(releaseMix)}</p>
    ${yearly?`<div class="impact-person-years"><h6>Release involvement by year</h6><p class="impact-muted">Absolute distinct releases in the scoped dates. Short or partial years are not annualised.</p>${yearly}</div>`:''}
    <div class="impact-person-role-guide"><span><i class="impact-role-driver">L</i> Release lead</span><span><i class="impact-role-contributor">C</i> Authored changes shipped</span><span class="impact-muted">${amount(chosen.drivenOnly)} led only · ${amount(chosen.contributedOnly)} contributed only</span></div>
    <div class="impact-person-timeline">${involvement.length?involvement.slice().reverse().slice(0,24).map(r=>{const c=r.cells.find(c=>c.id===chosen.id);const didDrive=r.driver.groupId===chosen.id;return `<button type="button" data-action="impact-release" data-impact-hash="${e(r.hash)}" class="impact-person-release"><span class="impact-person-release-tags">${didDrive?'<i class="impact-role-driver">L</i>':''}${c?.footprint.commits?'<i class="impact-role-contributor">C</i>':''}</span><strong>${e(r.tag)}</strong><small>${e(shortDate(r.date))}</small><span class="impact-person-release-measure">${amount(c?.footprint.commits||0)} commits · ${p(c?.share)}</span></button>`;}).join(''):'<div class="impact-empty-mini">No led or authored release involvement in this scope.</div>'}</div>
    ${involvement.length>24?'<p class="impact-muted">Latest 24 involvements shown here; use the release matrix for the complete comparison.</p>':''}`;
}

/** The viewport changes presentation only: no Git selection, contribution or date filters. */
/**
 * Work under the axis, in two parts. A strip shades each stretch of days by
 * how many releases had commits written in it: pale for one, warming as work
 * for several releases ran at once. Below it, only the selected release's
 * tail and the tails of the releases it shared work days with, each joined to
 * its own dot by a leader, with the shared days shaded on both. Pinning a
 * stretch of the strip (never a release choice) swaps those for the tails of
 * every release whose work it held, the stretch shaded on each.
 */
const STRIP_Y=180,STRIP_H=8,FOCUS_TOP=206,FOCUS_LANE=13,DAY_MS=86400000;
const FLIGHT_COLOURS=['#dbe7de','#f3c9ae','#e8996f','#cf6340'];
const flightColour=count=>FLIGHT_COLOURS[Math.min(count,4)-1];
const isoDay=t=>new Date(t).toISOString().slice(0,10);
const tagList=tags=>tags.length>6?`${tags.slice(0,6).join(', ')} and ${tags.length-6} more`:tags.join(', ');
function releaseWork(all,min,max,x,left,right,selectedHash,flight=null) {
  const dayWidth=x(min+DAY_MS)-x(min);
  const bins=workInFlight(all,min,max,Math.ceil(3/Math.max(dayWidth,.01)));
  if(!bins.length)return {svg:'',height:0,partners:new Set()};
  const strip=bins.map(bin=>{
    const a=Math.max(left,x(bin.start)),b=Math.min(right,x(bin.end)-(dayWidth>4?.75:0));
    if(b<=a)return '';
    const ordered=[...bin.releases].sort((p,q)=>impactReleasePosition(p)-impactReleasePosition(q));
    const count=ordered.length,days=Math.round((bin.end-bin.start)/DAY_MS);
    const when=days>1?`${shortDate(isoDay(bin.start))} – ${shortDate(isoDay(bin.end-DAY_MS))}`:shortDate(isoDay(bin.start));
    const msg=`${when} · work for ${count} ${count===1?'release':'releases'}: ${tagList(ordered.map(r=>r.tag))}`;
    const pinned=flight&&bin.start<flight.end&&bin.end>flight.start;
    return `<rect x="${a}" y="${STRIP_Y}" width="${b-a}" height="${STRIP_H}" fill="${flightColour(count)}" class="impact-flight${pinned?' is-pinned':''}" data-action="impact-flight" data-flight-start="${bin.start}" data-flight-end="${bin.end}" data-flight="${e(ordered.map(r=>r.hash).join(' '))}" aria-pressed="${!!pinned}"><title>${e(msg)}${pinned?' · click again to unpin':' · click to see these releases\' work'}</title></rect>`;
  }).join('');
  const inFlight=t=>flight&&t>=flight.start&&t<flight.end;
  const pinned=flight?all.filter(r=>r.tail?.marks.some(inFlight)).slice(-8):[];
  const selected=pinned.length?null:all.find(r=>r.hash===selectedHash&&r.tail);
  const partners=(selected?.workPartners||[]).map(p=>({...p,release:all.find(r=>r.hash===p.hash)})).filter(p=>p.release?.tail);
  const sharedDays=new Set(partners.flatMap(p=>p.days));
  const lane=(r,i,days,active)=>{
    const {from,to,marks,carried}=r.tail,y=FOCUS_TOP+i*FOCUS_LANE;
    const a=Math.max(left,x(from)),b=Math.min(right,x(to)),end=x(to),visible=end>=left&&end<=right;
    const span=Math.round((to-from)/DAY_MS);
    const written=`${amount(marks.length)} ${marks.length===1?'commit':'commits'} written ${shortDate(isoDay(from))} – ${shortDate(r.date)}${span?` (${amount(span)} ${span===1?'day':'days'})`:''}`;
    const msg=pinned.length
      ?`${r.tag} · ${written} · ${amount(days.length)} ${days.length===1?'day':'days'} of its work in this stretch`
      :active
      ?`${r.tag} · ${written}${carried?` · ${amount(carried)} written before ${r.previousTag} shipped`:''}${partners.length?` · shares work days with ${partners.map(p=>`${p.tag} (${p.days.length})`).join(', ')}`:''}`
      :`${r.tag} · ${written} · ${amount(days.length)} ${days.length===1?'day':'days'} of work shared with ${selected.tag}`;
    let ticks='',last=-1;
    for(const t of marks){
      const at=Math.round(x(t)*2)/2;
      if(at<left||at>right||at===last)continue;
      ticks+=`M${at} ${y-3}v6`;last=at;
    }
    const shade=[...days].map(day=>{
      const s0=Math.max(left,x(day*DAY_MS)),s1=Math.min(right,x((day+1)*DAY_MS));
      return s1>s0?`<rect x="${s0}" y="${y-5}" width="${Math.max(1.5,s1-s0)}" height="10" rx="1.5" class="impact-shared-day"/>`:'';
    }).join('');
    const labelRight=end+8<right-60;
    const label=`<text x="${labelRight?Math.max(left,end)+8:a-6}" y="${y+3.5}" text-anchor="${labelRight?'start':'end'}" class="impact-focus-label">${e(r.tag.length>18?r.tag.slice(0,17)+'…':r.tag)}</text>`;
    return `<g class="impact-focus-tail${active?' is-active':''}"${active?'':` data-action="impact-release" data-impact-hash="${e(r.hash)}"`}><title>${e(msg)}</title>
      ${visible?`<line x1="${end}" y1="${y}" x2="${end}" y2="170" stroke="${color(r.transition)}" class="impact-focus-leader"/>`:''}
      <rect x="${a-2}" y="${y-FOCUS_LANE/2}" width="${Math.max(4,b-a+4)}" height="${FOCUS_LANE}" fill="transparent"/>
      ${shade}<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" class="impact-focus-line"/><path d="${ticks}" class="impact-focus-marks"/>
      ${visible?`<circle cx="${end}" cy="${y}" r="2.8" fill="${color(r.transition)}"/>`:''}${label}</g>`;
  };
  const daysIn=r=>[...new Set(r.tail.marks.filter(inFlight).map(t=>Math.floor(t/DAY_MS)))];
  const focus=pinned.length?pinned.map((r,i)=>lane(r,i,daysIn(r),r.hash===selectedHash)).join('')
    :selected?[lane(selected,0,sharedDays,true),...partners.map((p,i)=>lane(p.release,i+1,p.days,false))].join(''):'';
  const lanes=pinned.length||(selected?1+partners.length:0);
  return {svg:`<text x="40" y="${STRIP_Y+7}" text-anchor="end" class="impact-axis">WORK</text>${strip}${focus}`,
    // Room below the axis down to the last drawn row; the authored bars follow.
    height:(lanes?FOCUS_TOP+(lanes-.5)*FOCUS_LANE:STRIP_Y+STRIP_H)-170+4,
    partners:new Set((pinned.length?pinned:partners).map(p=>p.hash))};
}
export function impactTimeline(model, selectedHash, options={mode:'all'}) {
  if(!model.releases.length)return '';
  const extent=impactTimelineExtent(model);
  const window=impactTimelineWindow(model,options);
  if(!extent||!window)return '';
  const {start:min,end:max}=window;
  const all=model.releases;
  const records=all.filter(r=>impactReleasePosition(r)>=min&&impactReleasePosition(r)<=max);
  const width=1100;
  const x=date=>58+(date-min)/(max-min||1)*(width-94);
  const work=releaseWork(all,min,max,x,48,width-28,selectedHash,options.flight);
  const o=work.height,height=288+o;
  const hi=Math.max(1,...records.map(r=>r.metricValue??0));
  const y=value=>160-value/hi*108;
  const windowDates=impactTimelineDates(window), allDates=impactTimelineDates(extent);
  const isAll=window.mode==='all',isLatest=window.mode==='latest';
  const spanDays=(max-min)/86400000;
  // Rebuild author-activity bars from daily evidence: a zoomed partial month
  // must never display a whole month's count within a smaller date window.
  const weekly=spanDays<=120,bins=new Map();
  for(const day of (model.activityDays||[])) {
    const time=Date.parse(`${day.date}T00:00:00Z`);
    if(time<min||time>max)continue;
    const start=weekly?time-((new Date(time).getUTCDay()+6)%7)*86400000:Date.UTC(Number(day.date.slice(0,4)),Number(day.date.slice(5,7))-1,1);
    const key=weekly?new Date(start).toISOString().slice(0,10):day.date.slice(0,7);
    if(!bins.has(key))bins.set(key,{start,count:0,version:0,label:weekly?`Week of ${shortDate(key)}`:key});
    bins.get(key).count+=day.count;bins.get(key).version+=day.version;
  }
  const barsData=[...bins.values()].sort((a,b)=>a.start-b.start);
  const barMax=Math.max(1,...barsData.map(b=>b.count));
  const bars=barsData.map(b=>{
    const end=weekly?b.start+7*86400000:Date.UTC(new Date(b.start).getUTCFullYear(),new Date(b.start).getUTCMonth()+1,1);
    const left=x(Math.max(min,b.start)),barW=Math.max(1,x(Math.min(max,end))-left-2);
    const h=34*b.count/barMax;
    return `<rect x="${left}" y="${246+o-h}" width="${barW}" height="${h}" rx="1" fill="#9dbfac" opacity=".85"><title>${e(b.label)} · ${amount(b.count)} authored commits · ${amount(b.version)} VERSION touches (within shown range)</title></rect>`;
  }).join('');
  const versionMarkers=model.versionEvents.filter(c=>c.authoredAt!=null&&Date.parse(`${c.date}T12:00:00Z`)>=min&&Date.parse(`${c.date}T12:00:00Z`)<=max).map(c=>{
    const pos=x(Date.parse(`${c.date}T12:00:00Z`));
    return `<path d="M ${pos} ${195+o} l 4 4 l -4 4 l -4 -4 z" fill="#ad7d3c" stroke="#fff" stroke-width=".8"><title>${e(c.date)} · VERSION edit · ${e(c.subject)} · ${e(c.name)}</title></path>`;
  }).join('');
  const ticks=[];
  const startDate=new Date(min),endDate=new Date(max);
  const tickMonths=spanDays<=120?0:spanDays<=365?1:spanDays<=3*365?3:spanDays<=7*365?6:12;
  if(!tickMonths) {
    const startWeek=Date.UTC(startDate.getUTCFullYear(),startDate.getUTCMonth(),startDate.getUTCDate());
    for(let t=startWeek;t<=max;t+=7*86400000)if(t>=min)ticks.push({time:t,label:shortDate(new Date(t).toISOString().slice(0,10))});
  } else {
    for(let year=startDate.getUTCFullYear();year<=endDate.getUTCFullYear();year++)for(let month=0;month<12;month+=tickMonths){
      const t=Date.UTC(year,month,1);
      if(t>=min&&t<=max)ticks.push({time:t,label:month===0?String(year):new Date(t).toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'})});
    }
  }
  if(ticks.length<2)ticks.push({time:min,label:shortDate(windowDates.from)},{time:max,label:shortDate(windowDates.to)});
  // Avoid dozens of overlapping labels on a full-history overview.
  const skip=Math.max(1,Math.ceil(ticks.length/11));
  const dayWidth=(x(min+86400000)-x(min));
  const layout=dodgeReleases(records,r=>x(impactReleasePosition(r)),r=>r.metricValue==null?181:y(r.metricValue),width-36,dayWidth>=MIN_DODGE_DAY);
  const stems=records.map(r=>{
    const undefinedMetric=r.metricValue==null;
    const {at,cx,cy}=layout.get(r.hash),active=r.hash===selectedHash;
    const msg=`${r.tag} · ${shortDate(r.date)}${clockText(r)} · ${typeLabel(r.transition)} · ${humanMetric(r.metricValue,model.metric)} ${IMPACT_METRICS[model.metric]} · ${driverText(r)} · ${amount(r.selectedFootprint.pathsCount)} paths`;
    return `<line x1="${at}" y1="170" x2="${cx}" y2="${cy}" stroke="${color(r.transition)}" stroke-opacity="${active?'.8':'.34'}" stroke-width="${active?3:2}"/>
      ${active?`<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="#152f21" stroke-width="2" opacity=".5"/>`:''}${work.partners.has(r.hash)?`<circle cx="${cx}" cy="${cy}" r="10" class="impact-partner-ring"/>`:''}
      <circle cx="${cx}" cy="${cy}" r="${active?8:5.5}" fill="${undefinedMetric?'#fff':color(r.transition)}" stroke="${active?'#152f21':undefinedMetric?'#8d9f91':'#fff'}" stroke-width="${active?3:2}" role="button" tabindex="0" aria-current="${active?'true':'false'}" aria-label="${e(msg)}. Select release" data-action="impact-release" data-impact-hash="${e(r.hash)}" class="impact-timeline-dot"><title>${e(msg)}</title></circle>`;
  }).join('');
  const selected=records.find(r=>r.hash===selectedHash);
  const selectedX=selected?layout.get(selected.hash).cx:0;
  const selectedText=selected?.tag.length>24?selected.tag.slice(0,21)+'…':selected?.tag||'';
  const captionW=Math.max(110,Math.min(230,selectedText.length*7+70));
  const captionLeft=Math.max(50,Math.min(width-captionW-23,selectedX-captionW/2));
  const caption=selected?`<line x1="${selectedX}" y1="35" x2="${selectedX}" y2="${260+o}" stroke="#254e35" stroke-width="1" stroke-dasharray="4 6" opacity=".44" pointer-events="none"/><rect x="${captionLeft}" y="8" width="${captionW}" height="25" rx="5" fill="#244c37" pointer-events="none"/><text x="${captionLeft+10}" y="24.5" font-size="11" font-family="sans-serif" fill="#fff" pointer-events="none">Selected · ${e(selectedText)}</text>`:'';
  const panSpan=extent.end-extent.start-(max-min);
  const panProgress=panSpan>0?Math.round(1000*(min-extent.start)/panSpan):0;
  const overviewStart=100*(min-extent.start)/(extent.end-extent.start);
  const overviewWidth=Math.max(0.6,100*(max-min)/(extent.end-extent.start));
  const overviewTicks=all.map(r=>`<i class="impact-overview-tick" style="left:${Math.max(0,Math.min(100,100*(impactReleasePosition(r)-extent.start)/(extent.end-extent.start)))}%" title="${e(r.tag)} · ${e(shortDate(r.date))}"></i>`).join('');
  return `<div class="impact-timeline-controls">
      <div class="impact-timeline-presets" role="group" aria-label="Timeline extent">
        <button type="button" class="impact-preset ${isAll?'is-active':''}" data-action="impact-range-preset" data-impact-range="all" aria-pressed="${isAll}">All releases</button>
        <button type="button" class="impact-preset ${isLatest?'is-active':''}" data-action="impact-range-preset" data-impact-range="latest" aria-pressed="${isLatest}">Latest 18</button>
      </div>
      <div class="impact-timeline-zoom" role="group" aria-label="Zoom timeline">
        <button type="button" data-action="impact-zoom" data-impact-zoom="out" aria-label="Zoom out" title="Zoom out" ${isAll?'disabled':''}>−</button>
        <button type="button" data-action="impact-zoom" data-impact-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
      </div>
      <div class="impact-timeline-dates" role="group" aria-label="Visible timeline dates">
        <label for="impact-timeline-from">FROM <input id="impact-timeline-from" type="date" value="${windowDates.from}" min="${allDates.from}" max="${allDates.to}"></label>
        <span aria-hidden="true">–</span>
        <label for="impact-timeline-to">TO <input id="impact-timeline-to" type="date" value="${windowDates.to}" min="${allDates.from}" max="${allDates.to}"></label>
      </div>
    </div>
    <div class="impact-timeline-overview"><span class="impact-overview-label">HISTORY</span><div class="impact-overview-track" data-timeline-brush title="Click to jump here; drag the window to pan">${overviewTicks}<span class="impact-overview-window" style="left:${overviewStart}%;width:${overviewWidth}%" role="slider" tabindex="0" aria-label="Visible part of the release history. Arrow keys pan; plus and minus zoom" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="${panProgress}" aria-valuetext="${e(shortDate(windowDates.from))} to ${e(shortDate(windowDates.to))}"></span></div></div>
    <div class="impact-timeline-info"><span>${isAll?'Full timeline':isLatest?'Recent releases':'Custom time window'} · ${e(shortDate(windowDates.from))} – ${e(shortDate(windowDates.to))} · ${records.length} of ${all.length} releases in global scope</span><span class="impact-timeline-hint">${!records.length?'No tags in this range · ':''}Drag to pan · pinch or Ctrl/⌘-scroll to zoom · double-click to zoom in</span></div>
    <div class="impact-timeline-scroll" tabindex="0" aria-label="Release timeline. Arrow keys pan; plus and minus zoom; 0 shows all releases"><svg viewBox="0 0 ${width} ${height}" width="100%" data-timeline-plot data-start="${min}" data-end="${max}" data-plot-left="58" data-plot-width="${width-94}" data-view-width="${width}" role="img" aria-label="Tag-date release timeline from ${e(windowDates.from)} to ${e(windowDates.to)}. Interactive markers select a tagged release.">
      ${[0,.5,1].map(f=>`<line x1="48" y1="${y(f*hi)}" x2="${width-28}" y2="${y(f*hi)}" stroke="#e4ebe1" stroke-dasharray="2 4"/><text x="40" y="${y(f*hi)+4}" text-anchor="end" class="impact-axis">${humanMetric(f*hi,model.metric)}</text>`).join('')}
      <line x1="48" y1="170" x2="${width-28}" y2="170" stroke="#bbcfc0"/>
      ${work.svg}
      ${stems}${caption}
      <text x="14" y="${235+o}" class="impact-axis" transform="rotate(-90,14,${235+o})">AUTHORED</text>
      <line x1="48" y1="${246+o}" x2="${width-28}" y2="${246+o}" stroke="#d6e6d6"/>
      ${bars}${versionMarkers}
      ${ticks.filter((_,i)=>i%skip===0).map(t=>`<line x1="${x(t.time)}" y1="${249+o}" x2="${x(t.time)}" y2="${254+o}" stroke="#9aae9c"/><text x="${x(t.time)}" y="${273+o}" text-anchor="middle" class="impact-axis">${e(t.label)}</text>`).join('')}
    </svg></div>
    ${!records.length?'<p class="impact-muted" role="status">No release tags fall within this timeline range. Adjust the dates or choose a release from the dropdown to locate it.</p>':''}
    <div class="impact-timeline-legend">${['major','minor','patch','prerelease','baseline','unclassified'].map(kind=>`<span><i style="background:${color(kind)}"></i>${typeLabel(kind)}</span>`).join('')}
      <span><i style="background:#9dbfac;border-radius:1px"></i>Authored commits (including unreleased)</span><span><i style="background:#ad7d3c;transform:rotate(45deg);border-radius:0"></i>VERSION touched (author date)</span><span><i style="background:#fff;border:2px solid #8d9f91"></i>Undefined measure</span><span class="impact-flight-key">Work in flight ${FLIGHT_COLOURS.map((c,i)=>`<i style="background:${c}" title="${i+1}${i===3?'+':''} releases"></i>`).join('')}&nbsp;1 → 4+ releases</span><span><i class="impact-shared-key"></i>Shared work days · click a stretch to pin it, Esc to unpin</span></div>`;
}

export function impactReleasePicker(model, hash) {
  const releases=model.releases;
  return `<label class="impact-select-label" for="impact-release-select">RELEASE TO INSPECT</label><select class="impact-select" id="impact-release-select">${releases.slice().reverse().map(r=>`<option value="${e(r.hash)}" ${r.hash===hash?'selected':''}>${e(r.tag)} · ${e(shortDate(r.date))} · ${r.published?'GitHub published':'Git tag'} · ${e(typeLabel(r.transition))}</option>`).join('')}</select>`;
}

function impactCommits(commits) {
  if(!commits.length) return '<p class="impact-empty-mini">No matching commits in this scoped release.</p>';
  return `<div class="impact-evidence-list">${[...commits].sort((a,b)=>(b.authoredAt??0)-(a.authoredAt??0)).slice(0,45).map(c=>`<div class="impact-evidence-row"><code>${e(c.hash.slice(0,9))}</code><span>${e(c.subject || '(no subject)')}</span><small>${e(c.date)} · ${e(c.name)}</small></div>`).join('')}</div>${commits.length>45?`<small class="impact-muted">Showing the latest 45 of ${amount(commits.length)} matching commits. Export the session for full imported evidence.</small>`:''}`;
}

export function impactReleaseDetail(release, referenceLabel, metric) {
  if(!release)return '<div class="impact-empty-mini">Select a tag in the timeline or comparison matrix to inspect its evidence.</div>';
  const f=release.selectedFootprint;
  const kinds=Object.entries(f.kindCounts).filter(([,count])=>count).sort((a,b)=>b[1]-a[1]);
  const categories=kinds.map(([kind,count])=>`<div class="impact-kind-row"><span>${e(kind)}</span><div><i style="width:${f.commits?100*count/f.commits:0}%"></i></div><strong>${amount(count)}</strong></div>`).join('');
  const next=release.nextTagFootprint;
  return `<div class="impact-release-head"><div><div class="impact-date">${e(shortDate(release.date))} · ${e(releaseClock(release))}</div>
    <h5>${e(release.tag)} <span class="impact-kind-badge" style="--kind:${color(release.transition)}">${e(typeLabel(release.transition))}</span></h5>
    <p>${release.previousTag?`Introduced after <strong>${e(release.previousTag)}</strong>`:'First tagged snapshot on this lineage. Includes all reachable prior history, not one release-sized increment.'}
    ${release.aliases.length>1?` · Alias tags: ${release.aliases.map(e).join(', ')}`:''}</p>
    ${!release.lineageComplete?'<p class="impact-warning">Incomplete parent history: imported commit ancestry does not establish this release difference completely.</p>':''}
    ${release.chronologyWarning?'<p class="impact-warning">Publication dates do not follow code ancestry for this lineage. Git ancestry still determines introduced changes.</p>':''}</div>
    <div class="impact-release-driver"><span>RELEASE LEAD · ASSUMED</span><strong>${e(driverText(release))}</strong><small>${release.published?'GitHub published release':release.githubDraft?'Draft GitHub Release; tag remains Git-only evidence':'Tag metadata'}</small></div></div>
    ${release.github?`<div class="impact-release-notes"><div><span class="impact-gh-mark">GITHUB RELEASE</span>${release.github.url?`<a href="${e(release.github.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a>`:''}</div><strong>${e(release.github.title||release.tag)}</strong>${release.github.notes?`<details><summary>Read release notes</summary><div class="impact-notes-text">${e(release.github.notes.slice(0,6000))}${release.github.notes.length>6000?'\n… truncated in this view; open GitHub for full notes.':''}</div></details>`:'<p>No release notes supplied.</p>'}</div>`:''}
    <div class="impact-detail-facts">
    <div><span>SCOPED COMMITS</span><strong>${amount(f.commits)}</strong><small>${amount(release.eligibleIntroduced)} eligible · ${amount(release.totalIntroduced)} DAG-introduced before filters</small></div>
    <div><span>DISTINCT PATHS</span><strong>${amount(f.pathsCount)}</strong><small>${amount(f.areasCount)} top-level areas</small></div>
    <div><span>LINE CHURN</span><strong>${amount(f.churn)}</strong><small>+${amount(f.additions)} / −${amount(f.deletions)}</small></div>
    <div><span>TEST ACCOMPANIMENT</span><strong>${p(f.testAccompaniment)}</strong><small>Code-touching commits also touching test paths</small></div>
    <div><span>VERSION TOUCHES</span><strong>${amount(f.versionTouches)}</strong><small>Independent supporting signal</small></div>
    <div><span>AUTHOR → RELEASE EVENT</span><strong>${release.leadDays==null?'—':`${n.format(release.leadDays)}d`}</strong><small>Median elapsed days · not delivery lead time</small></div>
    </div>
    <div class="impact-release-people"><h6>Who participated in this release? <small>Filtered authored commits · publisher role is separate</small></h6><div class="impact-release-people-grid">${release.cells.filter(c=>c.drove || c.footprint.commits).map(c=>`<div class="impact-release-person"><div><strong>${e(c.name)}</strong>${c.drove?'<span class="impact-role-driver">LEAD</span>':''}</div><p>${amount(c.footprint.commits)} shipped commits · ${p(c.share)} of reference</p><small>${amount(c.footprint.pathsCount)} paths · ${amount(c.footprint.areasCount)} areas · ${p(c.footprint.testAccompaniment)} test accompaniment</small></div>`).join('')||'<p class="impact-muted">No matching contributors in the selected scope.</p>'}</div></div>
    <div class="impact-release-columns"><div><h6>Changes by category <small>Subject heuristics</small></h6>${categories||'<p>None in scope</p>'}</div>
    <div><h6>Later change to touched paths</h6><p class="impact-muted">Reference: ${e(referenceLabel)} · Paths can be revisited for good reasons.</p>
      <div class="impact-revisit-fact"><strong>${next?.share==null?'—':p(next.share)}</strong><span>${next?`${amount(next.count)} of ${amount(f.pathsCount)} paths revisited by ${e(release.nextTag)} relative to this tag`:'No subsequent descendant tag in imported history'}</span></div>
      <div class="impact-revisit-windows">${release.followup.map(record=>`<div><small>${record.days} DAYS</small><strong>${record.observed?p(record.share):'—'}</strong><span>${record.observed?`${amount(record.count)} paths`:'Not fully observed'}</span></div>`).join('')}</div>
    </div></div>
    <details class="impact-evidence"><summary>Inspect commit evidence <span>${amount(release.selected.length)} matching commits</span></summary>${impactCommits(release.selected)}</details>`;
}

/** Only render a bounded slice of the release matrix, while retaining all releases
 *  for navigation, colouring and export. Pages are numbered newest first. */
export const IMPACT_MATRIX_PAGE_SIZES = Object.freeze([18, 36, 54]);
export function impactMatrixWindow(all, options={}) {
  const mode=options.mode==='latest'?'latest':'all';
  const size=mode==='latest'?18:(IMPACT_MATRIX_PAGE_SIZES.includes(Number(options.size))?Number(options.size):18);
  const requestedYear=typeof options.year==='string'?options.year:'all';
  const year=mode==='latest'||!all.some(r=>r.date?.startsWith(`${requestedYear}-`))?'all':requestedYear;
  const available=mode==='latest' ? all.slice(-18) : all.filter(r=>year==='all'||r.date?.startsWith(`${year}-`));
  const pages=Math.max(1,Math.ceil(available.length/size));
  const requested=Number(options.page);
  const page=mode==='latest'?0:(Number.isInteger(requested)?Math.max(0,Math.min(requested,pages-1)):0);
  const end=Math.max(0,available.length-page*size);
  const start=Math.max(0,end-size);
  return {mode,year,size,page,pages,total:available.length,fullCount:all.length,
    start,end,releases:available.slice(start,end)};
}

export function impactMatrixPageForRelease(releases,hash,size=18) {
  const index=releases.findIndex(r=>r.hash===hash);
  if(index<0)return null;
  const perPage=IMPACT_MATRIX_PAGE_SIZES.includes(size)?size:18;
  return Math.floor((releases.length-1-index)/perPage);
}

const matrixCsvField = value => {
  const text=String(value ?? '');
  // Git tag names, author aliases and release titles are not trusted CSV formulae.
  const safe=/^\s*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g,'""')}"`;
};
/** Export every globally scoped release, independent of browsing/page/year. */
export function impactReleaseMatrixCsv(model) {
  const heading=['Release','Release date','Release kind','GitHub publisher','Contributor',
    'Release lead','Metric','Metric value','Commits','Commit share (%)',
    'Distinct paths','Codebase areas','Line churn'];
  const rows=[heading];
  for(const release of model.releases) {
    for(const cell of release.cells) {
      rows.push([release.tag,release.date,release.transition,release.driver?.login||'',cell.name,
        cell.drove?'Yes':'No',model.metric,cell.value ?? '',cell.footprint?.commits ?? 0,
        cell.share ?? '',cell.footprint?.pathsCount ?? 0,cell.footprint?.areasCount ?? 0,
        cell.footprint?.churn ?? 0]);
    }
  }
  return rows.map(row=>row.map(matrixCsvField).join(',')).join('\r\n')+'\r\n';
}

export function impactReleaseMatrix(model, options={}) {
  const all=model.releases;
  const window=impactMatrixWindow(all,options);
  const releases=window.releases;
  if(!all.length)return '';
  const people=releases[0]?.cells || [];
  const labels=model.metric==='share'?'Percent of reference commits':IMPACT_METRICS[model.metric];
  // The SAME scale is used on every page. Recomputing from visible cells would
  // imply that equal values mean different things after a page change.
  const scale=makeIntensityScale(all.flatMap(r=>r.cells.map(c=>c?.value)));
  const years=[...new Set(all.map(r=>r.date?.slice(0,4)).filter(Boolean))].sort().reverse();
  const first=releases[0],last=releases.at(-1);
  const pageLabel=window.total?`${window.start+1}–${window.end} of ${window.total}`:'No releases';
  const selection=options.selectedHash;
  return `<p class="impact-muted">Each cell is ${e(labels.toLowerCase())} by a selected contributor, within a tagged release and the global authored-date/commit-policy scope. The reference for shares is <strong>${e(model.referenceLabel)}</strong>. Distinct paths/areas can overlap across people.</p>
    <div class="impact-matrix-nav">
      <div class="impact-matrix-nav-top">
        <div class="impact-timeline-presets" role="group" aria-label="Matrix release history">
          <button type="button" class="impact-preset ${window.mode==='all'?'is-active':''}" data-action="impact-matrix-mode" data-matrix-mode="all" aria-pressed="${window.mode==='all'}">Browse all ${amount(all.length)}</button>
          <button type="button" class="impact-preset ${window.mode==='latest'?'is-active':''}" data-action="impact-matrix-mode" data-matrix-mode="latest" aria-pressed="${window.mode==='latest'}">Latest 18</button>
        </div>
        <button type="button" class="impact-matrix-export" data-action="impact-export-matrix" aria-label="Export all ${all.length} scoped releases to CSV">Export all ${amount(all.length)} · CSV ↓</button>
      </div>
      ${window.mode==='all'?`<div class="impact-matrix-nav-fields">
        <label>RELEASE YEAR<select class="impact-select" id="impact-matrix-year"><option value="all" ${window.year==='all'?'selected':''}>All years</option>${years.map(year=>`<option value="${e(year)}" ${window.year===year?'selected':''}>${e(year)}</option>`).join('')}</select></label>
        <label>RELEASES PER PAGE<select class="impact-select" id="impact-matrix-size">${IMPACT_MATRIX_PAGE_SIZES.map(size=>`<option value="${size}" ${window.size===size?'selected':''}>${size}</option>`).join('')}</select></label>
        <label>JUMP TO RELEASE<select class="impact-select" id="impact-matrix-release-select" aria-label="Jump to a tagged release in the matrix"><option value="">Choose a release…</option>${all.slice().reverse().map(r=>`<option value="${e(r.hash)}">${e(r.tag)} · ${e(r.date||'Undated')}</option>`).join('')}</select></label>
      </div>`:''}
      <div class="impact-matrix-page-nav" aria-live="polite">
        <span class="impact-matrix-page-status">${window.mode==='latest'?`Showing latest ${releases.length} of ${all.length} releases`:`${pageLabel} releases · page ${window.pages-window.page} of ${window.pages}${window.year!=='all'?` · ${e(window.year)} (${all.length} total in scope)`:''}`}${first&&last?` · ${e(first.tag)} to ${e(last.tag)}`:''}</span>
        ${window.mode==='all'?`<div class="impact-matrix-page-buttons" role="group" aria-label="Browse tagged releases">
          <button type="button" data-action="impact-matrix-page" data-matrix-page="oldest" ${window.page>=window.pages-1?'disabled':''} aria-label="First page, oldest releases">« Oldest</button>
          <button type="button" data-action="impact-matrix-page" data-matrix-page="older" ${window.page>=window.pages-1?'disabled':''}>‹ Older</button>
          <button type="button" data-action="impact-matrix-page" data-matrix-page="newer" ${window.page===0?'disabled':''}>Newer ›</button>
          <button type="button" data-action="impact-matrix-page" data-matrix-page="latest" ${window.page===0?'disabled':''} aria-label="Last page, newest releases">Latest »</button>
        </div>`:''}
      </div>
    </div>
    ${releases.length?`<div class="impact-matrix-scroll" tabindex="0" role="region" aria-label="Contributor by release matrix; scroll horizontally to compare releases"><table class="impact-matrix"><thead><tr><th>CONTRIBUTOR</th>${releases.map(r=>`<th data-matrix-release="${e(r.hash)}" class="${r.hash===selection?'is-selected':''}" ${r.hash===selection?'aria-current="true"':''}><span class="impact-matrix-version">${e(r.tag)}</span><small>${e(r.date||'—')}</small></th>`).join('')}</tr></thead><tbody>
    ${people.map((person,i)=>`<tr><th title="${e(person.name)}">${e(person.name)}</th>${releases.map(r=>{const cell=r.cells[i];const value=cell?.value;const tooltip=`${person.name} · ${r.tag}: ${humanMetric(value,model.metric)} ${labels}${cell?.drove?' · led release':''}`;return `<td class="${r.hash===selection?'is-selected':''}"><button type="button" data-action="impact-release" data-impact-hash="${e(r.hash)}" class="impact-matrix-cell ${cell?.drove?'impact-matrix-driver':''}" style="${intensityStyle(value,scale)}" title="${e(tooltip)}" aria-label="${e(tooltip)}. Open release detail">${humanMetric(value,model.metric)}${cell?.drove?'<span class="impact-matrix-driver-mark" aria-hidden="true">L</span>':''}</button></td>`;}).join('')}</tr>`).join('')}
    </tbody></table></div>`:'<div class="impact-empty-mini">No releases in this year. Choose All years.</div>'}
    <div class="impact-colour-key">${intensityLegend(scale,x=>model.metric==='share'?`${precise(x)}%`:precise(x),{missing:true})}</div>
    <p class="impact-muted">${window.mode==='latest'?`Latest ${releases.length} of ${all.length}`:`Browsing all ${all.length} scoped releases · ${releases.length} rendered on this page`} to keep the dashboard responsive. Colour intensity uses <strong>one scale for the entire scoped release history</strong> regardless of page or year. L marks a verified/matched release lead independently of authored contribution. Unavailable shares are hatched, not zero. Matrix navigation changes only what is displayed, not the global data filters.</p>`;
}

export function impactDurability(model, selectedHash, expanded=false) {
  const releases=expanded?model.releases:model.releases.slice(-18);
  return `<p class="impact-muted">This is a <strong>file revisit</strong> cohort, not surviving-lines or quality analysis. A percentage counts distinct paths first touched by the selected contributors in the release, then touched again by the reference group on descendant commits. Windows are only reported after the imported history spans the full elapsed period. File renames are not followed.</p>
    <div class="impact-matrix-scroll"><table class="impact-matrix impact-evolution-table"><thead><tr><th>TAGGED RELEASE</th><th>PATHS</th><th>NEXT TAG</th><th>30 DAYS</th><th>90 DAYS</th><th>180 DAYS</th><th>OBSERVATION</th></tr></thead><tbody>
    ${releases.slice().reverse().map(r=>`<tr class="${r.hash===selectedHash?'is-selected':''}"><th><button class="impact-text-link" type="button" data-action="impact-release" data-impact-hash="${e(r.hash)}">${e(r.tag)}</button><small>${e(shortDate(r.date))}</small></th>
      <td>${amount(r.selectedFootprint.pathsCount)}</td><td>${r.nextTagFootprint?.share==null?'—':p(r.nextTagFootprint.share)}<small>${r.nextTag?e(r.nextTag):'No later descendant tag'}</small></td>
      ${r.followup.map(d=>`<td><strong>${d.observed?p(d.share):'—'}</strong><small>${d.observed?`${d.count} paths`:'Not fully observed'}</small></td>`).join('')}
      <td>${r.lineageComplete?'Full imported ancestry':'Partial ancestry'}</td></tr>`).join('')}
    </tbody></table></div><p class="impact-muted">“—” means undefined or insufficient follow-up, never zero. Excluded merges/reverts and out-of-window author dates are also excluded from revisitation counts. ${releases.length}${!expanded&&model.releases.length>18?` of ${model.releases.length}`:''} releases shown.</p>
    ${model.releases.length>18?`<button type="button" data-action="impact-toggle-all" class="impact-link">${expanded?'Show latest 18 releases':`Show all ${model.releases.length} releases`}</button>`:''}`;
}
