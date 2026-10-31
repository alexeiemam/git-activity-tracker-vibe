/** Presentational HTML helpers for the tag-first impact explorer. */
import { IMPACT_METRICS } from './impact.js';

const e = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const n = new Intl.NumberFormat('en-GB', {maximumFractionDigits:1});
const p = x => x==null?'—':`${n.format(x)}%`;
const amount = x => x==null?'—':n.format(x);
const shortDate = x => x ? new Date(`${x}T12:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) : 'Undated';
const typeLabel = s => ({baseline:'First tag on lineage',major:'Major',minor:'Minor',patch:'Patch',prerelease:'Pre-release',divergent:'Version decreased',unclassified:'Unclassified', 'same-version':'Same version'})[s] || 'Unclassified';
const color = s => ({major:'#b65e49',minor:'#4d70a4',patch:'#2b7957',prerelease:'#a47833',baseline:'#707e70'})[s] || '#84708f';
const humanMetric = (value,metric) => metric==='share'?p(value):amount(value);
const shade = (value,max) => value==null?'background:#f4f5f2;color:#87968b':`background:rgba(27,113,75,${(0.09+0.76*Math.pow(Math.max(0,value)/Math.max(1,max),0.55)).toFixed(3)});color:${value/max>0.62?'#fff':'#20553b'}`;

export function impactSelectMessage(model) {
  if(!model.available) return `<div class="impact-empty"><strong>No resolvable release tags in this import</strong><p>Paste a fresh capture using the updated Git command to include annotated and lightweight tags, parent hashes and commit times. Legacy logs and partial Git history still work for activity, but cannot prove release membership. Existing charts remain available.</p></div>`;
  if(!model.releases.length) return `<div class="impact-empty"><strong>No release tags within this date range</strong><p>Tags are placed by their tag or tagged-commit date. Widen the global date range to see earlier releases; author dates still control which contributing commits count.</p></div>`;
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
    <div><span>VERSION SIGNALS</span><strong>${amount(versionTouches)}</strong><small>VERSION-touching commits, not releases</small></div>
  </div>`;
}

