import {loadCPU} from './loadCharacterFixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {adaptSoldierAnimations} from '../src/render/riggedSoldier';
import {SOLDIER_MODELS,prepareRosterSoldier,SOLDIER_TEAM_ROSTER} from '../src/render/soldierRoster';
import {applyTeamUniform} from '../src/render/teamUniforms';


for(const definition of SOLDIER_MODELS)test(`${definition.id}: isolated skin retargets idle/walk/run with stable bones and bounds`,async()=>{
 const donor=await loadCPU('public/assets/characters/locomotion.glb');
 const target=prepareRosterSoldier(await loadCPU('public/assets/characters/'+definition.file),definition.id);
 const result=adaptSoldierAnimations(donor,target);
 assert.deepEqual(result.animations.map(c=>c.name),['Idle','Walk','Run']);
 assert.ok(result.scene.getObjectByName('mixamorigLeftHandIndex1'));
 const character=clone(result.scene),other=clone(result.scene);
 assert.notEqual(character.getObjectByName('mixamorigHips'),other.getObjectByName('mixamorigHips'));
 const mixer=new THREE.AnimationMixer(character),rootPosition=character.position.clone();
 const joints:THREE.Bone[]=[];character.traverse(o=>{if(o instanceof THREE.Bone)joints.push(o);});
 const lengths=joints.map(b=>b.position.length());
 let min=Infinity,max=-Infinity;
 for(const clip of result.animations){
  mixer.stopAllAction();mixer.clipAction(clip).reset().play();
  for(const progress of [0,.25,.5,.75,.99]){
   mixer.setTime(clip.duration*progress);character.updateMatrixWorld(true);
   character.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
   const box=new THREE.Box3().setFromObject(character),size=box.getSize(new THREE.Vector3());
   assert.ok(size.y>1.2&&size.y<2.2,`${clip.name}: height ${size.y}`);
   assert.ok(size.x<2.2&&size.z<2.2,`${clip.name}: skin escaped bounds`);
   min=Math.min(min,box.min.y);max=Math.max(max,box.max.y);
   for(let i=0;i<joints.length;i++){
    assert.ok(joints[i].quaternion.toArray().every(Number.isFinite));
    if(joints[i].name!=='mixamorigHips')assert.ok(Math.abs(joints[i].position.length()-lengths[i])<1e-6,'bone length changed');
   }
   assert.ok(character.position.equals(rootPosition));
  }
 }
 console.log('Retargeted soldier vertical envelope (m)',{min,max});
 assert.ok(min>-.2&&max<2.2);
});

test("team rosters cover every shipped character",()=>{
 const ids=new Set(Object.values(SOLDIER_TEAM_ROSTER).flat());
 assert.deepEqual([...ids].sort(),SOLDIER_MODELS.map(m=>m.id).sort());
});

test('active character assets stay in budget and use a mesh-free animation donor',async()=>{
 const expected=[...SOLDIER_MODELS.map(m=>m.file),'locomotion.glb'].sort();
 const files=fs.readdirSync('public/assets/characters');
 assert.deepEqual(files.filter(file=>file.endsWith('.glb')).sort(),expected,'ship only active skins and the animation-only donor');
 assert.equal(SOLDIER_TEAM_ROSTER.blue.length,4);
 assert.equal(SOLDIER_TEAM_ROSTER.red.length,3);
 let total=fs.statSync('public/assets/characters/locomotion.glb').size;
 for(const model of SOLDIER_MODELS){const bytes=fs.statSync('public/assets/characters/'+model.file).size;assert.equal(bytes,model.bytes);total+=bytes;}
 assert.ok(total<13_000_000,`character download budget exceeded: ${total}`);
 const donor=await loadCPU('public/assets/characters/locomotion.glb');
 let meshes=0;donor.scene.traverse(o=>{if(o instanceof THREE.Mesh)meshes++;});
 assert.equal(meshes,0,'animation donor must not download unused body geometry or textures');
 assert.ok(donor.scene.userData.animationDonorHeight>0);
 const blue=new Set<string>(SOLDIER_TEAM_ROSTER.blue);
 assert.ok(SOLDIER_TEAM_ROSTER.red.every(id=>!blue.has(id)),'factions must use distinct outfits');
});

for(const definition of SOLDIER_MODELS)test(`${definition.id}: source bind matrices, facing, palm basis and authored materials survive preparation`,async()=>{
 const input=await loadCPU('public/assets/characters/'+definition.file);
 const inverses:THREE.Matrix4[][]=[];
 input.scene.traverse(o=>{if(o instanceof THREE.SkinnedMesh)inverses.push(o.skeleton.boneInverses.map(m=>m.clone()));});
 const prepared=prepareRosterSoldier(input,definition.id);
 const asset=adaptSoldierAnimations(await loadCPU('public/assets/characters/locomotion.glb'),prepared);
 let index=0;
 input.scene.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.boneInverses.forEach((m,i)=>assert.ok(m.equals(inverses[index][i]),'source bind matrices must not be mutated'));index++;}});
 const position=(name:string)=>asset.scene.getObjectByName('mixamorig'+name)!.getWorldPosition(new THREE.Vector3());
 const forward=position('LeftToeBase').sub(position('LeftFoot'));
 assert.ok(forward.z<0&&Math.abs(forward.x)<Math.abs(forward.z)*.5,'feet must point toward game forward (-Z)');
 assert.ok(position('LeftArm').x<position('RightArm').x,'left shoulder must face gameplay left');
 for(const side of ['Left','Right']){
  const origin=position(side+'Hand');
  assert.ok(position(side+'HandThumb1').distanceTo(origin)<.08,'thumb pivot must stay local to the palm');
  const along=position(side+'HandMiddle1').sub(origin).normalize(),across=position(side+'HandIndex1').sub(position(side+'HandPinky1')).normalize();
  assert.ok(along.cross(across).length()>.3,'weapon IK needs a non-degenerate palm basis');
 }
 const materials=new Map<THREE.SkinnedMesh,THREE.Material|THREE.Material[]>();
 asset.scene.traverse(o=>{if(o instanceof THREE.SkinnedMesh)materials.set(o,o.material);});
 applyTeamUniform(asset.scene,definition.id,definition.id.startsWith('terrorist')?'red':'blue');
 assert.ok(materials.size>0);
 for(const [mesh,material] of materials){assert.equal(mesh.material,material);assert.equal(mesh.geometry.hasAttribute('teamClothMask'),false);}
 const data=fs.readFileSync('public/assets/characters/'+definition.file);
 const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
 assert.match(json.asset.extras.license,/CC-BY-4.0/);
 assert.ok(json.materials.every((material:any)=>material.pbrMetallicRoughness?.baseColorTexture||material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture||/7_mesh1/.test(material.name)),'all authored outfit textures must be present');
});
