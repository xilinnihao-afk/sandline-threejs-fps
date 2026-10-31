import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {loadCPU} from './loadCharacterFixture';import {prepareClassicAkAssets} from '../src/render/classicAk';import {ClassicViewArms} from '../src/render/classicViewArms';import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';import {Simulation} from '../src/game/simulation';

test('approved knife finger proportions stay stable through attacks and restore every firearm joint exactly',async()=>{
 const [a,b]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(k=>loadCPU('public/assets/runtime/'+k+'.glb')));prepareClassicAkAssets(a.scene,b.scene);
 const scene=new T.Scene(),arms=new ClassicViewArms(new T.PerspectiveCamera(),scene),other=new ClassicViewArms(new T.PerspectiveCamera(),scene),knife=createViewWeapon('knife'),gun=createViewWeapon('m4'),p=new Simulation(42).state.player;scene.add(knife,gun);
 const snapshots=(model:T.Object3D)=>{const out:any[]=[];model.traverse(o=>{if(o instanceof T.Bone)out.push([o.name,...o.position.toArray(),...o.quaternion.toArray(),...o.scale.toArray()]);});return out;};const otherBefore=snapshots(other.model);
 const render=(weapon:T.Group,time:number)=>{p.weapon=weapon===knife?'knife':'m4';updateViewWeapon(weapon,p,time,0);arms.update(weapon);scene.updateMatrixWorld(true);};
 p.shotTime=-10;render(gun,0);const gunBefore=snapshots(arms.model),base=arms.model.getObjectByName('Bone09_20')!,originalScale=base.scale.clone();
 const world=(mesh:T.SkinnedMesh)=>{mesh.skeleton.update();return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld));};
 const skin=arms.model.getObjectByName('Object_9')as T.SkinnedMesh,glove=arms.model.getObjectByName('Object_7')as T.SkinnedMesh;
 const originalSkin=world(skin),seams=world(glove).flatMap((point,index)=>originalSkin.some(p=>point.distanceToSquared(p)<1e-10)?[index]:[]);assert.ok(seams.length>10);
 render(knife,0);
 for(const attack of ['slash','stab']as const)for(const age of [0,.08,.18,.32,.65,1]){
  p.meleeAttack=attack;p.shotTime=2;render(knife,2+age);const frozen=snapshots(arms.model);const points=world(skin);
  for(let n=0;n<12;n++)render(knife,2+age);
  assert.deepEqual(snapshots(arms.model),frozen,'paused hand drifts or length accumulates');assert.ok(base.scale.distanceTo(originalScale.clone().multiplyScalar(1.14))<1e-12);
  const index=skin.geometry.index!,faces:T.Triangle[]=[];for(let i=0;i<index.count;i+=3)faces.push(new T.Triangle(points[index.getX(i)],points[index.getX(i+1)],points[index.getX(i+2)]));
  const glovePoints=world(glove);for(const i of seams){const d=Math.min(...faces.map(t=>t.closestPointToPoint(glovePoints[i],new T.Vector3()).distanceTo(glovePoints[i])));assert.ok(d<1e-6,'length adjustment opens the skin/glove seam');}
  assert.ok(arms.errors.every(v=>v<1e-6));
 }
 p.shotTime=-10;render(gun,0);assert.deepEqual(snapshots(arms.model),gunBefore,'gun inherits knife scale or pose');
 for(let i=0;i<10;i++){render(knife,0);render(gun,0);assert.deepEqual(snapshots(arms.model),gunBefore);}
 assert.deepEqual(snapshots(other.model),otherBefore,'another arms instance was modified');
});
