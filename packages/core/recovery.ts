import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import type {CopyEvidence,CopyState,RecoveryState,Explanation,FileRow} from '../../apps/desktop/api.js';
import {backendAvailable,getSnapshot,listSnapshots,objectPath,readObject,type Repository,type SnapshotRecord} from './repository.js';
import {checkCancelled,readBounded,noSymlinks,type OperationOptions} from './fs.js';
import {recordScan} from './catalog.js';
import {canonical,sha,type Chunk,type Entry} from './schema.js';
export interface HealthScan {id:string;repositoryId:string;at:string;deep:boolean;durationMs:number;copies:Record<string,CopyEvidence[]>;counts:Record<string,number>;scope:string[];invalidFiles:string[];}
export function classify(copies:CopyEvidence[][]):RecoveryState{
 if(copies.every(cs=>cs.some(c=>c.state==='VERIFIED_OK')))return 'VERIFIED_RECOVERABLE';
 const impossible=copies.some(cs=>cs.every(c=>c.state==='MISSING'||c.state==='CORRUPT'));
 if(impossible)return 'KNOWN_UNRECOVERABLE';
 if(copies.some(cs=>!cs.some(c=>c.state==='VERIFIED_OK')&&cs.some(c=>c.state==='BACKEND_UNAVAILABLE'||c.state==='IO_ERROR')))return 'UNKNOWN';
 return 'PRESENT_BUT_UNVERIFIED';
}
export async function scanHealth(repo:Repository,deep=true,options:OperationOptions={}):Promise<HealthScan>{
 const records=await listSnapshots(repo);const start=performance.now(),chunks=new Map<string,Chunk>();for(const s of records)for(const e of s.manifest?.entries||[])if(e.type==='file')for(const c of e.chunks){const previous=chunks.get(c.hash);if(previous&&previous.size!==c.size)throw new Error('INVALID_METADATA: conflicting chunk lengths');chunks.set(c.hash,c);}
 const copies:HealthScan['copies']={},counts:Record<string,number>={};let n=0;
 const accessible=await Promise.all([backendAvailable(repo,0),backendAvailable(repo,1)]);
 for(const c of chunks.values()){
  checkCancelled(options);copies[c.hash]=[];
  for(let b=0;b<2;b++){
   let state:CopyState,detail:string|undefined;
   if(!accessible[b])state='BACKEND_UNAVAILABLE';else if(repo.ioErrors?.has(b))state='IO_ERROR';else try{
    if(deep){await readObject(repo,b,c);state='VERIFIED_OK';}else{const p=objectPath(repo.config.roots[b],c.hash);await noSymlinks(p);const s=await fs.lstat(p);state=s.isFile()?'NOT_YET_VERIFIED':'CORRUPT';}
   }catch(e){const code=(e as NodeJS.ErrnoException).code;state=code==='ENOENT'?'MISSING':code==='CORRUPT'?'CORRUPT':code==='UNAVAILABLE'?'BACKEND_UNAVAILABLE':'IO_ERROR';detail=(e as Error).message;}
   copies[c.hash].push({backend:b?'B':'A',state,...(detail?{detail}:{})});counts[state]=(counts[state]||0)+1;
  }options.onProgress?.({phase:deep?'deep-scan':'quick-scan',completed:++n,total:chunks.size,detail:c.hash});
 }
 const invalidFiles:string[]=[];const checkedFiles=new Set<string>();if(deep)for(const row of records)for(const entry of row.manifest?.entries||[]){if(entry.type!=='file')continue;const key=fileKey(entry);if(checkedFiles.has(key))continue;checkedFiles.add(key);if(!entry.chunks.every(c=>copies[c.hash]?.some(x=>x.state==='VERIFIED_OK')))continue;const hash=createHash('sha256');let complete=true;for(const chunk of entry.chunks){checkCancelled(options);let data:Buffer|undefined;for(let b=0;b<2;b++)if(copies[chunk.hash][b].state==='VERIFIED_OK')try{data=await readObject(repo,b,chunk);break;}catch{/* changed during scan; fail conservatively below */}if(!data){complete=false;for(const copy of copies[chunk.hash])if(copy.state==='VERIFIED_OK')copy.state='IO_ERROR';break;}hash.update(data);}if(complete&&hash.digest('hex')!==entry.hash)invalidFiles.push(key);}
 for(const key of Object.keys(counts))delete counts[key];for(const copiesForChunk of Object.values(copies))for(const copy of copiesForChunk)counts[copy.state]=(counts[copy.state]||0)+1;
 const scan:HealthScan={invalidFiles,id:randomUUID(),repositoryId:repo.config.id,at:new Date().toISOString(),deep,durationMs:performance.now()-start,copies,counts,scope:repo.config.roots};await recordScan(repo,scan);return scan;
}
export async function loadScan(repo:Repository):Promise<HealthScan|undefined>{try{const scan=JSON.parse((await readBounded(path.join(repo.home,'latest-scan.json'))).toString()) as HealthScan;if(scan.repositoryId!==repo.config.id)return;return scan;}catch{return;}}
function fileKey(entry:Entry){return sha(canonical(entry.type==='file'?{hash:entry.hash,chunks:entry.chunks,size:entry.size}:entry));}
export function entryState(entry:Entry,scan?:HealthScan):RecoveryState{
 if(entry.type==='directory')return 'VERIFIED_RECOVERABLE';if(scan?.invalidFiles?.includes(fileKey(entry)))return 'INVALID_METADATA';
 return classify(entry.chunks.map(c=>scan?.copies[c.hash]||[{backend:'A',state:'NOT_YET_VERIFIED'},{backend:'B',state:'NOT_YET_VERIFIED'}]));
}
export function emptyCounts():Record<RecoveryState,number>{return {VERIFIED_RECOVERABLE:0,PRESENT_BUT_UNVERIFIED:0,UNKNOWN:0,KNOWN_UNRECOVERABLE:0,INVALID_METADATA:0};}
export function analyzeFrontier(records:SnapshotRecord[],scan?:HealthScan){return records.map(row=>{
 const counts=emptyCounts();if(!row.manifest)counts.INVALID_METADATA=1;else for(const e of row.manifest.entries)if(e.type==='file')counts[entryState(e,scan)]++;
 let state:RecoveryState='VERIFIED_RECOVERABLE';if(counts.INVALID_METADATA)state='INVALID_METADATA';else if(counts.KNOWN_UNRECOVERABLE)state='KNOWN_UNRECOVERABLE';else if(counts.UNKNOWN)state='UNKNOWN';else if(counts.PRESENT_BUT_UNVERIFIED)state='PRESENT_BUT_UNVERIFIED';
 return {id:row.id,createdAt:row.manifest?.createdAt||'',label:row.manifest?.label||'Invalid metadata',files:row.manifest?.entries.filter(e=>e.type==='file').length||0,bytes:row.manifest?.entries.reduce((n,e)=>n+(e.type==='file'?e.size:0),0)||0,state,counts,degraded:row.degraded};
 });}
