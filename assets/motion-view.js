/** Accessible, shared time-window playback for the Observatory's spatial lenses. */
import {MOTION_DESCRIPTORS,MOTION_TRAILS,MOTION_LABELS,motionPlotPosition,motionRegion} from './motion-explorer.js?v=git-ingest-input-20261113-1';
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const number=value=>Number.isFinite(value)?new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(value):'Unknown';
const pct=value=>Number.isFinite(value)?`${Math.round(value*100)}%`:'Unknown';
const pretty=value=>typeof value==='number'?number(value):value==null?'Unknown':String(value);
const round=n=>Math.round(n*100)/100;
const validPoint=(p,mode,domain)=>motionPlotPosition(p,mode,domain)!==null;
const viewBox=(mode,n)=>({width:640,height:mode==='level-strip'?Math.max(320,120+35*n):360});

export function motionMovement(scenes,identity,frameIndex) {
  const points=scenes.frames.slice(0,frameIndex+1).map(f=>f.people.find(p=>p.id===identity))
    .filter(p=>validPoint(p,scenes.mode,scenes.domain));
  if(!points.length)return {start:null,current:null,deltaX:null,deltaY:null,variation:null,label:'No comparable positions yet'};
  const start=points[0],current=points.at(-1),deltaX=round(current.x-start.x),deltaY=round(current.y-start.y);
  const norm=points.map(p=>motionPlotPosition(p,scenes.mode,scenes.domain));
  const gaps=norm.slice(1).map((p,i)=>Math.hypot(p.x-norm[i].x,p.y-norm[i].y));
  const variation=gaps.length?round(gaps.reduce((sum,v)=>sum+v,0)/gaps.length):null;
  const desc=MOTION_DESCRIPTORS[scenes.mode];
  const trend=(value,step)=>Math.abs(value)<=step?'broadly unchanged':value>0?'increased':'decreased';
  const x=trend(deltaX,desc.xScale==='linear'?.03:.05),y=trend(deltaY,desc.yScale==='signed'?5:desc.yScale==='linear'?.03:.05);
  const label=points.length<2?'Only one comparable position so far':
    `${desc.x} ${x.toLowerCase()}; ${desc.y} ${y.toLowerCase()}`;
  return {start,current,deltaX,deltaY,variation,label,comparablePoints:points.length};
}

function project(p,scenes,dimensions) {
  const normalized=motionPlotPosition(p,scenes.mode,scenes.domain);
  if(!normalized)return null;
  const left=scenes.mode==='level-strip'?176:89;
  const top=28,bottom=dimensions.height-78,width=dimensions.width-left-30;
  return {x:left+normalized.x*width,y:bottom-(bottom-top)*normalized.y};
}
const coord=n=>Number(n).toFixed(2);

function motionTrails(scenes,index,person,settings,dimensions,colour,selected) {
  if(settings.trail==='off')return '';
  const limit=settings.trail==='short'?Math.max(0,index-5):0;
  const fragments=[];let current=[];
  for(let i=limit;i<=index;i++){
    const point=scenes.frames[i].people.find(p=>p.id===person.id);
    const pos=project(point,scenes,dimensions);
    if(!pos){if(current.length>1)fragments.push(current);current=[];continue;}
    current.push(pos);
  }
  if(current.length>1)fragments.push(current);
  const opacity=selected?.id===person.id?.65:selected?.id?.08:.25;
  const lines=fragments.map(points=>{
    const last=points.at(-1),prev=points.at(-2);
    const angle=Math.atan2(last.y-prev.y,last.x-prev.x);
    const a={x:last.x-8*Math.cos(angle-.45),y:last.y-8*Math.sin(angle-.45)};
    const b={x:last.x-8*Math.cos(angle+.45),y:last.y-8*Math.sin(angle+.45)};
    return `<polyline points="${points.map(p=>`${coord(p.x)},${coord(p.y)}`).join(' ')}" fill="none" stroke="${esc(colour)}" stroke-width="${selected?.id===person.id?2.7:1.6}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/><path d="M${coord(a.x)} ${coord(a.y)}L${coord(last.x)} ${coord(last.y)}L${coord(b.x)} ${coord(b.y)}" fill="none" stroke="${esc(colour)}" stroke-width="2" opacity="${opacity}"/>`;
  }).join('');
  return lines;
}

