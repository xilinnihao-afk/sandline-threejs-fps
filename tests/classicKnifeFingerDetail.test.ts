import {ClassicKnifeFingerDetail} from '../src/render/classicKnifeFingerDetail';
import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {loadCPU} from './loadCharacterFixture';import {prepareClassicAkAssets} from '../src/render/classicAk';import {ClassicViewArms} from '../src/render/classicViewArms';import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';import {Simulation} from '../src/game/simulation';

test('knife finger refinement preserves actual glove boundaries, source assets and gun restoration',async t=>{
 const [a,b]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(x=>loadCPU('public/assets/runtime/'+x+'.glb')));prepareClassicAkAssets(a.scene,b.scene);
 const scene=new T.Scene(),arms=new ClassicViewArms(new T.PerspectiveCamera(56,16/9,.02,5),scene),other=new ClassicViewArms(new T.PerspectiveCamera(),scene),knife=createViewWeapon('knife');scene.add(knife);
 const mesh=arms.model.getObjectByName('Object_9') as T.SkinnedMesh,source=mesh.geometry,sourceAttributes=Object.fromEntries(Object.entries(source.attributes).map(([n,v])=>[n,Array.from(v.array)]));
 // Roundness is bounded in the cached construction pose. The final knife
 // articulation changes angles and length; its contact/seams are tested separately.
 const transforms=()=>{const list:{node:T.Object3D;q:T.Quaternion;s:T.Vector3}[]=[];arms.model.traverse(node=>{if(node instanceof T.Bone)list.push({node,q:node.quaternion.clone(),s:node.scale.clone()});});return list;};
 let constructionPose:ReturnType<typeof transforms>;
 const build=ClassicKnifeFingerDetail.prototype.update;
 t.mock.method(ClassicKnifeFingerDetail.prototype,'update',function(this:ClassicKnifeFingerDetail,enabled:boolean){build.call(this,enabled);if(enabled&&!constructionPose)constructionPose=transforms();});
 const restore=(pose:ReturnType<typeof transforms>)=>{for(const {node,q,s}of pose){node.quaternion.copy(q);node.scale.copy(s);}scene.updateMatrixWorld(true);};
 const player=new Simulation(1).state.player;player.weapon='knife';player.shotTime=-10;updateViewWeapon(knife,player,0,0);arms.update(knife);scene.updateMatrixWorld(true);
 const detailed=mesh.geometry;assert.notEqual(detailed,source);assert.equal((other.model.getObjectByName('Object_9') as T.SkinnedMesh).geometry,source);
 const world=()=>{mesh.skeleton.update();return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld));};
 const approvedPoints=world(),approvedPose=transforms();restore(constructionPose!);
 const points=world();mesh.geometry=source;const original=world();mesh.geometry=detailed;
 const faces=(geometry:T.BufferGeometry,vs:T.Vector3[])=>{const index=geometry.index!;return Array.from({length:index.count/3},(_,i)=>new T.Triangle(...[0,1,2].map(j=>vs[index.getX(i*3+j)]) as [T.Vector3,T.Vector3,T.Vector3]));};
 const originals=faces(source,original),refined=faces(detailed,points);assert.equal(refined.length,originals.length*16);
 let maxDisplacement=0;
 for(const point of points){const distance=Math.min(...originals.map(t=>t.closestPointToPoint(point,new T.Vector3()).distanceTo(point)));maxDisplacement=Math.max(maxDisplacement,distance);assert.ok(distance<.000901,'finger refinement changes the calibrated surface by more than 0.9 mm');}
 assert.ok(maxDisplacement>.0002,'finger silhouette remains unrefined');
 for(const face of refined)assert.ok(face.getArea()>1e-12,'rounded finger has a collapsed triangle');
 const boundary=(geometry:T.BufferGeometry,vs:T.Vector3[])=>{
  const unique:T.Vector3[]=[],ids=vs.map(p=>{let id=unique.findIndex(q=>p.distanceToSquared(q)<1e-12);if(id<0){id=unique.length;unique.push(p);}return id;}),edges=new Map<string,{a:number;b:number;n:number}>(),index=geometry.index!;
  for(let i=0;i<index.count;i+=3)for(let j=0;j<3;j++){const a=ids[index.getX(i+j)],b=ids[index.getX(i+(j+1)%3)],key=a<b?a+':'+b:b+':'+a,e=edges.get(key)??{a,b,n:0};e.n++;edges.set(key,e);}
  for(const e of edges.values())assert.ok(e.n<=2,'finger refinement creates a non-manifold edge');
  return [...edges.values()].filter(e=>e.n===1).map(e=>new T.Line3(unique[e.a],unique[e.b]));
 };
 const sourceRim=boundary(source,original),detailedRim=boundary(detailed,points);assert.equal(detailedRim.length,sourceRim.length*4);
 let seamError=0;for(const line of detailedRim)for(const p of [line.start,line.end,line.getCenter(new T.Vector3())]){
  const d=Math.min(...sourceRim.map(e=>e.closestPointToPoint(p,true,new T.Vector3()).distanceTo(p)));seamError=Math.max(seamError,d);assert.ok(d<1e-7,'finger skin pulls away from its original glove boundary');
 }
 for(const name of ['position','normal','uv','skinWeight'])for(const value of detailed.getAttribute(name).array)assert.ok(Number.isFinite(value));
 const normals=detailed.getAttribute('normal');for(let i=0;i<normals.count;i++)assert.ok(Math.abs(new T.Vector3().fromBufferAttribute(normals,i).length()-1)<1e-5);
 restore(approvedPose);
 for(let repeat=0;repeat<5;repeat++){arms.update(knife);assert.equal(mesh.geometry,detailed,'detail rebuilt during animation');world().forEach((p,i)=>assert.ok(p.distanceTo(approvedPoints[i])<1e-9,'cached fingers drift'));}
 const gun=createViewWeapon('m4');scene.add(gun);player.weapon='m4';updateViewWeapon(gun,player,5,0);arms.update(gun);assert.equal(mesh.geometry,source,'gun does not restore exact source geometry');
 for(const [name,values] of Object.entries(sourceAttributes))assert.deepEqual(Array.from(source.getAttribute(name).array),values,'shared source attribute mutated');
 player.weapon='knife';updateViewWeapon(knife,player,6,0);arms.update(knife);assert.equal(mesh.geometry,detailed,'returning to knife unnecessarily rebuilds skin');
 console.log('Right finger detail geometry',{triangles:refined.length,maxDisplacement,seamError,boundarySegments:detailedRim.length});
});
test('closed knife fingers retain narrow real surface gaps without crossing neighboring digits',async()=>{
const [a,b]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(x=>loadCPU('public/assets/runtime/'+x+'.glb')));prepareClassicAkAssets(a.scene,b.scene);
const scene=new T.Scene(),arms=new ClassicViewArms(new T.PerspectiveCamera(56,16/9,.02,5),scene),knife=createViewWeapon('knife');scene.add(knife);const player=new Simulation(1).state.player;player.weapon='knife';player.shotTime=-10;updateViewWeapon(knife,player,0,0);arms.update(knife);scene.updateMatrixWorld(true);
const mesh=arms.model.getObjectByName('Object_9') as T.SkinnedMesh;mesh.skeleton.update();const idx=mesh.geometry.index!,si=mesh.geometry.attributes.skinIndex;
const chains={thumb:['Bone05_32','Bone06_31','Bone07_30'],index:['Bone22_28','Bone23_27'],middle:['Bone18_25','Bone19_24'],ring:['Bone14_22','Bone15_21'],pinky:['Bone10_19','Bone11_18']};
const points=Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld));
const groups=Object.fromEntries(Object.entries(chains).map(([name,names])=>{const triangles:T.Triangle[]=[];for(let i=0;i<idx.count;i+=3){const ids=[0,1,2].map(j=>idx.getX(i+j));if(ids.every(id=>names.includes(mesh.skeleton.bones[si.getX(id)].name)))triangles.push(new T.Triangle(...ids.map(id=>points[id]) as [T.Vector3,T.Vector3,T.Vector3]));}return [name,triangles];}));
function segment(a:T.Vector3,b:T.Vector3,c:T.Vector3,d:T.Vector3){const u=b.clone().sub(a),v=d.clone().sub(c),w=a.clone().sub(c),aa=u.dot(u),bb=u.dot(v),cc=v.dot(v),dd=u.dot(w),ee=v.dot(w),den=aa*cc-bb*bb;let s=den>1e-16?T.MathUtils.clamp((bb*ee-cc*dd)/den,0,1):0,t=(bb*s+ee)/cc;if(t<0){t=0;s=T.MathUtils.clamp(-dd/aa,0,1);}else if(t>1){t=1;s=T.MathUtils.clamp((bb-dd)/aa,0,1);}return a.clone().addScaledVector(u,s).distanceTo(c.clone().addScaledVector(v,t));}
const metrics:any={triangles:idx.count/3,vertices:points.length};
for(const [an,bn] of [['thumb','index'],['index','middle'],['middle','ring'],['ring','pinky']]){let gap=Infinity,crossings=0;
 for(const p of groups[an])for(const q of groups[bn]){const x=[p.a,p.b,p.c],y=[q.a,q.b,q.c],ba=new T.Box3().setFromPoints(x),bb=new T.Box3().setFromPoints(y);if(ba.distanceToPoint(bb.getCenter(new T.Vector3()))>bb.getSize(new T.Vector3()).length()/2+gap)continue;
 for(const v of x)gap=Math.min(gap,q.closestPointToPoint(v,new T.Vector3()).distanceTo(v));for(const v of y)gap=Math.min(gap,p.closestPointToPoint(v,new T.Vector3()).distanceTo(v));
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)gap=Math.min(gap,segment(x[i],x[(i+1)%3],y[j],y[(j+1)%3]));
 if(ba.intersectsBox(bb))for(const [vs,tri] of [[x,q],[y,p]] as const)for(let i=0;i<3;i++){const edge=vs[(i+1)%3].clone().sub(vs[i]),length=edge.length(),ray=new T.Ray(vs[i],edge.normalize()),hit=ray.intersectTriangle(tri.a,tri.b,tri.c,false,new T.Vector3());if(hit){const d=hit.distanceTo(vs[i]);if(d>1e-6&&d<length-1e-6)crossings++;}}
 }
 metrics[an+'-'+bn]={gap,crossings};
}
console.log('Right finger surface gaps',metrics);
for(const pair of ['thumb-index','index-middle','middle-ring','ring-pinky']){
 assert.equal(metrics[pair].crossings,0,pair+' skin triangles cross');
 // The approved raised thumb seats at the guard with a 3.33 mm index gap.
 // The four gripping digits keep their original narrow-gap limit.
 const maximum=pair==='thumb-index'?.0035:.003;
 assert.ok(metrics[pair].gap>.00005&&metrics[pair].gap<maximum,pair+' loses the separated wrap');
}

});