export function fileRows(record:SnapshotRecord|undefined,scan:HealthScan|undefined,offset=0,search='',filter?:RecoveryState):{files:FileRow[];totalFiles:number}{
 const rows=(record?.manifest?.entries||[]).filter(e=>e.path.toLowerCase().includes(search.toLowerCase())).map(e=>({path:e.path,type:e.type,size:e.type==='file'?e.size:0,hash:e.type==='file'?e.hash:undefined,chunks:e.type==='file'?e.chunks.length:0,state:entryState(e,scan),snapshotId:record!.id})).filter(e=>!filter||e.state===filter);
 return {files:rows.slice(offset,offset+50),totalFiles:rows.length};
}
export async function explain(repo:Repository,snapshotId:string,filePath:string,scan?:HealthScan):Promise<Explanation>{
 const m=await getSnapshot(repo,snapshotId);const entry=m.entries.find(e=>e.path===filePath);if(!entry)throw new Error('File version not found');const records=await listSnapshots(repo);let start=0;
 const chunks=entry.type==='file'?entry.chunks.map(c=>{const at=start;start+=c.size;let affectedVersions=0;for(const row of records)for(const e of row.manifest?.entries||[])if(e.type==='file'&&e.chunks.some(x=>x.hash===c.hash))affectedVersions++;return {hash:c.hash,size:c.size,start:at,end:start,copies:scan?.copies[c.hash]||[{backend:'A',state:'NOT_YET_VERIFIED' as const},{backend:'B',state:'NOT_YET_VERIFIED' as const}],affectedVersions};}):[];
 const state=entryState(entry,scan);const reasons:Record<RecoveryState,string>={VERIFIED_RECOVERABLE:'Every required chunk had at least one hash-verified accessible copy at scan time. Restore rechecks all bytes.',PRESENT_BUT_UNVERIFIED:'Some required bytes have not been read and hash-verified. Run a deep scan.',UNKNOWN:'Required bytes have no verified source, but an unavailable or unreadable backend may still hold them.',KNOWN_UNRECOVERABLE:'At least one required chunk is missing or corrupt on every configured backend in this completed scan.',INVALID_METADATA:'No valid committed manifest.'};
 return {snapshotId,path:filePath,hash:entry.type==='file'?entry.hash:undefined,state,reason:reasons[state],chunks,alternatives:records.filter(r=>r.id!==snapshotId).flatMap(r=>{const e=r.manifest?.entries.find(e=>e.path===filePath);return e?[{snapshotId:r.id,state:entryState(e,scan)}]:[];})};
}

/** Reclassifies only reverse-indexed file versions affected by changed object digests. */
export async function propagateImpact(repo:Repository,scan:HealthScan,changedHashes:string[]){
 const {references}=await import('./catalog.js');const versions=new Map<string,{snapshotId:string;path:string;state:RecoveryState}>();const records=new Map((await listSnapshots(repo)).map(s=>[s.id,s]));
 for(const hash of changedHashes)for(const ref of await references(repo,hash)){
  const snapshotId=String(ref.snapshot),filePath=String(ref.path),key=snapshotId+'\0'+filePath;if(versions.has(key))continue;const entry=records.get(snapshotId)?.manifest?.entries.find(e=>e.path===filePath);if(entry)versions.set(key,{snapshotId,path:filePath,state:entryState(entry,scan)});
 }
 return [...versions.values()];
}

export async function planRecovery(repo:Repository,scan:HealthScan){
 const records=await listSnapshots(repo),frontier=analyzeFrontier(records,scan);const newest=new Map<string,{path:string;snapshotId:string;hash:string;size:number}>();
 for(const record of [...records].reverse())for(const entry of record.manifest?.entries||[])if(entry.type==='file'&&!newest.has(entry.path)&&entryState(entry,scan)==='VERIFIED_RECOVERABLE')newest.set(entry.path,{path:entry.path,snapshotId:record.id,hash:entry.hash,size:entry.size});
 return {newestComplete:[...frontier].reverse().find(r=>r.state==='VERIFIED_RECOVERABLE')?.id,eligibleVersions:[...newest.values()].sort((a,b)=>a.path.localeCompare(b.path)),warning:'Versions may come from different snapshots. This plan is not a historical snapshot and may be application-inconsistent. Use explicit snapshot/path selections to restore.'};
}
