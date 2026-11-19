/** Accessible, bounded UI for the three primary evidence perspectives. */
import { periodDigest, contributorPortrait, releaseDetails, releaseLandscape, windowOf, briefingText, releaseFingerprints, releaseFootprints, codebaseCommits, personAreaTouches, areaPortrait } from './perspectives.js?v=people-20261119-1';
import { RELEASE_AGE_BUCKETS, RELEASE_SHAPES, fresherThan, shapeNote } from './release-latency.js?v=people-20261119-1';
import { FOOTPRINT_SHAPES, footprintNote, similarReleases, releaseFootprint, footprintArea, topOf, OTHER_FOLDERS } from './release-footprint.js?v=people-20261119-1';
import { makeIntensityScale, intensityStyle, intensityLegend } from './value-colour.js?v=people-20261119-1';
import { coReleasePatterns, coReleaseEvidence } from './co-release.js?v=people-20261119-1';
import { targetUrl } from './route-state.js?v=people-20261119-1';
import { markdownFrame } from './markdown.js?v=people-20261119-1';
import { deploymentOverviewPanel, deploymentReleasePanel, deploymentPeriodPanel, deploymentContributorPanel, deploymentExplorer, deploymentBriefing } from './deployment-view.js?v=people-20261119-1';

const e=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const n=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
const f=v=>Number.isFinite(v)?n.format(v):'—';
const p=v=>Number.isFinite(v)?`${n.format(v*100)}%`:'—';
const day=v=>v?new Date(`${v}T12:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Unknown date';
const type=v=>({major:'Major',minor:'Minor',patch:'Patch',prerelease:'Prerelease',baseline:'Baseline',unclassified:'Unclassified',divergent:'Parallel history','same-version':'Same version'})[v]||'Unclassified';
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const unique=values=>[...new Set(values)];
const shiftDate=(date,n)=>new Date(Date.parse(`${date}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
const monthEnd=month=>new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).toISOString().slice(0,10);
const dateAtWeek=date=>{const at=Date.parse(`${date}T00:00:00Z`),weekday=(new Date(at).getUTCDay()+6)%7;return new Date(at-weekday*86400000).toISOString().slice(0,10);};
const bar=(v,max,cls='')=>`<span class="primary-mini-track"><span class="primary-mini-fill ${cls}" style="width:${max>0?clamp(v/max*100,0,100):0}%"></span></span>`;
const href=(index,change)=>e(targetUrl(index.navigation?.path||'./index.html',index.navigation?.ui||{},index.navigation?.groups||index.groups,index.navigation?.datasetId,change));
const tagButton=(index,r,text=r.tag)=>`<a class="primary-inline-link" href="${href(index,{view:'observatory',release:r.hash})}" data-action="primary-open-release" data-hash="${e(r.hash)}">${e(text)} <span aria-hidden="true">↗</span></a>`;
const whoButton=(index,id)=>`<a class="primary-inline-link" href="${href(index,{view:'contributors',person:index.groups.find(g=>g.id===id)?.emails?.[0],tab:'delivery'})}" data-action="primary-open-person" data-person="${e(id)}">${e(index.groups.find(g=>g.id===id)?.displayName||'Unknown contributor')}</a>`;
const stat=(value,label,note='')=>`<div class="primary-stat"><strong>${e(value)}</strong><span>${e(label)}</span>${note?`<small>${e(note)}</small>`:''}</div>`;
const empty=(title,detail)=>`<div class="primary-quiet"><strong>${e(title)}</strong><p>${e(detail)}</p></div>`;
const caption=text=>`<p class="primary-explainer">${e(text)}</p>`;
const select=(id,values,selected,attr='')=>`<select id="${id}" class="primary-select" ${attr}>${values.map(v=>`<option value="${e(v.value)}" ${String(v.value)===String(selected)?'selected':''}>${e(v.label)}</option>`).join('')}</select>`;
const card=(title,body)=>`<section class="primary-panel"><div class="primary-card-heading"><h3>${e(title)}</h3></div>${body}</section>`;
const duration=v=>!Number.isFinite(v)?'—':v<1?`${n.format(v*24)} h`:v<90?`${n.format(v)} days`:`${n.format(v/30.44)} months`;
/** Commit age at release as columns; waiting (unreleased) commits sit apart and stay out of percentiles. */
function releaseAgeChart(dist,{compare=null,ghost=null,subject='Commits',compareLabel='Everyone',facts=true}={}){
  const measured=dist.total+dist.unreleased;
  if(!dist.released&&!dist.unreleased)return empty('No dated commits to measure','Commit age needs author times and a dated release.');
  const share=(value,of)=>of?value/of:0;
  const unit=dist.weighted?'lines changed':'commits';
  const compareTotal=compare?compare.total+compare.unreleased:0;
  const columns=[...dist.buckets.map((b,i)=>({label:b.label,count:b.count,value:b.amount,mine:share(b.amount,measured),
      theirs:compare?share(compare.buckets[i].amount,compareTotal):null,typical:ghost?ghost[i]:null})),
    ...(dist.unreleased||compare?.unreleased?[{label:'Not yet released',count:dist.unreleased,value:dist.unreleased,mine:share(dist.unreleased,measured),theirs:compare?share(compare.unreleased,compareTotal):null,typical:null,waiting:true}]:[])];
  const top=Math.max(...columns.map(c=>Math.max(c.mine,c.theirs||0,c.typical||0)),.01);
  const summary=`${subject}: median ${duration(dist.median)} from authoring to first release by ${unit}; 90% within ${duration(dist.p90)}${dist.unreleased?`; ${dist.unreleased} not yet released`:''}.`;
  return `<div class="primary-age-chart" role="img" aria-label="${e(summary)}">${columns.map(c=>`<div class="primary-age-col${c.waiting?' is-waiting':''}" title="${e(`${c.label}: ${f(c.value)} ${c.waiting?'commits':unit} (${p(c.mine)})${c.theirs!=null?` · ${compareLabel}: ${p(c.theirs)}`:''}${c.typical!=null?` · all releases: ${p(c.typical)}`:''}`)}"><span class="primary-age-bar">${c.typical!=null?`<u style="height:${clamp(c.typical/top*100,0,100)}%"></u>`:''}<i style="height:${clamp(c.mine/top*100,c.value?2:0,100)}%"></i>${c.theirs!=null?`<b style="bottom:${clamp(c.theirs/top*100,0,100)}%"></b>`:''}</span><strong>${f(c.value)}</strong><small>${e(c.label)}</small></div>`).join('')}</div>
    ${compare||ghost?`<p class="primary-legend-row"><span><i class="primary-age-key"></i> ${e(subject)}${dist.weighted?' · lines changed':''}</span>${compare?`<span><i class="primary-age-key is-compare"></i> ${e(compareLabel)}, same window</span>`:''}${ghost?'<span><i class="primary-age-key is-typical"></i> All releases</span>':''}</p>`:''}
    ${facts?`<div class="primary-facts">${stat(duration(dist.median),'Median time to release',`${f(dist.released)} released commits`)}${stat(duration(dist.p75),'75% released within')}${stat(duration(dist.p90),'90% released within')}${stat(f(dist.unreleased),'Not yet released',dist.unreleased?`Oldest waiting ${duration(dist.oldestWaiting)}`:'Everything here has shipped')}</div>`:''}`;
}

const AGE_TICKS=[[1,'1 day'],[7,'1 week'],[30,'1 month'],[91,'3 months'],[182,'6 months'],[365,'1 year'],[730,'2 years']];
/** Commits placed by author time before the release (log scale), in contributor lanes. */
function arrivalTimeline(index,release,fingerprint,{weight='commits'}={}){
  const entries=fingerprint.entries;
  if(!entries.length)return empty('No dated commits to place','Commit age needs author times and a dated release.');
  const byPerson=new Map();
  for(const x of entries)byPerson.set(x.groupId,(byPerson.get(x.groupId)||0)+1);
  const lanes=[...byPerson].sort((a,b)=>b[1]-a[1]).slice(0,7).map(([id])=>id);
  const others=byPerson.size>lanes.length;
  const laneOf=id=>{const i=lanes.indexOf(id);return i>=0?i:lanes.length;};
  const rows=lanes.length+(others?1:0);
  const W=760,left=128,right=W-24,top=26,lane=28,H=top+rows*lane+34;
  const maxAge=Math.max(1,...entries.map(x=>x.age));
  const x=age=>right-Math.log1p(age)/Math.log1p(maxAge)*(right-left);
  const maxLines=Math.max(1,...entries.map(x=>x.lines));
  const radius=v=>weight==='lines'?2.5+9*Math.sqrt(v/maxLines):3.6;
  const jitter=hash=>((parseInt(hash.slice(0,6),16)||0)%100)/100-.5;
  const median=fingerprint[weight].median;
  const name=id=>index.groups.find(g=>g.id===id)?.displayName||'Unknown contributor';
  const ticks=AGE_TICKS.filter(([d])=>d<=maxAge*1.05);
  const dots=entries.slice().sort((a,b)=>b.lines-a.lines).map(c=>{
    const cy=top+laneOf(c.groupId)*lane+lane/2+jitter(c.hash)*(lane-10);
    return `<circle cx="${x(c.age).toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius(c.lines).toFixed(1)}"><title>${e(`${c.subject} · ${name(c.groupId)} · authored ${day(c.date)} · ${duration(c.age)} before release · ${f(c.lines)} lines`)}</title></circle>`;
  }).join('');
  const summary=`${entries.length} commits by ${byPerson.size} contributors, placed by how long before ${release.tag} they were authored; median ${duration(median)}.`;
  return `<div class="primary-arrival-wrap"><svg class="primary-arrival" viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(summary)}">
    ${[...lanes.map(name),...(others?['Others']:[])].map((label,i)=>`<text class="lane" x="${left-10}" y="${top+i*lane+lane/2+4}" text-anchor="end">${e(label.length>18?`${label.slice(0,17)}…`:label)}</text><line class="lane-rule" x1="${left}" x2="${right}" y1="${top+(i+1)*lane}" y2="${top+(i+1)*lane}"/>`).join('')}
    ${ticks.map(([d,label])=>`<line class="tick" x1="${x(d)}" x2="${x(d)}" y1="${top}" y2="${top+rows*lane}"/><text class="axis" x="${x(d)}" y="${top+rows*lane+16}" text-anchor="middle">${e(label)}</text>`).join('')}
    ${Number.isFinite(median)?`<line class="median" x1="${x(median)}" x2="${x(median)}" y1="${top-8}" y2="${top+rows*lane}"/><text class="median-label" x="${x(median)}" y="${top-12}" text-anchor="middle">median ${e(duration(median))}</text>`:''}
    <line class="release" x1="${right}" x2="${right}" y1="${top-14}" y2="${top+rows*lane}"/><text class="release-label" x="${right}" y="${top-18}" text-anchor="end">${e(release.tag)} released</text>
    <g class="dots">${dots}</g>
    <text class="axis" x="${left}" y="${H-4}">← authored longer before release (log scale)</text>
  </svg></div>`;
}

