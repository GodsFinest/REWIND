import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function exists(p:string){try{await fs.lstat(p);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export async function noSymlinks(p:string,allowMissing=false):Promise<string>{
 const abs=path.resolve(p); const parsed=path.parse(abs); let at=parsed.root;
 for(const part of abs.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);try{const s=await fs.lstat(at);if(s.isSymbolicLink())throw new Error('Symlink path component rejected: '+at);}catch(e){if(allowMissing && (e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
 }
 return abs;
}
export function contains(parent:string,child:string){const r=path.relative(parent,child);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
export async function assertSeparate(paths:string[]){const normalized=[];for(const p of paths)normalized.push(await noSymlinks(p,true));for(let a=0;a<normalized.length;a++)for(let b=a+1;b<normalized.length;b++)if(contains(normalized[a],normalized[b])||contains(normalized[b],normalized[a]))throw new Error('Source, catalog and storage paths must be separate and non-overlapping');return normalized;}
export async function syncDir(p:string){let h;try{h=await fs.open(p,constants.O_RDONLY);await h.sync();}catch(e){if(!['EINVAL','ENOTSUP','EBADF','EPERM','EISDIR'].includes((e as NodeJS.ErrnoException).code||''))throw e;}finally{await h?.close();}}
export async function atomicWrite(p:string,data:Uint8Array|string){
 await noSymlinks(path.dirname(p));const tmp=p+'.'+randomUUID()+'.tmp';const h=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await h.writeFile(data);await h.sync();}finally{await h.close();}
 try{await fs.rename(tmp,p);await syncDir(path.dirname(p));}catch(e){await fs.rm(tmp,{force:true});throw e;}
}
export async function readBounded(p:string,max=64*1024*1024):Promise<Buffer>{
 await noSymlinks(p);const h=await fs.open(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();if(!s.isFile()||s.size>max)throw new Error('Not a bounded regular file: '+p);return await h.readFile();}finally{await h.close();}
}
export function failurePoint(name:string){if(process.env.REWIND_TEST_CRASH===name)process.kill(process.pid,'SIGKILL');}
export interface OperationOptions{signal?:AbortSignal;onProgress?:(p:{phase:string;completed:number;total?:number;detail?:string})=>void;}
export function checkCancelled(options:OperationOptions){if(options.signal?.aborted)throw new Error('Operation cancelled; no success published');}
export async function withLock<T>(home:string,fn:()=>Promise<T>):Promise<T>{
 const lock=path.join(home,'operation.lock');await noSymlinks(home);let handle;
 try{handle=await fs.open(lock,'wx',0o600);}catch(e){
  if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
  const saved=JSON.parse((await readBounded(lock,1024)).toString()) as {pid:number};let alive=true;
  try{process.kill(saved.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
  if(alive)throw new Error('Repository busy in another operation');
  await fs.unlink(lock);handle=await fs.open(lock,'wx',0o600);
 }
 try{await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.sync();return await fn();}finally{await handle.close();await fs.unlink(lock);}
}
