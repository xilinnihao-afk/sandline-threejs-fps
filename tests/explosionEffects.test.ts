import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ExplosionSystem} from '../src/render/explosionSystem';
test('five layers preserve supplied origin, cap concurrency below 80 and dispose owned resources',()=>{
 const fx=new ExplosionSystem({maxConcurrent:99}),camera=new THREE.PerspectiveCamera();
 const origin=new THREE.Vector3(3,2,5);fx.spawn(origin);origin.set(99,99,99);
 const burst=fx.root.children[0];assert.deepEqual(burst.position.toArray(),[3,2,5]);
 assert.equal(burst.children.filter(o=>o instanceof THREE.Sprite).length,15);
 assert.ok(burst.children.some(o=>o instanceof THREE.Mesh&&o.geometry instanceof THREE.RingGeometry));
 assert.ok(burst.children.some(o=>o instanceof THREE.InstancedMesh&&o.geometry instanceof THREE.PlaneGeometry));
 const resources=new Set<THREE.EventDispatcher<any>>();
 burst.traverse(o=>{
  if(o instanceof THREE.Mesh&&!(o instanceof THREE.Sprite))resources.add(o.geometry);
  if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){resources.add(m);if((m as any).map)resources.add((m as any).map);}}
 });
 let disposed=0;for(const r of resources)r.addEventListener('dispose',()=>disposed++);
 for(let i=0;i<12;i++)fx.spawn(new THREE.Vector3(i,0,0));
 assert.equal(disposed,resources.size);assert.equal(fx.diagnostics().particles,68);assert.equal(fx.diagnostics().lights,2);
 fx.update(1.01,camera);assert.equal(fx.root.children.length,0);assert.equal(fx.diagnostics().particles,0);
 fx.spawn(new THREE.Vector3());fx.dispose();assert.equal(fx.root.children.length,0);
});
test('shake leaves camera yaw/pitch/position untouched and expires without residual displacement',()=>{
 const fx=new ExplosionSystem(),camera=new THREE.PerspectiveCamera();camera.position.set(0,1.6,2);camera.rotation.set(.2,.7,0,'YXZ');
 const p=camera.position.clone(),q=camera.quaternion.clone();fx.spawn(new THREE.Vector3());fx.update(.04,camera);
 const offset=fx.getShakeOffset(camera,new THREE.Vector3());assert.ok(offset.length()>0&&offset.length()<=fx.options.shakeStrength);
 assert.ok(camera.position.equals(p)&&camera.quaternion.equals(q));
 const light=fx.root.children[0].children.find(o=>o instanceof THREE.PointLight) as THREE.PointLight;const initial=light.intensity;
 fx.update(.12,camera);assert.ok(light.intensity<initial*.1);
 fx.update(1,camera);assert.equal(fx.getShakeOffset(camera,offset).length(),0);
});
