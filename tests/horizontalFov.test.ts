import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {BASE_HORIZONTAL_FOV,clampViewScale,landscapeViewport,waitForLandscape,worldVerticalFov} from '../src/render/horizontalFov';
import {SNIPER_MAGNIFICATION} from '../src/ui/scope';
const sizes=[[1440,900],[1920,1080],[844,390],[667,375],[932,430],[2560,1080]];
function camera(width:number,height:number,scale=1,aim=1){return new THREE.PerspectiveCamera(worldVerticalFov(width,height,scale,aim),width/height,.08,240);}
function apparentWidth(c:THREE.PerspectiveCamera){return (new THREE.Vector3(.3,0,-10).project(c).x-new THREE.Vector3(-.3,0,-10).project(c).x)/2;}
test('default 90 degree horizontal lens preserves target fraction of screen width across desktop and phone',()=>{
 const expected=apparentWidth(camera(1440,900));
 for(const [w,h]of sizes){const c=camera(w,h),horizontal=2*Math.atan(Math.tan(c.fov*Math.PI/360)*c.aspect)*180/Math.PI;
  assert.ok(Math.abs(horizontal-BASE_HORIZONTAL_FOV)<1e-10);assert.ok(Math.abs(apparentWidth(c)-expected)<1e-10);
 }
 assert.ok(worldVerticalFov(844,390)<worldVerticalFov(1440,900),'wider screens crop vertically rather than shrink targets horizontally');
});
test('view scale and aiming compose as perspective magnification, including 3x sniper through resize',()=>{
 for(const [w,h]of sizes)for(const scale of [1,1.2,1.3]){
  const hip=apparentWidth(camera(w,h)),view=apparentWidth(camera(w,h,scale)),scope=apparentWidth(camera(w,h,scale,SNIPER_MAGNIFICATION));
  assert.ok(Math.abs(view/hip-scale)<1e-10);assert.ok(Math.abs(scope/view-3)<1e-10);
  assert.ok(Math.abs(apparentWidth(camera(w,h,scale,1.3))/view-1.3)<1e-10);
 }
 const c=camera(844,390,1.2,3),before=apparentWidth(c);c.aspect=667/375;c.fov=worldVerticalFov(667,375,1.2,3);c.updateProjectionMatrix();assert.ok(Math.abs(apparentWidth(c)-before)<1e-10);
});
test('portrait blocks rendering and saved zoom settings cannot produce an invalid lens',()=>{
 assert.equal(landscapeViewport(390,844),false);assert.equal(landscapeViewport(844,390),true);assert.equal(landscapeViewport(600,600),false);
 for(const [w,h]of [[0,0],[NaN,100],[100,-1],[Infinity,100]])assert.equal(landscapeViewport(w,h),false);
 for(const input of [NaN,Infinity,-1,0,1,1.3,30]){const scale=clampViewScale(input);assert.ok(scale>=1&&scale<=1.3);assert.ok(Number.isFinite(worldVerticalFov(844,390,input)));}
});


test('portrait startup holds GPU initialization until a landscape resize and removes its listener',async()=>{
 const listeners=new Set<()=>void>();let resumed=false;
 const viewport={innerWidth:390,innerHeight:844,addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn)};
 const ready=waitForLandscape(viewport as any).then(()=>{resumed=true;});await Promise.resolve();assert.equal(resumed,false);assert.equal(listeners.size,1);
 viewport.innerWidth=600;viewport.innerHeight=600;for(const fn of listeners)fn();await Promise.resolve();assert.equal(resumed,false);
 viewport.innerWidth=844;viewport.innerHeight=390;for(const fn of listeners)fn();await ready;assert.equal(resumed,true);assert.equal(listeners.size,0);
});
