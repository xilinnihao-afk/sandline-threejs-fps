import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets,createClassicArmsFrame} from '../src/render/classicAk';
import {ClassicArmContinuation} from '../src/render/classicArmContinuation';

function meshVertices(mesh:THREE.Mesh){
  const positions=mesh.geometry.getAttribute('position');
  return Array.from({length:positions.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld));
}

test('elbow continuation preserves source skin and UV seams with outward winding under reflected or ordinary parents',async()=>{
  const [ak,arms]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(name=>loadCPU(`public/assets/runtime/${name}.glb`)));
  prepareClassicAkAssets(ak.scene,arms.scene);
  const scene=new THREE.Scene(),view=new THREE.Group();view.position.set(.22,-.27,-.64);scene.add(view);
  const frame=createClassicArmsFrame();view.add(frame.group);
  const aspect=844/390,camera=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(1/aspect)),aspect,.02,5);scene.add(camera);scene.updateMatrixWorld(true);
  const sourceMeshes:THREE.SkinnedMesh[]=[],sourceBones:THREE.Object3D[]=[];
  frame.model.traverse(o=>{if(o instanceof THREE.SkinnedMesh)sourceMeshes.push(o);if(o instanceof THREE.Bone)sourceBones.push(o);});
  const originalGeometry=sourceMeshes.map(mesh=>({mesh,index:Array.from(mesh.geometry.index!.array),attributes:Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name,attr])=>[name,Array.from(attr.array)])),material:mesh.material}));
  const originalBoneLocals=sourceBones.map(bone=>({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
  // Both parents represent exactly the same world-space extension. Their
  // opposite determinant requires opposite local triangle winding.
  const reflected=new ClassicArmContinuation(frame.model,frame.group,camera);
  const ordinary=new ClassicArmContinuation(frame.model,scene,camera);
  scene.updateMatrixWorld(true);reflected.update();ordinary.update();scene.updateMatrixWorld(true);
  assert.ok(reflected.group.matrixWorld.determinant()<0);
  assert.ok(ordinary.group.matrixWorld.determinant()>0);
  const reflectedMeshes=reflected.group.children as THREE.Mesh[],ordinaryMeshes=ordinary.group.children as THREE.Mesh[];
  assert.equal(reflectedMeshes.length,2);
  let totalTriangles=0;
  for(const[side,sourceName]of ['Object_12','Object_8'].entries()){
    const source=frame.model.getObjectByName(sourceName) as THREE.SkinnedMesh;source.skeleton.update();
    const sourcePoints=Array.from({length:source.geometry.getAttribute('position').count},(_,i)=>source.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(source.matrixWorld));
    const sourceUv=source.geometry.getAttribute('uv');
    const first=meshVertices(reflectedMeshes[side]),second=meshVertices(ordinaryMeshes[side]);
    assert.equal(first.length,108);
    first.forEach((p,i)=>assert.ok(p.distanceTo(second[i])<2e-7,'parent reflection changes world-space shape'));
    for(const mesh of [reflectedMeshes[side],ordinaryMeshes[side]]){
      assert.equal(mesh.material,source.material,'continuation must reuse the exact skin material');
      assert.equal(mesh instanceof THREE.SkinnedMesh,false);
      const positions=mesh.geometry.getAttribute('position'),uv=mesh.geometry.getAttribute('uv'),index=mesh.geometry.index!;
      assert.equal(index.count/3,96);if(mesh===reflectedMeshes[side])totalTriangles+=index.count/3;
      const points=meshVertices(mesh),centers=Array.from({length:9},(_,row)=>{
        const center=new THREE.Vector3();for(let edge=0;edge<6;edge++)center.add(points[edge*18+row*2]).add(points[edge*18+row*2+1]);return center.multiplyScalar(1/12);
      });
      for(let edge=0;edge<6;edge++)for(let endpoint=0;endpoint<2;endpoint++){
        const at=edge*18+endpoint;
        const matching=sourcePoints.flatMap((p,i)=>p.distanceTo(points[at])<2e-7?[i]:[]);
        assert.ok(matching.length>0,'seam row is detached from the actual skinned boundary');
        assert.ok(matching.some(i=>Math.abs(uv.getX(at)-sourceUv.getX(i))<1e-7&&Math.abs(uv.getY(at)-sourceUv.getY(i))<1e-7),'UV seam does not use its authored edge values');
      }
      for(let i=0;i<uv.count;i++)assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>.75&&uv.getY(i)<=1,'extension samples the glove stripe or crosses the skin atlas edge');
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<index.count;i+=3){
        const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],row=Math.floor(i/6)%8;
        const [a,b,c]=ids.map(id=>new THREE.Vector3().fromBufferAttribute(positions,id));
        const normal=new THREE.Vector3().crossVectors(b.sub(a),c.sub(a)).applyMatrix3(normalMatrix).normalize();
        const centroid=ids.reduce((sum,id)=>sum.add(points[id]),new THREE.Vector3()).multiplyScalar(1/3);
        const axis=new THREE.Line3(centers[row],centers[row+1]),center=axis.closestPointToPoint(centroid,true,new THREE.Vector3());
        const radialDot=normal.dot(centroid.sub(center));
        assert.ok(radialDot>1e-4,`extension has an inward or degenerate strip face: ${mesh.name}, parent determinant ${mesh.matrixWorld.determinant()}, triangle ${i/3}, row ${row}, radial dot ${radialDot}`);
      }
    }
  }
  assert.equal(totalTriangles,192);
  const frozen=reflectedMeshes.map(mesh=>Array.from(mesh.geometry.getAttribute('position').array));
  const terminals=reflected.terminalPoints.map(points=>points.map(p=>p.clone()));
  for(let iteration=0;iteration<10;iteration++)reflected.update();
  reflectedMeshes.forEach((mesh,side)=>assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array),frozen[side],'stationary extension drifts'));
  reflected.terminalPoints.forEach((points,side)=>points.forEach((p,i)=>assert.ok(p.distanceTo(terminals[side][i])<1e-10)));
  assert.ok(reflected.seamErrors.every(error=>error<2e-7));
  assert.ok(reflected.terminalNdcMaxY.every(y=>y<=-1.199));
  originalGeometry.forEach(({mesh,index,attributes,material})=>{
    assert.equal(mesh.material,material);assert.deepEqual(Array.from(mesh.geometry.index!.array),index);
    for(const[name,array]of Object.entries(attributes))assert.deepEqual(Array.from(mesh.geometry.getAttribute(name).array),array,`source ${mesh.name}.${name} mutated`);
  });
  originalBoneLocals.forEach(({bone,position,quaternion,scale})=>{assert.ok(bone.position.equals(position));assert.ok(bone.quaternion.equals(quaternion));assert.ok(bone.scale.equals(scale));});
  const materials=sourceMeshes.map(mesh=>mesh.material);
  reflected.dispose();ordinary.dispose();
  assert.equal(reflected.group.parent,null);assert.equal(ordinary.group.parent,null);
  sourceMeshes.forEach((mesh,i)=>assert.equal(mesh.material,materials[i]));
});