export function renderMotionPlot(scenes,index,settings={},colours={},selectedId=null) {
  const frame=scenes.frames[index];
  if(!frame)return '';
  const desc=MOTION_DESCRIPTORS[scenes.mode],lane=scenes.mode==='level-strip';
  const dimensions=viewBox(scenes.mode,frame.people.length);
  const left=lane?176:89,top=28,right=dimensions.width-30,bottom=dimensions.height-78;
  const width=right-left,height=bottom-top;
  const projectValue=(x,y)=>project({x,y},scenes,dimensions);
  const reference=lane?null:projectValue(desc.xReference,desc.yReference);
  const bg=lane?`<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#fafcfb" stroke="#dbe3df" rx="5"/>`:
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#f8fbf9" stroke="#dbe3df" rx="5"/>
     <rect x="${left}" y="${top}" width="${reference.x-left}" height="${reference.y-top}" fill="#eef3f8" opacity=".7"/>
     <rect x="${reference.x}" y="${top}" width="${right-reference.x}" height="${reference.y-top}" fill="#eaf4ef" opacity=".65"/>
     <rect x="${left}" y="${reference.y}" width="${reference.x-left}" height="${bottom-reference.y}" fill="#faf4ed" opacity=".65"/>
     <line x1="${coord(reference.x)}" x2="${coord(reference.x)}" y1="${top}" y2="${bottom}" stroke="#82978c" stroke-dasharray="4 5"/>
     <line x1="${left}" x2="${right}" y1="${coord(reference.y)}" y2="${coord(reference.y)}" stroke="#82978c" stroke-dasharray="4 5"/>
     <g class="motion-region-titles"><text x="${left+8}" y="${top+16}">${esc(desc.regions[2].slice(0,32))}</text><text x="${right-8}" y="${top+16}" text-anchor="end">${esc(desc.regions[3].slice(0,32))}</text>
       <text x="${left+8}" y="${bottom-9}">${esc(desc.regions[0].slice(0,32))}</text><text x="${right-8}" y="${bottom-9}" text-anchor="end">${esc(desc.regions[1].slice(0,32))}</text></g>`;
  const formatAxis=(value,axis)=>{
    if(scenes.mode==='momentum'&&axis==='y')return `${value>0?'+':''}${number(value)}`;
    if(axis==='x'&&desc.xScale==='linear'||axis==='y'&&desc.yScale==='linear')return pct(value);
    return number(value);
  };
  const ticks=`<g class="motion-plot-ticks">
    <text x="${left}" y="${bottom+17}">0</text><text x="${right}" y="${bottom+17}" text-anchor="end">${formatAxis(scenes.domain.xMax,'x')}</text>
    ${!lane?`<text x="${left+2}" y="${top-8}">${formatAxis(scenes.domain.yMax,'y')}</text>
      <text x="${left+2}" y="${bottom-7}">${desc.yScale==='signed'?'-100':'0'}</text>
      <text x="${coord(reference.x)}" y="${bottom+17}" text-anchor="middle">${formatAxis(desc.xReference,'x')}</text>
      <text x="${left+4}" y="${coord(reference.y-6)}">${formatAxis(desc.yReference,'y')}</text>`:''}
    <text x="${(left+right)/2}" y="${dimensions.height-23}" text-anchor="middle">${esc(desc.x)}</text>
    ${!lane?`<text x="20" y="${(top+bottom)/2}" text-anchor="middle" transform="rotate(-90 20 ${(top+bottom)/2})">${esc(desc.y)}</text>`:''}</g>`;
  const trails=frame.people.map(p=>motionTrails(scenes,index,p,settings,dimensions,colours[p.id]||'#447e78',selectedId?{id:selectedId}:null)).join('');
  const markers=frame.people.map((p,i)=>{
    const pos=project(p,scenes,dimensions);
    if(!pos)return '';
    const colour=colours[p.id]||'#447e78';
    const radius=9+Math.min(5,Math.sqrt(Math.max(0,p.weight||0))/4);
    const dim=selectedId&&selectedId!==p.id;
    const hint=p.region||'Absolute recorded contribution';
    const label=`${p.name}. ${hint}. ${desc.x}: ${formatAxis(p.x,'x')}. ${desc.y}: ${formatAxis(p.y,'y')}. ${frame.from} through ${frame.to}.`;
    const leftSide=pos.x>right-92;
    const name=(settings.labels==='all'||selectedId===p.id)?`<text class="motion-point-name" x="${coord(pos.x+(leftSide?-radius-6:radius+5))}" y="${coord(pos.y-10)}" ${leftSide?'text-anchor="end"':''}>${esc(p.name.slice(0,23))}</text>`:'';
    const laneLabel=lane?`<text x="${left-12}" y="${coord(pos.y+4)}" text-anchor="end" class="motion-lane-name">${esc(p.name.slice(0,27))}</text>`:'';
    return `${laneLabel}<g class="motion-point${dim?' is-dimmed':''}${selectedId===p.id?' is-selected':''}" data-motion-person="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(label)}" aria-pressed="${String(selectedId===p.id)}">
      <circle cx="${coord(pos.x)}" cy="${coord(pos.y)}" r="${coord(radius+7)}" fill="transparent"/>
      <circle class="motion-point-disc" cx="${coord(pos.x)}" cy="${coord(pos.y)}" r="${coord(radius)}" fill="${esc(colour)}" stroke="#fff" stroke-width="2"/>
      <text x="${coord(pos.x)}" y="${coord(pos.y+3)}" text-anchor="middle" class="motion-point-index">${i+1}</text>${name}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${dimensions.width} ${dimensions.height}" role="group" aria-label="${esc(desc.title)} for ${esc(frame.from)} to ${esc(frame.to)}. Interactive contributor positions and fading history trails." xmlns="http://www.w3.org/2000/svg">${bg}${ticks}${trails}${markers}</svg>`;
}

