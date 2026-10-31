import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {FirstPersonMotion,type FirstPersonMotionFrame} from './firstPersonMotion';
import {getActiveMap} from '../game/map';

export interface ControllerMapBox { x:number; z:number; w:number; h:number; d:number; }
export interface FirstPersonFrame extends FirstPersonMotionFrame {}

/**
 * Camera and locomotion presentation are intentionally separate from the
 * skinned player model. Rapier owns a small kinematic proxy and the same
 * colliders used by the map are used for foot probes, so a camera never
 * inherits animation noise from the character's head bone.
 */
export class FirstPersonController {
  readonly world:RAPIER.World;
  readonly body:RAPIER.RigidBody;
  private readonly camera:THREE.Camera;
  private readonly ray = new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
  private readonly motion=new FirstPersonMotion();
  readonly weaponMotion=this.motion.offset;

  private constructor(camera:THREE.Camera, world:RAPIER.World, body:RAPIER.RigidBody){
    this.camera=camera; this.world=world; this.body=body;
  }

  static async create(camera:THREE.Camera, boxes:readonly ControllerMapBox[]):Promise<FirstPersonController>{
    await RAPIER.init();
    const world = new RAPIER.World({x:0,y:-9.81,z:0});
    const floor=RAPIER.ColliderDesc.cuboid(80,.05,80).setTranslation(0,-.05,0);
    world.createCollider(floor);
    for(const b of boxes){
      world.createCollider(RAPIER.ColliderDesc.cuboid(b.w/2,b.h/2,b.d/2).setTranslation(b.x,b.h/2,b.z));
    }
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,1,0));
    world.createCollider(RAPIER.ColliderDesc.capsule(.42,.28),body);
    return new FirstPersonController(camera,world,body);
  }

  /** Apply a physically plausible camera motion layer for this render frame. */
  update(frame:FirstPersonFrame, dt:number, reducedMotion=false):void{
    const delta=Math.min(.1,Math.max(0,dt));
    const position={x:frame.x,y:frame.y,z:frame.z};
    this.body.setNextKinematicTranslation(position);
    this.world.step();
    this.motion.update(frame,delta,reducedMotion);
    this.camera.position.set(frame.x,frame.y,frame.z);
    this.camera.rotation.order='YXZ';
    this.camera.rotation.set(frame.pitch,frame.yaw,0,'YXZ');
  }

  /** Rapier ray probe used by the third-person foot solver. */
  groundHeight(x:number,y:number,z:number,maxDistance=2.2):number|null{
    if(getActiveMap().geometry){const floor=getActiveMap().geometry!.ground(x,z,y+.12);return floor!=null&&y-floor<maxDistance?floor:null;}
    this.ray.origin.x=x;this.ray.origin.y=y+.12;this.ray.origin.z=z;
    const hit=this.world.castRay(this.ray,maxDistance,true);
    return hit?this.ray.origin.y-hit.timeOfImpact:null;
  }

  diagnostics(){return {engine:'Rapier3D kinematic proxy + map colliders',...this.motion.diagnostics()};}
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
