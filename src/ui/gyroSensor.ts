/** Browser sensor transport shared with MIDWAY's GyroSensor.js. No camera ownership. */
export interface SensorStatus { code:string; label:string; detail:string; needsGesture:boolean; }
type Axis={x:number;y:number};
type Source='motion'|'orientation';
type Permission='unknown'|'not-required'|'granted'|'denied'|'error'|'unavailable';
type SensorAPI={requestPermission?:()=>Promise<string>};
type Quaternion={x:number;y:number;z:number;w:number};
const RAD=Math.PI/180,STALE_MS=250,MAX_GAP_MS=250,DEAD_ZONE=.15,MAX_RATE=720;
const zero=():Axis=>({x:0,y:0});
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const clamp=(n:number,limit:number)=>Math.max(-limit,Math.min(limit,n));
const multiply=(a:Quaternion,b:Quaternion):Quaternion=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
function pose(alpha:number,beta:number,gamma:number):Quaternion {
 const a=alpha*RAD/2,b=beta*RAD/2,g=gamma*RAD/2;
 return multiply(multiply({x:0,y:0,z:Math.sin(a),w:Math.cos(a)},{x:Math.sin(b),y:0,z:0,w:Math.cos(b)}),{x:0,y:Math.sin(g),z:0,w:Math.cos(g)});
}

