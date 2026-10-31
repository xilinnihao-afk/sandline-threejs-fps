import * as THREE from 'three';

interface Limb { upper:THREE.Object3D; lower:THREE.Object3D; end:THREE.Object3D; }
export interface DeathRig {
 pose:THREE.Group; model:THREE.Object3D; hip:THREE.Object3D; spine:THREE.Object3D; head:THREE.Object3D;
 arms:Array<{upper:THREE.Object3D;lower:THREE.Object3D;hand:THREE.Object3D}>;
 deathBones:{leftThigh:THREE.Object3D;rightThigh:THREE.Object3D;leftShin:THREE.Object3D;rightShin:THREE.Object3D};
 footL:THREE.Object3D;footR:THREE.Object3D;toeL:THREE.Object3D;toeR:THREE.Object3D;
 joints:THREE.Object3D[];gun:THREE.Group;
}
const smooth=(a:number,b:number,t:number)=>THREE.MathUtils.smoothstep(t,a,b);
const DURATION=1.15;
const p=new THREE.Vector3(),q=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
// Express secondary motion in the actor's frame; imported bone axes differ.
function rotateInActorFrame(root:THREE.Group,joint:THREE.Object3D,axis:THREE.Vector3,angle:number){
 const worldAxis=axis.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
 const rotation=new THREE.Quaternion().setFromAxisAngle(worldAxis,angle).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
 rotation.premultiply(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
 joint.quaternion.copy(rotation);joint.updateWorldMatrix(false,true);
}
function orientContact(root:THREE.Group,joint:THREE.Object3D,child:THREE.Object3D,initial:THREE.Quaternion,direction:THREE.Vector3,weight:number){
 const from=child.position.clone().normalize().applyQuaternion(initial);
 const final=new THREE.Quaternion().setFromUnitVectors(from,direction.normalize()).multiply(initial);
 const rotation=root.getWorldQuaternion(new THREE.Quaternion()).multiply(initial.clone().slerp(final,weight));
 joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
 joint.updateWorldMatrix(false,true);
}
function pointBone(joint:THREE.Object3D,child:THREE.Object3D,target:THREE.Vector3,weight:number){
 const origin=joint.getWorldPosition(new THREE.Vector3());
 const from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
 const to=target.clone().sub(origin).normalize();
 const rotation=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
 joint.parent!.getWorldQuaternion(parentQ).invert();rotation.premultiply(parentQ);
 joint.quaternion.slerp(rotation,weight).normalize();joint.updateWorldMatrix(false,true);
}
/** 两段骨骼解析 IK：保持骨长，肘/膝使用固定侧向极点，不用随机旋转。 */
function settleLimb(root:THREE.Group,limb:Limb,targetLocal:THREE.Vector3,poleLocal:THREE.Vector3,weight:number){
 const origin=limb.upper.getWorldPosition(new THREE.Vector3());
 const elbow=limb.lower.getWorldPosition(new THREE.Vector3()),hand=limb.end.getWorldPosition(new THREE.Vector3());
 const l1=origin.distanceTo(elbow),l2=elbow.distanceTo(hand);
 const target=root.localToWorld(targetLocal.clone()),pole=root.localToWorld(poleLocal.clone());
 const line=target.clone().sub(origin),distance=THREE.MathUtils.clamp(line.length(),Math.abs(l1-l2)+.001,l1+l2-.002);line.normalize();
 target.copy(origin).addScaledVector(line,distance);
 const along=(l1*l1+distance*distance-l2*l2)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 const bend=pole.sub(origin);bend.addScaledVector(line,-bend.dot(line)).normalize();
 const middle=origin.clone().addScaledVector(line,along).addScaledVector(bend,height);
 pointBone(limb.upper,limb.lower,middle,weight);pointBone(limb.lower,limb.end,target,weight);
}

/** 轻量倒地表现：接管死亡后的骨骼，避免待机/瞄准/受击层继续把尸体抬起。 */
export class CharacterDeathController {
 private elapsed=0;
 private started=false;
 private saved:Array<{p:THREE.Vector3;q:THREE.Quaternion}>;
 private poseP=new THREE.Vector3();private poseQ=new THREE.Quaternion();
 private hipStart=new THREE.Vector3();
 private gunP=new THREE.Vector3();private gunQ=new THREE.Quaternion();
 private side=1;
 private backward=false;private strength=1;
 private feet=[new THREE.Vector3(),new THREE.Vector3()];
 private hands=[new THREE.Vector3(),new THREE.Vector3()];
 private elbows=[new THREE.Vector3(),new THREE.Vector3()];
 private handQ=[new THREE.Quaternion(),new THREE.Quaternion()];
 private footQ=[new THREE.Quaternion(),new THREE.Quaternion()];
 private settled:{joints:Array<{p:THREE.Vector3;q:THREE.Quaternion}>;p:THREE.Vector3;q:THREE.Quaternion;gunP:THREE.Vector3;gunQ:THREE.Quaternion}|null=null;
 constructor(private root:THREE.Group,private rig:DeathRig){
  this.saved=rig.joints.map(j=>({p:j.position.clone(),q:j.quaternion.clone()}));
 }
 /** 活着时在握枪 IK 之后保存姿态，死亡不会突然弹回待机或 T-pose。 */
 captureAlive(){
  this.started=false;this.elapsed=0;this.settled=null;
  this.rig.joints.forEach((j,i)=>{this.saved[i].p.copy(j.position);this.saved[i].q.copy(j.quaternion);});
  this.poseP.copy(this.rig.pose.position);this.poseQ.copy(this.rig.pose.quaternion);
  this.root.updateWorldMatrix(true,true);
  this.hipStart.copy(this.root.worldToLocal(this.rig.hip.getWorldPosition(new THREE.Vector3())));
  this.gunP.copy(this.root.worldToLocal(this.rig.gun.getWorldPosition(new THREE.Vector3())));
  this.gunQ.copy(this.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.rig.gun.getWorldQuaternion(new THREE.Quaternion())));
  [this.rig.footL,this.rig.footR].forEach((foot,i)=>this.feet[i].copy(this.root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()))));
  this.rig.arms.forEach((arm,i)=>this.hands[i].copy(this.root.worldToLocal(arm.hand.getWorldPosition(new THREE.Vector3()))));
  this.rig.arms.forEach((arm,i)=>this.elbows[i].copy(this.root.worldToLocal(arm.lower.getWorldPosition(new THREE.Vector3()))));
  this.rig.arms.forEach((arm,i)=>this.handQ[i].copy(this.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(arm.hand.getWorldQuaternion(new THREE.Quaternion()))));
  [this.rig.footL,this.rig.footR].forEach((foot,i)=>this.footQ[i].copy(this.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foot.getWorldQuaternion(new THREE.Quaternion()))));
 }
 reset(){this.started=false;this.elapsed=0;this.settled=null;}
 update(dt:number,id:number,hitSide:number,hitFront=-1,strength=1){
  const r=this.rig;
  if(this.settled){const s=this.settled;r.joints.forEach((j,i)=>{j.position.copy(s.joints[i].p);j.quaternion.copy(s.joints[i].q);});r.pose.position.copy(s.p);r.pose.quaternion.copy(s.q);r.gun.position.copy(s.gunP);r.gun.quaternion.copy(s.gunQ);r.gun.visible=true;return 1;}
  if(!this.started){this.started=true;this.side=Math.abs(hitSide)>.1?Math.sign(hitSide):(id%2?1:-1);this.backward=hitFront>.15;this.strength=THREE.MathUtils.clamp(strength,1,1.4);}
  this.elapsed=Math.min(DURATION,this.elapsed+Math.max(0,dt));
  if(this.elapsed===0)return 0; // Preserve the captured contact pose on entry.
  // Preserve the first reaction/support phase; accelerate the unsupported fall.
  // Timeline sampling stays analytic and identical at all render rates.
  const t=Math.min(1.5,this.elapsed<=.2?this.elapsed:.2+(this.elapsed-.2)*1.45),back=this.backward,fall=smooth(back?.12:.18,back?1.02:.94,t),contact=smooth(back?.82:.72,1.3,t);
  const impact=smooth(0,.085,t)*(1-smooth(.085,.32,t));
  const buckle=smooth(.055,.34,t)*(1-smooth(.52,1.12,t));
  const settle=Math.sin(Math.PI*smooth(.9,1.34,t))*(1-smooth(.9,1.34,t));
  r.joints.forEach((j,i)=>{j.position.copy(this.saved[i].p);j.quaternion.copy(this.saved[i].q);});
  // 正面受击先后仰，再失去腿部支撑；背面受击保留向前扑倒。根节点不移动。
  const finalQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(back?Math.PI/2:-Math.PI/2,this.side*.04,this.side*(back?.07:.14),'YXZ'));
  r.pose.quaternion.copy(this.poseQ).slerp(finalQ,fall);
  if(back)r.pose.rotateX(impact*.09*this.strength);
  r.pose.rotateZ(this.side*(impact*.025+buckle*.04+settle*.008));
  r.pose.position.copy(this.poseP);r.pose.updateWorldMatrix(true,true);
  const hipNow=this.root.worldToLocal(r.hip.getWorldPosition(new THREE.Vector3()));
  const hipTarget=this.hipStart.clone().lerp(new THREE.Vector3(this.side*.06,back?.19:.21,back?.36+.10*(this.strength-1):.15),smooth(back?.08:.24,back?1.02:.94,t));
  hipTarget.y-=(back?.15:.24)*smooth(.035,.34,t)*(1-smooth(.34,.94,t));
  hipTarget.y+=settle*.018;
  hipTarget.x+=this.side*buckle*.06;
  r.pose.position.add(hipTarget.sub(hipNow));this.root.updateWorldMatrix(true,true);
  // Chest takes the impact first; the head lags, then the shoulders meet the floor.
  rotateInActorFrame(this.root,r.spine,new THREE.Vector3(1,0,0),back?impact*.14*this.strength-buckle*.04-settle*.015:impact*.07-buckle*.16+settle*.015);
  rotateInActorFrame(this.root,r.spine,new THREE.Vector3(0,0,1),this.side*(-impact*.035+buckle*.035));
  rotateInActorFrame(this.root,r.head,new THREE.Vector3(1,0,0),back?impact*.10-buckle*.07+settle*.04:-impact*.12+buckle*.16-settle*.045);
  r.head.rotateY(this.side*(back?.18:.85)*contact);r.head.rotateZ(this.side*.10*contact);
  this.root.updateWorldMatrix(true,true);
  // A captured aiming/locomotion pose can lean at the spine. Simply rotating
  // that pose 90 degrees leaves the corpse doing a sit-up. Settle the torso
  // axis onto the ground while preserving the current pelvis as the pivot.
  const pelvis=this.root.worldToLocal(r.hip.getWorldPosition(new THREE.Vector3()));
  const torso=this.root.worldToLocal(r.head.getWorldPosition(new THREE.Vector3())).sub(pelvis).normalize();
  const restingAxis=new THREE.Vector3(this.side*.035,.055,back?1:-1).normalize();
  const settleRotation=new THREE.Quaternion().setFromUnitVectors(torso,restingAxis);
  settleRotation.slerp(new THREE.Quaternion(),1-contact);
  r.pose.quaternion.premultiply(settleRotation);this.root.updateWorldMatrix(true,true);
  r.pose.position.add(pelvis.sub(this.root.worldToLocal(r.hip.getWorldPosition(new THREE.Vector3()))));
  this.root.updateWorldMatrix(true,true);
  // 先校正帽檐/头部和躯干支撑，再求解四肢，避免抬高头部时把双手一起悬空。
  let coreClearance=Infinity;
  for(const [joint,radius] of [[r.hip,.14],[r.spine,.13],[r.head,.18]] as Array<[THREE.Object3D,number]>){this.root.worldToLocal(joint.getWorldPosition(p));coreClearance=Math.min(coreClearance,p.y-radius);}
  r.pose.position.y+=Math.max(0,-coreClearance);this.root.updateWorldMatrix(true,true);
  // 双腿不对称：一侧屈膝、另一侧自然伸展，脚尖朝地面而非竖直绷紧。
  const legs:Limb[]=[{upper:r.deathBones.leftThigh,lower:r.deathBones.leftShin,end:r.footL},{upper:r.deathBones.rightThigh,lower:r.deathBones.rightShin,end:r.footR}];
  legs.forEach((leg,i)=>{
   const sign=i===0?-1:1,bent=sign===this.side;
   // Keep the soles near their captured contacts while the knees first buckle.
   // The near leg folds first; the other foot trails into its resting position.
   const release=smooth(bent?.24:.21,bent?.96:.80,t);
   const target=this.feet[i].clone().lerp(new THREE.Vector3(sign*(bent?.28:.18),.095,back?(bent?-.36:-.54):(bent?.77:1.0)),release);
   // Keep knee poles lateral to the leg line throughout the support-to-fall
   // transition; the Source rigs have longer shins than the former soldier.
   const pole=new THREE.Vector3(sign*.55,.75,-.65).lerp(new THREE.Vector3(sign*.70,back?.50:.13,back?-.18:.43),smooth(.48,1.08,t));
   settleLimb(this.root,leg,target,pole,smooth(0,.14,t));
   const toe=i===0?r.toeL:r.toeR;
   orientContact(this.root,leg.end,toe,this.footQ[i],new THREE.Vector3(sign*(bent?.11:.06),back?.16:-.025,back?-.07:(bent?.15:.17)),contact);
  });
  // 手臂松开武器，肘部落在身体外侧，前臂和手掌获得地面支撑。
  r.arms.forEach((arm,i)=>{
   const sign=i===0?-1:1;
   const delay=sign===this.side?0:.09;
   // Release, reach for the floor, then let the elbow yield under body weight.
   const brace=new THREE.Vector3(sign*(back?.32:.34),back?.40:.14,back?.38:-.56);
   const rest=new THREE.Vector3(sign*(back?.40:.38),.06,back?(sign===this.side?.25:.76):(sign===this.side?-.05:-.63));
   const handTarget=this.hands[i].clone().lerp(brace,smooth(.12+delay,.7+delay,t));
   handTarget.lerp(rest,smooth(.73+delay,1.3+delay,t));
   // A raised pole stays off the shoulder-to-hand line during a supine
   // release. A low lateral pole crosses that line on the new Source rigs
   // and flips the elbow even while the hand follows a smooth trajectory.
   const elbowTarget=new THREE.Vector3(sign*1.3,back?.65:.22,back?.38:-.25);
   settleLimb(this.root,{upper:arm.upper,lower:arm.lower,end:arm.hand},
    handTarget,elbowTarget,smooth(back?.04:0,back?.24:.10,t));
   // Preserve the wrist's captured orientation during release, independently
   // of the upper arm's IK swing; blend palm-down only as ground contact starts.
   const finger=arm.hand.children.find(c=>/Middle1/.test(c.name));
   if(finger)orientContact(this.root,arm.hand,finger,this.handQ[i],new THREE.Vector3(sign*.08,back?.015:-.025,sign===this.side?.12:-.10),contact);
  });
  this.root.updateWorldMatrix(true,true);
  // 骨骼接触代理：抬高视觉层以避免头、手、膝和鞋底穿地，下落阶段不扫描网格顶点。
  const supports:Array<[THREE.Object3D,number]>=[[r.hip,.14],[r.spine,.13],[r.head,.18],[r.footL,.06],[r.footR,.06],
   [r.deathBones.leftShin,.065],[r.deathBones.rightShin,.065],...r.arms.flatMap(a=>[[a.lower,.045],[a.hand,.035]] as Array<[THREE.Object3D,number]>)];
  let clearance=Infinity;for(const [joint,radius]of supports){this.root.worldToLocal(joint.getWorldPosition(p));clearance=Math.min(clearance,p.y-radius);}
  r.pose.position.y+=Math.max(0,-clearance);this.root.updateWorldMatrix(true,true);
  // Only scan the actual skin during the final settle; cache the stable corpse.
  if(t>=1.2){
   this.root.updateMatrixWorld(true); // 同步 SkinnedMesh 的 bindMatrixInverse，避免重复施加上一帧的视觉变换。
   let surface=Infinity;
   r.model.traverse(object=>{if(object instanceof THREE.SkinnedMesh){object.skeleton.update();for(let i=0;i<object.geometry.attributes.position.count;i++){object.getVertexPosition(i,p).applyMatrix4(object.matrixWorld);this.root.worldToLocal(p);surface=Math.min(surface,p.y);}}});
   r.pose.position.y+=Math.max(0,.003-surface)*smooth(1.2,1.45,t);this.root.updateWorldMatrix(true,true);
  }
  // 武器从原握持位置松落到身侧，不再悬在胸前或插入腰部。
  const drop=smooth(.16,.78,t);
  const gunLocal=this.gunP.clone().lerp(new THREE.Vector3(-this.side*.43,.065,back?.12:-.16),drop);
  const flight=THREE.MathUtils.clamp((t-.16)/.62,0,1);
  gunLocal.y=THREE.MathUtils.lerp(this.gunP.y,.065,Math.min(1,flight*flight*1.7));
  const gunWorld=this.root.localToWorld(gunLocal);r.gun.position.copy(r.pose.worldToLocal(gunWorld));
  q.copy(this.gunQ).slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-this.side*.35,Math.PI/2)),drop);
  q.premultiply(this.root.getWorldQuaternion(parentQ));r.pose.getWorldQuaternion(parentQ).invert();r.gun.quaternion.copy(parentQ.multiply(q));
  r.gun.visible=true;
  // 静止后缓存最终姿态；手机无需持续求解六具尸体的 IK。
  if(this.elapsed>=DURATION)this.settled={joints:r.joints.map(j=>({p:j.position.clone(),q:j.quaternion.clone()})),p:r.pose.position.clone(),q:r.pose.quaternion.clone(),gunP:r.gun.position.clone(),gunQ:r.gun.quaternion.clone()};
  return Math.min(1,this.elapsed/DURATION);
 }
}

/** Incoming travel vector in world space → source side/front in actor space (-Z forward). */
export function characterHitDirection(yaw:number,normalX:number,normalZ:number){
 const length=Math.hypot(normalX,normalZ);
 if(!Number.isFinite(length)||length<1e-6)return {side:0,front:-1};
 return {side:(-normalX*Math.cos(yaw)+normalZ*Math.sin(yaw))/length,
  front:(normalX*Math.sin(yaw)+normalZ*Math.cos(yaw))/length};
}
