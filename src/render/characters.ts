import {actorBaseY,isAirborne} from '../game/jump';
import {advanceGait,createGait,gaitContactWeight,type GaitState,type GaitProfile} from './locomotion';
import {CharacterDeathController} from './characterDeath';
import {loadRiggedSoldier} from './riggedSoldier';
import {applyTeamUniform} from './teamUniforms';
import {SOLDIER_MODELS,SOLDIER_TEAM_ROSTER,type SoldierModelId} from './soldierRoster';
import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {Actor,Team,WeaponKind} from '../game/types';
import {WEAPONS} from '../game/simulation';
import {createHeldWeapon,updateHeldWeapon,weaponAssetSource,WEAPON_PRESENTATION} from './weapons';
import type {FirstPersonController} from './firstPersonController';

let asset:GLTF|null=null;
const rosterAssets=new Map<SoldierModelId,GLTF>();
const stats={loaded:false,source:'User-supplied glb3 faction models with authored materials and shared locomotion',bytes:0,triangles:0,bones:49,clips:[] as string[],error:''};
export const characterDiagnostics=()=>({...stats,variants:SOLDIER_TEAM_ROSTER,models:SOLDIER_MODELS.filter(m=>rosterAssets.has(m.id))});
export async function loadCharacterAssets(){
 try{asset=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'assets/characters/locomotion.glb');
  // Preserve root vertical movement. Blender's source uses Z up below Character's rotation.
  for(const clip of asset.animations)for(const track of clip.tracks)if(/hips\.position$/i.test(track.name)){
   const values=track.values,x=values[0],y=values[1];for(let i=0;i<values.length;i+=3){values[i]=x;values[i+1]=y;}
  }
  {
   const donor=asset;
   await Promise.all(SOLDIER_MODELS.map(async definition=>{rosterAssets.set(definition.id,await loadRiggedSoldier(donor,definition.id));}));
   asset=rosterAssets.get('gign')!;
   stats.source=[...new Set(SOLDIER_MODELS.map(m=>m.file))].join(' + ')+' + retargeted Idle/Walk/Run';
   stats.bones=0;for(const model of rosterAssets.values())model.scene.traverse(o=>{if(o instanceof THREE.Bone)stats.bones++;});
   stats.bytes=[...new Map(SOLDIER_MODELS.map(m=>[m.file,m.bytes])).values()].reduce((sum,bytes)=>sum+bytes,0);
  }
  stats.loaded=true;stats.clips=asset.animations.map(c=>c.name);
 }catch(error){stats.error=String(error);throw error;}
}
interface Arm {upper:THREE.Object3D;lower:THREE.Object3D;hand:THREE.Object3D;side:number;basis:THREE.Quaternion;}
interface SolePoint {mesh:THREE.SkinnedMesh;index:number;}
interface GroundPlane {x:number;z:number;height:number;dx:number;dz:number;}
interface LegContact {upper:THREE.Object3D;lower:THREE.Object3D;foot:THREE.Object3D;anchor:THREE.Vector3;active:boolean;weight:number;last:THREE.Vector3;target:THREE.Vector3;sourceQ:THREE.Quaternion;targetQ:THREE.Quaternion;anchorQ:THREE.Quaternion;points:SolePoint[];restZ:number;gap:number;initialized:boolean;stepping:boolean;stepAge:number;stepStart:THREE.Vector3;stepQ:THREE.Quaternion;}

interface Rig {groundDrop:number;crouch:number;floor:number;frameDelta:number;turnFoot:number;reachOffset:THREE.Vector3;reachFrom:THREE.Vector3;reachAge:number;reachEnabled:boolean;reachKind:WeaponKind;gait:GaitState;profile:GaitProfile;legs:LegContact[];spines:THREE.Object3D[];initialized:boolean;deathController?:CharacterDeathController;pose:THREE.Group;model:THREE.Object3D;mixer:THREE.AnimationMixer;idle:THREE.AnimationAction;walk:THREE.AnimationAction;run:THREE.AnimationAction;arms:Arm[];head:THREE.Object3D;spine:THREE.Object3D;neck:THREE.Object3D;hip:THREE.Object3D;footL:THREE.Object3D;footR:THREE.Object3D;toeL:THREE.Object3D;toeR:THREE.Object3D;deathBones:{leftThigh:THREE.Object3D;rightThigh:THREE.Object3D;leftShin:THREE.Object3D;rightShin:THREE.Object3D};joints:THREE.Object3D[];baseQ:THREE.Quaternion[];baseP:THREE.Vector3[];gun:THREE.Group;kind:WeaponKind;shadow:THREE.Mesh;death:number;lastTime:number;lastX:number;lastZ:number;speed:number;hitSide:number;hitHead:number;hitFront:number;hitStrength:number;}
const sharedMaterials=new Map<string,THREE.MeshStandardMaterial>();
const patchMaterial=new THREE.MeshStandardMaterial({color:'#b9c0ad',roughness:.75});
const patchGeo=new THREE.BoxGeometry(.10,.06,.01);
const shadowTexture=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d')!;const g=x.createRadialGradient(32,32,2,32,32,31);g.addColorStop(0,'rgba(15,16,14,.48)');g.addColorStop(.5,'rgba(15,16,14,.18)');g.addColorStop(1,'rgba(15,16,14,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();
const shadowMat=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,toneMapped:false});
const v1=new THREE.Vector3(),v2=new THREE.Vector3(),v3=new THREE.Vector3(),v4=new THREE.Vector3(),v5=new THREE.Vector3(),q1=new THREE.Quaternion(),q2=new THREE.Quaternion(),q3=new THREE.Quaternion();
function bone(model:THREE.Object3D,name:string){let found:THREE.Object3D|undefined;model.traverse(o=>{if(o.name.replace(/[^a-z0-9]/gi,'').toLowerCase()==='mixamorig'+name.toLowerCase())found=o;});if(!found)throw new Error('Missing character joint: '+name);return found;}

