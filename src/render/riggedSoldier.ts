import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {prepareCharacterMaterials} from './characterModelLoader';

// 【更换人物 GLB 文件名的位置】保留旧 soldier.gltf 只作为动画来源，不再显示旧模型。
export const RIGGED_SOLDIER_FILE = 'soldier_fully_rigged_character.glb';
const jointName = (name: string) => name.replace(/_0\d*$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const bonesOf = (root: THREE.Object3D) => {
  const bones = new Map<string, THREE.Bone>();
  root.traverse(o => { if (o instanceof THREE.Bone) bones.set(jointName(o.name), o); });
  return bones;
};

/** 启动时烘焙一次骨架适配；运行时仍使用原来的 AnimationMixer 和速度混合。 */
export function adaptSoldierAnimations(donor: GLTF, target: GLTF): GLTF {
  const source = clone(donor.scene), model = target.scene;
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse(o => { if(o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton); });
  for(const skeleton of skeletons) skeleton.pose();
  // 新资产朝 +Z，游戏角色朝 -Z；在视觉层统一朝向、米制高度和脚底原点。
  const normalized = new THREE.Group(); normalized.rotation.y = Math.PI; normalized.add(model);
  normalized.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(normalized), size = box.getSize(new THREE.Vector3());
  const factor = 1.81 / size.y, center = box.getCenter(new THREE.Vector3());
  normalized.scale.setScalar(factor); normalized.position.set(-center.x*factor,-box.min.y*factor,-center.z*factor);
  const scene = new THREE.Group(); scene.add(normalized); scene.updateMatrixWorld(true);
  const srcBones = bonesOf(source), dstBones = bonesOf(scene);
  const required = ['Hips','Spine2','Neck','Head',...['Left','Right'].flatMap(side=>['Arm','ForeArm','Hand','HandMiddle1','HandIndex1','HandPinky1','UpLeg','Leg','Foot','ToeBase'].map(n=>side+n))];
  for(const name of required) if(!srcBones.has('mixamorig'+name.toLowerCase())||!dstBones.has('mixamorig'+name.toLowerCase()))throw new Error(`新人物缺少 IK 关节：${name}`);
  // 统一名称，使既有握枪、脚部 IK 和受击渲染逻辑能找到相同语义的关节。
  for(const [key,bone] of dstBones) bone.name=key.startsWith('mixamorig') ? 'mixamorig'+bone.name.replace(/^mixamorig:?/i,'').replace(/_0\d*$/,'') : bone.name;
  const mixer = new THREE.AnimationMixer(source);
  const tpose = donor.animations.find(c=>c.name==='TPose');
  if(!tpose) throw new Error('动画来源缺少 TPose，不能安全适配绑定姿态');
  mixer.clipAction(tpose).play();mixer.update(0);source.updateMatrixWorld(true);
  const srcRest = new Map([...srcBones].map(([k,b])=>[k,b.getWorldQuaternion(new THREE.Quaternion()).normalize()]));
  const dstRest = new Map([...dstBones].map(([k,b])=>[k,b.getWorldQuaternion(new THREE.Quaternion()).normalize()]));
  const rest = [...dstBones.values()].map(b=>({bone:b,q:b.quaternion.clone(),p:b.position.clone(),s:b.scale.clone()}));
  const srcHip=srcBones.get('mixamorighips')!,dstHip=dstBones.get('mixamorighips')!;
  const sourceHeight=new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()).y;
  const hipBase=srcHip.getWorldPosition(new THREE.Vector3()).y,hipPosition=dstHip.position.clone();
  const clips:THREE.AnimationClip[]=[];
  for(const name of ['Idle','Walk','Run']){
    const input=donor.animations.find(c=>c.name===name);if(!input)throw new Error(`动画来源缺少 ${name}`);
    mixer.stopAllAction();const action=mixer.clipAction(input);action.reset().play();
    const frames=Math.ceil(input.duration*30)+1,times:number[]=[],tracks=new Map<string,number[]>();
    const hipValues:number[]=[];
    for(let frame=0;frame<frames;frame++){
      const time=Math.min(frame/30,input.duration);times.push(time);
      mixer.setTime(time===input.duration?Math.max(0,time-1e-6):time);source.updateMatrixWorld(true);
      for(const saved of rest){saved.bone.quaternion.copy(saved.q);saved.bone.position.copy(saved.p);saved.bone.scale.copy(saved.s);}
      scene.updateMatrixWorld(true);
      // 用世界空间“相对绑定姿态旋转”转换，不能只重命名四元数轨道。
      for(const [key,bone] of dstBones){
        const original=srcBones.get(key);if(!original)continue;
        const world=original.getWorldQuaternion(new THREE.Quaternion()).normalize()
          .multiply(srcRest.get(key)!.clone().invert()).multiply(dstRest.get(key)!);
        const parent=bone.parent!.getWorldQuaternion(new THREE.Quaternion()).normalize().invert();
        bone.quaternion.copy(parent.multiply(world)).normalize();bone.updateWorldMatrix(false,true);
        const values=tracks.get(bone.name)??[];values.push(...bone.quaternion.toArray());tracks.set(bone.name,values);
      }
      // 只保留上下步态，水平位移仍完全归现有移动/碰撞逻辑所有。
      const bob=(srcHip.getWorldPosition(new THREE.Vector3()).y-hipBase)*1.81/sourceHeight;
      const parent=dstHip.parent!;parent.updateWorldMatrix(true,false);
      const origin=parent.localToWorld(hipPosition.clone());origin.y+=bob;
      hipValues.push(...parent.worldToLocal(origin).toArray());
    }
    const output:THREE.KeyframeTrack[]=[...tracks].map(([bone,values])=>new THREE.QuaternionKeyframeTrack(bone+'.quaternion',times,values));
    output.push(new THREE.VectorKeyframeTrack(dstHip.name+'.position',times,hipValues));
    clips.push(new THREE.AnimationClip(name,input.duration,output));
  }
  mixer.stopAllAction();mixer.uncacheRoot(source);
  for(const saved of rest){saved.bone.quaternion.copy(saved.q);saved.bone.position.copy(saved.p);saved.bone.scale.copy(saved.s);}
  scene.updateMatrixWorld(true);scene.userData.importedSoldier=true;
  // 原渲染器使用厘米制 Z-up 骨盆后移；新资产以 Y-up 厘米制表示，在此预先转换位移向量。
  const worldOrigin=dstHip.parent!.worldToLocal(new THREE.Vector3());
  scene.userData.crouchHipOffset=dstHip.parent!.worldToLocal(new THREE.Vector3(0,0,.05)).sub(worldOrigin).toArray();
  return {...target,scene,scenes:[scene],animations:clips};
}

