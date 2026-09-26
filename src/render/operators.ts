import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Team} from '../game/types';

// Recolored imported garment skins plus authored heads and tactical equipment.
// Additional gear shares one textured skinned mesh per operator.
const uniforms=new Map<Team,THREE.BufferGeometry>();
const bodyGeometry=new Map<string,THREE.BufferGeometry>();
const bodyMaterials=new Map<string,THREE.MeshStandardMaterial>();
const bodyMaps=new Map<Team,THREE.Texture>();
export async function loadUniformMaps(){
 const loader=new THREE.TextureLoader();
 await Promise.all((['blue','red'] as const).map(async team=>{const map=await loader.loadAsync(import.meta.env.BASE_URL+'assets/characters/'+(team==='blue'?'ct':'insurgent')+'-uniform.jpg');map.flipY=false;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;bodyMaps.set(team,map);}));
}
let uniformMaterial:THREE.MeshStandardMaterial;
type P=readonly[number,number,number];
const Y=new THREE.Vector3(0,1,0);
const sphere=new THREE.SphereGeometry(1,14,10);
const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),color=new THREE.Color();

function fabric():THREE.CanvasTexture{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
 const c=canvas.getContext('2d')!;c.fillStyle='#d8d4cc';c.fillRect(0,0,256,256);
 let seed=471;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let y=0;y<256;y+=2)for(let x=0;x<256;x+=2){const n=180+random()*65;c.fillStyle=`rgb(${n},${n},${n})`;c.fillRect(x,y,1,1);}
 for(let y=0;y<256;y+=32){c.fillStyle='rgba(30,26,20,.12)';c.fillRect(0,y,256,1);}
 const t=new THREE.CanvasTexture(canvas);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;t.name='original woven tactical canvas';return t;
}
class SkinBuilder{
 parts:THREE.BufferGeometry[]=[];
 constructor(private bones:THREE.Bone[]){}
 joint(name:string){const index=this.bones.findIndex(b=>b.name.replace(/[^a-z0-9]/gi,'').toLowerCase()==='mixamorig'+name.toLowerCase());if(index<0)throw new Error('Uniform joint missing: '+name);return index;}
 point(name:string){return this.bones[this.joint(name)].getWorldPosition(new THREE.Vector3());}
 part(g:THREE.BufferGeometry,joint:string,tint:string,p:P=[0,0,0],scale:P=[1,1,1],rotation:P=[0,0,0]){
  const a=g.index?g.toNonIndexed():g.clone();matrix.compose(new THREE.Vector3(...p),q.setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));a.applyMatrix4(matrix);
  const n=a.getAttribute('position').count,cs=new Float32Array(n*3),si=new Uint16Array(n*4),sw=new Float32Array(n*4),bi=this.joint(joint);color.set(tint);
  const positions=a.getAttribute('position'),normal=a.getAttribute('normal');
  for(let i=0;i<n;i++){const occlusion=.90+.10*Math.max(0,normal.getY(i));cs.set([color.r*occlusion,color.g*occlusion,color.b*occlusion],i*3);si[i*4]=bi;sw[i*4]=1;}
  a.setAttribute('color',new THREE.BufferAttribute(cs,3));a.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));a.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));this.parts.push(a);
 }
 box(j:string,c:string,p:P,s:P,r:P=[0,0,0],bevel=.008){const g=new RoundedBoxGeometry(...s,1,Math.min(...s)*Math.min(.28,bevel/Math.min(...s)));this.part(g,j,c,p,[1,1,1],r);g.dispose();}
 ellipsoid(j:string,c:string,p:P,s:P){this.part(sphere,j,c,p,s);}
 segment(j:string,c:string,start:THREE.Vector3,end:THREE.Vector3,r0:number,r1:number,folds=false){
  const length=start.distanceTo(end),g=new THREE.CylinderGeometry(r1,r0,length,12,folds?8:1);
  if(folds){const p=g.getAttribute('position');for(let i=0;i<p.count;i++){const f=(p.getY(i)+length/2)/length;const ripple=1+.045*Math.sin(f*39)+.025*Math.sin(f*74);p.setX(i,p.getX(i)*ripple);p.setZ(i,p.getZ(i)*ripple*.91);}g.computeVertexNormals();}
  const middle=start.clone().lerp(end,.5),rot=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,end.clone().sub(start).normalize()));this.part(g,j,c,middle.toArray() as [number,number,number],[1,1,1],[rot.x,rot.y,rot.z]);g.dispose();
 }
 finish(){const g=mergeGeometries(this.parts,false)!;this.parts.forEach(p=>p.dispose());g.computeBoundingSphere();return g;}
}

