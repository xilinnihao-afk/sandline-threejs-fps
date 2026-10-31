/** World lens: fixed horizontal framing, with optical magnification layered on top.
 * Same object/depth => same fraction of viewport width, not same physical cm. */
export const BASE_HORIZONTAL_FOV=90;
export function clampViewScale(value:number):number{
 return Number.isFinite(value)?Math.max(1,Math.min(1.3,value)):1;
}
// The host can remain portrait; controls and camera adapt to both orientations.
export function landscapeViewport(width:number,height:number):boolean {return width>0&&height>0;}
export function verticalFovFromHorizontal(horizontalDegrees:number,aspect:number,magnification=1):number{
 const ratio=Number.isFinite(aspect)&&aspect>0?aspect:1;
 const zoom=Number.isFinite(magnification)&&magnification>0?magnification:1;
 return 2*Math.atan(Math.tan(horizontalDegrees*Math.PI/360)/(ratio*zoom))*180/Math.PI;
}
export function worldVerticalFov(width:number,height:number,viewScale=1,aimMagnification=1):number{
 return verticalFovFromHorizontal(width<height?58:BASE_HORIZONTAL_FOV,width/height,clampViewScale(viewScale)*aimMagnification);
}

/** Gate GPU setup as well as game rendering when first opened in portrait. */
export async function waitForLandscape():Promise<void>{}
