import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function walk(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())files.push(...await walk(p));else if(e.name!=='sw.js')files.push(p);}return files;}
const files=await walk('dist');const hash=createHash('sha256');hash.update('sandline-static-cache-v2-ignore-origin-vary');for(const f of files)hash.update(await readFile(f));const version='sandline-'+hash.digest('hex').slice(0,12);const urls=files.map(f=>'./'+f.slice(5));
await writeFile('dist/sw.js',`const CACHE=${JSON.stringify(version)};const FILES=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sandline-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('message',event=>{if(event.data==='CACHE_STATUS')event.ports[0]?.postMessage({ready:true,version:CACHE});});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async c=>{const hit=event.request.mode==='navigate'?await c.match('./index.html',{ignoreVary:true}):await c.match(event.request,{ignoreVary:true});return hit||fetch(event.request);}));});
`);
console.log('Offline precache:',version,files.length,'files');
