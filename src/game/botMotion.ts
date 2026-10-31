const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
export interface BotMotion {speed:number;heading:number|null;}

/** Ease into travel, brake at the destination and slow down for sharp turns. */
export function advanceBotMotion(motion:BotMotion,dx:number,dz:number,dt:number,pace:number){
 const distance=Math.hypot(dx,dz),desired=Math.atan2(dx,dz);
 motion.heading??=desired;
 const turn=wrap(desired-motion.heading);
 motion.heading=wrap(motion.heading+Math.max(-4.5*dt,Math.min(4.5*dt,turn*(1-Math.exp(-9*dt)))));
 const corner=Math.max(.3,Math.cos(Math.min(Math.PI/2,Math.abs(turn))));
 const target=Math.min(pace*corner,Math.sqrt(2*5*Math.max(0,distance-.12)));
 motion.speed+=(target-motion.speed)*(1-Math.exp(-(target>motion.speed?5:9)*dt));
 const step=Math.min(distance,motion.speed*dt);
 return {x:Math.sin(motion.heading)*step,z:Math.cos(motion.heading)*step};
}

export function turnBot(yaw:number,target:number,dt:number,rate=4.5){
 return wrap(yaw+Math.max(-rate*dt,Math.min(rate*dt,wrap(target-yaw)*(1-Math.exp(-9*dt)))));
}