const gaitProfiles=new WeakMap<GLTF,GaitProfile>();
/** Measure the actual retargeted support-foot slope in metres per cycle. This
 * follows roster proportions and model scale without editing source clips. */
export function measureCharacterGait(source:GLTF):GaitProfile{
 const cached=gaitProfiles.get(source);if(cached)return cached;
 const model=clone(source.scene);model.scale.setScalar(.982);
 const mixer=new THREE.AnimationMixer(model),feet=[bone(model,'LeftFoot'),bone(model,'RightFoot')];
 const strides:number[]=[];
 for(const name of ['Walk','Run']){
  mixer.stopAllAction();const clip=source.animations.find(c=>c.name===name)!;mixer.clipAction(clip).play();
  const samples:Array<{y:number;z:number}[]>=[];
  for(let i=0;i<120;i++){
   mixer.setTime(clip.duration*i/120);model.updateMatrixWorld(true);
   samples.push(feet.map(foot=>{const p=foot.getWorldPosition(new THREE.Vector3());return {y:p.y,z:p.z};}));
  }
  const run=name==='Run'?1:0,offset=run?.28:.19;
  const support=samples.slice(1).flatMap((sample,i)=>sample.map((p,side)=>({weight:gaitContactWeight((i+.5)/120-offset,side===0?-1:1,run),stride:(p.z-samples[i][side].z)*120}))).filter(p=>p.weight>.95&&p.stride>0).map(p=>p.stride).sort((a,b)=>a-b);
  strides.push(THREE.MathUtils.clamp(support[Math.floor(support.length*.5)]??(name==='Walk'?1.68:2.65),1,3.5));
 }
 mixer.stopAllAction();mixer.uncacheRoot(model);
 const profile={walkStride:strides[0],runStride:strides[1]};gaitProfiles.set(source,profile);return profile;
}

