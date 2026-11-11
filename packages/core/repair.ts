import {listSnapshots,type Repository} from './repository.js';
import type {HealthScan} from './recovery.js';
export interface RepairProblem {costs:Map<string,number>;versions:{missing:Set<string>;weight:number}[];budget:number;}
function utility(p:RepairProblem,selected:Set<string>){return p.versions.reduce((n,v)=>n+(v.missing.size&&[...v.missing].every(h=>selected.has(h))?v.weight:0),0);}
export function solveRepair(p:RepairProblem){
 const candidates=[...p.costs.keys()].sort();let best=new Set<string>(),bestU=0,bestCost=0;const exact=candidates.length<=18;
 if(!Number.isFinite(p.budget)||p.budget<0||[...p.costs.values()].some(n=>!Number.isSafeInteger(n)||n<=0)||p.versions.some(v=>!Number.isFinite(v.weight)||v.weight<0))throw new Error('Invalid repair problem');
 if(exact){
  const count=2**candidates.length,costs=new Float64Array(count),gains=new Float64Array(count),indices=new Map(candidates.map((h,i)=>[h,i]));
  for(const version of p.versions){if(!version.missing.size||[...version.missing].some(h=>!indices.has(h)))continue;let mask=0;for(const h of version.missing)mask|=1<<indices.get(h)!;gains[mask]+=version.weight;}
  // Subset zeta transform sums only utility of completely satisfied missing sets.
  for(let bit=0;bit<candidates.length;bit++)for(let mask=0;mask<count;mask++)if(mask&(1<<bit))gains[mask]+=gains[mask^(1<<bit)];
  let bestMask=0;for(let mask=1;mask<count;mask++){const low=mask&-mask,index=31-Math.clz32(low);costs[mask]=costs[mask^low]+p.costs.get(candidates[index])!;if(costs[mask]>p.budget)continue;const u=gains[mask];if(u>bestU||(u===bestU&&costs[mask]<bestCost)){bestU=u;bestMask=mask;bestCost=costs[mask];}}
  best=new Set(candidates.filter((_,i)=>bestMask&(1<<i)));
 }
 else{
  let changed=true;while(changed){changed=false;let choice:Set<string>|undefined,score=0;
   for(const v of p.versions){const set=new Set([...best,...v.missing]);if([...set].some(h=>!p.costs.has(h)))continue;const cost=[...set].reduce((n,h)=>n+p.costs.get(h)!,0);if(cost>p.budget)continue;const gain=utility(p,set)-bestU,ratio=gain/Math.max(1,cost-bestCost);if(gain>0&&ratio>score){choice=set;score=ratio;}}
   if(choice){best=choice;bestU=utility(p,best);bestCost=[...best].reduce((n,h)=>n+p.costs.get(h)!,0);changed=true;}
  }
 }
 const popularity=candidates.map(h=>({h,count:p.versions.filter(v=>v.missing.has(h)).length})).sort((a,b)=>b.count-a.count||a.h.localeCompare(b.h));const naive=new Set<string>();let bytes=0;for(const {h} of popularity)if(bytes+p.costs.get(h)!<=p.budget){bytes+=p.costs.get(h)!;naive.add(h);}
 return {method:exact?'exact subset search with zeta transform (≤18 candidates)':'bundle-aware marginal utility heuristic',optimal:exact,bytes:bestCost,utility:bestU,chunks:[...best],baselineUtility:utility(p,naive),budget:p.budget};
}
export async function planRepair(repo:Repository,scan:HealthScan,target:number,budget:number){if(![0,1].includes(target)||!Number.isSafeInteger(budget)||budget<0)throw new Error('Invalid repair budget/target');const costs=new Map<string,number>(),versions:RepairProblem['versions']=[];
 for(const row of await listSnapshots(repo))for(const e of row.manifest?.entries||[])if(e.type==='file'){const missing=new Set<string>();let possible=true;for(const c of e.chunks){const copies=scan.copies[c.hash];if(copies?.[target]?.state==='VERIFIED_OK')continue;missing.add(c.hash);if(copies?.[1-target]?.state==='VERIFIED_OK')costs.set(c.hash,c.size);else possible=false;}if(possible&&missing.size)versions.push({missing,weight:1});}
 return {...solveRepair({costs,versions,budget}),target,planOnly:true};
}
