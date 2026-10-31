import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {SOLDIER_MODELS} from '../src/render/soldierRoster';

test('an offline release takes over only after every precache request succeeds',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'sandline-sw-test-'));
 try{
  mkdirSync(join(folder,'dist'));writeFileSync(join(folder,'dist/index.html'),'<html>release</html>');
  mkdirSync(join(folder,'dist/assets/runtime'),{recursive:true});
  mkdirSync(join(folder,'dist/assets/characters'),{recursive:true});
  writeFileSync(join(folder,'dist/assets/runtime/rifle.glb'),'test-asset');
  writeFileSync(join(folder,'dist/assets/runtime/classic-knife.glb'),'current-knife');
  writeFileSync(join(folder,'dist/assets/runtime/knife.glb'),'retired-knife');
  writeFileSync(join(folder,'dist/assets/runtime/fps_arms.glb'),'retired-arms');
  writeFileSync(join(folder,'dist/assets/characters/unused-heavy.glb'),'never precache');
  writeFileSync(join(folder,'dist/assets/characters/free_military_soldier_rigged.glb'),'retired-character');
  const models=['locomotion.glb',...SOLDIER_MODELS.map(model=>model.file)];
  for(const model of models)writeFileSync(join(folder,'dist/assets/characters',model),'test-model');
  execFileSync(process.execPath,[resolve('scripts/build-sw.mjs')],{cwd:folder});
  const source=readFileSync(join(folder,'dist/sw.js'),'utf8');
  for(const success of [true,false]){
   const events=new Map<string,(event:any)=>void>();let activated=0;let finish!:()=>void,fail!:(error:Error)=>void;
   const download=new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject;});
   runInNewContext(source,{
    URL,Request,self:{registration:{scope:'https://game.example/sandline/'},addEventListener:(name:string,handler:any)=>events.set(name,handler),skipWaiting:()=>activated++},
    caches:{open:async()=>({addAll:(requests:Request[])=>{
     assert.ok(requests.every(request=>request.cache==='reload'),'new releases must not copy stale HTTP-cache bytes');
     const urls=requests.map(request=>'./'+new URL(request.url).pathname.slice('/sandline/'.length));
     assert.ok(urls.includes('./index.html')&&urls.includes('./assets/runtime/rifle.glb'));
     assert.ok(urls.includes('./assets/runtime/classic-knife.glb'),'the current classic knife must be available offline');
     assert.ok(!urls.includes('./assets/runtime/knife.glb'),'the retired knife must never re-enter the release cache');
     assert.ok(!urls.some(url=>/unused-heavy|free_military_soldier_rigged|fps_arms/.test(url)),'obsolete assets must never enter a new cache');
     for(const model of models)assert.ok(urls.includes('./assets/characters/'+model));return download;
    }})},
   });
   let installed!:Promise<void>;events.get('install')!({waitUntil:(promise:Promise<void>)=>installed=promise});
   await Promise.resolve();assert.equal(activated,0,'must not activate an incomplete release');
   if(success){finish();await installed;assert.equal(activated,1,'completed release must not remain waiting on old tabs');}
   else{fail(new Error('network failed'));await assert.rejects(installed,/network failed/);assert.equal(activated,0,'failed download must preserve the working worker');}
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('activation removes every obsolete Sandline release cache and claims existing clients',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'sandline-sw-cleanup-'));
 try{
  mkdirSync(join(folder,'dist'));writeFileSync(join(folder,'dist/index.html'),'<html>release</html>');
  execFileSync(process.execPath,[resolve('scripts/build-sw.mjs')],{cwd:folder});
  const source=readFileSync(join(folder,'dist/sw.js'),'utf8'),current=source.match(/const CACHE="([^"]+)"/)![1];
  const events=new Map<string,(event:any)=>void>(),deleted:string[]=[];let claimed=0;
  runInNewContext(source,{
   self:{addEventListener:(name:string,handler:any)=>events.set(name,handler),clients:{claim:async()=>{claimed++;}}},
   caches:{keys:async()=>['sandline-old-with-retired-models','sandline-previous',current,'other-app-cache'],delete:async(key:string)=>{deleted.push(key);return true;}},
  });
  let activation!:Promise<void>;events.get('activate')!({waitUntil:(promise:Promise<void>)=>activation=promise});await activation;
  assert.deepEqual(deleted.sort(),['sandline-old-with-retired-models','sandline-previous']);assert.equal(claimed,1);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('versioned replacement URLs bypass a previous worker and use the new complete cache offline',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'sandline-sw-asset-version-'));
 try{
  mkdirSync(join(folder,'dist/assets/runtime'),{recursive:true});
  writeFileSync(join(folder,'dist/index.html'),'<html>release</html>');
  writeFileSync(join(folder,'dist/assets/runtime/m4.glb'),'current-model');
  const url='https://game.example/sandline/assets/runtime/m4.glb',replacementUrl=url+'?v=glb3-20261023';
  for(const previous of [true,false]){
   // Preserve the exact prior builder as a compatibility fixture: existing
   // users run that worker until this release finishes installing.
   const builder=previous?'artifacts/glb3-replacement-20261023/before/build-sw.mjs':'scripts/build-sw.mjs';
   execFileSync(process.execPath,[resolve(builder)],{cwd:folder});
   const source=readFileSync(join(folder,'dist/sw.js'),'utf8');
   const events=new Map<string,(event:any)=>void>();let fetched=0;
   runInNewContext(source,{
    URL,Request,Response,
    self:{location:{origin:'https://game.example'},registration:{scope:'https://game.example/sandline/'},addEventListener:(name:string,handler:any)=>events.set(name,handler)},
    caches:{open:async()=>({match:async(request:Request,options:CacheQueryOptions)=>{
     const cacheKey=new URL(request.url);if(options.ignoreSearch)cacheKey.search='';
     if(cacheKey.href!==url)return undefined;
     return new Response(previous?'retired-model':'current-model');
    }})},
    fetch:async(request:Request)=>{fetched++;assert.equal(request.url,replacementUrl);if(!previous)throw new Error('offline');return new Response('current-model');},
   });
   let response!:Promise<Response>;
   events.get('fetch')!({request:new Request(replacementUrl),respondWith:(promise:Promise<Response>)=>response=promise});
   assert.equal(await(await response).text(),'current-model');
   assert.equal(fetched,previous?1:0,previous?'old exact-URL cache must fetch the replacement':'new release must serve versioned assets offline');
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});


