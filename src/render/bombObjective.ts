import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {GameSnapshot,ObjectiveSite} from '../game/types';

function roundedProfile(halfWidth:number,halfHeight:number,radius:number):THREE.Shape {
 const shape=new THREE.Shape(),x=halfWidth,y=halfHeight,r=radius;
 shape.moveTo(-x+r,-y);shape.lineTo(x-r,-y);shape.quadraticCurveTo(x,-y,x,-y+r);
 shape.lineTo(x,y-r);shape.quadraticCurveTo(x,y,x-r,y);shape.lineTo(-x+r,y);
 shape.quadraticCurveTo(-x,y,-x,y-r);shape.lineTo(-x,-y+r);shape.quadraticCurveTo(-x,-y,-x+r,-y);
 return shape;
}

function siteTexture(id:'A'|'B'):THREE.CanvasTexture {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const context=canvas.getContext('2d')!;
 context.strokeStyle='rgba(255,205,117,.9)';context.lineWidth=5;context.strokeRect(12,12,104,104);
 context.fillStyle='#ffce7b';context.font='bold 79px sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(id,64,62);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

/** A compact, authored objective prop and ground stencils. Every position is
 * supplied by gameplay, including Dust2's elevated A site and bomb drops. */
export class BombObjective extends THREE.Group {
 private bomb=new THREE.Group();
 private siteRoots=new Map<string,{key:string;root:THREE.Group}>();
 private siteMaterials=new Map<'A'|'B',THREE.MeshBasicMaterial>();
 private boundaryMaterial=new THREE.MeshBasicMaterial({color:0xf6c36f,transparent:true,opacity:.45,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
 private signalMaterial=new THREE.MeshBasicMaterial({color:0xff563f,toneMapped:false});
 private haloMaterial=new THREE.MeshBasicMaterial({color:0xff563f,transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
 private halo:THREE.Mesh;
 private indicator:THREE.Mesh;
 private labelGeometry=new THREE.PlaneGeometry(1.1,1.1);
 private panelCanvas:HTMLCanvasElement;
 private panelTexture:THREE.CanvasTexture;
 private panelKey='';

 constructor(){
  super();this.name='demolition-objective';this.visible=false;this.bomb.name='utility-C4';this.add(this.bomb);
  // A continuous chamfered fabric pack, closed wraparound retention straps,
  // and a separately seated control casing form the complete assembly.
  const fabric=new THREE.MeshStandardMaterial({color:0x77704d,roughness:.96,metalness:0});
  const pack=new THREE.Mesh(new RoundedBoxGeometry(.34,.16,.22,2,.012),fabric);pack.name='C4-fabric-pack';pack.position.y=.08;this.bomb.add(pack);
  const strapShape=roundedProfile(.114,.084,.014),hole=roundedProfile(.108,.078,.009);
  strapShape.holes.push(new THREE.Path(hole.getPoints(5)));
  const strapGeometry=new THREE.ExtrudeGeometry(strapShape,{depth:.028,bevelEnabled:false,curveSegments:3});
  const strapMaterial=new THREE.MeshStandardMaterial({color:0x3b3e30,roughness:1});
  for(const x of [-.112,.112]){
   const strap=new THREE.Mesh(strapGeometry,strapMaterial);strap.name=`C4-retention-strap-${x<0?'left':'right'}`;
   strap.rotation.y=Math.PI/2;strap.position.set(x-.014,.08,0);this.bomb.add(strap);
  }
  const casingMaterial=new THREE.MeshStandardMaterial({color:0x343b37,roughness:.7,metalness:.15});
  const casing=new THREE.Mesh(new RoundedBoxGeometry(.154,.034,.145,2,.006),casingMaterial);
  casing.name='C4-control-casing';casing.position.set(0,.177,0);this.bomb.add(casing);
  this.panelCanvas=document.createElement('canvas');this.panelCanvas.width=128;this.panelCanvas.height=128;
  this.panelTexture=new THREE.CanvasTexture(this.panelCanvas);this.panelTexture.colorSpace=THREE.SRGBColorSpace;
  const panelMaterial=new THREE.MeshBasicMaterial({map:this.panelTexture,toneMapped:false});
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(.136,.127),panelMaterial);panel.name='C4-control-face';panel.rotation.x=-Math.PI/2;panel.position.set(0,.195,0);this.bomb.add(panel);
  this.indicator=new THREE.Mesh(new THREE.SphereGeometry(.0075,8,6),this.signalMaterial);
  this.indicator.name='C4-status-indicator';this.indicator.position.set(.058,.202,-.051);this.bomb.add(this.indicator);
  this.halo=new THREE.Mesh(new THREE.RingGeometry(.39,.415,40),this.haloMaterial);this.halo.name='C4-location-ring';this.halo.rotation.x=-Math.PI/2;this.halo.position.y=.008;this.bomb.add(this.halo);
  this.bomb.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=false;object.receiveShadow=true;}});
  this.drawPanel('C4',false);
 }

 private drawPanel(text:string,armed:boolean):void {
  const key=`${armed}:${text}`;if(key===this.panelKey)return;this.panelKey=key;
  const context=this.panelCanvas.getContext('2d')!;
  context.fillStyle='#303731';context.fillRect(0,0,128,128);
  context.fillStyle='#151d17';context.fillRect(10,9,108,37);
  context.fillStyle=armed?'#ff7854':'#c4ce91';context.font='bold 26px monospace';context.textAlign='center';context.textBaseline='middle';context.fillText(text,60,28);
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
   context.fillStyle='#767768';context.fillRect(12+col*27,57+row*21,20,14);
   context.fillStyle='#262c27';context.fillRect(19+col*27,62+row*21,5,3);
  }
  this.panelTexture.needsUpdate=true;
 }

 private createSite(site:ObjectiveSite):THREE.Group {
  const root=new THREE.Group();root.name=`bomb-site-${site.id}`;
  // A BSP trigger can be rectangular. Draw its actual bounds rather than a
  // circular proxy which would suggest that valid planting corners are outside.
  let geometry:THREE.BufferGeometry;
  if(site.bounds){
   const b=site.bounds,x0=b.minX-site.x,x1=b.maxX-site.x,z0=b.minZ-site.z,z1=b.maxZ-site.z,t=.045;
   const points:number[]=[];
   const quad=(ax:number,az:number,bx:number,bz:number,cx:number,cz:number,dx:number,dz:number)=>points.push(ax,0,az,bx,0,bz,cx,0,cz,ax,0,az,cx,0,cz,dx,0,dz);
   quad(x0,z0,x1,z0,x1,z0+t,x0,z0+t);quad(x0,z1-t,x1,z1-t,x1,z1,x0,z1);
   quad(x0,z0+t,x0+t,z0+t,x0+t,z1-t,x0,z1-t);quad(x1-t,z0+t,x1,z0+t,x1,z1-t,x1-t,z1-t);
   geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.computeVertexNormals();
  }else{
   geometry=new THREE.RingGeometry(Math.max(.1,site.radius-.045),Math.max(.15,site.radius),56);geometry.rotateX(-Math.PI/2);
  }
  const outline=new THREE.Mesh(geometry,this.boundaryMaterial);outline.name='plantable-area-boundary';root.add(outline);
  let material=this.siteMaterials.get(site.id);
  if(!material){material=new THREE.MeshBasicMaterial({map:siteTexture(site.id),transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});this.siteMaterials.set(site.id,material);}
  const label=new THREE.Mesh(this.labelGeometry,material);label.name=`site-${site.id}-ground-stencil`;label.rotation.x=-Math.PI/2;label.position.y=.007;root.add(label);
  root.position.set(site.x,(site.y??0)+.022,site.z);this.add(root);return root;
 }

 update(snapshot:GameSnapshot,_dt=0):void {
  this.visible=snapshot.mode==='demolition'&&snapshot.phase!=='menu';if(!this.visible)return;
  const active=new Set<string>();
  for(const site of snapshot.sites){
   active.add(site.id);
   const key=JSON.stringify(site),previous=this.siteRoots.get(site.id);
   if(!previous||previous.key!==key){
    if(previous){this.remove(previous.root);(previous.root.children[0] as THREE.Mesh).geometry.dispose();}
    this.siteRoots.set(site.id,{key,root:this.createSite(site)});
   }
   this.siteRoots.get(site.id)!.root.visible=true;
  }
  for(const [id,site] of this.siteRoots)if(!active.has(id))site.root.visible=false;
  const bomb=snapshot.bomb,planted=bomb.status==='planted';
  this.bomb.visible=planted||bomb.status==='dropped';if(!this.bomb.visible)return;
  this.bomb.position.set(bomb.x,(bomb.y??0)+.009,bomb.z);
  const frequency=planted?2+5*(1-THREE.MathUtils.clamp(bomb.timer/40,0,1)):1;
  const pulse=(Math.sin(snapshot.time*Math.PI*2*frequency)+1)/2;
  this.signalMaterial.color.setHex(planted?0xff4b35:0xf8c970);this.indicator.visible=!planted||pulse>.55;
  this.haloMaterial.color.copy(this.signalMaterial.color);this.haloMaterial.opacity=planted?.15+pulse*.4:.24;
  this.halo.scale.setScalar(planted?1+pulse*.09:1);
  this.drawPanel(planted?`00:${Math.max(0,Math.ceil(bomb.timer)).toString().padStart(2,'0')}`:'C4',planted);
 }

 dispose():void {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  this.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;geometries.add(object.geometry);
   for(const material of Array.isArray(object.material)?object.material:[object.material]){
    materials.add(material);if((material instanceof THREE.MeshBasicMaterial||material instanceof THREE.MeshStandardMaterial)&&material.map)textures.add(material.map);
   }
  });
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());textures.forEach(texture=>texture.dispose());
  this.clear();this.siteRoots.clear();this.siteMaterials.clear();
 }
}
