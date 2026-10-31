import * as THREE from 'three';
import {weaponRackPose} from '../game/weaponSwitch';
import {EquipHandGrip} from './equipHandGrip';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {WEAPONS} from '../game/simulation';
import type {Actor} from '../game/types';

// The source view geometry uses GoldSrc-style units and +Z forward. Keep the
// original hand proportions; the display scale below is fitted to the reference.
const UNIT=.03;
const ORIGIN=new THREE.Vector3(2.832615,4.2,16.2);
export const CLASSIC_AK_OFFSET={x:.22,y:-.15,z:-.32};
export const CLASSIC_AK_HORIZONTAL_FOV=90;
let source:{gun:THREE.Group;arms:THREE.Group}|undefined;
let loading:Promise<void>|undefined;
const smooth=(a:number,b:number,x:number)=>THREE.MathUtils.smoothstep(x,a,b);
const vec=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
function canonical(v:THREE.Vector3){return v.sub(ORIGIN).multiply(vec(UNIT,UNIT,-UNIT));}

export function loadClassicAkAssets(anisotropy=1):Promise<void>{
  return loading??=(async()=>{
    const base=`${import.meta.env?.BASE_URL??'/'}assets/runtime/`;
    const [gun,arms]=await Promise.all(['cs16-ak47.glb','cs16-arms-rigged.glb'].map(file=>new GLTFLoader().loadAsync(base+file)));
    prepareClassicAkAssets(gun.scene,arms.scene,anisotropy);
  })().catch(error=>{loading=undefined;throw error;});
}

/** Also used by CPU asset validation: all source mesh/UV data remains intact. */
export function prepareClassicAkAssets(gun:THREE.Group,arms:THREE.Group,anisotropy=1):void{
  // The uploaded M4 hand package mirrors X and stretches Y. Its underlying
  // CS skeleton and bind pose match the AK exactly once that wrapper is reset.
  const wrapper=arms.getObjectByName('default_counter-strike_hands_riggedglb');
  if(!wrapper)throw new Error('Classic hand source wrapper is missing');
  wrapper.scale.set(1,1,1);wrapper.updateMatrix();
  for(const root of [gun,arms])root.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const convert=(original:THREE.Material)=>{
      const old=original as THREE.MeshStandardMaterial;
      if(old.map){old.map.anisotropy=Math.max(1,Math.min(4,anisotropy));old.map.magFilter=THREE.LinearFilter;}
      // These textures already contain the classic painted lighting. PBR's
      // bright reflection probe would wash out the wood and turn skin white.
      const material=new THREE.MeshBasicMaterial({map:old.map,color:old.color??0xffffff,toneMapped:false});
      if(/view_skin|view_finger/i.test(old.name))material.color.setRGB(.94,.86,.62);
      else if(!/view_glove|wood|forearm|handle/i.test(old.name))material.color.setRGB(.65,.70,.51);
      material.name=old.name;return material;
    };
    object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
    object.frustumCulled=false;object.castShadow=object.receiveShadow=false;
  });
  source={gun,arms};
}

/** Every first-person weapon shares this one downloaded CS16 hand asset. */
export function createClassicArmsFrame():{group:THREE.Group;model:THREE.Group}{
  if(!source)throw new Error('Classic arms must be loaded before creating a view');
  const model=cloneSkeleton(source.arms) as THREE.Group;
  const group=new THREE.Group();group.name='classic-cs16-hands';
  group.scale.set(UNIT,UNIT,-UNIT);group.position.copy(ORIGIN).multiply(group.scale).negate();
  group.add(model);group.updateWorldMatrix(true,true);
  return {group,model};
}

interface ClassicRig {
  equipGrip:EquipHandGrip;
  pivot:THREE.Group;magazine:THREE.Group;bolt:THREE.Group;support:THREE.Group;
  forearm:THREE.Object3D;wrist:THREE.Object3D;forearmRest:THREE.Matrix4;wristRest:THREE.Matrix4;
  supportRest:THREE.Vector3;magContact:THREE.Vector3;supportContact:THREE.Vector3;
  lastTime:number|null;lastYaw:number;lastPitch:number;motion:number;stride:number;swayX:number;swayY:number;
}

