import * as THREE from 'three';
import type {GameEvent,Grenade} from '../game/types';
import {ExplosionSystem} from './explosionSystem';
import {MAP_BOXES} from '../game/map';

interface Particle{x:number;y:number;z:number;vx:number;vy:number;vz:number;life:number;max:number;size:number;smoke:boolean;tone:'smoke'|'spark'|'dust'|'hit'|'blood'|'muzzle';}
interface Casing{p:THREE.Vector3;v:THREE.Vector3;r:THREE.Euler;spin:THREE.Vector3;life:number;bounced:boolean;}
const hidden=new THREE.Matrix4().makeScale(0,0,0),dummy=new THREE.Object3D(),direction=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
function flameTexture(){
 const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d')!;
 const glow=x.createRadialGradient(64,64,1,64,64,62);glow.addColorStop(0,'rgba(255,255,220,1)');glow.addColorStop(.12,'rgba(255,242,158,1)');glow.addColorStop(.4,'rgba(255,150,49,.85)');glow.addColorStop(1,'rgba(255,94,15,0)');x.fillStyle=glow;x.fillRect(0,0,128,128);
 x.fillStyle='#fff6c3';x.beginPath();for(let i=0;i<24;i++){const a=i/24*Math.PI*2,r=i%2?8:24+(i*17%37),px=64+Math.cos(a)*r,py=64+Math.sin(a)*r;i?x.lineTo(px,py):x.moveTo(px,py);}x.closePath();x.fill();
 const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return map;
}
export function createMuzzleFlash(){
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:flameTexture(),transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));sprite.name='short irregular muzzle flame';sprite.scale.set(.145,.145,1);
 // A billboard alone reads like a flat icon. Add a small directional hot core
 // and a brass-colored shock ring so the first frame has real volume.
 const core=new THREE.Mesh(new THREE.ConeGeometry(.035,.19,7),new THREE.MeshBasicMaterial({color:'#fff0a3',transparent:true,opacity:.86,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
 core.rotation.x=Math.PI/2;core.position.z=-.075;core.name='muzzle-hot-core';sprite.add(core);
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.055,.007,5,12),new THREE.MeshBasicMaterial({color:'#ffc56e',transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
 ring.rotation.y=Math.PI/2;ring.position.z=-.02;ring.name='muzzle-pressure-ring';sprite.add(ring);
 return sprite;
}
function holeTexture(){
 const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d')!,g=x.createRadialGradient(32,32,2,32,32,30);g.addColorStop(0,'rgba(14,13,10,.95)');g.addColorStop(.25,'rgba(22,19,15,.94)');g.addColorStop(.48,'rgba(123,109,83,.72)');g.addColorStop(1,'rgba(119,100,73,0)');x.fillStyle=g;x.fillRect(0,0,64,64);
 x.strokeStyle='rgba(33,29,22,.7)';for(let i=0;i<8;i++){const a=i*.79;x.beginPath();x.moveTo(32+Math.cos(a)*5,32+Math.sin(a)*5);x.lineTo(32+Math.cos(a+.1)*(17+i%3*4),32+Math.sin(a+.1)*(17+i%3*4));x.stroke();}return new THREE.CanvasTexture(c);
}
export class CombatEffects{
 readonly root=new THREE.Group();private particles:Particle[]=[];private count=240;private positions=new Float32Array(this.count*3);private colors=new Float32Array(this.count*3);private sizes=new Float32Array(this.count);private alphas=new Float32Array(this.count);private cloudFlags=new Float32Array(this.count);private geo=new THREE.BufferGeometry();private material:THREE.ShaderMaterial;private cursor=0;private rng=42;private decalCursor=0;private decals:THREE.InstancedMesh;private holes:Array<{life:number;matrix:THREE.Matrix4}>=[];private grenades:THREE.Group[]=[];private explosions=new ExplosionSystem();private shakeOffset=new THREE.Vector3();trauma=0;
 private casings:THREE.InstancedMesh;private cases:Casing[]=[];private caseCursor=0;private elapsed=0;private shots=0;private hits=0;private blastCount=0;
 constructor(){
  this.geo.setAttribute('position',new THREE.BufferAttribute(this.positions,3));this.geo.setAttribute('color',new THREE.BufferAttribute(this.colors,3));this.geo.setAttribute('size',new THREE.BufferAttribute(this.sizes,1));this.geo.setAttribute('alpha',new THREE.BufferAttribute(this.alphas,1));
  this.geo.setAttribute('cloud',new THREE.BufferAttribute(this.cloudFlags,1));
  this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{scale:{value:350}},vertexShader:`attribute float size;attribute float alpha;attribute float cloud;varying float vCloud;varying vec3 vColor;varying float vAlpha;uniform float scale;void main(){vColor=color;vAlpha=alpha;vCloud=cloud;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(240.,size*scale/max(.5,-mv.z));gl_Position=projectionMatrix*mv;}`,fragmentShader:`varying vec3 vColor;varying float vAlpha;varying float vCloud;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
 vec2 p=gl_PointCoord*2.-1.;float d=length(p);
 float n=noise(p*3.2+vCloud*7.)*.65+noise(p*7.1+vCloud*11.)*.35;
 float mask=vCloud>0.?pow(max(0.,1.-smoothstep(.08,.96,d+(n-.5)*.30)),1.5)*(.40+.60*n):1.-smoothstep(.35,.85,d);
 float alpha=mask*vAlpha;if(alpha<.008)discard;
 gl_FragColor=vec4(vColor*(vCloud>0.?(.8+n*.4):1.),alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`});
  const points=new THREE.Points(this.geo,this.material);points.frustumCulled=false;this.root.add(points,this.explosions.root);
  for(let i=0;i<this.count;i++)this.particles.push({x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,max:1,size:0,smoke:false,tone:'dust'});
  this.decals=new THREE.InstancedMesh(new THREE.PlaneGeometry(.12,.12),new THREE.MeshBasicMaterial({map:holeTexture(),transparent:true,opacity:.85,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),48);this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.decals.frustumCulled=false;this.root.add(this.decals);
  const hidden=new THREE.Matrix4().makeScale(0,0,0);for(let i=0;i<48;i++){this.decals.setMatrixAt(i,hidden);this.holes.push({life:0,matrix:new THREE.Matrix4()});}
  this.casings=new THREE.InstancedMesh(new THREE.CylinderGeometry(.006,.008,.043,7),new THREE.MeshStandardMaterial({color:'#ba9642',roughness:.34,metalness:.7}),32);this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.casings.frustumCulled=false;this.root.add(this.casings);
  for(let i=0;i<32;i++){this.cases.push({p:new THREE.Vector3(),v:new THREE.Vector3(),r:new THREE.Euler(),spin:new THREE.Vector3(),life:0,bounced:false});this.casings.setMatrixAt(i,hidden);}
  const shellGeo=new THREE.SphereGeometry(.075,10,8),shellMat=new THREE.MeshStandardMaterial({color:'#3c4934',roughness:.68,metalness:.35}),fuseMat=new THREE.MeshStandardMaterial({color:'#8b8b72',metalness:.6,roughness:.4});
  for(let i=0;i<6;i++){const g=new THREE.Group(),body=new THREE.Mesh(shellGeo,shellMat),cap=new THREE.Mesh(new THREE.BoxGeometry(.035,.055,.035),fuseMat),lever=new THREE.Mesh(new THREE.BoxGeometry(.03,.10,.017),fuseMat);body.scale.y=1.22;cap.position.y=.09;lever.position.set(.065,.04,0);lever.rotation.z=.22;g.add(body,cap,lever);g.visible=false;g.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});this.root.add(g);this.grenades.push(g);}
 }
 private random(){this.rng=(Math.imul(this.rng,1664525)+1013904223)>>>0;return this.rng/4294967296;}
 reset(){this.particles.forEach(p=>p.life=0);this.holes.forEach(h=>h.life=0);this.cases.forEach(c=>c.life=0);this.trauma=0;this.grenades.forEach(g=>g.visible=false);this.shots=this.hits=this.blastCount=0;this.explosions.reset();}
 emit(e:GameEvent,distance=0){
  if(e.type==='shot'){
   this.shots++;const x=e.x??0,y=e.y??1.6,z=e.z??0;direction.set((e.endX??x)-x,(e.endY??y)-y,(e.endZ??z-1)-z).normalize();right.crossVectors(direction,up).normalize();const near=e.actorId===0?.04:0;
   const smokeCount=e.actorId===0?5:3;
   for(let i=0;i<smokeCount;i++){const p=this.spawn(x+direction.x*near,y+direction.y*near-.025,z+direction.z*near,true,.18);p.size=.075+this.random()*.10;p.life=p.max=.24+this.random()*.22;p.vx+=direction.x*.65;p.vz+=direction.z*.65;}
   for(let i=0;i<2;i++){const p=this.spawn(x+direction.x*.05,y+direction.y*.05,z+direction.z*.05,false,.3);p.size=.035+this.random()*.035;p.life=p.max=.11+this.random()*.08;p.vx+=direction.x*2.5;p.vy+=.8+this.random()*1.6;p.vz+=direction.z*2.5;}
   if(e.actorId!==0){const p=this.spawn(x,y,z,false,0);p.tone='muzzle';p.size=.30;p.max=p.life=.065;}
   const c=this.cases[this.caseCursor++%this.cases.length];c.p.set(e.ejectX??x+right.x*.22,e.ejectY??y-.13,e.ejectZ??z+right.z*.22);c.v.copy(right).multiplyScalar(1.7+this.random()).addScaledVector(direction,.5);c.v.y=1+this.random();c.spin.set(8+this.random()*14,5,14);c.r.set(0,0,0);c.life=2.3;c.bounced=false;
  }else if(e.type==='hit'){
   this.hits++;
   if(e.targetId!==0){
    const hitDir=new THREE.Vector3(e.normalX??0,e.normalY??.12,e.normalZ??0).normalize();
    for(let i=0;i<(e.headshot?15:10);i++){
     const p=this.spawn(e.x??0,e.y??1.2,e.z??0,false,.34);p.tone='blood';
     const spread=(this.random()-.5)*.72;p.vx=hitDir.x*(1.2+this.random()*1.8)+right.x*spread;p.vz=hitDir.z*(1.2+this.random()*1.8)+right.z*spread;
     p.vy=hitDir.y*(1+this.random()*1.5)+.25+this.random()*.6;p.size=(e.headshot?.045:.035)+this.random()*.075;p.max=p.life=.28+this.random()*.32;
    }
    const flash=this.spawn(e.x??0,e.y??1.2,e.z??0,false,.08);flash.tone='hit';flash.size=e.headshot?.22:.14;flash.max=flash.life=.08;
   }else this.trauma=Math.min(.6,this.trauma+.17);
  }else if(e.type==='explosion'||e.type==='bombExplode'){
   this.blastCount++;
   this.explosions.spawn(new THREE.Vector3(e.x??0,e.y??0,e.z??0),e.occluded);
  }else if(e.type==='impact'){
   for(let i=0;i<8;i++){const p=this.spawn(e.x!,e.y!,e.z!,i>2,.3);if(i>2){p.tone=e.surface==='metal'?'spark':'dust';p.size=e.surface==='metal'?.07+this.random()*.08:.11+this.random()*.14;p.max=p.life=e.surface==='metal'?.28:.45;}}
   const normal=new THREE.Vector3();let best=.08;for(const b of MAP_BOXES){for(const [dist,x,y,z] of [[Math.abs(e.x!-(b.x-b.w/2)),-1,0,0],[Math.abs(e.x!-(b.x+b.w/2)),1,0,0],[Math.abs(e.z!-(b.z-b.d/2)),0,0,-1],[Math.abs(e.z!-(b.z+b.d/2)),0,0,1],[Math.abs(e.y!-b.h),0,1,0]])if(dist<best){best=dist;normal.set(x,y,z);}}
   if(normal.lengthSq()){const h=this.holes[this.decalCursor++%48],q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal);h.matrix.compose(new THREE.Vector3(e.x!,e.y!,e.z!).addScaledVector(normal,.007),q,new THREE.Vector3(1,1,1));h.life=18;}
  }
 }
 private spawn(x:number,y:number,z:number,smoke:boolean,mult=1){const p=this.particles[this.cursor++%this.count],angle=this.random()*Math.PI*2,speed=(smoke?.8:5)*this.random()*mult;p.x=x;p.y=y;p.z=z;p.vx=Math.cos(angle)*speed;p.vz=Math.sin(angle)*speed;p.vy=(smoke?.8:3)*this.random()*mult;p.max=p.life=smoke?1.6+this.random()*1.2:.25+this.random()*.55;p.size=smoke?.5+this.random()*.7:.06+this.random()*.15;p.smoke=smoke;p.tone=smoke?'smoke':'spark';return p;}
 update(dt:number,grenades:Grenade[],camera:THREE.Camera,viewportHeight:number){
  this.elapsed+=dt;this.material.uniforms.scale.value=viewportHeight*.78;this.explosions.update(dt,camera);this.trauma=Math.max(0,this.trauma-dt*1.8);
  for(let i=0;i<this.count;i++){
   const p=this.particles[i];p.life=Math.max(0,p.life-dt);
   if(p.life){
    p.x+=p.vx*dt;p.y=Math.max(.025,p.y+p.vy*dt);p.z+=p.vz*dt;if(!p.smoke)p.vy-=7*dt;p.size+=dt*(p.smoke?.8:0);
   }
   this.positions.set([p.x,p.y,p.z],i*3);const age=1-p.life/p.max;
   this.colors.set(p.tone==='hit'?[.30,.05,.025]:p.tone==='blood'?[.62,.025,.012]:p.tone==='dust'?[.48,.39,.27]:p.tone==='muzzle'?[1,.88,.50]:p.smoke?[.10+age*.18,.095+age*.16,.085+age*.12]:[1,.56+age*.15,.17+age*.22],i*3);
   this.sizes[i]=p.size;this.cloudFlags[i]=p.smoke?1+(i%7)*.13:0;
   const smokeFade=p.smoke?Math.sin(Math.min(1,age)*Math.PI)*.55:.95;
   this.alphas[i]=p.life>0?smokeFade*Math.min(1,p.life/(p.smoke?.5:.12)):0;
  }
  for(const key of ['position','color','size','alpha','cloud'])this.geo.getAttribute(key).needsUpdate=true;
  const zero=new THREE.Matrix4().makeScale(0,0,0);this.holes.forEach((h,i)=>{h.life=Math.max(0,h.life-dt);this.decals.setMatrixAt(i,h.life>0?h.matrix:zero);});this.decals.instanceMatrix.needsUpdate=true;
  this.cases.forEach((c,i)=>{c.life=Math.max(0,c.life-dt);if(c.life<=0){this.casings.setMatrixAt(i,hidden);return;}c.v.y-=8*dt;c.p.addScaledVector(c.v,dt);if(c.p.y<.025){c.p.y=.025;if(!c.bounced){c.v.y=Math.abs(c.v.y)*.24;c.v.x*=.45;c.v.z*=.45;c.bounced=true;}else{c.v.set(0,0,0);c.spin.set(0,0,0);}}c.r.x+=c.spin.x*dt;c.r.y+=c.spin.y*dt;c.r.z+=c.spin.z*dt;dummy.position.copy(c.p);dummy.rotation.copy(c.r);dummy.scale.setScalar(1);dummy.updateMatrix();this.casings.setMatrixAt(i,dummy.matrix);});this.casings.instanceMatrix.needsUpdate=true;
  this.grenades.forEach((m,i)=>{const g=grenades[i];m.visible=!!g;if(g){m.position.set(g.x,g.y,g.z);m.rotation.set(g.fuse*9,g.fuse*5,0);}});
  camera.position.add(this.explosions.getShakeOffset(camera,this.shakeOffset));
  if(this.trauma>0){camera.position.y+=Math.sin(this.elapsed*95)*this.trauma**2*.045;camera.rotation.z+=Math.sin(this.elapsed*71)*this.trauma**2*.016;}
 }
 diagnostics(){return {particles:this.particles.filter(p=>p.life>0).length,decals:this.holes.filter(h=>h.life>0).length,casings:this.cases.filter(c=>c.life>0).length,grenades:this.grenades.filter(g=>g.visible).length,explosions:this.blastCount,blastParticles:this.explosions.diagnostics().particles,blast:this.explosions.diagnostics(),shotEffects:this.shots,hitEffects:this.hits};}
}
