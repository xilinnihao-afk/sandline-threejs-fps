import {resetWeaponSwitch,weaponReady,weaponSwitchPose,weaponDisplayActor} from './game/weaponSwitch';
import {isAirborne} from './game/jump';
import {BombObjective} from './render/bombObjective';
import {HostageVisuals} from './render/hostages';
import {DefenseObjective} from './render/defenseObjective';
import {MODE_STORAGE_KEY,parseMode,isTeamDeathmatch,allowsWeapon} from './game/offlineModes';
import {GyroAim} from './ui/gyroAim';
import {mobileSettings} from './game/mobileSettings';
import {loadKnifeAsset} from './render/knifeModel';
import {SOLDIER_TEAM_ROSTER} from './render/soldierRoster';
import {wallDistance} from './game/collision';
import {startup} from './ui/startup';
import {requestGameFullscreen} from './ui/mobileBrowser';
import {telemetry} from './analytics/telemetry';
import {GroundWeapons} from './render/groundWeapons';
import {WEAPON_VIEW_OFFSETS} from './render/weaponFraming';
import {loadClassicAkAssets,CLASSIC_AK_OFFSET,CLASSIC_AK_HORIZONTAL_FOV} from './render/classicAk';
import {ClassicViewArms} from './render/classicViewArms';
import * as THREE from 'three';
import {Simulation,eyeHeight,WEAPONS} from './game/simulation';
import {BOT_STORAGE_KEY,parseBotCounts} from './game/botRoster';
import {DEFAULT_SETTINGS,EMPTY_INPUT,WEAPON_KINDS,type Settings,type PlayerInput,type GameEvent} from './game/types';
import {MAP_BOXES,getActiveMap,setActiveMap,type MapId} from './game/map';
import {createSnowWorld} from './render/snowWorld';
import {createWorld} from './render/world';
import {createDust2World} from './render/dust2World';
import {createAssaultWorld} from './render/assaultWorld';
import {createBloodstrikeWorld} from './render/bloodstrikeWorld';
import {prepareBloodstrike} from './game/bloodstrike';
import {prepareAssault,ASSAULT_LANDMARKS} from './game/assault';
import {prepareDust2,DUST2_LANDMARKS} from './game/dust2';
import {characterHitDirection} from './render/characterDeath';
import {loadCharacterAssets,createCharacter,updateCharacter,characterDiagnostics,registerCharacterHit,solveCharacterFootIK} from './render/characters';
import {FirstPersonController} from './render/firstPersonController';
import {createViewWeapon,updateViewWeapon,WEAPON_PRESENTATION,loadImportedWeaponAssets} from './render/weapons';
import {CombatEffects,createMuzzleFlash} from './render/effects';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {inspectCanvas} from './render/inspect';
import {GameAudio} from './render/audio';
import {GameUI} from './ui/ui';
import {InputController} from './ui/input';
import {SNIPER_MAGNIFICATION} from './ui/scope';
import {BASE_HORIZONTAL_FOV,clampViewScale,landscapeViewport,waitForLandscape,worldVerticalFov} from './render/horizontalFov';