function makeGun(sourceGun:THREE.Group){
  const gun=new THREE.Group();gun.name='classic-ak-gun';
  const magazine=new THREE.Group();magazine.name='magazine';gun.add(magazine);
  const bolt=new THREE.Group();bolt.name='bolt';gun.add(bolt);
  sourceGun.updateWorldMatrix(true,true);
  // Bake the rigid weapon pieces in their authored rest pose. Moving pieces
  // come from source skin weights, so the magazine/charging handle are real
  // original triangles, with no duplicate receiver or invented moving box.
  sourceGun.traverse(object=>{
    if(!(object instanceof THREE.SkinnedMesh))return;
    object.skeleton.update();
    const geo=object.geometry,positions=geo.attributes.position,index=geo.index!;
    const geometry=geo.clone(),out=geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const p=canonical(object.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(object.matrixWorld));
      out.setXYZ(i,p.x,p.y,p.z);
    }
    // The conversion has negative determinant: flip winding as well as Z.
    const normals=geometry.attributes.normal;
    for(let i=0;i<normals.count;i++)normals.setZ(i,-normals.getZ(i));
    geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');
    const batches={body:[] as number[],magazine:[] as number[],bolt:[] as number[]};
    const joint=geo.attributes.skinIndex,weight=geo.attributes.skinWeight;
    for(let i=0;i<index.count;i+=3){
      const vertices=[index.getX(i),index.getX(i+1),index.getX(i+2)];
      const names=vertices.map(v=>{let slot=0;for(let k=1;k<4;k++)if(weight.array[v*4+k]>weight.array[v*4+slot])slot=k;return object.skeleton.bones[joint.array[v*4+slot]].name;});
      // Bone52 is the large receiver bolt/charging assembly; Bone25/Bone48
      // are small trigger parts below it and must stay with the grip.
      const key=names.every(n=>n==='Bone50')?'magazine':names.every(n=>n==='Bone52')?'bolt':'body';
      batches[key].push(vertices[0],vertices[2],vertices[1]);
    }
    for(const [name,triangles] of Object.entries(batches)){
      if(!triangles.length)continue;
      const part=geometry.clone();part.setIndex(triangles);part.computeBoundingBox();part.computeBoundingSphere();
      const mesh=new THREE.Mesh(part,object.material);mesh.name=`cs16:${(object.material as THREE.Material).name}:${name}`;
      (name==='magazine'?magazine:name==='bolt'?bolt:gun).add(mesh);
    }
    geometry.dispose();
  });
  const muzzle=new THREE.Object3D();muzzle.name='muzzle';muzzle.position.copy(canonical(vec(2.83,5.39,35.77)));gun.add(muzzle);
  const eject=new THREE.Object3D();eject.name='eject';eject.position.copy(canonical(vec(3.25,5.1,18.9)));gun.add(eject);
  return {gun,magazine,bolt};
}

export function createClassicAkView():THREE.Group|null{
  if(!source)return null;
  const root=new THREE.Group();root.name='viewmodel:rifle';
  const pivot=new THREE.Group();pivot.name='weapon-pivot';root.add(pivot);
  const {gun,magazine,bolt}=makeGun(source.gun);pivot.add(gun);
  const {group:frame,model:arms}=createClassicArmsFrame();
  const equipGrip=new EquipHandGrip(arms,'left');
  pivot.add(frame);root.updateWorldMatrix(true,true);
  // Source naming predates the right-handed view: Bone04 drives the support
  // arm, Bone01 drives the trigger arm. Both remain their original skin rigs.
  const supportBone=arms.getObjectByName('Bone04_17')!;
  const wrist=arms.getObjectByName('Bone_Righthand_16')!;
  const support=new THREE.Group();support.name='classic-support-driver';pivot.add(support);
  support.position.copy(wrist.getWorldPosition(new THREE.Vector3()));
  support.updateWorldMatrix(true,false);support.attach(supportBone);
  supportBone.updateMatrix();wrist.updateMatrix();
  const supportRest=support.position.clone();
  const supportContact=canonical(vec(2.83,4.25,25.25));
  const magContact=canonical(vec(2.83,.9,21.7));
  root.userData.assetSource='sketchfab-cs16';root.userData.assetKind='rifle';root.userData.embeddedArms=true;
  root.userData.rig={equipGrip,pivot,magazine,bolt,support,forearm:supportBone,wrist,forearmRest:supportBone.matrix.clone(),wristRest:wrist.matrix.clone(),supportRest,supportContact,magContact,lastTime:null,lastYaw:0,lastPitch:0,motion:0,stride:0,swayX:0,swayY:0} satisfies ClassicRig;
  root.userData.muzzle=gun.getObjectByName('muzzle');
  root.userData.pose={weapon:'rifle',phase:'ready',progress:0,magazineOffset:0,boltTravel:0,recoil:0};
  return root;
}

