import {CharacterDeathController} from './characterDeath';
import {loadRiggedSoldier} from './riggedSoldier';
import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {Actor,Team,WeaponKind} from '../game/types';
import {WEAPONS} from '../game/simulation';
import {createHeldWeapon,updateHeldWeapon,WEAPON_PRESENTATION} from './weapons';
import {outfitOperator,loadUniformMaps} from './operators';
import type {FirstPersonController} from './firstPersonController';

let asset:GLTF|null=null;
const stats={loaded:false,source:'Licensed Soldier garment skin and Mixamo locomotion; recolored uniforms, authored heads and gear',bytes:2160468+254932+261982,triangles:0,bones:49,clips:[] as string[],error:''};
export const characterDiagnostics=()=>({...stats});
export async function loadCharacterAssets(){
 try{asset=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'assets/characters/soldier.gltf');
  // Preserve root vertical movement. Blender's source uses Z up below Character's rotation.
  for(const clip of asset.animations)for(const track of clip.tracks)if(/hips\.position$/i.test(track.name)){
   const values=track.values,x=values[0],y=values[1];for(let i=0;i<values.length;i+=3){values[i]=x;values[i+1]=y;}
  }
  // 默认使用新人物；?character=legacy 可快速回到旧版作对照。
  if(new URLSearchParams(location.search).get('character')==='legacy') await loadUniformMaps();
  else {asset=await loadRiggedSoldier(asset);stats.source='soldier_fully_rigged_character.glb + retargeted Idle/Walk/Run';stats.bones=65;stats.bytes=10666740;}
  stats.loaded=true;stats.clips=asset.animations.map(c=>c.name);
 }catch(error){stats.error=String(error);throw error;}
}
interface Arm {upper:THREE.Object3D;lower:THREE.Object3D;hand:THREE.Object3D;side:number;basis:THREE.Quaternion;}
interface Rig {deathController?:CharacterDeathController;pose:THREE.Group;model:THREE.Object3D;mixer:THREE.AnimationMixer;idle:THREE.AnimationAction;walk:THREE.AnimationAction;run:THREE.AnimationAction;arms:Arm[];head:THREE.Object3D;spine:THREE.Object3D;neck:THREE.Object3D;hip:THREE.Object3D;footL:THREE.Object3D;footR:THREE.Object3D;toeL:THREE.Object3D;toeR:THREE.Object3D;deathBones:{leftThigh:THREE.Object3D;rightThigh:THREE.Object3D;leftShin:THREE.Object3D;rightShin:THREE.Object3D};joints:THREE.Object3D[];baseQ:THREE.Quaternion[];baseP:THREE.Vector3[];gun:THREE.Group;kind:WeaponKind;shadow:THREE.Mesh;death:number;lastTime:number;lastX:number;lastZ:number;speed:number;hitSide:number;hitHead:number;}
const sharedMaterials=new Map<string,THREE.MeshStandardMaterial>();
const patchMaterial=new THREE.MeshStandardMaterial({color:'#b9c0ad',roughness:.75});
const patchGeo=new THREE.BoxGeometry(.10,.06,.01);
const shadowTexture=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d')!;const g=x.createRadialGradient(32,32,2,32,32,31);g.addColorStop(0,'rgba(15,16,14,.48)');g.addColorStop(.5,'rgba(15,16,14,.18)');g.addColorStop(1,'rgba(15,16,14,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();
const shadowMat=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,toneMapped:false});
const v1=new THREE.Vector3(),v2=new THREE.Vector3(),v3=new THREE.Vector3(),v4=new THREE.Vector3(),v5=new THREE.Vector3(),q1=new THREE.Quaternion(),q2=new THREE.Quaternion(),q3=new THREE.Quaternion();
function bone(model:THREE.Object3D,name:string){let found:THREE.Object3D|undefined;model.traverse(o=>{if(o.name.replace(/[^a-z0-9]/gi,'').toLowerCase()==='mixamorig'+name.toLowerCase())found=o;});if(!found)throw new Error('Missing character joint: '+name);return found;}

