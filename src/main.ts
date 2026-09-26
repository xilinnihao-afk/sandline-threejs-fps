import {wallDistance} from './game/collision';
import {startup} from './ui/startup';
import {requestGameFullscreen} from './ui/mobileBrowser';
import {telemetry} from './analytics/telemetry';
import {ViewArmsIK,hideLegacyArms} from './render/viewArmsIK';
import * as THREE from 'three';
import {Simulation,eyeHeight,WEAPONS} from './game/simulation';
import {DEFAULT_SETTINGS,EMPTY_INPUT,WEAPON_KINDS,type Settings,type PlayerInput} from './game/types';
import {MAP_BOXES} from './game/map';
import {createWorld} from './render/world';
import {loadCharacterAssets,createCharacter,updateCharacter,characterDiagnostics,registerCharacterHit,solveCharacterFootIK} from './render/characters';
import {FirstPersonController} from './render/firstPersonController';
import {createViewWeapon,updateViewWeapon,WEAPON_PRESENTATION,loadWeaponAssets} from './render/weapons';
import {CombatEffects,createMuzzleFlash} from './render/effects';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {inspectCanvas} from './render/inspect';
import {GameAudio} from './render/audio';
import {GameUI} from './ui/ui';
import {InputController} from './ui/input';
import {loadPlayerArms, type PlayerArmsRig} from './render/fpsPresentation';


