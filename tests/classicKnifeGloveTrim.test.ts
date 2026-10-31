import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {loadCPU} from './loadCharacterFixture';import {prepareClassicAkAssets} from '../src/render/classicAk';import {ClassicViewArms} from '../src/render/classicViewArms';import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';import {Simulation} from '../src/game/simulation';
test('knife glove tuck preserves wrist/finger seams and source triangles, restores guns and never accumulates',async()=>{
 const [a,b]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(k=>loadCPU('public/assets/runtime/'+k+'.glb')));prepareClassicAkAssets(a.scene,b.scene);
 const scene=new T.Scene(),arms=new ClassicViewArms(new T.PerspectiveCamera(),scene),other=new ClassicViewArms(new T.PerspectiveCamera(),scene),glove=arms.model.getObjectByName('Object_7') as T.SkinnedMesh,source=glove.geometry,original=Array.from(source.attributes.position.array),knife=createViewWeapon('knife'),gun=createViewWeapon('m4'),actor=new Simulation(42).state.player;scene.add(knife,gun);
 const pose=(weapon:T.Group)=>{actor.weapon=weapon===knife?'knife':'m4';updateViewWeapon(weapon,actor,0,0);arms.update(weapon);scene.updateMatrixWorld(true);};pose(knife);const trimmed=glove.geometry;
 assert.notEqual(trimmed,source);assert.ok(arms.knifeGloveTrim.movedVertices.length>0);assert.deepEqual(Array.from(trimmed.index!.array),Array.from(source.index!.array));assert.equal((other.model.getObjectByName('Object_7')as T.Mesh).geometry,source);
 const points=(m:T.SkinnedMesh)=>{m.skeleton.update();return Array.from({length:m.geometry.attributes.position.count},(_,i)=>m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld));};
 const after=points(glove);glove.geometry=source;const before=points(glove);glove.geometry=trimmed;
 const seams=['Object_8','Object_9'].flatMap(n=>points(arms.model.getObjectByName(n)as T.SkinnedMesh));let fixed=0,maxMove=0;
 before.forEach((p,i)=>{const d=p.distanceTo(after[i]);maxMove=Math.max(maxMove,d);if(seams.some(q=>p.distanceToSquared(q)<1e-10)){fixed++;assert.ok(d<1e-8,'source seam moved');}});
 assert.ok(fixed>0&&maxMove>.004&&maxMove<.010);
 for(let i=0;i<5;i++){pose(gun);assert.equal(glove.geometry,source);pose(knife);assert.equal(glove.geometry,trimmed);points(glove).forEach((p,j)=>assert.ok(p.distanceTo(after[j])<1e-8));}
 assert.deepEqual(Array.from(source.attributes.position.array),original);
});
