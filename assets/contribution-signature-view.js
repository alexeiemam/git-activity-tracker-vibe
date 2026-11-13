/** Three descriptive views over one author/release evidence contract. */
import {velocityStyle,velocityCellText,velocityLegend} from './absolute-velocity.js?v=git-incremental-activity-20261113-1';
import {missingDayColour,extraDayColour} from './working-patterns.js?v=git-incremental-activity-20261113-1';
import {continuityReleaseColour} from './continuity.js?v=git-incremental-activity-20261113-1';
import {quadrantPosition,DELIVERY_REFERENCE_LINES,CONTRIBUTION_REFERENCE_INDEX} from './contribution-signature.js?v=git-incremental-activity-20261113-1';

const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('en-GB').format(n):'—';
const level=n=>Number.isFinite(n)?n.toFixed(n<10?2:1):'—';
const pct=n=>Number.isFinite(n)?`${Math.round(n*100)}%`:'—';
const fmtRange=m=>`${esc(m.from)} – ${esc(m.to)}`;

export function renderContributionSignature(model,{colours={}}={}) {
  const weeks=model.rows[0]?.weeks||[];
  if(!weeks.length)return '<p class="pulse-gap-unavailable">No calendar weeks in this selection.</p>';
  const columns=`minmax(146px,185px) repeat(${weeks.length}, minmax(76px, 1fr))`;
  const head=weeks.map(week=>`<span class="signature-axis" title="${esc(week.from)} – ${esc(week.to)}">${esc(week.key.slice(5))}</span>`).join('');
  const rows=model.rows.map(person=>{
    const cells=person.weeks.map(week=>{
      const observed=week.observedDays>0;
      const shortage=week.shortfallDays,overage=week.overageDays;
      const dayText=!observed?'?':week.expectedDays===0?`${week.meaningfulDays}d`:
        shortage?`−${shortage}`:'=';
      const bg=missingDayColour(shortage,week.expectedDays,observed);
      const dayStyle=observed?`background:${bg}`:'background:repeating-linear-gradient(135deg,#f7f8f5 0,#f7f8f5 4px,#dfe5e0 4px,#dfe5e0 8px)';
      const output=week.authoredRate,releaseCount=week.participations;
      const releaseColour=continuityReleaseColour(releaseCount,week.opportunities,model.releaseOpportunities>0||model.incompleteReleaseOpportunities>0);
      const releaseText=week.opportunities?`${releaseCount}r`:'·';
      const label=`${person.name}, ${week.from} to ${week.to}${week.partial?' (partial week)':''}. ${week.meaningfulDays}/${week.expectedDays} qualifying vs expected days; ${shortage} shortfall, ${overage} overage. Authored-only output ${output===null?'unavailable':level(output)+' index per expected day'}, ${week.authoredCommits} commits, ${number(week.authoredChurn)} changed lines. ${releaseCount} of ${week.opportunities} tagged releases containing authored changes (tag-event dates).`;
      return `<button type="button" class="signature-week ${week.partial?'is-partial':''}" data-action="pulse-period" data-pulse-period="true" data-period-key="${esc(week.key)}" data-person-id="${esc(person.id)}" title="${esc(label)}" aria-label="${esc(label)}. View weekly evidence" aria-haspopup="dialog" aria-controls="pulse-popover">
        <span class="signature-band signature-days" style="${dayStyle};color:${shortage&&week.expectedDays&&shortage/week.expectedDays>2/3?'#fff':'#33463d'}">${esc(dayText)}${overage?`<small style="background:${extraDayColour(overage)}">+${overage}</small>`:''}</span>
        <span class="signature-band signature-output" style="${velocityStyle(output)}">${output===null&&week.expectedDays===0?'∑'+level(week.authoredUnits):velocityCellText(output)}</span>
        <span class="signature-band signature-release" style="${releaseColour?`background:${releaseColour}`:'background:#eef1ee'}">${releaseText}${week.partialReleases?'*':''}</span>
      </button>`;
    }).join('');
    return `<div class="signature-name" title="${esc(person.name)}" style="--person:${esc(colours[person.id]||'#347c69')}"><i class="person-dot" aria-hidden="true"></i><span>${esc(person.name)}</span><small>${person.expectedPerWeek??'—'}d ref.</small></div>${cells}`;
  }).join('');
  return `<div class="signature-intro"><div><strong>Contribution Signature</strong><p>One week, three independent observations: expected-day count, authored-only output, and tagged-release inclusion.</p></div><span>Selected period · ${fmtRange(model)}</span></div>
    <div class="signature-board" style="grid-template-columns:${columns}"><span class="signature-corner">CONTRIBUTOR</span>${head}${rows}</div>`;
}

