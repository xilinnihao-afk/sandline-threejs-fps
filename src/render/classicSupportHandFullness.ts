import * as THREE from 'three';

interface SkinFrame {
 toWrist:THREE.Matrix4;fromWrist:THREE.Matrix4;
 normalToWrist:THREE.Matrix3;normalFromWrist:THREE.Matrix3;
}
interface Shell {
 mesh:THREE.SkinnedMesh;geometry:THREE.BufferGeometry;
 position:THREE.BufferAttribute;normal:THREE.BufferAttribute|undefined;
 joints:number[];frames:Map<number,SkinFrame>;forearm:boolean;
}
interface FingerSection {bone:THREE.Bone;localStart:THREE.Vector3;localEnd:THREE.Vector3;start:THREE.Vector3;end:THREE.Vector3;direction:THREE.Vector3;lengthSq:number}

const WIDTH=.14,DEPTH=.18,WRIST_WIDTH=.26,WRIST_DEPTH=.30,TAPER_START=.06,TAPER_END=.20;

/** Knife-only fullness on the free hand, in a common physical wrist frame.
 * Glove, exposed fingers and wrist share one continuous deformation, so
 * their source seams stay joined despite belonging to different skin joints.
 * The forearm fades back to its original elbow, retaining its length and the
 * continuation's attachment. Bones, UVs, skin weights and right hand are exact.
 * Call reset() before posing the forearm, then apply() after its deformation. */
export class ClassicSupportHandFullness {
 private readonly wrist:THREE.Object3D;
 private readonly shells:Shell[];
 private readonly fingerSections:FingerSection[];
 private readonly wristFrame=new THREE.Matrix4();
 private readonly wristInverse=new THREE.Matrix4();
 private readonly point=new THREE.Vector3();
 private readonly normal=new THREE.Vector3();
 private readonly jacobian=new THREE.Matrix3();
 private readonly normalDeformation=new THREE.Matrix3();
 private readonly plus=new THREE.Vector3();
 private readonly minus=new THREE.Vector3();
 private readonly dx=new THREE.Vector3();
 private readonly dy=new THREE.Vector3();
 private readonly dz=new THREE.Vector3();
 private active=false;

 constructor(private readonly model:THREE.Object3D){
  const wrist=model.getObjectByName('Bone_Righthand_16');
  if(!wrist)throw new Error('Missing CS16 support wrist');this.wrist=wrist;
  this.shells=['Object_11','Object_12','Object_13'].map(name=>{
   const mesh=model.getObjectByName(name);
   if(!(mesh instanceof THREE.SkinnedMesh))throw new Error('Missing CS16 support shell '+name);
   const forearm=name==='Object_12';
   // The forearm already owns a writable clone through ClassicKnifeForearm.
   // Isolate the two remaining shells from every firearm/source instance.
   if(!forearm)mesh.geometry=mesh.geometry.clone();
   const geometry=mesh.geometry,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
   if(!(p instanceof THREE.BufferAttribute)||n&&!(n instanceof THREE.BufferAttribute))throw new Error('Unexpected interleaved CS16 support shell');
   const indices=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
   const joints:number[]=[],frames=new Map<number,SkinFrame>();
   for(let i=0;i<p.count;i++){
    if(weights.getX(i)!==1||weights.getY(i)!==0||weights.getZ(i)!==0||weights.getW(i)!==0)throw new Error('CS16 support shell must retain rigid per-vertex skin weights');
    const joint=indices.getX(i);joints.push(joint);
    if(!frames.has(joint))frames.set(joint,{toWrist:new THREE.Matrix4(),fromWrist:new THREE.Matrix4(),normalToWrist:new THREE.Matrix3(),normalFromWrist:new THREE.Matrix3()});
   }
   p.setUsage(THREE.DynamicDrawUsage);n?.setUsage(THREE.DynamicDrawUsage);
   return {mesh,geometry,position:p.clone(),normal:n?.clone(),joints,frames,forearm};
  });
  // Measure each segment's actual shell centre, including glove and bare
  // skin. Inflating about these centres fills the digits instead of moving
  // their centres away from one another with another whole-hand scale.
  const names=new Set(['Bone27_2','Bone28_1','Bone29_0','Bone31_5','Bone32_4','Bone33_3','Bone35_8','Bone36_7','Bone37_6','Bone39_11','Bone40_10','Bone41_9','Bone43_14','Bone44_13','Bone45_12']);
  const bounds=new Map<THREE.Bone,THREE.Box3>();model.updateMatrixWorld(true);
  for(const shell of this.shells){if(shell.forearm)continue;shell.mesh.skeleton.update();
   for(let i=0;i<shell.joints.length;i++){
    const bone=shell.mesh.skeleton.bones[shell.joints[i]];if(!names.has(bone.name))continue;
    const box=bounds.get(bone)??new THREE.Box3();bounds.set(bone,box);
    shell.mesh.getVertexPosition(i,this.point).applyMatrix4(shell.mesh.matrixWorld);bone.worldToLocal(this.point);box.expandByPoint(this.point);
   }
  }
  this.fingerSections=[...bounds].map(([bone,box])=>{
   const axis=['Bone27_2','Bone28_1','Bone29_0'].includes(bone.name)?'x':'y';
   const localStart=box.getCenter(new THREE.Vector3()),localEnd=localStart.clone();localStart[axis]=box.min[axis];localEnd[axis]=box.max[axis];
   return {bone,localStart,localEnd,start:new THREE.Vector3(),end:new THREE.Vector3(),direction:new THREE.Vector3(),lengthSq:0};
  });
 }

