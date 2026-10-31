import * as THREE from 'three';

/** Retarget only the current instance's selected bare forearm. The hand, its
 * bones, and the six-vertex glove seam retain the exact posed source shape.
 * Call after posing the hands and before ClassicArmContinuation.update(). */
export class ClassicKnifeForearm {
  readonly wristSeamErrors:number[]=[];
  readonly sectionShapeErrors=[0,0,0];
  readonly wristPoint=new THREE.Vector3();
  readonly elbowPoint=new THREE.Vector3();
  readonly sectionCenters=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  /** Original wrist-bone-to-elbow-ring distance, in world metres. */
  sourceLength=0;
  lengthError=0;
  private readonly source:THREE.SkinnedMesh;
  private readonly wrist:THREE.Object3D;
  private readonly originalGeometry:THREE.BufferGeometry;
  private readonly geometry:THREE.BufferGeometry;
  private readonly originalPosition:THREE.BufferAttribute;
  private readonly originalNormal:THREE.BufferAttribute|undefined;
  private readonly rings:number[][];
  private readonly vertexRings:number[];
  private readonly joint:number;
  private readonly originalWorld:THREE.Vector3[];
  private readonly actualWorld:THREE.Vector3[];
  private readonly centers=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  private readonly fromSource=new THREE.Matrix4();
  private readonly toSource=new THREE.Matrix4();
  private readonly normalToWorld=new THREE.Matrix3();
  private readonly normalToSource=new THREE.Matrix3();
  private readonly originalAxis=new THREE.Vector3();
  private readonly targetAxis=new THREE.Vector3();
  private readonly cameraRotation=new THREE.Quaternion();
  private readonly swing=new THREE.Quaternion();
  private readonly rotation=new THREE.Quaternion();
  private readonly sectionRotations=[new THREE.Quaternion(),new THREE.Quaternion(),new THREE.Quaternion()];
  private readonly work=new THREE.Vector3();
  private active=false;
  private disposed=false;

  constructor(private readonly model:THREE.Object3D,private readonly camera:THREE.Camera,private readonly side:'right'|'left'='right'){
    const source=model.getObjectByName(side==='right'?'Object_8':'Object_12'),wrist=model.getObjectByName(side==='right'?'Bone_Lefthand_39':'Bone_Righthand_16');
    if(!(source instanceof THREE.SkinnedMesh)||!wrist)throw new Error('Missing CS16 right forearm or wrist');
    this.source=source;this.wrist=wrist;this.originalGeometry=source.geometry;
    const position=source.geometry.getAttribute('position'),normal=source.geometry.getAttribute('normal');
    if(!(position instanceof THREE.BufferAttribute)||normal&&!(normal instanceof THREE.BufferAttribute))throw new Error('Unexpected interleaved CS16 forearm');
    this.originalPosition=position.clone();this.originalNormal=normal?.clone();
    const joints=source.geometry.getAttribute('skinIndex'),weights=source.geometry.getAttribute('skinWeight');
    this.joint=joints.getX(0);
    for(let i=0;i<position.count;i++){
      if(joints.getX(i)!==this.joint||weights.getX(i)!==1||weights.getY(i)!==0||weights.getZ(i)!==0||weights.getW(i)!==0)
        throw new Error('CS16 bare forearm must remain rigidly weighted to one joint');
    }
    this.originalWorld=Array.from({length:position.count},()=>new THREE.Vector3());
    this.actualWorld=Array.from({length:position.count},()=>new THREE.Vector3());
    this.flushSource();this.sampleOriginal();
    const topology=this.findRings();this.rings=topology.rings;this.vertexRings=topology.vertexRings;
    this.wristSeamErrors=this.rings[0].map(()=>0);
    // SkeletonUtils clones still share geometry. Only this mesh instance gets
    // writable buffers; every other hand, firearm and downloaded source stays intact.
    this.geometry=this.originalGeometry.clone();
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (this.geometry.getAttribute('normal') as THREE.BufferAttribute|undefined)?.setUsage(THREE.DynamicDrawUsage);
    this.source.geometry=this.geometry;
    this.update(false);
  }

