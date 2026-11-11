import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const [name,platform] of [['main','node'],['preload','node'],['worker','node']])await build({entryPoints:[`apps/desktop/${name}.ts`],outfile:`dist/${name}.cjs`,bundle:true,platform,format:'cjs',target:'node22',external:['electron','node:sqlite'],define:{'import.meta.url':JSON.stringify(new URL('../dist/main.cjs',import.meta.url).href)}});
await viteBuild();
try{await copyFile('results/summary.json','dist/evaluation.json');}catch{/* evaluation not yet run */}
