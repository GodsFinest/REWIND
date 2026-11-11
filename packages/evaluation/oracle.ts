// Deliberately independent: no imports from production core or its classification/chunk reader.
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
interface File{type:'file';path:string;hash:string;size:number;chunks:{hash:string;size:number}[];}
interface Manifest{entries:({type:'directory';path:string}|File)[];}
export async function oracle(manifest:Manifest,roots:string[],unavailable:Set<number>=new Set(),ioError:Set<number>=new Set()){
 const result=new Map<string,string>();
 for(const file of manifest.entries){if(file.type!=='file')continue;let hasImpossible=false,hasUnknown=false,full=Buffer.alloc(0);
  for(const chunk of file.chunks){let found:Buffer|undefined,uncertain=false;
   for(let i=0;i<roots.length;i++){if(unavailable.has(i)||ioError.has(i)){uncertain=true;continue;}try{const data=await fs.readFile(path.join(roots[i],'objects',chunk.hash.substring(0,2),chunk.hash));const digest=createHash('sha256').update(data).digest('hex');if(digest===chunk.hash&&data.length===chunk.size)found=data;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')uncertain=true;}}
   if(found)full=Buffer.concat([full,found]);else if(uncertain)hasUnknown=true;else hasImpossible=true;
  }
  if(!hasImpossible&&!hasUnknown){const digest=createHash('sha256').update(full).digest('hex');if(full.length!==file.size||digest!==file.hash)throw new Error('Independent oracle found contradictory whole-file metadata');}
  result.set(file.path,hasImpossible?'KNOWN_UNRECOVERABLE':hasUnknown?'UNKNOWN':'VERIFIED_RECOVERABLE');
 }
 return result;
}
