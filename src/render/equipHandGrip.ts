import * as THREE from 'three';

/** A hook grip for the small charging controls, blended back to source pose. */
export class EquipHandGrip {
 private readonly joints:{bone:THREE.Object3D;rest:THREE.Quaternion;grip:THREE.Quaternion}[]=[];
 private readonly surfaces:{mesh:THREE.Mesh;rest:THREE.Material|THREE.Material[];grip:THREE.Material|THREE.Material[]}[]=[];
 constructor(model:THREE.Object3D,side:'left'|'right'){
  for(const name of side==='left'?['Object_11','Object_12','Object_13']:['Object_7','Object_8','Object_9']){
   const mesh=model.getObjectByName(name) as THREE.Mesh,rest=mesh.material;
   const double=(m:THREE.Material)=>{const clone=m.clone();clone.side=THREE.DoubleSide;return clone;};
   this.surfaces.push({mesh,rest,grip:Array.isArray(rest)?rest.map(double):double(rest)});
  }
  const chains=side==='left'
   ?[['Bone31_5','Bone32_4','Bone33_3'],['Bone35_8','Bone36_7','Bone37_6'],['Bone39_11','Bone40_10','Bone41_9'],['Bone43_14','Bone44_13','Bone45_12']]
   :[['Bone21_29','Bone22_28','Bone23_27'],['Bone17_26','Bone18_25','Bone19_24'],['Bone13_23','Bone14_22','Bone15_21'],['Bone09_20','Bone10_19','Bone11_18']];
  for(const [finger,names] of chains.entries())for(const [j,name]of names.entries()){
   const bone=model.getObjectByName(name)!;const rotation=bone.rotation.clone();
   rotation.x=(side==='left'?[-1.25,-1.15,-.8]:[-.65,-1.05,-.75])[j]-(finger>1?.12:0);
   this.joints.push({bone,rest:bone.quaternion.clone(),grip:new THREE.Quaternion().setFromEuler(rotation)});
  }
  for(const name of side==='left'?['Bone28_1','Bone29_0']:['Bone06_31','Bone07_30']){
   const bone=model.getObjectByName(name)!,rotation=bone.rotation.clone();rotation.z=side==='left'?.7:-.35;
   this.joints.push({bone,rest:bone.quaternion.clone(),grip:new THREE.Quaternion().setFromEuler(rotation)});
  }
 }
 update(reach:number):void{
  for(const {bone,rest,grip}of this.joints)bone.quaternion.copy(rest).slerp(grip,reach);
  for(const {mesh,rest,grip}of this.surfaces)mesh.material=reach>0?grip:rest;
 }
}
