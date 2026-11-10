import {mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const source='native/publish.c',target='native/bin/rewind-publish';
if(!['darwin','linux'].includes(process.platform))throw new Error('Atomic restore publication currently supports macOS and Linux only. Restore fails closed elsewhere.');
try{if((await stat(target)).mtimeMs>=(await stat(source)).mtimeMs)process.exit(0);}catch{/* compile first build */}
await mkdir('native/bin',{recursive:true});
const result=spawnSync(process.env.CC||'cc',['-O2','-Wall','-Wextra','-Werror',source,'-o',target],{stdio:'inherit'});
if(result.error)throw new Error('A C compiler is required for source builds (macOS Command Line Tools or Linux cc): '+result.error.message);
if(result.status!==0)process.exit(result.status||1);
