import * as THREE from 'three';

/** 秒、米。duration 只控制冲击阶段；残烟拥有独立寿命。 */
export interface ExplosionOptions {
  duration:number; smokeDuration:number; scale:number; lightIntensity:number; lightDistance:number;
  shakeStrength:number; shakeRadius:number; maxConcurrent:number;
}
export type ExplosionKind='grenade'|'bomb';
export const EXPLOSION_DEFAULTS:Readonly<ExplosionOptions>={
  duration:1,smokeDuration:2.8,scale:1.8,lightIntensity:330,lightDistance:12,
  shakeStrength:.14,shakeRadius:18,maxConcurrent:2,
};
const ELEMENTS_PER_BURST=38; // 闪光 1 + 火焰 6 + 尘环 1 + 烟/贴地尘 12 + 碎片/火星 18。
const FRAGMENT_COUNT=18;
type Puff={sprite:THREE.Sprite;angle:number;radius:number;seed:number};
type Fragment={velocity:THREE.Vector3;spin:number;spark:boolean;};
type Burst={root:THREE.Group;age:number;lifetime:number;strength:number;bomb:boolean;flash:THREE.Sprite;fire:Puff[];smoke:Puff[];
 ring:THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>;fragments:THREE.InstancedMesh;
 debris:Fragment[];light:THREE.PointLight;cover:number;materials:Set<THREE.Material>};

/** 紧凑程序纹理：软边与中频空洞一起打散轮廓，不以不透明圆片叠加烟团。 */
function effectTexture(kind:'flash'|'cloud'|'smoke'|'ring'):THREE.DataTexture{
 const size=64,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1,r=Math.hypot(u,v);
  const noise=.72+.16*Math.sin(u*13+Math.sin(v*9))+.12*Math.sin(v*19-u*7);
  const edge=Math.max(0,1-r/(kind==='cloud'?noise:1));
  const pockets=.65+.35*Math.sin(u*17+v*11)*Math.sin(v*14-u*9);
  const smokeEdge=Math.max(0,1-r/(.88+.07*Math.sin(u*11+Math.sin(v*7))+.05*Math.sin(v*15-u*5)));
  const alpha=kind==='smoke'?Math.pow(smokeEdge,.65)*(.86+.14*Math.sin(u*12+v*8)*Math.sin(v*11-u*7)):
   kind==='ring'?Math.max(0,1-Math.abs(r-.82)/.17)**1.7*(.3+.7*noise)*pockets:
   Math.pow(edge,kind==='cloud'?1.25:1.8)*(kind==='cloud'?pockets:1);
  const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(255*alpha);
 }
 const texture=new THREE.DataTexture(data,size,size);texture.needsUpdate=true;
 texture.minFilter=texture.magFilter=THREE.LinearFilter;return texture;
}