export function createCharacter(team:Team,variant=0,preparedAsset?:GLTF):THREE.Group{
 const modelId=SOLDIER_TEAM_ROSTER[team][((Math.trunc(variant)%SOLDIER_TEAM_ROSTER[team].length)+SOLDIER_TEAM_ROSTER[team].length)%SOLDIER_TEAM_ROSTER[team].length];
 const selectedAsset=preparedAsset??rosterAssets.get(modelId)??asset;
 const definition=SOLDIER_MODELS.find(m=>m.id===modelId)!;
 if(!selectedAsset)throw new Error('Character assets are not loaded');
 const root=new THREE.Group(),pose=new THREE.Group(),model=clone(selectedAsset.scene);root.name='operator:'+team;root.add(pose);pose.add(model);model.scale.setScalar(.982);
 let sharedSkeleton:THREE.Skeleton|undefined;
 model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=!selectedAsset.scene.userData.importedSoldier;o.receiveShadow=true;o.frustumCulled=false;
  // The glTF's body and visor primitives use identical joints. Keep one bone
  // texture per imported body rather than uploading that palette twice.
  if(o instanceof THREE.SkinnedMesh){if(sharedSkeleton&&sharedSkeleton.bones.length===o.skeleton.bones.length&&sharedSkeleton.bones.every((b,i)=>b===o.skeleton.bones[i]))o.skeleton=sharedSkeleton;else sharedSkeleton??=o.skeleton;}
  if(selectedAsset.scene.userData.importedSoldier)return;
  const original=o.material as THREE.MeshStandardMaterial,key=team+original.name;
  if(!sharedMaterials.has(key)){const m=original.clone();m.color.set(team==='blue'?'#7192a0':'#b99874');m.roughness=.86;m.metalness=.05;if(m.normalMap)m.normalScale.set(.5,.5);sharedMaterials.set(key,m);}o.material=sharedMaterials.get(key)!;
 }});
 if(selectedAsset.scene.userData.authoredOutfit)applyTeamUniform(model,modelId,team);
 root.userData.operatorVariant={id:team+'-'+modelId,name:definition.name,source:definition.file,uniformColor:'authored'};
 let triangles=0;model.traverse(o=>{if(o instanceof THREE.Mesh&&o.visible)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});stats.triangles=Math.max(stats.triangles,triangles);
 const mixer=new THREE.AnimationMixer(model),clip=(n:string)=>mixer.clipAction(selectedAsset.animations.find(c=>c.name===n)!);
 const idle=clip('Idle'),walk=clip('Walk'),run=clip('Run');idle.play();walk.play();run.play();walk.paused=true;run.paused=true;walk.setEffectiveWeight(0);run.setEffectiveWeight(0);
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
 root.userData.rig={groundDrop:0,crouch:0,floor:0,frameDelta:0,turnFoot:1,reachOffset:new THREE.Vector3(),reachFrom:new THREE.Vector3(),reachAge:.18,reachEnabled:false,reachKind:'rifle',gait:createGait(),profile:measureCharacterGait(selectedAsset),legs:['Left','Right'].map(side=>({upper:bone(model,side+'UpLeg'),lower:bone(model,side+'Leg'),foot:bone(model,side+'Foot'),anchor:new THREE.Vector3(),active:false,weight:0,last:new THREE.Vector3(),target:new THREE.Vector3(),sourceQ:new THREE.Quaternion(),targetQ:new THREE.Quaternion(),anchorQ:new THREE.Quaternion(),points:[],restZ:0,gap:0,initialized:false,stepping:false,stepAge:0,stepStart:new THREE.Vector3(),stepQ:new THREE.Quaternion()})),spines:['Spine','Spine1','Spine2'].map(name=>bone(model,name)),initialized:false,pose,model,mixer,idle,walk,run,arms,head:bone(model,'Head'),spine:bone(model,'Spine2'),neck:bone(model,'Neck'),hip:bone(model,'Hips'),footL:bone(model,'LeftFoot'),footR:bone(model,'RightFoot'),toeL:bone(model,'LeftToeBase'),toeR:bone(model,'RightToeBase'),deathBones:{leftThigh:bone(model,'LeftUpLeg'),rightThigh:bone(model,'RightUpLeg'),leftShin:bone(model,'LeftLeg'),rightShin:bone(model,'RightLeg')},joints,baseQ:joints.map(j=>j.quaternion.clone()),baseP:joints.map(j=>j.position.clone()),gun,kind:'rifle',shadow,death:0,lastTime:0,lastX:0,lastZ:0,speed:0,hitSide:0,hitHead:0,hitFront:-1,hitStrength:1} as Rig;
 const rig=root.userData.rig as Rig;prepareFootSupports(root,rig);rig.deathController=new CharacterDeathController(root,rig);rig.deathController.captureAlive();
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
 handTarget.copy(target);root.localToWorld(handTarget);line.copy(handTarget).sub(shoulder);const d=THREE.MathUtils.clamp(line.length(),Math.abs(l1-l2)+.001,(l1+l2)*.995);line.normalize();handTarget.copy(shoulder).addScaledVector(line,d);
 const along=(l1*l1+d*d-l2*l2)/(2*Math.max(d,.001)),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 bend.set(arm.side*.85,-1,.25).transformDirection(root.matrixWorld);bend.addScaledVector(line,-bend.dot(line)).normalize();
 elbowTarget.copy(shoulder).addScaledVector(line,along).addScaledVector(bend,height);turnBone(arm.upper,arm.lower,elbowTarget);turnBone(arm.lower,arm.hand,handTarget);
}
/** A fixed fore-end can exceed the shorter roster arms. Translate the held
 * assembly minimally into both reach spheres, then solve both socket contacts.
 * Weapon aim/rotation and all authored recoil/reload tracks remain unchanged. */
function fitHeldWeaponReach(r:Rig){
 const grips=r.gun.userData.grips as {left:THREE.Object3D;right:THREE.Object3D};
 for(let pass=0;pass<3;pass++)for(let i=0;i<r.arms.length;i++){
  const arm=r.arms[i];arm.upper.getWorldPosition(shoulder);arm.lower.getWorldPosition(v4);arm.hand.getWorldPosition(v5);
  const reach=(shoulder.distanceTo(v4)+v4.distanceTo(v5))*.975;
  (i===0?grips.left:grips.right).getWorldPosition(handTarget);line.copy(handTarget).sub(shoulder);
  const distance=line.length();if(distance<=reach)continue;
  line.multiplyScalar((reach-distance)/distance);
  r.gun.getWorldPosition(v4).add(line);r.gun.position.copy(r.pose.worldToLocal(v4));r.gun.updateWorldMatrix(false,true);
 }
}
const reachBase=new THREE.Vector3(),reachTarget=new THREE.Vector3();
function updateHeldWeaponReach(r:Rig,enabled:boolean,delta:number,reset:boolean){
 reachBase.copy(r.gun.position);reachTarget.set(0,0,0);
 if(enabled){fitHeldWeaponReach(r);reachTarget.copy(r.gun.position).sub(reachBase);}
 if(reset){r.reachOffset.copy(reachTarget);r.reachFrom.copy(reachTarget);r.reachAge=.18;}
 else{
  if(enabled!==r.reachEnabled||r.kind!==r.reachKind){r.reachFrom.copy(r.reachOffset);r.reachAge=0;}
  r.reachAge=Math.min(.18,r.reachAge+Math.max(0,Math.min(.1,delta)));
  r.reachOffset.copy(r.reachFrom).lerp(reachTarget,THREE.MathUtils.smoothstep(r.reachAge,0,.18));
 }
 r.reachEnabled=enabled;r.reachKind=r.kind;
 r.gun.position.copy(reachBase).add(r.reachOffset);r.gun.updateWorldMatrix(false,true);
}
/** Rotation axes live in the actor frame, never imported bone-local axes. */
function rotateActorJoint(root:THREE.Group,joint:THREE.Object3D,x:number,y:number,z:number,angle:number){
 root.getWorldQuaternion(q1);v1.set(x,y,z).applyQuaternion(q1);
 joint.getWorldQuaternion(q2);q1.setFromAxisAngle(v1,angle).multiply(q2);
 joint.parent!.getWorldQuaternion(q3).invert();joint.quaternion.copy(q3.multiply(q1));joint.updateWorldMatrix(false,true);
}
const legOrigin=new THREE.Vector3(),legKnee=new THREE.Vector3(),legFoot=new THREE.Vector3(),legTarget=new THREE.Vector3(),legLine=new THREE.Vector3(),legBend=new THREE.Vector3(),legMiddle=new THREE.Vector3(),footOrientation=new THREE.Quaternion(),solePoint=new THREE.Vector3(),kneePole=new THREE.Vector3(),kneeUp=new THREE.Vector3(),kneeAcross=new THREE.Vector3(),kneeCenter=new THREE.Vector3();
/** Select extremal vertices once, retaining the actual weighted shoe surface.
 * At runtime each foot needs only a small convex support set, not a mesh scan. */
