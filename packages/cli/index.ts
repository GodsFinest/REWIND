#!/usr/bin/env node
import path from 'node:path';
import * as fs from 'node:fs/promises';
import {analyzeFrontier,captureSnapshot,createDemo,createFaultLab,createRepository,diffSnapshots,explain,getSnapshot,injectFault,labRepository,listSnapshots,openFaultLab,openRepository,planRecovery,planRepair,rebuildCatalog,reconcileRestore,restoreSnapshot,scanHealth,scenarioRecord,storageAccounting,verifyReceipt,verifyRestored,type Repository} from '../core/index.js';
const [command,...args]=process.argv.slice(2);
async function run(){let repo:Repository;switch(command){
 case 'init':if(args.length!==4)throw new Error('init <catalog-dir> <source> <copy-a> <copy-b>');repo=await createRepository(args[0],args[1],[args[2],args[3]]);return {repository:repo.home,id:repo.config.id};
 case 'demo':{const root=path.resolve(args[0]||'.rewind/cli-demo');repo=await createDemo(root);const scan=await scanHealth(repo,true);return {repository:repo.home,snapshots:analyzeFrontier(await listSnapshots(repo),scan),stats:await storageAccounting(repo)};}
 case 'capture':return {id:await captureSnapshot(await openRepository(args[0]),args[1]||'CLI capture')};
 case 'list':return listSnapshots(await openRepository(args[0]));
 case 'diff':return diffSnapshots(await openRepository(args[0]),args[1],args[2]);
 case 'scan':return scanHealth(await openRepository(args[0]),args[1]!=='quick');
 case 'frontier':{repo=await openRepository(args[0]);const scan=await scanHealth(repo,args[1]!=='quick');return analyzeFrontier(await listSnapshots(repo),scan);}
 case 'explain':{repo=await openRepository(args[0]);return explain(repo,args[1],args[2],await scanHealth(repo,true));}
 case 'restore':return restoreSnapshot(await openRepository(args[0]),args[1],args[2],args[3]?JSON.parse(args[3]):undefined);
 case 'verify':return verifyReceipt(await openRepository(args[0]),args[1]);
 case 'verify-files':{repo=await openRepository(args[0]);return verifyRestored(await getSnapshot(repo,args[1]),args[2]);}
 case 'reconcile':return reconcileRestore(await openRepository(args[0]),args[1]);
 case 'rebuild-catalog':await rebuildCatalog(await openRepository(args[0]));return {rebuilt:true};
 case 'accounting':return storageAccounting(await openRepository(args[0]));
 case 'lab':{const lab=await createFaultLab(await openRepository(args[0]),path.resolve(args[1]),Number(args[2]||42));return scenarioRecord(lab);}
 case 'fault':{const lab=await openFaultLab(path.resolve(args[0]),args[1]);const kind=args[2];if(!['missing','corrupt','unavailable','io-error','manifest'].includes(kind))throw new Error('Unknown fault');await injectFault(lab,kind as 'missing',Number(args[3]),args[4]);repo=await labRepository(lab);return {scenario:await scenarioRecord(lab),frontier:analyzeFrontier(await listSnapshots(repo),await scanHealth(repo,true))};}
 case 'plan-recovery':{repo=await openRepository(args[0]);return planRecovery(repo,await scanHealth(repo,true));}
 case 'repair-plan':{repo=await openRepository(args[0]);return planRepair(repo,await scanHealth(repo,true),Number(args[1]),Number(args[2]));}
 case 'receipt-json':repo=await openRepository(args[0]);return JSON.parse(await fs.readFile(path.join(repo.home,'receipts',args[1]+'.json'),'utf8'));
 default:return {usage:['init <catalog> <source> <A> <B>','demo [fresh-root]','capture <catalog> [label]','list <catalog>','diff <catalog> <before> <after>','scan|frontier <catalog> [quick]','explain <catalog> <snapshot> <path>','restore <catalog> <snapshot> <fresh-destination> [JSON-path-array]','verify <catalog> <receipt-id>','verify-files <catalog> <snapshot> <destination>','reconcile <catalog> <intent-id>','rebuild-catalog <catalog>','accounting <catalog>','lab <catalog> <managed-lab-root> [seed]','fault <lab-root> <lab-id> <kind> <backend-index> [hash]','plan-recovery <catalog>','repair-plan <catalog> <target-index> <budget-bytes>']};
}}
run().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(e=>{process.stderr.write((e as Error).message+'\n');process.exitCode=1;});
