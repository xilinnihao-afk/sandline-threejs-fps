import type {GyroMode} from '../game/types';
import {GyroSensor,type SensorStatus} from './gyroSensor';
export type GyroStatus=SensorStatus;

/** Gameplay gating; the sensor layer never writes the camera or player rotation. */
export class GyroAim extends GyroSensor {
 private mode:GyroMode='off';
 private aiming=false;
 configure(mode:GyroMode,sensitivity:number):void{
  const next=mode==='aim'||mode==='always'?mode:'off';
  if(next!==this.mode){this.reset();this.mode=next;}
  this.configureEnabled(next!=='off',sensitivity);
 }
 override consume(aiming=false):{x:number;y:number}{
  if(this.aiming!==aiming){this.aiming=aiming;if(this.mode==='aim')this.reset();}
  return super.consume();
 }
 override canAim():boolean{return super.canAim()&&window.innerWidth>window.innerHeight&&(this.mode==='always'||this.aiming);}
 override inactiveReason():string{
  if(!this.enabled||!this.active||document.hidden)return super.inactiveReason();
  if(window.innerWidth<=window.innerHeight)return '等待横屏';
  if(this.mode==='aim'&&!this.aiming)return '仅开镜模式：等待开镜 / 精瞄';
  return '游戏中';
 }
 override diagnostics(){return {...super.diagnostics(),mode:this.mode,aiming:this.aiming};}
}
