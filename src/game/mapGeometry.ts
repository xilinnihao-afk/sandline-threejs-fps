/** Map geometry is shared by movement, visibility, navigation and ground items. */
export interface MapPoint {x:number;z:number;y?:number;yaw?:number;crouched?:boolean;ladder?:number;}
export interface MapGeometry {
 readonly jumpSpeed?:number;
 /** Enable bot jumps only where navigation includes proven jump edges. */
 readonly botJumpSpeed?:number;
 /** Original-map crouch eye offset, kept inside its shorter collision hull. */
 readonly crouchEyeHeight?:number;
 /** Feet retraction when ducking in the air; leaves the body centre unchanged. */
 readonly airDuckLift?:number;
 /** Standing routes for civilian escorts, excluding ladders, ducts and jumps. */
 groundPath?(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):MapPoint[];
 groundSegment?(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):boolean;
 /** Optional traversal for maps with original GoldSrc ladders and low ducts. */
 needsCrouch?(x:number,z:number,y:number):boolean;
 ladderAt?(x:number,z:number,y:number):boolean;
 climb?(x:number,z:number,y:number,dx:number,dz:number,dt:number,targetY?:number):MapPoint|null;
 readonly navigation?:{points:Array<{x:number;y:number;z:number}>};
 ground(x:number,z:number,below?:number,crouched?:boolean):number|null;
 blocked(x:number,z:number,y?:number,crouched?:boolean):boolean;
 move(x:number,z:number,dx:number,dz:number,y?:number,crouched?:boolean):MapPoint;
 ray(x:number,y:number,z:number,dx:number,dy:number,dz:number):number;
 segment(x:number,z:number,tx:number,tz:number,y?:number,ty?:number,crouched?:boolean):boolean;
 path(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):MapPoint[];
 vertical(x:number,z:number,from:number,to:number,crouched?:boolean):number;
}
