import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKnifeModel} from '../src/render/knifeModel';
import {createViewWeapon,createHeldWeapon,updateViewWeapon,updateHeldWeapon,WEAPON_PRESENTATION} from '../src/render/weapons';
import {Simulation,MELEE_CONTACT_DELAY,WEAPONS} from '../src/game/simulation';

// Construction before preload must never instantiate the retired or authored knife.
test('knife pending rig has independent finite sockets and no substitute geometry',()=>{
 const knife=createKnifeModel(),clone=createKnifeModel();let meshes=0;
 knife.traverse(node=>{if(node instanceof THREE.Mesh)meshes++;assert.ok(node.matrix.elements.every(Number.isFinite));});
 assert.equal(meshes,0);assert.equal(knife.userData.assetSource,'classic-knife-pending');
 for(const name of ['muzzle','magazine','bolt','pump','eject']){
  const socket=knife.getObjectByName(name),other=clone.getObjectByName(name);
  assert.ok(socket&&other);assert.notEqual(socket,other);
 }
 clone.position.x=3;assert.equal(knife.position.x,0);
});

test('knife animation has a timed strike, finite independent view/held transforms, frozen pause and full recovery',()=>{
 const sim=new Simulation(13);sim.start();const p=sim.state.player;p.weapon='knife';p.moving=false;p.shotTime=-10;
 const view=createViewWeapon('knife'),held=createHeldWeapon('knife');
 updateViewWeapon(view,p,10,0);updateHeldWeapon(held,p,10);
 const pivot=view.getObjectByName('weapon-pivot')!;const readyPosition=pivot.position.clone(),readyRotation=pivot.quaternion.clone();
 const heldStart=held.getObjectByName('weapon-pivot')!.position.clone();
 p.shotTime=10;updateViewWeapon(view,p,10+MELEE_CONTACT_DELAY+1e-6,1/60);
 assert.equal(view.userData.pose.phase,'slash');assert.ok(pivot.position.distanceTo(readyPosition)>.1);assert.ok(pivot.quaternion.angleTo(readyRotation)>.5);
 assert.deepEqual(held.getObjectByName('weapon-pivot')!.position.toArray(),heldStart.toArray(),'held and view transforms are independent');
 const frozen=pivot.matrix.clone();pivot.updateMatrix();frozen.copy(pivot.matrix);
 for(let frame=0;frame<20;frame++){updateViewWeapon(view,p,10+MELEE_CONTACT_DELAY+1e-6,0);pivot.updateMatrix();assert.deepEqual(pivot.matrix.elements,frozen.elements);}
 for(let frame=0;frame<45;frame++){
  const time=10+frame/60;updateViewWeapon(view,p,time,1/60);updateHeldWeapon(held,p,time);
  for(const model of [view,held]){model.updateMatrixWorld(true);model.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));assert.equal(model.userData.rig.shell.visible,false);}
 }
 updateViewWeapon(view,p,10+WEAPONS.knife.interval+1e-6,0);
 assert.equal(view.userData.pose.phase,'ready');assert.ok(pivot.position.distanceTo(readyPosition)<1e-10);assert.ok(pivot.quaternion.angleTo(readyRotation)<1e-7);
 assert.equal(WEAPON_PRESENTATION.knife.flashScale,0);assert.equal(WEAPON_PRESENTATION.knife.tracerChance,0);
});

test('slash passes through impact without stopping and stab presents a different forward blade path',async()=>{
 const {sampleKnifeMotion}=await import('../src/render/knifeMotion');
 const {MELEE_ATTACKS}=await import('../src/game/melee');
 const epsilon=1e-4,positions:Record<string,THREE.Vector3>={},rotations:Record<string,THREE.Quaternion>={};
 for(const attack of ['slash','stab'] as const){
  const at=MELEE_ATTACKS[attack].contactDelay;
  const sample=(age:number)=>{const p=new THREE.Vector3(),q=new THREE.Quaternion();sampleKnifeMotion(attack,age,p,q);return {p,q};};
  const before=sample(at-epsilon),contact=sample(at),after=sample(at+epsilon);
  const inVelocity=contact.p.clone().sub(before.p).divideScalar(epsilon),outVelocity=after.p.clone().sub(contact.p).divideScalar(epsilon);
  assert.ok(inVelocity.distanceTo(outVelocity)<.03,attack+' impact has a velocity discontinuity');
  if(attack==='slash')assert.ok(Math.abs(outVelocity.x)>.5,'slash stops at its impact pose');
  positions[attack]=contact.p;rotations[attack]=contact.q;
 }
 const blade=(attack:string)=>new THREE.Vector3(0,1,0).applyQuaternion(rotations[attack]);
 assert.ok(blade('slash').x<-.8,'slash does not cut across the sight line');
 assert.ok(blade('stab').z<-.60,'stab blade does not point forward');
 const tip=(attack:string)=>new THREE.Vector3(0,.254,0).applyQuaternion(rotations[attack]).add(positions[attack]);
 assert.ok(tip('stab').z<tip('slash').z-.20,'stab and slash have indistinguishable tip travel');
});