export function impactTimeline(model, selectedHash, expanded=false) {
  const all=model.releases;
  const records=expanded?all:all.slice(-18);
  if(!records.length)return '';
  const width=Math.max(790,records.length*66), height=288;
  // Include authored activity before/after the tagged releases. A plot whose
  // x-axis ends at the latest tag silently hides genuinely unreleased work.
  const months=model.activityMonths.map(m=>{
    const year=Number(m.month.slice(0,4)), month=Number(m.month.slice(5,7))-1;
    return {...m,start:Date.UTC(year,month,1),end:Date.UTC(year,month+1,1)};
  });
  const times=[...records.map(r=>r.timestamp??0),...months.flatMap(m=>[m.start,m.end])];
  const min=Math.min(...times),max=Math.max(...times);
  const hi=Math.max(1,...records.map(r=>r.metricValue??0));
  const x=date=>58+(date-min)/(max-min||1)*(width-94);
  const y=value=>163-value/hi*120;
  const monthTicks=[];
  const firstYear=new Date(min).getUTCFullYear(),lastYear=new Date(max).getUTCFullYear();
  for(let year=firstYear;year<=lastYear;year++)for(const month of [0,6]){
    const t=Date.UTC(year,month,1);
    if(t>=min&&t<=max)monthTicks.push({date:t,label:month===0?String(year):'Jul'});
  }
  if (!monthTicks.length) {
    monthTicks.push({date:min,label:shortDate(new Date(min).toISOString().slice(0,10))});
    if (max>min)monthTicks.push({date:max,label:shortDate(new Date(max).toISOString().slice(0,10))});
  }
  const maxMonthly=Math.max(1,...months.map(m=>m.count));
  const bars=months.map(m=>{
    const left=x(m.start), barW=Math.max(2,x(m.end)-left-2);
    const h=32*m.count/maxMonthly;
    return `<rect x="${left}" y="${242-h}" width="${barW}" height="${h}" rx="1" fill="#9dbfac" opacity=".8"><title>${e(m.month)} · ${amount(m.count)} authored commits · ${amount(m.version)} VERSION touches</title></rect>`;
  }).join('');
  const versionMarkers=model.versionEvents.filter(c=>c.authoredAt!=null && c.authoredAt>=min && c.authoredAt<=max).map(c=>{
    const pos=x(c.authoredAt);
    return `<path d="M ${pos} 195 l 4 4 l -4 4 l -4 -4 z" fill="#ad7d3c" stroke="#fff" stroke-width=".8"><title>${e(c.date)} · VERSION edit · ${e(c.subject)} · ${e(c.name)}</title></path>`;
  }).join('');
  const stems=records.map(r=>{
    const undefinedMetric=r.metricValue==null;
    const cx=x(r.timestamp??0),cy=undefinedMetric?181:y(r.metricValue),active=r.hash===selectedHash;
    const msg=`${r.tag} · ${shortDate(r.date)} · ${typeLabel(r.transition)} · ${humanMetric(r.metricValue,model.metric)} ${IMPACT_METRICS[model.metric]} · ${amount(r.selectedFootprint.pathsCount)} paths`;
    return `<line x1="${cx}" y1="168" x2="${cx}" y2="${cy}" stroke="${color(r.transition)}" stroke-opacity=".35" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="${active?9:6}" fill="${undefinedMetric?'#fff':color(r.transition)}" stroke="${active?'#152f21':undefinedMetric?'#8d9f91':'#fff'}" stroke-width="${active?3:2}" role="button" tabindex="0" aria-label="${e(msg)}. Select release" data-action="impact-release" data-impact-hash="${e(r.hash)}" class="impact-timeline-dot"><title>${e(msg)}</title></circle>`;
  }).join('');
  return `<div class="impact-timeline-info"><span>Tag events plotted against ${e(IMPACT_METRICS[model.metric].toLowerCase())} · Below: all scoped authored commits (including unreleased) and VERSION signals</span><span>${records.length}${!expanded&&all.length>18?` of ${all.length}`:''} releases</span></div>
    <div class="impact-timeline-scroll"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Tag-date release timeline and distinct authored activity strip. Interactive markers select a tagged release.">
      ${[0,.5,1].map(f=>`<line x1="48" y1="${y(f*hi)}" x2="${width-28}" y2="${y(f*hi)}" stroke="#e4ebe1" stroke-dasharray="2 4"/><text x="40" y="${y(f*hi)+4}" text-anchor="end" class="impact-axis">${humanMetric(f*hi,model.metric)}</text>`).join('')}
      <line x1="48" y1="168" x2="${width-28}" y2="168" stroke="#bbcfc0"/>
      ${stems}
      <text x="14" y="230" class="impact-axis" transform="rotate(-90,14,230)">AUTHORED</text>
      <line x1="48" y1="242" x2="${width-28}" y2="242" stroke="#d6e6d6"/>
      ${bars}${versionMarkers}
      ${monthTicks.map(t=>`<line x1="${x(t.date)}" y1="245" x2="${x(t.date)}" y2="250" stroke="#9aae9c"/><text x="${x(t.date)}" y="266" text-anchor="middle" class="impact-axis">${t.label}</text>`).join('')}
    </svg></div>
    <div class="impact-timeline-legend">${['major','minor','patch','prerelease','baseline','unclassified'].map(kind=>`<span><i style="background:${color(kind)}"></i>${typeLabel(kind)}</span>`).join('')}
      <span><i style="background:#9dbfac;border-radius:1px"></i>Authored commits (incl. unreleased)</span><span><i style="background:#ad7d3c;transform:rotate(45deg);border-radius:0"></i>VERSION touched (author date)</span><span><i style="background:#fff;border:2px solid #8d9f91"></i>Undefined measure</span></div>
    ${all.length>18?`<button type="button" class="impact-link" data-action="impact-toggle-all">${expanded?'Show latest 18 releases':`Show all ${all.length} releases`}</button>`:''}`;
}

