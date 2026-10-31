import {gameViewport} from './viewport';
import {clientVersion,miniTool,type MiniTool,type NativeFrame} from './platform';
export interface SensorStatus { code:string;label:string;detail:string;needsGesture:boolean }
type Axis={x:number;y:number};
const zero=():Axis=>({x:0,y:0}),finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const limit=(n:number,max:number)=>Math.max(-max,Math.min(max,n));
/** XHS angular velocity in rad/s. A single serialized owner manages native sampling. */
export class GyroSensor {
 enabled=false;sensitivity=1;active=false;disposed=false;listening=false;requesting=false;
 samples=0;rejected=0;pending=zero();lastOutput=zero();applied=0;lastReceived:number|null=null;lastStamp:number|null=null;
 raw:NativeFrame|null=null;orientation=0;
 status:SensorStatus={code:'off',label:'陀螺仪已关闭',detail:'启用后转动手机微调瞄准；触屏操控仍可使用。',needsGesture:true};
 private operations:Promise<void>=Promise.resolve();private registered=false;private running=false;private timer:ReturnType<typeof setTimeout>|null=null;
 constructor(public onStatus?:(status:SensorStatus)=>void,private api:()=>MiniTool|undefined=miniTool,private version:()=>number=clientVersion,private now:()=>number=()=>performance.now()){
  this.orientation=this.screenAngle();window.addEventListener('resize',this.resetForOrientation);window.addEventListener('orientationchange',this.resetForOrientation);
  document.addEventListener('visibilitychange',this.resetForVisibility);window.addEventListener('blur',this.resetForBlur);this.onStatus?.({...this.status});
 }
 configureEnabled(enabled:boolean,sensitivity=1):void{
  if(this.disposed)return;this.enabled=enabled;this.sensitivity=finite(sensitivity)?Math.max(.3,Math.min(3,sensitivity)):1;this.reset();
  if(!enabled)this.publish('off','陀螺仪已关闭','触屏瞄准仍可使用。',true);
  else if(this.available()&&!this.active)this.publish('waiting','陀螺仪已启用','进入横屏游戏后开始采集；暂停和菜单中停止采集。');
  this.reconcile();
 }
 available():boolean{
  const api=this.api();if(this.version()>=9500&&api&&typeof api.startGyroscope==='function'&&typeof api.stopGyroscope==='function'&&typeof api.onGyroscopeChange==='function'&&typeof api.offGyroscopeChange==='function')return true;
  if(this.enabled)this.publish('unavailable','当前环境不支持陀螺仪','需要小红书 9.50 或更新版本及支持陀螺仪的手机；仍可滑动屏幕瞄准。',false);return false;
 }
 async requestAccess():Promise<void>{if(this.disposed||!this.enabled)return;if(this.available()){this.reconcile();await this.operations;}}
 start():void{this.reconcile();}
 stop():void{this.active=false;this.reset();this.reconcile();}
 setActive(active:boolean):void{if(active===this.active)return;this.active=active;this.reset();this.reconcile();}
 private wanted():boolean{return !this.disposed&&this.enabled&&this.active&&!document.hidden;}
 private reconcile():void{this.operations=this.operations.then(()=>this.sync()).catch(()=>{this.publish('error','陀螺仪暂不可用','请关闭后重新启用；仍可使用触屏瞄准。',true);});}
 private async sync():Promise<void>{
  const api=this.api();if(!api)return;
  if(!this.wanted()){
   this.listening=false;this.reset();this.clearTimer();
   if(this.running){try{await api.stopGyroscope!();}catch{this.publish('error','陀螺仪停止失败','采样已与瞄准断开；可继续触屏操作。',true);}this.running=false;}
   if(this.registered){api.offGyroscopeChange!(this.onFrame);this.registered=false;}return;
  }
  if(this.running||!this.available())return;
  this.requesting=true;this.publish('requesting','正在启用陀螺仪','正在启动小红书原生陀螺仪。');
  try{api.onGyroscopeChange!(this.onFrame);this.registered=true;await api.startGyroscope!({interval:'ui'});this.running=true;
   if(this.wanted()){this.listening=true;this.publish('waiting','等待陀螺仪数据','握稳手机后轻轻转动；触屏操作仍可使用。');this.watch();}
  }catch(error){if(this.registered)api.offGyroscopeChange!(this.onFrame);this.registered=false;this.running=false;this.listening=false;
   const unsupported=!!error&&typeof error==='object'&&'errCode' in error&&(error as {errCode:unknown}).errCode===10002;
   this.publish('error',unsupported?'设备不支持陀螺仪':'陀螺仪启动失败','请使用触屏瞄准，或关闭后重新启用。',!unsupported);
  }finally{this.requesting=false;}
  if(!this.wanted()&&this.running)await this.sync();
 }
 /** Exposed for lifecycle verification and orderly teardown. */
 settled():Promise<void>{return this.operations;}
 canAim():boolean{return this.wanted()&&this.listening;}
 inactiveReason():string{return !this.enabled?'已关闭':document.hidden?'页面在后台':!this.active?'菜单 / 暂停，不控制视角':'游戏中';}
 get controlling():boolean{return this.canAim()&&this.lastReceived!==null&&this.now()-this.lastReceived<=250;}
 consume():Axis{if(!this.controlling){this.reset();return zero();}const value=this.pending;this.pending=zero();if(value.x||value.y){this.lastOutput={...value};this.applied++;}return value;}
 reset():void{this.pending=zero();this.lastStamp=null;}
 calibrate():void{this.reset();if(this.listening)this.publish('ready','陀螺仪已归零','当前握持姿势成为新的瞄准基准。');}
 screenAngle():number{const angle=window.screen?.orientation?.angle??(window as Window & {orientation?:number}).orientation??0;return (finite(angle)?angle:0)+(gameViewport().rotated?90:0);}
 resetForOrientation=():void=>{this.orientation=this.screenAngle();this.reset();};
 resetForBlur=():void=>{this.setActive(false);};
 resetForVisibility=():void=>{this.reset();this.reconcile();};
 onFrame=(frame:NativeFrame):void=>{
  if(!this.listening||!this.wanted())return;
  if(!frame||![frame.x,frame.y,frame.z].every(finite)||Math.abs(frame.x)>12.57||Math.abs(frame.y)>12.57||Math.abs(frame.z)>12.57){this.rejected++;this.reset();return;}
  const stamp=this.now();this.raw={...frame};this.samples++;this.lastReceived=stamp;this.watch();
  if(this.screenAngle()!==this.orientation)this.resetForOrientation();
  this.publish('ready','陀螺仪可用','小红书原生角速度瞄准；转动手机微调视角。');
  if(!this.canAim()){this.reset();return;}const last=this.lastStamp;this.lastStamp=stamp;if(last===null)return;
  const dt=(stamp-last)/1000;if(dt<=0||dt>.25){this.pending=zero();return;}
  const a=this.orientation*Math.PI/180;
  const x=frame.x*Math.sin(a)+frame.y*Math.cos(a),y=frame.x*Math.cos(a)-frame.y*Math.sin(a);
  this.pending.x=limit(this.pending.x+(Math.abs(x)<.0026?0:x)*dt*this.sensitivity,.35);
  this.pending.y=limit(this.pending.y+(Math.abs(y)<.0026?0:y)*dt*this.sensitivity,.35);
 };
 private clearTimer():void{if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}}
 private watch():void{this.clearTimer();this.timer=setTimeout(()=>{this.reset();if(this.listening)this.publish('no-data','暂未收到陀螺仪数据','请转动手机或重新启用；触屏瞄准仍可使用。',true);},2000);}
 publish(code:string,label:string,detail:string,needsGesture=false):void{if(this.status.code===code&&this.status.label===label&&this.status.detail===detail&&this.status.needsGesture===needsGesture)return;this.status={code,label,detail,needsGesture};this.onStatus?.({...this.status});}
 diagnostics(){return {enabled:this.enabled,sensitivity:this.sensitivity,active:this.active,listening:this.listening,controlling:this.controlling,source:'xhs-native-rad-per-second',status:{...this.status},samples:this.samples,rejected:this.rejected,raw:this.raw,pending:{...this.pending},applied:this.applied,lastOutput:{...this.lastOutput},sampleAgeMs:this.lastReceived===null?null:Math.round(this.now()-this.lastReceived),screenAngle:this.screenAngle(),gate:this.inactiveReason()};}
 diagnosticText():string{const n=(v:unknown)=>finite(v)?v.toFixed(3):'—';return `小红书原生陀螺仪 · 屏幕 ${this.screenAngle()}°\n角速度 x ${n(this.raw?.x)} / y ${n(this.raw?.y)} / z ${n(this.raw?.z)} rad/s\n有效帧 ${this.samples} · 拒绝帧 ${this.rejected}\n${this.inactiveReason()} · ${this.status.label}`;}
 dispose():void{if(this.disposed)return;this.disposed=true;this.active=false;this.reset();this.clearTimer();this.reconcile();window.removeEventListener('resize',this.resetForOrientation);window.removeEventListener('orientationchange',this.resetForOrientation);window.removeEventListener('blur',this.resetForBlur);document.removeEventListener('visibilitychange',this.resetForVisibility);}
}
