/** Opt-in IndexedDB evidence cache for true multi-tab permalinks; no network. */
const DB='git-signals-local-evidence',STORE='sessions';
const open=()=>new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(new Error('IndexedDB is unavailable'));
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Browser storage unavailable'));
});
async function transact(mode,fn){
  const db=await open();
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);const request=fn(tx.objectStore(STORE));
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Browser storage failed'));
    tx.onabort=()=>reject(tx.error||new Error('Browser storage unavailable'));
  });}finally{db.close();}
}
export async function saveLocalHistory(key,payload){
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new Error('Invalid local session key');
  return transact('readwrite',store=>store.put({savedAt:Date.now(),payload},key));
}
export async function readLocalHistory(key){
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))return null;
  const entry=await transact('readonly',store=>store.get(key));
  // 30-day bound and user-controlled removal; no automatic remote sharing.
  if(entry&&Date.now()-entry.savedAt>=30*86400_000){await deleteLocalHistory(key);return null;}
  return entry?.payload||null;
}
export async function deleteLocalHistory(key){
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))return;
  await transact('readwrite',store=>store.delete(key));
}
