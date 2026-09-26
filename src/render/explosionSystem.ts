import * as THREE from 'three';

/** 可调参数：时间单位秒，长度单位米。粒子上限包含闪光、火球、环与碎片。 */
export interface ExplosionOptions {
  duration:number; scale:number; lightIntensity:number; lightDistance:number;
  shakeStrength:number; shakeRadius:number; maxConcurrent:number;
}
export const EXPLOSION_DEFAULTS:Readonly<ExplosionOptions>={
  duration:1,scale:1.8,lightIntensity:240,lightDistance:15,
  shakeStrength:.11,shakeRadius:18,maxConcurrent:2,
};
const ELEMENTS_PER_BURST=34; // 1 闪光 + 4 火球 + 1 环 + 10 烟团 + 18 碎片/火星。
type Puff={sprite:THREE.Sprite;angle:number;radius:number;seed:number};
type Fragment={velocity:THREE.Vector3;spin:number;spark:boolean;};
type Burst={root:THREE.Group;age:number;flash:THREE.Sprite;fire:Puff[];smoke:Puff[];
 ring:THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>;fragments:THREE.InstancedMesh;
 debris:Fragment[];light:THREE.PointLight;cover:number;
 geometries:Set<THREE.BufferGeometry>;materials:Set<THREE.Material>;textures:Set<THREE.Texture>};

/** 小尺寸程序纹理：无外部资源请求；噪声打散圆形轮廓，避免实心圆盘。 */
function cloudTexture(cloud:boolean):THREE.DataTexture{
 const size=64,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1,r=Math.hypot(u,v);
  const noise=.72+.16*Math.sin(u*13+Math.sin(v*9))+.12*Math.sin(v*19-u*7);
  const alpha=Math.max(0,1-r/(cloud?noise:1));const i=(y*size+x)*4;
  data[i]=data[i+1]=data[i+2]=255;
  data[i+3]=Math.round(255*Math.pow(alpha,cloud?.65:1.8));
 }
 const texture=new THREE.DataTexture(data,size,size);texture.needsUpdate=true;
 texture.minFilter=texture.magFilter=THREE.LinearFilter;return texture;
}