export function renderSignatureLegend() {
  return `<div class="signature-legend" role="group" aria-label="Three independent signature bands">
    <span><i style="background:#d1e7da"></i>Days · = met</span><span><i style="background:#f5dfb9"></i>− shortfall</span><span><i style="background:#b9dced"></i>+ extra days</span>
    <span><i style="background:#368a77"></i>Authored output · fixed index per expected day</span><span><i style="background:#598d9f"></i>Releases · authored tag inclusion</span><span>▨ Partial or unknown history</span></div>`;
}

export function renderSignatureSummary(model) {
  return `<div class="pulse-gap-summary-head"><strong>Evidence behind the signature</strong><span>Only complete, fully observed Monday–Sunday weeks enter the quadrant throughput calculations; partial edge weeks remain inspectable above.</span></div>
    <div class="table-scroll"><table class="pulse-gap-table"><thead><tr><th>Contributor</th><th>Reference</th><th>Complete weeks meeting count</th><th>Mean target-day attainment</th><th>Authored index / expected day</th><th>Non-VERSION changed lines</th><th>Complete releases participated</th><th>Released changed lines</th></tr></thead><tbody>
    ${model.rows.map(r=>`<tr><th>${esc(r.name)}</th><td>${r.expectedPerWeek??'—'}d/week</td><td>${r.eligibleWeeks?`${r.weeksMet}/${r.eligibleWeeks}`:'—'}</td><td>${pct(r.meanAttainment)}</td><td>${level(r.authoredRate)}</td><td>${number(r.authoredChurn)}</td><td>${r.releaseOpportunities?`${r.releaseParticipations}/${r.releaseOpportunities}`:'—'}</td><td>${r.releaseLines===null?'Unknown':number(r.releaseLines)}</td></tr>`).join('')}</tbody></table></div>
    <p class="pulse-gap-caution">Output uses authored commits, non-VERSION line churn and churn-weighted distribution only; it excludes release bonuses to avoid counting the same work twice. The released-line column uses tag-event dates and can contain commits authored before this selection. Complete release ancestry is required for quadrant comparisons; ${model.incompleteReleaseOpportunities} partial tag(s) excluded. Observed Git changes are not attendance, hours worked, code quality or individual performance.</p>`;
}

const maps={
  delivery:{title:'Delivery-focused quadrant',x:'Release participation · share of eligible tagged releases',y:'Released changed lines per eligible release · log axis',xThreshold:.5,yThreshold:DELIVERY_REFERENCE_LINES,
    regions:['Selective participation · smaller changes','Broad participation · smaller changes','Selective participation · larger changes','Broad participation · larger changes'],
    insight:'Release breadth and released magnitude use the same eligible incremental tagged-release population. Larger circles mean more included authored commits, not stronger performance.'},
  contribution:{title:'Contribution-focused quadrant',x:'Mean expected-day attainment · capped at 100%',y:'Authored-only index per expected contribution day · log axis',xThreshold:.75,yThreshold:CONTRIBUTION_REFERENCE_INDEX,
    regions:['Episodic · lighter recorded output','Regular · lighter recorded output','Episodic · substantial recorded output','Regular · substantial recorded output'],
    insight:'Expected-day attainment is averaged across complete weeks and capped in each week; overage cannot erase a quiet week. Output includes quiet expected days, and excludes release credit.'}
};

const coordinates=(row,mode)=>mode==='delivery'?{x:row.releaseBreadth,y:row.releaseRate,weight:row.releaseCommits}: {x:row.meanAttainment,y:row.authoredRate,weight:row.authoredCommits};

/** Classify against fixed reference lines, never the people currently selected. */
export function signatureQuadrantRegion(mode,x,y) {
  const d=maps[mode];
  if(!d||!Number.isFinite(x)||x<0||x>1||!Number.isFinite(y)||y<0)return null;
  const aboveX=x>=d.xThreshold,aboveY=y>=d.yThreshold;
  return {label:d.regions[(aboveY?2:0)+(aboveX?1:0)],aboveX,aboveY,
    xThreshold:d.xThreshold,yThreshold:d.yThreshold};
}

