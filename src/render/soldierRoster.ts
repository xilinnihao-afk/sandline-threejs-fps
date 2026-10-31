import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

// User-supplied glb3 assets retain their original geometry and material textures.
export const SOLDIER_MODELS = [
 {id:'gign',name:'GIGN 反恐精英',file:'gign_cscz_counter_strike_condition_zero.glb',bytes:641492},
 {id:'gsg9',name:'GSG9 反恐精英',file:'gsg9_cscz_counter_strike_condition_zero.glb',bytes:298336},
 {id:'sas',name:'SAS 反恐精英',file:'sas_cscz_counter_strike_condition_zero.glb',bytes:266168},
 {id:'urban',name:'都市反恐精英',file:'unarmed_idle_counter_terrorist.glb',bytes:351232},
 {id:'terrorist1',name:'毛领蒙面匪徒',file:'counter_strike_source_terrorist_1reuploaded.glb',bytes:2039928},
 {id:'terrorist2',name:'头巾匪徒',file:'counter_strike_source_terrorist_2.glb',bytes:1493336},
 {id:'terrorist3',name:'便装匪徒',file:'counter_strike_source_terrorist_3.glb',bytes:1583036},
] as const;
export type SoldierModelId = typeof SOLDIER_MODELS[number]['id'];
export const SOLDIER_TEAM_ROSTER = {blue:['gign','gsg9','sas','urban'],red:['terrorist1','terrorist2','terrorist3']} as const;

/** Map the supplied Source, GoldSrc and Mixamo rigs to locomotion and weapon IK. */
export function prepareRosterSoldier(input:GLTF,id:SoldierModelId):GLTF {
 const model=clone(input.scene) as THREE.Group,skeletons=new Set<THREE.Skeleton>(),weighted=new Set<THREE.Bone>();
 model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){
  skeletons.add(o.skeleton);
  const indices=o.geometry.getAttribute('skinIndex'),weights=o.geometry.getAttribute('skinWeight');
  for(let i=0;i<indices.count;i++)for(let j=0;j<4;j++)if(weights.getComponent(i,j)>0)weighted.add(o.skeleton.bones[indices.getComponent(i,j)]);
 }});
 model.updateMatrixWorld(true);
 for(const skeleton of skeletons){
  // Some unweighted export end/thumbnail joints have identity inverse binds.
  // Recover those local pivots in bind space without changing the shared source.
  const inverses=skeleton.boneInverses.map(inverse=>inverse.clone());
  for(let i=0;i<skeleton.bones.length;i++){
   const bone=skeleton.bones[i],parent=skeleton.bones.indexOf(bone.parent as THREE.Bone);
   const e=inverses[i].elements;
   // GIGN's unused Spine2 uses a scale-100 identity placeholder; leaving it
   // unchanged makes the torso hinge around the export origin during death.
   const placeholder=[1,2,3,4,6,7,8,9,11,12,13,14].every(index=>Math.abs(e[index])<1e-7);
   if(parent>=0&&!weighted.has(bone)&&placeholder)inverses[i]=inverses[parent].clone().invert().multiply(bone.matrix).invert();
  }
  skeleton.boneInverses=inverses;skeleton.pose();
 }
 model.updateMatrixWorld(true);
 const semantic=new Map<string,THREE.Bone>(),classic=['gign','gsg9','sas'].includes(id);
 model.traverse(o=>{
  if(!(o instanceof THREE.Bone))return;
  const base=o.name.replace(/_\d+$/,'').replace(/ /g,'_');let name:string|undefined;
  if(id==='urban'){
   name=base.replace(/^mixamorig:?/i,'');
   // This model's Index chain deforms all four glove fingers as one group.
   name=name.replace(/HandIndex/,'HandMiddle');
  }else if(classic){
   name=({Bip01_Pelvis:'Hips',Bip01_Spine:'Spine',Bip01_Spine1:'Spine1',Bip01_Spine2:'Spine2',Bip01_Neck:'Neck',Bip01_Head:'Head'} as Record<string,string>)[base];
   const match=base.match(/^Bip01_([LR])_(Clavicle|UpperArm|Forearm|Hand|Thigh|Calf|Foot|Toe0|Finger0|Finger01|Finger1|Finger11)$/);
   if(match)name=(match[1]==='L'?'Left':'Right')+({Clavicle:'Shoulder',UpperArm:'Arm',Forearm:'ForeArm',Hand:'Hand',Thigh:'UpLeg',Calf:'Leg',Foot:'Foot',Toe0:'ToeBase',Finger0:'HandThumb1',Finger01:'HandThumb2',Finger1:'HandMiddle1',Finger11:'HandMiddle2'} as Record<string,string>)[match[2]];
  }else{
   name=({root_hips:'Hips',spine_lower:'Spine',spine_upper:'Spine1',spine_upper_1:'Spine2',head_neck_lower:'Neck',head_neck_upper:'Head'} as Record<string,string>)[base];
   const limb=base.match(/^(?:arm|leg)_(left|right)_(shoulder_1|shoulder_2|elbow|wrist|thigh|knee|ankle|toes)$/);
   if(limb)name=(limb[1]==='left'?'Left':'Right')+({shoulder_1:'Shoulder',shoulder_2:'Arm',elbow:'ForeArm',wrist:'Hand',thigh:'UpLeg',knee:'Leg',ankle:'Foot',toes:'ToeBase'} as Record<string,string>)[limb[2]];
   const finger=base.match(/^arm_(left|right)_finger_([123])([abc])$/);
   if(finger)name=(finger[1]==='left'?'Left':'Right')+'Hand'+({1:'Thumb',2:'Index',3:'Middle'} as Record<string,string>)[finger[2]]+({a:1,b:2,c:3} as Record<string,number>)[finger[3]];
  }
  if(name&&name!=='_rootJoint'){o.name='mixamorig'+name;semantic.set(name,o);}
 });
 for(const side of ['Left','Right']){
  const hand=semantic.get(side+'Hand')!,middle=semantic.get(side+'HandMiddle1')!;
  if(classic||id==='urban'){
   // Non-deforming palm markers give the grouped glove a stable lateral axis.
   const thumb=semantic.get(side+'HandThumb1')!,along=middle.position.clone().normalize();
   const across=thumb.position.clone().addScaledVector(along,-thumb.position.dot(along)).normalize().multiplyScalar(middle.position.length()*.28);
   for(const [finger,sign] of [['Index',1],['Pinky',-1]] as const){const marker=new THREE.Bone();marker.name='mixamorig'+side+'Hand'+finger+'1';marker.position.copy(middle.position).addScaledVector(across,sign);hand.add(marker);}
  }else{
   const index=semantic.get(side+'HandIndex1')!,marker=new THREE.Bone();marker.name='mixamorig'+side+'HandPinky1';
   marker.position.copy(middle.position).multiplyScalar(2).sub(index.position);hand.add(marker);
  }
 }
 const corrected=new THREE.Group();corrected.add(model);
 if(classic)corrected.rotation.x=Math.PI/2; // GoldSrc inverse binds reconstruct a -Z-up rig.
 corrected.userData.authoredOutfit=true;corrected.userData.soldierModelId=id;
 return {...input,scene:corrected,scenes:[corrected]};
}
