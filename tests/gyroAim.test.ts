import test from 'node:test';
import assert from 'node:assert/strict';
import {GyroAim,type GyroStatus} from '../src/ui/gyroAim';

class Target extends EventTarget {
 listeners=new Map<string,Set<EventListenerOrEventListenerObject>>();
 override addEventListener(type:string,fn:EventListenerOrEventListenerObject|null,options?:boolean|AddEventListenerOptions){
  if(fn){const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}super.addEventListener(type,fn,options);
 }
 override removeEventListener(type:string,fn:EventListenerOrEventListenerObject|null,options?:boolean|EventListenerOptions){if(fn)this.listeners.get(type)?.delete(fn);super.removeEventListener(type,fn,options);}
 count(type:string){return this.listeners.get(type)?.size??0;}
}
function environment(permission?:()=>Promise<string>){
 const original=new Map(['window','document','performance'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let now=0,id=0;
 const timers=new Map<number,{at:number;fn:()=>void}>();
 const orientation=Object.assign(new Target(),{angle:90});
 const win=Object.assign(new Target(),{isSecureContext:true,innerWidth:844,innerHeight:390,screen:{orientation},DeviceMotionEvent:{requestPermission:permission} as any,setTimeout:(fn:()=>void,ms:number)=>{const n=++id;timers.set(n,{at:now+ms,fn});return n;},clearTimeout:(n:number)=>timers.delete(n)});
 const doc=Object.assign(new Target(),{hidden:false});
 Object.defineProperty(globalThis,'window',{value:win,configurable:true});
 Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
 Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
 const advance=(ms:number)=>{now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}};
 const sample=(beta:number|null=20,gamma:number|null=0,ms=10,stamp?:number)=>{
  advance(ms);const e=new Event('devicemotion');Object.defineProperties(e,{rotationRate:{value:{alpha:0,beta,gamma}},timeStamp:{value:stamp??now}});win.dispatchEvent(e);
 };
 const restore=()=>{for(const [k,d]of original)if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);};
 return {win,doc,orientation,timers,advance,sample,restore};
}
function near(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);}

test('permission is invoked in the click stack; configure never prompts; denial is actionable',async()=>{
 let calls=0;const env=environment(async()=>{calls++;return 'denied';}),statuses:GyroStatus[]=[];const gyro=new GyroAim(s=>statuses.push(s));
 try{
  gyro.configure('aim',1);assert.equal(calls,0);assert.equal(statuses.at(-1)?.code,'permission');
  const request=gyro.requestAccess();assert.equal(calls,1);await request;
  assert.equal(statuses.at(-1)?.code,'denied');assert.equal(statuses.at(-1)?.needsGesture,true);assert.equal(env.win.count('devicemotion'),0);
 }finally{gyro.dispose();env.restore();}
});

test('granted access listens once; rejection and late grant cannot reactivate off/disposed gyro',async()=>{
 let resolve!:(value:string)=>void;const env=environment(()=>new Promise(r=>{resolve=r;}));const gyro=new GyroAim();
 try{
  gyro.configure('always',1);const request=gyro.requestAccess();gyro.configure('off',1);resolve('granted');await request;
  assert.equal(env.win.count('devicemotion'),0);
  gyro.configure('always',1);const next=gyro.requestAccess();resolve('granted');await next;assert.equal(env.win.count('devicemotion'),1);
  await gyro.requestAccess();assert.equal(env.win.count('devicemotion'),1);
  gyro.dispose();assert.equal(env.win.count('devicemotion'),0);
  assert.equal(env.win.count('resize'),0);assert.equal(env.win.count('orientationchange'),0);assert.equal(env.orientation.count('change'),0);assert.equal(env.doc.count('visibilitychange'),0);assert.equal(env.timers.size,0);
 }finally{gyro.dispose();env.restore();}
});

test('permission rejection is recoverable and device errors are reported truthfully',async()=>{
 const env=environment(async()=>{throw new Error('blocked');}),statuses:GyroStatus[]=[];const gyro=new GyroAim(s=>statuses.push(s));
 try{
  gyro.configure('always',1);await gyro.requestAccess();assert.equal(statuses.at(-1)?.code,'error');
  env.win.isSecureContext=false;await gyro.requestAccess();assert.equal(statuses.at(-1)?.code,'insecure');
  env.win.isSecureContext=true;env.win.DeviceMotionEvent=undefined;await gyro.requestAccess();assert.equal(statuses.at(-1)?.code,'unavailable');
 }finally{gyro.dispose();env.restore();}
});

test('no permission API starts without a prompt; null data times out, retry and valid data recover',async()=>{
 const env=environment(),statuses:GyroStatus[]=[];const gyro=new GyroAim(s=>statuses.push(s));
 try{
  gyro.configure('always',1);assert.equal(statuses.at(-1)?.code,'waiting');env.sample(null,null);env.advance(2500);assert.equal(statuses.at(-1)?.code,'no-data');
  await gyro.requestAccess();assert.equal(statuses.at(-1)?.code,'waiting');env.sample();assert.equal(statuses.at(-1)?.code,'ready');env.advance(1501);assert.equal(statuses.at(-1)?.code,'no-data');
 }finally{gyro.dispose();env.restore();}
});

