import * as THREE from 'three';

import {FirstPersonMotion,type FirstPersonMotionFrame} from '../../src/render/firstPersonMotion';
import {getActiveMap} from '../../src/game/map';

export interface ControllerMapBox { x:number; z:number; w:number; h:number; d:number; }
export interface FirstPersonFrame extends FirstPersonMotionFrame {}

/**
 * Camera and locomotion presentation are intentionally separate from the
 * skinned player model. The same
 * colliders used by the map are used for foot probes, so a camera never
 * inherits animation noise from the character's head bone.
 */
export class FirstPersonController {
  readonly world={free(){}};
  private boxes:readonly ControllerMapBox[];
  private readonly camera:THREE.Camera;

  private readonly motion=new FirstPersonMotion();
  readonly weaponMotion=this.motion.offset;

  private constructor(camera:THREE.Camera,boxes:readonly ControllerMapBox[]){this.camera=camera;this.boxes=boxes;}
  static async create(camera:THREE.Camera,boxes:readonly ControllerMapBox[]):Promise<FirstPersonController>{return new FirstPersonController(camera,boxes);}

  /** Apply a physically plausible camera motion layer for this render frame. */
  update(frame:FirstPersonFrame, dt:number, reducedMotion=false):void{
    const delta=Math.min(.1,Math.max(0,dt));
    const position={x:frame.x,y:frame.y,z:frame.z};

    this.motion.update(frame,delta,reducedMotion);
    this.camera.position.set(frame.x,frame.y,frame.z);
    this.camera.rotation.order='YXZ';
    this.camera.rotation.set(frame.pitch,frame.yaw,0,'YXZ');
  }

  /** Analytic vertical probe used by the third-person foot solver. */
  groundHeight(x:number,y:number,z:number,maxDistance=2.2):number|null{
    if(getActiveMap().geometry){const floor=getActiveMap().geometry!.ground(x,z,y+.12);return floor!=null&&y-floor<maxDistance?floor:null;}
    let floor:number|null=y+.12>=0&&y<maxDistance?0:null;
    for(const box of this.boxes)if(Math.abs(x-box.x)<=box.w/2&&Math.abs(z-box.z)<=box.d/2&&box.h<=y+.12&&y-box.h<maxDistance)floor=Math.max(floor??-Infinity,box.h);
    return floor;
  }

  diagnostics(){return {engine:'Offline analytic foot probes + original gameplay collision',...this.motion.diagnostics()};}
}

export interface LocomotionMixer { mixer:THREE.AnimationMixer; idle:THREE.AnimationAction; walk:THREE.AnimationAction; run:THREE.AnimationAction; }
/** Shared mixer weighting for imported Idle/Walk/Run clips. */
export function blendLocomotion(mixer:LocomotionMixer,speed:number,dt:number):'Idle'|'Walk'|'Run'{
  const moving=THREE.MathUtils.clamp(speed/1.3,0,1);
  const run=THREE.MathUtils.clamp((speed-1.9)/1.4,0,1)*moving;
  mixer.idle.setEffectiveWeight(1-moving);mixer.walk.setEffectiveWeight(moving-run);mixer.run.setEffectiveWeight(run);
  mixer.walk.setEffectiveTimeScale(Math.max(.5,speed/1.5));mixer.run.setEffectiveTimeScale(Math.max(.65,speed/3.4));
  mixer.mixer.update(Math.max(0,Math.min(.1,dt)));
  return run>.5?'Run':moving>.08?'Walk':'Idle';
}
