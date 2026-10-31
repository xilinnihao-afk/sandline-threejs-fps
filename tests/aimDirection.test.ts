import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FirstPersonController} from '../src/render/firstPersonController';
import {Simulation,direction,eyeHeight,MAX_LOOK_PITCH,WEAPONS} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';

test('centre screen ray shares hitscan eye pose during movement, swipe, recoil and extreme pitch',async()=>{
 const camera=new THREE.PerspectiveCamera(62,844/390,.08,240);
 const controller=await FirstPersonController.create(camera,[]);
 try{
  const sim=new Simulation(42);sim.start();sim.state.phase='playing';sim.state.settings.aimAssist=false;
  const p=sim.state.player;sim.state.actors.slice(1).forEach(a=>a.health=0);
  for(const pitch of [-10,-1.2,0,1.2,10]){
   sim.update(1/60,{...EMPTY_INPUT,lookDX:.3,lookDY:pitch,moveX:1});
   assert.ok(Math.abs(p.pitch)<=MAX_LOOK_PITCH);
   controller.update({x:p.x,y:eyeHeight(p),z:p.z,yaw:p.yaw,pitch:p.pitch,moving:true,speed:3.9,lookDX:.3,lookDY:.2,cameraKick:.18},1/60);
   camera.updateMatrixWorld(true);
   const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);
   const expected=new THREE.Vector3(...Object.values(direction(p.yaw,p.pitch)));
   assert.ok(ray.ray.direction.distanceTo(expected)<1e-10,'centre ray must not inherit cosmetic kick/sway');
   assert.ok(ray.ray.origin.distanceTo(new THREE.Vector3(p.x,eyeHeight(p),p.z))<1e-10,'eye origin must not inherit bob');
   p.guns[p.weapon].cooldown=0;p.guns[p.weapon].ammo=30;p.spread=0;
   sim.events=[];sim.fire(p);const shot=sim.events.find(e=>e.type==='shot')!;assert.ok(shot);
   const shotDirection=new THREE.Vector3(shot.endX!-shot.x!,shot.endY!-shot.y!,shot.endZ!-shot.z!).normalize();
   // Preserve the weapon's intended spread around the optical centre ray.
   assert.ok(shotDirection.angleTo(ray.ray.direction)<= (WEAPONS[p.weapon].spread+.026)*.72);
  }
  assert.equal(MAX_LOOK_PITCH,80*Math.PI/180);
 }finally{controller.world.free();}
});