const restQuaternion=new THREE.Quaternion(),handQuaternion=new THREE.Quaternion();
const work=new THREE.Vector3(),contact=new THREE.Vector3(),rack=vec(-.017,.05,-.16);
const wristPosition=new THREE.Vector3(),elbowPosition=new THREE.Vector3(),direction=new THREE.Vector3(),elbowDirection=new THREE.Vector3();
const armRotation=new THREE.Quaternion(),pivotRotation=new THREE.Quaternion();
const armMatrix=new THREE.Matrix4(),wristMatrix=new THREE.Matrix4(),parentInverse=new THREE.Matrix4();
function restore(object:THREE.Object3D,matrix:THREE.Matrix4){matrix.decompose(object.position,object.quaternion,object.scale);}
function lowerElbow(root:THREE.Group,r:ClassicRig,blend:number){
  if(blend===0)return;
  root.updateMatrixWorld(true);
  wristMatrix.copy(r.wrist.matrixWorld);wristPosition.setFromMatrixPosition(wristMatrix);
  elbowPosition.setFromMatrixPosition(r.forearm.matrixWorld);
  direction.copy(elbowPosition).sub(wristPosition).normalize();
  r.pivot.getWorldQuaternion(pivotRotation);
  elbowDirection.set(-.40,-.73,.55).normalize().applyQuaternion(pivotRotation);
  elbowDirection.lerpVectors(direction,elbowDirection,blend).normalize();
  armRotation.setFromUnitVectors(direction,elbowDirection);
  // Rotate the forearm about its wrist without scaling; keep the hand's exact
  // contact transform. This keeps the open elbow end below the viewport.
  armMatrix.makeTranslation(wristPosition.x,wristPosition.y,wristPosition.z)
    .multiply(parentInverse.makeRotationFromQuaternion(armRotation))
    .multiply(parentInverse.makeTranslation(-wristPosition.x,-wristPosition.y,-wristPosition.z))
    .multiply(r.forearm.matrixWorld);
  parentInverse.copy(r.forearm.parent!.matrixWorld).invert();
  restore(r.forearm,armMatrix.premultiply(parentInverse));r.forearm.updateMatrixWorld(true);
  parentInverse.copy(r.wrist.parent!.matrixWorld).invert();
  restore(r.wrist,wristMatrix.premultiply(parentInverse));r.wrist.updateMatrixWorld(true);
}
export function updateClassicAkView(root:THREE.Group,actor:Actor,time:number,delta:number):void{
  const r=root.userData.rig as ClassicRig,gun=actor.guns.rifle;
  if(r.lastTime===null||time<r.lastTime){r.lastYaw=actor.yaw;r.lastPitch=actor.pitch;r.motion=r.stride=r.swayX=r.swayY=0;}
  r.lastTime=time;
  const dt=Math.max(0,Math.min(.1,delta)),loading=gun.reloadLeft>0;
  const p=loading?THREE.MathUtils.clamp(1-gun.reloadLeft/WEAPONS.rifle.reload,0,1):0;
  const age=time-actor.shotTime,kick=!loading&&age>=0&&age<.7?Math.exp(-age*24)*(1-Math.exp(-age*155)):0;
  r.motion=THREE.MathUtils.damp(r.motion,actor.moving?1:0,10,dt);
  r.stride+=dt*(actor.crouched?6:8)*r.motion;
  r.swayX=THREE.MathUtils.damp(r.swayX,THREE.MathUtils.clamp(Math.atan2(Math.sin(actor.yaw-r.lastYaw),Math.cos(actor.yaw-r.lastYaw)),-.025,.025),10,dt);
  r.swayY=THREE.MathUtils.damp(r.swayY,THREE.MathUtils.clamp(actor.pitch-r.lastPitch,-.018,.018),10,dt);
  r.lastYaw=actor.yaw;r.lastPitch=actor.pitch;
  const lift=loading?smooth(0,.14,p)*(1-smooth(.88,1,p)):0;
  // Shared first-person root supplies walking motion; retain reload/recoil here.
  r.pivot.position.set(-r.swayX-lift*.025,r.swayY+lift*.045,kick*.045-lift*.025);
  r.pivot.rotation.set(.15+kick*.065+lift*.12,.12+r.swayX*.7+lift*.12,-lift*.18+kick*.009);
  r.magazine.position.set(0,0,0);r.magazine.rotation.set(0,0,0);r.magazine.visible=true;
  r.bolt.position.z=kick*.035;
  restore(r.forearm,r.forearmRest);restore(r.wrist,r.wristRest);
  r.support.position.copy(r.supportRest);r.support.quaternion.identity();
  let phase=kick>.01?'recoil':'ready';
  if(loading){
    const out=smooth(.18,.38,p)*(1-smooth(.53,.73,p));
    r.magazine.position.set(-.018*Math.sin(Math.PI*smooth(.38,.53,p))*(p<.53?1:0),-.23*out,.09*out);
    r.magazine.rotation.x=-.22*out;
    contact.copy(r.magContact).applyEuler(r.magazine.rotation).add(r.magazine.position);
    const reach=smooth(0,.18,p);
    if(p<.18)contact.lerpVectors(r.supportContact,r.magContact,reach);
    else if(p>=.80&&p<.94){
      contact.lerpVectors(r.magContact,rack,smooth(.8,.86,p));
      r.bolt.position.z=.065*smooth(.86,.90,p)*(1-smooth(.90,.94,p));contact.z+=r.bolt.position.z;
    }else if(p>=.94)contact.lerpVectors(rack,r.supportContact,smooth(.94,1,p));
    // Rotate around the palm contact, then place that same contact onto the
    // moving magazine. The entire forearm follows without mesh stretching.
    handQuaternion.setFromEuler(new THREE.Euler(.22,0,-.85));
    r.support.quaternion.copy(restQuaternion).slerp(handQuaternion,reach*(1-smooth(.80,1,p)));
    work.copy(r.supportContact).sub(r.supportRest).applyQuaternion(r.support.quaternion);
    r.support.position.copy(contact).sub(work);
    phase=p<.18?'grasp-magazine':p<.38?'magazine-out':p<.53?'retrieve-magazine':p<.73?'insert-magazine':p<.8?'seat-magazine':p<.94?'rack-bolt':'return-to-ready';
  }
  const equip=weaponRackPose(actor,'rifle');
  r.equipGrip.update(!loading?equip.reach:0);
  if(equip.active&&!loading){
    r.bolt.position.z=.065*equip.pull;
    r.pivot.position.x-=equip.reach*.025;r.pivot.position.y+=equip.reach*.035;r.pivot.rotation.z-=equip.reach*.16;
    contact.lerpVectors(r.supportContact,rack,equip.reach);contact.z+=r.bolt.position.z*equip.reach;
    handQuaternion.setFromEuler(new THREE.Euler(.22,0,-.30));
    r.support.quaternion.copy(restQuaternion).slerp(handQuaternion,equip.reach);
    work.copy(r.supportContact).sub(r.supportRest).applyQuaternion(r.support.quaternion);
    r.support.position.copy(contact).sub(work);phase=equip.phase;
  }
  lowerElbow(root,r,Math.max(lift,equip.reach));
  Object.assign(root.userData.pose,{phase,progress:p,equipProgress:equip.progress,equipReach:equip.reach,recoil:kick,magazineOffset:r.magazine.position.y,boltTravel:r.bolt.position.z,leftHand:r.support.position.toArray(),embeddedArms:true});
}
