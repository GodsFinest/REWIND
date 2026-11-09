import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonical,configSchema,sha,validateManifest,relativePath,LIMITATIONS,type Config,type Manifest,type Entry,type Chunk} from './schema.js';
import {assertSeparate,atomicWrite,checkCancelled,exists,failurePoint,noSymlinks,readBounded,syncDir,withLock,type OperationOptions} from './fs.js';
import {chunkStream} from './chunker.js';
import {rebuildCatalog} from './catalog.js';
export interface Repository {home:string;config:Config;disabled?:Set<number>;ioErrors?:Set<number>;}
export function objectPath(root:string,hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid digest');return path.join(root,'objects',hash.slice(0,2),hash);}
export async function createRepository(home:string,source:string,roots:[string,string],isDemo=false):Promise<Repository>{
 const [h,s,a,b]=await assertSeparate([home,source,...roots]);if(!(await fs.stat(s)).isDirectory())throw new Error('Source must be a directory');
 for(const p of [h,a,b]){if(await exists(p)){if((await fs.readdir(p)).length)throw new Error('New repository directories must be empty: '+p);}else await fs.mkdir(p,{recursive:true,mode:0o700});}
 const config:Config={version:1,id:randomUUID(),source:s,roots:[a,b],createdAt:new Date().toISOString(),isDemo};
 const repo={home:h,config};
 for(const root of config.roots){for(const name of ['objects','manifests','commits'])await fs.mkdir(path.join(root,name));await atomicWrite(path.join(root,'backend.json'),canonical({version:1,repositoryId:config.id}));await syncDir(root);}
 for(const name of ['receipts','restore-intents'])await fs.mkdir(path.join(h,name));
 await atomicWrite(path.join(h,'repository.json'),canonical(config));return repo;
}
export async function openRepository(home:string):Promise<Repository>{const h=await noSymlinks(home);const config=configSchema.parse(JSON.parse((await readBounded(path.join(h,'repository.json'),16384)).toString()));await assertSeparate([h,config.source,...config.roots]);return {home:h,config};}
export async function backendAvailable(repo:Repository,index:number):Promise<boolean>{
 if(repo.disabled?.has(index))return false;
 try{const root=repo.config.roots[index];await noSymlinks(root);const m=JSON.parse((await readBounded(path.join(root,'backend.json'),1024)).toString());return m.version===1&&m.repositoryId===repo.config.id;}catch{return false;}
}
export async function readObject(repo:Repository,index:number,chunk:Chunk):Promise<Buffer>{
 if(!await backendAvailable(repo,index))throw Object.assign(new Error('Backend unavailable'),{code:'UNAVAILABLE'});
 if(repo.ioErrors?.has(index))throw Object.assign(new Error('Simulated I/O failure'),{code:'EIO'});
 const data=await readBounded(objectPath(repo.config.roots[index],chunk.hash),262144);if(data.length!==chunk.size||sha(data)!==chunk.hash)throw Object.assign(new Error('Chunk hash or size mismatch'),{code:'CORRUPT'});return data;
}
async function storeObject(repo:Repository,index:number,chunk:Chunk,bytes:Buffer){
 const root=repo.config.roots[index];if(!await backendAvailable(repo,index))throw new Error('Both backends must be accessible for capture');
 const p=objectPath(root,chunk.hash);await fs.mkdir(path.dirname(p),{recursive:true});await noSymlinks(path.dirname(p));
 if(await exists(p)){await readObject(repo,index,chunk);return;}
 await atomicWrite(p,bytes);
}
export interface SnapshotRecord{id:string;manifest?:Manifest;degraded:string[];}
export async function listSnapshots(repo:Repository):Promise<SnapshotRecord[]>{
 const ids=new Set<string>();
 for(let b=0;b<2;b++){if(!await backendAvailable(repo,b))continue;try{await noSymlinks(path.join(repo.config.roots[b],'commits'));for(const name of await fs.readdir(path.join(repo.config.roots[b],'commits')))if(/^[a-f0-9]{64}\.json$/.test(name))ids.add(name.slice(0,64));}catch{/* unavailable metadata is surfaced per record / scan */}}
 const rows:SnapshotRecord[]=[];
 // Previously verified committed metadata remains useful while all commit copies are inaccessible.
 if(ids.size===0&&(!await backendAvailable(repo,0)||!await backendAvailable(repo,1))&&await exists(path.join(repo.home,'catalog.sqlite'))){
  let db:DatabaseSync|undefined;try{await noSymlinks(path.join(repo.home,'catalog.sqlite'));db=new DatabaseSync(path.join(repo.home,'catalog.sqlite'),{readOnly:true});for(const row of db.prepare('SELECT id,manifest FROM snapshots LIMIT 100000').all()){const m=validateManifest(JSON.parse(String(row.manifest)));if(m.repositoryId===repo.config.id&&sha(canonical(m))===row.id)rows.push({id:String(row.id),manifest:m,degraded:['Using previously verified catalog metadata while committed storage metadata is inaccessible']});}}catch{/* cache is optional, never invent metadata */}finally{db?.close();}
 }
 for(const id of ids){const row:SnapshotRecord={id,degraded:[]};for(let b=0;b<2;b++){
  if(!await backendAvailable(repo,b)){row.degraded.push(`Backend ${b?'B':'A'} unavailable`);continue;}
  try{const root=repo.config.roots[b];const marker=JSON.parse((await readBounded(path.join(root,'commits',id+'.json'),1024)).toString());if(marker.version!==1||marker.repositoryId!==repo.config.id||marker.snapshotId!==id)throw new Error('Invalid commit marker');
   const bytes=await readBounded(path.join(root,'manifests',id+'.json'));const raw=JSON.parse(bytes.toString());const m=validateManifest(raw);if(bytes.toString()!==canonical(m)||sha(canonical(m))!==id||m.repositoryId!==repo.config.id)throw new Error('Manifest identity mismatch');row.manifest=m;
  }catch(e){row.degraded.push(`Backend ${b?'B':'A'} metadata: ${(e as Error).message}`);}
 }rows.push(row);}
 return rows.sort((a,b)=>(a.manifest?.createdAt||'').localeCompare(b.manifest?.createdAt||'')||a.id.localeCompare(b.id));
}
export async function getSnapshot(repo:Repository,id:string):Promise<Manifest>{const row=(await listSnapshots(repo)).find(r=>r.id===id);if(!row?.manifest)throw new Error('INVALID_METADATA: no verified committed manifest for '+id);return row.manifest;}
function sameStats(a:import('node:fs').Stats,b:import('node:fs').Stats){return sameContentStats(a,b)&&a.ctimeMs===b.ctimeMs;}
function sameContentStats(a:import('node:fs').Stats,b:import('node:fs').Stats){return a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.mode===b.mode&&a.ino===b.ino&&a.dev===b.dev;}
export async function captureSnapshot(repo:Repository,label='Snapshot',options:OperationOptions={}):Promise<string>{return withLock(repo.home,async()=>{
 if(label.length>120)throw new Error('Label too long');const source=await noSymlinks(repo.config.source);await assertSeparate([repo.home,source,...repo.config.roots]);
 const rootStat=await fs.lstat(source);const entries:Entry[]=[],skipped:Manifest['skipped']=[];let completed=0;const stored=new Map<string,Chunk>();
 async function walk(dir:string,rel:string){checkCancelled(options);await noSymlinks(dir);const before=await fs.lstat(dir);const names=(await fs.readdir(dir)).sort();
  for(const name of names){checkCancelled(options);const relative=rel?rel+'/'+name:name;const abs=path.join(dir,name);const s=await fs.lstat(abs);
   if(!relativePath.safeParse(relative).success)throw new Error('Unsupported filename: '+relative);
   if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile())||s.dev!==rootStat.dev){skipped.push({path:relative,reason:s.isSymbolicLink()?'symlink':s.dev!==rootStat.dev?'mount boundary':'unsupported file type'});continue;}
   if(s.isDirectory()){entries.push({path:relative,type:'directory',mode:s.mode&0o777,mtimeMs:Math.max(0,s.mtimeMs)});await walk(abs,relative);continue;}
   await noSymlinks(abs);const handle=await fs.open(abs,constants.O_RDONLY|constants.O_NOFOLLOW);const hash=createHash('sha256'),chunks:Chunk[]=[];let size=0,fileHash='';
   try{const opened=await handle.stat();if(!sameContentStats(s,opened))throw new Error('Source changed before reading: '+relative);
    for await(const bytes of chunkStream(handle.createReadStream({autoClose:false,highWaterMark:65536}))){checkCancelled(options);hash.update(bytes);size+=bytes.length;const chunk={hash:sha(bytes),size:bytes.length};chunks.push(chunk);if(!stored.has(chunk.hash)){for(let b=0;b<2;b++)await storeObject(repo,b,chunk,bytes);stored.set(chunk.hash,chunk);}options.onProgress?.({phase:'capture-chunks',completed:size,total:s.size,detail:relative});failurePoint('capture-chunk');}
    const after=await handle.stat();const current=await fs.lstat(abs);fileHash=hash.digest('hex');
    if(!sameContentStats(opened,after)||!sameContentStats(after,current)||size!==s.size)throw new Error('Source changed during capture: '+relative);
    if(!sameStats(s,opened)||!sameStats(opened,after)||!sameStats(after,current)){
     // iCloud/Finder may change xattrs (ctime only) during reads. Require independent second byte read.
     const repeat=createHash('sha256');for await(const bytes of handle.createReadStream({autoClose:false,start:0,highWaterMark:65536})){checkCancelled(options);repeat.update(bytes);}const final=await handle.stat();const finalPath=await fs.lstat(abs);
     if(repeat.digest('hex')!==fileHash||!sameContentStats(after,final)||!sameContentStats(final,finalPath))throw new Error('Source changed during revalidation: '+relative);
    }
   }finally{await handle.close();}
   entries.push({path:relative,type:'file',mode:s.mode&0o777,mtimeMs:Math.max(0,s.mtimeMs),size,hash:fileHash,chunks});options.onProgress?.({phase:'capture',completed:++completed,detail:relative});
  }const end=await fs.lstat(dir);if(!sameContentStats(before,end))throw new Error('Directory changed during capture: '+dir+' '+JSON.stringify({before:[before.size,before.ino,before.mode,before.mtimeMs],after:[end.size,end.ino,end.mode,end.mtimeMs]}));
 }
 await walk(source,'');entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const previous=await listSnapshots(repo);
 const manifest=validateManifest({version:1,repositoryId:repo.config.id,createdAt:new Date().toISOString(),session:randomUUID(),label,sourceIdentity:sha(source),parent:previous.at(-1)?.id||null,entries,skipped,limitations:LIMITATIONS});
 const bytes=canonical(manifest),id=sha(bytes);failurePoint('capture-before-manifest');
 for(let b=0;b<2;b++){for(const chunk of stored.values()){checkCancelled(options);await readObject(repo,b,chunk);}await atomicWrite(path.join(repo.config.roots[b],'manifests',id+'.json'),bytes);failurePoint('capture-manifest');}
 checkCancelled(options);failurePoint('capture-before-commit');
 for(let b=0;b<2;b++){await atomicWrite(path.join(repo.config.roots[b],'commits',id+'.json'),canonical({version:1,repositoryId:repo.config.id,snapshotId:id}));failurePoint(b===0?'capture-commit-a':'capture-commit-b');}
 failurePoint('capture-before-catalog');await rebuildCatalog(repo);failurePoint('capture-after-catalog');return id;
 });}
