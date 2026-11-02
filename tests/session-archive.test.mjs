import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {encodeSessionArchive, decodeSessionArchive} from '../assets/session-archive.js';

const named = (blob, name) => Object.assign(blob, {name});
const sample = (version = 3) => ({
  version, exportedAt: '2026-11-02T14:00:00Z',
  rawLog: `COMMIT|${'a'.repeat(40)}|person@domain.test|Person|2026-11-01T12:00:00Z|2026-11-01T12:05:00Z|feat: refine — naïve 🚀|\n15\t2\tapp/main.rb\n` .repeat(2000),
  mergeGroups: [{displayName:'Person • Λ', emails:['person@domain.test','alias@domain.test']}],
  scope: {selectedEmails:['person@domain.test'], impactActorMap:{publisher:'person@domain.test'}, primary:{mode:'observatory',releaseHash:'a'.repeat(40)}},
});

test('export is a standard gzip-compressed, lossless JSON session with useful compression', async () => {
  const original=sample();const stages=[];
  const result=await encodeSessionArchive(original,{onProgress:p=>stages.push(p.phase)});
  assert.equal(result.compressed,true);
  assert.equal(result.blob.type,'application/gzip');
  assert.ok(result.blob.size<result.originalBytes/5, `expected Git history to compress (${result.blob.size}/${result.originalBytes})`);
  const gunzipped=gunzipSync(Buffer.from(await result.blob.arrayBuffer())).toString('utf8');
  assert.deepEqual(JSON.parse(gunzipped),original,'standard gunzip tools can recover exactly the session payload');
  assert.deepEqual(await decodeSessionArchive(named(result.blob,'session.json.gz')), original);
  assert.ok(stages.includes('Compressing session'));
});

test('legacy uncompressed JSON sessions remain importable, including old schema versions',async()=>{
  for(const version of [1,2,3]){
    const original=sample(version);
    const old=named(new Blob([JSON.stringify(original,null,2)],{type:'application/json'}),'old-session.json');
    assert.deepEqual(await decodeSessionArchive(old),original);
    const fallback=await encodeSessionArchive(original,{compress:false});
    assert.equal(fallback.compressed,false);
    assert.equal(fallback.blob.type,'application/json');
    assert.deepEqual(await decodeSessionArchive(named(fallback.blob,'session.json')),original);
  }
});

test('a browser without native gzip support still exports usable legacy JSON',async()=>{
  const was=globalThis.CompressionStream;
  try {
    globalThis.CompressionStream=undefined;
    const original=sample();
    const archive=await encodeSessionArchive(original);
    assert.equal(archive.compressed,false);
    assert.deepEqual(await decodeSessionArchive(named(archive.blob,'session.json')),original);
  } finally {globalThis.CompressionStream=was;}
});

test('gzip import gives clear remediation when a browser cannot decompress',async()=>{
  const original=sample();const archive=await encodeSessionArchive(original);
  const was=globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream=undefined;
    await assert.rejects(decodeSessionArchive(named(archive.blob,'session.json.gz')), /up-to-date browser|decompress/);
  } finally {globalThis.DecompressionStream=was;}
});

test('archive format is sniffed from bytes, not trusted filename or MIME',async()=>{
  const original=sample();const archive=await encodeSessionArchive(original);
  assert.deepEqual(await decodeSessionArchive(named(archive.blob,'renamed.json')),original);
  await assert.rejects(decodeSessionArchive(named(new Blob(['plain text']), 'broken.json.gz')), /not a valid gzip archive/);
  await assert.rejects(decodeSessionArchive(named(new Blob(['not json']), 'broken.json')), /not valid JSON/);
  await assert.rejects(decodeSessionArchive(named(new Blob([Uint8Array.from([0x1f,0x8b,0x01,0x00])]), 'damaged.json.gz')), /Could not decompress/);
});

test('bounded decompression protects against oversized or hostile archives',async()=>{
  const payload=sample();
  const result=await encodeSessionArchive(payload);
  await assert.rejects(decodeSessionArchive(named(result.blob,'session.json.gz'),{maxBytes:1000}),/safety limit/);
  const raw=named(new Blob([JSON.stringify(payload)]),'session.json');
  await assert.rejects(decodeSessionArchive(raw,{maxBytes:1000}),/safety limit/);
});

test('dedicated analysis worker can encode and decode sessions without JSON work on main thread',async()=>{
  const worker=new Worker(new URL('./worker-entry.mjs',import.meta.url),{type:'module'});
  let nextId=0;const phases=[];
  const call=(type,input)=>new Promise((resolve,reject)=>{
    const id=++nextId;
    const onMessage=message=>{
      if(message.id!==id)return;
      if(message.type==='progress'){phases.push(message.phase);return;}
      worker.off('message',onMessage);
      if(message.type==='error')reject(new Error(message.message));else resolve(message.result);
    };
    worker.on('message',onMessage);
    worker.postMessage({id,type,...input});
  });
  try {
    const original=sample();
    const archive=await call('session-export',{payload:original});
    assert.equal(archive.compressed,true);
    const imported=await call('session-import',{file:archive.blob});
    assert.deepEqual(imported,original);
    assert.ok(phases.includes('Compressing session')&&phases.includes('Decompressing session'));
  } finally {await worker.terminate();}
});