 private deformHand(x:number,y:number,z:number,out:THREE.Vector3):void{
  let weights=0,rx=0,ry=0,rz=0;
  for(const section of this.fingerSections){
   const ax=x-section.start.x,ay=y-section.start.y,az=z-section.start.z,d=section.direction;
   const t=THREE.MathUtils.clamp((ax*d.x+ay*d.y+az*d.z)/Math.max(section.lengthSq,1e-12),0,1);
   const vx=ax-d.x*t,vy=ay-d.y*t,vz=az-d.z*t,distance=vx*vx+vy*vy+vz*vz;
   const weight=Math.exp(-distance/(2*.012*.012));weights+=weight;rx+=vx*weight;ry+=vy*weight;rz+=vz*weight;
  }
  // A compact radius falloff leaves the palm/cuff outside the finger field.
  // Every shell samples this same field, including duplicated seam vertices.
  const radius=Math.hypot(x,y,z),pad=.18*Math.min(1,weights)/Math.max(weights,1e-12)*THREE.MathUtils.smoothstep(radius,.06,.09);
  const wrist=1-THREE.MathUtils.smoothstep(radius,.04,.085);
  out.set((x+rx*pad)*(1+WIDTH+(WRIST_WIDTH-WIDTH)*wrist),y+ry*pad,(z+rz*pad)*(1+DEPTH+(WRIST_DEPTH-DEPTH)*wrist));
 }

 /** Restore immutable source attributes before the arm solver runs again. */
 reset():void{
  if(!this.active)return;
  for(const shell of this.shells){
   const position=shell.geometry.getAttribute('position') as THREE.BufferAttribute;
   position.copyArray(shell.position.array);position.needsUpdate=true;
   const normal=shell.geometry.getAttribute('normal') as THREE.BufferAttribute|undefined;
   if(normal&&shell.normal){normal.copyArray(shell.normal.array);normal.needsUpdate=true;}
   shell.geometry.computeBoundingBox();shell.geometry.computeBoundingSphere();
  }
  this.active=false;
 }