export async function diffSnapshots(repo:Repository,before:string,after:string){const a=await getSnapshot(repo,before),b=await getSnapshot(repo,after);const old=new Map(a.entries.map(e=>[e.path,e]));const fresh=new Map(b.entries.map(e=>[e.path,e]));return {added:b.entries.filter(e=>!old.has(e.path)).map(e=>e.path),removed:a.entries.filter(e=>!fresh.has(e.path)).map(e=>e.path),changed:b.entries.filter(e=>old.has(e.path)&&canonical(old.get(e.path))!==canonical(e)).map(e=>e.path)};}
export async function storageAccounting(repo:Repository){
 const snaps=await listSnapshots(repo),unique=new Map<string,number>();let logicalBytes=0,physicalBytes=0,metadataBytes=0,objectBytes=0;
 for(const s of snaps)for(const e of s.manifest?.entries||[])if(e.type==='file'){logicalBytes+=e.size;for(const c of e.chunks)unique.set(c.hash,c.size);}
 async function walk(p:string,isObjects:boolean){await noSymlinks(p);for(const d of await fs.readdir(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isSymbolicLink())continue;if(d.isDirectory())await walk(f,isObjects);else if(d.isFile()){const n=(await fs.lstat(f)).size;physicalBytes+=n;if(isObjects)objectBytes+=n;else metadataBytes+=n;}}}
 for(let b=0;b<2;b++)if(await backendAvailable(repo,b)){const root=repo.config.roots[b];for(const dir of ['objects','manifests','commits'])await walk(path.join(root,dir),dir==='objects');metadataBytes+=(await fs.stat(path.join(root,'backend.json'))).size;physicalBytes+=(await fs.stat(path.join(root,'backend.json'))).size;}
 const uniqueBytes=[...unique.values()].reduce((a,b)=>a+b,0);return {logicalBytes,uniqueBytes,physicalBytes,metadataBytes,objectBytes,chunks:unique.size,dedupSavings:logicalBytes?1-uniqueBytes/logicalBytes:0};
}
