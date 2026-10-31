import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {GameSnapshot} from '../game/types';

type HostageClip='Idle'|'Walk'|'Run'|'Crouch';
interface HostageRig {
 root:THREE.Group;model:THREE.Object3D;mixer:THREE.AnimationMixer;
 actions:Record<HostageClip,THREE.AnimationAction>;clip:HostageClip;
 marker:THREE.Mesh;lastX:number;lastZ:number;positioned:boolean;
}

/** Original unarmed GoldSrc civilians. Gameplay exclusively owns positions,
 * following state and rescue completion; this group only presents that state. */
export class HostageVisuals extends THREE.Group {
 private templates:GLTF[]=[];
 private preparing:Promise<void>|null=null;
 private rigs=new Map<number,HostageRig>();
 private zones=new Map<string,THREE.Group>();
 private markerGeometry=new THREE.OctahedronGeometry(.075);
 private markerMaterial=new THREE.MeshBasicMaterial({color:0xffd77a,toneMapped:false});
 private zoneMaterial=new THREE.MeshBasicMaterial({color:0x65dec2,transparent:true,opacity:.62,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
 private zoneGeometry=new THREE.RingGeometry(.965,1,56);
 private shadowGeometry=new THREE.PlaneGeometry(.85,.85);
 private shadowTexture:THREE.CanvasTexture;
 private shadowMaterial:THREE.MeshBasicMaterial;
 private elapsed=0;

 constructor(){
  super();this.name='hostage-rescue-visuals';this.visible=false;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
  const context=canvas.getContext('2d')!;
  const gradient=context.createRadialGradient(16,16,1,16,16,16);
  gradient.addColorStop(0,'rgba(10,15,14,.35)');gradient.addColorStop(.55,'rgba(10,15,14,.15)');gradient.addColorStop(1,'rgba(10,15,14,0)');
  context.fillStyle=gradient;context.fillRect(0,0,32,32);
  this.shadowTexture=new THREE.CanvasTexture(canvas);
  this.shadowMaterial=new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthWrite:false,toneMapped:false});
 }

 get ready():boolean{return this.templates.length===2;}

