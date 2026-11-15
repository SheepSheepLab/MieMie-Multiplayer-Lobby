import {PRODUCT_IDENTITY as PRODUCT} from './product.mjs';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile, readdir} from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
const version=pkg.version;
const {id:productId,repository}=manifest;
const {scriptId}=PRODUCT;
const tag='v'+version;
const hash=value=>createHash('sha256').update(value).digest('hex');
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Product version must be plain MAJOR.MINOR.PATCH');
if(pkg.name!==PRODUCT.packageName||pkg.author!==PRODUCT.author||pkg.repository!==PRODUCT.repository||pkg.license!=='GPL-3.0-or-later')throw Error('Product identity mismatch');
if(lock.name!==pkg.name||lock.version!==version||lock.packages[''].name!==pkg.name||lock.packages[''].version!==version)throw Error('Lockfile identity mismatch');
if(manifest.version!==version||manifest.name!==PRODUCT.name||manifest.author!==PRODUCT.author||
   manifest.repository!==PRODUCT.repository||manifest.homepage!==PRODUCT.repository||manifest.license!==pkg.license||
   manifest.contributes.launcher.title!==PRODUCT.launcherName||manifest.entry!=='lobby.js')
  throw Error('Release manifest identity mismatch');
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main.ts'],bundle:true,format:'iife',target:['safari16','chrome110'],outfile:'dist/lobby.js',loader:{'.css':'text','.png':'dataurl'},legalComments:'eof',minify:false});
await mkdir('dist/licenses',{recursive:true});
let notices=await readFile('THIRD_PARTY_NOTICES.txt','utf8');
for(const file of ['BRAND.md','ASSETS-LICENSE.md']){await copyFile(file,'dist/'+file);notices+='\n\n'+file+'\n'+await readFile(file,'utf8');}
for(const file of await readdir('licenses')){await copyFile('licenses/'+file,'dist/licenses/'+file);notices+='\n\n'+file+'\n'+await readFile('licenses/'+file,'utf8');}
notices+='\n\nGPL-3.0-or-later\n'+await readFile('LICENSE','utf8');
const identity={schemaVersion:1,productId,version,scriptId,repository};
const marker='// MieMie-Extension-Build: '+JSON.stringify(identity)+'\n';
const content=marker+'/*!\n'+notices.replaceAll('*/','* /')+'\n*/\n'+await readFile('dist/lobby.js','utf8');
await writeFile('dist/lobby.js',content);
const artifact={type:'script',enabled:true,name:`${PRODUCT.name} ${version}`,id:scriptId,content,info:'SheepSheep · 2–4 人联机 RP。房主需 ST 1.19 新宏引擎与酒馆助手 4.11.3+。PeerJS 公共信令；复杂网络需自备 TURN。',button:{enabled:false,buttons:[]},data:{},export_with:{data:true,button:true}};
const name=`${PRODUCT.artifactPrefix}-Extension-${version}.json`;
const bytes=Buffer.from(JSON.stringify(artifact,null,2)+'\n');
if(bytes.length>16*1024*1024)throw Error('Extension package exceeds the Hub limit');
const update={
  schemaVersion:1,format:'tavern-helper-script',productId,version,tag,scriptId,manifest,
  asset:{name,size:bytes.length,sha256:hash(bytes)},contentSha256:hash(content),
};
await writeFile('dist/'+name,bytes);
await writeFile('dist/MieMie-Extension-update.json',JSON.stringify(update,null,2)+'\n');
await copyFile('manifest.json','dist/manifest.json');
await copyFile('LICENSE','dist/LICENSE');
await copyFile('THIRD_PARTY_NOTICES.txt','dist/THIRD_PARTY_NOTICES.txt');
console.log('Built importable Tavern Helper script');