const params=new URLSearchParams(location.search),debug=params.has('debug');
const mapArt=debug&&params.get('preview')==='map';if(mapArt)document.body.classList.add('map-art');
const operatorArt=debug&&params.get('preview')==='operators';if(operatorArt)document.body.classList.add('map-art');
const gripArt=debug&&params.get('preview')==='grip';if(gripArt)document.body.classList.add('map-art');
const hitPreview=debug&&params.get('preview')==='hit';let hitPreviewStill=false;
const settings={...DEFAULT_SETTINGS};
try{const saved=JSON.parse(localStorage.getItem('sandline-settings-v1')||'{}');Object.assign(settings,mobileSettings(saved));if(typeof saved.viewScale==='number')settings.viewScale=clampViewScale(saved.viewScale);if(typeof saved.sensitivity==='number')settings.sensitivity=Math.min(2.5,Math.max(.3,saved.sensitivity));if(typeof saved.volume==='number')settings.volume=Math.max(0,Math.min(1,saved.volume));if(typeof saved.aimAssist==='boolean')settings.aimAssist=saved.aimAssist;if(saved.quality==='high')settings.quality='high';}catch{}
if(debug&&params.get('map')==='snow')setActiveMap('snow');
if(debug&&params.get('map')==='dust2'){await prepareDust2();setActiveMap('dust2');}
if(debug&&params.get('map')==='assault'){await prepareAssault();setActiveMap('assault');}
if(debug&&params.get('map')==='bloodstrike'){await prepareBloodstrike();setActiveMap('bloodstrike');}
const createMapWorld=(id:MapId=getActiveMap().id)=>id==='bloodstrike'?createBloodstrikeWorld():id==='assault'?createAssaultWorld():id==='dust2'?createDust2World():id==='snow'?createSnowWorld():createWorld();
await waitForLandscape();
const simulation=new Simulation(20260915,settings),audio=new GameAudio();audio.setVolume(settings.volume);
try{const saved=parseBotCounts(localStorage.getItem(BOT_STORAGE_KEY));simulation.setBotCounts(saved.teammates,saved.enemies);}catch{}
try{simulation.selectMode(parseMode(localStorage.getItem(MODE_STORAGE_KEY)));}catch{}
const canvas=document.createElement('canvas');canvas.id='game-canvas';canvas.setAttribute('aria-label','沙线行动三维战场');canvas.tabIndex=0;document.body.appendChild(canvas);
let renderer:THREE.WebGLRenderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:debug});}catch{startup.fail('当前浏览器未能启用 WebGL，请使用新版 Chrome 或 Safari，并开启硬件加速。','webgl');throw new Error('WebGL initialization failed');}
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.autoClear=false;renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
THREE.DefaultLoadingManager.onProgress=(_url,loaded,total)=>startup.resourceProgress(loaded,total);
startup.stage('正在准备作战资源…');
const scene=new THREE.Scene();scene.background=new THREE.Color('#a5c5d3');scene.fog=new THREE.Fog('#bdcbd0',48,115);let world=createMapWorld();scene.add(world);const defenseObjective=new DefenseObjective();scene.add(defenseObjective);const hostages=new HostageVisuals();scene.add(hostages);const bombObjective=new BombObjective();scene.add(bombObjective);
const worldCasters:THREE.Mesh[]=[];world.traverse(o=>{if(o instanceof THREE.Mesh&&o.castShadow)worldCasters.push(o);});world.userData.shadowCasters=[...worldCasters];
const proxyParts=MAP_BOXES.map(b=>new THREE.BoxGeometry(b.w,b.h,b.d).translate(b.x,b.h/2,b.z));
const shadowProxy=new THREE.Mesh(proxyParts.length?mergeGeometries(proxyParts):new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false}));proxyParts.forEach(g=>g.dispose());shadowProxy.castShadow=true;scene.add(shadowProxy);
const hemisphere=new THREE.HemisphereLight('#d1e4f1','#947655',1.35);scene.add(hemisphere);
const sun=new THREE.DirectionalLight('#ffe2b6',2.8);sun.position.set(-18,30,14);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:90});sun.shadow.normalBias=.035;sun.shadow.bias=-.00025;scene.add(sun);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04).texture;
room.dispose();
let weaponEnvironment=environment;
// These independent downloads used to form a serial startup waterfall.
await Promise.all([
 loadClassicAkAssets(renderer.capabilities.getMaxAnisotropy()),
 loadCharacterAssets(),
 loadKnifeAsset(renderer.capabilities.getMaxAnisotropy()),
 loadImportedWeaponAssets(renderer.capabilities.getMaxAnisotropy()),
 world.userData.assetsReady,
 getActiveMap().id==='assault'?hostages.prepare():Promise.resolve(),
 (async()=>{try{
  const lightProbe=await new RGBELoader().loadAsync(`${import.meta.env.BASE_URL}assets/environment/lighting/studio-small-09-1k.hdr`);
  await waitForLandscape();
  weaponEnvironment=pmrem.fromEquirectangular(lightProbe).texture;lightProbe.dispose();
 }catch(error){console.warn('Weapon reflection probe unavailable; using the room environment',error);}})(),
]);
pmrem.dispose();scene.environment=environment;scene.environmentIntensity=.35;
const camera=new THREE.PerspectiveCamera(58,1,.08,240);camera.rotation.order='YXZ';
startup.stage('正在初始化物理引擎…');
let firstPerson=await FirstPersonController.create(camera,MAP_BOXES);
const actors:THREE.Group[]=[];
const characterPool={blue:[] as THREE.Group[],red:[] as THREE.Group[]};
let rosterOffset=debug?Math.max(0,Math.trunc(Number(params.get('rosterOffset'))||0)):0;
let rosterStarts=0;
function syncCharacterRoster(){
 for(const pool of Object.values(characterPool))for(const group of pool)if(group)group.visible=false;
 actors.length=0;const slots={blue:0,red:0};
 for(const actor of simulation.state.actors){const pool=characterPool[actor.team],slot=slots[actor.team]++,variant=slot+rosterOffset,index=Math.floor(slot/SOLDIER_TEAM_ROSTER[actor.team].length)*SOLDIER_TEAM_ROSTER[actor.team].length+variant%SOLDIER_TEAM_ROSTER[actor.team].length;if(!pool[index]){pool[index]=createCharacter(actor.team,variant);scene.add(pool[index]);}const group=pool[index];group.visible=true;group.userData.rig.lastTime=Infinity;actors.push(group);}
}
syncCharacterRoster();
const weaponScene=new THREE.Scene();weaponScene.environment=weaponEnvironment;
// The view model lives in a separate camera-space scene. World shadows cannot
// reach it: a tightly bounded light supplies the missing hand/rail/scope contact.
const legacyWeaponLighting=debug&&params.get('weaponLighting')==='legacy';
if(legacyWeaponLighting)weaponScene.environment=environment;
weaponScene.environmentIntensity=legacyWeaponLighting ? .65 : .8;
weaponScene.add(new THREE.HemisphereLight('#d5e7ea','#76684c',legacyWeaponLighting ? .88 : .45));
const weaponLight=new THREE.DirectionalLight(legacyWeaponLighting?'#ffdbab':'#f6eade',legacyWeaponLighting?1.75:2.1);
weaponLight.position.set(-2,4,3);
if(!legacyWeaponLighting)weaponLight.target.position.set(.18,-.22,-.9);
weaponLight.castShadow=!legacyWeaponLighting&&!(debug&&params.get('weaponShadows')==='off');
weaponLight.shadow.mapSize.set(1024,1024);
Object.assign(weaponLight.shadow.camera,{left:-.95,right:.95,top:.95,bottom:-.95,near:3,far:8});
weaponLight.shadow.normalBias=.0006;weaponLight.shadow.bias=-.000015;
weaponLight.shadow.camera.updateProjectionMatrix();
weaponScene.add(weaponLight,weaponLight.target);
const weaponFill=new THREE.DirectionalLight('#d5e1eb',legacyWeaponLighting ? .7 : .35);
weaponFill.position.set(3,1,2);weaponScene.add(weaponFill);
const weaponCamera=new THREE.PerspectiveCamera(56,1,.02,5);weaponScene.add(weaponCamera);
const gripCamera=gripArt?new THREE.OrthographicCamera(-.22,.22,.14,-.14,.01,5):null;
const weaponRoot=new THREE.Group();weaponRoot.position.set(.25,-.235,-.49);weaponScene.add(weaponRoot);
type WeaponViews=Record<typeof WEAPON_KINDS[number],THREE.Group>;
const createWeaponViews=()=>Object.fromEntries(WEAPON_KINDS.map(kind=>[kind,createViewWeapon(kind)])) as WeaponViews;
let weapons=createWeaponViews();weaponRoot.add(...Object.values(weapons));
const weaponViewCache=new Map<MapId,WeaponViews>([[getActiveMap().id,weapons]]);
if(params.has('arms-only'))weaponRoot.visible=false;
let equippedWeapon=simulation.state.player.weapon;
let armsRig:ClassicViewArms|null=null;let armsIK:ClassicViewArms|null=null;
function syncWeaponViews(){
 let next=weaponViewCache.get(getActiveMap().id);
 if(!next){next=createWeaponViews();weaponViewCache.set(getActiveMap().id,next);}
 weaponRoot.clear();weapons=next;weaponRoot.add(...Object.values(weapons));
 for(const gun of Object.values(weapons))gun.userData.rig.lastTime=null;
 equippedWeapon=simulation.state.player.weapon;resetWeaponSwitch(simulation.state.player);
}
startup.stage('正在加载第一人称手臂…');
if(params.get('arms')!=='off'){
 armsRig=armsIK=new ClassicViewArms(weaponCamera,weaponScene);
}
startup.stage('正在准备画面…');
const flash=createMuzzleFlash();weaponScene.add(flash);const muzzleLight=new THREE.PointLight('#ffd291',0,2,2);weaponScene.add(muzzleLight);
const effects=new CombatEffects();scene.add(effects.root);
const groundWeapons=new GroundWeapons();scene.add(groundWeapons.root);groundWeapons.update(simulation.state);
const tracerMaterial=new THREE.LineBasicMaterial({color:'#f4c47b',transparent:true,opacity:.58});
const traces=Array.from({length:24},()=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));const line=new THREE.Line(geometry,tracerMaterial);line.visible=false;line.frustumCulled=false;scene.add(line);return {line,left:0};});let traceIndex=0;
let frozen=false,reducedMotion=false,last=performance.now(),accumulator=0,frames=0,uiTick=0,statsTick=0,fps=60,started=false,lastPhase='menu',cameraKick=0;
let input:InputController;
let gyro:GyroAim|undefined;
let pendingInput:PlayerInput={...EMPTY_INPUT};
function releasePointer(){if(document.pointerLockElement)document.exitPointerLock();}
function lockPointer(){if(!matchMedia('(pointer: coarse)').matches&&!params.has('touch')){canvas.requestPointerLock()?.catch(()=>{});}}
let switchingMap=false;
const worldCache=new Map<MapId,THREE.Group>([[getActiveMap().id,world]]);
function applyMapLighting(){
 const snow=getActiveMap().id==='snow',baked=world.userData.bakedLighting===true;
 scene.background=new THREE.Color(baked?'#c5b995':snow?'#a9bacb':'#a5c5d3');
 scene.fog=baked?null:new THREE.Fog(snow?'#c4cdd1':'#bdcbd0',snow?90:48,snow?230:115);
 if(baked&&world.userData.sky)scene.background=world.userData.sky;
 hemisphere.color.set(snow?'#dbe2e6':'#d1e4f1');hemisphere.groundColor.set(snow?'#bac0b1':'#947655');hemisphere.intensity=snow?1.6:1.35;
 sun.color.set(snow?'#fffdf3':'#ffe2b6');sun.intensity=snow?1.2:2.8;
 renderer.toneMappingExposure=snow?1.02:1.05;
}
applyMapLighting();
async function selectMap(id:MapId){
 if(switchingMap||simulation.state.phase!=='menu'||id===getActiveMap().id)return;
 switchingMap=true;const previous=getActiveMap().id;
 try{
  ui.setMapLoading(12);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  if(id==='bloodstrike')await prepareBloodstrike();
  if(id==='dust2')await prepareDust2();
  if(id==='assault')await Promise.all([prepareAssault(),hostages.prepare()]);
  setActiveMap(id);
  let next=worldCache.get(id);
  if(!next){next=createMapWorld(id);await next.userData.assetsReady;const casters:THREE.Mesh[]=[];next.traverse(o=>{if(o instanceof THREE.Mesh&&o.castShadow)casters.push(o);});next.userData.shadowCasters=casters;worldCache.set(id,next);}
  ui.setMapLoading(60);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const controller=await FirstPersonController.create(camera,MAP_BOXES);
  const parts=MAP_BOXES.map(b=>new THREE.BoxGeometry(b.w,b.h,b.d).translate(b.x,b.h/2,b.z));
  const geometry=parts.length?mergeGeometries(parts):new THREE.BufferGeometry();parts.forEach(g=>g.dispose());
  scene.remove(world);world=next;scene.add(world);
  firstPerson.world.free();firstPerson=controller;
  shadowProxy.geometry.dispose();shadowProxy.geometry=geometry;
  worldCasters.length=0;worldCasters.push(...world.userData.shadowCasters);
  simulation.refreshMap();syncWeaponViews();syncCharacterRoster();groundWeapons.reset();groundWeapons.update(simulation.state);effects.reset();input?.clear();
  applyMapLighting();resize();ui.setMapLoading(95);ui.update(simulation.state);
  telemetry.event('map_select',{map:id});
 }catch(error){setActiveMap(previous);throw error;}
 finally{switchingMap=false;}
}
function start(){if(switchingMap)return;ui.setShopOpen(false);if(rosterStarts++>0)rosterOffset++; telemetry.event('game_start');audio.stop();audio.unlock().then(()=>audio.ui('confirm')).catch(()=>{});simulation.start();syncCharacterRoster();effects.reset();cameraKick=0;started=true;frozen=false;pendingInput={...EMPTY_INPUT};input?.clear();input?.setAvailableWeapons(simulation.state.player.inventory);if(!landscapeViewport(innerWidth,innerHeight))pauseForFocusLoss();else if(simulation.state.phase==='playing')lockPointer();else releasePointer();ui.update(simulation.state);}
function resume(){ui.setShopOpen(false);if(!landscapeViewport(innerWidth,innerHeight)){pauseForFocusLoss();return;}simulation.setPaused(false);input.clear();pendingInput={...EMPTY_INPUT};audio.unlock().catch(()=>{});if(simulation.state.phase==='playing'||simulation.state.phase==='planted')lockPointer();ui.update(simulation.state);}
function setSettings(patch:Partial<Settings>){Object.assign(settings,patch);Object.assign(settings,mobileSettings(settings));input?.configureTouch({fireDrag:settings.fireDrag});gyro?.configure(settings.gyroMode,settings.gyroSensitivity);settings.viewScale=clampViewScale(settings.viewScale);audio.setVolume(settings.volume);resize();try{localStorage.setItem('sandline-settings-v1',JSON.stringify(settings));}catch{}}
function toggleShop(){
 if(ui.isShopOpen){ui.setShopOpen(false);resume();return;}
 if(!ui.canOpenShop())return;
 simulation.setPaused(true);input.clear();input.setGameplayActive(false);gyro?.setActive(false);pendingInput={...EMPTY_INPUT};
 ui.setShopOpen(true);releasePointer();audio.stop();audio.ui('confirm');ui.update(simulation.state);
}
const ui=new GameUI({toggleShop,gyroEnable:()=>{if(settings.gyroMode==='off')setSettings({gyroMode:'always'});void gyro?.requestAccess();},gyroCalibrate:()=>gyro?.calibrate(),start,selectMap,resume,restart:start,selectMode:mode=>{if(!switchingMap&&simulation.selectMode(mode)){try{localStorage.setItem(MODE_STORAGE_KEY,mode);}catch{}ui.update(simulation.state);}},nextWave:()=>{if(simulation.startDefenseWave()){input.clear();pendingInput={...EMPTY_INPUT};audio.unlock().catch(()=>{});lockPointer();ui.update(simulation.state);}},upgrade:upgrade=>{if(simulation.chooseDefenseUpgrade(upgrade))audio.ui('confirm');ui.update(simulation.state);},menu:()=>{ui.setShopOpen(false);simulation.menu();syncCharacterRoster();input.clear();audio.stop();audio.ui('cancel');effects.reset();releasePointer();},settings:setSettings,purchase:item=>{const okay=simulation.purchase(item);audio.ui(okay?'confirm':'cancel');ui.update(simulation.state);return okay;},botCounts:(teammates,enemies)=>{if(!switchingMap&&simulation.setBotCounts(teammates,enemies)){syncCharacterRoster();ui.update(simulation.state);try{localStorage.setItem(BOT_STORAGE_KEY,JSON.stringify({teammates,enemies}));}catch{}}},audioTest:()=>{void audio.test();},audioEnable:()=>{if(settings.volume===0)setSettings({volume:.6});void audio.resumeIfNeeded();},fullscreen:requestGameFullscreen});
document.getElementById('portrait-startup')?.remove();
input=new InputController(canvas);input.configureTouch({fireDrag:settings.fireDrag});input.setAvailableWeapons(simulation.state.player.inventory);
gyro=new GyroAim(status=>ui.setGyroStatus(status));gyro.configure(settings.gyroMode,settings.gyroSensitivity);
// Readable on an actual phone without Safari's remote inspector. Never logs by default.
window.setInterval(()=>{const node=document.getElementById('gyro-diagnostics');if(node)node.textContent=gyro?.diagnosticText()??'尚未启用';},300);
addEventListener('pointerdown',event=>{if(event.isTrusted&&landscapeViewport(innerWidth,innerHeight))void audio.resumeIfNeeded();},{passive:true,capture:true});
addEventListener('keydown',event=>{if(event.isTrusted&&!event.metaKey&&!event.ctrlKey&&landscapeViewport(innerWidth,innerHeight))void audio.resumeIfNeeded();});
let mobileRenderScale=1, slowFrameSeconds=0, qualityCooldown=0;
let aimMagnification=1,portraitSuspended=false;
function updateCameraHFov(){
 camera.aspect=innerWidth/Math.max(1,innerHeight);
 camera.fov=worldVerticalFov(innerWidth,innerHeight,settings.viewScale,aimMagnification);
 camera.updateProjectionMatrix();
}
function resize(){
 const width=innerWidth,height=innerHeight;
 portraitSuspended=!landscapeViewport(width,height);canvas.hidden=portraitSuspended;
 if(portraitSuspended){
  if(['playing','prep','planted'].includes(simulation.state.phase))simulation.setPaused(true);
  input.clear();input.setGameplayActive(false);gyro?.setActive(false);pendingInput={...EMPTY_INPUT};accumulator=0;aimMagnification=1;
  audio.stop();releasePointer();ui.update(simulation.state);return;
 }
 renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==='high'?1.5:1.15)*mobileRenderScale);
 renderer.setSize(width,height);updateCameraHFov();
 // The first-person weapon has a separate presentation lens, so scope/view zoom never enlarges the hands.
 weaponCamera.aspect=width/height;weaponCamera.updateProjectionMatrix();
 const shadowSize=settings.quality==='high'?2048:1024;if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;}
 worldCasters.forEach(m=>m.castShadow=settings.quality==='high');shadowProxy.visible=settings.quality==='low';
}
resize();addEventListener('resize',resize);
function pauseForFocusLoss(){ui.setShopOpen(false);gyro?.setActive(false);if(hitPreview){audio.stop();return;}if(simulation.state.phase==='playing'||simulation.state.phase==='prep'||simulation.state.phase==='planted'){simulation.setPaused(true);input.clear();pendingInput={...EMPTY_INPUT};audio.stop();releasePointer();ui.update(simulation.state);}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseForFocusLoss();});
addEventListener('blur',pauseForFocusLoss);
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&started&&!params.has('touch')&&!ui.isShopOpen)pauseForFocusLoss();});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();telemetry.event('runtime_failure',{kind:'webgl_context_lost'});pauseForFocusLoss();ui.setOffline('画面连接中断，请刷新重试');});

