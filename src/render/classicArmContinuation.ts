import * as THREE from 'three';

interface BoundaryEdge { a:number; b:number; sourceA:number; sourceB:number }
interface ArmStrip {
  source:THREE.SkinnedMesh; wrist:THREE.Object3D;
  sourceIndices:number[]; edges:BoundaryEdge[];
  mesh:THREE.Mesh; geometry:THREE.BufferGeometry;
  points:THREE.Vector3[]; rings:THREE.Vector3[][];
  reversed:boolean;
}

const SEGMENTS=8;
const TERMINAL_MARGIN=-1.2;

/** Continue the two open CS16 elbow rings toward the body, without changing
 * any source vertex, bone, wrist pose, texture or material. The first row is
 * sampled from the actual skinned boundary after every pose update.
 *
 * `parent` may be the reflected (.03,.03,-.03) classic arms frame. Added
 * geometry is stored in that parent's frame, with its winding corrected for
 * the reflection. No new asset download, texture or shader is required. */
export class ClassicArmContinuation {
  readonly group=new THREE.Group();
  readonly seamErrors=[0,0];
  readonly terminalPoints:THREE.Vector3[][]=[[],[]];
  readonly terminalNdcMaxY=[-Infinity,-Infinity];
  private readonly strips:ArmStrip[];
  private readonly groupInverse=new THREE.Matrix4();
  private readonly cameraInverse=new THREE.Matrix4();
  private readonly start=new THREE.Vector3();
  private readonly tangent=new THREE.Vector3();
  private readonly cameraPoint=new THREE.Vector3();
  private readonly projected=new THREE.Vector3();
  private readonly end=new THREE.Vector3();
  private readonly down=new THREE.Vector3();
  private readonly controlA=new THREE.Vector3();
  private readonly controlB=new THREE.Vector3();
  private readonly curvePoint=new THREE.Vector3();
  private readonly curveTangent=new THREE.Vector3();
  private readonly previousTangent=new THREE.Vector3();
  private readonly offset=new THREE.Vector3();
  private readonly local=new THREE.Vector3();
  private readonly rotation=new THREE.Quaternion();
  private readonly stepRotation=new THREE.Quaternion();
  private readonly cameraQuaternion=new THREE.Quaternion();

  constructor(private readonly model:THREE.Object3D,parent:THREE.Object3D,private readonly camera:THREE.Camera){
    this.group.name='classic-arm-continuations';parent.add(this.group);
    this.flushSource();
    this.strips=[
      this.makeStrip('Object_12','Bone_Righthand_16','left'),
      this.makeStrip('Object_8','Bone_Lefthand_39','right'),
    ];
    this.update();
  }

  get visible(){return this.group.visible;}
  set visible(value:boolean){this.group.visible=value;}

  private flushSource(){
    // SkinnedMesh.updateMatrixWorld also refreshes bindMatrixInverse; the
    // generic updateWorldMatrix path alone does not do so in Three.js.
    this.model.updateWorldMatrix(true,true);this.model.updateMatrixWorld(true);
    this.group.updateWorldMatrix(true,false);
  }