/** 仅处理表现；spawn 不造成伤害、不修改角色状态，也不改相机旋转。 */
export class ExplosionSystem {
 readonly root=new THREE.Group();readonly options:ExplosionOptions;
 private bursts:Burst[]=[];private seed=21;private dummy=new THREE.Object3D();
 private cameraPosition=new THREE.Vector3();private offset=new THREE.Vector3();
 constructor(options:Partial<ExplosionOptions>={}){
  const values={...EXPLOSION_DEFAULTS,...options};
  for(const key of Object.keys(values) as (keyof ExplosionOptions)[]){
   if(!Number.isFinite(values[key]))values[key]=EXPLOSION_DEFAULTS[key];
  }
  this.options={...values,duration:THREE.MathUtils.clamp(values.duration,.5,1.5),scale:Math.max(.1,values.scale),
   lightIntensity:Math.max(0,values.lightIntensity),lightDistance:Math.max(.1,values.lightDistance),shakeStrength:Math.max(0,values.shakeStrength),
   maxConcurrent:THREE.MathUtils.clamp(Math.floor(values.maxConcurrent),1,2)};
  this.root.name='five-layer-explosions';
 }
 private random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 spawn(position:THREE.Vector3,occluded=false):void{
  if(!position.toArray().every(Number.isFinite))return;
  // 超出预算时先完整释放最旧爆炸，而不是无限增加粒子和灯光。
  while(this.bursts.length>=this.options.maxConcurrent)this.release(this.bursts.shift()!);
  const root=new THREE.Group();root.position.copy(position);root.scale.setScalar(this.options.scale);this.root.add(root);
  const textures=new Set<THREE.Texture>(),materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>();
  const soft=cloudTexture(false),cloud=cloudTexture(true);textures.add(soft);textures.add(cloud);
  const sprite=(map:THREE.Texture,color:number,additive:boolean)=>{
   const material=new THREE.SpriteMaterial({map,color,transparent:true,depthWrite:false,
    blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,toneMapped:!additive});
   materials.add(material);const s=new THREE.Sprite(material);root.add(s);return s;
  };
  const flash=sprite(soft,0xfff2cd,true);
  const puffs=(count:number,fire:boolean):Puff[]=>Array.from({length:count},(_,i)=>({
   sprite:sprite(cloud,fire?0xffa13b:0x514b43,fire),angle:i/count*Math.PI*2+this.random()*.5,
   radius:.15+this.random()*.5,seed:this.random(),
  }));
  const fire=puffs(4,true),smoke=puffs(10,false);
  const ringGeo=new THREE.RingGeometry(.84,1,48),ringMat=new THREE.MeshBasicMaterial({color:0xe1c29a,
   transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false});
  geometries.add(ringGeo);materials.add(ringMat);
  const ring=new THREE.Mesh(ringGeo,ringMat);ring.rotation.x=-Math.PI/2;ring.position.y=.015;root.add(ring);
  // 18 个碎片/火星用同一个 PlaneGeometry 和一次实例绘制。
  const plane=new THREE.PlaneGeometry(1,1),mat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,side:THREE.DoubleSide});
  geometries.add(plane);materials.add(mat);
  const fragments=new THREE.InstancedMesh(plane,mat,18);fragments.frustumCulled=false;
  fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(fragments);
  const debris=Array.from({length:18},(_,i)=>{
   const a=this.random()*Math.PI*2,speed=3+this.random()*5,spark=i<12;
   fragments.setColorAt(i,new THREE.Color(spark?0xffb547:0x39322a));
   return {velocity:new THREE.Vector3(Math.cos(a)*speed,1+this.random()*5,Math.sin(a)*speed),spin:this.random()*6,spark};
  });
  const light=new THREE.PointLight(0xffba70,0,this.options.lightDistance,2);light.castShadow=false;light.position.y=.3;root.add(light);
  const burst={root,age:0,flash,fire,smoke,ring,fragments,debris,light,cover:occluded?.3:1,geometries,materials,textures};
  this.bursts.push(burst);
  // 首帧隐藏未初始化的实例，避免集中在原点的大方片。
  for(let i=0;i<18;i++)fragments.setMatrixAt(i,new THREE.Matrix4().makeScale(0,0,0));
  this.animate(burst,new THREE.Quaternion());
 }
 private animate(b:Burst,cameraQuaternion:THREE.Quaternion){
  const t=b.age/this.options.duration;
  b.flash.material.opacity=Math.max(0,1-t/.075)**2;b.flash.scale.setScalar(.6+Math.min(t/.075,1)*2.3);
  b.flash.visible=t<.075;
  b.fire.forEach((p,i)=>{
   const age=Math.max(0,t-i*.012),life=Math.max(0,1-age/.52);
   p.sprite.visible=t<.56;p.sprite.material.opacity=Math.sqrt(life)*.9;
   p.sprite.position.set(Math.cos(p.angle)*age*1.5,.14+age*(1.3+p.seed),Math.sin(p.angle)*age*1.5);
   p.sprite.scale.setScalar(.4+Math.sin(Math.min(1,age/.52)*Math.PI*.65)*(1.5+p.seed));
   p.sprite.material.color.setRGB(1,.12+life*.32,.015+life*.05);
   p.sprite.material.rotation=p.angle+age*.5;
  });
  b.ring.visible=t<.42;b.ring.scale.setScalar(.18+Math.min(1,t/.42)*4.1);
  b.ring.material.opacity=.8*Math.max(0,1-t/.42)**1.5;
  b.smoke.forEach((p,i)=>{
   const delay=.06+i*.014,age=Math.max(0,(t-delay)/(1-delay));
   p.sprite.visible=t>=delay;p.sprite.material.opacity=Math.min(1,age/.12)*(1-age)**1.1*.95;
   const spread=p.radius*(.4+age*1.6);
   p.sprite.position.set(Math.cos(p.angle)*spread,.12+age*(1.6+p.seed*1.5),Math.sin(p.angle)*spread);
   p.sprite.scale.setScalar(.35+age*(1.6+p.seed));p.sprite.material.rotation=p.angle+age*.3;
  });
  const flight=Math.min(t,.8),travel=(1-Math.exp(-2.2*flight))/2.2;
  b.debris.forEach((p,i)=>{
   this.dummy.position.copy(p.velocity).multiplyScalar(travel);this.dummy.position.y=Math.max(.025,this.dummy.position.y-4.9*flight*flight);
   this.dummy.quaternion.copy(cameraQuaternion);this.dummy.rotateZ(p.spin+t*8);
   const fade=Math.max(0,1-t/(p.spark?.55:.85));
   this.dummy.scale.set(p.spark?.018:.045,p.spark?.12:.035,1).multiplyScalar(fade);this.dummy.updateMatrix();b.fragments.setMatrixAt(i,this.dummy.matrix);
  });
  b.fragments.instanceMatrix.needsUpdate=true;
  // 无阴影局部点光，快速指数衰减；烟雾阶段不再持续照亮场景。
  b.light.intensity=t<.28?this.options.lightIntensity*Math.exp(-t*24):0;
 }
 update(dt:number,camera:THREE.Camera):void{
  const step=Number.isFinite(dt)?Math.max(0,dt):0;
  for(let i=this.bursts.length-1;i>=0;i--){const b=this.bursts[i];b.age+=step;
   if(b.age>=this.options.duration){this.bursts.splice(i,1);this.release(b);}else this.animate(b,camera.quaternion);
  }
 }
 /** 在 FPS 控制器写入本帧基础位置之后调用；返回位移，不改 yaw/pitch/quaternion。 */
 getShakeOffset(camera:THREE.Camera,out:THREE.Vector3):THREE.Vector3{
  out.set(0,0,0);camera.getWorldPosition(this.cameraPosition);
  for(const b of this.bursts){
   const t=b.age/this.options.duration,d=this.cameraPosition.distanceTo(b.root.position);
   const amplitude=this.options.shakeStrength*Math.max(0,1-d/Math.max(.1,this.options.shakeRadius))**2*Math.max(0,1-t/.55)**2*b.cover;
   this.offset.set(Math.sin(t*157),Math.sin(t*193+1),Math.sin(t*139+2)).multiplyScalar(amplitude);out.add(this.offset);
  }
  return out.clampLength(0,Math.max(0,this.options.shakeStrength));
 }
 private release(b:Burst):void{
  b.root.removeFromParent();b.fragments.dispose();b.light.dispose();
  // 只释放本次拥有的资源。Sprite 的内部几何体由 Three.js 共享，不擅自释放。
  b.geometries.forEach(g=>g.dispose());b.materials.forEach(m=>m.dispose());b.textures.forEach(t=>t.dispose());b.root.clear();
 }
 reset():void{for(const b of this.bursts)this.release(b);this.bursts.length=0;}
 dispose():void{this.reset();this.root.removeFromParent();}
 diagnostics(){return {active:this.bursts.length,particles:this.bursts.length*ELEMENTS_PER_BURST,lights:this.bursts.length,duration:this.options.duration};}
}