 apply(enabled:boolean):void{
  if(!enabled||this.active)return;
  this.model.updateWorldMatrix(true,true);this.model.updateMatrixWorld(true);
  // Strip the source's centimetre scale but retain its reflected basis. All
  // taper distances below are metres, regardless of the imported rig scale.
  this.wristFrame.extractRotation(this.wrist.matrixWorld).setPosition(this.wrist.getWorldPosition(this.point));
  this.wristInverse.copy(this.wristFrame).invert();
  for(const section of this.fingerSections){
   section.start.copy(section.localStart);section.bone.localToWorld(section.start).applyMatrix4(this.wristInverse);
   section.end.copy(section.localEnd);section.bone.localToWorld(section.end).applyMatrix4(this.wristInverse);
   section.direction.copy(section.end).sub(section.start);section.lengthSq=section.direction.lengthSq();
  }
  for(const shell of this.shells){
   const {mesh,geometry}=shell;mesh.skeleton.update();
   for(const [joint,frame] of shell.frames){
    frame.toWrist.copy(this.wristInverse).multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
     .multiply(mesh.skeleton.bones[joint].matrixWorld).multiply(mesh.skeleton.boneInverses[joint]).multiply(mesh.bindMatrix);
    frame.fromWrist.copy(frame.toWrist).invert();
    frame.normalToWrist.getNormalMatrix(frame.toWrist);frame.normalFromWrist.copy(frame.normalToWrist).invert();
   }
   const position=geometry.getAttribute('position') as THREE.BufferAttribute,normal=geometry.getAttribute('normal') as THREE.BufferAttribute|undefined;
   for(let i=0;i<position.count;i++){
    const frame=shell.frames.get(shell.joints[i])!;
    this.point.fromBufferAttribute(position,i).applyMatrix4(frame.toWrist);
    const {x,y,z}=this.point,r=this.point.length(),t=THREE.MathUtils.clamp((r-TAPER_START)/(TAPER_END-TAPER_START),0,1);
    if(!shell.forearm){
     // Differentiate the exact common padding field, retaining the source's
     // split normals without averaging across intentionally hard skin edges.
     const e=.00002;
     this.deformHand(x+e,y,z,this.plus);this.deformHand(x-e,y,z,this.minus);this.dx.copy(this.plus).sub(this.minus).multiplyScalar(1/(2*e));
     this.deformHand(x,y+e,z,this.plus);this.deformHand(x,y-e,z,this.minus);this.dy.copy(this.plus).sub(this.minus).multiplyScalar(1/(2*e));
     this.deformHand(x,y,z+e,this.plus);this.deformHand(x,y,z-e,this.minus);this.dz.copy(this.plus).sub(this.minus).multiplyScalar(1/(2*e));
     this.jacobian.set(this.dx.x,this.dy.x,this.dz.x,this.dx.y,this.dy.y,this.dz.y,this.dx.z,this.dy.z,this.dz.z);
     this.deformHand(x,y,z,this.point);this.point.applyMatrix4(frame.fromWrist);
    }else{
    const amount=shell.forearm?1-t*t*(3-2*t):1;
    if(amount===0)continue;
    const wristT=THREE.MathUtils.clamp((r-.04)/.045,0,1),wrist=1-wristT*wristT*(3-2*wristT);
    const width=shell.forearm?WRIST_WIDTH:WIDTH+(WRIST_WIDTH-WIDTH)*wrist;
    const depth=shell.forearm?WRIST_DEPTH:DEPTH+(WRIST_DEPTH-DEPTH)*wrist;
    // J = I + amount B + (B p)(grad amount)^T. Its inverse transpose
    // transports original split normals without erasing authored hard edges.
    const gradient=shell.forearm&&t>0&&t<1?-6*t*(1-t)/((TAPER_END-TAPER_START)*r):0;
    const wristGradient=!shell.forearm&&wristT>0&&wristT<1?-6*wristT*(1-wristT)/(.045*r):0;
    const widthGradient=width*gradient+(WRIST_WIDTH-WIDTH)*wristGradient,depthGradient=depth*gradient+(WRIST_DEPTH-DEPTH)*wristGradient;
    this.jacobian.set(1+width*amount+x*x*widthGradient,x*y*widthGradient,x*z*widthGradient,
     0,1,0,z*x*depthGradient,z*y*depthGradient,1+depth*amount+z*z*depthGradient);
    this.point.set(x*(1+width*amount),y,z*(1+depth*amount)).applyMatrix4(frame.fromWrist);
    }
    position.setXYZ(i,this.point.x,this.point.y,this.point.z);
    if(normal){
     this.normalDeformation.copy(this.jacobian).invert().transpose();
     this.normal.fromBufferAttribute(normal,i).applyMatrix3(frame.normalToWrist).applyMatrix3(this.normalDeformation)
      .applyMatrix3(frame.normalFromWrist).normalize();
     normal.setXYZ(i,this.normal.x,this.normal.y,this.normal.z);
    }
   }
   position.needsUpdate=true;if(normal)normal.needsUpdate=true;
   geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.computeBoundingBox();mesh.computeBoundingSphere();
  }
  this.active=true;
 }
}
