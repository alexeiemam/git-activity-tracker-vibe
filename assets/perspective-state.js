/** Bounded, browser-independent navigation state for the three primary perspectives. */
export const primaryDefaults=()=>({
  mode:'observatory',cohortBy:'type',releaseHash:null,releaseType:'all',releaseYear:'all',releaseQuery:'',releasePage:0,releaseBin:null,
  periodPreset:'14',periodFrom:null,periodTo:null,periodComparison:'previous',compareFrom:null,compareTo:null,
  periodBucket:null,periodSelectedId:null,periodFocusPerson:null,periodFocusArea:null,
  contributorFocus:null,contributorTab:'delivery',contributorRange:'all',compareB:null,compareC:null,
  coReleasePartner:null,coReleaseSort:'shared',
  codeArea:null,codebaseRange:'all',trail:[],
});
const keys=['contributorFocus','compareB','compareC','coReleasePartner','periodSelectedId','periodFocusPerson'];
const accepted={
  mode:['observatory','periods','contributors','codebase'],cohortBy:['type','driver','year'],
  releaseType:['all','major','minor','patch','prerelease','unclassified','divergent','baseline','same-version'],
  periodComparison:['none','previous','year','custom'],
  contributorTab:['delivery','together','focus','behaviour','evolution','compare'],
  coReleaseSort:['shared','overlap'],
  contributorRange:['all','year','period'],codebaseRange:['all','period'],
};
const safeValue=(name,val)=>name==='releasePage'
  ? Number.isInteger(val)&&val>=0&&val<=100000
  : val===null||(typeof val==='string'&&val.length<=200);

export function restorePrimaryState(scope,groups=[]) {
  const state=primaryDefaults(),safe=scope?.primary;
  if(!safe||typeof safe!=='object'||Array.isArray(safe))return state;
  for(const key of Object.keys(state)){
    if(key==='trail'||!Object.hasOwn(safe,key)||!safeValue(key,safe[key]))continue;
    state[key]=safe[key];
  }
  for(const [key,values] of Object.entries(accepted))if(!values.includes(state[key]))state[key]=primaryDefaults()[key];
  for(const key of ['periodFrom','periodTo','compareFrom','compareTo'])
    if(state[key]&&!/^\d{4}-\d{2}-\d{2}$/.test(state[key]))state[key]=null;
  if(state.periodFrom&&state.periodTo&&state.periodFrom>state.periodTo){state.periodFrom=null;state.periodTo=null;}
  if(Array.isArray(safe.trail))state.trail=safe.trail.filter(v=>v&&accepted.mode.includes(v.mode)).slice(-8)
    .map(v=>Object.fromEntries(Object.entries(v).filter(([k,val])=>k!=='trail'&&k!=='label'&&Object.hasOwn(state,k)&&safeValue(k,val))));
  // Contributors are reconciled by stable author email. Array indexes change
  // when identities are merged or newly detected in imported session history.
  const handles=safe.identityEmails;
  if(handles&&typeof handles==='object'&&!Array.isArray(handles))for(const key of keys){
    if(typeof handles[key]!=='string')continue;
    const email=handles[key].toLowerCase();
    const id=groups.findIndex(g=>g.emails?.some(e=>e.toLowerCase()===email));
    state[key]=id>=0?String(id):null;
  }
  return state;
}
export function primaryStateForExport(primary,groups=[]){
  const identityEmails=Object.fromEntries(keys.map(key=>{
    const id=primary[key];
    const valid=id!=null && /^\d+$/.test(String(id)) ? Number(id) : -1;
    return [key,valid>=0?groups[valid]?.emails?.[0]||null:null];
  }));
  return {...primary,trail:(primary.trail||[]).slice(-8),identityEmails};
}