const fmtDelta=n=>n===null?'Unknown':`${n>0?'+':''}${number(n)}`;
export function renderMotionInspector(scenes,index,id) {
  const frame=scenes.frames[index],person=frame?.people.find(p=>p.id===id);
  if(!person)return `<div class="motion-inspector-empty"><span>POINT INSPECTOR</span><strong>Select a contributor</strong><p>Hover or focus a marker or name to inspect their coordinates. Click or tap to pin it while scrubbing through time.</p></div>`;
  const desc=MOTION_DESCRIPTORS[scenes.mode];
  const movement=motionMovement(scenes,id,index);
  const evidence=Object.entries(person.evidence||{}).filter(([key,value])=>value!==null&&value!==undefined&&
    !['reason'].includes(key)).slice(0,9);
  return `<div class="motion-inspector-content"><span class="eyebrow">${esc(frame.from)} - ${esc(frame.to)}</span><h4>${esc(person.name)}</h4>
    <p class="motion-region">${person.region?esc(person.region):'No descriptive quadrant for this view'}</p>
    ${person.x===null?`<p class="motion-unavailable">${esc(person.reason)}</p>`:`<div class="motion-inspector-axes"><div><small>${esc(desc.x)}</small><strong>${scenes.mode==='level-strip'?number(person.x):desc.xScale==='linear'?pct(person.x):number(person.x)}</strong></div><div><small>${esc(desc.y)}</small><strong>${desc.yScale==='signed'?fmtDelta(person.y):desc.yScale==='linear'?pct(person.y):number(person.y)}</strong></div></div>`}
    <div class="motion-movement"><strong>Movement since first comparable window</strong><p>${esc(movement.label)}</p><div class="motion-movement-numbers"><span>X ${fmtDelta(movement.deltaX)}</span><span>Y ${fmtDelta(movement.deltaY)}</span><span>Avg step ${movement.variation===null?'Unknown':number(movement.variation)}</span></div></div>
    ${evidence.length?`<details class="motion-evidence" open><summary>Recorded evidence</summary><dl>${evidence.map(([k,v])=>`<div><dt>${esc(k.replace(/([A-Z])/g,' $1').toLowerCase())}</dt><dd>${esc(pretty(v))}</dd></div>`).join('')}</dl></details>`:''}</div>`;
}

