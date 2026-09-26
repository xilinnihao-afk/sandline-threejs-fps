import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleFullscreen } from '../src/ui/mobileBrowser';
test('standard fullscreen is called in the same user activation turn',async()=>{
 let called=false;const doc={documentElement:{requestFullscreen:()=>{called=true;return Promise.resolve();}},fullscreenEnabled:true} as unknown as Document;
 const result=toggleFullscreen(doc,'Android Chrome');assert.equal(called,true);assert.equal(await result,null);
});
test('WebKit fullscreen fallback and exit both work',async()=>{
 let entered=0,exited=0;const doc={documentElement:{webkitRequestFullscreen:()=>{entered++;}},webkitFullscreenElement:null,webkitExitFullscreen:()=>{exited++;}};
 assert.equal(await toggleFullscreen(doc as unknown as Document,'Safari'),null);doc.webkitFullscreenElement={} as any;await toggleFullscreen(doc as unknown as Document,'Safari');assert.equal(entered,1);assert.equal(exited,1);
});
test('unsupported iPhone and rejected WeChat calls show actionable instructions',async()=>{
 assert.match((await toggleFullscreen({documentElement:{}} as Document,'iPhone Safari'))!,/添加到主屏幕/);
 const doc={documentElement:{requestFullscreen:()=>Promise.reject(new Error('denied'))}} as unknown as Document;
 assert.match((await toggleFullscreen(doc,'MicroMessenger'))!,/在浏览器中打开/);
});