export async function loadRiggedSoldier(donor:GLTF):Promise<GLTF>{
  const loader=new GLTFLoader();
  // Three.js r160+ 不再内置旧 specular-glossiness 扩展；恢复它的 Albedo 与粗糙度。
  loader.register(parser=>({
    name:'KHR_materials_pbrSpecularGlossiness',
    async beforeRoot(){
      for(const material of parser.json.materials??[]){
        const legacy=material.extensions?.KHR_materials_pbrSpecularGlossiness;if(!legacy)continue;
        material.pbrMetallicRoughness={baseColorTexture:legacy.diffuseTexture,baseColorFactor:legacy.diffuseFactor??[1,1,1,1],metallicFactor:0,roughnessFactor:1-(legacy.glossinessFactor??1)};
      }
    },
    async afterRoot(){
      await Promise.all((parser.json.materials??[]).map(async (definition:any,index:number)=>{
        const legacy=definition.extensions?.KHR_materials_pbrSpecularGlossiness;
        if(!legacy?.specularGlossinessTexture)return;
        const [material,texture]=await Promise.all([parser.getDependency('material',index),parser.getDependency('texture',legacy.specularGlossinessTexture.index)]);
        const image=texture.image,ratio=Math.min(1,2048/Math.max(image.width,image.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
        const context=canvas.getContext('2d')!;context.drawImage(image,0,0,canvas.width,canvas.height);
        const data=context.getImageData(0,0,canvas.width,canvas.height),factor=legacy.glossinessFactor??1;
        for(let i=0;i<data.data.length;i+=4){const roughness=Math.round(255-factor*data.data[i+3]);data.data[i]=255;data.data[i+1]=roughness;data.data[i+2]=0;data.data[i+3]=255;}
        context.putImageData(data,0,0);
        const map=new THREE.CanvasTexture(canvas);map.flipY=texture.flipY;map.channel=texture.channel;map.wrapS=texture.wrapS;map.wrapT=texture.wrapT;map.offset.copy(texture.offset);map.repeat.copy(texture.repeat);map.rotation=texture.rotation;
        material.roughnessMap=map;material.roughness=1;material.needsUpdate=true;
      }));
    },
  }));
  const gltf=await loader.loadAsync(import.meta.env.BASE_URL+'assets/characters/'+RIGGED_SOLDIER_FILE);
  prepareCharacterMaterials(gltf.scene,2048);
  return adaptSoldierAnimations(donor,gltf);
}