function inspectorContent(p,mode,descriptor,region,i,colour) {
  const r=p.person;
  const xValue=pct(p.x),yValue=level(p.y);
  const xMeaning=mode==='delivery'?'Release participation':'Expected-day attainment';
  const yMeaning=mode==='delivery'?'Released lines / eligible release':'Authored index / expected day';
  const xExplanation=mode==='delivery'
    ? `${r.releaseParticipations} of ${r.releaseOpportunities} eligible tagged releases included authored changes`
    : `Mean across ${r.eligibleWeeks} complete weeks; ${r.weeksMet} weeks met their day count`;
  const yExplanation=mode==='delivery'
    ? `${number(r.releaseLines)} released non-VERSION lines across ${number(r.releaseCommits)} included commits`
    : `${number(r.authoredChurn)} non-VERSION authored lines across ${number(r.authoredCommits)} commits and ${number(r.completeExpectedDays)} expected dates`;
  const xComparison=`${xValue} is ${region.aboveX?'at or above':'below'} the ${pct(region.xThreshold)} ${mode==='delivery'?'participation':'attainment'} reference`;
  const yComparison=`${yValue} is ${region.aboveY?'at or above':'below'} the ${number(region.yThreshold)} ${mode==='delivery'?'lines-per-release':'authored-index'} reference`;
  return `<div class="signature-inspector-content">
    <div class="signature-inspector-kicker"><span>POINT ${i+1} · ${esc(mode==='delivery'?'DELIVERY':'CONTRIBUTION')}</span><button type="button" data-quadrant-clear class="signature-inspector-clear" title="Clear selected point">Clear</button></div>
    <div class="signature-inspector-person"><i style="background:${esc(colour)}" aria-hidden="true"></i><strong>${esc(r.name)}</strong></div>
    <div class="signature-inspector-region">${esc(region.label)}</div>
    <div class="signature-inspector-axes">
      <div><small>${esc(xMeaning)} · X</small><strong>${xValue}</strong><span>${esc(xExplanation)}</span></div>
      <div><small>${esc(yMeaning)} · Y</small><strong>${yValue}</strong><span>${esc(yExplanation)}</span></div>
    </div>
    <div class="signature-inspector-reason"><strong>Why this region</strong><p>${esc(xComparison)}; ${esc(yComparison)}.</p></div>
    ${mode==='delivery'
      ? `<p class="signature-inspector-context">${r.releasePartialOpportunities} incomplete tagged-release opportunities excluded. Releases use tag dates, which may follow authored dates.</p>`
      : `<p class="signature-inspector-context">${r.expectedPerWeek} expected days per full week. Quiet expected dates are included in the output rate; releases are excluded from this authored-only axis.</p>`}
    <small class="signature-inspector-caveat">Reference lines are descriptive, not performance targets. Git records do not measure hours worked or code quality.</small>
  </div>`;
}