export function impactReleasePicker(model, hash) {
  const releases=model.releases;
  return `<label class="impact-select-label" for="impact-release-select">RELEASE TO INSPECT</label><select class="impact-select" id="impact-release-select">${releases.slice().reverse().map(r=>`<option value="${e(r.hash)}" ${r.hash===hash?'selected':''}>${e(r.tag)} · ${e(shortDate(r.date))} · ${e(typeLabel(r.transition))}</option>`).join('')}</select>`;
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
  return `<div class="impact-release-head"><div><div class="impact-date">${e(shortDate(release.date))} · ${e(release.timeSource==='tagger'?'Annotated tag · tagger date':release.timeSource==='tagged-commit'?'Lightweight tag · commit date':'Approximate commit date')}</div>
    <h5>${e(release.tag)} <span class="impact-kind-badge" style="--kind:${color(release.transition)}">${e(typeLabel(release.transition))}</span></h5>
    <p>${release.previousTag?`Introduced after <strong>${e(release.previousTag)}</strong>`:'First tagged snapshot on this lineage. Includes all reachable prior history, not one release-sized increment.'}
    ${release.aliases.length>1?` · Alias tags: ${release.aliases.map(e).join(', ')}`:''}</p>
    ${!release.lineageComplete?'<p class="impact-warning">Incomplete parent history: imported commit ancestry does not establish this release difference completely.</p>':''}</div></div>
    <div class="impact-detail-facts">
    <div><span>SCOPED COMMITS</span><strong>${amount(f.commits)}</strong><small>${amount(release.eligibleIntroduced)} eligible · ${amount(release.totalIntroduced)} DAG-introduced before filters</small></div>
    <div><span>DISTINCT PATHS</span><strong>${amount(f.pathsCount)}</strong><small>${amount(f.areasCount)} top-level areas</small></div>
    <div><span>LINE CHURN</span><strong>${amount(f.churn)}</strong><small>+${amount(f.additions)} / −${amount(f.deletions)}</small></div>
    <div><span>TEST ACCOMPANIMENT</span><strong>${p(f.testAccompaniment)}</strong><small>Code-touching commits also touching test paths</small></div>
    <div><span>VERSION TOUCHES</span><strong>${amount(f.versionTouches)}</strong><small>Independent supporting signal</small></div>
    <div><span>AUTHOR → TAG</span><strong>${release.leadDays==null?'—':`${n.format(release.leadDays)}d`}</strong><small>Median elapsed days · not delivery lead time</small></div>
    </div>
    <div class="impact-release-columns"><div><h6>Changes by category <small>Subject heuristics</small></h6>${categories||'<p>None in scope</p>'}</div>
    <div><h6>Later change to touched paths</h6><p class="impact-muted">Reference: ${e(referenceLabel)} · Paths can be revisited for good reasons.</p>
      <div class="impact-revisit-fact"><strong>${next?.share==null?'—':p(next.share)}</strong><span>${next?`${amount(next.count)} of ${amount(f.pathsCount)} paths revisited by ${e(release.nextTag)} relative to this tag`:'No subsequent descendant tag in imported history'}</span></div>
      <div class="impact-revisit-windows">${release.followup.map(record=>`<div><small>${record.days} DAYS</small><strong>${record.observed?p(record.share):'—'}</strong><span>${record.observed?`${amount(record.count)} paths`:'Not fully observed'}</span></div>`).join('')}</div>
    </div></div>
    <details class="impact-evidence"><summary>Inspect commit evidence <span>${amount(release.selected.length)} matching commits</span></summary>${impactCommits(release.selected)}</details>`;
}

export function impactReleaseMatrix(model, expanded=false) {
  const all=model.releases;
  const releases=expanded?all:all.slice(-18);
  const people=releases[0]?.cells || [];
  if (!releases.length)return '';
  const labels=model.metric==='share'?'Percent of reference commits':IMPACT_METRICS[model.metric];
  return `<p class="impact-muted">Each cell is ${e(labels.toLowerCase())} by a selected contributor, within a tagged release and the global authored-date/commit-policy scope. The reference for shares is <strong>${e(model.referenceLabel)}</strong>. Distinct paths/areas can overlap across people.</p>
    <div class="impact-matrix-scroll"><table class="impact-matrix"><thead><tr><th>CONTRIBUTOR</th>${releases.map(r=>`<th><span class="impact-matrix-version">${e(r.tag)}</span><small>${e(r.date||'—')}</small></th>`).join('')}</tr></thead><tbody>
    ${people.map((person,i)=>`<tr><th title="${e(person.name)}">${e(person.name)}</th>${releases.map(r=>{const cell=r.cells[i];const value=cell?.value;const tooltip=`${person.name} · ${r.tag}: ${humanMetric(value,model.metric)} ${labels}`;return `<td><button type="button" data-action="impact-release" data-impact-hash="${e(r.hash)}" class="impact-matrix-cell" style="${shade(value,model.maxCell)}" title="${e(tooltip)}" aria-label="${e(tooltip)}. Open release detail">${humanMetric(value,model.metric)}</button></td>`;}).join('')}</tr>`).join('')}
    </tbody></table></div>
    <p class="impact-muted">${releases.length}${!expanded&&all.length>18?` of ${all.length}`:''} tagged releases. Cell intensity uses a shared scale across all contributors and releases.</p>`;
}