const params=new URLSearchParams(location.search),debug=params.has('debug');
const settings={...DEFAULT_SETTINGS};
try{const saved=JSON.parse(localStorage.getItem('sandline-settings-v1')||'{}');if(typeof saved.sensitivity==='number')settings.sensitivity=Math.min(2,Math.max(.3,saved.sensitivity));if(typeof saved.volume==='number')settings.volume=Math.max(0,Math.min(1,saved.volume));if(typeof saved.aimAssist==='boolean')settings.aimAssist=saved.aimAssist;if(saved.quality==='high')settings.quality='high';}catch{}
const simulation=new Simulation(20260915,settings),audio=new GameAudio();audio.setVolume(settings.volume);
const canvas=document.createElement('canvas');canvas.id='game-canvas';canvas.setAttribute('aria-label','沙线行动三维战场');canvas.tabIndex=0;document.body.appendChild(canvas);
let renderer:THREE.WebGLRenderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:debug});}catch{startup.fail('当前浏览器未能启用 WebGL，请使用新版 Chrome 或 Safari，并开启硬件加速。','webgl');throw new Error('WebGL initialization failed');}
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.autoClear=false;renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
startup.stage('正在加载人物与动画…');
await loadCharacterAssets();
startup.stage('正在加载枪械模型…');
await loadWeaponAssets();
startup.stage('正在加载场景贴图…');
const scene=new THREE.Scene();scene.background=new THREE.Color('#a5c5d3');scene.fog=new THREE.Fog('#bdcbd0',48,115);const world=createWorld();scene.add(world);await world.userData.assetsReady;
const worldCasters:THREE.Mesh[]=[];world.traverse(o=>{if(o instanceof THREE.Mesh&&o.castShadow)worldCasters.push(o);});
const proxyParts=MAP_BOXES.map(b=>new THREE.BoxGeometry(b.w,b.h,b.d).translate(b.x,b.h/2,b.z));
const shadowProxy=new THREE.Mesh(mergeGeometries(proxyParts),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false}));proxyParts.forEach(g=>g.dispose());shadowProxy.castShadow=true;scene.add(shadowProxy);
scene.add(new THREE.HemisphereLight('#d1e4f1','#947655',1.35));
const sun=new THREE.DirectionalLight('#ffe2b6',2.8);sun.position.set(-18,30,14);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:90});sun.shadow.normalBias=.035;sun.shadow.bias=-.00025;scene.add(sun);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();scene.environment=environment;scene.environmentIntensity=.35;
const camera=new THREE.PerspectiveCamera(58,1,.08,120);camera.rotation.order='YXZ';
startup.stage('正在初始化物理引擎…');
const firstPerson=await FirstPersonController.create(camera,MAP_BOXES);
const actors=simulation.state.actors.map(a=>{const group=createCharacter(a.team);scene.add(group);return group;});
const weaponScene=new THREE.Scene();weaponScene.environment=environment;weaponScene.environmentIntensity=.65;weaponScene.add(new THREE.HemisphereLight('#d5e7ea','#76684c',.88));const weaponLight=new THREE.DirectionalLight('#ffdbab',1.75);weaponLight.position.set(-2,4,3);weaponScene.add(weaponLight);
const weaponCamera=new THREE.PerspectiveCamera(56,1,.02,5);weaponScene.add(weaponCamera);
const weaponRoot=new THREE.Group();weaponRoot.position.set(.25,-.235,-.49);weaponScene.add(weaponRoot);const weapons=Object.fromEntries(WEAPON_KINDS.map(kind=>[kind,createViewWeapon(kind)])) as Record<typeof WEAPON_KINDS[number],THREE.Group>;weaponRoot.add(...Object.values(weapons));
if(params.has('arms-only'))weaponRoot.visible=false;
let equippedWeapon=simulation.state.player.weapon,equipAge=1;
let armsRig:PlayerArmsRig|null=null;let armsIK:ViewArmsIK|null=null;
startup.stage('正在加载第一人称手臂…');
if(params.get('arms')!=='off'){
 try{
  armsRig=await loadPlayerArms(weaponCamera,weaponScene,{position:[0,0,0],targetSpan:.60});
  armsIK=new ViewArmsIK(armsRig,weaponCamera);
  Object.values(weapons).forEach(hideLegacyArms);
 }catch(error){console.warn('FPS arms asset unavailable; keeping authored viewmodel',error);}
}
startup.stage('正在准备画面…');
const flash=createMuzzleFlash();weaponScene.add(flash);const muzzleLight=new THREE.PointLight('#ffd291',0,2,2);weaponScene.add(muzzleLight);
const effects=new CombatEffects();scene.add(effects.root);
const tracerMaterial=new THREE.LineBasicMaterial({color:'#f4c47b',transparent:true,opacity:.58});
const traces=Array.from({length:24},()=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));const line=new THREE.Line(geometry,tracerMaterial);line.visible=false;line.frustumCulled=false;scene.add(line);return {line,left:0};});let traceIndex=0;
let frozen=false,reducedMotion=false,last=performance.now(),accumulator=0,frames=0,uiTick=0,statsTick=0,fps=60,started=false,lastPhase='menu',cameraKick=0;
let input:InputController;
let pendingInput:PlayerInput={...EMPTY_INPUT};
function releasePointer(){if(document.pointerLockElement)document.exitPointerLock();}
function lockPointer(){if(!matchMedia('(pointer: coarse)').matches&&!params.has('touch')){canvas.requestPointerLock()?.catch(()=>{});}}
function start(){telemetry.event('game_start');audio.stop();audio.unlock().then(()=>audio.ui('confirm')).catch(()=>{});simulation.start();effects.reset();cameraKick=0;started=true;frozen=false;pendingInput={...EMPTY_INPUT};input?.clear();if(innerHeight>innerWidth)pauseForFocusLoss();else lockPointer();ui.update(simulation.state);}
function resume(){if(innerHeight>innerWidth){pauseForFocusLoss();return;}simulation.setPaused(false);input.clear();pendingInput={...EMPTY_INPUT};audio.unlock().catch(()=>{});lockPointer();ui.update(simulation.state);}
function setSettings(patch:Partial<Settings>){Object.assign(settings,patch);audio.setVolume(settings.volume);resize();try{localStorage.setItem('sandline-settings-v1',JSON.stringify(settings));}catch{}}
const ui=new GameUI({start,resume,restart:start,menu:()=>{simulation.menu();input.clear();audio.stop();audio.ui('cancel');effects.reset();releasePointer();},settings:setSettings,purchase:item=>{simulation.purchase(item);ui.update(simulation.state);},audioTest:()=>{void audio.test();},audioEnable:()=>{if(settings.volume===0)setSettings({volume:.6});void audio.resumeIfNeeded();},fullscreen:requestGameFullscreen});
input=new InputController(canvas);
addEventListener('pointerdown',event=>{if(event.isTrusted)void audio.resumeIfNeeded();},{passive:true,capture:true});
addEventListener('keydown',event=>{if(event.isTrusted&&!event.metaKey&&!event.ctrlKey)void audio.resumeIfNeeded();});
let mobileRenderScale=1, slowFrameSeconds=0, qualityCooldown=0;
function resize(){const width=innerWidth,height=innerHeight;renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==='high'?1.5:1.15)*mobileRenderScale);renderer.setSize(width,height);camera.aspect=width/height;camera.fov=height>width?76:width/height>2?56:62;camera.updateProjectionMatrix();weaponCamera.aspect=width/height;weaponCamera.updateProjectionMatrix();const shadowSize=settings.quality==='high'?2048:1024;if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;}worldCasters.forEach(m=>m.castShadow=settings.quality==='high');shadowProxy.visible=settings.quality==='low';if(height>width)pauseForFocusLoss();}
resize();addEventListener('resize',resize);
function pauseForFocusLoss(){if(simulation.state.phase==='playing'||simulation.state.phase==='prep'||simulation.state.phase==='planted'){simulation.setPaused(true);input.clear();pendingInput={...EMPTY_INPUT};audio.stop();releasePointer();ui.update(simulation.state);}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseForFocusLoss();});
addEventListener('blur',pauseForFocusLoss);
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&started&&!params.has('touch'))pauseForFocusLoss();});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();telemetry.event('runtime_failure',{kind:'webgl_context_lost'});pauseForFocusLoss();ui.setOffline('画面连接中断，请刷新重试');});

