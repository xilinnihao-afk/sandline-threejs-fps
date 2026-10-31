import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets,createClassicArmsFrame} from '../src/render/classicAk';
import {ClassicKnifeForearm} from '../src/render/classicKnifeForearm';
import {ClassicArmContinuation} from '../src/render/classicArmContinuation';
import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';
import {WEAPON_VIEW_OFFSETS} from '../src/render/weaponFraming';
import {Simulation} from '../src/game/simulation';
import {CLASSIC_HAND_CONTACTS} from '../src/render/classicHandContacts';
import {MELEE_ATTACKS} from '../src/game/melee';

// Original fixture vertices, including the duplicated UV-seam representatives.
// These source sections are checked against real skinned positions below.
const rings=[[0,1,2,3,5,6],[8,9,12,14,15,17],[10,11,16,19,21,22]];
const vertexRing=[0,0,0,0,0,0,0,0,1,1,2,2,1,1,1,1,2,1,1,2,2,2,2,2];
function worldVertices(mesh:THREE.SkinnedMesh){
  mesh.updateMatrixWorld(true);mesh.skeleton.update();
  return Array.from({length:mesh.geometry.getAttribute('position').count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
}
function attributes(mesh:THREE.Mesh){
  return Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name,attribute])=>[name,Array.from(attribute.array)]));
}

