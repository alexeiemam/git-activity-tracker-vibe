/** Pure, escaped HTML presentations of deterministic Story Analysis. */
import { DAY_NAMES } from './domain.js?v=git-contribution-level-20261106-1';
import { makeIntensityScale, intensityStyle, intensityLegend } from './value-colour.js?v=git-contribution-level-20261106-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
const pct=n=>n==null?'Not observed':`${fmt.format(n*100)}%`;
const unit=n=>n==null?'—':fmt.format(n);
const fmtDate=s=>s||'—';
const types={activity:'Activity',rhythm:'Rhythm',delivery:'Release involvement',focus:'Codebase focus',seasonality:'Seasonality',context:'Context'};
const typeIcon={activity:'◴',rhythm:'◷',delivery:'◇',focus:'▦',seasonality:'❖',context:'✳'};
const safeId=s=>esc(s);
const restricted=[
  'Only the imported reachable Git history is observed. Work on other branches or repositories may be absent.',
  'Authored timestamps describe commit records, not working time, effort, job attendance or individual performance.',
  'Release participation is derived from imported Git ancestry. Squashes, cherry-picks and missing history can limit attribution.',
];

export function storyCopyText(finding,model) {
  if(!finding)return '';
  const period=finding.period?.prior
    ? `${finding.period.prior.from}–${finding.period.prior.to} compared with ${finding.period.recent.from}–${finding.period.recent.to}`
    : `${finding.period?.from||model.coverage.scopeStart}–${finding.period?.to||model.coverage.scopeEnd}`;
  return [finding.title,finding.summary,`Window: ${period}`,`Measurement: ${finding.basis}`,
    ...finding.evidence.map(e=>`${e.label}: ${e.value}`),
    `Why surfaced: ${finding.why||'An observed pattern against available evidence.'}`,
    ...finding.limitations.map(l=>`Limitation: ${l}`),
    'git:signals · locally analysed imported Git history; not a productivity or personnel judgement.'].join('\n');
}
function scopeCopy(model) {
  const c=model.coverage;
  return `${unit(c.selectedPeople)} selected ${c.selectedPeople===1?'contributor':'contributors'} · ${unit(c.authorCommits)} authored commits · ${unit(c.releasesEligible)} ancestry-complete release increments · ${c.scopeStart}–${c.scopeEnd}`;
}
function badge(label,kind='') {return `<span class="story-chip ${kind}">${esc(label)}</span>`;}
function subtitle(message){return `<p class="story-muted">${esc(message)}</p>`;}
function storyCard(f,index,selected=false) {
  const period=f.period?.prior
    ? `${f.period.prior.from}–${f.period.prior.to} vs ${f.period.recent.from}–${f.period.recent.to}`
    : `${f.period?.from||'?'} – ${f.period?.to||'?'}`;
  return `<article class="story-card ${selected?'is-selected':''}" data-story-card="${safeId(f.id)}">
    <div class="story-card-top">${badge(f.context?'Descriptive context':types[f.type]||f.type,'subtle')}<span class="story-card-date">${esc(period)}</span></div>
    <div class="story-card-main"><span class="story-card-symbol" aria-hidden="true">${typeIcon[f.type]||'○'}</span><div>
    <h4>${esc(f.title)}</h4><p>${esc(f.summary)}</p></div></div>
    <div class="story-card-actions"><button type="button" class="story-link" data-action="story-inspect" data-story-id="${safeId(f.id)}" ${selected?'aria-current="true"':''}>Explore this finding <span aria-hidden="true">↗</span></button>
    <button type="button" class="story-quiet-btn" data-action="story-dismiss" data-story-id="${safeId(f.id)}" aria-label="Hide finding: ${esc(f.title)}">Hide</button></div></article>`;
}
function progressBar(value,max,color='#386b53') {
  const width=Math.max(0,Math.min(100,max?100*value/max:0));
  return `<div class="story-metric-track"><span style="width:${width}%;background:${color}"></span></div>`;
}
function comparisonTable(finding,person){
  if(!finding.compare||!person?.prior||!person?.recent)return '';
  const p=person.prior,r=person.recent;
  const a=person.releasePrior,b=person.releaseRecent;
  const values=[
    ['Authored-active days per week',unit(p.activeDaysPerWeek),unit(r.activeDaysPerWeek)],
    ['Commits per active day',unit(p.commitsPerActiveDay),unit(r.commitsPerActiveDay)],
    ['Authored commits',unit(p.commits),unit(r.commits)],
    ['Release participation',a?.eligible?`${a.participated} / ${a.eligible}`:'—',b?.eligible?`${b.participated} / ${b.eligible}`:'—'],
    ['Published/tagged releases driven',unit(a?.driven),unit(b?.driven)],
    ['Touched codebase paths (file touches)',unit(p.fileTouches),unit(r.fileTouches)],
  ];
  const summaries=[
    {label:'Authored-active days / week',a:p.activeDaysPerWeek,b:r.activeDaysPerWeek,max:7},
    {label:'Commits / authored-active day',a:p.commitsPerActiveDay,b:r.commitsPerActiveDay,max:Math.max(1,p.commitsPerActiveDay||0,r.commitsPerActiveDay||0)},
    {label:'Release participation',a:a?.coverage,b:b?.coverage,max:1,percent:true},
  ].filter(item=>item.a!=null&&item.b!=null);
  const visual=summaries.map(item=>`<div class="story-period-row"><strong>${esc(item.label)}</strong>
    <div class="story-period-bars"><div><span>EARLIER</span>${progressBar(item.a,item.max,'#99bd9c')}<b>${item.percent?pct(item.a):unit(item.a)}</b></div>
    <div><span>RECENT</span>${progressBar(item.b,item.max,'#27684c')}<b>${item.percent?pct(item.b):unit(item.b)}</b></div></div></div>`).join('');
  return `<div class="story-compare-section"><div class="story-subheading"><h5>Before & after</h5><span>Same ${finding.compare.length}-day exposure per period</span></div>
    <div class="story-period-comparison">${visual}</div>
    <div class="story-table-wrap"><table class="story-compare-table"><thead><tr><th>Signal</th><th>Earlier · ${esc(p.from)}–${esc(p.to)}</th><th>Recent · ${esc(r.from)}–${esc(r.to)}</th></tr></thead><tbody>
    ${values.map(([a,b,c])=>`<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table></div>
    <p class="story-note">Release counts use publication/tag event dates; contribution identity is based on author-scoped Git ancestry. A release might include older authored commits, so release trends and authored-day trends are different clocks.</p></div>`;
}
function detail(f,model,person) {
  if(!f)return `<div class="story-empty"><h4>Follow the evidence</h4><p>Select a finding to inspect its exact measurements, limitations and source visualisation. No speculative judgements, no mystery score.</p></div>`;
  return `<div class="story-investigation" aria-labelledby="story-detail-title">
    <div class="story-detail-heading"><div>${badge(types[f.type]||f.type)}<h4 id="story-detail-title" tabindex="-1">${esc(f.title)}</h4></div><button class="story-icon-btn" type="button" data-action="story-close-detail" aria-label="Close finding detail">×</button></div>
    <p class="story-detail-lede">${esc(f.summary)}</p>
    <div class="story-fact-grid">${f.evidence.map(e=>`<div class="story-fact"><span>${esc(e.label)}</span><strong>${esc(e.value)}</strong></div>`).join('')}</div>
    ${comparisonTable(f,person)}
    <div class="story-reading"><div><span class="story-reading-label">What is observed</span><p>${esc(f.summary)}</p></div>
      <div><span class="story-reading-label">Why it was surfaced</span><p>${esc(f.why||'This was a noteworthy deviation within the observed scope.')}</p></div>
      <div><span class="story-reading-label">What it cannot establish</span><ul>${f.limitations.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></div>
    </div>
    <p class="story-note"><strong>Evidence:</strong> ${esc(f.basis)} · ${esc(f.unit)} · ${esc(model.coverage.scopeStart)} to ${esc(model.coverage.scopeEnd)}</p>
    <div class="story-detail-actions"><button class="story-primary-btn" type="button" data-action="story-evidence" data-story-id="${safeId(f.id)}">Inspect supporting visualisation <span aria-hidden="true">↗</span></button>
    <button class="story-secondary-btn" type="button" data-action="story-copy" data-story-id="${safeId(f.id)}">Copy evidence summary</button></div>
  </div>`;
}
function yearTimeline(person,selectedMonth) {
  const items=person.months;
  if(!items.length)return `<div class="story-empty">No authored history for this contributor in the selected scope.</div>`;
  const annotatedMonths=new Map();
  for(const finding of person.findings) {
    if(finding.context)continue;
    const eventDate=finding.compare?.recent?.from||finding.period?.from;
    const key=eventDate?.slice(0,7);
    if(key&&items.some(m=>m.month===key)){
      if(!annotatedMonths.has(key))annotatedMonths.set(key,[]);
      annotatedMonths.get(key).push(finding);
    }
  }
  const maxCount=Math.max(1,...items.map(m=>m.commits));
  const maxReleases=Math.max(1,...items.map(m=>m.releases));
  const maxDriven=Math.max(1,...items.map(m=>m.driven));
  const cells=items.map((m,i)=>{
    const year=m.month.slice(0,4),isYearEnd=m.month.slice(5)==='12',selected=m.month===selectedMonth;
    const annotations=annotatedMonths.get(m.month)||[];
    const events=annotations.length?` · ${annotations.length} evidence-linked observation${annotations.length>1?'s':''}`:'';
    const authorHeight=Math.max(0,m.commits?12+64*Math.log1p(m.commits)/Math.log1p(maxCount):0);
    const shippedHeight=Math.max(0,m.releases?12+64*m.releases/maxReleases:0);
    const driverHeight=Math.max(0,m.driven?12+64*m.driven/maxDriven:0);
    return `<button type="button" class="story-month ${selected?'is-active':''}" data-action="story-month" data-story-month="${esc(m.month)}" title="${esc(m.month)} · ${m.commits} authored commits · ${m.releases} releases with contributions · ${m.driven} driven${esc(events)}" aria-label="${esc(m.month)}, ${m.commits} authored commits, ${m.releases} contributed releases, ${m.driven} driven${esc(events)}${selected?', selected':''}">
      ${annotations.length?'<span class="story-month-marker" aria-hidden="true"></span>':''}
      <span class="story-month-cell"><i class="story-month-column author" style="height:${authorHeight}%"></i></span>
      <span class="story-month-cell"><i class="story-month-column release" style="height:${shippedHeight}%"></i></span>
      <span class="story-month-cell"><i class="story-month-column driver" style="height:${driverHeight}%"></i></span>
      <small>${m.month.slice(5)==='01'?esc(year):isYearEnd?'·':''}</small>
    </button>`;
  }).join('');
  return `<div class="story-journey-legend"><span><i class="story-dot author"></i> Authored commits</span><span><i class="story-dot release"></i> Contributed to release</span><span><i class="story-dot driver"></i> Drove release</span></div>
    <div class="story-journey-outer"><div class="story-lane-labels" aria-hidden="true"><span>Authored</span><span>Shipped</span><span>Driven</span></div>
    <div class="story-journey-scroll" id="story-journey-scroll" tabindex="0" aria-label="Scrollable contributor journey, use the slider or arrow keys to navigate months">
    <div class="story-months" style="--story-cols:${items.length};min-width:${Math.max(610,items.length*31)}px">${cells}</div></div></div>
    <div class="story-journey-bottom"><label for="story-journey-pan">Explore the timeline</label><input id="story-journey-pan" type="range" min="0" max="${Math.max(0,items.length-1)}" step="1" value="${Math.max(0,items.findIndex(m=>m.month===selectedMonth))}" aria-label="Move to a month of the contributor journey"><span>${esc(items[0].month)} — ${esc(items.at(-1).month)}</span></div>`;
}
function journey(person,selectedMonth){
  if(!person)return '<div class="story-empty">No contributor is available for the current scope.</div>';
  const month=person.months.find(m=>m.month===selectedMonth)||person.months.at(-1);
  const monthFindings=month?person.findings.filter(f=>!f.context &&
    (f.compare?.recent?.from||f.period?.from)?.slice(0,7)===month.month):[];
  const monthInterpretation=month
    ? month.commits && (month.releases||month.driven)
      ? 'Both authored activity and tagged release involvement are observed in this calendar month.'
      : month.commits
        ? 'Authored commits are visible, without tagged release involvement in this month.'
        : month.releases||month.driven
          ? 'Tagged release involvement is visible, without newly authored commits in this month. Earlier work may have reached a release.'
          : 'Neither authored commits nor tagged release involvement is observed here. This does not establish an absence from work.'
    : '';
  const chapters=person.years.map(year=>{
    const first=year.year===person.months[0]?.month.slice(0,4);
    const title=first?'First observed in this scope':year.driven?'Release publishing and authored activity':year.releases?'Authored changes reached tagged releases':'Authored activity recorded';
    return `<button type="button" class="story-chapter ${month?.month.startsWith(year.year)?'is-current':''}" data-action="story-year" data-story-year="${year.year}">
      <strong>${year.year}</strong><span>${esc(title)}<small>${unit(year.commits)} commits · ${unit(year.releases)} contributed releases · ${unit(year.driven)} driven</small></span><span aria-hidden="true">↗</span></button>`;
  }).join('');
  const matchingFindings=person.findings.filter(f=>f.compare||f.type==='activity').slice(0,3);
  return `<section class="story-journey" aria-label="Contributor journey">
    <div class="story-subheading"><div><span class="story-section-index">THE CONTRIBUTION JOURNEY</span><h4>${esc(person.name)} · an observable history</h4></div><span class="story-helper">Click a month to inspect; scroll for the full span</span></div>
    <p class="story-muted">Author time, release contributions and release-driving roles are aligned but remain separate measurements. The first observed commit is <em>not</em> necessarily someone's first day of work.</p>
    ${yearTimeline(person,month?.month)}
    ${month?`<div class="story-month-detail" id="story-month-detail" aria-live="polite"><div><strong>${esc(month.month)}</strong><span>${month.commits} authored commits · ${month.activeDays} active days · ${month.releases} releases contributed to · ${month.driven} releases driven</span><small class="story-month-reading">${esc(monthInterpretation)}</small>${monthFindings.length?`<div class="story-month-links"><span>RELATED OBSERVATIONS</span>${monthFindings.map(f=>`<button type="button" data-action="story-inspect" data-story-id="${safeId(f.id)}">${esc(f.title)} ↗</button>`).join('')}</div>`:''}</div>${month.tags?.length?`<div class="story-tags">${month.tags.slice(0,8).map(t=>`<button type="button" data-action="story-release" data-story-release="${esc(t.hash)}" title="${esc(t.role)}: ${esc(t.tag)}">${esc(t.tag)} <span aria-hidden="true">↗</span></button>`).join('')}${month.tags.length>8?`<span>+${month.tags.length-8} more</span>`:''}</div>`:''}</div>`:''}
    <div class="story-chapters"><div class="story-subheading"><h5>Chapters in the observed history</h5><span>${person.years.length} calendar years</span></div>${chapters}</div>
    ${matchingFindings.length?`<div class="story-journey-discover"><strong>Possible turning points</strong><div>${matchingFindings.map(f=>`<button type="button" data-action="story-inspect" data-story-id="${safeId(f.id)}">${esc(f.title)} <span aria-hidden="true">↗</span></button>`).join('')}</div></div>`:''}
  </section>`;
}
/** Two comparable, author-local 7x24 patterns. Each person's own timed-commit
 * total is the denominator, and the positive-intensity scale is shared. */
function pairRhythms(model,a,b) {
  const left=model.people.find(p=>p.id===a.id)?.rhythm;
  const right=model.people.find(p=>p.id===b.id)?.rhythm;
  if(!left||!right)return '';
  const shapes=[left,right];
  const values=shapes.flatMap(shape=>shape.timed
    ?shape.counts.map(count=>count/shape.timed)
    :Array(168).fill(null));
  const scale=makeIntensityScale(values);
  const renderGrid=(person,shape)=>{
    const cells=DAY_NAMES.map((weekday,day)=>{
      const slots=Array.from({length:24},(_,hour)=>{
        const count=shape.counts[day*24+hour],value=shape.timed?count/shape.timed:null;
        const label=`${person.name} · ${weekday} ${String(hour).padStart(2,'0')}:00–${String(hour+1).padStart(2,'0')}:00 · ${count} ${count===1?'commit':'commits'}${shape.timed?` · ${(value*100).toPrecision(3)}% of timed commits`:' · timed data unavailable'}`;
        return `<span class="story-rhythm-cell" tabindex="0" role="img" title="${esc(label)}" aria-label="${esc(label)}" style="${intensityStyle(value,scale)}"></span>`;
      }).join('');
      return `<div class="story-rhythm-row"><span class="story-rhythm-day">${esc(weekday)}</span><div class="story-rhythm-cells">${slots}</div></div>`;
    }).join('');
    return `<section class="story-rhythm-person" aria-label="${esc(person.name)} timed authored activity by weekday and hour"><div class="story-rhythm-person-head"><strong>${esc(person.name)}</strong><span>${unit(shape.timed)} timed · ${unit(shape.unknown)} hour unknown</span></div>
      <div class="story-rhythm-scroll" tabindex="0" aria-label="Scroll sideways to view all 24 hourly columns"><div class="story-rhythm-chart"><div class="story-rhythm-hours"><span></span>${Array.from({length:24},(_,hour)=>`<span>${hour%6===0?String(hour).padStart(2,'0'):''}</span>`).join('')}</div>${cells}</div></div>
      <p class="story-note">${shape.timed<10?'Limited timed evidence: the displayed distribution may be unstable.':'Author-local timestamps, not inferred working hours.'}</p></section>`;
  };
  return `<div class="story-pattern-pair"><div class="story-subheading"><div><span class="story-section-index">WHEN ACTIVITY IS RECORDED</span><h5>Two weekly rhythms, one shared scale</h5></div></div>
    <p class="story-note">Each cell is its proportion of <strong>that contributor's timed authored commits</strong> in the current global scope. Colour uses the same positive-value scale across both people; the original count is available on hover or keyboard focus. Zero is neutral, missing time data is hatched.</p>
    <div class="story-rhythm-pair">${renderGrid(a,left)}${renderGrid(b,right)}</div>
    ${intensityLegend(scale,value=>`${Number((value*100).toPrecision(3))}%`,{missing:shapes.some(shape=>!shape.timed)})}
    <p class="story-note">Percentages communicate relative timing, not activity volume. For absolute counts use the Working Rhythm evidence view. A contributor's timezone offset is retained from each authored timestamp.</p></div>`;
}
function compare(model,first,second) {
  const rows=model.comparison;
  if(rows.length<2)return '<div class="story-empty"><h4>Compare two or more selected contributors</h4><p>Use the shared contributor picker above to select at least two people. This view never silently adds an unselected contributor.</p></div>';
  const a=rows.find(r=>r.id===first)||rows[0];
  const b=rows.find(r=>r.id===second&&r.id!==a.id)||rows.find(r=>r.id!==a.id);
  const options=rows.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  const maxWeekly=Math.max(1,...rows.map(r=>r.activeDaysPerWeek||0));
  const items=rows.map(r=>`<tr class="${r.id===a.id||r.id===b.id?'is-compared':''}"><th scope="row">${esc(r.name)}</th>
    <td><strong>${unit(r.activeDaysPerWeek)}</strong>${progressBar(r.activeDaysPerWeek,maxWeekly)}</td>
    <td>${r.medianGap==null?'—':`${unit(r.medianGap)} days`}</td>
    <td>${r.releasesEligible?`${r.releases} / ${r.releasesEligible} <small>(${pct(r.releaseCoverage)})</small>`:'—'}</td>
    <td>${unit(r.driven)}</td><td>${esc(r.topArea||'—')}</td></tr>`).join('');
  const activeA=a.activeDaysPerWeek,activeB=b.activeDaysPerWeek;
  const releaseDiff=a.releaseCoverage!=null&&b.releaseCoverage!=null?Math.abs(a.releaseCoverage-b.releaseCoverage):null;
  const comparable=releaseDiff!=null&&a.releasesEligible>=5&&b.releasesEligible>=5;
  let comparisonText='Their contributions differ in cadence and release involvement; inspect the denominators below before drawing conclusions.';
  if(comparable && releaseDiff<=.10 && activeA&&activeB && (Math.max(activeA,activeB)/Math.min(activeA,activeB)>=1.5))
    comparisonText=`${a.name} and ${b.name} appear in a similar share of observed tagged releases (within 10 percentage points), while their authored-active day frequency differs by at least 50%.`;
  else if(comparable && releaseDiff>.25)
    comparisonText=`${a.name} and ${b.name} differ by ${Math.round(releaseDiff*100)} percentage points in observed release participation. The scope and Git ancestry are shared, but participation is not an impact or performance score.`;
  else if(activeA&&activeB && Math.max(activeA,activeB)/Math.min(activeA,activeB)>=1.75)
    comparisonText=`Their authored-active day frequencies differ substantially, without indicating why or how much work was performed.`;
  else if(comparable)
    comparisonText=`Their observed release participation and authored-day rhythms are broadly comparable within the current selection; finer differences remain visible in the table.`;
  return `<section class="story-person-compare"><div class="story-subheading"><div><span class="story-section-index">SIMILARITIES & DIFFERENCES</span><h4>Compare patterns, not people as scores.</h4></div></div>
    <div class="story-person-pair"><label for="story-person-a">Contributor A<select id="story-person-a">${options}</select></label><span class="story-vs">↔</span><label for="story-person-b">Contributor B<select id="story-person-b">${options}</select></label></div>
    <div class="story-comparison-observation"><span class="story-section-index">A COMPARISON WORTH EXPLORING</span><p>${esc(comparisonText)}</p></div>
    ${pairRhythms(model,a,b)}
    <div class="story-subheading"><h5>Same global filters, different personal patterns</h5><span>${rows.length} selected people</span></div>
    <div class="story-table-wrap"><table class="story-compare-table story-people-table"><thead><tr><th>Contributor</th><th>Active days / calendar week</th><th>Typical internal gap</th><th>Tagged releases included in</th><th>Driven</th><th>Recent top area</th></tr></thead><tbody>${items}</tbody></table></div>
    <p class="story-note">Active-day frequency is measured from each person's first observed authored commit within the global scope, not an assumed joining date. Release fractions use ancestry-complete non-baseline tagged snapshots and author-scoped attribution. A contributor with fewer observed years is not necessarily less involved. The coloured bar represents only authored-active-day frequency.</p>
  </section>`;
}
export function renderStoryExplorer(model,ui) {
  if(!model)return '<div class="story-empty">Preparing evidence-led findings…</div>';
  const perspective=['team','person','compare'].includes(ui.perspective)?ui.perspective:'team';
  const found=model.people.find(p=>p.id===ui.focus&&p.id!=='selection');
  const person=perspective==='team'?model.people.find(p=>p.id==='selection'):(found||model.people.find(p=>p.id!=='selection'));
  const focusId=person?.id||'selection';
  const all=(perspective==='compare'?model.allFindings.filter(f=>f.subject!=='selection'):person?.findings||[]);
  const dismissed=new Set(ui.dismissed||[]);
  const mode=ui.category||'noteworthy';
  const topic=ui.topic||'all';
  const relevant=all.filter(f=>topic==='all'||f.type===topic);
  const visible=relevant.filter(f=>mode==='hidden'?dismissed.has(f.id):!dismissed.has(f.id));
  const limit=ui.showAll?30:4;
  const list=visible.slice(0,limit);
  const selected=model.allFindings.find(f=>f.id===ui.findingId&&relevant.some(r=>r.id===f.id));
  const compareOptions=model.people.filter(p=>p.id!=='selection').map(p=>`<option value="${esc(p.id)}" ${p.id===focusId?'selected':''}>${esc(p.name)}</option>`).join('');
  const currentMonth=ui.month&&person?.months.some(m=>m.month===ui.month)?ui.month:person?.months.at(-1)?.month;
  const trail=Array.isArray(ui.trail)?ui.trail.filter(id=>model.allFindings.some(f=>f.id===id)).slice(-5):[];
  const listTitle=perspective==='compare'?'People, patterns and transitions':perspective==='team'?'Signals across the selected group':`Signals about ${person?.name||'this contributor'}`;
  return `<div class="story-app">
    <header class="story-lede"><div><span class="story-section-index">GIT:SIGNALS / STORIES</span>
      <h3>The story so far<span class="story-title-dot">.</span></h3>
      <p>What changed, what's connected, and how has the relationship with this repository evolved?</p></div>
      <div class="story-lede-aside"><span>${unit(model.coverage.authorCommits)} authored commits</span><strong>${unit(model.coverage.releasesEligible)} release increments</strong><small>Local evidence · no black-box impact score</small></div></header>
    <div class="story-perspectives" role="group" aria-label="Story perspective">
      ${[['team','The team','Group signals'],['person','One contributor','Personal trajectory'],['compare','Compare people','Patterns, not rankings']].map(([key,label,sub])=>`<button type="button" class="story-perspective ${key===perspective?'is-current':''}" data-action="story-perspective" data-story-perspective="${key}" aria-pressed="${key===perspective}"><strong>${label}</strong><span>${sub}</span></button>`).join('')}
    </div>
    <div class="story-breadcrumb"><button type="button" data-action="story-back" ${!ui.findingId?'disabled':''}>Stories</button>${perspective==='person'?`<span aria-hidden="true">/</span><span>${esc(person?.name||'Contributor')}</span>`:''}${selected?`<span aria-hidden="true">/</span><span class="story-trail-last">${esc(selected.title)}</span>`:''}</div>
    <div class="story-toolbar"><label for="story-topic">Signal type <select id="story-topic"><option value="all" ${topic==='all'?'selected':''}>All observations</option>${Object.entries(types).map(([key,value])=>`<option value="${key}" ${topic===key?'selected':''}>${esc(value)}</option>`).join('')}</select></label>
      ${perspective==='person'?`<label for="story-focus">Person <select id="story-focus">${compareOptions}</select></label>`:''}
      <label for="story-card-filter">View <select id="story-card-filter"><option value="noteworthy" ${mode!=='hidden'?'selected':''}>Visible findings</option><option value="hidden" ${mode==='hidden'?'selected':''}>Hidden findings</option></select></label>
      <span class="story-toolbar-scope">${esc(scopeCopy(model))}</span></div>
    <div id="story-notice" class="story-notice" role="status" aria-live="polite"></div>
    <div class="story-content-grid">
      <div class="story-discover"><div class="story-subheading"><div><span class="story-section-index">01 / WHAT'S CHANGED</span><h4>${esc(listTitle)}</h4></div>${badge(`${visible.length} ${mode==='hidden'?'hidden':'visible'}`)}</div>
      ${list.length?`<div class="story-card-list">${list.map((f,i)=>mode==='hidden'
        ?`<div class="story-hidden-row"><span>${esc(f.title)}</span><button type="button" data-action="story-restore" data-story-id="${safeId(f.id)}">Restore</button></div>`
        :storyCard(f,i,selected?.id===f.id)).join('')}</div>`:`<div class="story-empty"><h4>${mode==='hidden'?'No hidden findings':'Nothing meets the evidence thresholds here'}</h4><p>${mode==='hidden'?'Dismissed observations can be restored from here.':'Try a longer authored-date window or a different contributor. The app does not invent a narrative when evidence is thin.'}</p></div>`}
      ${visible.length>limit&&!ui.showAll?`<button class="story-more" type="button" data-action="story-more">View ${visible.length-limit} more findings <span aria-hidden="true">↓</span></button>`:''}
      ${ui.showAll&&visible.length>4?`<button class="story-more" type="button" data-action="story-less">Show the essentials <span aria-hidden="true">↑</span></button>`:''}
      </div>
      <aside id="story-investigation-panel" class="story-investigation-panel" aria-live="polite">${detail(selected,model,model.people.find(p=>p.id===selected?.subject))}</aside>
    </div>
    ${trail.length?`<div class="story-trail"><strong>YOUR EXPLORATION TRAIL</strong>${trail.map(id=>{const f=model.allFindings.find(f=>f.id===id);return `<button type="button" data-action="story-inspect" data-story-id="${safeId(id)}">${esc(f.title)} ↗</button>`;}).join('')}</div>`:''}
    ${perspective==='compare'?compare(model,ui.pairA,ui.pairB):journey(person,currentMonth)}
    <aside class="story-coverage"><div><strong>Reading the evidence fairly</strong><p>Why findings may be absent—and what the imported data cannot tell us.</p></div><ul>
      <li>${esc(restricted[0])}</li><li>${esc(restricted[1])}</li><li>${esc(restricted[2])}</li>
      <li>${unit(model.coverage.incompleteReleases)} release snapshots have incomplete ancestry; ${unit(model.coverage.driversMapped)} of ${unit(model.coverage.releasesInScope)} release events have matched driver identities in this scope.</li></ul>
      <button type="button" class="story-link" data-action="story-evidence-general">Explore the raw evidence <span aria-hidden="true">↗</span></button></aside>
  </div>`;
}