let diagnosticsElement:HTMLPreElement|null=null;
let canvasMetrics:ReturnType<typeof inspectCanvas>|null=null;
function diagnostics(){const s=simulation.state;const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');let armMaterial:any=null;armsRig?.model.traverse(o=>{if(!armMaterial&&o instanceof THREE.Mesh){const m=Array.isArray(o.material)?o.material[0]:o.material;armMaterial={type:m.type,map:!!(m as any).map,normalMap:!!(m as any).normalMap,roughnessMap:!!(m as any).roughnessMap,metalnessMap:!!(m as any).metalnessMap};}});return {version:'0.3',canvas:canvasMetrics,environment:world.userData.textureStatus,phase:s.phase,paused:s.paused,frozen,frame:frames,time:+s.time.toFixed(2),round:s.round,score:[s.blueScore,s.redScore],player:{x:+s.player.x.toFixed(2),z:+s.player.z.toFixed(2),yaw:+s.player.yaw.toFixed(3),health:s.player.health,ammo:s.player.guns[s.player.weapon].ammo,reserve:s.player.guns[s.player.weapon].reserve,weapon:s.player.weapon,grenades:s.player.grenades,reloadLeft:s.player.guns[s.player.weapon].reloadLeft,crouched:s.player.crouched,kills:s.totalKills},actors:s.actors.map((a,i)=>({id:a.id,x:+a.x.toFixed(2),z:+a.z.toFixed(2),health:a.health,kills:a.kills,animation:actors[i].userData.animation})),viewmodel:weapons[s.player.weapon].userData.pose,arms:armMaterial,gripErrors:armsIK?.errors,character:characterDiagnostics(),effects:effects.diagnostics(),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,shadowSize:sun.shadow.mapSize.x},fps:+fps.toFixed(1),pixelRatio:renderer.getPixelRatio(),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',physics:{engine:'Rapier3D kinematic proxy + map colliders; custom hitscan gameplay',timestep:1/60,colliders:MAP_BOXES.length,actors:6,grenades:s.grenades.length,controller:firstPerson.diagnostics()},audio:audio.diagnostics()};}
function applyTestState(name:string){canvasMetrics=null;frozen=false;cameraKick=0;effects.reset();actors.forEach(a=>a.userData.rig.lastTime=Infinity);simulation.seed(42);simulation.start();const s=simulation.state;if(name==='menu'){simulation.menu();}else if(['active-play','pause','reload','explosion','operators','death'].includes(name)){
 s.phase='playing';s.roundTime=76;s.player.x=3.1;s.player.z=11;s.player.yaw=-.04;s.player.pitch=-.01;
 Object.assign(s.actors[1],{x:-2.7,z:10,yaw:0});Object.assign(s.actors[2],{x:4.2,z:3,yaw:0});Object.assign(s.actors[3],{x:3,z:-2,yaw:Math.PI});Object.assign(s.actors[4],{x:-2.5,z:-5,yaw:Math.PI});Object.assign(s.actors[5],{x:18,z:-6,yaw:Math.PI});if(name==='pause')s.paused=true;
 const requested=params.get('weapon');if(WEAPON_KINDS.includes(requested as any))s.player.weapon=requested as typeof s.player.weapon;
 if(name==='reload'){s.player.guns[s.player.weapon].ammo=3;simulation.reload(s.player);s.player.guns[s.player.weapon].reloadLeft=WEAPONS[s.player.weapon].reload*(1-Math.max(.001,Math.min(.999,Number(params.get('reloadProgress')??.34))));}
 if(name==='explosion'){effects.emit({type:'explosion',x:3.05,y:.08,z:6.2},5);const age=Math.max(0,Math.min(4,Number(params.get('explosionAge')??.24)));for(let t=0;t<age;t+=1/120)effects.update(Math.min(1/120,age-t),[],camera,innerHeight);}
 if(name==='death'){s.player.x=3.3;s.player.z=10;s.player.pitch=-.48;Object.assign(s.actors[2],{x:3.3,z:7,yaw:0,moving:false});updateCharacter(actors[2],s.actors[2],s.time,1/60);s.actors[2].health=0;const age=Math.max(0,Math.min(1.25,Number(params.get('deathAge')??1.25)));for(let t=0;t<age;t+=1/60)updateCharacter(actors[2],s.actors[2],s.time,Math.min(1/60,age-t));}
 if(name==='operators'){s.player.x=3.3;s.player.z=11;s.player.pitch=-.05;Object.assign(s.actors[2],{x:4.4,z:7,yaw:.15});Object.assign(s.actors[3],{x:2.6,z:5.3,yaw:Math.PI});}
 }else if(name==='matchEnd'){s.phase='matchEnd';s.blueScore=3;s.redScore=1;s.round=4;s.winner='blue';s.totalKills=8;s.totalDeaths=2;}else if(name==='spectator'){s.phase='playing';s.player.health=0;s.spectating=s.actors[1];}else throw new Error('Unknown capture state '+name);equippedWeapon=s.player.weapon;equipAge=1;input.clear();ui.update(s);return {state:name};}
