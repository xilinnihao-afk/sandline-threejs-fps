import test from 'node:test';
import assert from 'node:assert/strict';
import {GyroAim} from '../src/ui/gyroAim';
import {Simulation,MAX_LOOK_PITCH} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
function fixture(motion:object|undefined={},orientation:object|undefined={}){
 const saved=new Map(['window','document','performance'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let now=0,id=0;
 const timers=new Map<number,{at:number;fn:()=>void}>();
 const screen=Object.assign(new EventTarget(),{angle:90});
 const win=Object.assign(new EventTarget(),{isSecureContext:true,innerWidth:844,innerHeight:390,screen:{orientation:screen},DeviceMotionEvent:motion as object|undefined,DeviceOrientationEvent:orientation as object|undefined,setTimeout:(fn:()=>void,ms:number)=>{const n=++id;timers.set(n,{at:now+ms,fn});return n;},clearTimeout:(n:number)=>timers.delete(n)});
 const doc=Object.assign(new EventTarget(),{hidden:false});
 Object.defineProperty(globalThis,'window',{value:win,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
 const advance=(ms:number)=>{now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}};
 const send=(type:string,data:object,ms=20)=>{advance(ms);const e=new Event(type);Object.defineProperties(e,{...Object.fromEntries(Object.entries(data).map(([key,value])=>[key,{value}])),timeStamp:{value:now}});win.dispatchEvent(e);};
 const gyro=new GyroAim();
 return {gyro,win,doc,screen,advance,motion:(beta:number|null=0,gamma:number|null=0,ms=20)=>send('devicemotion',{rotationRate:{alpha:0,beta,gamma}},ms),pose:(alpha:number|null=0,beta:number|null=0,gamma:number|null=0,ms=20)=>send('deviceorientation',{alpha,beta,gamma},ms),close(){gyro.dispose();for(const [k,d]of saved)if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}};
}
test('iOS motion and orientation permission calls both happen in the original gesture',async()=>{
 let a=0,b=0,resolve!:(s:string)=>void;const f=fixture({requestPermission:()=>{a++;return new Promise<string>(r=>resolve=r);}},{requestPermission:()=>{b++;return Promise.resolve('granted');}});
 try{f.gyro.configure('always',1);assert.equal(a+b,0);const pending=f.gyro.requestAccess();assert.equal(a,1);assert.equal(b,1);resolve('denied');await pending;assert.equal(f.gyro.permissions.motion,'denied');assert.equal(f.gyro.permissions.orientation,'granted');f.gyro.setActive(true);f.pose();f.pose(0,2,0);assert.ok(f.gyro.consume(false).x>0);assert.equal(f.gyro.source,'orientation');}finally{f.close();}
});
test('one API throwing does not block the other; late permission cannot reactivate disabled sensors',async()=>{
 let resolve!:(s:string)=>void;const f=fixture({requestPermission:()=>{throw Error('blocked');}},{requestPermission:()=>new Promise<string>(r=>resolve=r)});
 try{f.gyro.configure('always',1);const pending=f.gyro.requestAccess();f.gyro.configure('off',1);resolve('granted');await pending;assert.equal(f.gyro.listening,false);assert.equal(f.gyro.permissions.orientation,'unknown');f.gyro.configure('always',1);const retry=f.gyro.requestAccess();resolve('granted');await retry;assert.equal(f.gyro.listening,true);assert.equal(f.gyro.permissions.motion,'error');}finally{f.close();}
});
test('orientation-only browser supports relative baseline and both landscape directions',()=>{
 const f=fixture();f.win.DeviceMotionEvent=undefined;
 try{f.gyro.configure('always',1);f.gyro.setActive(true);
  for(const angle of [90,-90]){f.screen.angle=angle;f.screen.dispatchEvent(new Event('change'));f.pose(145,35,0);assert.deepEqual(f.gyro.consume(),{x:0,y:0});f.pose(145,37,0);const d=f.gyro.consume();assert.ok(angle*d.x>0);assert.ok(Math.abs(d.y)<1e-8);}
 }finally{f.close();}
});
test('orientation yaw wraps 359 to 1 degrees without jumps at an upright grip',()=>{
 const f=fixture();f.win.DeviceMotionEvent=undefined;
 try{f.screen.angle=0;f.gyro.configure('always',1);f.gyro.setActive(true);f.pose(359,90,0);f.pose(1,90,0);const d=f.gyro.consume();assert.ok(d.x>0&&d.x<.04);assert.ok(Math.abs(d.y)<1e-8);f.pose(160,90,0,10);assert.deepEqual(f.gyro.consume(),{x:0,y:0});assert.ok(f.gyro.rejected>0);}finally{f.close();}
});
test('null motion stream falls back to orientation; fresh motion owns output without doubling',()=>{
 const f=fixture();
 try{f.gyro.configure('always',1);f.gyro.setActive(true);f.motion(null,null);f.pose(0,10,0);f.pose(0,12,0);assert.ok(f.gyro.consume().x>0);assert.equal(f.gyro.source,'orientation');f.motion(20,0);f.motion(20,0);const expected=f.gyro.pending.x;f.pose(0,16,0,0);assert.equal(f.gyro.pending.x,expected);assert.equal(f.gyro.source,'motion');f.gyro.consume();f.advance(300);f.pose(0,20,0);assert.deepEqual(f.gyro.consume(),{x:0,y:0});f.pose(0,22,0);assert.ok(f.gyro.consume().x>0);}finally{f.close();}
});
test('diagnostics distinguish no events, null samples, valid stationary values and gameplay gating',()=>{
 const f=fixture();
 try{f.gyro.configure('aim',1);f.advance(2501);assert.match(f.gyro.status.detail,/没有收到/);f.motion(null,null);f.pose(null,null,null);f.advance(2501);assert.match(f.gyro.diagnosticText(),/事件：运动 1 \/ 姿态 1/);f.motion(0,0);assert.equal(f.gyro.status.code,'ready');assert.match(f.gyro.diagnosticText(),/菜单 \/ 暂停/);f.gyro.setActive(true);assert.match(f.gyro.diagnosticText(),/等待开镜/);assert.equal(f.gyro.diagnostics().raw.motion?.['beta' as keyof object],0);}finally{f.close();}
});
test('resume, calibration and screen rotation discard old orientation baselines',()=>{
 const f=fixture();f.win.DeviceMotionEvent=undefined;
 try{f.gyro.configure('always',1);f.gyro.setActive(true);f.pose(0,10,0);f.pose(0,12,0);assert.ok(f.gyro.consume().x>0);f.gyro.setActive(false);f.pose(0,30,0);f.gyro.setActive(true);f.pose(0,50,0);assert.deepEqual(f.gyro.consume(),{x:0,y:0});f.gyro.calibrate();f.pose(0,-50,0);assert.deepEqual(f.gyro.consume(),{x:0,y:0});f.screen.angle=-90;f.screen.dispatchEvent(new Event('change'));f.pose(0,50,0);assert.deepEqual(f.gyro.consume(),{x:0,y:0});f.pose(0,52,0);assert.ok(f.gyro.consume().x<0);}finally{f.close();}
});
test('low-frequency sensor events work; smoothing suppresses jumps and stationary values stop immediately',()=>{
 const f=fixture();
 try{f.gyro.configure('always',1);f.gyro.setActive(true);f.motion(0,0,125);f.motion(20,0,125);assert.ok(f.gyro.consume().x>0);f.gyro.calibrate();f.motion(0,0);f.motion(100,0);const d=f.gyro.consume();assert.ok(d.x>0&&d.x<100*Math.PI/180*.02);f.motion(.1,.1);assert.deepEqual(f.gyro.consume(),{x:0,y:0});}finally{f.close();}
});
test('orientation fallback reaches actual player yaw/pitch while retaining view limits and touch',()=>{
 const f=fixture();f.win.DeviceMotionEvent=undefined;
 try{f.gyro.configure('always',1);f.gyro.setActive(true);f.pose();f.pose(0,2,1);const d=f.gyro.consume();const sim=new Simulation(42);sim.start();sim.state.phase='playing';sim.state.settings.aimAssist=false;const before=sim.state.player.yaw;
  sim.update(1/60,{...EMPTY_INPUT,gyroDX:d.x,gyroDY:d.y,inputSource:'gyro'});assert.ok(Math.abs(sim.state.player.yaw-before)>0.001);assert.ok(Math.abs(sim.state.player.pitch)>0.001);sim.update(1/60,{...EMPTY_INPUT,gyroDY:99});assert.ok(Math.abs(sim.state.player.pitch)<=MAX_LOOK_PITCH);
 }finally{f.close();}
});