  private flushSource(){
    this.model.updateWorldMatrix(true,true);this.model.updateMatrixWorld(true);
    this.source.skeleton.update();this.camera.updateWorldMatrix(true,false);
    // All source vertices have exactly one weight. This is the exact affine
    // transform used by SkinnedMesh.getVertexPosition, including reflected parents.
    this.fromSource.copy(this.source.matrixWorld).multiply(this.source.bindMatrixInverse)
      .multiply(this.source.skeleton.bones[this.joint].matrixWorld)
      .multiply(this.source.skeleton.boneInverses[this.joint]).multiply(this.source.bindMatrix);
    this.toSource.copy(this.fromSource).invert();
    this.normalToWorld.getNormalMatrix(this.fromSource);this.normalToSource.copy(this.normalToWorld).invert();
    this.wrist.getWorldPosition(this.wristPoint);
  }

  private sampleOriginal(){
    this.originalWorld.forEach((point,i)=>point.fromBufferAttribute(this.originalPosition,i).applyMatrix4(this.fromSource));
  }

  private findRings():{rings:number[][];vertexRings:number[]}{
    const index=this.originalGeometry.index;if(!index)throw new Error('CS16 forearm must retain source indices');
    const welded:THREE.Vector3[]=[],representatives:number[]=[],remap:number[]=[],lookup=new Map<string,number>();
    this.originalWorld.forEach((point,i)=>{
      const key=point.toArray().map(n=>Math.round(n/1e-6)).join(',');let id=lookup.get(key);
      if(id===undefined){id=welded.length;lookup.set(key,id);welded.push(point.clone());representatives.push(i);}remap.push(id);
    });
    const edges=new Map<string,{a:number;b:number;count:number}>();
    for(let i=0;i<index.count;i+=3)for(let edge=0;edge<3;edge++){
      const a=remap[index.getX(i+edge)],b=remap[index.getX(i+(edge+1)%3)],key=a<b?`${a}:${b}`:`${b}:${a}`,found=edges.get(key);
      if(found)found.count++;else edges.set(key,{a,b,count:1});
    }
    const neighbors=new Map<number,number[]>();
    for(const edge of edges.values())if(edge.count===1){
      neighbors.set(edge.a,[...(neighbors.get(edge.a)??[]),edge.b]);neighbors.set(edge.b,[...(neighbors.get(edge.b)??[]),edge.a]);
    }
    if([...neighbors.values()].some(n=>n.length!==2))throw new Error('CS16 forearm boundaries must be closed rings');
    const loops:number[][]=[],visited=new Set<number>();
    for(const first of neighbors.keys()){
      if(visited.has(first))continue;const loop:number[]=[];let previous=-1,current=first;
      do{loop.push(current);visited.add(current);const next=neighbors.get(current)!.find(n=>n!==previous)!;previous=current;current=next;}while(current!==first&&!visited.has(current));
      if(current!==first)throw new Error('CS16 forearm boundary does not close');loops.push(loop);
    }
    const center=(ids:number[])=>ids.reduce((sum,i)=>sum.add(welded[i]),new THREE.Vector3()).multiplyScalar(1/ids.length);
    loops.sort((a,b)=>center(a).distanceToSquared(this.wristPoint)-center(b).distanceToSquared(this.wristPoint));
    const middle=welded.flatMap((_,i)=>visited.has(i)?[]:[i]);
    if(loops.length!==2||loops.some(loop=>loop.length!==6)||middle.length!==6)throw new Error('Expected the three original six-vertex CS16 cross-sections');
    const rows=[loops[0],middle,loops[1]],ringOf=new Map<number,number>();
    rows.forEach((ids,ring)=>ids.forEach(id=>ringOf.set(id,ring)));
    return {rings:rows.map(ids=>ids.map(id=>representatives[id])),vertexRings:remap.map(id=>ringOf.get(id)!)};
  }