/** Every release as one column of age buckets (top = oldest), in time order. Releases outside `matches` are dimmed. */
function fingerprintStrip(index,fingerprints,{selectedHash,matches=null,weight='commits'}={}){
  const releases=index.releases.filter(r=>r.date);
  if(!releases.length)return empty('No dated releases','Import tags to compare release fingerprints.');
  const rowsTopDown=RELEASE_AGE_BUCKETS.map((_,i)=>i).reverse();
  const columns=releases.map(r=>{
    const fp=fingerprints.releases.get(r.hash),dist=fp[weight];
    const cells=rowsTopDown.map(i=>`<i style="opacity:${dist.total?(0.08+0.92*Math.sqrt(dist.buckets[i].share)).toFixed(2):0.04}"></i>`).join('');
    return stripColumn(r,{selectedHash,matches,label:`${shapeLabel(fp.shape)}, median ${duration(dist.median)}`},cells);
  }).join('');
  return `<div class="primary-fp-strip-wrap"><div class="primary-fp-axis" aria-hidden="true"><span>6+ months</span><span>&lt; 1 day</span></div><div class="primary-fp-strip" role="group" aria-label="Release wait fingerprints in time order; darker cells hold more ${weight==='lines'?'lines changed':'commits'}">${columns}</div></div>
    <p class="primary-legend-row"><span>Oldest release → newest</span><span>Each column is one release; darker cells hold more ${weight==='lines'?'lines changed':'commits'} of that age</span>${matches?'<span>Dimmed: outside the current filters</span>':''}</p>`;
}
const stripColumn=(r,{selectedHash,matches,label,tall=0},cells)=>{
  const match=!matches||matches.has(r.hash);
  return `<button type="button" class="primary-fp-col${tall?' primary-fp-tall':''}${r.hash===selectedHash?' selected':''}${match?'':' is-dim'}"${tall?` style="grid-template-rows:repeat(${tall},8px)"`:''} data-action="primary-strip-release" data-hash="${e(r.hash)}" data-match="${match}" aria-pressed="${r.hash===selectedHash}" aria-label="${e(`${r.tag}, ${day(r.date)}: ${label}`)}" title="${e(`${r.tag} · ${day(r.date)} · ${label}`)}">${cells}</button>`;
};

const shapeLabel=key=>RELEASE_SHAPES.find(s=>s.key===key)?.label||'Unmeasured';
const footprintLabel=key=>FOOTPRINT_SHAPES.find(s=>s.key===key)?.label||'Unmeasured';
/** A shape badge is a way in: it opens every release side by side, filtered to that shape. */
const shapeButton=(browse,key,label,note,cls)=>`<button type="button" class="primary-shape ${cls}" data-action="primary-open-shape" data-browse="${browse}" data-shape="${e(key)}" title="${e(`${note} · Show every ${label} release`)}">${e(label)}</button>`;
const shapeBadge=(key,reference)=>shapeButton('wait',key,shapeLabel(key),shapeNote(key,reference),`primary-shape-${e(key)}`);
const footprintBadge=(key,reference)=>shapeButton('footprint',key,footprintLabel(key),footprintNote(key,reference),`primary-footprint-${e(key)}`);
const toggleButton=(key,value,label,current)=>`<button type="button" class="primary-preset ${current===value?'active':''}" data-action="primary-toggle" data-key="${key}" data-value="${value}" aria-pressed="${current===value}">${e(label)}</button>`;
/** An on/off switch: pressed shows all releases pooled behind this one. */
const compareToggle=on=>`<button type="button" class="primary-preset ${on?'active':''}" data-action="primary-toggle" data-key="shapeCompare" data-value="${on?'off':'on'}" aria-pressed="${on}">Compare with all releases</button>`;
/** Shared by both halves of the release shape and by the strips. */
const shapeWeightControl=ui=>`<div class="primary-preset-row" role="group" aria-label="Weight by">${toggleButton('shapeWeight','count','Commits & files',ui.shapeWeight||'count')}${toggleButton('shapeWeight','lines','Lines changed',ui.shapeWeight||'count')}</div>`;
/** A cell shows what it is: a file by its name, a folder by its last segment; the full path is in its tooltip. */
const cellName=cell=>{
  if(cell.key.endsWith('…'))return '… other';
  if(cell.key===cell.top)return '(top level)';
  const parts=cell.key.split('/').filter(Boolean);
  return cell.key.endsWith('/')?`${parts.at(-1)}/`:parts.at(-1);
};

/** A tall map or strip starts clipped to a short height; one setting expands every one of them. */
const collapsible=(html,ui,{tall=true,label='map'}={})=>{
  if(!tall)return html;
  const open=ui?.mapExpanded==='on';
  return `<div class="primary-collapsible${open?' is-expanded':''}"><div class="primary-collapsible-body">${html}</div><button type="button" class="primary-inline-link primary-collapsible-toggle" data-action="primary-toggle" data-key="mapExpanded" data-value="${open?'off':'on'}" aria-expanded="${open}">${open?`Collapse the ${label}`:`Show the whole ${label}`}</button></div>`;
};
/** Above this many tiles a map is taller than the collapsed height. */
const TALL_MAP=24;

/**
 * One fixed map for every release and every scope: top-level blocks, cells
 * (up to three levels deep) sized by all-time activity. With `selected`, the
 * map is a picker: cells and blocks select an area instead of being a picture.
 */
function codebaseMap(map,shares,typical,{weightLabel,subject="this release's",selected=undefined,ui=null}){
  // `subject` is fixed wording chosen by the caller ("this release's", "the scope's authored"), never imported data.
  const picker=selected!==undefined;
  const position=new Map(map.keys.map((key,i)=>[key,i]));
  const max=Math.max(...shares,.0001),maxTypical=typical?Math.max(...typical,.0001):1;
  const top=g=>g.top===OTHER_FOLDERS?`<span class="primary-map-top is-other">${e(g.top)}</span>`:picker?`<button type="button" class="primary-map-top${selected===g.top?' is-selected':''}" data-action="primary-select-area" data-area="${e(g.top)}" aria-pressed="${selected===g.top}" title="Select all of ${e(g.top)}">${e(g.top)}</button>`
    :`<button type="button" class="primary-map-top" data-action="primary-open-area" data-area="${e(g.top)}" title="Open ${e(g.top)} in the codebase explorer">${e(g.top)}</button>`;
  // Each block starts at its share of all-time activity, so busy folders get room for their tiles.
  const total=map.groups.reduce((n,g)=>n+g.touches,0)||1;
  const groups=map.groups.map(g=>`<div class="primary-map-group" style="flex:${g.touches} 1 calc(${(100*g.touches/total).toFixed(1)}% - 6px)">${top(g)}<div class="primary-map-cells">${g.cells.map(cell=>{
    const i=position.get(cell.key),share=shares[i]||0,alpha=share?0.08+0.92*share/max:0;
    const typicalShare=typical?typical[i]||0:null;
    const title=`${cell.label}: ${p(share)} of ${subject} ${weightLabel}${typicalShare!=null?` · all releases ${p(typicalShare)}`:''}`;
    const inner=`<span>${e(cellName(cell))}</span>${typicalShare?`<b style="width:${clamp(typicalShare/maxTypical*100,4,100).toFixed(0)}%"></b>`:''}`;
    const style=`flex-grow:${cell.touches};background:rgba(31,106,73,${alpha.toFixed(2)})`,cls=`primary-map-cell${alpha>.55?' is-strong':''}`;
    return picker?`<button type="button" class="${cls}${selected===cell.key?' is-selected':''}" style="${style}" data-action="primary-select-area" data-area="${e(cell.key)}" aria-pressed="${selected===cell.key}" title="${e(title)}">${inner}</button>`
      :`<div class="${cls}" style="${style}" title="${e(title)}">${inner}</div>`;
  }).join('')}</div></div>`).join('');
  const labels=new Map(map.groups.flatMap(g=>g.cells.map(cell=>[cell.key,cell.label])));
  const ranked=map.keys.map((key,i)=>({key:labels.get(key)||key,share:shares[i],typical:typical?typical[i]:null})).filter(x=>x.share>0).sort((a,b)=>b.share-a.share).slice(0,5);
  return `${collapsible(`<div class="primary-map" ${picker?'role="group" aria-label="Codebase map: select an area"':`role="img" aria-label="${e(`Codebase map: ${ranked.map(x=>`${x.key} ${p(x.share)}`).join(', ')}`)}"`}>${groups}</div>`,ui,{tall:map.keys.length>TALL_MAP})}
    <p class="primary-legend-row"><span><i class="primary-age-key"></i> Darker = more of ${subject} ${e(weightLabel)}</span>${typical?'<span><i class="primary-age-key is-bar"></i> Bar = share across all releases</span>':''}<span>Tile size = all-time activity</span></p>
    ${ranked.length?`<p class="primary-muted primary-map-top-list">Most changed: ${ranked.map(x=>`<strong>${e(x.key)}</strong> ${p(x.share)}${x.typical!=null?` <small>(all releases ${p(x.typical)})</small>`:''}`).join(' · ')}</p>`:''}`;
}