export function createCharacter(team:Team):THREE.Group{
 if(!asset)throw new Error('Character assets are not loaded');
 const root=new THREE.Group(),pose=new THREE.Group(),model=clone(asset.scene);root.name='operator:'+team;root.add(pose);pose.add(model);model.scale.setScalar(.982);
 let sharedSkeleton:THREE.Skeleton|undefined;
 model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=!asset!.scene.userData.importedSoldier;o.receiveShadow=true;o.frustumCulled=false;
  // The glTF's body and visor primitives use identical joints. Keep one bone
  // texture per imported body rather than uploading that palette twice.
  if(o instanceof THREE.SkinnedMesh){if(sharedSkeleton&&sharedSkeleton.bones.length===o.skeleton.bones.length&&sharedSkeleton.bones.every((b,i)=>b===o.skeleton.bones[i]))o.skeleton=sharedSkeleton;else sharedSkeleton??=o.skeleton;}
  if(asset!.scene.userData.importedSoldier){
    // 只对衣裤做轻微阵营色区分，保留作者原贴图、皮肤、法线与粗糙度。
    const tint=(original:THREE.Material)=>{
      if(!(original instanceof THREE.MeshStandardMaterial)||! /^(Topmat|Bottommat)$/.test(original.name))return original;
      const key='imported:'+team+original.name;
      if(!sharedMaterials.has(key)){const material=original.clone();material.color.multiply(new THREE.Color(team==='blue'?'#abc6e0':'#d9c19f'));sharedMaterials.set(key,material);}
      return sharedMaterials.get(key)!;
    };
    o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);return;
  }
  const original=o.material as THREE.MeshStandardMaterial,key=team+original.name;
  if(!sharedMaterials.has(key)){const m=original.clone();m.color.set(team==='blue'?'#7192a0':'#b99874');m.roughness=.86;m.metalness=.05;if(m.normalMap)m.normalScale.set(.5,.5);sharedMaterials.set(key,m);}o.material=sharedMaterials.get(key)!;
 }});
 if(!asset.scene.userData.importedSoldier){const outfit=outfitOperator(model,pose,team);stats.triangles=Math.max(stats.triangles,outfit.triangles);}
 else {let triangles=0;model.traverse(o=>{if(o instanceof THREE.Mesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});stats.triangles=triangles;}
 const mixer=new THREE.AnimationMixer(model),clip=(n:string)=>mixer.clipAction(asset!.animations.find(c=>c.name===n)!);
 const idle=clip('Idle'),walk=clip('Walk'),run=clip('Run');idle.play();walk.play();run.play();walk.setEffectiveWeight(0);run.setEffectiveWeight(0);
 model.updateWorldMatrix(true,true);
 const arms=[-1,1].map(side=>{const prefix=side<0?'Left':'Right',hand=bone(model,prefix+'Hand');
  const finger=hand.worldToLocal(bone(model,prefix+'HandMiddle1').getWorldPosition(new THREE.Vector3())).normalize();
  const across=hand.worldToLocal(bone(model,prefix+'HandIndex1').getWorldPosition(new THREE.Vector3())).sub(hand.worldToLocal(bone(model,prefix+'HandPinky1').getWorldPosition(new THREE.Vector3()))).normalize().multiplyScalar(side<0?1:-1);
  const z=finger.negate(),y=new THREE.Vector3().crossVectors(z,across).normalize(),x=new THREE.Vector3().crossVectors(y,z).normalize();
  return {upper:bone(model,prefix+'Arm'),lower:bone(model,prefix+'ForeArm'),hand,side,basis:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z)).invert()};});
 const gun=createHeldWeapon('rifle');pose.add(gun);gun.position.set(.09,1.23,-.28);
 const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1.18,1.18),shadowMat);shadow.rotation.x=-Math.PI/2;shadow.position.y=.015;root.add(shadow);
 // Callsign plates are skinned with the vest in outfitOperator.
 mixer.update(0);const joints:THREE.Object3D[]=[];model.traverse(o=>{if(o instanceof THREE.Bone)joints.push(o);});
 root.userData.rig={pose,model,mixer,idle,walk,run,arms,head:bone(model,'Head'),spine:bone(model,'Spine2'),neck:bone(model,'Neck'),hip:bone(model,'Hips'),footL:bone(model,'LeftFoot'),footR:bone(model,'RightFoot'),toeL:bone(model,'LeftToeBase'),toeR:bone(model,'RightToeBase'),deathBones:{leftThigh:bone(model,'LeftUpLeg'),rightThigh:bone(model,'RightUpLeg'),leftShin:bone(model,'LeftLeg'),rightShin:bone(model,'RightLeg')},joints,baseQ:joints.map(j=>j.quaternion.clone()),baseP:joints.map(j=>j.position.clone()),gun,kind:'rifle',shadow,death:0,lastTime:0,lastX:0,lastZ:0,speed:0,hitSide:0,hitHead:0} as Rig;
 const rig=root.userData.rig as Rig;rig.deathController=new CharacterDeathController(root,rig);rig.deathController.captureAlive();
 root.userData.animation={clip:'Idle',speed:0,reload:0,death:0};
 return root;
}