  private makeStrip(meshName:string,wristName:string,side:string):ArmStrip {
    const source=this.model.getObjectByName(meshName),wrist=this.model.getObjectByName(wristName);
    if(!(source instanceof THREE.SkinnedMesh)||!wrist)throw new Error(`Missing CS16 ${side} forearm`);
    source.skeleton.update();
    const geometry=source.geometry,position=geometry.getAttribute('position'),index=geometry.index;
    if(!index)throw new Error('CS16 forearm must retain its indexed source topology');
    const welded:THREE.Vector3[]=[],representatives:number[]=[],remap:number[]=[],lookup=new Map<string,number>();
    for(let i=0;i<position.count;i++){
      const p=source.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(source.matrixWorld);
      const key=p.toArray().map(n=>Math.round(n/1e-6)).join(',');let id=lookup.get(key);
      if(id===undefined){id=welded.length;lookup.set(key,id);welded.push(p);representatives.push(i);}
      remap.push(id);
    }
    const edges=new Map<string,BoundaryEdge&{count:number}>();
    for(let i=0;i<index.count;i+=3)for(let k=0;k<3;k++){
      const sourceA=index.getX(i+k),sourceB=index.getX(i+(k+1)%3),a=remap[sourceA],b=remap[sourceB];
      const key=a<b?`${a}:${b}`:`${b}:${a}`,old=edges.get(key);
      if(old)old.count++;else edges.set(key,{a,b,sourceA,sourceB,count:1});
    }
    const boundary=[...edges.values()].filter(e=>e.count===1),neighbors=new Map<number,number[]>();
    for(const edge of boundary){neighbors.set(edge.a,[...(neighbors.get(edge.a)??[]),edge.b]);neighbors.set(edge.b,[...(neighbors.get(edge.b)??[]),edge.a]);}
    if([...neighbors.values()].some(v=>v.length!==2))throw new Error('CS16 elbow boundary is not a closed manifold ring');
    const loops:number[][]=[],visited=new Set<number>();
    for(const first of neighbors.keys()){
      if(visited.has(first))continue;const loop:number[]=[];let previous=-1,current=first;
      do{loop.push(current);visited.add(current);const next=neighbors.get(current)!.find(v=>v!==previous)!;previous=current;current=next;}while(current!==first&&!visited.has(current));
      if(current!==first)throw new Error('CS16 forearm boundary is open');loops.push(loop);
    }
    const wristPosition=wrist.getWorldPosition(new THREE.Vector3());
    const centre=(loop:number[])=>loop.reduce((sum,id)=>sum.add(welded[id]),new THREE.Vector3()).multiplyScalar(1/loop.length);
    loops.sort((a,b)=>centre(b).distanceToSquared(wristPosition)-centre(a).distanceToSquared(wristPosition));
    const loop=loops[0];
    if(loops.length!==2||loop.length!==6)throw new Error('Unexpected CS16 forearm topology: inspect elbow ring before extending');
    const center=centre(loop),direction=center.clone().sub(wristPosition).normalize(),normal=new THREE.Vector3();
    loop.forEach((id,i)=>normal.add(new THREE.Vector3().crossVectors(welded[id].clone().sub(center),welded[loop[(i+1)%loop.length]].clone().sub(center))));
    if(normal.dot(direction)<0)loop.reverse();
    const rimEdges=loop.map((a,i)=>{
      const b=loop[(i+1)%loop.length],edge=boundary.find(e=>e.a===a&&e.b===b||e.a===b&&e.b===a)!;
      return {a:i,b:(i+1)%loop.length,sourceA:edge.a===a?edge.sourceA:edge.sourceB,sourceB:edge.a===a?edge.sourceB:edge.sourceA};
    });
    const count=rimEdges.length*2*(SEGMENTS+1),out=new THREE.BufferGeometry();
    out.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
    const uv=new Float32Array(count*2),sourceUv=geometry.getAttribute('uv');
    rimEdges.forEach((edge,side)=>{for(let row=0;row<=SEGMENTS;row++)for(let end=0;end<2;end++){
      const original=end?edge.sourceB:edge.sourceA,at=(side*(SEGMENTS+1)*2+row*2+end)*2;
      uv[at]=sourceUv.getX(original);
      // Continue the same skin atlas within its ungloved lower strip. Exact
      // boundary UVs preserve its existing split seams; no wrap-state change.
      uv[at+1]=sourceUv.getY(original)-.18*row/SEGMENTS;
    }});
    out.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    const mesh=new THREE.Mesh(out,source.material);mesh.name=`classic-${side}-arm-continuation`;
    mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=source.renderOrder;
    this.group.add(mesh);
    const strip:ArmStrip={source,wrist,sourceIndices:loop.map(id=>representatives[id]),edges:rimEdges,mesh,geometry:out,points:loop.map(()=>new THREE.Vector3()),rings:Array.from({length:SEGMENTS+1},()=>loop.map(()=>new THREE.Vector3())),reversed:false};
    this.setIndices(strip,this.group.matrixWorld.determinant()<0);
    return strip;
  }

  private setIndices(strip:ArmStrip,reversed:boolean){
    const indices:number[]=[];
    strip.edges.forEach((_,side)=>{for(let row=0;row<SEGMENTS;row++){
      const a=side*(SEGMENTS+1)*2+row*2,b=a+1,c=a+2,d=a+3;
      if(reversed)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
    }});
    strip.geometry.setIndex(indices);strip.reversed=reversed;
  }