test('landscape +90/-90 rates map to correct Three yaw/pitch signs without compass headings',()=>{
 const env=environment();const gyro=new GyroAim();
 try{
  gyro.configure('always',1);gyro.setActive(true);
  env.sample(30,20);env.sample(30,20);let delta=gyro.consume(false);
  near(delta.x,30*Math.PI/180*.01);near(delta.y,-20*Math.PI/180*.01);
  env.orientation.angle=-90;env.orientation.dispatchEvent(new Event('change'));
  assert.deepEqual(gyro.consume(false),{x:0,y:0});env.sample(30,20);env.sample(30,20);delta=gyro.consume(false);
  near(delta.x,-30*Math.PI/180*.01);near(delta.y,20*Math.PI/180*.01);
 }finally{gyro.dispose();env.restore();}
});

test('integration is sample-rate independent and sensitivity is separate from touch',()=>{
 for(const hz of [30,60,120]){
  const env=environment();const gyro=new GyroAim();
  try{
   gyro.configure('always',1.5);gyro.setActive(true);env.sample(30,0,0);let yaw=0;
   for(let i=0;i<hz*2;i++){env.sample(30,0,1000/hz);yaw+=gyro.consume(false).x;}
   near(yaw,Math.PI/2);
  }finally{gyro.dispose();env.restore();}
 }
});

test('aim-only, pause, hidden, portrait and off discard movement rather than replaying it',()=>{
 const env=environment();const gyro=new GyroAim();
 try{
  gyro.configure('aim',1);gyro.setActive(true);env.sample();env.sample();assert.deepEqual(gyro.consume(false),{x:0,y:0});
  gyro.consume(true);env.sample();env.sample();assert.ok(gyro.consume(true).x>0);
  env.sample();gyro.setActive(false);env.sample();assert.deepEqual(gyro.consume(true),{x:0,y:0});
  gyro.setActive(true);assert.deepEqual(gyro.consume(true),{x:0,y:0});env.sample();env.sample();assert.ok(gyro.consume(true).x>0);
  env.doc.hidden=true;env.doc.dispatchEvent(new Event('visibilitychange'));env.sample();env.sample();assert.deepEqual(gyro.consume(true),{x:0,y:0});
  env.doc.hidden=false;env.doc.dispatchEvent(new Event('visibilitychange'));gyro.setActive(true);env.win.innerWidth=390;env.win.innerHeight=844;env.sample();env.sample();assert.deepEqual(gyro.consume(true),{x:0,y:0});
  env.win.innerWidth=844;env.win.innerHeight=390;env.win.dispatchEvent(new Event('resize'));env.sample();env.sample();assert.ok(gyro.consume(true).x>0);
  env.sample();gyro.consume(false);gyro.consume(true);assert.deepEqual(gyro.consume(true),{x:0,y:0});
  gyro.configure('off',1);assert.deepEqual(gyro.consume(true),{x:0,y:0});assert.equal(env.win.count('devicemotion'),0);
 }finally{gyro.dispose();env.restore();}
});

test('invalid samples, spikes, stale events and duplicate timestamps cannot jump or keep rotating',()=>{
 const env=environment();const gyro=new GyroAim();
 try{
  gyro.configure('always',1);gyro.setActive(true);env.sample();env.sample();env.sample(NaN,0);assert.deepEqual(gyro.consume(false),{x:0,y:0});
  env.sample();env.sample(2000,0);assert.deepEqual(gyro.consume(false),{x:0,y:0});
  env.sample();env.sample(20,0,500);assert.deepEqual(gyro.consume(false),{x:0,y:0});
  env.sample();env.sample();env.advance(251);assert.deepEqual(gyro.consume(false),{x:0,y:0});
  env.sample(20,0,0,1);env.sample(20,0,0,1);assert.deepEqual(gyro.consume(false),{x:0,y:0});
  env.sample(20,0,0,0);assert.deepEqual(gyro.consume(false),{x:0,y:0});
  gyro.calibrate();env.sample();env.sample();assert.ok(gyro.consume(false).x>0);assert.deepEqual(gyro.consume(false),{x:0,y:0});
 }finally{gyro.dispose();env.restore();}
});

test('stationary sensor noise has no drift and accumulated movement has a safety bound',()=>{
 const env=environment();const gyro=new GyroAim();
 try{
  gyro.configure('always',3);gyro.setActive(true);env.sample(.1,.1);
  for(let i=0;i<1000;i++)env.sample(.1,.1);
  assert.deepEqual(gyro.consume(false),{x:0,y:0});
  env.sample(500,500);env.sample(500,500);env.sample(500,500);const delta=gyro.consume(false);assert.ok(Math.abs(delta.x)<=.35&&Math.abs(delta.y)<=.35);
  gyro.calibrate();assert.deepEqual(gyro.consume(false),{x:0,y:0});
 }finally{gyro.dispose();env.restore();}
});