if(debug){
 const panel=document.createElement('details');panel.id='qa-panel';panel.style.cssText='position:fixed;z-index:1000;left:8px;bottom:8px;color:white;background:#152023e8;font:11px monospace;max-width:min(540px,90vw);max-height:80vh;overflow:auto;padding:7px;';panel.innerHTML='<summary>开发验证</summary><div id="qa-actions"></div><pre id="qa-metrics" style="white-space:pre-wrap"></pre><pre id="qa-result" style="white-space:pre-wrap"></pre>';document.body.appendChild(panel);diagnosticsElement=panel.querySelector('pre');
 const action=(label:string,handler:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='font:12px system-ui;padding:10px;margin:3px;';b.addEventListener('click',handler);panel.querySelector('#qa-actions')!.appendChild(b);};
 for(const [label,state] of [['战斗画面','active-play'],['人物画面','operators'],['换弹画面','reload'],['爆炸画面','explosion'],['结算画面','matchEnd'],['观战画面','spectator'],['菜单画面','menu']])action(label,()=>applyTestState(state));
 action('音效试听',()=>{void audio.test();});
 action('冻结 / 继续',()=>{frozen=!frozen;});
 action('自动对局自检',()=>{const test=new Simulation(42);test.start();let ticks=0,hits=0;while(test.state.phase!=='matchEnd'&&ticks<36000){test.update(1/60,EMPTY_INPUT,true);hits+=test.events.filter(e=>e.type==='hit').length;test.events=[];ticks++;}panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'bot-match',passed:test.state.phase==='matchEnd',seconds:ticks/60,score:[test.state.blueScore,test.state.redScore],hits});});
 action('多指输入自检',()=>{applyTestState('active-play');frozen=true;input.clear();const joy=document.getElementById('joystick')!,look=document.getElementById('look-zone')!,fire=document.getElementById('fire-button')!;const j=joy.getBoundingClientRect(),l=look.getBoundingClientRect(),f=fire.getBoundingClientRect();
  const send=(el:Element,type:string,id:number,x:number,y:number)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1,button:0,isPrimary:id===71}));
  send(joy,'pointerdown',71,j.x+j.width/2,j.y+j.height/2);send(joy,'pointermove',71,j.x+j.width/2+28,j.y+j.height/2-25);send(look,'pointerdown',72,l.x+l.width/2,l.y+l.height/2);send(look,'pointermove',72,l.x+l.width/2+35,l.y+l.height/2-12);send(fire,'pointerdown',73,f.x+f.width/2,f.y+f.height/2);const active=input.consume();for(const [el,id,r] of [[joy,71,j],[look,72,l],[fire,73,f]] as const)send(el,'pointercancel',id,r.x,r.y);const canceled=input.consume();input.clear();panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'synthetic-multitouch',passed:Math.abs(active.moveX)>.1&&Math.abs(active.moveZ)>.1&&Math.abs(active.lookDX)>0&&active.fire&&!canceled.fire&&canceled.moveX===0&&canceled.moveZ===0,active,canceled});
 });
 (window as any).__THREE_GAME_DIAGNOSTICS__={renderer:renderer.info,get state(){return diagnostics();}};
 (window as any).__THREE_GAME_TEST_HOOKS__={seed:(n:number)=>simulation.seed(n),setState:applyTestState,setPausedForScreenshot:(v:boolean)=>{frozen=v;},setReducedMotion:(v:boolean)=>{reducedMotion=v;},hideDebugUi:()=>{panel.style.display='none';}};
 const capture=params.get('capture');if(capture){applyTestState(capture);frozen=!params.has('motion');panel.style.display='none';reducedMotion=frozen;}
}