  update():void {
    this.flushSource();this.camera.updateWorldMatrix(true,false);
    this.groupInverse.copy(this.group.matrixWorld).invert();this.cameraInverse.copy(this.camera.matrixWorld).invert();
    this.camera.getWorldQuaternion(this.cameraQuaternion);this.down.set(0,-1,0).applyQuaternion(this.cameraQuaternion);
    const reversed=this.group.matrixWorld.determinant()<0;
    this.strips.forEach((strip,side)=>{
      strip.source.skeleton.update();
      strip.sourceIndices.forEach((index,i)=>strip.source.getVertexPosition(index,strip.points[i]).applyMatrix4(strip.source.matrixWorld));
      this.start.set(0,0,0);strip.points.forEach(p=>this.start.add(p));this.start.multiplyScalar(1/strip.points.length);
      this.tangent.copy(this.start).sub(strip.wrist.getWorldPosition(this.local)).normalize();
      this.cameraPoint.copy(this.start).applyMatrix4(this.cameraInverse);
      // Leave enough forward travel to bend a 7–8 cm-wide elbow without
      // folding the inner side of its sweep back over the seam.
      const elbowDepth=-this.cameraPoint.z;
      const depth=THREE.MathUtils.clamp(Math.min(elbowDepth*.85,elbowDepth-.12),.10,.65);
      const belowElbowY=this.cameraPoint.y-.12;
      this.projected.copy(this.cameraPoint).applyMatrix4(this.camera.projectionMatrix);
      // Keep extending outward even when the source elbow is already near a
      // side edge. Clamping X back into view would make a tight inward hook.
      const x=this.projected.x+(side===0?-.22:.22);
      this.cameraPoint.set(0,0,-depth).applyMatrix4(this.camera.projectionMatrix);
      this.end.set(x,-1.65,this.cameraPoint.z).applyMatrix4(this.camera.projectionMatrixInverse);
      // An elbow already below the viewport must continue farther down. A
      // fixed NDC target alone can bring it back up, folding the inner strip.
      this.end.y=Math.min(this.end.y,belowElbowY);
      this.end.applyMatrix4(this.camera.matrixWorld);
      this.controlA.copy(this.start).addScaledVector(this.tangent,.035);
      // A downward terminal tangent keeps the terminal ring parallel to XZ,
      // rather than facing its open cross-section toward the camera.
      for(let attempt=0;attempt<3;attempt++){
        this.controlB.copy(this.end).addScaledVector(this.down,-.09);
        this.rotation.identity();this.previousTangent.copy(this.tangent);
        for(let row=0;row<=SEGMENTS;row++){
          const t=row/SEGMENTS,s=1-t;
          this.curvePoint.copy(this.start).multiplyScalar(s*s*s).addScaledVector(this.controlA,3*s*s*t).addScaledVector(this.controlB,3*s*t*t).addScaledVector(this.end,t*t*t);
          this.curveTangent.copy(this.controlA).sub(this.start).multiplyScalar(3*s*s)
            .addScaledVector(this.offset.copy(this.controlB).sub(this.controlA),6*s*t)
            .addScaledVector(this.local.copy(this.end).sub(this.controlB),3*t*t).normalize();
          if(row){this.stepRotation.setFromUnitVectors(this.previousTangent,this.curveTangent);this.rotation.premultiply(this.stepRotation);}
          this.previousTangent.copy(this.curveTangent);
          const scale=1+.12*t*t*(3-2*t);
          strip.points.forEach((p,i)=>strip.rings[row][i].copy(p).sub(this.start).applyQuaternion(this.rotation).multiplyScalar(scale).add(this.curvePoint));
        }
        let lower=0;const projection=this.camera.projectionMatrix.elements;
        for(const point of strip.rings[SEGMENTS]){
          this.cameraPoint.copy(point).applyMatrix4(this.cameraInverse);
          const{x,y,z}=this.cameraPoint,w=projection[3]*x+projection[7]*y+projection[11]*z+projection[15];
          const clipY=projection[1]*x+projection[5]*y+projection[9]*z+projection[13];
          lower=Math.min(lower,(TERMINAL_MARGIN*w-clipY)/projection[5]);
        }
        if(lower>=-1e-7)break;
        this.end.addScaledVector(this.down,-lower+.005);
      }
      if(strip.reversed!==reversed)this.setIndices(strip,reversed);
      const positions=strip.geometry.getAttribute('position') as THREE.BufferAttribute;
      strip.edges.forEach((edge,edgeIndex)=>{for(let row=0;row<=SEGMENTS;row++)for(let end=0;end<2;end++){
        this.local.copy(strip.rings[row][end?edge.b:edge.a]).applyMatrix4(this.groupInverse);
        positions.setXYZ(edgeIndex*(SEGMENTS+1)*2+row*2+end,this.local.x,this.local.y,this.local.z);
      }});
      positions.needsUpdate=true;strip.geometry.computeVertexNormals();
      this.seamErrors[side]=0;
      strip.edges.forEach((edge,edgeIndex)=>{for(let end=0;end<2;end++){
        this.local.fromBufferAttribute(positions,edgeIndex*(SEGMENTS+1)*2+end).applyMatrix4(this.group.matrixWorld);
        this.seamErrors[side]=Math.max(this.seamErrors[side],this.local.distanceTo(strip.points[end?edge.b:edge.a]));
      }});
      this.terminalPoints[side]=strip.rings[SEGMENTS].map(p=>p.clone());
      this.terminalNdcMaxY[side]=Math.max(...this.terminalPoints[side].map(p=>p.clone().project(this.camera).y));
    });
  }

  dispose():void {this.strips.forEach(strip=>strip.geometry.dispose());this.group.removeFromParent();}
}