export function renderMotionExplorer(scenes,settings={},colours={}) {
  const desc=MOTION_DESCRIPTORS[scenes.mode];
  if(!scenes.frames.length)return `<section class="motion-explorer motion-empty" data-motion-explorer><strong>Not enough complete calendar weeks for motion playback</strong><p>Choose a shorter window or expand the selected date range. Playback never fills partially observed weeks with invented zeros.</p><label class="motion-empty-choice">Window <select data-motion-empty-window aria-label="Choose a shorter time window">${[4,8,12,20].map(n=>`<option value="${n}" ${n===scenes.weeks?'selected':''}>${n} weeks</option>`).join('')}</select></label></section>`;
  const latest=scenes.frames.at(-1);
  const legend=latest.people.map((p,i)=>`<button type="button" class="motion-legend-person" data-motion-person="${esc(p.id)}" aria-pressed="false"><i style="background:${esc(colours[p.id]||'#447e78')}" aria-hidden="true"></i><span class="motion-legend-index">${i+1}</span><span>${esc(p.name)}</span></button>`).join('');
  const selectedIndex=Number.isInteger(settings.index)&&settings.index>=0&&settings.index<scenes.frames.length?settings.index:scenes.frames.length-1;
  const timeline=scenes.frames[selectedIndex];
  return `<section class="motion-explorer" data-motion-explorer aria-label="${esc(desc.title)} time explorer">
    <header class="motion-explorer-heading"><div><span class="eyebrow">TIME EXPLORER</span><h3>${esc(desc.title)}</h3><p>${esc(desc.caution)}</p></div><span class="motion-window-badge">${scenes.weeks} weeks / frame</span></header>
    <div class="motion-settings"><label>Window <select data-motion-setting="weeks" aria-label="Moving comparison window">${[4,8,12,20].map(n=>`<option value="${n}" ${n===scenes.weeks?'selected':''}>${n} weeks</option>`).join('')}</select></label>
      <label>Step <select data-motion-setting="step" aria-label="Time between frames">${[1,2,4].map(n=>`<option value="${n}" ${n===scenes.step?'selected':''}>${n} ${n===1?'week':'weeks'}</option>`).join('')}</select></label>
      <label>Trail <select data-motion-setting="trail" aria-label="Historical point trails">${MOTION_TRAILS.map(v=>`<option value="${v}" ${v===(settings.trail||'short')?'selected':''}>${v==='short'?'Last 5':v==='full'?'Full': 'Off'}</option>`).join('')}</select></label>
      <label>Labels <select data-motion-setting="labels" aria-label="Visible point labels">${MOTION_LABELS.map(v=>`<option value="${v}" ${v===(settings.labels||'hover')?'selected':''}>${v==='hover'?'On hover':v==='all'?'All':'None'}</option>`).join('')}</select></label>
      ${scenes.mode==='level'||scenes.mode==='level-strip'?`<label>Display <select data-motion-setting="levelDisplay" aria-label="Absolute Velocity spatial display"><option value="strip" ${scenes.mode==='level-strip'?'selected':''}>Distance strip</option><option value="map" ${scenes.mode==='level'?'selected':''}>Velocity map</option></select></label>`:''}</div>
    <div class="motion-playback" role="group" aria-label="Time playback controls"><button type="button" data-motion-command="first" aria-label="First time window">|&lt;</button><button type="button" data-motion-command="previous" aria-label="Previous time window">&lt;</button>
      <button type="button" class="motion-play-button" data-motion-command="play" aria-label="Play time windows">Play</button><button type="button" data-motion-command="next" aria-label="Next time window">&gt;</button><button type="button" data-motion-command="last" aria-label="Last time window">&gt;|</button>
      <label class="motion-range"><span class="sr-only">Time window position</span><input type="range" data-motion-scrub min="0" max="${scenes.frames.length-1}" value="${selectedIndex}" step="1" aria-label="Scrub time windows" aria-valuetext="${esc(timeline.from)} to ${esc(timeline.to)}"/></label>
      <output class="motion-frame-label" data-motion-frame-label aria-live="polite">${esc(timeline.from)} to ${esc(timeline.to)} · ${selectedIndex+1}/${scenes.frames.length}</output></div>
    <div class="motion-legend" aria-label="Select a contributor to spotlight">${legend}</div>
    <div class="motion-map-grid"><div class="motion-plot-viewport"><div class="motion-plot-stage"><div class="motion-plot" data-motion-plot>${renderMotionPlot(scenes,selectedIndex,settings,colours)}</div><div class="motion-hover-tag" data-motion-tag hidden aria-hidden="true"></div></div></div>
      <aside class="motion-point-inspector" data-motion-inspector aria-live="polite">${renderMotionInspector(scenes,selectedIndex,null)}</aside></div>
    <p class="motion-map-caption"><span data-motion-available>${latest.people.filter(p=>validPoint(p,scenes.mode,scenes.domain)).length} of ${latest.people.length} positioned in the latest window.</span> Plot coordinates and axis scales stay fixed throughout playback; line trails connect only consecutive comparable observations. Marker size conveys recorded evidence, not quality. Select a person for their exact measurements and start-to-current movement.</p>
  </section>`;
}

