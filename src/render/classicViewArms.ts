import * as THREE from 'three';
import {createClassicArmsFrame} from './classicAk';
import {isHandgun,type WeaponKind} from '../game/types';
import {CLASSIC_HAND_CONTACTS} from './classicHandContacts';
import {ClassicArmContinuation} from './classicArmContinuation';
import {ClassicKnifeForearm} from './classicKnifeForearm';
import {ClassicSupportHandFullness} from './classicSupportHandFullness';
import {ClassicKnifeFingerDetail} from './classicKnifeFingerDetail';
import {ClassicKnifeGloveTrim} from './classicKnifeGloveTrim';
import {EquipHandGrip} from './equipHandGrip';
import {ClassicKnifeGripRefinement} from './classicKnifeGripRefinement';

interface Arm {
  forearm:THREE.Object3D;hand:THREE.Object3D;
  forearmRest:THREE.Matrix4;wristRest:THREE.Vector3;contact:THREE.Vector3;contactInHand:THREE.Vector3;
}

const ease=(a:number,b:number,t:number)=>THREE.MathUtils.smoothstep(t,a,b);

export class ClassicViewArms {
  readonly group:THREE.Group;
  readonly model:THREE.Group;
  /** Distance between the authored palm contact and its animated gun contact. */
  readonly errors=[0,0];
  readonly continuation:ClassicArmContinuation;
  readonly knifeForearm:ClassicKnifeForearm;
  readonly knifeSupportForearm:ClassicKnifeForearm;
  private readonly supportFullness:ClassicSupportHandFullness;
  private readonly knifeFingerDetail:ClassicKnifeFingerDetail;
  readonly knifeGloveTrim:ClassicKnifeGloveTrim;
  private readonly equipGrips:EquipHandGrip[];
  private readonly knifeGripRefinement:ClassicKnifeGripRefinement;
  private readonly arms:Arm[];
  private readonly knifeFingers:{joint:THREE.Object3D;rest:THREE.Quaternion;closed:THREE.Quaternion}[];
  private readonly supportFlexJoints:{joint:THREE.Object3D;finger:number;weight:number}[];
  private readonly knifeSkin:{mesh:THREE.Mesh;original:THREE.Material|THREE.Material[];knife:THREE.Material|THREE.Material[]}[]=[];
  // Seat the turned palm against the slim handle; the thumb supports the
  // guard while the four finger pads wrap independently below it.
  private readonly knifeGraspInHand=new THREE.Vector3(0.026819,-2.612981,0.820362);
  private readonly knifeGrasp:THREE.Vector3;
  // Turn the palm around the handle so all four wrapped fingers, including
  // the short little finger, read from the first-person camera.
  private readonly knifePalmTurn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.55);
  private readonly target=new THREE.Vector3();
  private readonly actual=new THREE.Vector3();
  private readonly q=new THREE.Quaternion();
  private readonly endQ=new THREE.Quaternion();
  private readonly counterQ=new THREE.Quaternion();
  private readonly targetMatrix=new THREE.Matrix4();
  private readonly delta=new THREE.Matrix4();
  private readonly forearmMatrix=new THREE.Matrix4();
  private readonly parentInverse=new THREE.Matrix4();
  private readonly unit=new THREE.Vector3(1,1,1);
  private readonly rotation=new THREE.Euler();
  private readonly elbow=new THREE.Vector3();
  private readonly wrist=new THREE.Vector3();
  private readonly direction=new THREE.Vector3();
  private readonly lowerDirection=new THREE.Vector3();
  private readonly cameraRotation=new THREE.Quaternion();
  private readonly swing=new THREE.Quaternion();
  private readonly aroundContact=new THREE.Matrix4();

  constructor(private readonly camera:THREE.Camera,parent:THREE.Object3D){
    const rig=createClassicArmsFrame();this.group=rig.group;this.model=rig.model;
    this.equipGrips=[new EquipHandGrip(this.model,'left'),new EquipHandGrip(this.model,'right')];
    this.knifeGripRefinement=new ClassicKnifeGripRefinement(this.model);
    parent.add(this.group);this.group.updateWorldMatrix(true,true);
    const find=(name:string)=>{const joint=this.model.getObjectByName(name);if(!joint)throw new Error('Missing CS16 arm joint '+name);return joint;};
    this.arms=[
      {forearm:'Bone04_17',hand:'Bone_Righthand_16',contact:CLASSIC_HAND_CONTACTS.left},
      {forearm:'Bone01_40',hand:'Bone_Lefthand_39',contact:CLASSIC_HAND_CONTACTS.right},
    ].map(def=>{
      const forearm=find(def.forearm),hand=find(def.hand),contact=new THREE.Vector3(...def.contact);
      return {forearm,hand,contact,forearmRest:forearm.matrixWorld.clone(),wristRest:hand.getWorldPosition(new THREE.Vector3()),contactInHand:hand.worldToLocal(contact.clone())};
    });
    // Distribute the wrap across each knuckle instead of folding every tip
    // into the same straight row. The shorter little finger closes more softly.
    // Thumb flexion uses Z; the other fingers flex on X.
    // Other local axes and the complete firearm pose remain recoverable.
    const fingerPose:readonly (readonly [string,'x'|'z',number])[]=[
      ['Bone07_30','z',-0.513039],
      ['Bone21_29','x',-0.998718],['Bone22_28','x',-1.231724],['Bone23_27','x',-1.052861],
      ['Bone17_26','x',-1.053860],['Bone18_25','x',-1.291611],['Bone19_24','x',-1.165228],
      ['Bone13_23','x',-0.976290],['Bone14_22','x',-1.338929],['Bone15_21','x',-0.774407],
      ['Bone09_20','x',-0.679004],['Bone10_19','x',-1.047299],['Bone11_18','x',-0.628710],
      // The empty guarding hand rests half closed. Spread the curl along each
      // finger, with a little more flexion toward the little finger, instead
      // of a straight index beside three tightly hooked fingertips.
      ['Bone28_1','z',-.08],['Bone29_0','z',.15],
      ['Bone31_5','x',-.27],['Bone32_4','x',-.34],['Bone33_3','x',-.20],
      ['Bone35_8','x',-.30],['Bone36_7','x',-.38],['Bone37_6','x',-.23],
      ['Bone39_11','x',-.36],['Bone40_10','x',-.42],['Bone41_9','x',-.24],
      ['Bone43_14','x',-.42],['Bone44_13','x',-.46],['Bone45_12','x',-.26],
    ];
    // Small lateral adjustments align each pad with the handle and preserve
    // the gaps between neighboring skin surfaces without stretching bones.
    const gripAlignment:Record<string,readonly [number,number]>={
      Bone21_29:[0.080385,-0.035969],
      Bone22_28:[0.099081,-0.000001],
      Bone23_27:[0.104656,-0.000000],
      Bone17_26:[0.431878,-0.167609],
      Bone18_25:[-0.179734,0.000003],
      Bone19_24:[0.314427,0.000000],
      Bone13_23:[0.378515,-0.130140],
      Bone14_22:[-0.061381,0.000002],
      Bone15_21:[0.281181,-0.000000],
      Bone09_20:[0.143532,-0.046398],
      Bone10_19:[0.211488,0.000001],
      Bone11_18:[0.263652,-0.000001],
    };
    this.knifeFingers=fingerPose.map(([name,axis,angle])=>{
      const joint=find(name),rest=joint.quaternion.clone(),rotation=new THREE.Euler().setFromQuaternion(rest);
      rotation[axis]=angle;
      if(name in gripAlignment)[rotation.y,rotation.z]=gripAlignment[name];
      return {joint,rest,closed:new THREE.Quaternion().setFromEuler(rotation)};
    });
    this.supportFlexJoints=[['Bone31_5','Bone32_4','Bone33_3'],['Bone35_8','Bone36_7','Bone37_6'],['Bone39_11','Bone40_10','Bone41_9'],['Bone43_14','Bone44_13','Bone45_12']]
      .flatMap((names,finger)=>names.map((name,index)=>({joint:find(name),finger,weight:[1,.7,.4][index]})));
    // The real-hand reference raises the thumb knuckle beside the guard,
    // then folds its distal pad down onto the index. Keep the upper support
    // high without flattening the thumb into a horizontal bar.
    for(const [name,x,y,z] of [
      ['Bone05_32',-0.024884,-0.451521,-0.725836],
      ['Bone06_31',-0.276031,-0.314660,-0.782241],
    ] as const){
      const joint=find(name);
      this.knifeFingers.push({joint,rest:joint.quaternion.clone(),closed:new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z))});
    }
    this.knifeGrasp=this.arms[1].hand.localToWorld(this.knifeGraspInHand.clone());
    this.knifeForearm=new ClassicKnifeForearm(this.model,this.camera);
    this.knifeSupportForearm=new ClassicKnifeForearm(this.model,this.camera,'left');
    this.supportFullness=new ClassicSupportHandFullness(this.model);
    this.knifeFingerDetail=new ClassicKnifeFingerDetail(this.model);
    this.knifeGloveTrim=new ClassicKnifeGloveTrim(this.model);
    this.continuation=new ClassicArmContinuation(this.model,this.group,this.camera);
    // The source glove and finger shells are authored double-sided. Keep
    // their inner faces visible when the knife exposes the curled fingertips.
    // Each knife variant is local to this view; firearms restore source materials.
    const knifeVariants=new Map<THREE.Material,THREE.Material>();
    this.group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const original=object.material,materials=Array.isArray(original)?original:[original];
      if(!materials.some(m=>/view_skin|view_finger|view_glove/i.test(m.name)))return;
      const mapped=materials.map(material=>{
        if(!(material instanceof THREE.MeshBasicMaterial)||!/view_skin|view_finger|view_glove/i.test(material.name))return material;
        if(!knifeVariants.has(material)){
          const variant=material.clone();variant.side=THREE.DoubleSide;
          if(/view_skin|view_finger/i.test(material.name))variant.color.setRGB(.64,.61,.68);
          knifeVariants.set(material,variant);
        }
        return knifeVariants.get(material)!;
      });
      this.knifeSkin.push({mesh:object,original,knife:Array.isArray(original)?mapped:mapped[0]});
    });
  }

  private contactRotation(kind:WeaponKind,left:boolean,progress:number,phase:string){
    this.q.identity();
    if(!left)return;
    // The pistol support hand cups the firing hand instead of reaching under
    // a nonexistent fore-end. Long guns keep the exact authored AK hand pose.
    if(isHandgun(kind))this.q.setFromEuler(this.rotation.set(.8,.25,-1.2));
    if(kind==='knife')this.q.setFromEuler(this.rotation.set(.18,-.20,.50));
    if(progress<=0||phase==='ready')return;
    const grip=ease(0,.18,progress)*(1-ease(.80,1,progress));
    // AK-style palm-centred grasp, pitched to keep the elbow below the gun.
    // Wrist, fingers and forearm
    // share this rotation; none is independently counter-rotated or stretched.
    this.endQ.setFromEuler(this.rotation.set(.8,0,-.85));
    this.q.slerp(this.endQ,grip);
  }

  update(weapon:THREE.Group):void{
    const rig=weapon.userData.rig as {kind:WeaponKind;pivot:THREE.Group;left:THREE.Group;right:THREE.Group}|undefined;
    if(!rig?.left||!rig.right)return;
    this.knifeGripRefinement.reset();
    this.supportFullness.reset();
    this.knifeSkin.forEach(({mesh,original,knife})=>mesh.material=rig.kind==='knife'?knife:original);
    this.knifeFingers.forEach(({joint,rest,closed})=>joint.quaternion.copy(rig.kind==='knife'?closed:rest));
    const pose=weapon.userData.pose;
    if(rig.kind!=='knife')this.equipGrips.forEach((grip,i)=>grip.update(pose?.equipHand===(i===0?'left':'right')?(pose.equipReach??0):0));
    if(rig.kind==='knife'){
      // Each update starts from the authored half curl. A slow staggered
      // 3-degree flex uses simulation seconds, so pause and replay are exact.
      const time=Number.isFinite(pose?.supportTime)?pose.supportTime:0;
      const flex:number[]=pose.supportFlex??(pose.supportFlex=[0,0,0,0]);
      for(let finger=0;finger<4;finger++)flex[finger]=Math.sin(time*1.05+finger*.65)*.0546;
      for(const {joint,finger,weight} of this.supportFlexJoints)joint.rotation.x+=flex[finger]*weight/2.1;
    }
    weapon.updateWorldMatrix(true,true);this.group.updateWorldMatrix(true,true);
    this.arms.forEach((arm,i)=>{
      const driver=i===0?rig.left:rig.right;
      this.target.copy(driver.position);
      if(rig.kind==='knife'){
        this.q.copy(driver.quaternion);
        if(i===1)this.q.premultiply(this.knifePalmTurn);
      }
      else this.contactRotation(rig.kind,i===0,pose?.progress??0,pose?.phase??'ready');
      if(rig.kind!=='knife'&&(pose?.equipReach??0)>0&&pose.equipHand===(i===1?'right':'left')){
        this.endQ.setFromEuler(this.rotation.set(i===1?.12:.48,i===1?-.2:0,i===1?.18:-.5));
        this.q.slerp(this.endQ,pose.equipReach);
      }
      // Nova rolls its loading port toward the camera. Keep the loading arm
      // below the port as a complete rigid limb instead of rolling its elbow
      // above the gun. Knife drivers already own their body/grip frames.
      if(i===0&&rig.kind==='shotgun'){
        const blend=ease(0,.15,pose?.progress??0)*(1-ease(.88,1,pose?.progress??0));
        this.endQ.setFromEuler(this.rotation.set(.12,-.15,-.18));
        this.counterQ.copy(rig.pivot.quaternion).invert().multiply(this.endQ);
        this.q.slerp(this.counterQ,blend);
      }
      this.targetMatrix.compose(this.target,this.q,this.unit).premultiply(rig.pivot.matrixWorld);
      const knifeGrip=rig.kind==='knife'&&i===1,contact=knifeGrip?this.knifeGrasp:arm.contact;
      this.delta.copy(this.targetMatrix).multiply(this.parentInverse.makeTranslation(-contact.x,-contact.y,-contact.z));
      const tuck=i===0&&rig.kind!=='knife'?Math.max(ease(0,.15,pose?.progress??0)*(1-ease(.88,1,pose?.progress??0)),pose?.equipHand==='left'?(pose?.equipReach??0):0):0;
      if(tuck>0){
        this.wrist.copy(arm.wristRest).applyMatrix4(this.delta);
        this.elbow.setFromMatrixPosition(arm.forearmRest).applyMatrix4(this.delta);
        this.direction.copy(this.elbow).sub(this.wrist).normalize();
        this.camera.getWorldQuaternion(this.cameraRotation);
        this.lowerDirection.set(-.40,-.83,.55).normalize().applyQuaternion(this.cameraRotation);
        this.swing.setFromUnitVectors(this.direction,this.lowerDirection);
        this.q.identity().slerp(this.swing,tuck);
        this.target.setFromMatrixPosition(this.targetMatrix);
        this.aroundContact.makeTranslation(this.target.x,this.target.y,this.target.z)
          .multiply(this.parentInverse.makeRotationFromQuaternion(this.q))
          .multiply(this.parentInverse.makeTranslation(-this.target.x,-this.target.y,-this.target.z));
        // As in the AK, tuck the elbow below the viewport during reload. Rotate
        // the whole limb about the contact to retain its authored skin shape.
        this.delta.premultiply(this.aroundContact);
      }
      this.forearmMatrix.multiplyMatrices(this.delta,arm.forearmRest);
      this.parentInverse.copy(arm.forearm.parent!.matrixWorld).invert().multiply(this.forearmMatrix)
        .decompose(arm.forearm.position,arm.forearm.quaternion,arm.forearm.scale);
      arm.forearm.updateWorldMatrix(false,true);
      this.actual.copy(knifeGrip?this.knifeGraspInHand:arm.contactInHand);arm.hand.localToWorld(this.actual);
      this.target.setFromMatrixPosition(this.targetMatrix);
      this.errors[i]=this.actual.distanceTo(this.target);
    });
    this.knifeForearm.update(rig.kind==='knife');
    this.knifeSupportForearm.update(rig.kind==='knife');
    this.knifeFingerDetail.update(rig.kind==='knife');
    this.knifeGloveTrim.update(rig.kind==='knife');
    if(rig.kind==='knife')this.knifeGripRefinement.apply();
    this.supportFullness.apply(rig.kind==='knife');
    this.continuation.update();
  }
}
