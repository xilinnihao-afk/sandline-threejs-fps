import * as THREE from 'three';

/** The approved thumb/longer-pinky pose, applied after the cached skin detail.
 * Keep the detail's original construction pose so this matches the preview.
 * Reset source transforms each frame before firearm/knife poses are applied. */
export class ClassicKnifeGripRefinement {
 private readonly joints:{bone:THREE.Object3D;rest:THREE.Quaternion;pose:THREE.Quaternion}[];
 private readonly pinky:THREE.Object3D;
 private readonly pinkyRestScale:THREE.Vector3;
 constructor(model:THREE.Object3D){
  const rotations:readonly (readonly [string,number,number,number])[]=[
   ['Bone05_32',-.004798514047018077,-.4228028689391497,-.6755591667635479],
   ['Bone06_31',-.25806280747813204,-.4114684062047914,-.8440638530026607],
   ['Bone07_30',1.957921268183979e-8,1.4596898248794403e-6,-.37560797141756036],
   ['Bone09_20',-.8893076261194925,.18195746052266976,-.007279664148558318],
   ['Bone10_19',-1.2582664292492614,.2190056067472448,.02370729028101661],
   ['Bone11_18',-.7356747087701486,.2653950213300095,.0011159282231781441],
  ];
  this.joints=rotations.map(([name,x,y,z])=>{
   const bone=model.getObjectByName(name);if(!bone)throw new Error('Missing knife grip joint '+name);
   return {bone,rest:bone.quaternion.clone(),pose:new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z))};
  });
  this.pinky=this.joints[3].bone;this.pinkyRestScale=this.pinky.scale.clone();
 }
 reset():void {
  this.pinky.scale.copy(this.pinkyRestScale);
  for(const {bone,rest}of this.joints)bone.quaternion.copy(rest);
 }
 apply():void {
  for(const {bone,pose}of this.joints)bone.quaternion.copy(pose);
  this.pinky.scale.copy(this.pinkyRestScale).multiplyScalar(1.14);
  this.joints[0].bone.updateWorldMatrix(true,true);this.pinky.updateWorldMatrix(true,true);
 }
}