/** Real-time playback updates only the explorer, never the analysis dashboard. */
export function bindMotionExplorer(root,scenes,initialSettings={},colours={},onSettingChange=()=>{}) {
  const wrap=root?.querySelector('[data-motion-explorer]');
  if(!wrap)return ()=>{};
  if(!scenes.frames.length){
    wrap.querySelector('[data-motion-empty-window]')?.addEventListener('change',event=>{const weeks=Number(event.target.value);if([4,8,12,20].includes(weeks))onSettingChange('weeks',weeks,true);});
    return ()=>{};
  }
  let settings={...initialSettings};
  let index=Number.isInteger(settings.index)&&settings.index>=0&&settings.index<scenes.frames.length?settings.index:scenes.frames.length-1;
  let selected=initialSettings.selectedId&&scenes.frames[0].people.some(p=>p.id===initialSettings.selectedId)?initialSettings.selectedId:null;
  let preview=null,timer=null;
  const plot=wrap.querySelector('[data-motion-plot]'),inspector=wrap.querySelector('[data-motion-inspector]');
  const slider=wrap.querySelector('[data-motion-scrub]'),label=wrap.querySelector('[data-motion-frame-label]');
  const play=wrap.querySelector('[data-motion-command="play"]'),tag=wrap.querySelector('[data-motion-tag]');
  const stop=()=>{if(timer!==null){clearInterval(timer);timer=null;}play.textContent='Play';play.setAttribute('aria-label','Play time windows');};
  const setHighlight=()=>{
    const active=preview||selected;
    for(const button of wrap.querySelectorAll('[data-motion-person]')){
      button.classList.toggle('is-inspected',button.dataset.motionPerson===active);
      button.setAttribute('aria-pressed',String(button.dataset.motionPerson===selected));
    }
    inspector.innerHTML=renderMotionInspector(scenes,index,active);
  };
  const update=(next,refresh=true)=>{
    index=Math.max(0,Math.min(scenes.frames.length-1,next));
    const frame=scenes.frames[index];
    slider.value=String(index);slider.setAttribute('aria-valuetext',`${frame.from} to ${frame.to}`);
    label.textContent=`${frame.from} to ${frame.to} · ${index+1}/${scenes.frames.length}`;
    if(refresh)plot.innerHTML=renderMotionPlot(scenes,index,settings,colours,selected);
    wrap.querySelector('[data-motion-available]').textContent=`${frame.people.filter(p=>validPoint(p,scenes.mode,scenes.domain)).length} of ${frame.people.length} positioned in this window.`;
    preview=null;tag.hidden=true;setHighlight();
  };
  const showTag=(el,id)=>{
    const point=scenes.frames[index].people.find(p=>p.id===id);
    if(!point)return;
    tag.textContent=`${point.name} · ${point.region||'Absolute level'}`;
    tag.hidden=false;
    const box=el.getBoundingClientRect(),area=wrap.querySelector('.motion-plot-stage').getBoundingClientRect();
    tag.style.left=`${Math.max(4,Math.min(box.left+box.width/2-area.left-tag.offsetWidth/2,area.width-tag.offsetWidth-4))}px`;
    tag.style.top=`${Math.max(3,box.top-area.top-tag.offsetHeight-10)}px`;
  };
  const inspect=(target)=>{
    const node=target.closest?.('[data-motion-person]');
    if(!node||!wrap.contains(node)||node.dataset.motionPerson===preview)return;
    preview=node.dataset.motionPerson;setHighlight();
    if(node.closest('[data-motion-plot]'))showTag(node,preview);else tag.hidden=true;
  };
  wrap.addEventListener('pointerover',event=>inspect(event.target));
  wrap.addEventListener('pointerout',event=>{
    if(event.target.closest?.('[data-motion-person]')&&
       (!event.relatedTarget?.closest?.('[data-motion-person]')||!wrap.contains(event.relatedTarget))){preview=null;tag.hidden=true;setHighlight();}
  });
  wrap.addEventListener('focusin',event=>inspect(event.target));
  wrap.addEventListener('focusout',event=>{
    if(event.target.closest?.('[data-motion-person]')&&
       (!event.relatedTarget?.closest?.('[data-motion-person]')||!wrap.contains(event.relatedTarget))){preview=null;tag.hidden=true;setHighlight();}
  });
  const selectId=id=>{selected=selected===id?null:id;preview=null;tag.hidden=true;update(index);onSettingChange('selectedId',selected,false);};
  wrap.addEventListener('click',event=>{
    const person=event.target.closest?.('[data-motion-person]');
    if(person){selectId(person.dataset.motionPerson);return;}
    const command=event.target.closest?.('[data-motion-command]')?.dataset.motionCommand;
    if(!command)return;
    if(command==='play'){
      if(timer!==null){stop();return;}
      if(index===scenes.frames.length-1)update(0);
      play.textContent='Pause';play.setAttribute('aria-label','Pause time windows');
      timer=setInterval(()=>{if(index>=scenes.frames.length-1){stop();return;}update(index+1);onSettingChange('index',index,false);},950);
      return;
    }
    stop();const target={first:0,previous:index-1,next:index+1,last:scenes.frames.length-1}[command];
    if(target!==undefined){update(target);onSettingChange('index',index,false);}
  });
  wrap.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(selected){selected=null;preview=null;update(index);onSettingChange('selectedId',null,false);}return;}
    if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-motion-plot] [data-motion-person]')){
      event.preventDefault();selectId(event.target.closest('[data-motion-person]').dataset.motionPerson);
    }
  });
  slider.addEventListener('input',()=>{stop();update(Number(slider.value));onSettingChange('index',index,false);});
  wrap.addEventListener('change',event=>{
    const input=event.target.closest?.('[data-motion-setting]');if(!input)return;
    const setting=input.dataset.motionSetting,value=['weeks','step'].includes(setting)?Number(input.value):input.value;
    if(['weeks','step','levelDisplay'].includes(setting)){stop();onSettingChange(setting,value,true);return;}
    if(setting==='trail'&&MOTION_TRAILS.includes(value)||setting==='labels'&&MOTION_LABELS.includes(value)){
      settings[setting]=value;onSettingChange(setting,value,false);update(index);
    }
  });
  const onVisibility=()=>{if(document.hidden)stop();};
  document.addEventListener('visibilitychange',onVisibility);
  wrap.querySelector('.motion-plot-viewport')?.addEventListener('scroll',()=>{tag.hidden=true;},{passive:true});
  update(index);
  return ()=>{stop();document.removeEventListener('visibilitychange',onVisibility);};
}