function turnBone(joint:THREE.Object3D,child:THREE.Object3D,target:THREE.Vector3){
 joint.getWorldPosition(v1);child.getWorldPosition(v2);v2.sub(v1).normalize();v3.copy(target).sub(v1).normalize();
 q1.setFromUnitVectors(v2,v3);joint.getWorldQuaternion(q2);q1.multiply(q2);joint.parent!.getWorldQuaternion(q3).invert();joint.quaternion.copy(q3.multiply(q1));joint.updateWorldMatrix(false,true);
}
const shoulder=new THREE.Vector3(),handTarget=new THREE.Vector3(),elbowTarget=new THREE.Vector3(),line=new THREE.Vector3(),bend=new THREE.Vector3();
function solveArm(root:THREE.Group,arm:Arm,target:THREE.Vector3){
 arm.upper.getWorldPosition(shoulder);arm.lower.getWorldPosition(v4);arm.hand.getWorldPosition(v5);const l1=shoulder.distanceTo(v4),l2=v4.distanceTo(v5);
 handTarget.copy(target);root.localToWorld(handTarget);line.copy(handTarget).sub(shoulder);const d=Math.min(line.length(),(l1+l2)*.98);line.normalize();
 const along=(l1*l1+d*d-l2*l2)/(2*Math.max(d,.001)),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 bend.set(arm.side*.85,-1,.25).transformDirection(root.matrixWorld);bend.addScaledVector(line,-bend.dot(line)).normalize();
 elbowTarget.copy(shoulder).addScaledVector(line,along).addScaledVector(bend,height);turnBone(arm.upper,arm.lower,elbowTarget);turnBone(arm.lower,arm.hand,handTarget);
}
const handL=new THREE.Vector3(),handR=new THREE.Vector3();
export function registerCharacterHit(root:THREE.Group,side:number,headshot=false):void{
 const r=root.userData.rig as Rig;
 r.hitSide=THREE.MathUtils.clamp(side,-1,1); r.hitHead=headshot?1:0;
}
const footWorldL=new THREE.Vector3(),footWorldR=new THREE.Vector3();
/** Two short downward probes keep the animated ankles planted on ramps. The
 * correction is applied to the pose layer, leaving the authored clip intact. */