let diagnosticsElement:HTMLPreElement|null=null;
let debugFrameLimit=0;
let hitProbeEvents:GameEvent[]|null=null;
let movementCapture:{at:number;index:number;next:number;name:string;duration:number;keys:[number,string,string][];samples:unknown[];images:string[]}|null=null;
let switchCapture:{at:number;index:number;next:number;samples:unknown[];images:string[]}|null=null;
let canvasMetrics:ReturnType<typeof inspectCanvas>|null=null;
function diagnostics(){const s=simulation.state,geometry=getActiveMap().geometry;const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');let armMaterial:any=null;armsRig?.model.traverse(o=>{if(!armMaterial&&o instanceof THREE.Mesh){const m=Array.isArray(o.material)?o.material[0]:o.material;armMaterial={type:m.type,map:!!(m as any).map,normalMap:!!(m as any).normalMap,roughnessMap:!!(m as any).roughnessMap,metalnessMap:!!(m as any).metalnessMap};}});return {gyro:gyro?.diagnostics(),mobileControls:{fireDrag:settings.fireDrag,gyroMode:settings.gyroMode,gyroSensitivity:settings.gyroSensitivity},bots:simulation.botDiagnostics(),version:'0.39-bloodstrike-team-rounds',resources:performance.getEntriesByType('resource').filter(entry=>/\.glb(?:\?|$)/.test(entry.name)).map(entry=>({path:new URL(entry.name).pathname,bytes:(entry as PerformanceResourceTiming).decodedBodySize})),map:getActiveMap().id,mode:s.mode,bomb:s.bomb,rescue:s.rescue,roundReason:s.roundReason,sites:s.sites,race:s.race,defense:s.defense,pickups:s.pickups.map(p=>({id:p.id,weapon:p.weapon,x:p.x,z:p.z})),inventory:s.player.inventory,canvas:canvasMetrics,environment:world.userData.textureStatus,phase:s.phase,paused:s.paused,frozen,frame:frames,time:+s.time.toFixed(2),round:s.round,score:[s.blueScore,s.redScore],player:{money:s.player.money,y:+(s.player.y??0).toFixed(3),verticalSpeed:+(s.player.verticalSpeed??0).toFixed(3),x:+s.player.x.toFixed(2),z:+s.player.z.toFixed(2),yaw:+s.player.yaw.toFixed(3),pitch:+s.player.pitch.toFixed(4),health:s.player.health,ammo:s.player.guns[s.player.weapon].ammo,reserve:s.player.guns[s.player.weapon].reserve,weapon:s.player.weapon,grenades:s.player.grenades,reloadLeft:s.player.guns[s.player.weapon].reloadLeft,crouched:s.player.crouched,sprinting:!!s.player.sprinting,moveSpeed:s.player.moveSpeed??3.9,kills:s.totalKills},actors:s.actors.map((a,i)=>({id:a.id,team:a.team,money:a.money,inventory:a.inventory,x:+a.x.toFixed(2),y:+(a.y??0).toFixed(3),z:+a.z.toFixed(2),yaw:+a.yaw.toFixed(3),crouched:a.crouched,moving:a.moving,health:a.health,kills:a.kills,weapon:a.weapon,raceStage:a.raceStage,raceKills:a.raceKills,active:a.active,animation:actors[i].userData.animation,variant:actors[i].userData.operatorVariant})),weaponSwitch:s.player.weaponSwitch??{displayed:s.player.weapon,phase:'ready',depth:0},viewmodel:weapons[s.player.weaponSwitch?.displayed??s.player.weapon].userData.pose,weaponAsset:weapons[s.player.weapon].userData.assetSource??'procedural',fov:camera.fov,horizontalFov:2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect)*180/Math.PI,baseHorizontalFov:BASE_HORIZONTAL_FOV,viewScale:settings.viewScale,scoped:ui.root.classList.contains('is-scoped'),arms:{source:'cs16-arms-rigged.glb',material:armMaterial,seamErrors:armsRig?.continuation.seamErrors,terminalNdcMaxY:armsRig?.continuation.terminalNdcMaxY},gripErrors:armsIK?.errors,character:characterDiagnostics(),effects:effects.diagnostics(),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,shadowSize:sun.shadow.mapSize.x,weaponShadowSize:weaponLight.castShadow?weaponLight.shadow.mapSize.x:0,weaponLightProbe:weaponScene.environment===weaponEnvironment&&weaponEnvironment!==environment?'polyhaven-studio-small-09':'room'},fps:+fps.toFixed(1),pixelRatio:renderer.getPixelRatio(),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',physics:{engine:getActiveMap().geometry?'GoldSrc BSP hulls: movement, height, visibility; Rapier camera proxy':'Rapier3D kinematic proxy + map colliders; custom hitscan gameplay',timestep:1/60,colliders:geometry&&'bodyHulls' in geometry&&Array.isArray(geometry.bodyHulls)?geometry.bodyHulls.length:MAP_BOXES.length,actors:s.actors.length,grenades:s.grenades.length,controller:firstPerson.diagnostics()},audio:audio.diagnostics()};}
function applyObjectiveTestState(name:string){
 simulation.start();const s=simulation.state;
 // Deliberately passive actors isolate the public interaction controls in QA.
 for(const a of s.actors)a.player=true;
 const place=(a:typeof s.player,p:{x:number;y?:number;z:number})=>Object.assign(a,{x:p.x,y:p.y??0,z:p.z,groundY:p.y??0,verticalSpeed:0,climbing:false});
 if(name==='objective-hostages'&&s.rescue){
  const h=s.rescue.hostages[0];place(s.player,{x:h.x,y:h.y,z:h.z+1.6});s.player.yaw=0;s.player.pitch=-.04;
 }else if(name==='objective-rescue'&&s.rescue){
  const r=s.rescue,zone=r.zones[0];r.hostages.slice(0,-1).forEach(h=>{h.status='rescued';h.leaderId=null;});r.rescued=r.total-1;
  const h=r.hostages.at(-1)!;Object.assign(h,{x:zone.x-9,y:zone.y,z:zone.z,status:'following',leaderId:s.player.id});
  place(s.player,{x:zone.x-1,y:zone.y,z:zone.z});s.player.yaw=Math.PI/2;s.player.pitch=-.05;
 }else if(s.mode==='demolition'){
  const site=s.sites[0];
  if(name==='objective-plant'){s.player=s.actors.find(a=>a.hasBomb)!;place(s.player,site);s.player.yaw=0;s.player.pitch=-.5;}
  else {place(s.player,{...site,x:site.x+1.4});s.player.yaw=Math.PI/2;s.player.pitch=-.7;Object.assign(s.bomb,{status:'planted',carrierId:null,x:site.x,y:site.y??0,z:site.z,site:site.id,timer:40,progress:0,defuserId:null});s.phase='planted';for(const a of s.actors)if(a.faction==='t'){a.hasBomb=false;a.health=0;}}
 }
 syncCharacterRoster();frozen=false;started=true;effects.reset();input.clear();pendingInput={...EMPTY_INPUT};releasePointer();ui.update(s);
 return {state:name};
}
function applyTestState(name:string){if(name.startsWith('objective-'))return applyObjectiveTestState(name);canvasMetrics=null;frozen=false;cameraKick=0;effects.reset();actors.forEach(a=>a.userData.rig.lastTime=Infinity);simulation.seed(42);const captureMode=parseMode(params.get('mode'));simulation.start(isTeamDeathmatch(captureMode)?captureMode:'deathmatch');syncCharacterRoster();const s=simulation.state;if(name==='menu'){simulation.menu();}else if(['active-play','pickup','pause','reload','explosion','operators','death','respawn','ranking','melee'].includes(name)){
 s.phase='playing';s.roundTime=76;s.player.x=3.1;s.player.z=11;s.player.yaw=-.04;s.player.pitch=-.01;
 Object.assign(s.actors[1],{x:-2.7,z:10,yaw:0});Object.assign(s.actors[2],{x:4.2,z:3,yaw:0});Object.assign(s.actors[3],{x:3,z:-2,yaw:Math.PI});Object.assign(s.actors[4],{x:-2.5,z:-5,yaw:Math.PI});Object.assign(s.actors[5],{x:18,z:-6,yaw:Math.PI});if(name==='pause')s.paused=true;
 if(name==='respawn'){s.player.health=0;s.player.deaths=1;s.totalDeaths=1;s.player.respawnAt=s.time+3;}
 if(name==='ranking'){s.actors.forEach((a,i)=>{a.kills=[8,12,4,15,8,6][i];a.deaths=[3,4,8,5,6,7][i];});s.blueScore=24;s.redScore=29;s.time=189;s.roundTime=189;}
 const requested=params.get('weapon');if(WEAPON_KINDS.includes(requested as any)&&allowsWeapon(s.mode,requested as typeof s.player.weapon)){s.player.weapon=requested as typeof s.player.weapon;if(!s.player.inventory.includes(s.player.weapon))s.player.inventory.push(s.player.weapon);}
 if(params.get('knifeAttack')==='stab')s.player.meleeAttack='stab';
 if(params.has('shotAge'))s.player.shotTime=s.time-Math.max(0,Math.min(s.player.weapon==='knife'?1.05:.7,Number(params.get('shotAge'))));
 if(name==='reload'){s.player.guns[s.player.weapon].ammo=3;simulation.reload(s.player);s.player.guns[s.player.weapon].reloadLeft=WEAPONS[s.player.weapon].reload*(1-Math.max(.001,Math.min(.999,Number(params.get('reloadProgress')??.34))));}
 if(name==='explosion'){effects.emit({type:params.get('blast')==='bomb'?'bombExplode':'explosion',x:3.05,y:.08,z:6.2},5);const age=Math.max(0,Math.min(4,Number(params.get('explosionAge')??.24)));for(let t=0;t<age;t+=1/120)effects.update(Math.min(1/120,age-t),[],camera,innerHeight);}
 if(name==='death'){s.player.x=3.3;s.player.z=10;s.player.pitch=-.48;Object.assign(s.actors[2],{x:3.3,z:7,yaw:0,moving:false});updateCharacter(actors[2],s.actors[2],s.time,1/60);registerCharacterHit(actors[2],.2,false,params.get('hitDirection')==='rear'?-1:1,1.4);s.actors[2].health=0;const age=Math.max(0,Math.min(1.5,Number(params.get('deathAge')??1.5)));for(let t=0;t<age;t+=1/60)updateCharacter(actors[2],s.actors[2],s.time,Math.min(1/60,age-t));}
 if(name==='operators'){s.player.x=3.3;s.player.z=11;s.player.pitch=-.05;Object.assign(s.actors[2],{x:4.4,z:7,yaw:.15});Object.assign(s.actors[3],{x:2.6,z:5.3,yaw:Math.PI});}
 if(getActiveMap().id==='snow'&&name!=='death'){s.player.x=-1.8;s.player.z=13.1;s.player.yaw=-.06;s.player.pitch=.04;Object.assign(s.actors[1],{x:-2,z:8});Object.assign(s.actors[2],{x:2,z:6});Object.assign(s.actors[3],{x:1,z:-2});Object.assign(s.actors[4],{x:-2,z:-6});Object.assign(s.actors[5],{x:18,z:-6});}
 if(getActiveMap().id==='assault'){
  const map=getActiveMap();s.actors.forEach((a,i)=>{const spawn=a.team==='blue'?map.blueSpawns[i]:map.redSpawns[i-map.blueSpawns.length]??map.redSpawns[i%map.redSpawns.length];Object.assign(a,spawn,{y:spawn.y??0,groundY:spawn.y??0,verticalSpeed:0,climbing:false});});
  const point=ASSAULT_LANDMARKS.find(p=>p.name===params.get('landmark'))??ASSAULT_LANDMARKS.find(p=>p.name==='仓库正门')!;
  const ground=map.geometry!.ground(point.x,point.z,point.y+.1)??point.y;
  Object.assign(s.player,{x:point.x,z:point.z,y:ground,groundY:ground,yaw:-Math.PI/2,pitch:0});
 }
 if(name==='melee'&&allowsWeapon(s.mode,'knife')){s.player.weapon='knife';Object.assign(s.player,{x:0,z:14,yaw:0,pitch:0});s.actors.slice(1).forEach((a,i)=>{a.x=18;a.z=-14+i;for(const g of Object.values(a.guns))g.cooldown=999;});Object.assign(s.actors[3],{x:0,z:12.8,yaw:Math.PI});}
 if(operatorArt){s.actors.forEach((a,i)=>Object.assign(a,{x:(i-2.5)*1.5,z:14.2,yaw:Math.PI,pitch:0,moving:false}));}
 if(name==='pickup'){s.player.x=-3;s.player.z=17;s.player.pitch=-.7;s.player.yaw=0;s.roundTime=105;}
 }else if(name==='matchEnd'){s.phase='matchEnd';s.blueScore=3;s.redScore=1;s.round=4;s.winner='blue';s.totalKills=8;s.totalDeaths=2;}else if(name==='spectator'){s.phase='playing';s.player.health=0;s.spectating=s.actors[1];}else throw new Error('Unknown capture state '+name);equippedWeapon=s.player.weapon;resetWeaponSwitch(s.player);input.clear();ui.update(s);return {state:name};}