test('knife forearm locks the glove seam, preserves section shape and length, and restores every source attribute',async()=>{
  const [ak,sourceArms]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(name=>loadCPU(`public/assets/runtime/${name}.glb`)));
  prepareClassicAkAssets(ak.scene,sourceArms.scene);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(56,16/9,.02,5),pose=new THREE.Group();
  pose.matrixAutoUpdate=false;scene.add(camera,pose);
  const frame=createClassicArmsFrame(),untouched=createClassicArmsFrame();pose.add(frame.group);scene.add(untouched.group);
  const right=frame.model.getObjectByName('Object_8') as THREE.SkinnedMesh;
  const otherRight=untouched.model.getObjectByName('Object_8') as THREE.SkinnedMesh;
  const originalGeometry=right.geometry,originalAttributes=attributes(right),originalIndex=Array.from(right.geometry.index!.array),material=right.material;
  const otherMeshes:THREE.SkinnedMesh[]=[],bones:THREE.Object3D[]=[];
  frame.model.traverse(object=>{if(object instanceof THREE.SkinnedMesh&&object!==right)otherMeshes.push(object);if(object instanceof THREE.Bone)bones.push(object);});
  const otherGeometry=otherMeshes.map(mesh=>({mesh,geometry:mesh.geometry,attributes:attributes(mesh),material:mesh.material}));
  const boneLocals=bones.map(bone=>({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
  const untouchedVertices=worldVertices(otherRight);
  const helper=new ClassicKnifeForearm(frame.model,camera);
  const continuation=new ClassicArmContinuation(frame.model,frame.group,camera);
  assert.notEqual(right.geometry,originalGeometry,'a skeleton clone still shares its source geometry until this helper isolates it');
  assert.equal(otherRight.geometry,originalGeometry);assert.equal(right.material,material);
  assert.deepEqual(attributes(right),originalAttributes);assert.deepEqual(Array.from(right.geometry.index!.array),originalIndex);
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),unit=new THREE.Vector3(1,1,1),matrix=new THREE.Matrix4();
  const weapon=createViewWeapon('knife'),actor=new Simulation(42).state.player;
  actor.weapon='knife';actor.shotTime=10;actor.moving=false;
  const rig=weapon.userData.rig,offset=WEAPON_VIEW_OFFSETS.knife,grip=new THREE.Matrix4();
  const contactInverse=new THREE.Matrix4().makeTranslation(...CLASSIC_HAND_CONTACTS.right.map(v=>-v) as [number,number,number]);
  let maxLengthError=0,maxShapeError=0,minOutwardDot=Infinity;
  for(const aspect of [844/390,4/3,390/844]){
    camera.aspect=aspect;camera.updateProjectionMatrix();
    camera.position.set(.4,-.2,.6);camera.rotation.set(.15,-.45,.07);camera.updateMatrixWorld(true);
    for(const attack of ['slash','stab'] as const)for(let frameIndex=0;frameIndex<=120;frameIndex++){
      // Drive the same authored wrist pronation as the game; a fixed ready
      // grip through the entire cut is outside the helper's live input range.
      actor.meleeAttack=attack;
      updateViewWeapon(weapon,actor,10+MELEE_ATTACKS[attack].interval*frameIndex/120,1/120);
      position.copy(rig.pivot.position);rotation.copy(rig.pivot.quaternion);
      grip.compose(rig.right.position,rig.right.quaternion,unit).multiply(contactInverse);
      pose.matrix.copy(camera.matrixWorld).multiply(matrix.makeTranslation(offset.x,offset.y,offset.z))
        .multiply(matrix.compose(position,rotation,unit)).multiply(grip);pose.updateMatrixWorld(true);
      helper.update(false);const sourceVertices=worldVertices(right),handVertices=otherMeshes.map(worldVertices);
      for(const blend of frameIndex%20===0?[.25,.5,.75,1]:[1]){
        helper.update(true,blend);const actual=worldVertices(right);
        assert.ok(helper.wristSeamErrors.every(error=>error===0));
        // Check every seam vertex, including authored duplicated UV vertices,
        // independently of the helper's exposed diagnostic values.
        for(let i=0;i<8;i++)assert.ok(actual[i].distanceTo(sourceVertices[i])<2e-12,'bare arm leaves the real glove cuff');
        const centers=rings.map(ids=>ids.reduce((sum,id)=>sum.add(actual[id]),new THREE.Vector3()).multiplyScalar(1/ids.length));
        const sourceElbow=rings[2].reduce((sum,id)=>sum.add(sourceVertices[id]),new THREE.Vector3()).multiplyScalar(1/6);
        const wrist=frame.model.getObjectByName('Bone_Lefthand_39')!.getWorldPosition(new THREE.Vector3());
        assert.ok(Math.abs(sourceElbow.distanceTo(wrist)-.257206115)<2e-8);
        assert.ok(Math.abs(centers[2].distanceTo(wrist)-sourceElbow.distanceTo(wrist))<2e-8,'original 25.72 cm forearm was stretched');
        for(const ids of rings)for(const a of ids)for(const b of ids)
          assert.ok(Math.abs(actual[a].distanceTo(actual[b])-sourceVertices[a].distanceTo(sourceVertices[b]))<5e-8,'a source cross-section was thinned or twisted apart');
        if(blend===1){
          const expected=new THREE.Vector3(.55,-.42,.80).normalize().applyQuaternion(camera.quaternion);
          assert.ok(centers[2].clone().sub(wrist).normalize().angleTo(expected)<1e-6,'elbow must extend right/down/back in the camera frame');
        }
        const index=right.geometry.index!;
        for(let i=0;i<index.count;i+=3){
          const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],a=actual[ids[0]],b=actual[ids[1]],c=actual[ids[2]];
          // The canonical source frame reflects Z. Negating the actual world
          // cross is its front-facing normal, independent of camera rotation.
          const normal=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).negate();
          assert.ok(normal.length()>1e-5,'a forearm triangle collapsed');normal.normalize();
          const centroid=a.clone().add(b).add(c).multiplyScalar(1/3),row=Math.min(...ids.map(id=>vertexRing[id]));
          const center=new THREE.Line3(centers[row],centers[row+1]).closestPointToPoint(centroid,true,new THREE.Vector3());
          const dot=normal.dot(centroid.sub(center));minOutwardDot=Math.min(minOutwardDot,dot);
          assert.ok(dot>.005,`${attack} triangle ${i/3} turns inward at frame ${frameIndex}, blend ${blend}`);
        }
        otherMeshes.forEach((mesh,i)=>worldVertices(mesh).forEach((point,j)=>assert.ok(point.distanceTo(handVertices[i][j])<2e-12,'knife helper moves a hand, finger, glove or opposite forearm')));
        maxLengthError=Math.max(maxLengthError,helper.lengthError);maxShapeError=Math.max(maxShapeError,...helper.sectionShapeErrors);
      }
      if(frameIndex%20===0){
        continuation.update();assert.ok(continuation.seamErrors[1]<1e-6,'continuation misses the deformed source elbow ring');
        assert.ok(continuation.terminalNdcMaxY[1]<-1.199);
        const frozen=attributes(right);for(let repeat=0;repeat<5;repeat++)helper.update(true);
        assert.deepEqual(attributes(right),frozen,'repeated stationary updates accumulate deformation');
        helper.update(false);assert.deepEqual(attributes(right),originalAttributes,'non-knife does not exactly restore the original attributes');
      }
    }
  }
  for(const blend of [0,NaN,-1]){helper.update(true,blend);assert.deepEqual(attributes(right),originalAttributes);}
  for(const {mesh,geometry,attributes:expected,material:expectedMaterial} of otherGeometry){
    assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,expectedMaterial);assert.deepEqual(attributes(mesh),expected);
  }
  for(const {bone,position,quaternion,scale} of boneLocals){assert.ok(bone.position.equals(position));assert.ok(bone.quaternion.equals(quaternion));assert.ok(bone.scale.equals(scale));}
  assert.deepEqual(attributes(otherRight),originalAttributes);
  worldVertices(otherRight).forEach((point,i)=>assert.ok(point.distanceTo(untouchedVertices[i])<1e-12));
  helper.update(true);helper.dispose();assert.equal(right.geometry,originalGeometry);assert.equal(right.material,material);
  assert.deepEqual(attributes(right),originalAttributes);helper.dispose();helper.update(true);
  continuation.dispose();
  console.log('Knife forearm geometry metrics',{maxLengthError,maxShapeError,minOutwardDot});
});