function prepareFootSupports(root:THREE.Group,r:Rig){
 root.updateMatrixWorld(true);const hip=r.hip.getWorldPosition(new THREE.Vector3());
 for(const leg of r.legs){
  const ankle=leg.foot.getWorldPosition(new THREE.Vector3());leg.restZ=ankle.z-hip.z;
  const candidates:Array<SolePoint&{point:THREE.Vector3}>=[];
  r.model.traverse(o=>{if(!(o instanceof THREE.SkinnedMesh))return;
   const indices=o.geometry.getAttribute('skinIndex'),weights=o.geometry.getAttribute('skinWeight');
   for(let i=0;i<indices.count;i++){
    let influence=0;for(let j=0;j<4;j++){const b=o.skeleton.bones[indices.getComponent(i,j)];if(b===leg.lower||b===leg.foot||b.parent===leg.foot)influence+=weights.getComponent(i,j);}
    if(influence<.5)continue;
    const p=o.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(o.matrixWorld);
    if(p.y<ankle.y+.075)candidates.push({mesh:o,index:i,point:p});
   }
  });
  const selected=new Set<number>();
  for(const y of [-1,-.35,0,.35,1])for(let angle=0;angle<16;angle++){
   const direction=new THREE.Vector3(Math.cos(angle*Math.PI/8),y,Math.sin(angle*Math.PI/8));
   let index=-1,value=-Infinity;candidates.forEach((p,i)=>{const d=p.point.dot(direction);if(d>value){value=d;index=i;}});if(index>=0)selected.add(index);
  }
  leg.points=[...selected].map(i=>({mesh:candidates[i].mesh,index:candidates[i].index}));
 }
}
function soleGap(leg:LegContact,ground:GroundPlane){
 let gap=Infinity;
 for(const sample of leg.points){sample.mesh.getVertexPosition(sample.index,solePoint).applyMatrix4(sample.mesh.matrixWorld);const floor=ground.height+(solePoint.x-ground.x)*ground.dx+(solePoint.z-ground.z)*ground.dz;gap=Math.min(gap,solePoint.y-floor);}
 return Number.isFinite(gap)?gap:leg.foot.getWorldPosition(solePoint).y-ground.height-.085;
}
/** World-space two-bone IK with a semantic forward knee pole, independent of
 * the three imported skeleton axis conventions. All bone lengths are fixed. */
