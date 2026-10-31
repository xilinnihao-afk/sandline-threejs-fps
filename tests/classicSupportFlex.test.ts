import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets} from '../src/render/classicAk';
import {ClassicViewArms} from '../src/render/classicViewArms';
import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';
import {Simulation} from '../src/game/simulation';

const fingers=[['Bone31_5','Bone32_4','Bone33_3'],['Bone35_8','Bone36_7','Bone37_6'],['Bone39_11','Bone40_10','Bone41_9'],['Bone43_14','Bone44_13','Bone45_12']];
function vertices(model:THREE.Object3D,names:string[]){
 return names.flatMap(name=>{const mesh=model.getObjectByName(name) as THREE.SkinnedMesh;mesh.updateMatrixWorld(true);mesh.skeleton.update();return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));});
}
function edgeDistance(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3){
 const u=b.clone().sub(a),v=d.clone().sub(c),w=a.clone().sub(c),aa=u.dot(u),bb=u.dot(v),cc=v.dot(v),dd=u.dot(w),ee=v.dot(w),denom=aa*cc-bb*bb;
 let s=denom>1e-16?THREE.MathUtils.clamp((bb*ee-cc*dd)/denom,0,1):0;
 let t=(bb*s+ee)/cc;if(t<0){t=0;s=THREE.MathUtils.clamp(-dd/aa,0,1);}else if(t>1){t=1;s=THREE.MathUtils.clamp((bb-dd)/aa,0,1);}
 return a.clone().addScaledVector(u,s).distanceTo(c.clone().addScaledVector(v,t));
}
function surfaceGap(a:THREE.Triangle[],b:THREE.Triangle[]){
 let gap=Infinity;
 for(const p of a)for(const q of b){
  const x=[p.a,p.b,p.c],y=[q.a,q.b,q.c];
  for(const point of x)gap=Math.min(gap,q.closestPointToPoint(point,new THREE.Vector3()).distanceTo(point));
  for(const point of y)gap=Math.min(gap,p.closestPointToPoint(point,new THREE.Vector3()).distanceTo(point));
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)gap=Math.min(gap,edgeDistance(x[i],x[(i+1)%3],y[j],y[(j+1)%3]));
 }
 return gap;
}

test('free fingers flex gradually with simulation time, keep actual surface gaps and leave the right fist exact',async()=>{
 const [ak,source]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(n=>loadCPU('public/assets/runtime/'+n+'.glb')));prepareClassicAkAssets(ak.scene,source.scene);
 const scene=new THREE.Scene(),arms=new ClassicViewArms(new THREE.PerspectiveCamera(56,16/9,.02,5),scene),knife=createViewWeapon('knife');scene.add(knife);
 const player=new Simulation(13).state.player;player.weapon='knife';player.shotTime=-10;
 const originalFingers=new Map<string,THREE.Quaternion>();for(const name of fingers.flat())originalFingers.set(name,arms.model.getObjectByName(name)!.quaternion.clone());
 const draw=(time:number)=>{updateViewWeapon(knife,player,time,1/60);arms.update(knife);scene.updateMatrixWorld(true);};
 draw(0);const initial=vertices(arms.model,['Object_13']),right=vertices(arms.model,['Object_7','Object_9']);
 let maximumTravel=0,minimumGap=Infinity;
 for(let sample=0;sample<=24;sample++){
  draw(sample/4);assert.equal(knife.userData.pose.supportTime,sample/4);
  const posed=vertices(arms.model,['Object_13']);posed.forEach((point,i)=>maximumTravel=Math.max(maximumTravel,point.distanceTo(initial[i])));
  vertices(arms.model,['Object_7','Object_9']).forEach((point,i)=>assert.ok(point.distanceTo(right[i])<1e-9,'free-hand flex changes the calibrated right fist'));
  const curls=fingers.map(names=>-names.reduce((sum,name)=>sum+arms.model.getObjectByName(name)!.rotation.x,0));
  assert.ok(curls[0]>.70&&curls[3]<1.25,'free fingers become straight or tightly hooked');
  for(let i=1;i<4;i++)assert.ok(curls[i]>curls[i-1],'the natural stagger from index to little finger is lost');
  const mesh=arms.model.getObjectByName('Object_13') as THREE.SkinnedMesh,index=mesh.geometry.index!,joints=mesh.geometry.attributes.skinIndex;
  const surfaces=fingers.map(names=>{const allowed=new Set(names.slice(1)),faces:THREE.Triangle[]=[];
   for(let i=0;i<index.count;i+=3){const ids=[0,1,2].map(j=>index.getX(i+j));if(ids.every(id=>allowed.has(mesh.skeleton.bones[joints.getX(id)].name)))faces.push(new THREE.Triangle(...ids.map(id=>posed[id]) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));}assert.ok(faces.length>5);return faces;
  });
  for(let i=1;i<4;i++)minimumGap=Math.min(minimumGap,surfaceGap(surfaces[i-1],surfaces[i]));
 }
 assert.ok(maximumTravel>.002&&maximumTravel<.012,'finger flex should be subtly visible without grasping or flapping');
 assert.ok(minimumGap>.001,'padded neighboring finger surfaces touch or cross');
 const frozen=vertices(arms.model,['Object_11','Object_12','Object_13']);
 for(let repeat=0;repeat<10;repeat++){draw(6);vertices(arms.model,['Object_11','Object_12','Object_13']).forEach((point,i)=>assert.ok(point.distanceTo(frozen[i])<1e-12,'paused fingers drift'));}
 const atTimes=new Map<number,THREE.Vector3[]>();for(const time of [.5,1,1.5,2]){draw(time);atTimes.set(time,vertices(arms.model,['Object_13']));}
 for(const hz of [30,60,120])for(let frame=0;frame<=hz*2;frame++){
  const time=frame/hz;updateViewWeapon(knife,player,time,1/hz);arms.update(knife);
  if(atTimes.has(time))vertices(arms.model,['Object_13']).forEach((point,i)=>assert.ok(point.distanceTo(atTimes.get(time)![i])<1e-9,'flex depends on frame rate or elapsed update history'));
 }
 const gun=createViewWeapon('m4');scene.add(gun);player.weapon='m4';updateViewWeapon(gun,player,10,0);arms.update(gun);
 for(const [name,q] of originalFingers)assert.ok(arms.model.getObjectByName(name)!.quaternion.angleTo(q)<1e-7,'switching to a firearm fails to restore the original finger pose');
 console.log('Support finger flex geometry',{maximumTravel,minimumGap});
});