  update(enabled:boolean,blend=1):void{
    if(this.disposed)return;
    const amount=enabled&&Number.isFinite(blend)?THREE.MathUtils.clamp(blend,0,1):0;
    this.flushSource();this.sampleOriginal();
    this.rings.forEach((ring,i)=>{
      this.centers[i].set(0,0,0);ring.forEach(id=>this.centers[i].add(this.originalWorld[id]));this.centers[i].multiplyScalar(1/ring.length);
    });
    this.sourceLength=this.centers[2].distanceTo(this.wristPoint);
    const position=this.geometry.getAttribute('position') as THREE.BufferAttribute,normal=this.geometry.getAttribute('normal') as THREE.BufferAttribute|undefined;
    // Always derive from immutable source attributes, never the previous frame.
    position.copyArray(this.originalPosition.array);
    if(normal&&this.originalNormal)normal.copyArray(this.originalNormal.array);
    if(amount>0){
      this.originalAxis.copy(this.centers[2]).sub(this.wristPoint).normalize();
      this.camera.getWorldQuaternion(this.cameraRotation);
      this.targetAxis.set(this.side==='right'?.55:-.60,this.side==='right'?-.42:-.50,this.side==='right'?.80:.70).normalize().applyQuaternion(this.cameraRotation);
      this.swing.setFromUnitVectors(this.originalAxis,this.targetAxis);
      this.rotation.identity().slerp(this.swing,amount);
      const middleFraction=this.centers[1].distanceTo(this.wristPoint)/this.sourceLength;
      this.sectionRotations[0].identity();
      this.sectionRotations[1].identity().slerp(this.rotation,THREE.MathUtils.smoothstep(middleFraction,0,1));
      this.sectionRotations[2].copy(this.rotation);
      this.sectionCenters[0].copy(this.centers[0]);
      for(const ring of [1,2])this.sectionCenters[ring].copy(this.centers[ring]).sub(this.wristPoint).applyQuaternion(this.rotation).add(this.wristPoint);
      for(let i=0;i<position.count;i++){
        const ring=this.vertexRings[i];if(ring===0)continue;
        this.work.copy(this.originalWorld[i]).sub(this.centers[ring]).applyQuaternion(this.sectionRotations[ring]).add(this.sectionCenters[ring]).applyMatrix4(this.toSource);
        position.setXYZ(i,this.work.x,this.work.y,this.work.z);
        if(normal&&this.originalNormal){
          this.work.fromBufferAttribute(this.originalNormal,i).applyMatrix3(this.normalToWorld).normalize()
            .applyQuaternion(this.sectionRotations[ring]).applyMatrix3(this.normalToSource).normalize();
          normal.setXYZ(i,this.work.x,this.work.y,this.work.z);
        }
      }
    }
    this.actualWorld.forEach((point,i)=>point.fromBufferAttribute(position,i).applyMatrix4(this.fromSource));
    this.rings.forEach((ring,row)=>{
      this.sectionCenters[row].set(0,0,0);ring.forEach(id=>this.sectionCenters[row].add(this.actualWorld[id]));this.sectionCenters[row].multiplyScalar(1/ring.length);
      this.sectionShapeErrors[row]=0;
      for(const a of ring)for(const b of ring)this.sectionShapeErrors[row]=Math.max(this.sectionShapeErrors[row],Math.abs(this.actualWorld[a].distanceTo(this.actualWorld[b])-this.originalWorld[a].distanceTo(this.originalWorld[b])));
    });
    this.rings[0].forEach((id,i)=>this.wristSeamErrors[i]=this.actualWorld[id].distanceTo(this.originalWorld[id]));
    this.elbowPoint.copy(this.sectionCenters[2]);this.lengthError=Math.abs(this.elbowPoint.distanceTo(this.wristPoint)-this.sourceLength);
    if(amount>0||this.active){
      position.needsUpdate=true;if(normal)normal.needsUpdate=true;
      this.geometry.computeBoundingBox();this.geometry.computeBoundingSphere();
      this.source.computeBoundingBox();this.source.computeBoundingSphere();
    }
    this.active=amount>0;
  }

  dispose():void{
    if(this.disposed)return;
    this.update(false);if(this.source.geometry===this.geometry)this.source.geometry=this.originalGeometry;
    this.geometry.dispose();this.disposed=true;
  }
}
