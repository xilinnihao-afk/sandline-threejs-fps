/** Some containers repeat resize notifications without changing the viewport.
 * Do not release a held joystick or rebuild the drawing buffer for those. */
export function watchGameResize(resize:()=>void,reset:()=>void):void{
 let width=window.innerWidth,height=window.innerHeight;
 window.addEventListener('resize',()=>{
  const nextWidth=window.innerWidth,nextHeight=window.innerHeight;
  if(nextWidth<1||nextHeight<1||Math.abs(nextWidth-width)<1&&Math.abs(nextHeight-height)<1)return;
  width=nextWidth;height=nextHeight;reset();resize();
 });
}