 async prepare():Promise<void>{
  if(this.ready)return;
  if(!this.preparing){
   this.preparing=(async()=>{
    const loader=new GLTFLoader();
    const templates=await Promise.all([1,2].map(id=>loader.loadAsync(import.meta.env.BASE_URL+`assets/hostages/hostage-${id}.glb`)));
    for(const asset of templates){
     for(const clip of ['Idle','Walk','Run','Crouch'])if(!asset.animations.some(a=>a.name===clip))throw new Error(`人质模型缺少 ${clip} 动画`);
     asset.scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      object.castShadow=false;object.receiveShadow=true;object.frustumCulled=false;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
       if(!(material instanceof THREE.MeshStandardMaterial))continue;
       material.roughness=.92;material.metalness=0;
       if(material.map){material.map.anisotropy=2;material.emissiveMap=material.map;material.emissive.setScalar(.08);}
      }
     });
    }
    this.templates=templates;
   })().finally(()=>{this.preparing=null;});
  }
  return this.preparing;
 }

 private createRig(id:number):HostageRig {
  const asset=this.templates[Math.abs(id)%this.templates.length],root=new THREE.Group(),model=clone(asset.scene);
  root.name=`civilian-hostage-${id}`;root.add(model);
  const mixer=new THREE.AnimationMixer(model),actions={} as Record<HostageClip,THREE.AnimationAction>;
  for(const name of ['Idle','Walk','Run','Crouch'] as HostageClip[]){
   actions[name]=mixer.clipAction(asset.animations.find(clip=>clip.name===name)!);
  }
  actions.Idle.play();actions.Idle.time=(id*.23)%actions.Idle.getClip().duration;mixer.update(0);
  const shadow=new THREE.Mesh(this.shadowGeometry,this.shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.position.y=.012;root.add(shadow);
  const marker=new THREE.Mesh(this.markerGeometry,this.markerMaterial);marker.position.y=1.98;root.add(marker);
  const rig={root,model,mixer,actions,clip:'Idle' as HostageClip,marker,lastX:0,lastZ:0,positioned:false};
  this.add(root);this.rigs.set(id,rig);return rig;
 }

 update(snapshot:GameSnapshot,dt:number):void {
  const rescue=snapshot.rescue;
  this.visible=snapshot.mode==='hostageRescue'&&!!rescue&&snapshot.phase!=='menu';
  if(!this.visible||!rescue)return;
  this.elapsed+=Math.max(0,Math.min(dt,.1));
  const active=new Set<number>();
  if(this.ready)for(const hostage of rescue.hostages){
   active.add(hostage.id);
   const rig=this.rigs.get(hostage.id)??this.createRig(hostage.id);
   rig.root.visible=hostage.status!=='rescued';
   if(!rig.root.visible){rig.positioned=false;continue;}
   const distance=rig.positioned?Math.hypot(hostage.x-rig.lastX,hostage.z-rig.lastZ):0;
   const speed=dt>0&&distance<2?distance/dt:0;
   rig.root.position.set(hostage.x,hostage.y,hostage.z);rig.root.rotation.y=hostage.yaw;
   const clip:HostageClip=hostage.crouched?'Crouch':hostage.moving?(speed>2.8?'Run':'Walk'):'Idle';
   if(clip!==rig.clip){
    const previous=rig.actions[rig.clip],next=rig.actions[clip];
    next.reset().play();next.crossFadeFrom(previous,.16,false);rig.clip=clip;
   }
   const action=rig.actions[clip];
   action.setEffectiveTimeScale(clip==='Walk'?THREE.MathUtils.clamp(speed/1.5,.55,1.6):clip==='Run'?THREE.MathUtils.clamp(speed/3.3,.7,1.5):1);
   rig.mixer.update(Math.max(0,Math.min(dt,.1)));
   rig.marker.position.y=(hostage.crouched?1.52:1.98)+Math.sin(this.elapsed*2+hostage.id)*.035;
   rig.marker.rotation.y=this.elapsed*.5;
   rig.marker.scale.setScalar(hostage.status==='following'?.7:1);
   rig.lastX=hostage.x;rig.lastZ=hostage.z;rig.positioned=true;
  }
  for(const [id,rig] of this.rigs)if(!active.has(id)){rig.root.visible=false;rig.positioned=false;}
  const zoneIds=new Set<string>();
  for(const zone of rescue.zones){
   zoneIds.add(zone.id);
   let marker=this.zones.get(zone.id);
   if(!marker){
    marker=new THREE.Group();marker.name=`hostage-rescue-zone-${zone.id}`;
    const ring=new THREE.Mesh(this.zoneGeometry,this.zoneMaterial);ring.rotation.x=-Math.PI/2;marker.add(ring);
    this.zones.set(zone.id,marker);this.add(marker);
   }
   marker.visible=true;marker.position.set(zone.x,zone.y+.025,zone.z);marker.scale.set(zone.radius,1,zone.radius);
  }
  for(const [id,zone] of this.zones)if(!zoneIds.has(id))zone.visible=false;
 }

 dispose():void {
  for(const rig of this.rigs.values()){rig.mixer.stopAllAction();rig.mixer.uncacheRoot(rig.model);}
  this.rigs.clear();this.zones.clear();this.clear();
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  for(const asset of this.templates)asset.scene.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;geometries.add(object.geometry);
   for(const material of Array.isArray(object.material)?object.material:[object.material]){
    materials.add(material);
    if(material instanceof THREE.MeshStandardMaterial&&material.map)textures.add(material.map);
   }
  });
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());textures.forEach(texture=>texture.dispose());
  this.markerGeometry.dispose();this.markerMaterial.dispose();this.zoneGeometry.dispose();this.zoneMaterial.dispose();
  this.shadowGeometry.dispose();this.shadowMaterial.dispose();this.shadowTexture.dispose();this.templates=[];
 }
}