/** Every release as one column of map cells, in time order, grouped by top-level directory. */
function footprintStrip(index,footprints,{selectedHash,matches=null,weight='files',ui=null}={}){
  const releases=index.releases.filter(r=>r.date);
  if(!releases.length)return empty('No dated releases','Import tags to compare release footprints.');
  const {map}=footprints;
  const labels=map.groups.map(g=>`<span style="height:${g.cells.length*9-1}px" title="${e(g.top)}">${e(g.top)}</span>`).join('');
  const columns=releases.map(r=>{
    const fp=footprints.releases.get(r.hash),shares=fp.shares[weight],max=Math.max(...shares,.0001);
    const cells=shares.map(v=>`<i style="opacity:${v?(0.12+0.88*Math.sqrt(v/max)).toFixed(2):0.04}"></i>`).join('');
    return stripColumn(r,{selectedHash,matches,tall:map.keys.length,label:`${footprintLabel(fp.shape)}, ${fp.cells} areas in ${fp.topLevels} top-level directories`},cells);
  }).join('');
  return `${collapsible(`<div class="primary-fp-strip-wrap"><div class="primary-fp-rows" aria-hidden="true">${labels}</div><div class="primary-fp-strip" role="group" aria-label="Release footprints in time order; rows are codebase areas grouped by top-level directory">${columns}</div></div>`,ui,{tall:map.keys.length>TALL_MAP,label:'strip'})}
    <p class="primary-legend-row"><span>Oldest release → newest</span><span>Rows: two-level areas grouped by top-level directory</span>${matches?'<span>Dimmed: outside the current filters</span>':''}</p>`;
}

/**
 * Release shape: when its changes were written and where they landed, with
 * one weighting and one comparison shared by both halves.
 */
function releaseShapePanel(index,r,details,ui){
  const lines=ui.shapeWeight==='lines',compare=(ui.shapeCompare||'on')==='on';
  const view=ui.fingerprintView==='histogram'?'histogram':'arrival';
  const {fingerprint:fp,typical,reference:ref}=details;
  const footprints=releaseFootprints(index),foot=footprints.releases.get(r.hash);
  const waitWeight=lines?'lines':'commits',placeWeight=lines?'lines':'files';
  const dist=fp[waitWeight],typicalShape=typical[waitWeight];
  const fresher=r.baseline?null:fresherThan(dist.median,typicalShape.medians);
  const comparison=fresher==null?(r.baseline?'The first tag is not compared with incremental releases.':'Fewer than five incremental releases to compare with.')
    :`Median wait ${duration(dist.median)}: shorter than ${p(fresher)} of releases${fresher>=.8?' (unusually fresh)':fresher<=.2?' (unusually old work)':''}.`;
  const basis=ref.relative?`Wait shapes compare with all ${f(ref.commits)} commits shipped across ${f(ref.releases)} incremental releases: median wait ${duration(ref.median)}, 90% within ${duration(ref.p90)}.`
    :`Wait shapes use fixed thresholds until there are five incremental releases to compare (${f(ref.releases)} so far).`;
  const waitBody=view==='arrival'?arrivalTimeline(index,r,fp,{weight:waitWeight})
    :releaseAgeChart(dist,{subject:'This release',ghost:compare&&!r.baseline&&typicalShape.releases?typicalShape.shares:null,facts:false});
  const weightLabel=lines?'lines changed':'file touches',{typical:placeTypical,reference:placeRef}=footprints;
  const placeBody=!foot.touches?empty('No file changes to place','This release has no matching file changes in the imported history.')
    :codebaseMap(footprints.map,foot.shares[placeWeight],compare&&!r.baseline&&placeTypical.releases?placeTypical.shares[placeWeight]:null,{weightLabel,ui});
  const byHash=new Map(index.releases.map(x=>[x.hash,x]));
  const similar=r.baseline?[]:similarReleases(r.hash,footprints.releases,{weight:placeWeight});
  return `<div class="primary-inset primary-age-panel primary-shape-panel">
    <div class="primary-fp-head"><div><h4>Release shape</h4><p class="primary-muted">How old its changes were when it shipped, and where in the codebase they landed. Select a shape to see every release like it.</p></div>
      <div class="primary-fp-controls">${shapeWeightControl(ui)}<div class="primary-preset-row">${compareToggle(compare)}</div></div></div>
    <div class="primary-shape-summary"><span>Wait ${shapeBadge(fp.shape,ref)}<small>${e(shapeNote(fp.shape,ref))}</small></span><span>Footprint ${footprintBadge(foot.shape,placeRef)}<small>${e(footprintNote(foot.shape,placeRef))}</small></span></div>
    <section class="primary-shape-part" aria-label="Time to release">
      <div class="primary-shape-part-head"><h5>When its changes were written</h5><div class="primary-preset-row" role="group" aria-label="Wait view">${toggleButton('fingerprintView','arrival','Arrival',view)}${toggleButton('fingerprintView','histogram','Age histogram',view)}</div></div>
      ${waitBody}
      <div class="primary-facts">${stat(duration(dist.median),'Median time to release',`${f(dist.released)} dated commits${lines?` · ${f(dist.total)} lines`:''}`)}${stat(duration(dist.p75),'75% released within')}${stat(duration(dist.p90),'90% released within')}${stat(fresher==null?'—':p(fresher),'Fresher than',fresher==null?'Not enough releases':'Share of releases with a longer median wait')}</div>
      ${caption(`${comparison} ${basis} Elapsed calendar time from each included commit's author time to this release's publication/tag time${lines?', weighted by lines added + deleted':''}. Shapes describe the age of shipped work, not urgency or quality.`)}
      ${r.baseline?'<p class="primary-warning">First tag in the imported history: it ships everything authored before it, so these ages include initial development.</p>':''}
    </section>
    <section class="primary-shape-part" aria-label="Codebase footprint">
      <div class="primary-shape-part-head"><h5>Where they landed</h5><span class="primary-muted">Files, or folders up to five levels deep</span></div>
      ${placeBody}
      <div class="primary-facts">${stat(f(foot.touches),'File touches',placeTypical.touches!=null?`Average release ${f(placeTypical.touches)}`:'')}${stat(f(foot.lines),'Lines changed','Added + deleted')}${stat(f(foot.cells),'Map cells touched','Files, or folders five levels deep')}${stat(f(foot.topLevels),'Top-level directories',placeTypical.topLevels!=null?`Average release ${f(placeTypical.topLevels)}`:'')}</div>
      <div class="primary-similar"><h5>Releases like this one</h5>${similar.length?similar.map(x=>{const other=byHash.get(x.hash);return `<div class="primary-similar-row">${tagButton(index,other)}<small>${e(day(other.date))}</small>${footprintBadge(footprints.releases.get(x.hash).shape,placeRef)}<span>${p(x.similarity)} similar</span></div>`;}).join(''):`<p class="primary-muted">${r.baseline?'The first tag is not compared with incremental releases.':'No other release changed a similar mix of areas.'}</p>`}</div>
      ${caption(`Similarity compares the share of ${weightLabel} in each area (cosine similarity). A footprint shows where changes landed, not their value or risk; renames and generated files can dominate lines changed.`)}
    </section>
  </div>`;
}
/**
 * One place per tab for how to read it: the evidence's clocks and policy,
 * what Git can and cannot show, and the caveats specific to the tab.
 */
const READING_GUIDE={
  observatory:['Tag ancestry defines what a release contains; release events are dated by GitHub publication, an annotated tag or the tagged commit.','The first tag is a baseline that ships all earlier history. Releases with incomplete ancestry, squashes and unmatched publishers need interpretation.','A release lead is the GitHub publisher or tagger, not a claim about who authored its code. Release shapes describe the age and location of shipped work, not its urgency, value or risk.','A GitHub release is not necessarily a production deployment. Environment events come from Heroku and are linked to tags by Git ancestry, not by dates or version numbers.'],
  contributors:['These are measures of recorded activity, not a ranking of performance.','Release participation and leadership are independent roles. A share of commits is not a share of effort, ownership or value.','The contributor table\'s first column follows the Measure above; copy it as CSV for your own analysis. Merge detection uses parent hashes when available (subject heuristics for older logs), and VERSION touches are a repository-specific proxy, not a verified release count.','Times are as recorded by each commit\'s author, in their own time zone; they show when changes were recorded, not hours worked.','A gap means no matching authored records in this import, not absence from work. Working-day patterns are observations, not verified schedules.'],
  codebase:['The map shows files by name down to five levels, and deeper changes under their fifth-level folder; the people grid uses top-level folders. A file touched in several commits counts each time; binary changes count as touches but not lines.','Touching the same files does not establish ownership or direct collaboration.'],
};
export function readingGuide(index,tab){
  const general=index?[`${filterSentence(index)}.`,'Git records changes, not effort, difficulty, value, code quality or working hours. Only the imported, reachable history is visible; uncollected branches and missing dates are not counted.']:[];
  return `<ul>${[...(READING_GUIDE[tab]||[]),...general].map(t=>`<li>${e(t)}</li>`).join('')}</ul>`;
}
const filterSentence=index=>`Git author timestamps for activity · tag/GitHub publication events for releases · ${index.policy.includeMerges?'merges included':'merges excluded'} · ${index.policy.includeReverts?'reverts included':'reverts excluded'}`;