export function renderSignatureQuadrant(model,mode,{colours={}}={}) {
  const descriptor=maps[mode];
  if(!descriptor)throw new Error('Unknown Contribution Signature map');
  const items=model.rows.map(r=>({...coordinates(r,mode),person:r}));
  const plotted=items.filter(p=>p.x!==null&&p.y!==null&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  const missing=items.filter(p=>!plotted.includes(p));
  const overlaps=new Map();
  for(const point of plotted){
    const key=`${point.x.toFixed(5)}:${point.y.toFixed(5)}`;
    if(!overlaps.has(key))overlaps.set(key,[]);
    overlaps.get(key).push(point);
  }
  const maxObserved=Math.max(0,...plotted.map(p=>p.y));
  // The plot expands for the largest observation; region classification stays
  // anchored to fixed absolute references, never a ranking of selected peers.
  const maxY=Math.max(descriptor.yThreshold*2,maxObserved*1.15);
  const originX=76,originY=15,width=425,height=245;
  const px=x=>originX+x*width,py=y=>originY+(1-y)*height;
  const marker=(p,i)=>{
    const pos=quadrantPosition(p.x,p.y,{thresholdY:descriptor.yThreshold,maxY});
    const siblings=overlaps.get(`${p.x.toFixed(5)}:${p.y.toFixed(5)}`)||[p];
    const position=siblings.indexOf(p),angle=2*Math.PI*position/siblings.length;
    const separation=siblings.length>1?Math.min(15,7+siblings.length):0;
    // Visual separation does not affect the underlying plotted coordinates.
    const x=Math.max(originX+8,Math.min(originX+width-8,px(pos.x)+Math.sin(angle)*separation));
    const y=Math.max(originY+8,Math.min(originY+height-8,py(pos.y)+Math.cos(angle)*separation));
    const radius=8+Math.min(5,Math.sqrt(Math.max(0,p.weight||0))/3);
    const colour=colours[p.person.id]||'#376f7d';
    const region=signatureQuadrantRegion(mode,p.x,p.y);
    const title=`${p.person.name}. ${region.label}. ${descriptor.x}: ${pct(p.x)} versus ${pct(descriptor.xThreshold)} reference; ${descriptor.y}: ${level(p.y)} versus ${number(descriptor.yThreshold)} reference. Select to inspect evidence.`;
    return `<g class="signature-point" role="button" tabindex="0" aria-pressed="false" data-quadrant-point="${i}" data-quadrant-region="${esc(region.label)}" aria-label="${esc(title)}">
      <circle class="signature-point-hit" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius+7).toFixed(1)}" fill="transparent"/>
      <circle class="signature-point-ring" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius+2).toFixed(1)}" fill="none" stroke="${esc(colour)}" stroke-width="2"/>
      <circle class="signature-point-disc" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(1)}" fill="${esc(colour)}" stroke="#fff" stroke-width="2"/>
      <text class="signature-point-number" x="${x.toFixed(2)}" y="${(y+3.2).toFixed(2)}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${i+1}</text>
    </g>`;
  };
  const yRef=quadrantPosition(0,descriptor.yThreshold,{thresholdY:descriptor.yThreshold,maxY}).referenceY;
  const splitX=px(descriptor.xThreshold),splitY=py(yRef);
  const svg=`<svg class="signature-quadrant-svg" viewBox="0 0 530 315" role="group" aria-label="${esc(descriptor.title)}. X: ${esc(descriptor.x)}; Y: ${esc(descriptor.y)}; ${plotted.length} interactive contributor points." xmlns="http://www.w3.org/2000/svg">
    <rect x="${originX}" y="${originY}" width="${width}" height="${height}" rx="6" fill="#f9fbfa" stroke="#d4ded7"/>
    <rect x="${originX}" y="${originY}" width="${splitX-originX}" height="${splitY-originY}" fill="#eef3f6"/>
    <rect x="${splitX}" y="${originY}" width="${originX+width-splitX}" height="${splitY-originY}" fill="#edf5f1"/>
    <rect x="${originX}" y="${splitY}" width="${splitX-originX}" height="${originY+height-splitY}" fill="#f9f5f0"/>
    <line x1="${splitX}" x2="${splitX}" y1="${originY}" y2="${originY+height}" stroke="#8ea498" stroke-dasharray="4 5"/>
    <line x1="${originX}" x2="${originX+width}" y1="${splitY}" y2="${splitY}" stroke="#8ea498" stroke-dasharray="4 5"/>
    <g fill="#51675b" font-family="sans-serif" font-size="10">
      <text x="${originX+8}" y="30">${esc(descriptor.regions[2])}</text><text x="${originX+width-8}" y="30" text-anchor="end">${esc(descriptor.regions[3])}</text>
      <text x="${originX+8}" y="${originY+height-10}">${esc(descriptor.regions[0])}</text><text x="${originX+width-8}" y="${originY+height-10}" text-anchor="end">${esc(descriptor.regions[1])}</text>
      <text x="${originX-10}" y="${originY+height}" text-anchor="end">0</text><text x="${originX-10}" y="${splitY+3}" text-anchor="end">${number(descriptor.yThreshold)}</text>
      <text x="${originX-10}" y="${originY+10}" text-anchor="end">${number(Math.round(maxY))}</text>
      <text x="${originX}" y="${originY+height+16}">0%</text><text x="${splitX}" y="${originY+height+16}" text-anchor="middle">${pct(descriptor.xThreshold)}</text><text x="${originX+width}" y="${originY+height+16}" text-anchor="end">100%</text>
    </g>
    ${plotted.map(marker).join('')}
    <text x="${originX+width/2}" y="${originY+height+38}" font-size="11" text-anchor="middle" fill="#355749">${esc(descriptor.x)}</text>
    <text x="18" y="${originY+height/2}" transform="rotate(-90 18 ${originY+height/2})" font-size="11" text-anchor="middle" fill="#355749">${esc(descriptor.y)}</text>
  </svg>`;
  const breakdown=model.rows.map(r=>{
    const p=coordinates(r,mode),region=signatureQuadrantRegion(mode,p.x,p.y);
    return `<tr><th>${esc(r.name)}</th><td>${region?esc(region.label):'Not plotted'}</td><td>${pct(p.x)}</td><td>${level(p.y)}</td><td>${r.eligibleWeeks?`${r.weeksMet}/${r.eligibleWeeks}`:'—'}</td><td>${number(r.authoredChurn)}</td><td>${r.releaseOpportunities?`${r.releaseParticipations}/${r.releaseOpportunities}`:'—'}</td><td>${r.releaseLines===null?'Unknown':number(r.releaseLines)}</td></tr>`;
  }).join('');
  const emptyReason=mode==='delivery'?'No complete incremental tagged-release opportunities with measured released-line evidence in this window.':'A complete observed week and a positive working-day reference are required for schedule-adjusted coordinates.';
  const identityButton=(p,i)=>{
    const region=signatureQuadrantRegion(mode,p.x,p.y),colour=colours[p.person.id]||'#376f7d';
    return `<button type="button" class="signature-legend-person" data-quadrant-person="${i}" aria-pressed="false" title="Inspect ${esc(p.person.name)}: ${esc(region.label)}"><i style="background:${esc(colour)}" aria-hidden="true"></i><span class="signature-legend-index">${i+1}</span><span>${esc(p.person.name)}</span></button>`;
  };
  return `<div class="signature-intro"><div><strong>${esc(descriptor.title)}</strong><p>${esc(descriptor.insight)}</p></div><span>Selected period · ${fmtRange(model)}</span></div>
    ${plotted.length?`<div class="signature-map-wrap" data-quadrant-inspection>
      <div class="signature-map-legend" aria-label="Contributors on the quadrant">${plotted.map(identityButton).join('')}</div>
      <div class="signature-map-grid">
        <div class="signature-map-plot-scroll"><div class="signature-map-stage">${svg}<div class="signature-hover-tag" data-quadrant-tag hidden aria-hidden="true"><strong></strong><span></span></div></div></div>
        <aside class="signature-point-inspector" data-quadrant-inspector aria-live="polite" aria-atomic="true"><div class="signature-inspector-placeholder"><span>POINT INSPECTOR</span><strong>Explore a contributor</strong><p>Hover or focus a numbered marker, or select a name below the chart. Click or tap to keep their evidence visible.</p></div></aside>
      </div>
      ${plotted.map((p,i)=>`<template data-quadrant-detail="${i}">${inspectorContent(p,mode,descriptor,signatureQuadrantRegion(mode,p.x,p.y),i,colours[p.person.id]||'#376f7d')}</template>`).join('')}
    </div>`:`<p class="pulse-gap-unavailable">${esc(emptyReason)}</p>`}
    ${missing.length?`<p class="signature-unmapped">Not plotted (missing a valid denominator or complete evidence): ${missing.map(p=>esc(p.person.name)).join(', ')}. Their recorded data remains in the table.</p>`:''}
    <div class="table-scroll"><table class="pulse-gap-table signature-evidence-table"><thead><tr><th>Contributor</th><th>Quadrant region</th><th>${mode==='delivery'?'Release breadth':'Target-day attainment'}</th><th>${mode==='delivery'?'Released lines / opportunity':'Authored index / expected day'}</th><th>Weeks met / observed</th><th>Non-VERSION authored lines</th><th>Releases included / eligible</th><th>Released changed lines</th></tr></thead><tbody>${breakdown}</tbody></table></div>
    <p class="pulse-gap-caution">The numbered points match the selectable contributor legend. Hover/focus for immediate identification; click/tap to keep a full explanation open. Overlapping observations are separated by a few pixels for visibility; exact values remain in the evidence table. The dashed reference lines are descriptive calibration points (${pct(descriptor.xThreshold)} on X; ${number(descriptor.yThreshold)} on Y), not targets or performance grades. Y is logarithmic; marker size indicates ${mode==='delivery'?'authored commits included in releases':'authored commits in complete observed weeks'}. ${model.incompleteReleaseOpportunities} tag(s) with incomplete ancestry excluded from delivery opportunity calculations. ${mode==='delivery'?'Release dates can be later than their included commits’ authored dates.':'Only complete observed Monday–Sunday weeks and contributors with a nonzero expected-day reference are scored; surplus activity cannot offset quieter weeks.'} Git contribution patterns do not measure hours, quality or work outside Git.</p>`;
}

/** Attach only to the freshly-rendered quadrant, so rerenders need no teardown. */
export function bindSignatureQuadrant(root) {
  const wrap=root?.querySelector('[data-quadrant-inspection]');
  if(!wrap)return;
  const inspector=wrap.querySelector('[data-quadrant-inspector]');
  const stage=wrap.querySelector('.signature-map-stage');
  const tag=wrap.querySelector('[data-quadrant-tag]');
  const placeholder=inspector.innerHTML;
  let selected=null,preview=null,shown=null;
  const keyOf=element=>element?.dataset?.quadrantPoint??element?.dataset?.quadrantPerson??null;
  const triggerOf=target=>target?.closest?.('[data-quadrant-point],[data-quadrant-person]');
  const choose=(key)=>{
    const safe=key!==null&&/^(0|[1-9][0-9]*)$/.test(String(key))?String(key):null;
    const template=safe===null?null:wrap.querySelector(`template[data-quadrant-detail="${safe}"]`);
    return template?{key:safe,template}:null;
  };
  const draw=()=>{
    const active=choose(preview??selected);
    if(shown!== (active?.key??null)) {
      shown=active?.key??null;
      inspector.replaceChildren();
      if(active)inspector.append(active.template.content.cloneNode(true));
      else inspector.innerHTML=placeholder;
    }
    for(const element of wrap.querySelectorAll('[data-quadrant-point],[data-quadrant-person]')){
      const key=keyOf(element);
      element.classList.toggle('is-inspected',key===shown);
      element.setAttribute('aria-pressed',String(key===selected));
    }
  };
  const hideTag=()=>{tag.hidden=true;};
  const showTag=(element,key)=>{
    const point=wrap.querySelector(`[data-quadrant-point="${key}"]`);
    if(!point)return hideTag();
    const name=wrap.querySelector(`.signature-legend-person[data-quadrant-person="${key}"] span:last-child`)?.textContent||'Contributor';
    const region=point.dataset.quadrantRegion||'';
    tag.querySelector('strong').textContent=name;
    tag.querySelector('span').textContent=region;
    tag.hidden=false;
    const box=point.querySelector('.signature-point-disc').getBoundingClientRect(),area=stage.getBoundingClientRect();
    const x=box.left+box.width/2-area.left,y=box.top+box.height/2-area.top;
    const left=Math.max(8,Math.min(x-tag.offsetWidth/2,stage.offsetWidth-tag.offsetWidth-8));
    tag.style.left=`${left}px`;
    tag.style.top=`${y>tag.offsetHeight+23?Math.max(4,y-box.height/2-tag.offsetHeight-10):y+box.height/2+10}px`;
  };
  const activate=(target)=>{
    const element=triggerOf(target);
    if(!element||!wrap.contains(element))return;
    const key=keyOf(element);
    if(!choose(key))return;
    preview=key;draw();
    if(element.hasAttribute('data-quadrant-point'))showTag(element,key);
    else hideTag();
  };
  const restore=()=>{preview=null;hideTag();draw();};
  wrap.addEventListener('pointerover',event=>activate(event.target));
  wrap.addEventListener('pointerout',event=>{
    const element=triggerOf(event.target);
    if(element&&element.contains(event.relatedTarget))return;
    if(triggerOf(event.relatedTarget)&&wrap.contains(event.relatedTarget))return;
    if(element)restore();
  });
  wrap.addEventListener('focusin',event=>activate(event.target));
  wrap.addEventListener('focusout',event=>{
    if(triggerOf(event.relatedTarget)&&wrap.contains(event.relatedTarget))return;
    if(triggerOf(event.target))restore();
  });
  wrap.addEventListener('click',event=>{
    if(event.target.closest('[data-quadrant-clear]')){
      selected=null;preview=null;hideTag();draw();return;
    }
    const element=triggerOf(event.target);
    if(!element||!wrap.contains(element))return;
    const key=keyOf(element);
    if(!choose(key))return;
    selected=selected===key?null:key;
    preview=null;hideTag();draw();
  });
  wrap.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      if(selected!==null){event.stopPropagation();event.preventDefault();selected=null;restore();}
      return;
    }
    const point=event.target.closest?.('[data-quadrant-point]');
    if(point&&(event.key==='Enter'||event.key===' ')){
      event.preventDefault();point.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    }
  });
  // Scrolling repositions SVG markers relative to the visible plot: never
  // leave a detached floating hover label covering an unrelated point.
  wrap.querySelector('.signature-map-plot-scroll')?.addEventListener('scroll',hideTag,{passive:true});
  draw();
}