export function impactReach(model, areaMode='touches') {
  const areas=model.areas.slice(0,14), people=model.peopleAreas;
  const denom=new Map(people.map(g=>[g.id,[...g.footprint.areaTouches.values()].reduce((a,b)=>a+b,0)]));
  const valueFor=(g,a)=>{const touches=g.footprint.areaTouches.get(a)||0;return areaMode==='within' ? (denom.get(g.id)?100*touches/denom.get(g.id):null):touches;};
  const max=Math.max(1,...people.flatMap(g=>areas.map(([a])=>valueFor(g,a)||0)));
  const kinds=Object.entries(model.overall.kindCounts).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
  return `<p class="impact-muted">Top-level file areas count file touches from authored commits introduced by displayed tagged releases, with the same global contributor/date/merge/revert scope. Path counts measure breadth, not complexity. ${model.areas.length>14?`Showing the 14 most frequently touched of ${model.areas.length} areas.`:''}</p>
    <div class="impact-reach-legend">${areaMode==='touches'?'File touches · absolute':'Share of each contributor’s file touches · within-person %'}<span>Shared colour intensity scale</span></div>
    <div class="impact-matrix-scroll"><table class="impact-matrix impact-reach-table"><thead><tr><th>CODEBASE AREA</th>${people.map(g=>`<th>${e(g.name)}<small>${amount(g.footprint.pathsCount)} paths</small></th>`).join('')}</tr></thead><tbody>
    ${areas.map(([area,total])=>`<tr><th>${e(area)}<small>${amount(total)} touches</small></th>${people.map(g=>{const v=valueFor(g,area);return `<td><span class="impact-matrix-cell impact-reach-value" style="${shade(v,max)}">${areaMode==='within'?p(v):amount(v)}</span></td>`;}).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="impact-reach-bottom"><div><h6>Change classification <small>Commit-subject conventions or heuristics</small></h6>${kinds.map(([name,count])=>`<div class="impact-kind-row"><span>${e(name)}</span><div><i style="width:${100*count/(model.overall.commits||1)}%"></i></div><strong>${amount(count)}</strong></div>`).join('')||'No commits in scope'}</div>
      <div><h6>Delivery supporting signals</h6><div class="impact-detail-facts compact"><div><span>CODE + TEST</span><strong>${p(model.overall.testAccompaniment)}</strong><small>Same-commit test accompaniment</small></div><div><span>DOC FILE TOUCHES</span><strong>${amount(model.overall.docTouches)}</strong></div><div><span>EXPLICIT REVERTS</span><strong>${amount(model.overall.reverts)}</strong></div><div><span>DISTINCT PATHS</span><strong>${amount(model.overall.pathsCount)}</strong></div></div><p class="impact-muted">Commit subjects are imperfect intent classifiers. Test accompaniment does not establish test quality or coverage.</p></div></div>
    <div class="impact-cochange"><h6>Areas often changed together <small>Same authored commit · co-change is not proof of technical coupling</small></h6>
    ${model.cochanges.length?model.cochanges.slice(0,8).map(([pair,count])=>`<div class="impact-cochange-row"><span>${e(pair)}</span><div><i style="width:${100*count/model.cochanges[0][1]}%"></i></div><strong>${amount(count)} commits</strong></div>`).join(''):'<p class="impact-muted">No commits touched multiple top-level areas in this selection.</p>'}</div>`;
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