test('online navigation revalidates HTML; offline and failed responses fall back to the complete cached release',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'sandline-sw-navigation-'));
 try{
  mkdirSync(join(folder,'dist'));writeFileSync(join(folder,'dist/index.html'),'<html>release</html>');
  execFileSync(process.execPath,[resolve('scripts/build-sw.mjs')],{cwd:folder});
  const source=readFileSync(join(folder,'dist/sw.js'),'utf8');
  for(const state of ['online','offline','server-error'] as const){
   const events=new Map<string,(event:any)=>void>();let requests=0;
   runInNewContext(source,{
    URL,Request,Response,
    self:{location:{origin:'https://game.example'},registration:{scope:'https://game.example/sandline/'},addEventListener:(name:string,handler:any)=>events.set(name,handler)},
    caches:{open:async()=>({match:async(key:string)=>{assert.equal(key,'./index.html');return new Response('cached complete release');}})},
    fetch:async(_request:unknown,options:RequestInit)=>{requests++;assert.equal(options.cache,'no-cache');if(state==='offline')throw new Error('offline');return new Response('fresh release',{status:state==='server-error'?503:200});},
   });
   let response!:Promise<Response>;
   events.get('fetch')!({request:{url:'https://game.example/sandline/',method:'GET',mode:'navigate'},respondWith:(promise:Promise<Response>)=>response=promise});
   assert.equal(await (await response).text(),state==='online'?'fresh release':'cached complete release');assert.equal(requests,1);
   let intercepted=false;events.get('fetch')!({request:{url:'https://game.example/api',method:'GET',mode:'cors'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