function solveLeg(root:THREE.Group,r:Rig,leg:LegContact,target:THREE.Vector3,orientation:THREE.Quaternion,ground:GroundPlane){
 leg.upper.getWorldPosition(legOrigin);leg.lower.getWorldPosition(legKnee);leg.foot.getWorldPosition(legFoot);
 const l1=legOrigin.distanceTo(legKnee),l2=legKnee.distanceTo(legFoot);
 legLine.copy(target).sub(legOrigin);const d=THREE.MathUtils.clamp(legLine.length(),Math.abs(l1-l2)+.001,l1+l2-.001);legLine.normalize();
 legTarget.copy(legOrigin).addScaledVector(legLine,d);
 const along=(l1*l1+d*d-l2*l2)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 legBend.copy(legKnee).sub(legOrigin);legBend.addScaledVector(legLine,-legBend.dot(legLine));
 const yaw=r.gait.bodyYaw??root.rotation.y;
 kneePole.set(-Math.sin(yaw),0,-Math.cos(yaw));kneePole.addScaledVector(legLine,-kneePole.dot(legLine)).normalize();
 // Keep a continuous forward pole. Switching from the source knee to a
 // forward pole at a dot-product sign change makes a bent swing knee snap.
 if(legBend.lengthSq()<1e-6)legBend.copy(kneePole);else legBend.normalize().lerp(kneePole,.8+.2*r.crouch).normalize();
 // The knee must remain above the floor too: a low hip and a trailing
 // ankle otherwise choose the valid IK circle solution below the ground.
 kneeCenter.copy(legOrigin).addScaledVector(legLine,along);
 kneeUp.set(-ground.dx,1,-ground.dz);const floorConstant=ground.height-ground.dx*ground.x-ground.dz*ground.z+.145;
 const planeAtCenter=kneeUp.dot(kneeCenter);kneeUp.addScaledVector(legLine,-kneeUp.dot(legLine));
 const verticalSpan=height*kneeUp.length();kneeUp.normalize();
 const needed=THREE.MathUtils.clamp((floorConstant-planeAtCenter)/Math.max(.0001,verticalSpan),-1,.999);
 const current=legBend.dot(kneeUp);
 if(current<needed){kneeAcross.copy(legBend).addScaledVector(kneeUp,-current).normalize();legBend.copy(kneeUp).multiplyScalar(needed).addScaledVector(kneeAcross,Math.sqrt(1-needed*needed)).normalize();}
 legMiddle.copy(kneeCenter).addScaledVector(legBend,height);
 turnBone(leg.upper,leg.lower,legMiddle);turnBone(leg.lower,leg.foot,legTarget);
 leg.foot.parent!.getWorldQuaternion(q1).invert();leg.foot.quaternion.copy(q1.multiply(orientation));leg.foot.updateWorldMatrix(false,true);
}
const surfaceTarget=new THREE.Vector3(),surfaceOrientation=new THREE.Quaternion(),surfaceTilt=new THREE.Quaternion(),surfaceNormal=new THREE.Vector3();
function groundLeg(root:THREE.Group,r:Rig,leg:LegContact,ground:GroundPlane){
 surfaceTarget.copy(leg.target);surfaceTarget.y+=ground.height-r.floor;
 surfaceNormal.set(-ground.dx,1,-ground.dz).normalize();surfaceTilt.setFromUnitVectors(v1.set(0,1,0),surfaceNormal);
 surfaceOrientation.copy(surfaceTilt).multiply(leg.targetQ);
 solveLeg(root,r,leg,surfaceTarget,surfaceOrientation,ground);
 // Place the lowest actual shoe support on the local plane. Swing feet only
 // receive an upward safety correction, preserving their authored clearance.
 for(let i=0;i<2;i++){
  const gap=soleGap(leg,ground),correction=.004-gap;
  if(correction>0||leg.weight>.001){surfaceTarget.y+=correction>0?correction:correction*leg.weight;solveLeg(root,r,leg,surfaceTarget,surfaceOrientation,ground);}
 }
 leg.gap=soleGap(leg,ground);leg.foot.getWorldPosition(leg.last);leg.initialized=true;
}
function beginFootStep(leg:LegContact){leg.stepping=true;leg.stepAge=0;leg.stepStart.copy(leg.last);leg.stepQ.copy(leg.anchorQ);leg.active=false;}
function applyFootContacts(root:THREE.Group,r:Rig,disabled:boolean,run:number){
 if(disabled){r.groundDrop=0;r.legs.forEach(leg=>{leg.active=false;leg.weight=0;leg.stepping=false;leg.initialized=false;});return;}
 root.updateMatrixWorld(true);
 const still=r.gait.speed<.16,bodyYaw=r.gait.bodyYaw??root.rotation.y,travelYaw=(r.gait.travelYaw??bodyYaw)+(r.gait.backward?Math.PI:0);
 const bx=Math.sin(bodyYaw),bz=Math.cos(bodyYaw),tx=Math.sin(travelYaw),tz=Math.cos(travelYaw),crouchBack=.065*r.crouch;
 r.hip.getWorldPosition(legOrigin);
 for(const leg of r.legs){
  leg.foot.getWorldPosition(leg.target);leg.foot.getWorldQuaternion(leg.sourceQ);
  // Only redirect the longitudinal excursion; lateral stance width remains in
  // the pelvis frame. This gives sideways/curved travel the correct foot speed.
  if(!still){const z=(leg.target.x-legOrigin.x)*bx+(leg.target.z-legOrigin.z)*bz-leg.restZ;leg.target.x+=z*(tx-bx);leg.target.z+=z*(tz-bz);}
  leg.target.y+=.43*r.crouch;leg.target.x-=Math.sin(root.rotation.y)*crouchBack;leg.target.z-=Math.cos(root.rotation.y)*crouchBack;
  leg.targetQ.copy(leg.sourceQ);
 }
 // At rest keep both soles planted until the aiming turn requires a short
 // alternating step. Never rotate the whole pair of shoes around the actor.
 if(still&&!r.legs.some(leg=>leg.stepping))for(let n=1;n<=2;n++){
  const i=(r.turnFoot+n)%2,leg=r.legs[i];
  if(leg.initialized&&leg.active&&(Math.hypot(leg.target.x-leg.anchor.x,leg.target.z-leg.anchor.z)>.12||leg.anchorQ.angleTo(leg.sourceQ)>.62)){beginFootStep(leg);r.turnFoot=i;break;}
 }
 for(let i=0;i<r.legs.length;i++){
  const leg=r.legs[i],weight=still?1:gaitContactWeight(r.gait.phase,i===0?-1:1,run);
  if(leg.stepping){
   leg.stepAge=Math.min(.24,leg.stepAge+r.frameDelta);const t=leg.stepAge/.24,u=t*t*(3-2*t);
   leg.target.lerpVectors(leg.stepStart,leg.target,u);leg.target.y+=Math.sin(Math.PI*t)*.065;
   leg.targetQ.copy(leg.stepQ).slerp(leg.sourceQ,u);leg.weight=0;
   if(t>=1){leg.stepping=false;leg.active=true;leg.anchor.copy(leg.target);leg.anchorQ.copy(leg.targetQ);}
  }else{
   leg.weight=weight;
   if(weight>.001){
    if(!leg.active){leg.anchor.copy(still&&leg.initialized?leg.last:leg.target);leg.anchorQ.copy(leg.sourceQ);leg.active=true;}
    const offset=Math.hypot(leg.target.x-leg.anchor.x,leg.target.z-leg.anchor.z);
    if(offset>.38&&leg.initialized){beginFootStep(leg);leg.target.copy(leg.last);leg.weight=0;}
    else{leg.target.x=THREE.MathUtils.lerp(leg.target.x,leg.anchor.x,weight);leg.target.z=THREE.MathUtils.lerp(leg.target.z,leg.anchor.z,weight);leg.targetQ.slerp(leg.anchorQ,weight);}
   }else leg.active=false;
  }
 }
 // With the soles on the ground, a retargeted standing hip can be a few cm
 // too high for a planted leg. Lower only the hip to keep that contact within
 // reach, before the weapon/arm solve; never drag the planted ankle instead.
 let neededDrop=0;
 for(const leg of r.legs){
  if(leg.weight<.05)continue;
  leg.upper.getWorldPosition(legOrigin);leg.lower.getWorldPosition(legKnee);leg.foot.getWorldPosition(legFoot);
  const length=legOrigin.distanceTo(legKnee)+legKnee.distanceTo(legFoot)-.008;
  const ankleY=legFoot.y-soleGap(leg,{x:leg.target.x,z:leg.target.z,height:r.floor,dx:0,dz:0})+.004;
  const horizontal=(leg.target.x-legOrigin.x)**2+(leg.target.z-legOrigin.z)**2;
  const reachableY=ankleY+Math.sqrt(Math.max(.01,length*length-horizontal));
  neededDrop=Math.max(neededDrop,(legOrigin.y-reachableY)*leg.weight);
 }
 // Acquire the required reach immediately; release pelvis compensation at a
 // bounded speed so a support-to-swing transition cannot pop a straight knee.
 r.groundDrop=Math.max(THREE.MathUtils.clamp(neededDrop,0,.22),r.groundDrop-.55*r.frameDelta);
 if(r.groundDrop>0){r.hip.getWorldPosition(v1);v1.y-=r.groundDrop;r.hip.position.copy(r.hip.parent!.worldToLocal(v1));r.hip.updateWorldMatrix(false,true);}
 for(const leg of r.legs)groundLeg(root,r,leg,{x:leg.target.x,z:leg.target.z,height:r.floor,dx:0,dz:0});
}
const handL=new THREE.Vector3(),handR=new THREE.Vector3();
export function registerCharacterHit(root:THREE.Group,side:number,headshot=false,front=-1,strength=1):void{
 const r=root.userData.rig as Rig;
 r.hitSide=THREE.MathUtils.clamp(side,-1,1); r.hitHead=headshot?1:0;r.hitFront=THREE.MathUtils.clamp(front,-1,1);r.hitStrength=THREE.MathUtils.clamp(strength,1,1.4);
}
/** Each shoe receives its own local terrain plane and leg solve. The actor
 * and torso never inherit an average foot-height correction. */