function build(bones:THREE.Bone[],team:Team){
 const b=new SkinBuilder(bones),ct=team==='blue';
 const cloth=ct?'#526576':'#987954',trousers=ct?'#45566b':'#77806a',fold=ct?'#35434e':'#705f46',vest=ct?'#202b31':'#484837',trim=ct?'#657981':'#7b7b5d',rubber='#242726',skin='#bc926e',seam=ct?'#81909a':'#b7a184';
 const hips=b.point('Hips').y,spine=b.point('Spine2').y,head=b.point('Head');





 b.box('Hips',rubber,[0,hips+.007,0],[.375,.046,.271]);
 b.box('Hips','#777970',[0,hips+.009,-.141],[.054,.039,.012]);
 for(const side of [-1,1]){
  b.box('Spine2',trim,[side*.135,spine+.026,-.106],[.044,.255,.032],[0,0,side*.07]);

  b.box('Hips',fold,[side*.171,hips-.035,.034],[.065,.115,.108]);
 }
 for(const x of [-.108,0,.108]){
  b.box('Spine2',fold,[x,spine-.183,-.190],[.091,.127,.073],[.05,0,0]);
  b.box('Spine2',trim,[x,spine-.125,-.198],[.094,.022,.066]);
  b.box('Spine2',rubber,[x,spine-.179,-.231],[.018,.028,.006]);
 }
 // Webbing rows, radio and exposed cable give useful scale at 3–10 metres.
 for(let i=0;i<4;i++)b.box('Spine2',trim,[0,spine-.023-i*.032,-.171],[.274,.008,.009]);
 b.box('Spine2',rubber,[-.156,spine+.021,-.165],[.052,.09,.040]);
 b.segment('Spine2',rubber,new THREE.Vector3(-.155,spine+.07,-.161),new THREE.Vector3(-.16,spine+.173,-.136),.004,.003);
 b.box('Spine2',ct?'#b7c8c9':'#d1bb91',[.068,spine+.01,-.174],[.075,.029,.006]);
 for(let i=0;i<3;i++)b.box('Spine2',ct?'#32444b':'#685c3f',[.043+i*.022,spine+.01,-.178],[.011,.016,.003]);
 if(ct){
  // The imported torso faces -Z. Keep the carrier on that front plane so
  // opponents read as equipped operators instead of recoloured mannequins.
  b.box('Spine2',fold,[0,spine-.078,-.224],[.215,.237,.065],[0,0,0],.02);
  b.box('Spine2',trim,[0,spine-.081,-.261],[.018,.17,.006]);
  b.box('Spine2',rubber,[0,spine+.030,-.263],[.168,.028,.012]);
  for(const x of [-.122,-.041,.041,.122]){
   b.box('Spine2',rubber,[x,spine-.137,-.263],[.050,.068,.030],[0,0,x<0?-.05:.05]);
   b.box('Spine2',trim,[x,spine-.137,-.281],[.036,.008,.006]);
  }
  b.box('Spine2',trim,[-.178,spine+.015,-.168],[.028,.116,.036],[0,0,-.12]);
  b.box('Spine2','#a8b6b5',[.178,spine+.016,-.168],[.028,.116,.036],[0,0,.12]);
 } else { // Woven scarf sits above the chest harness.
  b.ellipsoid('Spine2','#a99778',[0,spine+.080,-.035],[.176,.064,.142]);
  b.box('Spine2','#ac9e80',[-.050,spine-.035,-.205],[.092,.181,.023],[0,.10,-.22]);
  for(let i=0;i<5;i++)b.box('Spine2','#544f40',[-.05,spine+.040-i*.031,-.196],[.093,.007,.003],[0,0,-.22]);
  // A loose chest rig breaks the flat khaki front with dark webbing and two
  // recognisable magazine pouches.
  b.box('Spine2','#514637',[-.11,spine-.105,-.237],[.072,.096,.032],[0,0,-.04]);
  b.box('Spine2','#514637',[.01,spine-.105,-.237],[.072,.096,.032],[0,0,.04]);
  b.box('Spine2','#2e2d28',[0,spine-.014,-.236],[.205,.014,.008]);
 }
 b.ellipsoid('Neck',skin,[0,head.y-.012,head.z],[.060,.069,.058]);
 // Anatomical jaw, brow, nose and ear shape. CT has helmet/ballistic goggles;
 // opponent has a fabric balaclava and cloth scarf, a different silhouette.
 b.ellipsoid('Head',ct?'#303b3c':skin,[0,head.y+.105,head.z-.012],[.102,.129,.092]);
 b.ellipsoid('Head',ct?'#343d3c':skin,[0,head.y+.044,head.z-.036],[.084,.055,.080]);
 for(const side of [-1,1])b.ellipsoid('Head',skin,[side*.099,head.y+.070,head.z],[.018,.040,.023]);
 if(ct){
  b.ellipsoid('Head','#35434b',[0,head.y+.175,head.z+.013],[.125,.080,.113]);
  b.box('Head','#2c353a',[0,head.y+.141,head.z-.080],[.239,.032,.094],[0,0,0],.014);
  for(const side of [-1,1]){
   b.ellipsoid('Head','#171e21',[side*.123,head.y+.094,head.z+.021],[.016,.049,.036]);
   b.box('Head','#242b2b',[side*.052,head.y+.111,head.z-.095],[.089,.049,.025],[0,side*.09,0],.008);
   b.box('Head','#60747b',[side*.052,head.y+.117,head.z-.111],[.073,.026,.005],[0,side*.09,0]);
   b.box('Head','#1b2527',[side*.085,head.y+.053,head.z-.067],[.014,.089,.01],[0,side*.6,side*.26]);
  }
  b.box('Head','#7a8783',[0,head.y+.217,head.z-.003],[.033,.012,.045]);
 }else{
  b.ellipsoid('Head','#55483c',[0,head.y+.153,head.z+.009],[.107,.090,.096]);
  b.ellipsoid('Head','#514339',[0,head.y+.057,head.z-.043],[.084,.044,.074]);
  b.box('Head','#3d3630',[0,head.y+.141,head.z-.088],[.172,.021,.015]);
  b.ellipsoid('Head',skin,[0,head.y+.095,head.z-.104],[.022,.031,.025]);
  for(const side of [-1,1]){
   b.box('Head','#a98c72',[side*.045,head.y+.116,head.z-.093],[.047,.025,.017]);
   b.box('Head','#282723',[side*.045,head.y+.119,head.z-.105],[.039,.009,.008]);
   b.box('Head','#685041',[side*.043,head.y+.130,head.z-.103],[.046,.006,.006],[0,0,side*.1]);
  }
 }
 // Garment folds, limbs and gloves use the recolored imported skin. Only
 // tactical equipment and heads are overlaid, avoiding nested full bodies.
 for(const side of [-1,1]){
  const prefix=side<0?'Left':'Right',arm=prefix+'Arm',thigh=prefix+'UpLeg';
  const a=b.point(arm),t=b.point(thigh);
  b.box(arm,ct?'#a1b2b7':'#9c987d',[a.x+side*.054,a.y+.071,a.z],[.071,.009,.048]);
  b.box(arm,ct?'#293d50':'#674c36',[a.x+side*.054,a.y+.077,a.z],[.028,.004,.037]);
  b.box(thigh,fold,[t.x+side*.083,t.y-.202,t.z+.013],[.039,.125,.108],[0,0,side*.04]);
  b.box(thigh,seam,[t.x+side*.104,t.y-.144,t.z+.01],[.008,.019,.104]);
  b.box(thigh,rubber,[t.x+side*.081,t.y-.297,t.z-.058],[.108,.072,.038],[0,0,side*.04]);
  b.box(thigh,trim,[t.x+side*.081,t.y-.297,t.z-.079],[.067,.034,.006],[0,0,side*.04]);
 }
 return b.finish();
}