function animate(now:number){requestAnimationFrame(animate);const delta=Math.min((now-last)/1000,.1);last=now;fps=fps*.95+(1/Math.max(delta,.001))*.05;frames++;
 // Reduce GPU pixel load only after sustained slow frames, never change aim gain with FPS.
 if((matchMedia('(pointer: coarse)').matches||params.has('touch'))&&!document.hidden&&!simulation.state.paused&&!frozen){
  qualityCooldown=Math.max(0,qualityCooldown-delta);
  slowFrameSeconds=fps<48?slowFrameSeconds+delta:Math.max(0,slowFrameSeconds-delta*2);
  if(slowFrameSeconds>3&&qualityCooldown===0&&mobileRenderScale>.65){mobileRenderScale=Math.max(.65,mobileRenderScale-.1);slowFrameSeconds=0;qualityCooldown=6;resize();}
 }
 const intent=input.consume(delta);if(intent.pause){if(simulation.state.paused)resume();else{simulation.setPaused(true);releasePointer();audio.stop();audio.ui('pause');input.clear();}intent.pause=false;}
 if(!frozen&&!simulation.state.paused){pendingInput={...intent,fire:pendingInput.fire||intent.fire,lookDX:pendingInput.lookDX+intent.lookDX,lookDY:pendingInput.lookDY+intent.lookDY,reload:pendingInput.reload||intent.reload,grenade:pendingInput.grenade||intent.grenade,interact:pendingInput.interact||intent.interact,switchWeapon:intent.switchWeapon||pendingInput.switchWeapon};accumulator+=delta;while(accumulator>=1/60){simulation.update(1/60,pendingInput);accumulator-=1/60;pendingInput={...pendingInput,fire:false,lookDX:0,lookDY:0,reload:false,grenade:false,interact:false,switchWeapon:null};}}
 else {accumulator=0;pendingInput={...EMPTY_INPUT};}
 const s=simulation.state;telemetry.setGame(s.phase,s.paused||frozen);audio.setScene(s.paused||frozen?'paused':s.phase==='menu'||s.phase==='matchEnd'?'menu':'combat');if(s.phase==='matchEnd'&&lastPhase!=='matchEnd'){releasePointer();input.clear();pendingInput={...EMPTY_INPUT};if(!debug)try{const previous=JSON.parse(localStorage.getItem('sandline-stats-v1')||'{}');localStorage.setItem('sandline-stats-v1',JSON.stringify({matches:(Number(previous.matches)||0)+1,wins:(Number(previous.wins)||0)+(s.winner==='blue'?1:0),kills:(Number(previous.kills)||0)+s.totalKills,deaths:(Number(previous.deaths)||0)+s.totalDeaths}));}catch{}}lastPhase=s.phase;audio.announce(simulation.events,s);for(const e of simulation.events){const actor=e.actorId===undefined?null:s.actors[e.actorId],listener=s.player.health>0?s.player:(s.spectating||s.player);const dx=(e.x??actor?.x??listener.x)-listener.x,dz=(e.z??actor?.z??listener.z)-listener.z,dist=Math.hypot(dx,dz),pan=dist>.2?Math.max(-.85,Math.min(.85,(dx*Math.cos(listener.yaw)-dz*Math.sin(listener.yaw))/dist)):0;if(e.type==='explosion'){const dy=eyeHeight(listener)-(e.y??0),d=Math.hypot(dx,dy,dz);e.occluded=d>.001&&wallDistance(e.x!,e.y!,e.z!,-dx/d,dy/d,-dz/d)<d-.02;}if((e.type!=='hit'&&e.type!=='kill')||e.actorId===0)audio.play(e,dist,pan);
  let visualEvent=e;
  if(e.type==='shot'){
   const source=actor?.player?weapons[e.weapon??s.player.weapon]:actor&&!actor.player?actors[actor.id].userData.rig.gun:undefined;
   const muzzle=source?.getObjectByName('muzzle')?.getWorldPosition(new THREE.Vector3());
   const eject=source?.getObjectByName('eject')?.getWorldPosition(new THREE.Vector3());
   visualEvent={...e,x:muzzle?.x??e.x,y:muzzle?.y??e.y,z:muzzle?.z??e.z,ejectX:eject?.x,ejectY:eject?.y,ejectZ:eject?.z};
   if(actor?.player){
    const shotWeapon=e.weapon??s.player.weapon;
    cameraKick=Math.min(.18,cameraKick+WEAPON_PRESENTATION[shotWeapon].cameraKick);

   }
  }
  if(e.type==='hit'&&e.targetId!==undefined){
   const target=s.actors[e.targetId],source=e.actorId===undefined?undefined:s.actors[e.actorId];
   if(target&&actors[e.targetId]){
    const dx=(source?.x??target.x+Math.sin(target.yaw)) - target.x,dz=(source?.z??target.z-Math.cos(target.yaw)) - target.z;
    const localSide=dx*Math.cos(target.yaw)-dz*Math.sin(target.yaw);
    registerCharacterHit(actors[e.targetId],Math.sign(localSide)||1,!!e.headshot);
   }
   const nx=target.x-(source?.x??target.x),nz=target.z-(source?.z??target.z),nl=Math.hypot(nx,nz)||1;
   effects.emit({...e,x:target.x,y:e.headshot?eyeHeight(target):eyeHeight(target)*.7,z:target.z,normalX:nx/nl,normalY:e.headshot?.18:.06,normalZ:nz/nl},dist);
  }
  else effects.emit(visualEvent,dist);
  if(e.type==='shot'&&e.tracer){const trace=traces[traceIndex++%traces.length];const p=trace.line.geometry.getAttribute('position') as THREE.BufferAttribute;p.setXYZ(0,visualEvent.x!,visualEvent.y!-.015,visualEvent.z!);p.setXYZ(1,e.endX!,e.endY!,e.endZ!);p.needsUpdate=true;trace.left=e.actorId===0?.055:.042;trace.line.visible=true;}}
 simulation.events=[];
 cameraKick*=Math.exp(-delta/.115);
 const menu=s.phase==='menu';const view=s.player.health>0?s.player:s.spectating;
 const visualDelta=frozen||s.paused?0:delta;
 for(let i=0;i<actors.length;i++){updateCharacter(actors[i],s.actors[i],s.time,visualDelta);if(!menu)solveCharacterFootIK(actors[i],firstPerson,visualDelta);actors[i].visible=menu||s.actors[i]!==view;}
 if(menu){const t=reducedMotion?0:now*.000055;camera.position.set(12+Math.sin(t)*1.5,3.6,16);camera.lookAt(-1,1.3,-1);}else if(view){firstPerson.update({x:view.x,y:eyeHeight(view),z:view.z,speed:view.moving?(view.crouched?1.65:3.9):0,moving:view.moving,pitch:view.pitch,yaw:view.yaw,lookDX:intent.lookDX,lookDY:intent.lookDY,cameraKick},visualDelta,reducedMotion||s.paused);}
 const p=s.player,gun=p.guns[p.weapon],age=s.time-p.shotTime;
 if(equippedWeapon!==p.weapon){equippedWeapon=p.weapon;equipAge=0;}
 equipAge=Math.min(1,equipAge+visualDelta/.18);
 for(const kind of WEAPON_KINDS){
  weapons[kind].visible=kind===p.weapon;
  if(kind===p.weapon){
   updateViewWeapon(weapons[kind],p,s.time,visualDelta);

  }
 }
 weaponRoot.position.x=p.weapon==='pistol'?.16:.25;
 weaponRoot.position.y=(p.weapon==='pistol'?-.14:-.235)-Math.max(0,1-(s.time-p.throwTime)/.65)*.3-.16*(1-equipAge)*(1-equipAge)+Math.sin(s.time*1.7)*.002;
 weaponRoot.updateWorldMatrix(true,true);armsIK?.update(weapons[p.weapon]);const muzzle=weapons[p.weapon].getObjectByName('muzzle')!;muzzle.getWorldPosition(flash.position);muzzle.getWorldQuaternion(flash.quaternion);flash.position.add(new THREE.Vector3(0,0,-.075).applyQuaternion(flash.quaternion));
 const flashAge=age/.075,flashVisible=age>=0&&age<.075&&gun.reloadLeft===0;
 flash.material.rotation=p.shotTime*17;flash.material.opacity=flashVisible?(.72+Math.sin(age*190)*.16):0;flash.scale.setScalar(WEAPON_PRESENTATION[p.weapon].flashScale*(1+Math.max(0,flashAge)*.24));flash.visible=flashVisible;
 flash.children.forEach((child,i)=>{child.visible=flashVisible;child.scale.setScalar(1+(i===0?Math.max(0,flashAge)*.4:Math.max(0,flashAge)*.18));});
 muzzleLight.position.copy(flash.position);muzzleLight.intensity=flashVisible?(2.2*(1-Math.min(1,flashAge))):0;
 effects.update(visualDelta,s.grenades,camera,innerHeight);
 for(const trace of traces){if(!frozen&&!s.paused)trace.left-=delta;if(trace.left<=0)trace.line.visible=false;}
 renderer.info.reset();renderer.clear();renderer.render(scene,camera);if(!menu&&p.health>0&&s.phase!=='matchEnd'){renderer.clearDepth();renderer.render(weaponScene,weaponCamera);}
 startup.finish();
 uiTick+=delta;if(uiTick>.05){ui.update(s);ui.setAudioStatus(audio.status());uiTick=0;}
 if(debug&&!canvasMetrics&&frames>4)canvasMetrics=inspectCanvas(renderer.getContext());
 statsTick+=delta;if(debug&&statsTick>.3){if(diagnosticsElement)diagnosticsElement.textContent=JSON.stringify(diagnostics());statsTick=0;}
}
requestAnimationFrame(animate);

async function offline(){if(!import.meta.env.PROD||debug){ui.setOffline('开发验证 · 离线缓存使用正式入口');return;}if(!('serviceWorker' in navigator)||!isSecureContext){ui.setOffline('局域网试玩 · 离线安装需 HTTPS');return;}
 try{ui.setOffline('正在缓存离线资源…');const reg=await navigator.serviceWorker.register(new URL('./sw.js',location.href));await navigator.serviceWorker.ready;const check=()=>{const worker=navigator.serviceWorker.controller||reg.active;if(!worker)return;const channel=new MessageChannel();channel.port1.onmessage=e=>{if(e.data.ready)ui.setOffline('离线就绪 · 可添加到主屏幕');};worker.postMessage('CACHE_STATUS',[channel.port2]);};check();navigator.serviceWorker.addEventListener('controllerchange',check);reg.addEventListener('updatefound',()=>{const installing=reg.installing;installing?.addEventListener('statechange',()=>{if(installing.state==='installed'&&reg.active)ui.setOffline('新版本已缓存 · 关闭游戏后更新');});});}catch{ui.setOffline('缓存未完成 · 当前仍可在线试玩');}}
offline();
