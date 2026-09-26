import * as THREE from 'three';
import type { PlayerArmsRig } from './fpsPresentation';

/** Anatomical two-bone chain. Targets are the animated weapon wrist sockets;
 * shoulders stay outside the camera frustum. No independent wrist smoothing. */
export class ViewArmsIK {
  private chains: Array<{upper:THREE.Object3D;lower:THREE.Object3D;hand:THREE.Object3D;basis:THREE.Quaternion;side:number;l1:number;l2:number;upperRest:THREE.Quaternion;lowerRest:THREE.Quaternion;handRest:THREE.Quaternion}>;
  private a=new THREE.Vector3(); private b=new THREE.Vector3(); private c=new THREE.Vector3();
  private shoulder=new THREE.Vector3(); private target=new THREE.Vector3();
  private direction=new THREE.Vector3(); private pole=new THREE.Vector3(); private elbow=new THREE.Vector3();
  private rightCorrection=new THREE.Quaternion().setFromEuler(new THREE.Euler(.35,0,-Math.PI/2));
  private desiredHand=new THREE.Quaternion(); private desiredLower=new THREE.Quaternion();
  private currentLower=new THREE.Quaternion(); private twist=new THREE.Quaternion();
  private axis=new THREE.Vector3();
  private q=new THREE.Quaternion(); private parentQ=new THREE.Quaternion();
  readonly errors=[0,0];
  constructor(private rig:PlayerArmsRig,private camera:THREE.Camera){
    rig.group.updateWorldMatrix(true,true);
    const find=(name:string)=>{const b=rig.model.getObjectByName(name);if(!b)throw new Error('Missing arm joint '+name);return b;};
    // Close the supplied relaxed finger pose around the grip. Local -X is
    // the flexion axis of this FBX rig; keep the thumb opposition authored.
    rig.model.traverse(bone=>{
      if(!bone.name.match(/^[LR]_(point|middle|ring|pink)[123]_/))return;
      const joint=Number(bone.name.match(/[123]_/ )![0][0]);
      bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),joint===1?-.75:joint===2?-.85:-.50));
    });
    this.chains=([-1,1] as const).map(side=>{
      const left=side<0;
      const upper=find(left?'L_arm_01':'R_arm_023'),lower=find(left?'L_elbow_02':'R_elbow_024'),hand=find(left?'L_wrist_03':'R_wrist_025');
      const middle=find(left?'L_middle1_012':'R_middle1_034'),index=find(left?'L_point1_08':'R_point1_030'),pinky=find(left?'L_pink1_019':'R_pink1_042');
      const z=hand.worldToLocal(middle.getWorldPosition(new THREE.Vector3())).normalize().negate();
      const across=hand.worldToLocal(index.getWorldPosition(new THREE.Vector3())).sub(hand.worldToLocal(pinky.getWorldPosition(new THREE.Vector3()))).normalize().multiplyScalar(left?1:-1);
      const y=new THREE.Vector3().crossVectors(z,across).normalize(),x=new THREE.Vector3().crossVectors(y,z).normalize();
      const basis=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z)).invert();
      const l1=upper.getWorldPosition(this.a).distanceTo(lower.getWorldPosition(this.b));
      const l2=lower.getWorldPosition(this.a).distanceTo(hand.getWorldPosition(this.b));
      return {upper,lower,hand,basis,side,l1,l2,upperRest:upper.quaternion.clone(),lowerRest:lower.quaternion.clone(),handRest:hand.quaternion.clone()};
    });
  }
  private aim(joint:THREE.Object3D,child:THREE.Object3D,target:THREE.Vector3){
    joint.getWorldPosition(this.a);child.getWorldPosition(this.b).sub(this.a).normalize();this.c.copy(target).sub(this.a).normalize();
    this.q.setFromUnitVectors(this.b,this.c);joint.getWorldQuaternion(this.parentQ);this.q.multiply(this.parentQ);
    joint.parent!.getWorldQuaternion(this.parentQ).invert();joint.quaternion.copy(this.parentQ.multiply(this.q));joint.updateWorldMatrix(false,true);
  }
  update(weapon:THREE.Group){
    const grips=weapon.userData.grips as {left:THREE.Object3D;right:THREE.Object3D};
    if(!grips)return;
    weapon.updateWorldMatrix(true,true);
    this.rig.group.updateWorldMatrix(true,true);
    this.chains.forEach((arm,i)=>{
      const grip=i===0?grips.left:grips.right;
      arm.upper.quaternion.copy(arm.upperRest);arm.lower.quaternion.copy(arm.lowerRest);
      arm.hand.quaternion.copy(arm.handRest);arm.upper.updateWorldMatrix(true,true);
      grip.getWorldPosition(this.target);
      this.shoulder.set(arm.side*.23,-.38,.10);this.camera.localToWorld(this.shoulder);
      // Shoulder may move minimally on extreme reload reaches, never stretch bones.
      this.direction.copy(this.target).sub(this.shoulder);
      const reach=(arm.l1+arm.l2)*.985;
      if(this.direction.length()>reach)this.shoulder.addScaledVector(this.direction.clone().normalize(),this.direction.length()-reach);
      arm.upper.position.copy(arm.upper.parent!.worldToLocal(this.a.copy(this.shoulder)));
      arm.upper.updateWorldMatrix(true,true);
      this.direction.copy(this.target).sub(this.shoulder);
      const d=Math.max(.001,this.direction.length());this.direction.normalize();
      const along=(arm.l1*arm.l1+d*d-arm.l2*arm.l2)/(2*d),height=Math.sqrt(Math.max(0,arm.l1*arm.l1-along*along));
      this.pole.set(arm.side*.7,-1,.4).transformDirection(this.camera.matrixWorld);
      this.pole.addScaledVector(this.direction,-this.pole.dot(this.direction)).normalize();
      this.elbow.copy(this.shoulder).addScaledVector(this.direction,along).addScaledVector(this.pole,height);
      this.aim(arm.upper,arm.lower,this.elbow);this.aim(arm.lower,arm.hand,this.target);
      grip.getWorldQuaternion(this.q);
      if(i===1)this.q.multiply(this.rightCorrection);
      this.desiredHand.copy(this.q).multiply(arm.basis);
      // Distribute pronation to the forearm instead of twisting only the wrist.
      // Project the relative rotation onto the elbow→wrist axis (swing/twist
      // decomposition). This roll preserves both endpoints of the IK chain.
      this.desiredLower.copy(this.desiredHand).multiply(this.q.copy(arm.handRest).invert());
      arm.lower.getWorldQuaternion(this.currentLower);
      this.twist.copy(this.desiredLower).multiply(this.q.copy(this.currentLower).invert());
      arm.hand.getWorldPosition(this.axis).sub(arm.lower.getWorldPosition(this.a)).normalize();
      const projection=this.twist.x*this.axis.x+this.twist.y*this.axis.y+this.twist.z*this.axis.z;
      this.twist.set(this.axis.x*projection,this.axis.y*projection,this.axis.z*projection,this.twist.w);
      if(this.twist.lengthSq()>1e-10){
        this.twist.normalize().multiply(this.currentLower);
        arm.lower.parent!.getWorldQuaternion(this.parentQ).invert();
        arm.lower.quaternion.copy(this.parentQ.multiply(this.twist));arm.lower.updateWorldMatrix(false,true);
      }
      arm.hand.parent!.getWorldQuaternion(this.parentQ).invert();
      arm.hand.quaternion.copy(this.parentQ.multiply(this.desiredHand));
      arm.hand.updateWorldMatrix(false,true);
      this.errors[i]=arm.hand.getWorldPosition(this.a).distanceTo(this.target);
    });
  }
}

/** Hide geometry only: wrist sockets remain available to the IK solver. */
export function hideLegacyArms(weapon:THREE.Group){
  const rig=weapon.userData.rig;
  for(const root of [rig.left,rig.right,rig.leftForearm,rig.rightForearm])root?.traverse((o:THREE.Object3D)=>{if(o instanceof THREE.Mesh)o.visible=false;});
}
