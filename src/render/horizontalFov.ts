/** World lens: fixed horizontal framing, with optical magnification layered on top.
 * Same object/depth => same fraction of viewport width, not same physical cm. */
export const BASE_HORIZONTAL_FOV=90;
export function clampViewScale(value:number):number{
 return Number.isFinite(value)?Math.max(1,Math.min(1.3,value)):1;
}
export function landscapeViewport(width:number,height:number):boolean{
 return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&width>height;
}
export function verticalFovFromHorizontal(horizontalDegrees:number,aspect:number,magnification=1):number{
 const ratio=Number.isFinite(aspect)&&aspect>0?aspect:1;
 const zoom=Number.isFinite(magnification)&&magnification>0?magnification:1;
 return 2*Math.atan(Math.tan(horizontalDegrees*Math.PI/360)/(ratio*zoom))*180/Math.PI;
}
export function worldVerticalFov(width:number,height:number,viewScale=1,aimMagnification=1):number{
 return verticalFovFromHorizontal(BASE_HORIZONTAL_FOV,width/height,clampViewScale(viewScale)*aimMagnification);
}

/** Gate GPU setup as well as game rendering when first opened in portrait. */
export async function waitForLandscape(target:Pick<Window,'innerWidth'|'innerHeight'|'addEventListener'|'removeEventListener'>=window):Promise<void>{
 if(landscapeViewport(target.innerWidth,target.innerHeight))return;
 await new Promise<void>(resolve=>{
  const check=()=>{if(landscapeViewport(target.innerWidth,target.innerHeight)){target.removeEventListener('resize',check);resolve();}};
  target.addEventListener('resize',check);check();
 });
}
