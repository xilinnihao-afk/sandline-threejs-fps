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
const p=new THREE.Vector3(),q=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
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
 }
 reset(){this.started=false;this.elapsed=0;this.settled=null;}
 update(dt:number,id:number,hitSide:number){
  const r=this.rig;
  if(this.settled){const s=this.settled;r.joints.forEach((j,i)=>{j.position.copy(s.joints[i].p);j.quaternion.copy(s.joints[i].q);});r.pose.position.copy(s.p);r.pose.quaternion.copy(s.q);r.gun.position.copy(s.gunP);r.gun.quaternion.copy(s.gunQ);r.gun.visible=true;return 1;}
  if(!this.started){this.started=true;this.side=Math.abs(hitSide)>.1?Math.sign(hitSide):(id%2?1:-1);}
  this.elapsed=Math.min(1.25,this.elapsed+Math.max(0,dt));
  const t=this.elapsed,fall=smooth(.08,.83,t),limbs=smooth(.12,.95,t),contact=smooth(.60,1.12,t);
  r.joints.forEach((j,i)=>{j.position.copy(this.saved[i].p);j.quaternion.copy(this.saved[i].q);});
  // 向前并稍微侧倒；髋部先下沉，躯干随后接触地面，避免绕脚跟僵硬翻转。
  const finalQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,this.side*.12,this.side*.25,'YXZ'));
  r.pose.quaternion.copy(this.poseQ).slerp(finalQ,fall);
  r.pose.position.copy(this.poseP);r.pose.updateWorldMatrix(true,true);
  const hipNow=this.root.worldToLocal(r.hip.getWorldPosition(new THREE.Vector3()));
  const hipTarget=this.hipStart.clone().lerp(new THREE.Vector3(this.side*.06,.21,.15),smooth(0,.86,t));
  hipTarget.y-=Math.sin(Math.PI*smooth(0,.6,t))*.13*(1-fall);
  r.pose.position.add(hipTarget.sub(hipNow));this.root.updateWorldMatrix(true,true);
  r.head.rotateY(this.side*1.2*contact);r.head.rotateZ(this.side*.10*contact);
  this.root.updateWorldMatrix(true,true);
  // 先校正帽檐/头部和躯干支撑，再求解四肢，避免抬高头部时把双手一起悬空。
  let coreClearance=Infinity;
  for(const [joint,radius] of [[r.hip,.14],[r.spine,.13],[r.head,.18]] as Array<[THREE.Object3D,number]>){this.root.worldToLocal(joint.getWorldPosition(p));coreClearance=Math.min(coreClearance,p.y-radius);}
  r.pose.position.y+=Math.max(0,-coreClearance);this.root.updateWorldMatrix(true,true);
  // 双腿不对称：一侧屈膝、另一侧自然伸展，脚尖朝地面而非竖直绷紧。
  const legs:Limb[]=[{upper:r.deathBones.leftThigh,lower:r.deathBones.leftShin,end:r.footL},{upper:r.deathBones.rightThigh,lower:r.deathBones.rightShin,end:r.footR}];
  legs.forEach((leg,i)=>{
   const sign=i===0?-1:1,bent=sign===this.side;
   settleLimb(this.root,leg,new THREE.Vector3(sign*(bent?.37:.18),.095,bent?.77:1.0),new THREE.Vector3(sign*.55,.13,.43),limbs);
   const foot=leg.end.getWorldPosition(new THREE.Vector3()),toe=i===0?r.toeL:r.toeR;
   const target=this.root.localToWorld(new THREE.Vector3(sign*(bent?.48:.24),.06,bent?.92:1.17));
   target.y=Math.max(foot.y-.025,target.y);pointBone(leg.end,toe,target,contact);
  });
  // 手臂松开武器，肘部落在身体外侧，前臂和手掌获得地面支撑。
  r.arms.forEach((arm,i)=>{
   const sign=i===0?-1:1;
   settleLimb(this.root,{upper:arm.upper,lower:arm.lower,end:arm.hand},
    new THREE.Vector3(sign*.48,.06,sign===this.side?-.05:-.63),new THREE.Vector3(sign*.62,.08,-.25),limbs);
   const finger=arm.hand.children.find(c=>/Middle1/.test(c.name));
   if(finger){const handLocal=this.root.worldToLocal(arm.hand.getWorldPosition(new THREE.Vector3()));
    const tip=this.root.localToWorld(handLocal.add(new THREE.Vector3(sign*.08,-.025,sign===this.side?.12:-.10)));
    pointBone(arm.hand,finger,tip,contact);
   }
  });
  this.root.updateWorldMatrix(true,true);
  // 骨骼接触代理：抬高视觉层以避免头、手、膝和鞋底穿地，下落阶段不扫描网格顶点。
  const supports:Array<[THREE.Object3D,number]>=[[r.hip,.14],[r.spine,.13],[r.head,.18],[r.footL,.06],[r.footR,.06],
   [r.deathBones.leftShin,.065],[r.deathBones.rightShin,.065],...r.arms.flatMap(a=>[[a.lower,.045],[a.hand,.035]] as Array<[THREE.Object3D,number]>)];
  let clearance=Infinity;for(const [joint,radius]of supports){this.root.worldToLocal(joint.getWorldPosition(p));clearance=Math.min(clearance,p.y-radius);}
  r.pose.position.y+=Math.max(0,-clearance);this.root.updateWorldMatrix(true,true);
  // 收尾的 0.25 秒按真实蒙皮表面修正帽檐/鞋尖，随后缓存，不给静止尸体增加开销。
  if(t>=1){
   this.root.updateMatrixWorld(true); // 同步 SkinnedMesh 的 bindMatrixInverse，避免重复施加上一帧的视觉变换。
   let surface=Infinity;
   r.model.traverse(object=>{if(object instanceof THREE.SkinnedMesh){object.skeleton.update();for(let i=0;i<object.geometry.attributes.position.count;i++){object.getVertexPosition(i,p).applyMatrix4(object.matrixWorld);this.root.worldToLocal(p);surface=Math.min(surface,p.y);}}});
   r.pose.position.y+=Math.max(0,.003-surface)*smooth(1,1.2,t);this.root.updateWorldMatrix(true,true);
  }
  // 武器从原握持位置松落到身侧，不再悬在胸前或插入腰部。
  const drop=smooth(.16,.78,t);
  const gunLocal=this.gunP.clone().lerp(new THREE.Vector3(-this.side*.63,.065,-.16),drop);
  const gunWorld=this.root.localToWorld(gunLocal);r.gun.position.copy(r.pose.worldToLocal(gunWorld));
  q.copy(this.gunQ).slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-this.side*.35,Math.PI/2)),drop);
  q.premultiply(this.root.getWorldQuaternion(parentQ));r.pose.getWorldQuaternion(parentQ).invert();r.gun.quaternion.copy(parentQ.multiply(q));
  r.gun.visible=true;
  // 静止后缓存最终姿态；手机无需持续求解六具尸体的 IK。
  if(t>=1.25)this.settled={joints:r.joints.map(j=>({p:j.position.clone(),q:j.quaternion.clone()})),p:r.pose.position.clone(),q:r.pose.quaternion.clone(),gunP:r.gun.position.clone(),gunQ:r.gun.quaternion.clone()};
  return Math.min(1,t/1.12);
 }
}
