import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {exists,noSymlinks} from './fs.js';
const execute=promisify(execFile);
export async function publishExclusive(stage:string,destination:string){
 if(!['darwin','linux'].includes(process.platform))throw new Error('Atomic exclusive restore publication is unsupported on this platform');
 const resources=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath;
 const candidates=[...(resources?[path.join(resources,'rewind-publish')]:[]),path.resolve('native/bin/rewind-publish'),fileURLToPath(new URL('../../native/bin/rewind-publish',import.meta.url))];
 let helper:string|undefined;for(const candidate of candidates)if(await exists(candidate)){helper=candidate;break;}
 if(!helper)throw new Error('Exclusive publication helper missing. Run npm install or npm run build; no unsafe rename fallback is used.');
 await noSymlinks(helper);await noSymlinks(path.dirname(destination));
 try{await execute(helper,[stage,destination],{timeout:30000});}catch(e){throw new Error('Atomic exclusive publication refused: '+((e as {stderr?:string}).stderr||(e as Error).message).trim());}
}