if(debug){
 const panel=document.createElement('details');panel.id='qa-panel';panel.style.cssText='position:fixed;z-index:1000;left:8px;bottom:8px;color:white;background:#152023e8;font:11px monospace;max-width:min(540px,90vw);max-height:80vh;overflow:auto;padding:7px;';panel.innerHTML='<summary>开发验证</summary><div id="qa-actions"></div><pre id="qa-metrics" style="white-space:pre-wrap"></pre><pre id="qa-result" style="white-space:pre-wrap"></pre>';document.body.appendChild(panel);diagnosticsElement=panel.querySelector('pre');
 const action=(label:string,handler:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='font:12px system-ui;padding:10px;margin:3px;';b.addEventListener('click',handler);panel.querySelector('#qa-actions')!.appendChild(b);};
 action('商店快捷键验证',()=>{
  ui.setShopOpen(false);simulation.start();syncCharacterRoster();started=true;frozen=false;input.clear();pendingInput={...EMPTY_INPUT};
  const p=simulation.state.player,results:{name:string;passed:boolean}[]=[];
  const check=(name:string,passed:boolean)=>results.push({name,passed});
  const key=(code:string,repeat=false)=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,repeat}));document.body.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));};
  ui.update(simulation.state);key('KeyB');check('B opens independent paused shop',ui.isShopOpen&&simulation.state.paused&&!ui.root.classList.contains('is-paused'));
  for(const [slot,item] of ['rifle','pistol','smg','shotgun','m4','sniper','deagle','ammo','he'].entries()){
   p.money=16000;p.grenades=0;p.grenadePurchases=0;p.guns.rifle.reserve=0;ui.update(simulation.state);
   const before=simulation.events.length;key(`Digit${slot+1}`);const event=simulation.events.slice(before).find(e=>e.type==='buy');
   check(`slot ${slot+1}: ${item}`,event?.item===item&&p.money===16000-(event?.amount??0));
   const wallet=p.money;key(`Digit${slot+1}`,true);check(`slot ${slot+1}: held key cannot rebuy`,p.money===wallet);
  }
  for(const code of ['KeyW','KeyR','KeyG','KeyQ','KeyV'])key(code);
  const intent=input.consume();check('shop keys never leak gameplay',!intent.moveZ&&!intent.moveX&&!intent.reload&&!intent.grenade&&!intent.secondaryFire&&!intent.switchWeapon);
  p.money=0;ui.update(simulation.state);const before=simulation.events.length;key('Digit1');check('insufficient funds cannot purchase',p.money===0&&simulation.events.length===before);
  key('Escape');check('Escape closes and resumes',!ui.isShopOpen&&!simulation.state.paused);
  key('KeyB');key('KeyB');check('B toggles closed',!ui.isShopOpen&&!simulation.state.paused);
  ui.update(simulation.state);key('KeyB');document.getElementById('shop-close')!.click();check('close button resumes',!ui.isShopOpen&&!simulation.state.paused);
  p.money=16000;ui.update(simulation.state);key('KeyB');panel.open=false;
  panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'spawn-shop-keyboard',map:getActiveMap().id,passed:results.every(r=>r.passed),results});
 });
 for(const [label,state] of [['战斗画面','active-play'],['人物画面','operators'],['倒地画面','death'],['换弹画面','reload'],['爆炸画面','explosion'],['结算画面','matchEnd'],['观战画面','spectator'],['菜单画面','menu']])action(label,()=>applyTestState(state));
 const {offlineModeQA,bountyRoundQA}=await import('./game/offlineModeQA');
 action('验证：血战赏金回合',()=>{void(async()=>{
  ui.setShopOpen(false);simulation.menu();await selectMap('bloodstrike');
  const result=bountyRoundQA(simulation);syncCharacterRoster();frozen=false;started=true;lastPhase='roundEnd';
  input.clear();pendingInput={...EMPTY_INPUT};releasePointer();panel.open=false;ui.update(simulation.state);
  panel.querySelector('#qa-result')!.textContent=JSON.stringify(result);
 })();});
 for(const [label,id,state] of [['目标：人质交互','assault','objective-hostages'],['目标：最后一名撤离','assault','objective-rescue'],['目标：安放 C4','dust2','objective-plant'],['目标：拆除 C4','dust2','objective-defuse']] as const)action(label,()=>{void(async()=>{simulation.menu();await selectMap(id);applyObjectiveTestState(state);panel.open=false;})();});
 for(const [label,scenario] of [['验证：军备胜利','race-win'],['验证：守卫强化','defense-upgrade'],['验证：守卫通关','defense-win'],['验证：据点失守','defense-loss']] as const)action(label,()=>{void(async()=>{simulation.menu();await selectMap('desert');offlineModeQA(simulation,scenario);syncCharacterRoster();frozen=false;started=true;input.clear();pendingInput={...EMPTY_INPUT};releasePointer();panel.open=false;ui.update(simulation.state);})();});
 action('音效试听',()=>{void audio.test();});
 action('雪地 / AWP 试听',()=>{simulation.setPaused(true);audio.setScene(simulation.state.paused?'paused':'menu');void audio.test('snow-awp');});
 action('冻结 / 继续',()=>{frozen=!frozen;});
 action('行走稳枪验证',()=>{
  applyTestState('active-play');started=true;frozen=false;panel.open=false;
  simulation.state.player.health=10000;
  const samples:unknown[]=[],start=performance.now();
  const key=(type:string)=>document.body.dispatchEvent(new KeyboardEvent(type,{code:'KeyW',key:'w',bubbles:true}));
  key('keydown');
  const timer=setInterval(()=>{samples.push({elapsed:performance.now()-start,...firstPerson.diagnostics()});},100);
  setTimeout(()=>key('keyup'),1800);
  setTimeout(()=>{clearInterval(timer);input.clear();panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'synthetic-walk-and-settle',samples});},3000);
 });
 action('切枪动画验证',()=>{
  applyTestState('active-play');started=true;frozen=false;panel.open=false;
  simulation.state.actors.forEach(a=>a.player=true);
  simulation.state.player.inventory=[...WEAPON_KINDS];input.setAvailableWeapons(WEAPON_KINDS);
  switchCapture={at:performance.now(),index:0,next:0,samples:[],images:[]};
  panel.querySelector('#qa-result')!.textContent='切枪验证进行中';
 });
 const startMovementCapture=(name:string,keys:[number,string,string][],duration:number)=>{
  started=true;frozen=false;panel.open=false;input.clear();pendingInput={...EMPTY_INPUT};
  simulation.state.actors.forEach(a=>a.player=true);simulation.state.player.health=10000;
  movementCapture={at:performance.now(),index:0,next:0,name,duration,keys,samples:[],images:[]};
  panel.querySelector('#qa-result')!.textContent='动作验证进行中';
 };
 action('步行 / 跑步验证',()=>{void(async()=>{
  simulation.menu();await selectMap('snow');applyTestState('active-play');
  Object.assign(simulation.state.player,{x:-19.3,z:17,y:0,groundY:0,yaw:0,pitch:0,weapon:'rifle'});resetWeaponSwitch(simulation.state.player);
  startMovementCapture('walk-run-settle',[[.3,'keydown','KeyW'],[1.65,'keydown','ShiftLeft'],[3.1,'keyup','ShiftLeft'],[3.5,'keyup','KeyW']],4.3);
 })();});
 action('刀姿动作验证',()=>{
  applyTestState('active-play');Object.assign(simulation.state.player,{weapon:'knife',shotTime:-10});resetWeaponSwitch(simulation.state.player);
  startMovementCapture('knife-slash-stab-switch',[[.6,'pointerdown','fire-button'],[.64,'pointerup','fire-button'],[1.3,'click','aim-button'],[2.4,'keydown','Digit1'],[2.42,'keyup','Digit1'],[3.1,'keydown','Digit7'],[3.12,'keyup','Digit7']],3.8);
 });
 action('左手屈伸验证',()=>{void(async()=>{
  simulation.menu();await selectMap('snow');applyTestState('active-play');
  Object.assign(simulation.state.player,{x:-19.3,z:17,y:0,groundY:0,yaw:0,pitch:0,weapon:'knife',shotTime:-10});resetWeaponSwitch(simulation.state.player);
  startMovementCapture('left-hand-flex-walk-cut-switch',[[4.3,'keydown','KeyW'],[5.4,'keyup','KeyW'],[5.8,'pointerdown','fire-button'],[5.86,'pointerup','fire-button'],[6.8,'click','aim-button'],[8.2,'keydown','Digit1'],[8.22,'keyup','Digit1'],[9.2,'keydown','Digit7'],[9.22,'keyup','Digit7']],10.4);
 })();});
 action('部位伤害实射验证',()=>{void(async()=>{
  if(hitProbeEvents)return;
  simulation.menu();await selectMap('desert');applyTestState('active-play');
  started=true;frozen=false;panel.open=false;input.clear();pendingInput={...EMPTY_INPUT};
  hitProbeEvents=[];panel.querySelector('#qa-result')!.textContent='部位实射验证进行中';
  try{const {hitRegionInputQA}=await import('./game/hitRegionQA');const result=await hitRegionInputQA(simulation,hitProbeEvents);panel.querySelector('#qa-result')!.textContent=JSON.stringify(result);}
  finally{hitProbeEvents=null;input.clear();}
 })();});
 action('Dust2 B 点跳箱验证',()=>{void(async()=>{
  simulation.menu();await selectMap('dust2');applyTestState('active-play');
  Object.assign(simulation.state.player,{x:-38.608,z:-66.6496,y:0,groundY:0,yaw:-Math.PI/2,pitch:0,verticalSpeed:0,crouched:false});
  startMovementCapture('dust2-b-crate',[[.4,'keydown','KeyW'],[.4,'keydown','Space'],[.42,'keyup','Space'],[.55,'keydown','KeyC'],[.57,'keyup','KeyC'],[1.15,'keyup','KeyW'],[1.4,'keydown','KeyC'],[1.42,'keyup','KeyC']],2.1);
 })();});
 action('战术演练（观战）',()=>{void(async()=>{simulation.menu();await selectMap('snow');simulation.setBotCounts(4,5);simulation.seed(77);simulation.start('elimination');simulation.state.player.health=0;simulation.state.spectating=simulation.state.actors[1];syncCharacterRoster();started=true;frozen=false;input.clear();pendingInput={...EMPTY_INPUT};releasePointer();panel.open=false;ui.update(simulation.state);})();});
 action('自动对局自检',()=>{const test=new Simulation(42);test.start();let ticks=0,hits=0;while(ticks<5400){test.update(1/60,EMPTY_INPUT,true);hits+=test.events.filter(e=>e.type==='hit').length;test.events=[];ticks++;}panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'bot-match',passed:test.state.phase==='playing'&&test.state.blueScore+test.state.redScore>6,seconds:ticks/60,score:[test.state.blueScore,test.state.redScore],hits});});
 action('多指输入自检',()=>{applyTestState('active-play');frozen=true;input.clear();const joy=document.getElementById('joystick')!,look=document.getElementById('look-zone')!,fire=document.getElementById('fire-button')!;const j=joy.getBoundingClientRect(),l=look.getBoundingClientRect(),f=fire.getBoundingClientRect();
  const send=(el:Element,type:string,id:number,x:number,y:number)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1,button:0,isPrimary:id===71}));
  send(joy,'pointerdown',71,j.x+j.width/2,j.y+j.height/2);send(joy,'pointermove',71,j.x+j.width/2+28,j.y+j.height/2-25);send(look,'pointerdown',72,l.x+l.width/2,l.y+l.height/2);send(look,'pointermove',72,l.x+l.width/2+35,l.y+l.height/2-12);send(fire,'pointerdown',73,f.x+f.width/2,f.y+f.height/2);const active=input.consume();for(const [el,id,r] of [[joy,71,j],[look,72,l],[fire,73,f]] as const)send(el,'pointercancel',id,r.x,r.y);const canceled=input.consume();input.clear();panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'synthetic-multitouch',passed:Math.abs(active.moveX)>.1&&Math.abs(active.moveZ)>.1&&Math.abs(active.lookDX)>0&&active.fire&&!canceled.fire&&canceled.moveX===0&&canceled.moveZ===0,active,canceled});
 });
 action('全屏瞄准自检',()=>{
  applyTestState('active-play');frozen=true;input.clear();
  panel.style.visibility='hidden';
  const look=document.getElementById('look-zone')!,fire=document.getElementById('fire-button')!;
  const send=(el:EventTarget,type:string,id:number,x:number,y:number)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0}));
  const x=innerWidth*.32,y=innerHeight*.37;
  const leftTarget=document.elementFromPoint(x,y);
  send(leftTarget!,'pointerdown',81,x,y);send(window,'pointermove',81,x+.8,y-.4);
  const fine=input.consume(1/60);send(window,'pointerup',81,x+.8,y-.4);input.consume();const stopped=input.consume();
  input.clear();send(fire,'pointerdown',82,700,300);send(window,'pointermove',82,740,260);const shooting=input.consume();send(window,'pointercancel',82,740,260);
  const controlIds=['joystick','fire-button','aim-button','reload-button','pause-button','ranking-button','battle-button'];
  const controls=Object.fromEntries(controlIds.map(id=>{const node=document.getElementById(id)!,r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return [id,!!hit&&(hit===node||node.contains(hit))];}));
  const reticle=document.getElementById('crosshair')!.getBoundingClientRect();
  const centre=Math.abs(reticle.x-innerWidth/2)<1&&Math.abs(reticle.y-innerHeight/2)<1;
  const fireLookCorrect=settings.fireDrag?shooting.lookDX<0&&shooting.lookDY>0:shooting.lookDX===0&&shooting.lookDY===0;
  input.clear();panel.style.visibility='';panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:'full-screen-aim',passed:leftTarget===look&&fine.lookDX<0&&fine.lookDY>0&&!fine.fire&&stopped.lookDX===0&&stopped.lookDY===0&&shooting.fire&&fireLookCorrect&&centre&&Object.values(controls).every(Boolean),fireDrag:settings.fireDrag,leftTarget:leftTarget?.id,fine,stopped,shooting,centre,controls});
 });
 for(const [label,state,seconds] of [['验证：30fps 触控安放','objective-plant',3.4],['验证：30fps 触控拆除','objective-defuse',10.4],['验证：触控松手取消','objective-plant',1.2]] as const)action(label,()=>{void(async()=>{
  simulation.menu();await selectMap('dust2');applyObjectiveTestState(state);debugFrameLimit=30;panel.open=false;
  const button=document.getElementById('interact-button')!;
  const send=(type:string)=>button.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:95,pointerType:'touch',button:0,buttons:type==='pointerdown'?1:0}));
  setTimeout(()=>{send('pointerdown');setTimeout(()=>{send('pointerup');setTimeout(()=>{
   const b=simulation.state.bomb;panel.querySelector('#qa-result')!.textContent=JSON.stringify({test:label,fpsLimit:debugFrameLimit,status:b.status,plantProgress:b.plantProgress,defuseProgress:b.progress,winner:simulation.state.winner,passed:seconds<2?b.status==='carried'&&b.plantProgress===0:state==='objective-plant'?b.status==='planted':b.status==='defused'});
  },120);},seconds*1000);},120);
 })();});
 (window as any).__THREE_GAME_DIAGNOSTICS__={renderer:renderer.info,get state(){return diagnostics();}};
 (window as any).__THREE_GAME_TEST_HOOKS__={seed:(n:number)=>simulation.seed(n),setState:applyTestState,setPausedForScreenshot:(v:boolean)=>{frozen=v;},setReducedMotion:(v:boolean)=>{reducedMotion=v;},hideDebugUi:()=>{panel.style.display='none';}};
 const capture=params.get('capture');if(capture){applyTestState(capture);frozen=!params.has('motion');panel.style.display='none';reducedMotion=frozen;}
}