export class GyroSensor {
 enabled=false;sensitivity=1;active=false;disposed=false;listening=false;requesting=false;
 generation=0;samples=0;rejected=0;pending=zero();
 status:SensorStatus={code:'off',label:'陀螺仪已关闭',detail:'启用后转动手机微调瞄准；触屏操控仍可使用。',needsGesture:true};
 permissions:Record<Source,Permission>={motion:'unknown',orientation:'unknown'};
 events={motion:0,orientation:0};valid={motion:0,orientation:0};
 raw:{motion:object|null;orientation:object|null}={motion:null,orientation:null};
 source:Source|null=null;lastReceived:number|null=null;lastStamp:number|null=null;
 lastMotion:number|null=null;lastOrientationStamp:number|null=null;lastPose:Quaternion|null=null;
 filtered:Axis|null=null;lastOutput=zero();applied=0;timer:number|undefined;
 orientation=0;lastLog=0;
 constructor(public onStatus?:(status:SensorStatus)=>void){
  this.orientation=this.screenAngle();
  window.addEventListener('orientationchange',this.resetForOrientation);
  window.addEventListener('resize',this.resetForOrientation);
  window.screen?.orientation?.addEventListener('change',this.resetForOrientation);
  window.addEventListener('blur',this.resetForBlur);
  document.addEventListener('visibilitychange',this.resetForVisibility);
  this.onStatus?.({...this.status});
 }
 configureEnabled(enabled:boolean,sensitivity=1):void{
  if(this.disposed)return;
  if(enabled!==this.enabled){this.generation++;this.requesting=false;this.reset();}
  this.enabled=enabled;this.sensitivity=finite(sensitivity)?Math.max(.3,Math.min(3,sensitivity)):1;
  if(!enabled){this.stop();this.publish('off','陀螺仪已关闭','启用后转动手机微调瞄准；触屏操控仍可使用。',true);return;}
  if(!this.available()||this.listening)return;
  this.refreshPermissions();
  if(this.allowedSources().length)this.start();
  else this.publish('permission','等待传感器授权','点击“启用陀螺仪”，在 Safari 弹窗中允许运动与方向访问。',true);
 }
 api(source:Source):SensorAPI|undefined {
  const w=window as unknown as {DeviceMotionEvent?:SensorAPI;DeviceOrientationEvent?:SensorAPI};
  return source==='motion'?w.DeviceMotionEvent:w.DeviceOrientationEvent;
 }
 refreshPermissions():void{
  for(const source of ['motion','orientation'] as const){const api=this.api(source);if(!api)this.permissions[source]='unavailable';else if(!api.requestPermission)this.permissions[source]='not-required';}
 }
 allowedSources():Source[]{return (['motion','orientation'] as const).filter(s=>['granted','not-required'].includes(this.permissions[s]));}
 async requestAccess():Promise<void>{
  if(this.disposed||!this.enabled||this.requesting||!this.available())return;
  const generation=this.generation;this.refreshPermissions();this.requesting=true;
  // BOTH requests are started synchronously in the click handler, before the first await.
  const requests=(['motion','orientation'] as const).map(source=>{
   const api=this.api(source);
   if(!api?.requestPermission||this.permissions[source]==='granted')return Promise.resolve();
   try{return api.requestPermission().then(value=>{if(generation===this.generation&&!this.disposed)this.permissions[source]=value==='granted'?'granted':'denied';},()=>{if(generation===this.generation&&!this.disposed)this.permissions[source]='error';});}
   catch{this.permissions[source]='error';return Promise.resolve();}
  });
  this.publish('requesting','正在请求权限','请允许运动与方向访问；若内置浏览器没有弹窗，请在 Safari 中打开。');
  await Promise.all(requests);
  if(generation!==this.generation||this.disposed)return;
  this.requesting=false;
  if(this.allowedSources().length){this.start();return;}
  if(Object.values(this.permissions).includes('denied'))this.publish('denied','传感器权限被拒绝','请在 Safari 重新打开并允许访问。若不再弹窗，请检查该网站的运动与方向权限后重试。',true);
  else this.publish('error','传感器授权失败','请用原生 Safari 打开 HTTPS 游戏网址后重试；微信、抖音等内置浏览器可能不开放传感器。',true);
 }
 available():boolean{
  this.refreshPermissions();
  if(!window.isSecureContext){this.stop();this.publish('insecure','需要 HTTPS','当前连接不安全。请点击下方 HTTPS 游戏入口，再启用陀螺仪。',true);return false;}
  if(!this.api('motion')&&!this.api('orientation')){this.stop();this.publish('unavailable','浏览器不支持传感器','请用手机原生 Safari 或 Chrome 打开；内置浏览器可能屏蔽运动与方向接口。',true);return false;}
  return true;
 }
 start():void{
  if(this.disposed||!this.enabled)return;
  this.reset();this.lastReceived=null;this.lastMotion=null;this.source=null;
  // Listening is safe only after permission; orientation is a fallback, not an additive input.
  for(const source of this.allowedSources())window.addEventListener(source==='motion'?'devicemotion':'deviceorientation',source==='motion'?this.onMotion as EventListener:this.onOrientation as EventListener);
  this.listening=true;this.publish('waiting','等待传感器数据','握稳后轻轻转动手机。可展开“传感器诊断”查看事件和原始数值；在菜单中不会转动游戏视角。');this.watch(2500);
 }
 stop():void{
  window.removeEventListener('devicemotion',this.onMotion);window.removeEventListener('deviceorientation',this.onOrientation);
  this.listening=false;this.clearTimer();this.reset();this.lastReceived=null;this.lastMotion=null;this.source=null;
 }
 setActive(active:boolean):void{if(this.active!==active){this.active=active;this.reset();}}
 canAim():boolean{return !this.disposed&&this.enabled&&this.listening&&this.active&&!document.hidden;}
 inactiveReason():string{return !this.enabled?'已关闭':document.hidden?'页面在后台':!this.active?'菜单 / 暂停，不控制视角':'游戏中';}
 get controlling():boolean{return this.canAim()&&this.lastReceived!==null&&performance.now()-this.lastReceived<=STALE_MS;}
 consume():Axis{
  if(!this.controlling){this.reset();return zero();}
  const result=this.pending;this.pending=zero();
  if(result.x||result.y){this.lastOutput={...result};this.applied++;}
  return result;
 }
 reset():void{this.pending=zero();this.lastStamp=null;this.lastOrientationStamp=null;this.lastPose=null;this.filtered=null;}
 calibrate():void{this.reset();if(this.status.code==='ready')this.publish('ready','陀螺仪已归零','以当前握持姿势重新建立转动基准，停止转动即可保持瞄准。');}
 screenAngle():number{const a=window.screen?.orientation?.angle??(window as unknown as {orientation?:number}).orientation??0;return finite(a)?a:0;}
 resetForOrientation=():void=>{this.orientation=this.screenAngle();this.reset();};
 resetForBlur=():void=>{this.setActive(false);this.reset();};
 resetForVisibility=():void=>{this.reset();if(document.hidden)this.setActive(false);else if(this.listening)this.watch(2500);};
 accept(source:Source):void{
  this.samples++;this.valid[source]++;this.lastReceived=performance.now();
  if(this.source!==source){this.source=source;this.pending=zero();this.filtered=null;}
  const label=source==='motion'?'陀螺仪可用 · 角速度':'陀螺仪可用 · 姿态回退';
  this.publish('ready',label,'转动手机微调瞄准；进入游戏后生效。横屏、归零、暂停恢复时重新记录基准，不会突然跳转。');this.watch(1500);
 }
 integrate(x:number,y:number,dt:number):void{
  const a=this.orientation*RAD;
  const desired={x:x*Math.sin(a)+y*Math.cos(a),y:x*Math.cos(a)-y*Math.sin(a)};
  for(const axis of ['x','y'] as const)if(Math.abs(desired[axis])<DEAD_ZONE)desired[axis]=0;
  if(!this.filtered)this.filtered={...desired};
  const blend=1-Math.exp(-Math.max(0,dt)/.025);
  for(const axis of ['x','y'] as const){
   // A stationary axis clears the filter immediately: no residual drift or delayed turn.
   this.filtered[axis]=desired[axis]===0?0:this.filtered[axis]+(desired[axis]-this.filtered[axis])*blend;
   this.pending[axis]=clamp(this.pending[axis]+this.filtered[axis]*RAD*dt*this.sensitivity,.35);
  }
 }
 onMotion=(event:DeviceMotionEvent):void=>{
  this.events.motion++;const r=event.rotationRate;
  this.raw.motion=r?{alpha:r.alpha,beta:r.beta,gamma:r.gamma}:null;this.log();
  if(this.screenAngle()!==this.orientation)this.resetForOrientation();
  if(!r||!finite(r.beta)||!finite(r.gamma)||Math.abs(r.beta)>MAX_RATE||Math.abs(r.gamma)>MAX_RATE||!finite(event.timeStamp)){this.rejected++;if(this.source==='motion'){this.pending=zero();this.lastStamp=null;this.filtered=null;}return;}
  this.lastMotion=performance.now();this.accept('motion');
  if(!this.canAim()){this.reset();return;}
  const previous=this.lastStamp;this.lastStamp=event.timeStamp;
  if(previous===null){this.integrate(r.beta,r.gamma,0);return;}
  const dt=(event.timeStamp-previous)/1000;
  if(dt<=0||dt*1000>MAX_GAP_MS){this.pending=zero();this.filtered=null;return;}
  this.integrate(r.beta,r.gamma,dt);
 };
 onOrientation=(event:DeviceOrientationEvent):void=>{
  this.events.orientation++;this.raw.orientation={alpha:event.alpha,beta:event.beta,gamma:event.gamma};this.log();
  if(this.screenAngle()!==this.orientation)this.resetForOrientation();
  if(!finite(event.beta)||!finite(event.gamma)||!finite(event.timeStamp)){this.rejected++;this.lastPose=null;this.lastOrientationStamp=null;return;}
  // A fresh angular-velocity stream owns aiming. Never integrate both streams.
  if(this.lastMotion!==null&&performance.now()-this.lastMotion<=STALE_MS){this.valid.orientation++;this.lastPose=null;this.lastOrientationStamp=null;return;}
  this.accept('orientation');
  const current=pose(finite(event.alpha)?event.alpha:0,event.beta,event.gamma);
  if(!this.canAim()){this.reset();return;}
  const previous=this.lastPose,stamp=this.lastOrientationStamp;this.lastPose=current;this.lastOrientationStamp=event.timeStamp;
  if(!previous||stamp===null)return;
  const dt=(event.timeStamp-stamp)/1000;
  if(dt<=0||dt*1000>MAX_GAP_MS){this.pending=zero();this.filtered=null;return;}
  // Z-X'-Y'' attitude -> body-relative rotation. Handles alpha wrap and both
  // landscape orientations without subtracting Euler angles across +/-180 degrees.
  const delta=multiply({x:-previous.x,y:-previous.y,z:-previous.z,w:previous.w},current);
  if(delta.w<0){delta.x=-delta.x;delta.y=-delta.y;delta.z=-delta.z;delta.w=-delta.w;}
  const length=Math.hypot(delta.x,delta.y,delta.z),angle=2*Math.atan2(length,delta.w);
  if(angle/dt/RAD>MAX_RATE){this.rejected++;this.pending=zero();this.filtered=null;return;}
  const gain=length>1e-9?angle/length/dt/RAD:0;
  this.integrate(delta.x*gain,delta.y*gain,dt);
 };
 clearTimer():void{if(this.timer!==undefined){window.clearTimeout(this.timer);this.timer=undefined;}}
 watch(ms:number):void{
  this.clearTimer();this.timer=window.setTimeout(()=>{
   this.timer=undefined;this.reset();
   if(this.listening&&!document.hidden)this.publish('no-data','未收到有效传感器数据',this.events.motion+this.events.orientation?'收到事件，但没有可用转动数据。请展开诊断检查数值；在手机 Safari 中重新允许权限。':'没有收到传感器事件。请确认 HTTPS、允许权限，并用原生 Safari 打开；内置浏览器可能屏蔽传感器。',true);
  },ms);
 }
 publish(code:string,label:string,detail:string,needsGesture=false):void{
  if(this.status.code===code&&this.status.label===label&&this.status.detail===detail&&this.status.needsGesture===needsGesture)return;
  this.status={code,label,detail,needsGesture};this.onStatus?.({...this.status});
 }
 diagnostics(){return {enabled:this.enabled,sensitivity:this.sensitivity,active:this.active,listening:this.listening,controlling:this.controlling,secureContext:window.isSecureContext,permissions:{...this.permissions},source:this.source,status:{...this.status},screenAngle:this.screenAngle(),events:{...this.events},valid:{...this.valid},samples:this.samples,rejected:this.rejected,raw:{...this.raw},pending:{...this.pending},applied:this.applied,lastOutput:{...this.lastOutput},sampleAgeMs:this.lastReceived===null?null:Math.round(performance.now()-this.lastReceived),gate:this.inactiveReason()};}
 diagnosticText():string{
  const permissions:Record<Permission,string>={unknown:'未申请','not-required':'无需弹窗',granted:'允许',denied:'拒绝',error:'请求失败',unavailable:'无接口'};
  const raw=this.raw.orientation as {alpha:number|null;beta:number|null;gamma:number|null}|null;
  const rate=this.raw.motion as typeof raw;
  const n=(v:unknown)=>finite(v)?v.toFixed(2):'空';
  return `${window.isSecureContext?'HTTPS / 安全环境':'HTTP / 不安全'} · 屏幕 ${this.screenAngle()}°\n权限：运动 ${permissions[this.permissions.motion]} / 姿态 ${permissions[this.permissions.orientation]}\n事件：运动 ${this.events.motion} / 姿态 ${this.events.orientation} · 有效 ${this.samples}\n角速度 β ${n(rate?.beta)} / γ ${n(rate?.gamma)} °/s\n姿态 α ${n(raw?.alpha)} / β ${n(raw?.beta)} / γ ${n(raw?.gamma)} °\n当前：${this.source==='motion'?'角速度':this.source==='orientation'?'姿态回退':'等待数据'} · ${this.inactiveReason()}\n已应用 ${this.applied} 次 · 上次转动 ${n(this.lastOutput.x/RAD)} / ${n(this.lastOutput.y/RAD)}°`;
 }
 log():void{
  const now=performance.now();
  if(window.location?.search.includes('gyrodebug')&&now-this.lastLog>500){this.lastLog=now;console.debug('[GyroAim]',this.diagnostics());}
 }
 dispose():void{
  if(this.disposed)return;this.disposed=true;this.generation++;this.stop();
  window.removeEventListener('orientationchange',this.resetForOrientation);window.removeEventListener('resize',this.resetForOrientation);window.screen?.orientation?.removeEventListener('change',this.resetForOrientation);window.removeEventListener('blur',this.resetForBlur);document.removeEventListener('visibilitychange',this.resetForVisibility);
 }
}
