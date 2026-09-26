import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export interface ControllerMapBox { x:number; z:number; w:number; h:number; d:number; }
export interface FirstPersonFrame {
  x:number; y:number; z:number; yaw:number; pitch:number;
  speed:number; moving:boolean; crouched?:boolean;
  lookDX?:number; lookDY?:number; cameraKick?:number;
}

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
  private readonly velocity = new THREE.Vector3();
  private readonly sway = new THREE.Vector2();
  private bobTime = 0;
  private last = new THREE.Vector3();
  private initialized = false;

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
    const rawSpeed=Math.max(0,frame.speed);
    const blend=1-Math.exp(-delta*12);
    this.velocity.lerp(new THREE.Vector3(frame.moving?rawSpeed:0,0,0),blend);
    if(!this.initialized){this.last.set(frame.x,frame.y,frame.z);this.initialized=true;}
    const distance=Math.hypot(frame.x-this.last.x,frame.z-this.last.z);
    const measured=delta>0?distance/delta:0;
    this.last.set(frame.x,frame.y,frame.z);
    const strideSpeed=Math.max(rawSpeed,measured);
    const moving=frame.moving&&strideSpeed>.04;
    if(!reducedMotion&&moving)this.bobTime+=delta*(strideSpeed>2.2?11.5:8.2);
    const intensity=reducedMotion?0:THREE.MathUtils.clamp(strideSpeed/4,0,1);
    const breathing=reducedMotion?0:Math.sin(this.bobTime*.48)*.004;
    const bobY=(Math.sin(this.bobTime*2)*.014+Math.sin(this.bobTime*4)*.004)*intensity+breathing;
    const bobX=Math.cos(this.bobTime*2)*.010*intensity;
    // Input look deltas are already radians (the input layer applies the
    // pointer sensitivity). A tenth of that impulse gives a visible but
    // restrained inertia lag instead of a camera that feels disconnected.
    const targetSwayX=THREE.MathUtils.clamp(-(frame.lookDY??0)*.12,-.045,.045);
    const targetSwayY=THREE.MathUtils.clamp(-(frame.lookDX??0)*.12,-.055,.055);
    this.sway.x=THREE.MathUtils.damp(this.sway.x,targetSwayX,9,delta);
    this.sway.y=THREE.MathUtils.damp(this.sway.y,targetSwayY,9,delta);
    const kick=frame.cameraKick??0;
    this.camera.position.set(frame.x+bobX,frame.y+bobY+kick*.035,frame.z);
    this.camera.rotation.order='YXZ';
    this.camera.rotation.set(frame.pitch-this.sway.x-kick,frame.yaw+this.sway.y,kick*.08+this.sway.y*.18,'YXZ');
  }

  /** Rapier ray probe used by the third-person foot solver. */
  groundHeight(x:number,y:number,z:number,maxDistance=2.2):number|null{
    this.ray.origin.x=x;this.ray.origin.y=y+.12;this.ray.origin.z=z;
    const hit=this.world.castRay(this.ray,maxDistance,true);
    return hit?this.ray.origin.y-hit.timeOfImpact:null;
  }

  diagnostics(){return {engine:'Rapier3D kinematic proxy + map colliders',bobTime:+this.bobTime.toFixed(3),sway:[+this.sway.x.toFixed(4),+this.sway.y.toFixed(4)]};}
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