if(hitPreview){
 applyTestState('operators');frozen=true;simulation.events=[];simulation.state.time=1;
 const p=simulation.state.player,target=simulation.state.actors[3];
 Object.assign(p,{x:3.3,z:11,yaw:0,pitch:-.04,health:100});Object.assign(target,{x:3.3,z:7,yaw:Math.PI,health:100});
 document.getElementById('qa-panel')!.style.display='none';
 const panel=document.createElement('section');panel.id='hit-preview-panel';panel.setAttribute('aria-label','中弹效果本地预览');
 panel.style.cssText='position:fixed;z-index:1100;bottom:12px;left:50%;transform:translateX(-50%);width:max-content;max-width:94vw;background:#13211fee;color:#eedfc6;padding:12px;border:1px solid #bca06a;font:13px system-ui;text-align:center;';
 panel.innerHTML='<b>中弹效果 · 本地预览</b><p style="margin:6px">点击试听并播放；定格可检查血花形态。使用与实战相同的命中反馈。</p><div></div><a href="./?debug=1" style="color:#e6c185;display:block;margin-top:7px">进入正常对局试玩</a>';
 document.body.appendChild(panel);
 const show=(kind:'body'|'head'|'self',still=false)=>{
  hitPreviewStill=still;effects.reset();const self=kind==='self',victim=self?p:target;
  simulation.state.paused=false;victim.hurtTime=simulation.state.time;p.health=self?75:100;
  const event={type:'hit' as const,actorId:self?3:0,targetId:victim.id,weapon:p.weapon,headshot:kind==='head',x:victim.x,y:kind==='head'?1.58:1.17,z:victim.z+.23};
  if(still){effects.emit({...event,normalZ:-1,normalY:.08},4);effects.update(.12,[],camera,innerHeight);}
  else simulation.events.push(event);
  simulation.state.hitMarker=self?0:.14;ui.update(simulation.state);
 };
 for(const [label,kind,still] of [['命中身体','body',false],['命中头部','head',false],['自己中枪','self',false],['定格血花','body',true]] as const){
  const button=document.createElement('button');button.textContent=label;button.style.cssText='margin:3px;padding:10px 13px;min-height:44px;background:#d4b77e;color:#17211f;border:0;font:inherit;';
  button.onclick=()=>{if(still)show(kind,true);else void audio.unlock().then(()=>show(kind));};panel.querySelector('div')!.appendChild(button);
 }
}