export function solveCharacterFootIK(root:THREE.Group,controller:FirstPersonController,_delta:number):void{
 const r=root.userData.rig as Rig;if(!r||r.death>0||root.userData.airborne)return;
 for(const leg of r.legs){
  const x=leg.target.x,z=leg.target.z,y=Math.max(r.floor,leg.target.y)+.4;
  const height=controller.groundHeight(x,y,z);if(height===null)continue;
  const right=controller.groundHeight(x+.12,y,z),front=controller.groundHeight(x,y,z+.12);
  const dx=right===null?0:THREE.MathUtils.clamp((right-height)/.12,-.65,.65),dz=front===null?0:THREE.MathUtils.clamp((front-height)/.12,-.65,.65);
  groundLeg(root,r,leg,{x,z,height,dx,dz});
 }
 r.deathController?.captureAlive();
 if(root.userData.animation)root.userData.animation.soleClearance=r.legs.map(leg=>+leg.gap.toFixed(4));
}
export function updateCharacter(root:THREE.Group,a:Actor,time:number,delta:number){
 const r=root.userData.rig as Rig;const reset=!r.initialized||a.health>0&&r.death>0||time<r.lastTime||Math.hypot(a.x-r.lastX,a.z-r.lastZ)>4;
 r.joints.forEach((j,i)=>{j.quaternion.copy(r.baseQ[i]);j.position.copy(r.baseP[i]);});
 if(reset){r.death=0;r.groundDrop=0;r.speed=0;r.gait=createGait((a.id*.23)%1,a.yaw);r.mixer.setTime(0);r.deathController?.reset();r.legs.forEach(leg=>{leg.active=false;leg.weight=0;leg.initialized=false;leg.stepping=false;});r.crouch=a.crouched?1:0;r.turnFoot=1;r.initialized=true;}
 const moving=a.moving&&a.health>0&&!isAirborne(a),simDelta=time-r.lastTime;
 const weights=advanceGait(r.gait,reset?0:a.x-r.lastX,reset?0:a.z-r.lastZ,a.yaw,simDelta>0&&!reset?simDelta:0,moving,r.profile);
 r.speed=r.gait.speed;r.lastX=a.x;r.lastZ=a.z;r.lastTime=time;
 const runWeight=weights.run;
 r.idle.setEffectiveWeight(weights.idle);r.walk.setEffectiveWeight(weights.walk);r.run.setEffectiveWeight(weights.run);
 // Match the left-foot forward pose in both retargeted clips; one distance-driven
 // phase prevents the two gaits drifting into opposite steps during blending.
 r.walk.time=((r.gait.phase+.19)%1)*r.walk.getClip().duration;
 r.run.time=((r.gait.phase+.28)%1)*r.run.getClip().duration;
 if(a.health>0)r.mixer.update(Math.max(0,Math.min(.1,delta)));else if(reset)r.mixer.update(0);
 r.joints.forEach((j,i)=>{r.baseQ[i].copy(j.quaternion);r.baseP[i].copy(j.position);});
 root.position.set(a.x,actorBaseY(a),a.z);root.userData.airborne=isAirborne(a);
 r.shadow.position.y=.015-actorBaseY(a);
 // Spectator look can continue changing the player yaw; a falling body keeps its impact frame.
 if(a.health>0||r.death===0)root.rotation.y=a.yaw;
 if(a.health<=0){
  updateHeldWeapon(r.gun,a,time);
  r.death=r.deathController!.update(delta,a.id,r.hitSide,r.hitFront,r.hitStrength);
  r.shadow.scale.set(1.5,1.8,1);
  root.userData.animation={clip:'Death',speed:0,reload:0,recoil:0,death:+r.death.toFixed(3),direction:r.hitFront>.15?'backward':'forward'};
  return;
 }
 r.death=0;r.frameDelta=Math.max(0,Math.min(.1,delta));r.floor=actorBaseY(a);
 r.crouch=THREE.MathUtils.damp(r.crouch,a.crouched?1:0,12,r.frameDelta);
 const death=0,drop=.43*r.crouch;
 r.pose.position.set(0,0,0);r.pose.rotation.set(0,0,0);
 // The pelvis retains a continuous world heading as aim changes. Share the
 // counter-rotation across the spine instead of twisting one chest joint.
 root.updateWorldMatrix(true,true);
 rotateActorJoint(root,r.hip,0,1,0,r.gait.heading);
 for(const spine of r.spines)rotateActorJoint(root,spine,0,1,0,-r.gait.heading/3);
 // Acceleration moves the chest over the support leg; braking gently brings it
 // back. Only the presentation bones move, never the actor/collision position.
 rotateActorJoint(root,r.spines[0],1,0,0,-(r.gait.leanForward??0)*.65);
 rotateActorJoint(root,r.spines[0],0,0,1,-(r.gait.leanSide??0)*.65);
 rotateActorJoint(root,r.spine,1,0,0,-(r.gait.leanForward??0)*.35);
 rotateActorJoint(root,r.spine,0,0,1,-(r.gait.leanSide??0)*.35);
 if(r.crouch>1e-5){
  r.hip.getWorldPosition(v1);v1.y-=drop;v1.x+=Math.sin(a.yaw)*.065*r.crouch;v1.z+=Math.cos(a.yaw)*.065*r.crouch;r.hip.position.copy(r.hip.parent!.worldToLocal(v1));r.hip.updateWorldMatrix(false,true);
  rotateActorJoint(root,r.spines[0],1,0,0,-.12*r.crouch);rotateActorJoint(root,r.spine,1,0,0,-.06*r.crouch);
 }

 if(isAirborne(a)){
  const tuck=THREE.MathUtils.smoothstep(actorBaseY(a),0,.5);
  // A light knee tuck in actor space works across imported bone orientations.
  for(const [joint,angle] of [[r.deathBones.leftThigh,.26],[r.deathBones.rightThigh,.20],[r.deathBones.leftShin,-.48],[r.deathBones.rightShin,-.40]] as const){
   root.getWorldQuaternion(q1);v1.set(1,0,0).applyQuaternion(q1);
   joint.getWorldQuaternion(q2);q1.setFromAxisAngle(v1,angle*tuck).multiply(q2);
   joint.parent!.getWorldQuaternion(q3).invert();joint.quaternion.copy(q3.multiply(q1));joint.updateWorldMatrix(false,true);
  }
 }
 const shotAge=time-a.shotTime,shotRecoil=Math.max(0,1-shotAge/.16),recoilPower=WEAPON_PRESENTATION[a.weapon].recoilPitch;
 // Layer aim on the torso first, then solve the arms to the weapon sockets.
 // This keeps the shoulder line and neck aligned with the rifle rather than
 // making the wrists carry the entire pose.
 const moveSway=Math.sin(r.gait.phase*Math.PI*2)*.014*Math.min(1,r.gait.speed/1.5);
 r.hip.rotateY(moveSway*.45); r.spine.rotateY(-a.pitch*.22+moveSway); r.spine.rotateX(-a.pitch*.38-shotRecoil*recoilPower*.18);
 r.neck.rotateX(-a.pitch*.20); r.head.rotateX(-a.pitch*.34-shotRecoil*recoilPower*.10);
 const hurtAge=time-a.hurtTime,hurt=hurtAge>=0?Math.exp(-hurtAge*13):0;
 const hitWave=Math.sin(hurtAge*31)*hurt,hitDrop=(1-Math.cos(Math.min(hurtAge,.22)*Math.PI*4))*.5*hurt;
 r.spine.rotateZ(-r.hitSide*hitWave*(r.hitHead?.11:.075)); r.spine.rotateX(hitDrop*(r.hitFront>.15?.22:-.10)*r.hitStrength);
 r.neck.rotateZ(r.hitSide*hitWave*.07); r.head.rotateZ(r.hitSide*hitWave*.14);
 r.arms[0].upper.rotateZ(-r.hitSide*hitWave*.16); r.arms[1].upper.rotateZ(-r.hitSide*hitWave*.11);
 if(hurt<.015){r.hitSide*=Math.exp(-delta*18);r.hitHead=0;}
 const reload=a.guns[a.weapon].reloadLeft>0?1-a.guns[a.weapon].reloadLeft/WEAPONS[a.weapon].reload:0,throwAge=time-a.throwTime;
 if(r.kind!==a.weapon||r.gun.userData.assetSource!==weaponAssetSource(a.weapon)){r.pose.remove(r.gun);r.gun=createHeldWeapon(a.weapon);r.pose.add(r.gun);r.kind=a.weapon;}
 applyFootContacts(root,r,isAirborne(a),weights.run/Math.max(.001,weights.walk+weights.run));
 r.gun.position.set(.09,1.23-drop-r.groundDrop,-.28);r.gun.rotation.set(a.pitch*.75,0,0);r.gun.visible=throwAge>.52;
 updateHeldWeapon(r.gun,a,time);r.gun.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=false;});
 root.updateWorldMatrix(true,true);
 updateHeldWeaponReach(r,reload===0&&throwAge>.65&&a.weapon!=='knife',delta,reset);
 const grips=r.gun.userData.grips as {left:THREE.Object3D;right:THREE.Object3D};grips.right.getWorldPosition(handR);root.worldToLocal(handR);grips.left.getWorldPosition(handL);root.worldToLocal(handL);
 if(throwAge>=0&&throwAge<.65){handR.set(.26,1.3+Math.sin(throwAge/.65*Math.PI)*.3-drop,-.25-Math.sin(throwAge/.65*Math.PI)*.3);handL.set(-.25,1.04-drop,-.1);}
 if(death===0){solveArm(root,r.arms[0],handL);solveArm(root,r.arms[1],handR);if(throwAge>.65)r.arms.forEach((arm,i)=>{const grip=i===0?grips.left:grips.right;grip.getWorldQuaternion(q1).multiply(arm.basis);arm.hand.parent!.getWorldQuaternion(q2).invert();arm.hand.quaternion.copy(q2.multiply(q1));arm.hand.updateWorldMatrix(false,true);});}
 r.deathController!.captureAlive();
 r.shadow.scale.set(1+death*.7,1+death*.4,1);root.userData.animation={clip:isAirborne(a)?'Jump':moving?(runWeight>.5?'Run':'Walk'):'Idle',speed:+r.speed.toFixed(2),reload:+reload.toFixed(3),recoil:+shotRecoil.toFixed(3),death:+death.toFixed(2),gaitPhase:+r.gait.phase.toFixed(3),pelvisYaw:+r.gait.heading.toFixed(3),stride:+(r.profile.walkStride+(r.profile.runStride-r.profile.walkStride)*runWeight).toFixed(3),footContacts:r.legs.map(leg=>+leg.weight.toFixed(2)),crouch:+r.crouch.toFixed(3),groundDrop:+r.groundDrop.toFixed(4),soleClearance:r.legs.map(leg=>+leg.gap.toFixed(4)),turnSteps:r.legs.map(leg=>leg.stepping),soleSamples:r.legs.map(leg=>leg.points.length)};
}
