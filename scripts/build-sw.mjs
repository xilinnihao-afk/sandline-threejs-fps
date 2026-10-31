import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function walk(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())files.push(...await walk(p));else if(e.name!=='sw.js')files.push(p);}return files;}
const all=await walk('dist');
// Derive precache membership from the same roster and derivative manifest as
// the game. A stale file accidentally left in dist must never re-enter cache.
const roster=await readFile(new URL('../src/render/soldierRoster.ts',import.meta.url),'utf8');
const rosterDeclaration=roster.match(/export const SOLDIER_MODELS\s*=\s*\[([\s\S]*?)\]\s*as const/);
if(!rosterDeclaration)throw new Error('Cannot locate the current soldier roster');
const characterFiles=[...rosterDeclaration[1].matchAll(/\bfile:\s*['"]([^'"]+\.glb)['"]/g)].map(match=>match[1]);
if(!characterFiles.length||new Set(characterFiles).size!==characterFiles.length)throw new Error('Invalid soldier precache roster');
const characterPaths=new Set(['locomotion.glb',...characterFiles].map(file=>'assets/characters/'+file));
const manifest=JSON.parse(await readFile(new URL('../public/assets/runtime/manifest.json',import.meta.url),'utf8'));
const runtimePaths=new Set([...manifest.files.map(file=>file.file),'cs16-ak47.glb','cs16-arms-rigged.glb','classic-knife.glb'].map(file=>'assets/runtime/'+file));
const required=path=>!path.startsWith('assets/')
 || /^assets\/[^/]+\.(js|css)$/.test(path)
 || runtimePaths.has(path)
 || /^assets\/ui\/.*\.(jpg|png|webp)$/.test(path)
 || /^assets\/environment\/.*\.(jpg|png)$/.test(path)
 || path==='assets/environment/lighting/studio-small-09-1k.hdr'
 || characterPaths.has(path)
 || /^assets\/hostages\/hostage-[12]\.glb$/.test(path);
const files=all.filter(f=>required(f.slice(5)));
const hash=createHash('sha256');hash.update('sandline-runtime-cache-v8-goldsrc-maps');let bytes=0;
for(const f of files){const b=await readFile(f);hash.update(f);hash.update(b);bytes+=b.byteLength;}
// Maps load on demand, but their contents still invalidate the runtime cache.
for(const f of all.filter(f=>f.startsWith('dist/assets/maps/')).sort()){hash.update(f);hash.update(await readFile(f));}
const version='sandline-'+hash.digest('hex').slice(0,12),urls=files.map(f=>'./'+f.slice(5));
await writeFile('dist/sw.js',`const CACHE=${JSON.stringify(version)};const FILES=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(url=>new Request(new URL(url,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sandline-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('message',event=>{if(event.data==='CACHE_STATUS')event.ports[0]?.postMessage({ready:true,version:CACHE});});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 const path=url.pathname.slice(new URL(self.registration.scope).pathname.length);
 // Requests outside the runtime asset list (including APIs) bypass this cache.
 if(!FILES.includes('./'+path)&&!path.startsWith('assets/audio/')&&!path.startsWith('assets/maps/')&&event.request.mode!=='navigate')return;
 event.respondWith(caches.open(CACHE).then(async c=>{
  if(event.request.mode==='navigate'){
   // Online entrypoints revalidate. Keep the cached release graph intact for
   // offline use until the next worker has downloaded its entire release.
   try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok)return response;}catch{}
   return await c.match('./index.html',{ignoreVary:true})||Response.error();
  }
  // Version queries bypass a previous worker's exact-URL cache while this
  // release resolves them against its own fully downloaded asset graph.
  const hit=await c.match(event.request,{ignoreVary:true,ignoreSearch:true});
  if(hit)return hit;const response=await fetch(event.request);
  if(response.ok&&(path.startsWith('assets/audio/')||path.startsWith('assets/maps/')))try{await c.put(event.request,response.clone());}catch{}
  return response;
 }));
});
`);
console.log('Offline runtime cache:',version,files.length,'files',bytes,'bytes');
