import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import {listSnapshots,type Repository} from './repository.js';
import {atomicWrite,exists,failurePoint,noSymlinks} from './fs.js';
import {canonical} from './schema.js';
export async function rebuildCatalog(repo:Repository){
 const p=path.join(repo.home,'catalog.sqlite');await noSymlinks(repo.home);if(await exists(p))await noSymlinks(p);
 let db:DatabaseSync|undefined;
 try{db=new DatabaseSync(p);if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw new Error('Catalog integrity failure');}catch{db?.close();if(await exists(p))await fs.rename(p,p+'.damaged-'+Date.now());db=new DatabaseSync(p);}
 try{
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,manifest TEXT NOT NULL); CREATE TABLE IF NOT EXISTS versions(snapshot TEXT,path TEXT,kind TEXT,bytes INTEGER,hash TEXT,PRIMARY KEY(snapshot,path)); CREATE TABLE IF NOT EXISTS refs(chunk TEXT,snapshot TEXT,path TEXT,ordinal INTEGER,bytes INTEGER,PRIMARY KEY(snapshot,path,ordinal)); CREATE INDEX IF NOT EXISTS reverse_chunks ON refs(chunk); CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,at TEXT,deep INTEGER,payload TEXT);');
  const records=await listSnapshots(repo);db.exec('BEGIN IMMEDIATE; DELETE FROM refs; DELETE FROM versions; DELETE FROM snapshots;');failurePoint('catalog-during-update');
  try{const snap=db.prepare('INSERT INTO snapshots VALUES(?,?)'),entry=db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)'),ref=db.prepare('INSERT INTO refs VALUES(?,?,?,?,?)');
   for(const row of records)if(row.manifest){snap.run(row.id,canonical(row.manifest));for(const e of row.manifest.entries){entry.run(row.id,e.path,e.type,e.type==='file'?e.size:0,e.type==='file'?e.hash:null);if(e.type==='file')e.chunks.forEach((c,i)=>ref.run(c.hash,row.id,e.path,i,c.size));}}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }finally{db.close();}
}
export async function recordScan(repo:Repository,scan:{id:string;at:string;deep:boolean}){
 await rebuildIfMissing(repo);const db=new DatabaseSync(path.join(repo.home,'catalog.sqlite'));try{db.prepare('INSERT OR REPLACE INTO scans VALUES(?,?,?,?)').run(scan.id,scan.at,Number(scan.deep),canonical(scan));}finally{db.close();}
 await atomicWrite(path.join(repo.home,'latest-scan.json'),canonical(scan));
}
async function rebuildIfMissing(repo:Repository){if(!await exists(path.join(repo.home,'catalog.sqlite')))await rebuildCatalog(repo);}
export async function references(repo:Repository,hash:string){await rebuildIfMissing(repo);const db=new DatabaseSync(path.join(repo.home,'catalog.sqlite'));try{return db.prepare('SELECT snapshot,path,ordinal,bytes FROM refs WHERE chunk=? ORDER BY snapshot,path').all(hash);}finally{db.close();}}