/** 仅处理表现；固定双槽池，spawn/update 不创建 GPU 资源、不改变伤害或相机旋转。 */
export class ExplosionSystem {
 readonly root=new THREE.Group();readonly options:ExplosionOptions;
 private bursts:Burst[]=[];private pool:Burst[]=[];private seed=21;private dummy=new THREE.Object3D();
 private cameraPosition=new THREE.Vector3();private offset=new THREE.Vector3();private cameraQuaternion=new THREE.Quaternion();
 private textures=[effectTexture('flash'),effectTexture('cloud'),effectTexture('ring'),effectTexture('smoke')];
 private ringGeometry=new THREE.RingGeometry(.65,1,48);private planeGeometry=new THREE.PlaneGeometry(1,1);
 private disposed=false;
 constructor(options:Partial<ExplosionOptions>={}){
  const values={...EXPLOSION_DEFAULTS,...options};
  for(const key of Object.keys(values) as (keyof ExplosionOptions)[]){
   if(!Number.isFinite(values[key]))values[key]=EXPLOSION_DEFAULTS[key];
  }
  this.options={...values,duration:THREE.MathUtils.clamp(values.duration,.5,1.5),
   smokeDuration:THREE.MathUtils.clamp(values.smokeDuration,1.5,5),scale:Math.max(.1,values.scale),
   lightIntensity:Math.max(0,values.lightIntensity),lightDistance:Math.max(.1,values.lightDistance),
   shakeStrength:Math.max(0,values.shakeStrength),shakeRadius:Math.max(.1,values.shakeRadius),
   maxConcurrent:THREE.MathUtils.clamp(Math.floor(values.maxConcurrent),1,2)};
  this.root.name='layered-explosions';
  for(let i=0;i<this.options.maxConcurrent;i++)this.pool.push(this.createBurst());
 }
 private random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 private createBurst():Burst{
  const root=new THREE.Group(),materials=new Set<THREE.Material>();
  const sprite=(map:THREE.Texture,color:number,additive:boolean)=>{
   const material=new THREE.SpriteMaterial({map,color,transparent:true,depthTest:true,depthWrite:false,
    blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,toneMapped:!additive});
   materials.add(material);const s=new THREE.Sprite(material);root.add(s);return s;
  };
  const flash=sprite(this.textures[0],0xfff2cd,true);flash.name='blast-flash';
  const puffs=(count:number,fire:boolean):Puff[]=>Array.from({length:count},(_,i)=>{
   const puff=sprite(this.textures[fire?1:3],fire?0xffa13b:0x625c53,fire);
   puff.name=fire?'blast-fire':i<4?'blast-dust':'blast-smoke';
   return {sprite:puff,angle:0,radius:0,seed:0};
  });
  const fire=puffs(6,true),smoke=puffs(12,false);
  const ringMat=new THREE.MeshBasicMaterial({map:this.textures[2],color:0xc4a783,
   transparent:true,opacity:.32,side:THREE.DoubleSide,depthTest:true,depthWrite:false});materials.add(ringMat);
  const ring=new THREE.Mesh(this.ringGeometry,ringMat);ring.name='blast-pressure-dust';
  ring.rotation.x=-Math.PI/2;ring.position.y=.018;root.add(ring);
  const mat=new THREE.MeshBasicMaterial({color:0xffffff,map:this.textures[0],transparent:true,
   depthTest:true,depthWrite:false,side:THREE.DoubleSide});materials.add(mat);
  const fragments=new THREE.InstancedMesh(this.planeGeometry,mat,FRAGMENT_COUNT);fragments.frustumCulled=false;
  fragments.name='blast-fragments';fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(fragments);
  const debris=Array.from({length:FRAGMENT_COUNT},(_,i)=>{
   const spark=i<12;fragments.setColorAt(i,new THREE.Color(spark?0xffb547:0x39322a));
   return {velocity:new THREE.Vector3(),spin:0,spark};
  });
  const light=new THREE.PointLight(0xffba70,0,this.options.lightDistance,2);light.name='blast-light';
  // 小范围、短寿命且支持遮挡关闭；不申请六面动态阴影，避免移动端瞬时尖峰。
  light.castShadow=false;light.position.y=.3;root.add(light);
  return {root,age:0,lifetime:0,strength:1,bomb:false,flash,fire,smoke,ring,fragments,debris,light,cover:1,materials};
 }
 spawn(position:THREE.Vector3,occluded=false,kind:ExplosionKind='grenade'):void{
  if(this.disposed||![position.x,position.y,position.z].every(Number.isFinite))return;
  if(this.bursts.length>=this.options.maxConcurrent)this.release(this.bursts.shift()!);
  const b=this.pool.find(p=>!this.bursts.includes(p))!;
  b.age=0;b.bomb=kind==='bomb';b.strength=b.bomb?1.8:1;
  b.lifetime=b.bomb?Math.min(5.6,this.options.smokeDuration*2):this.options.smokeDuration;
  b.cover=occluded?(b.bomb?.18:.3):1;b.root.position.copy(position);b.root.scale.setScalar(this.options.scale*b.strength);
  b.light.distance=this.options.lightDistance*(b.bomb?2:1);this.root.add(b.root);
  for(const list of [b.fire,b.smoke])list.forEach((p,i)=>{
   p.angle=i/list.length*Math.PI*2+this.random()*.5;p.radius=.25+this.random()*.55;p.seed=this.random();
  });
  for(const p of b.debris){const a=this.random()*Math.PI*2,speed=3+this.random()*5;
   p.velocity.set(Math.cos(a)*speed,1+this.random()*5,Math.sin(a)*speed);p.spin=this.random()*6;
  }
  this.bursts.push(b);this.animate(b,this.cameraQuaternion);
 }
 private animate(b:Burst,cameraQuaternion:THREE.Quaternion){
  const t=b.age/this.options.duration;
  const flashTime=b.bomb?.11:.085;
  b.flash.material.opacity=Math.max(0,1-t/flashTime)**2;
  b.flash.scale.setScalar(.8+Math.min(t/flashTime,1)*(b.bomb?3.6:2.8));b.flash.visible=t<flashTime;
  b.fire.forEach((p,i)=>{
   const delay=i*.018,age=Math.max(0,t-delay),life=Math.max(0,1-age/.48);
   p.sprite.visible=t>=delay&&age<.48;
   p.sprite.material.opacity=Math.sqrt(life)*.58;
   const travel=(1-Math.exp(-age*7))*(b.bomb?1:.75),roll=p.angle+age*(1.3+p.seed);
   p.sprite.position.set(Math.cos(roll)*travel,.12+age*(1.35+p.seed),Math.sin(roll)*travel);
   p.sprite.scale.set(.45+(1-life)*(1.5+p.seed),.45+(1-life)*(1.8+p.seed),1);
   if(b.bomb)p.sprite.scale.multiplyScalar(1.15);
   p.sprite.material.color.setRGB(1,.10+life*.55,.012+life*.14);p.sprite.material.rotation=p.angle+age*(1+p.seed);
  });
  const ringLife=b.bomb?.62:.45;
  b.ring.visible=t<ringLife;b.ring.scale.setScalar(.22+(1-Math.exp(-t*7))*(b.bomb?5.6:3.8));
  b.ring.material.opacity=(b.bomb?.48:.4)*Math.max(0,1-t/ringLife)**1.4;
  b.smoke.forEach((p,i)=>{
   const ground=i<4,delay=ground?.035:.11+(i-4)*.045;
   const lifetime=ground?(b.bomb?1.35:.95)*this.options.duration:b.lifetime-delay;
   const elapsed=Math.max(0,b.age-delay),age=Math.min(1,elapsed/lifetime);
   p.sprite.visible=b.age>=delay&&age<1;
   const fade=ground?Math.pow(1-age,1.2):1-THREE.MathUtils.smoothstep(age,.42,1);
   p.sprite.material.opacity=Math.min(1,elapsed/(ground?.10:.20))*fade*(ground?(b.bomb?.48:.4):.72);
   const spread=ground?.4+(1-Math.exp(-elapsed*3))*(b.bomb?4.6:2.7):p.radius*(.55+age*(b.bomb?2.3:1.7));
   const curl=ground?0:Math.sin(age*4+p.seed*6)*age*.3;
   p.sprite.position.set(Math.cos(p.angle)*spread+curl,
    ground?.08+age*.18:.2+elapsed*(.32+p.seed*.23),Math.sin(p.angle)*spread+age*.22);
   const size=(ground?.45+age*1.6:.65+Math.sqrt(age)*(1.4+p.seed*.7))*(b.bomb?1.18:1);
   p.sprite.scale.set(size,ground?size*.38:size*(1+.12*age),1);
   // 升腾烟片的软边轮廓抬离地面，避免 billboard 被地板深度切出直线；尘浪仍贴地。
   if(!ground)p.sprite.position.y=Math.max(p.sprite.position.y,p.sprite.scale.y*.5+.02);
   p.sprite.material.rotation=ground?p.angle*.12:p.angle+age*.4;
   // 刚升起的烟有微弱余热；之后转成有层次的灰褐色，烟本身不发光。
   p.sprite.material.color.setRGB(ground?.22:.075+age*.045,ground?.19:.068+age*.043,ground?.16:.058+age*.04);
  });
  const flight=Math.min(t,.85),travel=(1-Math.exp(-2.2*flight))/2.2;
  b.fragments.visible=t<.85;
  if(b.fragments.visible){
   b.debris.forEach((p,i)=>{
    this.dummy.position.copy(p.velocity).multiplyScalar(travel);
    this.dummy.position.y=Math.max(.025,this.dummy.position.y-4.9*flight*flight);
    this.dummy.quaternion.copy(cameraQuaternion);this.dummy.rotateZ(p.spin+t*8);
    const fade=Math.max(0,1-t/(p.spark?.58:.85));
    this.dummy.scale.set(p.spark?.025:.055,p.spark?.16:.045,1).multiplyScalar(fade);
    this.dummy.updateMatrix();b.fragments.setMatrixAt(i,this.dummy.matrix);
   });b.fragments.instanceMatrix.needsUpdate=true;
  }
  // 墙后事件不亮灯；强光、冲击和震动按冲击时钟结束，不被残烟寿命拉长。
  // 炸弹的白热冲击后有短暂暖色火光，残烟阶段不再照亮环境。
  const lightLife=b.bomb?.3:.2;
  b.light.color.setHex(b.bomb&&t>.07?0xff873d:0xffba70);
  b.light.intensity=b.cover===1&&t<lightLife?this.options.lightIntensity*b.strength*
   (b.bomb?1.25*Math.exp(-t*22)+.08*Math.sin(Math.PI*t/lightLife):Math.exp(-t*28)):0;
 }
 update(dt:number,camera:THREE.Camera):void{
  const step=Number.isFinite(dt)?Math.max(0,dt):0;camera.getWorldQuaternion(this.cameraQuaternion);
  for(let i=this.bursts.length-1;i>=0;i--){const b=this.bursts[i];b.age+=step;
   if(b.age>=b.lifetime){this.bursts.splice(i,1);this.release(b);}else this.animate(b,this.cameraQuaternion);
  }
 }
 /** 控制器写入本帧基础位置后调用；不改 yaw/pitch/quaternion，残烟阶段严格为零。 */
 getShakeOffset(camera:THREE.Camera,out:THREE.Vector3):THREE.Vector3{
  out.set(0,0,0);camera.getWorldPosition(this.cameraPosition);
  for(const b of this.bursts){
   const t=b.age/this.options.duration,d=this.cameraPosition.distanceTo(b.root.position);
   const radius=this.options.shakeRadius*(b.bomb?5/3:1);
   const amplitude=this.options.shakeStrength*b.strength*Math.max(0,1-d/radius)**2*Math.max(0,1-t/.42)**2*b.cover;
   this.offset.set(Math.sin(t*157),Math.sin(t*193+1),Math.sin(t*139+2)).multiplyScalar(amplitude);out.add(this.offset);
  }
  return out.clampLength(0,this.options.shakeStrength);
 }
 private release(b:Burst):void{b.root.removeFromParent();b.light.intensity=0;}
 reset():void{for(const b of this.bursts)this.release(b);this.bursts.length=0;}
 dispose():void{
  if(this.disposed)return;this.disposed=true;this.reset();
  for(const b of this.pool){b.fragments.dispose();b.light.dispose();b.materials.forEach(m=>m.dispose());b.root.clear();}
  this.pool.length=0;this.ringGeometry.dispose();this.planeGeometry.dispose();this.textures.forEach(t=>t.dispose());this.root.removeFromParent();
 }
 diagnostics(){return {active:this.bursts.length,particles:this.bursts.length*ELEMENTS_PER_BURST,
  lights:this.bursts.filter(b=>b.light.intensity>0).length,duration:this.options.duration,smokeDuration:this.options.smokeDuration,
  pooled:this.pool.length,residue:this.bursts.filter(b=>b.age>=this.options.duration).length,
  bombs:this.bursts.filter(b=>b.bomb).length,maxLifetime:Math.max(0,...this.bursts.map(b=>b.lifetime))};}
}
