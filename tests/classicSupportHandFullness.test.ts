import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets,createClassicArmsFrame} from '../src/render/classicAk';
import {ClassicKnifeForearm} from '../src/render/classicKnifeForearm';
import {ClassicSupportHandFullness} from '../src/render/classicSupportHandFullness';

const names=['Object_11','Object_12','Object_13'] as const;
function worldVertices(mesh:THREE.SkinnedMesh){
 mesh.updateMatrixWorld(true);mesh.skeleton.update();
 return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
}
function attributes(mesh:THREE.Mesh){return Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name,attribute])=>[name,Array.from(attribute.array)]));}

test('knife support fullness thickens actual hand/wrist skins with joined seams, fixed elbow and exact restoration',async()=>{
 const [ak,source]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(n=>loadCPU('public/assets/runtime/'+n+'.glb')));prepareClassicAkAssets(ak.scene,source.scene);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(56,4/3,.02,5),frame=createClassicArmsFrame(),untouched=createClassicArmsFrame();
 scene.add(camera,frame.group,untouched.group);scene.updateMatrixWorld(true);
 const meshes=names.map(name=>frame.model.getObjectByName(name) as THREE.SkinnedMesh),original=meshes.map(attributes);
 const materials=meshes.map(mesh=>mesh.material),topology=meshes.map(mesh=>Array.from(mesh.geometry.index!.array));
 const right=['Object_7','Object_8','Object_9'].map(name=>frame.model.getObjectByName(name) as THREE.SkinnedMesh),rightAttributes=right.map(attributes);
 const others=names.map(name=>untouched.model.getObjectByName(name) as THREE.SkinnedMesh),otherAttributes=others.map(attributes);
 const forearm=new ClassicKnifeForearm(frame.model,camera,'left'),fullness=new ClassicSupportHandFullness(frame.model);
 for(let i=0;i<meshes.length;i++)assert.notEqual(meshes[i].geometry,others[i].geometry,'source GLB geometry must remain shared only by untouched instances');
 const wrist=frame.model.getObjectByName('Bone_Righthand_16')!;
 const transforms:Record<string,{position:number[];quaternion:number[];scale:number[]}>= {};
 frame.model.traverse(node=>{if(node instanceof THREE.Bone)transforms[node.name]={position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()};});
 let maxSeam=0,minNormalDot=1,elbowSamples=0,seamSamples=0;
 for(const angle of [0,.22,-.30]){
  frame.group.rotation.set(angle*.4,angle,-angle*.2);camera.rotation.set(-angle*.2,angle*.6,.03);scene.updateMatrixWorld(true);
  for(let repeat=0;repeat<3;repeat++){
   fullness.reset();forearm.update(true);
   const before=meshes.map(worldVertices),wristPoint=wrist.getWorldPosition(new THREE.Vector3());
   const palmBox=new THREE.Box3().setFromPoints([...before[0],...before[2]].map(point=>wrist.worldToLocal(point.clone()))),palmSize=palmBox.getSize(new THREE.Vector3());
   // Match actual coincident source shell vertices, including UV duplicates.
   const seams:{a:number;i:number;b:number;j:number}[]=[];
   for(const [a,b] of [[0,1],[0,2]])for(let i=0;i<before[a].length;i++)for(let j=0;j<before[b].length;j++)
    if(before[a][i].distanceTo(before[b][j])<1e-6)seams.push({a,i,b,j});
   assert.ok(seams.length>=60,'real glove/wrist/finger source boundaries were not sampled');
   fullness.apply(true);const after=meshes.map(worldVertices);
   const size=new THREE.Box3().setFromPoints([...after[0],...after[2]].map(point=>wrist.worldToLocal(point.clone()))).getSize(new THREE.Vector3());
   assert.ok(size.x/palmSize.x>1.15&&size.x/palmSize.x<1.20,'hand width must stay modest while local finger pads fill out');
   assert.ok(size.z/palmSize.z>1.20&&size.z/palmSize.z<1.26,'palm and finger depth must increase beyond the former 18 percent');
   assert.ok(Math.abs(size.y/palmSize.y-1)<.02,'local padding must not stretch finger length');
   const cuff=before[1].flatMap((point,i)=>point.distanceTo(wristPoint)<.06?[i]:[]);assert.ok(cuff.length>=6);
   const cuffSize=(vertices:THREE.Vector3[])=>new THREE.Box3().setFromPoints(cuff.map(i=>wrist.worldToLocal(vertices[i].clone()))).getSize(new THREE.Vector3());
   const oldCuff=cuffSize(before[1]),newCuff=cuffSize(after[1]);
   assert.ok(Math.abs(newCuff.x/oldCuff.x-1.26)<1e-6&&Math.abs(newCuff.z/oldCuff.z-1.30)<1e-6,'bare wrist must grow with the glove cuff');
   for(const {a,i,b,j} of seams){const distance=after[a][i].distanceTo(after[b][j]);maxSeam=Math.max(maxSeam,distance);seamSamples++;assert.ok(distance<1e-6,'fuller support hand opens an authored shell seam');}
   for(let i=0;i<before[1].length;i++)if(before[1][i].distanceTo(wristPoint)>.22){elbowSamples++;assert.ok(after[1][i].distanceTo(before[1][i])<1e-8,'fuller wrist must taper out before the elbow attachment');}
   for(let shell=0;shell<meshes.length;shell++){
    const mesh=meshes[shell],index=mesh.geometry.index!,normal=mesh.geometry.attributes.normal;
    assert.deepEqual(Array.from(index.array),topology[shell]);assert.equal(mesh.material,materials[shell]);
    for(const attribute of ['uv','skinIndex','skinWeight'])assert.deepEqual(Array.from(mesh.geometry.attributes[attribute].array),original[shell][attribute]);
    for(let i=0;i<normal.count;i++){const n=new THREE.Vector3().fromBufferAttribute(normal,i);assert.ok(n.toArray().every(Number.isFinite));assert.ok(Math.abs(n.length()-1)<1e-6,'deformation must preserve unit split normals');}
    for(let i=0;i<index.count;i+=3){
     const [a,b,c]=[0,1,2].map(k=>index.getX(i+k));
     const n0=new THREE.Vector3().crossVectors(before[shell][b].clone().sub(before[shell][a]),before[shell][c].clone().sub(before[shell][a]));
     const n1=new THREE.Vector3().crossVectors(after[shell][b].clone().sub(after[shell][a]),after[shell][c].clone().sub(after[shell][a]));
     assert.ok(n1.length()>1e-6,'fullness collapsed a source triangle');const dot=n0.normalize().dot(n1.normalize());minNormalDot=Math.min(minNormalDot,dot);assert.ok(dot>.98,'fullness turned an original surface inward');
    }
   }
   const frozen=meshes.map(attributes);fullness.apply(true);meshes.forEach((mesh,i)=>assert.deepEqual(attributes(mesh),frozen[i],'repeated apply must not accumulate swelling'));
   fullness.reset();forearm.update(false);meshes.forEach((mesh,i)=>assert.deepEqual(attributes(mesh),original[i],'firearm pose must restore every original source attribute'));
   right.forEach((mesh,i)=>assert.deepEqual(attributes(mesh),rightAttributes[i],'right knife grip geometry changed'));
   others.forEach((mesh,i)=>assert.deepEqual(attributes(mesh),otherAttributes[i],'a second instance inherited the hand swelling'));
   frame.model.traverse(node=>{if(node instanceof THREE.Bone)assert.deepEqual({position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()},transforms[node.name],'fullness must not move or scale bones');});
  }
 }
 assert.ok(elbowSamples>=54);assert.ok(seamSamples>=540);
 console.log('Support hand fullness geometry',{wristWidth:1.26,wristDepth:1.30,maxSeam,minNormalDot,elbowSamples,seamSamples});
});