function animate(now:number){requestAnimationFrame(animate);if(debug&&debugFrameLimit&&now-last<1000/debugFrameLimit)return;const delta=Math.min((now-last)/1000,.1);last=now;
 if(portraitSuspended===landscapeViewport(innerWidth,innerHeight))resize();
 if(portraitSuspended){startup.finish();return;}
 fps=fps*.95+(1/Math.max(delta,.001))*.05;frames++;
 // Reduce GPU pixel load only after sustained slow frames, never change aim gain with FPS.
 if((matchMedia('(pointer: coarse)').matches||params.has('touch'))&&!document.hidden&&!simulation.state.paused&&!frozen){
  qualityCooldown=Math.max(0,qualityCooldown-delta);
  slowFrameSeconds=fps<48?slowFrameSeconds+delta:Math.max(0,slowFrameSeconds-delta*2);
  if(slowFrameSeconds>3&&qualityCooldown===0&&mobileRenderScale>.65){mobileRenderScale=Math.max(.65,mobileRenderScale-.1);slowFrameSeconds=0;qualityCooldown=6;resize();}
 }
 const controlsActive=!frozen&&!document.hidden&&!simulation.state.paused&&simulation.state.player.health>0&&['playing','planted'].includes(simulation.state.phase);
 input.setGameplayActive(controlsActive);gyro?.setActive(controlsActive);
 const intent=input.consume(delta);const gyroDelta=gyro?.consume(input.precisionActive)??{x:0,y:0};intent.gyroDX=gyroDelta.x;intent.gyroDY=gyroDelta.y;
 if((gyroDelta.x||gyroDelta.y)&&!intent.lookDX&&!intent.lookDY&&intent.inputSource!=='touch')intent.inputSource='gyro';
 if(intent.pause){if(simulation.state.paused)resume();else{simulation.setPaused(true);releasePointer();audio.stop();audio.ui('pause');input.clear();}intent.pause=false;}
 if(!frozen&&!simulation.state.paused){pendingInput={...intent,jump:pendingInput.jump||intent.jump,secondaryFire:pendingInput.secondaryFire||intent.secondaryFire,fire:pendingInput.fire||intent.fire,gyroDX:(pendingInput.gyroDX??0)+(intent.gyroDX??0),gyroDY:(pendingInput.gyroDY??0)+(intent.gyroDY??0),lookDX:pendingInput.lookDX+intent.lookDX,lookDY:pendingInput.lookDY+intent.lookDY,reload:pendingInput.reload||intent.reload,grenade:pendingInput.grenade||intent.grenade,interact:pendingInput.interact||intent.interact,switchWeapon:intent.switchWeapon||pendingInput.switchWeapon};accumulator+=delta;while(accumulator>=1/60){simulation.update(1/60,pendingInput);accumulator-=1/60;pendingInput={...pendingInput,jump:false,secondaryFire:false,fire:false,gyroDX:0,gyroDY:0,lookDX:0,lookDY:0,reload:false,grenade:false,interact:accumulator>=1/60&&pendingInput.interact,switchWeapon:null};}}
 else {accumulator=0;pendingInput={...EMPTY_INPUT};}
 if(hitPreview&&!hitPreviewStill&&!simulation.state.paused){simulation.state.time+=delta;simulation.state.hitMarker=Math.max(0,simulation.state.hitMarker-delta);}
 const s=simulation.state;if(s.mode==='bounty'&&s.phase==='playing'&&lastPhase==='roundEnd'&&!ui.isShopOpen){ui.update(s);toggleShop();}if(s.phase==='intermission'&&lastPhase!=='intermission'){releasePointer();input.clear();pendingInput={...EMPTY_INPUT};audio.ui('confirm');}telemetry.setGame(s.phase,s.paused||frozen);audio.setScene(s.paused||frozen&&!hitPreview?'paused':s.phase==='menu'||s.phase==='matchEnd'?'menu':'combat');if(s.phase==='matchEnd'&&lastPhase!=='matchEnd'){releasePointer();input.clear();pendingInput={...EMPTY_INPUT};if(!debug)try{const previous=JSON.parse(localStorage.getItem('sandline-stats-v1')||'{}');localStorage.setItem('sandline-stats-v1',JSON.stringify({matches:(Number(previous.matches)||0)+1,wins:(Number(previous.wins)||0)+(s.winner==='blue'?1:0),kills:(Number(previous.kills)||0)+s.totalKills,deaths:(Number(previous.deaths)||0)+s.totalDeaths}));}catch{}}lastPhase=s.phase;audio.announce(simulation.events,s);for(const e of simulation.events){const actor=e.actorId===undefined?null:s.actors[e.actorId],listener=s.player.health>0?s.player:(s.spectating||s.player);const dx=(e.x??actor?.x??listener.x)-listener.x,dz=(e.z??actor?.z??listener.z)-listener.z,dist=Math.hypot(dx,dz),pan=dist>.2?Math.max(-.85,Math.min(.85,(dx*Math.cos(listener.yaw)-dz*Math.sin(listener.yaw))/dist)):0;if(e.type==='step'&&actor&&dist>.15){const y=eyeHeight(listener);e.occluded=wallDistance(actor.x,y,actor.z,-dx/dist,0,-dz/dist)<dist-.02;}if(e.type==='explosion'||e.type==='bombExplode'){const blastY=e.y??.08,dy=eyeHeight(listener)-blastY,d=Math.hypot(dx,dy,dz);e.occluded=d>.001&&wallDistance(e.x!,blastY,e.z!,-dx/d,dy/d,-dz/d)<d-.02;}if(e.type==='respawn'&&e.actorId===0){input.clear();input.resetPrecision();input.setAvailableWeapons(s.player.inventory);pendingInput={...EMPTY_INPUT};cameraKick=0;resetWeaponSwitch(s.player);}
  if(e.type==='weaponPickup'&&e.actorId===0){audio.ui('confirm');input.setAvailableWeapons(s.player.inventory);}else if(e.type!=='hit'&&(e.type!=='kill'||e.actorId===0))audio.play(e,dist,pan);
  let visualEvent=e;
  if(e.type==='melee'&&e.actorId===0)cameraKick=Math.min(.03,cameraKick+.008);
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
    const hit=characterHitDirection(target.yaw,e.normalX??-dx,e.normalZ??-dz);
    registerCharacterHit(actors[e.targetId],hit.side,!!e.headshot,hit.front,e.weapon==='sniper'?1.4:1);
   }
   const hitDistance=Math.hypot(target.x-listener.x,target.z-listener.z);
   const hitPan=hitDistance>.2?Math.max(-.85,Math.min(.85,((target.x-listener.x)*Math.cos(listener.yaw)-(target.z-listener.z)*Math.sin(listener.yaw))/hitDistance)):pan;
   if(e.actorId===0||e.targetId===0)audio.play(e,e.targetId===0?0:hitDistance,hitPan);
   const nx=target.x-(source?.x??target.x),nz=target.z-(source?.z??target.z),nl=Math.hypot(nx,nz)||1;
   effects.emit({...e,x:e.x??target.x,y:e.y??(e.headshot?eyeHeight(target):eyeHeight(target)*.7),z:e.z??target.z,normalX:e.normalX??nx/nl,normalY:e.headshot?.18:.06,normalZ:e.normalZ??nz/nl},dist);
  }
  else effects.emit(visualEvent,dist);
  if(e.type==='shot'&&e.tracer){const trace=traces[traceIndex++%traces.length];const p=trace.line.geometry.getAttribute('position') as THREE.BufferAttribute;p.setXYZ(0,visualEvent.x!,visualEvent.y!-.015,visualEvent.z!);p.setXYZ(1,e.endX!,e.endY!,e.endZ!);p.needsUpdate=true;trace.left=e.actorId===0?.055:.042;trace.line.visible=true;}}
 if(debug&&hitProbeEvents)hitProbeEvents.push(...simulation.events);
 simulation.events=[];
 cameraKick*=Math.exp(-delta/.115);
 groundWeapons.update(s);defenseObjective.update(s);hostages.update(s,s.paused||frozen?0:delta);bombObjective.update(s,s.paused||frozen?0:delta);
 const menu=s.phase==='menu';const view=s.player.health>0?s.player:s.spectating;
 const visualDelta=s.paused||frozen&&(!hitPreview||hitPreviewStill)?0:delta;
 for(let i=0;i<actors.length;i++){updateCharacter(actors[i],s.actors[i],s.time,visualDelta);if(!menu)solveCharacterFootIK(actors[i],firstPerson,visualDelta);actors[i].visible=s.actors[i].active!==false&&(menu||s.actors[i]!==view);}
 if(menu){const t=reducedMotion||mapArt?0:now*.000055;if(getActiveMap().id==='dust2'){
 const landmark=params.get('landmark'),point=DUST2_LANDMARKS.find(p=>p.name===landmark);
 if(params.get('angle')==='overview'){camera.position.set(-15,105,-23);camera.lookAt(-15,0,-25);}
 else if(point){const floor=getActiveMap().geometry!.ground(point.x,point.z,10)??0;camera.position.set(point.x,floor+2,point.z);camera.lookAt(point.x+8,floor+1.7,point.z-12);}
 else{camera.position.set(36+Math.sin(t)*.35,3.3,-48);camera.lookAt(30,2.6,-68);}
 }else if(getActiveMap().id==='assault'){
  const landmark=ASSAULT_LANDMARKS.find(p=>p.name===params.get('landmark'));
  if(params.get('angle')==='overview'){camera.position.set(-18,100,6);camera.lookAt(-18,0,-26);}
  else if(landmark){const floor=getActiveMap().geometry!.ground(landmark.x,landmark.z,landmark.y+.05)??landmark.y;camera.position.set(landmark.x,floor+1.7,landmark.z);camera.lookAt(landmark.x+8,floor+1.7,landmark.z-12);}
  else{camera.position.set(-35+Math.sin(t)*.35,9,-45);camera.lookAt(-8,4,-59);}
 }else if(getActiveMap().id==='bloodstrike'){
  camera.position.set(17+Math.sin(t)*.2,-5.8,17);camera.lookAt(-10,-7,0);
 }else if(getActiveMap().id==='snow'){
  const angle=mapArt?params.get('angle'):null;
  if(angle==='left'||angle==='right'){const x=angle==='left'?-19.3:19.3;camera.position.set(x,1.65,17.5);camera.lookAt(x,1.65,-18);}
  else if(angle==='overview'){camera.position.set(0,42,26);camera.lookAt(0,0,0);}
  else {camera.position.set(-2.8+Math.sin(t)*.5,2,14);camera.lookAt(0,2.8,-4);}
 }else{camera.position.set(12+Math.sin(t)*1.5,3.6,16);camera.lookAt(-1,1.3,-1);}}else if(view){firstPerson.update({x:view.x,y:eyeHeight(view),z:view.z,speed:view.moving?(view.moveSpeed??(view.crouched?1.65:3.9)):0,moving:view.moving,weapon:view.weapon,crouched:view.crouched,airborne:isAirborne(view),aiming:input.precisionActive&&view.weapon!=='knife',actorId:view.id,spawnTime:view.spawnedAt,time:s.time,pitch:view.pitch,yaw:view.yaw,lookDX:intent.lookDX,lookDY:intent.lookDY,cameraKick},visualDelta,reducedMotion||s.paused);}
 const p=s.player,gun=p.guns[p.weapon],age=s.time-p.shotTime;
 if(equippedWeapon!==p.weapon){equippedWeapon=p.weapon;input.resetPrecision();}
 const canAct=weaponReady(p)&&!menu&&!s.paused&&p.health>0&&['playing','planted'].includes(s.phase)&&gun.reloadLeft===0;
 input.setAimContext(p.weapon,canAct);
 const canAim=canAct&&p.weapon!=='knife';
 const aiming=canAim&&input.precisionActive,scoped=aiming&&p.weapon==='sniper';
 ui.root.classList.toggle('is-scoped',scoped);
 ui.root.classList.toggle('has-sniper',p.weapon==='sniper');
 ui.root.classList.toggle('has-knife',p.weapon==='knife');
 const targetMagnification=scoped?SNIPER_MAGNIFICATION:aiming?1.3:1;
 aimMagnification+=(targetMagnification-aimMagnification)*(1-Math.exp(-delta*20));
 if(Math.abs(aimMagnification-targetMagnification)<1e-5)aimMagnification=targetMagnification;
 updateCameraHFov();
 const displayed=p.weaponSwitch?.displayed??p.weapon;
 const switchPose=weaponSwitchPose(displayed,p.weaponSwitch?.depth??0);
 for(const kind of WEAPON_KINDS){
  weapons[kind].visible=kind===displayed;
  if(kind===displayed){
   updateViewWeapon(weapons[kind],weaponDisplayActor(p),s.time,visualDelta);

  }
 }
 const classicArms=!!weapons[displayed].userData.embeddedArms;
 const viewOffset=classicArms?CLASSIC_AK_OFFSET:WEAPON_VIEW_OFFSETS[displayed];
 // Keep the reference composition at the same horizontal size on desktop
 // and landscape phones; scope magnification still belongs to the world lens.
 const weaponFov=classicArms?THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(CLASSIC_AK_HORIZONTAL_FOV)/2)/weaponCamera.aspect)):56;
 if(weaponCamera.fov!==weaponFov){weaponCamera.fov=weaponFov;weaponCamera.updateProjectionMatrix();}
 const motion=firstPerson.weaponMotion;
 weaponRoot.position.x=viewOffset.x+motion.x+switchPose.x;weaponRoot.position.z=viewOffset.z+motion.z+switchPose.z;
 weaponRoot.rotation.set(motion.pitch+switchPose.pitch,motion.yaw+switchPose.yaw,motion.roll+switchPose.roll,'YXZ');
 weaponRoot.position.y=viewOffset.y+motion.y-Math.max(0,1-(s.time-p.throwTime)/.65)*.3+switchPose.y;
 weaponRoot.updateWorldMatrix(true,true);if(armsRig)armsRig.group.visible=!classicArms;if(!classicArms)armsIK?.update(weapons[displayed]);const muzzle=weapons[displayed].getObjectByName('muzzle')!;muzzle.getWorldPosition(flash.position);muzzle.getWorldQuaternion(flash.quaternion);flash.position.add(new THREE.Vector3(0,0,-.075).applyQuaternion(flash.quaternion));
 const flashAge=age/.075,flashVisible=weaponReady(p)&&displayed===p.weapon&&p.weapon!=='knife'&&age>=0&&age<.075&&gun.reloadLeft===0;
 flash.material.rotation=p.shotTime*17;flash.material.opacity=flashVisible?(.72+Math.sin(age*190)*.16):0;flash.scale.setScalar(WEAPON_PRESENTATION[p.weapon].flashScale*(1+Math.max(0,flashAge)*.24));flash.visible=flashVisible;
 flash.children.forEach((child,i)=>{child.visible=flashVisible;child.scale.setScalar(1+(i===0?Math.max(0,flashAge)*.4:Math.max(0,flashAge)*.18));});
 muzzleLight.position.copy(flash.position);muzzleLight.intensity=flashVisible?(2.2*(1-Math.min(1,flashAge))):0;
 effects.update(visualDelta,s.grenades,camera,innerHeight);
 for(const trace of traces){if(!frozen&&!s.paused)trace.left-=delta;if(trace.left<=0)trace.line.visible=false;}
 if(operatorArt){actors.forEach(a=>a.visible=true);camera.position.set(0,1.65,params.get('angle')==='rear'?8.1:18.8);camera.lookAt(0,1.05,14.2);}
 if(hitPreview)for(let i=1;i<actors.length;i++)actors[i].visible=i===3;
 renderer.info.reset();renderer.clear();renderer.render(scene,camera);if(!operatorArt&&!menu&&!scoped&&p.health>0&&s.phase!=='matchEnd'){renderer.clearDepth();renderer.render(weaponScene,weaponCamera);}
 if(gripCamera){
  const pivot=weapons[p.weapon].getObjectByName('weapon-pivot')!;
  const angle=params.get('angle'),side=angle==='right'?1:-1;
  const reloadDetail=params.get('detail')==='reload',span=reloadDetail?.42:.22;
  gripCamera.left=-span;gripCamera.right=span;gripCamera.top=span/weaponCamera.aspect;gripCamera.bottom=-gripCamera.top;gripCamera.updateProjectionMatrix();
  gripCamera.position.copy(pivot.localToWorld(angle==='rear'?new THREE.Vector3(0,-.04,.7):new THREE.Vector3(side*.7,reloadDetail?-.12:-.04,reloadDetail?-.12:-.025)));
  gripCamera.lookAt(pivot.localToWorld(new THREE.Vector3(0,reloadDetail?-.12:-.04,reloadDetail?-.12:-.025)));
  renderer.setClearColor('#46515b');renderer.clear();renderer.render(weaponScene,gripCamera);
 }
 if(debug){canvas.dataset.renderedFrames=String(frames);canvas.dataset.simulationTime=String(s.time);canvas.dataset.horizontalFov=String(2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect)*180/Math.PI);}
 if(debug&&switchCapture){
  const capture=switchCapture,elapsed=(performance.now()-capture.at)/1000;
  const sequence:[[number,string],...[number,string][]]=[[.25,'Digit7'],[.85,'Digit1'],[2.10,'Digit2'],[3.35,'Digit3'],[4.60,'Digit4'],[5.85,'Digit5'],[7.10,'Digit6'],[8.45,'Digit8'],[9.70,'Digit7'],[9.77,'Digit2'],[9.84,'Digit7']];
  while(capture.index<sequence.length&&elapsed>=sequence[capture.index][0]){
   const code=sequence[capture.index++][1];
   for(const type of ['keydown','keyup'])document.body.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(-1),bubbles:true}));
  }
  if(elapsed>=capture.next){
   capture.next=elapsed+.065;
   capture.samples.push({elapsed,time:s.time,selected:p.weapon,displayed,phase:p.weaponSwitch?.phase??'ready',depth:p.weaponSwitch?.depth??0,rackProgress:p.weaponSwitch?.rackProgress??1,pose:{...weapons[displayed].userData.pose},root:weaponRoot.position.toArray(),gripErrors:armsIK?.errors.slice()});
   const shot=document.createElement('canvas');shot.width=720;shot.height=Math.round(720*canvas.height/canvas.width);shot.getContext('2d')!.drawImage(canvas,0,0,shot.width,shot.height);capture.images.push(shot.toDataURL('image/jpeg',.8));
  }
  if(elapsed>10.6){document.querySelector('#qa-result')!.textContent=JSON.stringify({test:'weapon-switch-input-sequence',samples:capture.samples,images:capture.images});switchCapture=null;}
 }
 if(debug&&movementCapture){
  const capture=movementCapture,elapsed=(performance.now()-capture.at)/1000;
  while(capture.index<capture.keys.length&&elapsed>=capture.keys[capture.index][0]){
   const [,type,code]=capture.keys[capture.index++];
   if(type==='click')(document.getElementById(code) as HTMLElement)?.click();
   else if(type.startsWith('pointer')){const button=document.getElementById(code)!;const rect=button.getBoundingClientRect();button.dispatchEvent(new PointerEvent(type,{pointerId:91,pointerType:'touch',button:0,buttons:type==='pointerdown'?1:0,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,bubbles:true}));}
   else document.body.dispatchEvent(new KeyboardEvent(type,{code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code==='Space'?' ':code,bubbles:true}));
  }
  if(elapsed>=capture.next){
   capture.next=elapsed+.065;
   capture.samples.push({elapsed,time:s.time,x:p.x,y:p.y,z:p.z,verticalSpeed:p.verticalSpeed,crouched:p.crouched,sprinting:p.sprinting,moveSpeed:p.moveSpeed,moving:p.moving,weapon:p.weapon,pose:structuredClone(weapons[displayed].userData.pose),camera:camera.position.toArray(),motion:{...motion},gripErrors:armsIK?.errors.slice()});
   const shot=document.createElement('canvas');shot.width=720;shot.height=Math.round(720*canvas.height/canvas.width);shot.getContext('2d')!.drawImage(canvas,0,0,shot.width,shot.height);capture.images.push(shot.toDataURL('image/jpeg',.8));
  }
  if(elapsed>capture.duration){input.clear();document.querySelector('#qa-result')!.textContent=JSON.stringify({test:capture.name,samples:capture.samples,images:capture.images});movementCapture=null;}
 }
 startup.finish();
 uiTick+=delta;if(uiTick>.05){input.setAvailableWeapons(s.player.inventory);ui.update(s);ui.setAudioStatus(audio.status());uiTick=0;}
 if(debug&&!canvasMetrics&&frames>4)canvasMetrics=inspectCanvas(renderer.getContext());
 statsTick+=delta;if(debug&&statsTick>.3){if(diagnosticsElement)diagnosticsElement.textContent=JSON.stringify(diagnostics());statsTick=0;}
}
requestAnimationFrame(animate);

async function offline(){if(!import.meta.env.PROD||debug){ui.setOffline('开发验证 · 离线缓存使用正式入口');return;}if(!('serviceWorker' in navigator)||!isSecureContext){ui.setOffline('局域网试玩 · 离线安装需 HTTPS');return;}
 try{ui.setOffline('正在缓存离线资源…');const reg=await navigator.serviceWorker.register(new URL('./sw.js',location.href),{updateViaCache:'none'});void reg.update().catch(()=>{});await navigator.serviceWorker.ready;const check=()=>{const worker=navigator.serviceWorker.controller||reg.active;if(!worker)return;const channel=new MessageChannel();channel.port1.onmessage=e=>{if(e.data.ready)ui.setOffline('核心资源离线就绪 · 可添加到主屏幕');};worker.postMessage('CACHE_STATUS',[channel.port2]);};check();navigator.serviceWorker.addEventListener('controllerchange',check);reg.addEventListener('updatefound',()=>{const installing=reg.installing;installing?.addEventListener('statechange',()=>{if(installing.state==='installed'&&reg.active)ui.setOffline('新版本已缓存 · 重新打开游戏即可更新');});});}catch{ui.setOffline('缓存未完成 · 当前仍可在线试玩');}}
offline();