export function outfitOperator(model:THREE.Object3D,pose:THREE.Group,team:Team){
 // GLTFLoader leaves unweighted fingertip joints as Object3D. They still have
 // bone world transforms and may influence our newly authored glove mesh.
 const bones:THREE.Bone[]=[];let originalTriangles=0;
 model.traverse(o=>{
  if(o.name.replace(/[^a-z0-9]/gi,'').toLowerCase().startsWith('mixamorig'))bones.push(o as THREE.Bone);
  if(!(o instanceof THREE.SkinnedMesh))return;
  const source=o.geometry,key=source.uuid;
  if(!bodyGeometry.has(key)){
   const indices=source.index,skinIndex=source.getAttribute('skinIndex'),skinWeight=source.getAttribute('skinWeight');
   const headJoints=new Set(o.skeleton.bones.flatMap((bone,i)=>/head|neck/i.test(bone.name)?[i]:[]));
   const isHead=(v:number)=>{let sum=0;for(let k=0;k<4;k++)if(headJoints.has(skinIndex.getComponent(v,k)))sum+=skinWeight.getComponent(v,k);return sum>.35;};
   const filtered:number[]=[];const count=indices?.count??source.getAttribute('position').count;
   for(let i=0;i<count;i+=3){const a=indices?indices.getX(i):i,b=indices?indices.getX(i+1):i+1,c=indices?indices.getX(i+2):i+2;if(!(isHead(a)||isHead(b)||isHead(c)))filtered.push(a,b,c);}
   const geometry=source.clone();geometry.setIndex(filtered);bodyGeometry.set(key,geometry);
  }
  o.geometry=bodyGeometry.get(key)!;o.visible=(o.geometry.index?.count??0)>0;originalTriangles+=(o.geometry.index?.count??0)/3;
  const mk=team+(o.material as THREE.Material).name;
  if(!bodyMaterials.has(mk)){const m=(o.material as THREE.MeshStandardMaterial).clone();m.map=bodyMaps.get(team)!;m.color.set('#ffffff');m.metalness=0;m.roughness=.96;if(m.normalMap)m.normalScale.set(.38,.38);m.name=team+' textured tactical fatigues';bodyMaterials.set(mk,m);}
  o.material=bodyMaterials.get(mk)!;
 });
 model.updateWorldMatrix(true,true);
 if(!uniforms.has(team))uniforms.set(team,build(bones,team));
 uniformMaterial??=new THREE.MeshStandardMaterial({map:fabric(),vertexColors:true,roughness:.86,metalness:.055});
 uniformMaterial.name='woven tactical uniform and worn equipment';
 const mesh=new THREE.SkinnedMesh(uniforms.get(team)!,uniformMaterial);mesh.name='authored-'+(team==='blue'?'counter-assault':'insurgent');
 pose.add(mesh);pose.updateWorldMatrix(true,true);
 const skeleton=new THREE.Skeleton(bones);mesh.bind(skeleton);mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
 return {mesh,triangles:originalTriangles+mesh.geometry.getAttribute('position').count/3,bones:bones.length};
}