function timelineGrid(bins,lanes,{action='primary-bin',dateAttr='data-bin',title='Chronological observations'}={}) {
  if(!bins.length)return empty('Nothing to plot yet','There are no recorded events in this time span.');
  const max=Math.max(1,...bins.map(b=>b.count??b.commits??0));
  const peopleMax=Math.max(1,...bins.map(b=>b.people??0));
  const areaMax=Math.max(1,...bins.map(b=>b.areas??0));
  const values={count:max,commits:max,people:peopleMax,areas:areaMax,drivers:Math.max(1,...bins.map(b=>b.drivers??0))};
  return `<div class="primary-landscape" aria-label="${e(title)}"><div class="primary-lane-labels">${lanes.map(l=>`<span>${e(l.label)}</span>`).join('')}<span class="primary-landscape-time">Earlier → Recent</span></div><div class="primary-landscape-scroll"><div class="primary-landscape-columns" style="--bars:${bins.length}">${bins.map(b=>`<button type="button" class="primary-landscape-column" data-action="${action}" ${dateAttr}="${e(b.key)}" title="${e(`${b.key}: ${b.count??b.commits??0} ${lanes[0].label.toLowerCase()}; select this period`)}" aria-label="${e(`Inspect ${b.key}`)}">${lanes.map(l=>`<span class="primary-landscape-slot"><i style="height:${b[l.key]>0?clamp(6+94*b[l.key]/(values[l.key]||1),6,100):0}%" class="${e(l.className||'')}"></i></span>`).join('')}<small>${e(b.key)}</small></button>`).join('')}</div></div></div>`;
}

