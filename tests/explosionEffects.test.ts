import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ExplosionSystem} from '../src/render/explosionSystem';
const camera=()=>{const c=new THREE.PerspectiveCamera();c.position.set(0,1.6,2);return c;};
const light=(burst:THREE.Object3D)=>burst.getObjectByName('blast-light') as THREE.PointLight;
const sprites=(burst:THREE.Object3D,name:string)=>burst.children.filter(o=>o.name===name) as THREE.Sprite[];
function resources(root:THREE.Object3D){
 const result=new Set<THREE.EventDispatcher<any>>();
 root.traverse(o=>{
  if(o instanceof THREE.InstancedMesh)result.add(o);
  if(o instanceof THREE.Mesh&&!(o instanceof THREE.Sprite))result.add(o.geometry);
  if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){
   for(const m of Array.isArray(o.material)?o.material:[o.material]){
    result.add(m);if((m as THREE.SpriteMaterial).map)result.add((m as THREE.SpriteMaterial).map!);
   }
  }
 });return result;
}
test('fixed two-slot pool preserves origins, stays below 80 elements and frees every owned resource once',()=>{
 const fx=new ExplosionSystem({maxConcurrent:99}),c=camera(),origin=new THREE.Vector3(3,2,5);
 fx.spawn(origin);origin.set(99,99,99);assert.deepEqual(fx.root.children[0].position.toArray(),[3,2,5]);
 fx.spawn(new THREE.Vector3());const originalSlots=new Set(fx.root.children),owned=resources(fx.root);
 assert.equal(originalSlots.size,2);assert.equal(fx.diagnostics().particles,76);
 const disposed=new Map<THREE.EventDispatcher<any>,number>();
 for(const r of owned){disposed.set(r,0);r.addEventListener('dispose',()=>disposed.set(r,disposed.get(r)!+1));}
 for(let i=0;i<20;i++)fx.spawn(new THREE.Vector3(i,0,0));
 assert.deepEqual(new Set(fx.root.children),originalSlots);assert.deepEqual(resources(fx.root),owned);
 assert.ok([...disposed.values()].every(n=>n===0));assert.equal(fx.diagnostics().lights,2);
 fx.update(3,c);assert.equal(fx.root.children.length,0);assert.equal(fx.diagnostics().particles,0);
 fx.spawn(new THREE.Vector3());fx.reset();assert.equal(fx.root.children.length,0);
 assert.ok([...disposed.values()].every(n=>n===0),'reset returns slots to pool');
 fx.dispose();fx.dispose();assert.ok([...disposed.values()].every(n=>n===1));
 fx.spawn(new THREE.Vector3());assert.equal(fx.root.children.length,0);assert.equal(fx.diagnostics().pooled,0);
});
test('brief impact and light finish while distinct smoke continues rising and fades to zero',()=>{
 const fx=new ExplosionSystem(),c=camera();fx.spawn(new THREE.Vector3());const b=fx.root.children[0];
 const initial=light(b).intensity;fx.update(.12,c);assert.ok(light(b).intensity<initial*.04);
 assert.equal(b.getObjectByName('blast-flash')!.visible,false);
 const smoke=sprites(b,'blast-smoke');fx.update(.48,c);
 const low=smoke[0].position.y,opacity=smoke[0].material.opacity;
 assert.ok(smoke.every(s=>s.visible));assert.ok(smoke.every(s=>s.position.y>=s.scale.y*.5),'rising smoke clears the ground instead of forming a clipped straight edge');assert.ok(opacity>0&&opacity<=.72);
 assert.equal(light(b).intensity,0);assert.equal(fx.getShakeOffset(c,new THREE.Vector3()).length(),0);
 assert.ok(sprites(b,'blast-fire').every(s=>!s.visible));
 fx.update(.7,c);assert.ok(smoke[0].position.y>low&&smoke[0].position.y<1.2,'residue stays low enough to read against the ground');assert.ok(smoke[0].material.opacity<opacity);
 assert.equal(fx.diagnostics().residue,1);assert.equal(fx.diagnostics().lights,0);
 assert.ok(sprites(b,'blast-dust').every(s=>!s.visible));fx.update(1.51,c);assert.equal(fx.diagnostics().active,0);fx.dispose();
});
test('bombs increase footprint and residue, without stretching flash, fire or shake into slow motion',()=>{
 const grenade=new ExplosionSystem(),bomb=new ExplosionSystem(),c=camera();
 grenade.spawn(new THREE.Vector3());bomb.spawn(new THREE.Vector3(),false,'bomb');
 const g=grenade.root.children[0],b=bomb.root.children[0];assert.ok(b.scale.x>g.scale.x);assert.ok(light(b).intensity>light(g).intensity);
 grenade.update(.61,c);bomb.update(.61,c);
 for(const fx of [grenade,bomb]){
  assert.ok(sprites(fx.root.children[0],'blast-fire').every(s=>!s.visible));
  assert.equal(fx.getShakeOffset(c,new THREE.Vector3()).length(),0);
 }
 grenade.update(2.3,c);bomb.update(2.3,c);assert.equal(grenade.diagnostics().active,0);assert.equal(bomb.diagnostics().active,1);
 bomb.update(2.8,c);assert.equal(bomb.diagnostics().active,0);grenade.dispose();bomb.dispose();
});
test('occluded blasts emit no local illumination, preserve depth testing and attenuate camera shake',()=>{
 const open=new ExplosionSystem(),covered=new ExplosionSystem(),c=camera();
 open.spawn(new THREE.Vector3());covered.spawn(new THREE.Vector3(),true,'bomb');
 assert.equal(light(covered.root.children[0]).intensity,0);
 for(const root of [open.root,covered.root])root.traverse(o=>{
  if(o instanceof THREE.Mesh||o instanceof THREE.Sprite)for(const m of Array.isArray(o.material)?o.material:[o.material]){
   assert.equal(m.depthTest,true);assert.equal(m.depthWrite,false);
  }
 });
 open.update(.04,c);covered.update(.04,c);const p=c.position.clone(),q=c.quaternion.clone();
 const a=open.getShakeOffset(c,new THREE.Vector3()),b=covered.getShakeOffset(c,new THREE.Vector3());
 assert.ok(a.length()>0&&a.length()<=open.options.shakeStrength);assert.ok(b.length()<a.length()*.5);
 assert.ok(c.position.equals(p)&&c.quaternion.equals(q));assert.equal(light(covered.root.children[0]).intensity,0);
 open.update(.5,c);covered.update(.5,c);assert.equal(open.getShakeOffset(c,a).length(),0);assert.equal(covered.getShakeOffset(c,b).length(),0);
 open.dispose();covered.dispose();
});
test('cloud texture has transparent edges and soft density; accumulated time remains frame-rate independent',()=>{
 const a=new ExplosionSystem(),b=new ExplosionSystem(),c=camera();a.spawn(new THREE.Vector3());b.spawn(new THREE.Vector3());
 const texture=sprites(a.root.children[0],'blast-smoke')[0].material.map as THREE.DataTexture;
 const data=texture.image.data as Uint8Array;let alpha=0,max=0;
 for(let i=3;i<data.length;i+=4){alpha+=data[i];max=Math.max(max,data[i]);}
 assert.ok(alpha/(data.length/4)/255>.15&&alpha/(data.length/4)/255<.3);assert.ok(max<255);assert.equal(data[3],0);
 a.update(.8,c);for(let i=0;i<96;i++)b.update(1/120,c);
 const sa=sprites(a.root.children[0],'blast-smoke'),sb=sprites(b.root.children[0],'blast-smoke');
 sa.forEach((p,i)=>{assert.ok(p.position.distanceTo(sb[i].position)<1e-10);assert.ok(Math.abs(p.material.opacity-sb[i].material.opacity)<1e-10);});
 a.update(Number.NaN,c);a.update(-1,c);assert.ok(Number.isFinite(sa[0].position.y));
 a.dispose();b.dispose();
});
test('bomb upgrade expands dust and illumination but reuses the finite pool with bounded shake and residue',()=>{
 const grenade=new ExplosionSystem(),bomb=new ExplosionSystem(),c=camera();
 grenade.spawn(new THREE.Vector3());bomb.spawn(new THREE.Vector3(),false,'bomb');
 const g=grenade.root.children[0],b=bomb.root.children[0];
 assert.equal(light(b).distance,24);assert.ok(light(b).intensity>700);assert.equal(bomb.diagnostics().maxLifetime,5.6);
 const owned=resources(bomb.root);
 grenade.update(.2,c);bomb.update(.2,c);
 const ring=(root:THREE.Object3D)=>root.getObjectByName('blast-pressure-dust')!;
 assert.ok(ring(b).scale.x*b.scale.x>ring(g).scale.x*g.scale.x*2);
 assert.ok(light(b).intensity>0);assert.equal(light(g).intensity,0);
 c.position.set(0,1.6,23);assert.ok(bomb.getShakeOffset(c,new THREE.Vector3()).length()>0);
 assert.equal(grenade.getShakeOffset(c,new THREE.Vector3()).length(),0);
 for(let n=0;n<300;n++){
  bomb.update(1/60,c);
  assert.ok(bomb.getShakeOffset(c,new THREE.Vector3()).length()<=bomb.options.shakeStrength);
  b.traverse(o=>{assert.ok([...o.position.toArray(),...o.scale.toArray(),...o.quaternion.toArray()].every(Number.isFinite));
   if(o instanceof THREE.Sprite)assert.ok(o.material.opacity>=0&&o.material.opacity<=1);
  });
 }
 assert.equal(bomb.diagnostics().lights,0);assert.equal(bomb.diagnostics().particles,38);
 assert.ok(sprites(b,'blast-smoke').some(s=>s.visible));
 bomb.update(.5,c);assert.equal(bomb.diagnostics().active,0);
 bomb.spawn(new THREE.Vector3(),false,'bomb');assert.deepEqual(resources(bomb.root),owned);
 bomb.spawn(new THREE.Vector3(),false,'bomb');const slots=new Set(bomb.root.children),both=resources(bomb.root);
 for(let i=0;i<40;i++)bomb.spawn(new THREE.Vector3(i,0,0),i%2===0,i%3===0?'grenade':'bomb');
 assert.deepEqual(new Set(bomb.root.children),slots);assert.deepEqual(resources(bomb.root),both);
 assert.equal(bomb.diagnostics().particles,76);assert.equal(bomb.diagnostics().lights,1);
 bomb.update(6,c);assert.equal(bomb.diagnostics().active,0);grenade.dispose();bomb.dispose();
});
