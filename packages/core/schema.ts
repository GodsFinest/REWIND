import {z} from 'zod';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export function safeRelative(value:string):string {
 if (!value || value.length>4096 || value.includes('\\') || value.includes('\0') || value.normalize('NFC')!==value || path.posix.isAbsolute(value)) throw new Error('Unsafe or non-normalized relative path');
 for(const part of value.split('/')) if (!part || part==='.' || part==='..' || Array.from(part).some(c=>c.charCodeAt(0)<32)||/[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) || Buffer.byteLength(part)>255) throw new Error('Unsupported portable filename: '+value);
 return value;
}
export const relativePath = z.string().refine(v=>{try{safeRelative(v);return true;}catch{return false;}},'Unsafe relative path');
export const chunkSchema = z.object({hash:digest,size:z.number().int().positive().max(262144)}).strict();
const metadata = {path:relativePath,mode:z.number().int().min(0).max(0o777),mtimeMs:z.number().finite().nonnegative()};
export const entrySchema = z.discriminatedUnion('type',[
 z.object({...metadata,type:z.literal('directory')}).strict(),
 z.object({...metadata,type:z.literal('file'),size:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),hash:digest,chunks:z.array(chunkSchema).max(2000000)}).strict()
]);
export const manifestSchema = z.object({version:z.literal(1),repositoryId:z.string().uuid(),createdAt:z.string().datetime(),session:z.string().uuid(),label:z.string().max(120),sourceIdentity:z.string(),parent:digest.nullable(),entries:z.array(entrySchema).max(1000000),skipped:z.array(z.object({path:z.string(),reason:z.string()})).max(1000000),limitations:z.array(z.string())}).strict();
export type Manifest=z.infer<typeof manifestSchema>;
export type Entry=z.infer<typeof entrySchema>;
export type FileEntry=Extract<Entry,{type:'file'}>;
export type Chunk=z.infer<typeof chunkSchema>;
export const configSchema=z.object({version:z.literal(1),id:z.string().uuid(),source:z.string(),roots:z.tuple([z.string(),z.string()]),createdAt:z.string().datetime(),isDemo:z.boolean().default(false)}).strict();
export type Config=z.infer<typeof configSchema>;
export function canonical(value:unknown):string {
 if(value===null || typeof value!=='object') return JSON.stringify(value);
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 const obj=value as Record<string,unknown>;
 return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+canonical(obj[k])).join(',')+'}';
}
export function sha(bytes:Uint8Array|string):string{return createHash('sha256').update(bytes).digest('hex');}
export function validateManifest(input:unknown):Manifest {
 const m=manifestSchema.parse(input); const seen=new Set<string>(); const byPath=new Map(m.entries.map(e=>[e.path,e])); let previous='';
 for(const entry of m.entries){
  if(entry.path<=previous)throw new Error('Manifest entries must be strictly sorted'); previous=entry.path;
  const key=entry.path.toLowerCase(); if(seen.has(key))throw new Error('Case-folding path collision');seen.add(key);
  for(let parent=path.posix.dirname(entry.path);parent!=='.';parent=path.posix.dirname(parent)){
   const p=byPath.get(parent);if(!p || p.type!=='directory')throw new Error('Missing or conflicting parent directory');
  }
  if(entry.type==='file'){if(entry.chunks.reduce((n,c)=>n+c.size,0)!==entry.size)throw new Error('Chunk sizes do not match file size');if(entry.size===0&&entry.hash!==sha(''))throw new Error('Contradictory empty-file digest');}
 }
 return m;
}
export const LIMITATIONS=['Live traversal is not an atomic filesystem snapshot.','Regular files/directories only; no ACLs, xattrs or resource forks.','Hashes detect accidental damage, not adversarial authenticity.'];