function releaseAnatomy(index,selectedHash,ui){
  const details=releaseDetails(index,selectedHash);
  if(!details)return empty('Select a release','Choose a tag in the landscape or release index to see its complete contents.');
  const {release:r,commits}=details;
  const rows=r.members.filter(m=>m.commits>0).sort((a,b)=>b.commits-a.commits);
  const total=Math.max(1,r.eligibleIntroduced);
  const people=rows.slice(0,12).map(m=>`<div class="primary-person-row"><span>${whoButton(index,m.id)}${r.driver.groupId===m.id?'<span class="primary-driver-chip">Led release</span>':''}</span>${bar(m.commits,total)}<strong>${f(m.commits)}</strong><small>${p(m.commits/total)}</small></div>`).join('');
  const areas=r.areaTouches.slice().sort((a,b)=>b[1]-a[1]).slice(0,10);
  const maxArea=Math.max(1,...areas.map(x=>x[1]));
  const counts=Object.entries(r.categoryCounts).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return `<section class="primary-anatomy primary-panel" id="primary-release-anatomy" tabindex="-1">
    <div class="primary-anatomy-head"><div><span class="primary-eyebrow">RELEASE ANATOMY · COMPLETE TAG ANCESTRY</span><h3>${e(r.tag)}</h3><p>${e(r.github?.title&&r.github.title!==r.tag?r.github.title:'Tagged delivery snapshot')} · ${e(day(r.date))} · ${e(type(r.kind))}</p></div><div class="primary-anatomy-actions"><span class="primary-kind">${e(type(r.kind))}</span>${r.github?.url&&/^https:\/\/github\.com\//.test(r.github.url)?`<a href="${e(r.github.url)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`:''}</div></div>
    <div class="primary-facts">${stat(r.baseline?'Baseline':f(r.eligibleIntroduced),'Included commits',r.baseline?'Not an incremental release':r.totalIntroduced!==r.eligibleIntroduced?'Commit policy excludes some records':'Git tag-defined')}${stat(f(r.contributors),'Contributors')}${stat(f(r.areas),'Codebase areas')}${stat(f(r.paths),'Distinct paths')}</div>
    <div class="primary-inspector-context"><span><strong>Lead:</strong> ${r.driver.groupId!=null?whoButton(index,r.driver.groupId):e(r.driver.name||'Not identified')}</span><span><strong>Previous tag:</strong> ${e(r.previousTag||'No preceding tagged ancestor')}</span><span><strong>Date source:</strong> ${e(r.dateSource||'Unknown')}</span></div>
    ${!r.lineageComplete?'<p class="primary-warning">Ancestry is incomplete in the imported refs. Introduced-change counts may be incomplete.</p>':''}
    <div class="primary-two-col"><div class="primary-inset"><h4>Who authored its changes?</h4>${people||empty('No matching included changes','Check the merge/revert policy and imported refs.')}${rows.length>12?`<p class="primary-muted">${rows.length-12} further contributors; use Explore Evidence for the full matrix.</p>`:''}<p class="primary-muted">Commit share uses the complete included release (under the stated commit policy). The lead role is independent.</p></div><div class="primary-inset"><h4>Where did they land?</h4>${areas.map(([name,count])=>`<div class="primary-area-row"><a href="${href(index,{view:'codebase',area:name})}" data-action="primary-open-area" data-area="${e(name)}">${e(name)}</a>${bar(count,maxArea)}<span>${f(count)}</span></div>`).join('')||'<p class="primary-muted">No files in this release.</p>'}<h4 class="primary-subtitle">Recorded change categories</h4><div class="primary-tags">${counts.map(([k,v])=>`<span>${e(k)} · ${f(v)}</span>`).join('')||'No categories recorded'}</div><p class="primary-muted">Categories are inferred from commit subjects, not verified intent.</p></div></div>
    ${releaseShapePanel(index,r,details,ui)}
    ${deploymentReleasePanel(index,r)}
    ${r.github?.body?`<details class="primary-notes"><summary>Read published release notes</summary>${markdownFrame(r.github.body,{title:`Release notes for ${r.tag}`})}</details>`:''}
    <details class="primary-notes"><summary>Inspect ${f(r.commits.length)} included commits (latest 40 shown)</summary><div class="primary-commit-list">${commits.map(c=>`<div><code>${e(c.hash.slice(0,8))}</code><span>${e(day(c.date))}</span>${whoButton(index,c.groupId)}<span class="primary-commit-subject">${e(c.subject)}</span></div>`).join('')||'<p>No matching commit detail in imported history.</p>'}</div></details>
    <div class="primary-card-footer"><a class="button soft" href="${href(index,{view:'observatory',from:r.date?shiftDate(r.date,-6):null,to:r.date?shiftDate(r.date,7):null})}" data-action="primary-release-period" data-date="${e(r.date||'')}">Explore surrounding fortnight →</a><button type="button" class="button outline" data-action="primary-evidence-release" data-hash="${e(r.hash)}">See it on the timeline</button></div>
  </section>`;
}

/** Ways to browse releases. Every one of them picks the release shown below it. */
const BROWSE_MODES=[{key:'list',label:'List'},{key:'timeline',label:'Timeline'},{key:'groups',label:'Groups'},{key:'people',label:'People'},{key:'followup',label:'Follow-up'},{key:'wait',label:'Wait shapes'},{key:'footprint',label:'Footprints'}];
/** Views the impact explorer provides; app.js moves it into the slot they render. */
const IMPACT_CAPTIONS={
  timeline:'Release events with the scope\'s authored contributions. Select a marker to open that release below.',
  people:'Who led and who authored each release, for the people in scope. Select a release to open it below.',
  followup:'How many of each release\'s changed paths were revisited afterwards. Select a release to open it below.',
};

function observatory(index,ui){
  const all=releaseLandscape(index);
  if(!all.total)return `${empty('No matched release tags','Re-import reachable Git tags to enable the release-first perspective. You can still explore authored activity in Rhythm.')}`;
  const years=[...new Set(all.releases.map(r=>r.date.slice(0,4)))].reverse();
  const fingerprints=releaseFingerprints(index),shapeOf=r=>fingerprints.releases.get(r.hash)?.shape||'unmeasured';
  const shapeCounts=new Map();for(const r of all.releases)shapeCounts.set(shapeOf(r),(shapeCounts.get(shapeOf(r))||0)+1);
  const footprints=releaseFootprints(index),footprintOf=r=>footprints.releases.get(r.hash)?.shape||'unmeasured';
  const footprintCounts=new Map();for(const r of all.releases)footprintCounts.set(footprintOf(r),(footprintCounts.get(footprintOf(r))||0)+1);
  const list=all.releases.filter(r=>(ui.releaseType==='all'||r.kind===ui.releaseType)&&(!ui.releaseShape||ui.releaseShape==='all'||shapeOf(r)===ui.releaseShape)&&(!ui.releaseFootprint||ui.releaseFootprint==='all'||footprintOf(r)===ui.releaseFootprint)&&(ui.releaseYear==='all'||r.date.startsWith(ui.releaseYear))&&(String(r.tag).toLowerCase().includes((ui.releaseQuery||'').toLowerCase()))).reverse();
  const browse=BROWSE_MODES.some(m=>m.key===ui.releaseBrowse)?ui.releaseBrowse:'timeline';
  const filtered=list.length!==all.releases.length;
  const pages=Math.max(1,Math.ceil(list.length/24)),page=clamp(ui.releasePage||0,0,pages-1);
  const shown=list.slice(page*24,page*24+24);
  // Views other than the list can open a release outside the filters.
  const chosen=list.find(r=>r.hash===ui.releaseHash)||(browse!=='list'?all.releases.find(r=>r.hash===ui.releaseHash):null)||list[0]||null;
  const med=all.medianInterval;
  const cadence=all.releases.length>=12&&all.previousCadence!=null&&all.recentCadence!=null&&Math.abs(all.recentCadence-all.previousCadence)>=Math.max(2,all.previousCadence*.25)
    ?` The median gap between releases changed from ${f(all.previousCadence)} to ${f(all.recentCadence)} days between the earlier and later halves of the history.`:'';
  const summary=`<p class="primary-browse-summary">${f(all.total)} tagged releases · ${f(all.contributors)} contributors · ${f(all.drivers)} matched release leads${med==null?'':` · a median ${f(med)} ${med===1?'day':'days'} apart`}.${e(cadence)}</p>`;
  const switcher=`<div class="primary-row between primary-browse-head"><div class="primary-preset-row" role="group" aria-label="Show releases as">${BROWSE_MODES.map(m=>toggleButton('releaseBrowse',m.key,m.label,browse)).join('')}</div>${browse==='wait'||browse==='footprint'?shapeWeightControl(ui):''}</div>`;
  const filters=`<div class="primary-controls primary-release-controls"><label>Kind ${select('primary-release-type',[{label:'All release kinds',value:'all'},...all.types.map(([k,v])=>({label:`${type(k)} (${f(v)})`,value:k}))],ui.releaseType)}</label><label>Wait shape ${select('primary-release-shape',[{label:'All wait shapes',value:'all'},...RELEASE_SHAPES.filter(x=>shapeCounts.has(x.key)).map(x=>({label:`${x.label} (${f(shapeCounts.get(x.key))})`,value:x.key}))],ui.releaseShape||'all')}</label><label>Footprint ${select('primary-release-footprint',[{label:'All footprints',value:'all'},...FOOTPRINT_SHAPES.filter(x=>footprintCounts.has(x.key)).map(x=>({label:`${x.label} (${f(footprintCounts.get(x.key))})`,value:x.key}))],ui.releaseFootprint||'all')}</label><label>Year ${select('primary-release-year',[{value:'all',label:'All years'},...years.map(y=>({value:y,label:y}))],ui.releaseYear)}</label><label>Find a tag <input id="primary-release-query" class="primary-input" placeholder="Filter tag names…" value="${e(ui.releaseQuery||'')}"></label></div>`;
  const matches=filtered?new Set(list.map(r=>r.hash)):null;
  const body=browse==='list'?`<div class="primary-release-list">${shown.map(r=>`<div class="primary-release-row${r.hash===chosen?.hash?' selected':''}"><a href="${href(index,{view:'observatory',release:r.hash})}" class="primary-release-entry" data-action="primary-select-release" data-hash="${e(r.hash)}" ${r.hash===chosen?.hash?'aria-current="true"':''}><span class="primary-release-symbol">${r.kind==='major'?'◆':r.kind==='minor'?'◈':'●'}</span><strong>${e(r.tag)}</strong><small>${e(day(r.date))}</small><span>${f(r.eligibleIntroduced)} commits</span><span>${f(r.contributors)} people</span><em>${e(type(r.kind))}</em></a><span class="primary-shape-stack">${shapeBadge(shapeOf(r),fingerprints.reference)}${footprintBadge(footprintOf(r),footprints.reference)}</span></div>`).join('')||empty('No releases match','Change the year, type or tag search.')}</div><div class="primary-row between"><span class="primary-muted">${f(list.length)} matching · page ${page+1} of ${pages}</span><div class="primary-pager"><button data-action="primary-release-page" data-page="${page-1}" ${page===0?'disabled':''}>← Newer</button><button data-action="primary-release-page" data-page="${page+1}" ${page>=pages-1?'disabled':''}>Older →</button></div></div>`
    :browse==='wait'||browse==='footprint'?`<div class="primary-browse-strip">${browse==='wait'?fingerprintStrip(index,fingerprints,{selectedHash:chosen?.hash,matches,weight:ui.shapeWeight==='lines'?'lines':'commits'}):footprintStrip(index,footprints,{selectedHash:chosen?.hash,matches,weight:ui.shapeWeight==='lines'?'lines':'files',ui})}</div><p class="primary-muted">${f(list.length)} of ${f(all.releases.length)} releases match the filters. Select a column to open that release below.</p>`
    :browse==='groups'?releaseGroups(index,all,ui)
    :`<p class="primary-muted">${e(IMPACT_CAPTIONS[browse])}</p>${slot('impact',` data-mode="${browse}"`)}`;
  const browseCard=`<div id="primary-browse-releases" tabindex="-1">${card('Browse releases',`${summary}${switcher}${filters}${body}`)}</div>`;
  // Environments only appears when deployment history was imported.
  const deployed=!!index.deployments?.available;
  const releaseView=ui.releaseView==='environments'&&deployed?'environments':'browse';
  const viewSwitch=deployed?`<div class="primary-preset-row primary-view-switch" role="group" aria-label="Releases view">${toggleButton('releaseView','browse','Browse releases',releaseView)}${toggleButton('releaseView','environments','Environments',releaseView)}</div>`:'';
  if(releaseView==='environments')return `${viewSwitch}${deploymentOverviewPanel(index)}${deploymentExplorer(index,ui)}${deploymentPeriodPanel(index,ui)}`;
  const anatomy=chosen?releaseAnatomy(index,chosen.hash,ui):empty('No release in this filter','Change the year, type, wait shape, footprint or tag filter to choose a release.');
  // The list stays beside the release it opens; wider views take the full width above it.
  return `${viewSwitch}${browse==='list'?`<div class="primary-release-browse"><div class="primary-release-sidebar">${browseCard}</div><div class="primary-release-detail">${anatomy}</div></div>`:`${browseCard}${anatomy}`}
    <div id="releases-over-time" tabindex="-1">${scopeTimelineCard(index,ui)}</div>`;
}

/** Groups of comparable releases (by version transition, lead or year); a group narrows the list. */
function releaseGroups(index,all,ui){
  const cohortBy=['type','driver','year'].includes(ui.cohortBy)?ui.cohortBy:'type';
  const labelForCohort=r=>cohortBy==='driver'
    ? r.driver.groupId!=null ? index.groups.find(g=>g.id===r.driver.groupId)?.displayName||'Unknown lead'
      : r.driver.name ? `Unmatched: ${r.driver.name}` : 'Lead unknown'
    : cohortBy==='year'?r.date.slice(0,4):r.kind;
  const grouped=new Map();for(const r of all.releases.filter(r=>!r.baseline)){
    const k=labelForCohort(r),a=grouped.get(k)||[];a.push(r);grouped.set(k,a);
  }
  const cohorts=[...grouped].sort((a,b)=>b[1].length-a[1].length).slice(0,8);
  const median=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);const i=Math.floor(a.length/2);return a.length?(a.length%2?a[i]:(a[i-1]+a[i])/2):null;};
  const narrow=key=>cohortBy==='type'?`<button class="primary-inline-link" type="button" data-action="primary-filter-release-type" data-type="${e(key)}">List these releases</button>`
    :cohortBy==='year'?`<button class="primary-inline-link" type="button" data-action="primary-filter-release-year" data-year="${e(key)}">List these releases</button>`:'';
  return `<div class="primary-row between"><p class="primary-muted">Typical size and breadth of comparable incremental releases (baselines excluded). Composition, not a ranking.</p><label>Group by ${select('primary-cohort-by',[{value:'type',label:'Version transition'},{value:'driver',label:'Matched / recorded lead'},{value:'year',label:'Release year'}],cohortBy)}</label></div><div class="primary-cohorts">${cohorts.map(([key,rs])=>`<div class="primary-cohort"><span>${e(cohortBy==='type'?type(key):key)}</span><strong>${f(rs.length)} releases</strong><small>Median ${f(median(rs.map(r=>r.eligibleIntroduced)))} commits · ${f(median(rs.map(r=>r.contributors)))} contributors · ${f(median(rs.map(r=>r.areas)))} areas</small>${narrow(key)}</div>`).join('')}</div>${grouped.size>cohorts.length?`<p class="primary-muted">Showing ${cohorts.length} of ${grouped.size} groups.</p>`:''}`;
}

const delta=(now,old,unit='')=>old==null?'':`<small class="primary-delta">Previous: ${f(old)}${e(unit)} · ${now===old?'no change':`${now>old?'+':''}${f(now-old)}${e(unit)}`}</small>`;
/** Where a detailed section (rendered by app.js) is placed in a view's reading order. */
const slot=(name,attrs='')=>`<div class="primary-slot" data-slot="${name}"${attrs}></div>`;
/** Every section of a page is shown in order; this "On this page" bar jumps to one. */
const sectionNav=(label,items)=>`<nav class="primary-section-nav" aria-label="${e(label)}: jump to a section">${items.map(([id,text])=>`<a href="#${id}" data-action="primary-jump" data-target="${id}">${e(text)}</a>`).join('')}</nav>`;
const sectionHeading=(id,title,intro='')=>`<h2 class="primary-section-title" id="${id}" tabindex="-1">${e(title)}</h2>${intro?`<p class="primary-lede">${e(intro)}</p>`:''}`;

/** The scope's people and dates, as set in the app's scope bar (all people when `ids` is null). */
const scopeOf=(index,ui)=>({from:ui.periodFrom,to:ui.periodTo,ids:index.navigation?.scope?.ids||null});
const scopeDigest=(index,ui,options={})=>{
  const scope=scopeOf(index,ui);
  return periodDigest(index,{from:scope.from,to:scope.to},{comparison:'none',selectedIds:scope.ids,...options});
};

/**
 * Headline facts for the scope bar, with changes against the comparison
 * window when that window lies inside the imported history.
 */
export function scopeHeadline(index,ui){
  const digest=scopeDigest(index,ui,{comparison:ui.periodComparison,customComparison:{from:ui.compareFrom,to:ui.compareTo}});
  if(!digest)return '';
  const {summary:s,events,comparison:prev}=digest;
  const comparable=!!prev&&digest.comparisonComparable;
  const fact=(value,label,prior,note)=>`<div class="primary-stat"><strong>${e(f(value))}</strong><span>${e(label)}</span>${comparable?delta(value,prior):note?`<small>${e(note)}</small>`:''}</div>`;
  const insights=[];
  if(comparable&&s.spanDays>=7&&prev.window.days>=7){
    const diffRates=s.commits/s.spanDays-prev.summary.commits/prev.window.days;
    if(Math.abs(diffRates)>=.3&&Math.max(s.commits,prev.summary.commits)>=8)insights.push(`Recorded author activity changed from ${f(prev.summary.commits*7/prev.window.days)} to ${f(s.commits*7/s.spanDays)} commits per calendar week.`);
    if(Math.abs(events.releases-prev.events.releases)>=2)insights.push(`${events.releases} release events, compared with ${prev.events.releases} in the comparison window.`);
  }
  const against=!prev?'':comparable?`Compared with ${day(prev.window.from)} – ${day(prev.window.to)}.`:'The comparison window extends beyond imported history, so no change is shown.';
  const coverage=digest.coverage.startsBeforeHistory||digest.coverage.endsAfterHistory?' Part of the scope falls outside the imported history.':'';
  return `<div class="primary-facts">${fact(s.commits,'Authored commits',prev?.summary.commits,`${s.activeDays} active dates`)}${fact(s.people.length,'People authoring',prev?.summary.people.length)}${fact(events.releases,'Release events',prev?.events.releases,'Contents can predate the scope')}${fact(s.areas.length,'Areas touched',prev?.summary.areas.length)}</div>
    ${against||coverage||insights.length?`<p class="scope-headline-note">${e(against+coverage)}${insights.map(t=>` <strong>${e(t)}</strong>`).join('')}</p>`:''}`;
}

/** The scope's authored commits, people and releases unfolding over time, with bucket drill-down. */
function scopeTimelineCard(index,ui){
  const digest=scopeDigest(index,ui);
  if(!digest)return empty('Check your dates','The start date must be on or before the end date.');
  const {timeline,releases}=digest,{from,to,ids}=scopeOf(index,ui);
  const people=ids?new Set(ids):null;
  const bucket=timeline.buckets.find(b=>b.key===ui.periodBucket);
  const bucketKey=date=>timeline.granularity==='day'?date:timeline.granularity==='week'?dateAtWeek(date):date.slice(0,7);
  const bucketCommits=bucket?index.activity.filter(c=>c.date>=from&&c.date<=to&&(!people||people.has(c.groupId))&&bucketKey(c.date)===bucket.key).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14):[];
  const bucketReleases=bucket?releases.filter(r=>bucketKey(r.date)===bucket.key):[];
  return `${card('The scope, unfolding',`<p class="primary-muted">${e(day(from))} – ${e(day(to))}, in ${e(timeline.granularity)} buckets. Select a bucket to inspect its commits and releases.</p>${timelineGrid(timeline.buckets.map(b=>({...b,count:b.commits,areas:b.releases.length})),[{label:'Authored commits',key:'commits'},{label:'Contributors',key:'people',className:'alt'},{label:'Release events',key:'areas',className:'gold'}],{action:'primary-period-bin',dateAttr:'data-bin',title:'Authored and release events in the scope'})}${bucket?`<div class="primary-inset"><div class="primary-row between"><h4>${e(bucket.key)} · ${f(bucket.commits)} authored commits · ${f(bucket.releases.length)} release events</h4><button class="primary-inline-link" data-action="primary-period-reset" type="button">Close</button></div><div class="primary-bucket-events">${bucketReleases.slice(0,12).map(r=>`<span>${tagButton(index,r)}</span>`).join('')}${bucketCommits.map(c=>`<div><code>${e(c.hash.slice(0,8))}</code> ${whoButton(index,c.groupId)} · ${e(c.subject)}</div>`).join('')||'<p>No authored commits in this bucket for the people in scope.</p>'}</div></div>`:''}`)}`;
}

/**
 * Who works where: file touches per person and top-level area, on the
 * Codebase tab's clock. A narrowed scope adds everyone else as context.
 */
function whoWhereCard(index,ui,{commits,clock,from,to,ids}){
  const grid=personAreaTouches(commits);
  const people=grid.people.slice(0,10),areas=grid.areas.slice(0,9);
  const scale=makeIntensityScale([...grid.cells.values()].flatMap(row=>[...row.values()]));
  const everyone=ids?new Map(personAreaTouches(codebaseCommits(index,{from,to,clock})).areas):null;
  const scoped=new Map(grid.areas);
  const focus=ui.periodFocusPerson&&ui.periodFocusArea?commits.filter(c=>c.groupId===ui.periodFocusPerson&&c.files.some(file=>file.area===ui.periodFocusArea)):[];
  return card('Who works where',`<p class="primary-muted">${clock==='released'?'Released':'Authored'} file touches per person and top-level area. Select a cell to list the commits behind it.</p>${people.length&&areas.length?`<div class="primary-matrix-scroll"><table class="primary-heat-table"><thead><tr><th>Contributor</th>${areas.map(([a])=>`<th><button type="button" class="primary-inline-link" data-action="primary-select-area" data-area="${e(a)}">${e(a)}</button></th>`).join('')}</tr></thead><tbody>${people.map(([id])=>`<tr><th>${whoButton(index,id)}</th>${areas.map(([area])=>{const value=grid.cells.get(id)?.get(area)||0;return `<td><button type="button" data-action="primary-period-cell" data-person="${e(id)}" data-area="${e(area)}" style="${intensityStyle(value,scale)}" title="${e(`${value} ${clock} file touches in ${area}`)}">${f(value)}</button></td>`;}).join('')}</tr>`).join('')}${everyone?`<tr class="primary-heat-others"><th>Everyone else</th>${areas.map(([area])=>{const value=(everyone.get(area)||0)-(scoped.get(area)||0);return `<td><span title="${e(`${value} ${clock} file touches in ${area} by people outside the scope`)}">${f(value)}</span></td>`;}).join('')}</tr>`:''}</tbody></table></div><div class="primary-colour-legend">${intensityLegend(scale)}</div>`:empty('No comparable cells','No file touches recorded in this scope.')}${ui.periodFocusPerson&&ui.periodFocusArea?`<div class="primary-selected-evidence" id="primary-who-where-detail"><h4>${e(index.groups.find(g=>g.id===ui.periodFocusPerson)?.displayName||'Contributor')} · ${e(ui.periodFocusArea)}</h4><p>${focus.length} matching commits · first 14 shown</p>${focus.slice(0,14).map(c=>`<div><code>${e(c.hash.slice(0,8))}</code><span>${e(c.date)}</span> ${e(c.subject)}</div>`).join('')||'<p>No matching commits.</p>'}</div>`:''}`);
}

function weekHeatmap(slots,options={shape:true}){
  const total=slots.flat().reduce((a,b)=>a+b,0);
  const values=slots.flat().map(v=>options.shape&&total?100*v/total:v);
  const scale=makeIntensityScale(values);
  const labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return `<div class="primary-week-heat" role="img" aria-label="Seven weekday rows, 24 hourly columns; ${options.shape?'share of timed commits':'absolute timed commits'}"><div class="primary-hour-ruler"><span></span>${[0,6,12,18,23].map(h=>`<span>${String(h).padStart(2,'0')}</span>`).join('')}</div>${slots.map((row,d)=>`<div class="primary-hour-row"><strong>${labels[d]}</strong><div>${row.map((value,h)=>`<i style="${intensityStyle(options.shape&&total?100*value/total:value,scale)}" title="${e(`${labels[d]} ${h}:00 · ${value} timed commits${total?` (${(100*value/total).toFixed(1)}%)`:''}`)}"></i>`).join('')}</div></div>`).join('')}</div><p class="primary-muted">${f(total)} timed commits · ${options.shape?'each grid normalised within its contributor':'absolute counts'} · recorded author-local hours</p>`;
}

function coReleasePanel(index,focus,window,ui) {
  const model=coReleasePatterns(index,focus,window);
  const people=model.partners.filter(r=>r.shared>0);
  const sorted=people.slice().sort(ui.coReleaseSort==='overlap'
    ? (a,b)=>(b.overlap??0)-(a.overlap??0)||b.shared-a.shared||a.name.localeCompare(b.name)
    : (a,b)=>b.shared-a.shared||(b.overlap??0)-(a.overlap??0)||a.name.localeCompare(b.name));
  const chosen=model.partners.find(r=>r.id===ui.coReleasePartner)||sorted[0]||model.partners[0];
  const examples=chosen?coReleaseEvidence(index,focus,chosen.id,window):[];
  const myName=index.groups.find(g=>g.id===focus)?.displayName||'Selected contributor';
  const eligibleNote=model.omitted?` ${model.omitted} baseline or incomplete-lineage tag events excluded.`:'';
  return card('People who appear in the same tagged releases',`<p class="primary-muted">Each shared release contains eligible authored commits from <strong>both</strong> contributors. The observation window selects <strong>release events</strong>; no authored-date cutoff is applied to the included commits. Release drivers are shown separately. Co-participation does not establish direct collaboration.${e(eligibleNote)}</p>
    <div class="primary-facts">${stat(f(model.eligible),'Comparable releases')}${stat(f(model.mine),'Releases with '+myName)}${stat(f(model.withPartners),'Other contributors sharing ≥1 release')}</div>
    <div class="primary-controls"><label>Rank connections ${select('primary-together-sort',[{value:'shared',label:'Most shared releases'},{value:'overlap',label:'Greatest overlap (Jaccard)'}],ui.coReleaseSort)}</label><label>Inspect a contributor ${select('primary-together-partner',[{value:'',label:'Select a contributor'},...model.partners.map(row=>({value:row.id,label:row.name}))],chosen?.id||'')}</label></div>
    ${sorted.length?`<div class="primary-co-release-list">${sorted.slice(0,16).map(row=>`<button type="button" class="primary-co-release-row ${row.id===chosen?.id?'active':''}" data-action="primary-co-release-partner" data-person="${e(row.id)}" aria-pressed="${row.id===chosen?.id}"><span><strong>${e(row.name)}</strong><small>${p(row.ofMine)} of ${e(myName)}'s contributing releases</small></span>${bar(row.shared,Math.max(1,sorted[0]?.shared||0))}<strong>${f(row.shared)}</strong><small>shared</small></button>`).join('')}</div>${sorted.length>16?`<p class="primary-muted">Showing 16 of ${f(sorted.length)} connections. Choose any contributor above to inspect their overlap.</p>`:''}`:empty('No shared release contributions',model.mine?'No other contributor authored a change in the same comparable tagged releases.':'This contributor has no authored participation in comparable tagged releases in this window.')}
    ${chosen?`<div id="primary-co-release-detail" class="primary-co-release-detail"><div class="primary-co-release-detail-heading"><div><span class="primary-eyebrow">PAIR EVIDENCE</span><h4>${e(myName)} <span class="primary-co-release-symbol">&amp;</span> ${e(chosen.name)}</h4></div></div><div class="primary-facts">${stat(f(chosen.shared),'Shared releases')}${stat(p(chosen.ofMine),'Of '+myName+' releases')}${stat(p(chosen.ofTheirs),'Of '+chosen.name+' releases')}${stat(p(chosen.overlap),'Jaccard overlap','Shared ÷ releases involving either person')}</div><p class="primary-muted">${e(myName)} appears in ${f(model.mine)} comparable releases; ${e(chosen.name)} appears in ${f(chosen.theirs)}. Shared ÷ union is symmetric. The two conditional percentages have different denominators.</p>
      ${examples.length?`<div class="primary-table-wrap"><table class="primary-co-release-tags"><thead><tr><th>Tag</th><th>Published / tagged</th><th>${e(myName)} commits</th><th>${e(chosen.name)} commits</th><th>Release lead</th></tr></thead><tbody>${examples.slice(0,24).map(r=>`<tr><td>${tagButton(index,r)}</td><td>${e(day(r.date))}</td><td>${f(r.firstCommits)}</td><td>${f(r.secondCommits)}</td><td>${e(r.driverId===focus?myName:r.driverId===chosen.id?chosen.name:r.driverId==null?'Unmatched':index.groups.find(g=>g.id===r.driverId)?.displayName||'Another contributor')}</td></tr>`).join('')}</tbody></table></div>${examples.length>24?`<p class="primary-muted">Latest 24 of ${f(examples.length)} shared releases. Select any tag to inspect the complete release.</p>`:''}`:empty('No shared releases','There are no comparable tagged releases containing authored changes by both contributors.')}</div>`:''}
    <p class="primary-muted">Baseline and incomplete-lineage tags are excluded from comparison; these can inflate apparent overlap. Drivers are credited only when the publisher identity is matched. All percentages are evidence descriptions, not performance assessments.</p>`);
}
function coReleaseComparison(index, compared, window) {
  const pairs=[];
  for(let i=0;i<compared.length;i++)for(let j=i+1;j<compared.length;j++){
    const a=compared[i],b=compared[j];
    const row=coReleasePatterns(index,a.id,window).partners.find(x=>x.id===b.id);
    if(row)pairs.push({a,b,row});
  }
  if(!pairs.length)return '';
  return card('Who appears in releases together?',`<p class="primary-muted">Pairwise participation across the same comparable incremental tagged releases. The overlap measure is symmetric (shared releases ÷ the union); conditional percentages reveal how often each person appears with the other.</p><div class="primary-table-wrap"><table class="primary-compare-table"><thead><tr><th>Pair</th><th>Shared</th><th>Overlap</th><th>Of first</th><th>Of second</th><th>Evidence</th></tr></thead><tbody>${pairs.map(({a,b,row})=>`<tr><th>${e(a.name)} + ${e(b.name)}</th><td>${f(row.shared)}</td><td>${p(row.overlap)}</td><td>${p(row.ofMine)}</td><td>${p(row.ofTheirs)}</td><td><a class="primary-inline-link" href="${href(index,{view:'contributors',person:index.groups.find(g=>g.id===a.id)?.emails?.[0],partner:index.groups.find(g=>g.id===b.id)?.emails?.[0],tab:'together'})}" data-action="primary-open-co-release-pair" data-first="${e(a.id)}" data-second="${e(b.id)}">Inspect tags ↗</a></td></tr>`).join('')}</tbody></table></div><p class="primary-muted">Co-release means shared delivery participation, not proof of collaboration or code-review interaction.</p>`);
}
/**
 * People: everyone first (who contributed and how much, how that moved over
 * time, and when and how steadily work is recorded), then one person.
 */
function peopleView(index,ui){
  return `${sectionNav('People',[['people-contribution','Contribution'],['people-over-time','Over time'],['people-patterns','Working patterns'],['people-portrait','One person']])}
    ${sectionHeading('people-contribution','Contribution','Who contributed and how much, on one measure for everyone in scope.')}
    ${slot('measure')}${slot('stats')}${slot('insight')}${slot('ranking')}${slot('table')}${slot('sizes')}
    ${sectionHeading('people-over-time','Over time','How each person\'s recorded activity moves through the scope.')}
    ${slot('trend')}${slot('pulse')}
    ${sectionHeading('people-patterns','Working patterns','When in the week and the year work is recorded, and how steadily.')}
    ${slot('rhythm')}
    ${sectionHeading('people-portrait','One person','A reconciled person\'s release portfolio, collaborators, focus and changing involvement.')}
    ${contributorView(index,ui)}`;
}
function contributorView(index,ui){
  const full={from:index.bounds.min,to:index.bounds.max};
  const window=ui.contributorRange==='period' ? {from:ui.periodFrom,to:ui.periodTo} : ui.contributorRange==='year' ? windowOf(index,365) : full;
  const focus=index.groups.find(g=>g.id===ui.contributorFocus)?.id??index.groups[0]?.id;
  if(focus==null)return empty('No reconciled contributors','Import authored history to explore individual profiles.');
  const person=contributorPortrait(index,focus,window);
  const options=index.groups.map(g=>({value:g.id,label:g.displayName}));
  const mode=ui.contributorTab||'delivery';
  const involvement=person.involvement.slice(0,28);
  const selectedIds=unique([focus,ui.compareB,ui.compareC].filter(id=>index.groups.some(g=>g.id===id)));
  const compared=selectedIds.map(id=>contributorPortrait(index,id,window)).filter(Boolean);
  const tab=(id,label)=>`<button type="button" data-action="primary-contributor-tab" data-tab="${id}" class="${mode===id?'active':''}" aria-pressed="${mode===id}">${label}</button>`;
  const months=person.months;
  const yearRows=[...months.reduce((m,row)=>{const y=row.key.slice(0,4);if(!m.has(y))m.set(y,{year:y,commits:0,releases:0,driven:0,areas:0,months:0});const a=m.get(y);a.commits+=row.commits;a.releases+=row.releases;a.driven+=row.driven;a.months++;a.areas=Math.max(a.areas,row.areas);return m;},new Map()).values()];
  const maxCommits=Math.max(1,...months.map(m=>m.commits));
  const areas=person.profile.areas.slice(0,12),maxAreas=Math.max(1,...areas.map(x=>x[1]));
  return `${card('Select a contributor',`<div class="primary-controls"><label>Contributor ${select('primary-contributor-focus',options,focus)}</label><label>Observation window ${select('primary-contributor-range',[{value:'all',label:'Entire imported history'},{value:'year',label:'Latest 365 days'},{value:'period',label:'The scope dates'}],ui.contributorRange)}</label><button type="button" class="button outline" data-action="primary-contributor-tab" data-tab="compare">Compare people ↗</button></div><p class="primary-muted">${e(window.from)} to ${e(window.to)} · activity uses authored dates; release involvement uses release-event dates. ${person.emails.length} merged author identities.</p>`)}
    <div class="primary-person-hero"><span class="primary-eyebrow">CONTRIBUTOR PORTFOLIO</span><h3>${e(person.name)}</h3><p>${e(person.emails.slice(0,4).join(' · '))}${person.emails.length>4?` · +${person.emails.length-4} more`:''}</p><div class="primary-facts">${stat(f(person.contributed),'Release participation',`${p(person.participation)} of observed releases`)}${stat(f(person.driven),'Release leadership','Matched publishers/taggers')}${stat(f(person.shippedCommits),'Distinct released commits','Deduplicated across tags')}${stat(f(person.distinctAreas),'Areas authored in window')}</div></div>
    <nav class="primary-tabs" aria-label="Contributor perspective">${tab('delivery','Delivery')}${tab('together','Together')}${tab('focus','Focus')}${tab('evolution','Evolution')}${tab('compare','Compare')}<a class="primary-tab-link" href="#people-patterns" data-action="primary-open-rhythm">Working rhythm ↑</a></nav>
    ${mode==='delivery' ? `${card('Release portfolio',`<div class="primary-row between"><p class="primary-muted">Leadership and authorship are independent roles. Participation share uses all tag events in the same date window.</p><a class="primary-inline-link" href="${href(index,{view:'observatory'})}" data-action="primary-nav" data-to="observatory">View release landscape ↗</a></div><div class="primary-release-list">${involvement.map(r=>{const m=r.members.find(m=>m.id===focus);return `<a href="${href(index,{view:'observatory',release:r.hash})}" class="primary-release-entry" data-action="primary-open-release" data-hash="${e(r.hash)}"><span class="primary-release-symbol">${r.driver.groupId===focus?'◆':'●'}</span><strong>${e(r.tag)}</strong><small>${e(day(r.date))}</small><span>${m?.commits||0} commits</span><span>${m?.commits?p(m?.share/100):'—'} share</span><em>${r.driver.groupId===focus?'Led release':'Participated'}</em></a>`;}).join('')||empty('No release involvement in this period','This person may still have authored activity; lead mappings can also be reviewed in Explore Evidence.')}</div>${person.involvement.length>28?`<p class="primary-muted">Latest 28 of ${person.involvement.length} involvements; use Observatory to navigate the complete tag history.</p>`:''}`)}${card('Delivery context',`<div class="primary-facts">${stat(f(person.both),'Led & participated')}${stat(person.concentration==null?'—':`${f(person.concentration)}%`,'Median share when contributing')}${stat(f(person.driverWithOthers),'Median contributors in releases led')}</div>${caption('These describe different roles and recorded contributions. Commit share is not a measure of effort, ownership or customer value.')}<button type="button" class="button outline" data-action="primary-contributor-tab" data-tab="together">See who ships alongside them →</button>`)}${card('Time to release',`${releaseAgeChart(person.releaseAge,{compare:person.teamReleaseAge,subject:person.name})}${caption('Commits authored in this window, followed to the first tagged release that shipped them, even after the window. Not-yet-released commits are still waiting as of the end of the imported history and are excluded from the percentiles. Calendar time, not effort.')}`)}` : ''}
    ${mode==='together'?coReleasePanel(index,focus,window,ui):''}
    ${mode==='focus'?`${card('Where authored work happened',`<div class="primary-ranked">${areas.map(([area,value])=>`<div class="primary-ranked-row"><a href="${href(index,{view:'codebase',area})}" data-action="primary-open-area" data-area="${e(area)}">${e(area)}</a>${bar(value,maxAreas)}<strong>${f(value)} touches</strong></div>`).join('')||empty('No file-touch evidence','This person has no matching authored changes in the selected window.')}</div><p class="primary-muted">Areas use top-level path grouping. A file touch is not exclusive ownership. Explore an area to see other contributors and releases.</p>`)}`:''}
    ${mode==='evolution'?`${card('Contribution journey',`<p class="primary-muted">Monthly lanes distinguish authored commits (author clock), release participation and release leadership (delivery clock). Select a month to inspect its period evidence.</p><div class="primary-journey-scroll"><div class="primary-journey-track">${months.map(m=>`<a href="${href(index,{view:'contributors',from:`${m.key}-01`,to:monthEnd(m.key)})}" data-action="primary-open-month" data-month="${e(m.key)}" title="${e(`${m.key}: ${m.commits} commits, ${m.releases} releases participated in, ${m.driven} led`)}"><span class="primary-journey-volume"><i style="height:${m.commits>0?clamp(6+94*m.commits/maxCommits,6,100):0}%"></i></span><span class="primary-journey-mark">${m.releases?'●':'·'}</span><span class="primary-journey-mark driven">${m.driven?'◆':'·'}</span><small>${e(m.key)}</small></a>`).join('')}</div></div><div class="primary-legend-row"><span>▥ Authored</span><span>● In releases</span><span>◆ Led</span></div><div class="primary-table-wrap"><table><thead><tr><th>Year</th><th>Authored commits</th><th>Release participation</th><th>Release leadership</th><th>Months in window</th></tr></thead><tbody>${yearRows.map(r=>`<tr><th><a href="${href(index,{view:'contributors',from:`${r.year}-01-01`,to:`${r.year}-12-31`})}" data-action="primary-open-year" data-year="${r.year}">${r.year} ↗</a></th><td>${f(r.commits)}</td><td>${f(r.releases)}</td><td>${f(r.driven)}</td><td>${r.months} / 12</td></tr>`).join('')}</tbody></table></div><p class="primary-muted">Partial years are labelled by months included in the selected window; their totals are not automatically annualised.</p>`)}`:''}
    ${mode==='compare'?`${card('Compare people on equal terms',`<p class="primary-muted">All people below use exactly the same time window, Git policy and release-event population. Different numbers are not automatically better or worse.</p><div class="primary-controls"><label>Person A ${select('primary-compare-a',options,focus)}</label><label>Person B ${select('primary-compare-b',[{value:'',label:'Choose another contributor'},...options],ui.compareB)}</label><label>Person C (optional) ${select('primary-compare-c',[{value:'',label:'None'},...options],ui.compareC)}</label></div><div class="primary-table-wrap"><table class="primary-compare-table"><thead><tr><th>Evidence dimension</th>${compared.map(x=>`<th>${e(x.name)}</th>`).join('')}</tr></thead><tbody>${[
      ['Release participation',x=>f(x.contributed)],['Participation rate',x=>p(x.participation)],['Release leadership',x=>f(x.driven)],['Authored commits',x=>f(x.profile.commits)],['Authored active dates',x=>f(x.profile.activeDays)],['Distinct codebase areas',x=>f(x.distinctAreas)],['Median internal quiet days',x=>f(x.medianGap)],['Median time to release',x=>duration(x.releaseAge.median)],['Commits not yet released',x=>f(x.releaseAge.unreleased)],
    ].map(([label,get])=>`<tr><th>${e(label)}</th>${compared.map(x=>`<td>${e(get(x))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="primary-comparison-heats">${compared.map(x=>`<div class="primary-inset"><strong>${e(x.name)}</strong>${weekHeatmap(x.slots,{shape:true})}</div>`).join('')}</div><p class="primary-muted">Each timing grid shows share of that individual's timed commits; equal greens indicate similar composition, not equal volume. Underlying counts and denominators remain visible.</p>`)}${coReleaseComparison(index,compared,window)}`:''}
    ${deploymentContributorPanel(index,focus,ui)}
    ${card('Follow their contribution',`<p class="primary-muted">Move from this portrait into the same person's authored period, release anatomy or component history, preserving an investigation trail.</p><div class="primary-card-footer"><a class="button soft" href="${href(index,{view:'contributors',from:windowOf(index,30).from,to:windowOf(index,30).to,person:index.groups.find(g=>g.id===focus)?.emails?.[0]})}" data-action="primary-person-period" data-person="${e(focus)}">Explore their recent period →</a><button class="button outline" type="button" data-action="primary-evidence-person" data-person="${e(focus)}">Inspect every activity chart ↗</button></div>`)}`;
}

/**
 * Codebase: one map shared with release footprints, shaded by the scope's
 * authored or released changes. Selecting an area shows who works there,
 * the releases that shipped it and its newest commits.
 */
function codebaseView(index,ui){
  const {from,to,ids}=scopeOf(index,ui);
  const clock=ui.codebaseClock==='released'?'released':'authored';
  const commits=codebaseCommits(index,{from,to,ids,clock});
  const {map}=releaseFootprints(index);
  const fp=releaseFootprint(commits,map);
  const selected=ui.codeArea||null;
  // A selection is a map cell, a top-level block or a folder from a link.
  const matches=path=>{const area=footprintArea(path);return area===selected||map.cellOf.get(area)===selected||topOf(area)===selected||selected.endsWith('/')&&area.startsWith(selected);};
  const portrait=selected?areaPortrait(index,commits,matches):null;
  const clockSwitch=`<div class="primary-preset-row" role="group" aria-label="Count changes">${toggleButton('codebaseClock','authored','Authored',clock)}${toggleButton('codebaseClock','released','Released',clock)}</div>`;
  const basis=clock==='released'?'commits shipped by releases published in the scope dates':'commits authored in the scope dates';
  return `<p class="primary-lede">Where the scope's changes landed, and who works where.</p>
    ${card('The codebase map',`<div class="primary-row between"><p class="primary-muted">${e(day(from))} – ${e(day(to))} · ${e(basis)}${ids?' by the people in scope':''}. Select an area to see who works there.</p>${clockSwitch}</div>${fp.touches?codebaseMap(map,fp.shares.files,null,{weightLabel:'file touches',subject:`the scope's ${clock}`,selected,ui}):empty('No file changes in this scope','Widen the scope\'s dates or people, or switch between authored and released changes.')}`)}
    ${portrait?card(selected,`<div class="primary-row between"><p class="primary-muted">${clock==='released'?'Released':'Authored'} changes in ${e(selected)} within the scope.</p><button type="button" class="primary-inline-link" data-action="primary-select-area" data-area="">Clear selection</button></div><div class="primary-facts">${stat(f(portrait.touches),'File touches')}${stat(f(portrait.commits),'Commits')}${stat(f(portrait.people.length),'People')}${stat(f(portrait.releases),'Releases shipping them')}</div><div class="primary-two-col"><div class="primary-inset"><h4>Who works here</h4>${portrait.people.slice(0,12).map(([id,v])=>`<div class="primary-ranked-row">${whoButton(index,id)}${bar(v,Math.max(1,...portrait.people.map(x=>x[1])))}<strong>${f(v)}</strong></div>`).join('')||'<p class="primary-muted">No matching changes.</p>'}</div><div class="primary-inset"><h4>Releases that shipped these changes</h4>${portrait.recentReleases.map(r=>`<div class="primary-release-brief">${tagButton(index,r)}<small>${e(day(r.date))}</small></div>`).join('')||'<p class="primary-muted">Not yet in a tagged release.</p>'}</div></div><details class="primary-notes"><summary>Newest commits here</summary><div class="primary-commit-list">${portrait.recent.map(c=>`<div><code>${e(c.hash.slice(0,8))}</code><span>${e(day(c.date))}</span>${whoButton(index,c.groupId)}<span class="primary-commit-subject">${e(c.subject)}</span></div>`).join('')||'<p>No matching commits.</p>'}</div></details>`):''}
    ${whoWhereCard(index,ui,{commits,clock,from,to,ids})}`;
}

export function renderPrimaryExplorer(index,ui){
  if(!index)return empty('Preparing repository history','Building complete-release and authored-date evidence.');
  let content;
  if(ui.mode==='contributors')content=peopleView(index,ui);
  else if(ui.mode==='codebase')content=codebaseView(index,ui);
  else content=observatory(index,ui);
  return `<div class="primary-explorer">
    ${content}
  </div>`;
}
export function periodBriefingForUi(index,ui){
  const window={from:ui.periodFrom,to:ui.periodTo};
  const base=briefingText(index,periodDigest(index,window,{comparison:ui.periodComparison,customComparison:{from:ui.compareFrom,to:ui.compareTo},selectedIds:scopeOf(index,ui).ids}));
  return `${base}\n${deploymentBriefing(index,window.from,window.to)}`;
}