export function solveCharacterFootIK(root:THREE.Group,controller:FirstPersonController,delta:number):void{
 const r=root.userData.rig as Rig;if(!r||r.death>0)return;
 r.footL.getWorldPosition(footWorldL);r.footR.getWorldPosition(footWorldR);
 const groundL=controller.groundHeight(footWorldL.x,footWorldL.y+.35,footWorldL.z);
 const groundR=controller.groundHeight(footWorldR.x,footWorldR.y+.35,footWorldR.z);
 if(groundL===null&&groundR===null)return;
 const liftL=groundL===null?0:THREE.MathUtils.clamp(groundL-footWorldL.y,-.16,.16);
 const liftR=groundR===null?0:THREE.MathUtils.clamp(groundR-footWorldR.y,-.16,.16);
 const lift=(liftL+liftR)*.5;
 r.pose.position.y+=THREE.MathUtils.damp(0,lift*.82,18,Math.max(delta,.001));
 // A small ankle pitch follows the local ground slope; the pelvis correction
 // carries the majority of the movement, avoiding rubber-knee silhouettes.
 r.footL.rotateX(-liftL*.7);r.footR.rotateX(-liftR*.7);
}
export function updateCharacter(root:THREE.Group,a:Actor,time:number,delta:number){
 const r=root.userData.rig as Rig;const reset=time<r.lastTime||Math.hypot(a.x-r.lastX,a.z-r.lastZ)>4;
 r.joints.forEach((j,i)=>{j.quaternion.copy(r.baseQ[i]);j.position.copy(r.baseP[i]);});
 if(reset){r.death=0;r.speed=0;r.mixer.setTime(0);r.deathController?.reset();}const moving=a.moving&&a.health>0,simDelta=time-r.lastTime;
 if(simDelta>0&&!reset){const measured=Math.hypot(a.x-r.lastX,a.z-r.lastZ)/simDelta;r.speed=THREE.MathUtils.lerp(r.speed,moving?measured:0,1-Math.exp(-simDelta*12));}
 r.lastX=a.x;r.lastZ=a.z;r.lastTime=time;
 const locomotion=Math.min(1,r.speed/1.3),runWeight=THREE.MathUtils.clamp((r.speed-1.9)/1.4,0,1)*locomotion;
 r.idle.setEffectiveWeight(1-locomotion);r.walk.setEffectiveWeight(locomotion-runWeight);r.run.setEffectiveWeight(runWeight);r.walk.setEffectiveTimeScale(Math.max(.5,r.speed/1.5));r.run.setEffectiveTimeScale(Math.max(.65,r.speed/3.4));
 if(delta>0&&a.health>0)r.mixer.update(delta);else if(reset)r.mixer.update(0);
 r.joints.forEach((j,i)=>{r.baseQ[i].copy(j.quaternion);r.baseP[i].copy(j.position);});
 root.position.set(a.x,0,a.z);root.rotation.y=a.yaw;
 if(a.health<=0){
  updateHeldWeapon(r.gun,a,time);
  r.death=r.deathController!.update(delta,a.id,r.hitSide);
  r.shadow.scale.set(1.5,1.8,1);
  root.userData.animation={clip:'Death',speed:0,reload:0,recoil:0,death:+r.death.toFixed(3)};
  return;
 }
 r.death=0;
 const death=0,crouch=a.crouched,drop=crouch?.49:0;
 r.pose.position.set(0,-drop,0);r.pose.rotation.set(0,0,0);
 if(crouch){if(r.model.userData.crouchHipOffset)r.hip.position.add(v1.fromArray(r.model.userData.crouchHipOffset));else r.hip.position.z-=5;for(const side of ['Left','Right']){bone(r.model,side+'UpLeg').rotateX(.60);bone(r.model,side+'Leg').rotateX(-1.05);}}
 const shotAge=time-a.shotTime,shotRecoil=Math.max(0,1-shotAge/.16),recoilPower=WEAPON_PRESENTATION[a.weapon].recoilPitch;
 // Layer aim on the torso first, then solve the arms to the weapon sockets.
 // This keeps the shoulder line and neck aligned with the rifle rather than
 // making the wrists carry the entire pose.
 const moveSway=moving?Math.sin(time*(r.speed>1.9?9.4:7.2))*.018:0;
 r.hip.rotateY(moveSway*.45); r.spine.rotateY(-a.pitch*.22+moveSway); r.spine.rotateX(-a.pitch*.38-shotRecoil*recoilPower*.18);
 r.neck.rotateX(-a.pitch*.20); r.head.rotateX(-a.pitch*.34-shotRecoil*recoilPower*.10);
 const hurtAge=time-a.hurtTime,hurt=hurtAge>=0?Math.exp(-hurtAge*13):0;
 const hitWave=Math.sin(hurtAge*31)*hurt,hitDrop=(1-Math.cos(Math.min(hurtAge,.22)*Math.PI*4))*.5*hurt;
 r.spine.rotateZ(-r.hitSide*hitWave*(r.hitHead?.11:.075)); r.spine.rotateX(-hitDrop*(r.hitHead?.17:.10));
 r.neck.rotateZ(r.hitSide*hitWave*.07); r.head.rotateZ(r.hitSide*hitWave*.14);
 r.arms[0].upper.rotateZ(-r.hitSide*hitWave*.16); r.arms[1].upper.rotateZ(-r.hitSide*hitWave*.11);
 if(hurt<.015){r.hitSide*=Math.exp(-delta*18);r.hitHead=0;}
 const reload=a.guns[a.weapon].reloadLeft>0?1-a.guns[a.weapon].reloadLeft/WEAPONS[a.weapon].reload:0,throwAge=time-a.throwTime;
 if(r.kind!==a.weapon){r.pose.remove(r.gun);r.gun=createHeldWeapon(a.weapon);r.pose.add(r.gun);r.kind=a.weapon;}
 r.gun.position.set(.09,1.23,-.28);r.gun.rotation.set(a.pitch*.75,0,0);r.gun.visible=throwAge>.52;
 updateHeldWeapon(r.gun,a,time);r.gun.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=false;});
 root.updateWorldMatrix(true,true);
 const grips=r.gun.userData.grips as {left:THREE.Object3D;right:THREE.Object3D};grips.right.getWorldPosition(handR);root.worldToLocal(handR);grips.left.getWorldPosition(handL);root.worldToLocal(handL);
 if(throwAge>=0&&throwAge<.65){handR.set(.26,1.3+Math.sin(throwAge/.65*Math.PI)*.3-drop,-.25-Math.sin(throwAge/.65*Math.PI)*.3);handL.set(-.25,1.04-drop,-.1);}
 if(death===0){solveArm(root,r.arms[0],handL);solveArm(root,r.arms[1],handR);if(throwAge>.65)r.arms.forEach((arm,i)=>{const grip=i===0?grips.left:grips.right;grip.getWorldQuaternion(q1).multiply(arm.basis);arm.hand.parent!.getWorldQuaternion(q2).invert();arm.hand.quaternion.copy(q2.multiply(q1));arm.hand.updateWorldMatrix(false,true);});}
 r.deathController!.captureAlive();
 r.shadow.scale.set(1+death*.7,1+death*.4,1);root.userData.animation={clip:moving?(runWeight>.5?'Run':'Walk'):'Idle',speed:+r.speed.toFixed(2),reload:+reload.toFixed(3),recoil:+shotRecoil.toFixed(3),death:+death.toFixed(2)};
}
