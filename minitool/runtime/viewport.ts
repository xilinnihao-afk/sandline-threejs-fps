/** Logical landscape viewport; the native container may remain portrait. */
export function viewportSize(width:number,height:number){
 const rotated=height>=width;
 return {width:rotated?height:width,height:rotated?width:height,rotated,physicalWidth:width,physicalHeight:height};
}
export function gameViewport(){return viewportSize(Math.max(1,window.innerWidth),Math.max(1,window.innerHeight));}
export function logicalPoint(x:number,y:number,size:ReturnType<typeof viewportSize>){return size.rotated?{x:y,y:size.physicalWidth-x}:{x,y};}
export function physicalPoint(x:number,y:number,size=gameViewport()){return size.rotated?{x:size.physicalWidth-y,y:x}:{x,y};}
export function gamePoint(event:{clientX:number;clientY:number}){return logicalPoint(event.clientX,event.clientY,gameViewport());}
export function logicalRect(rect:{left:number;top:number;right:number;bottom:number;width:number;height:number},size:ReturnType<typeof viewportSize>){
 // DOMRect's coordinates are prototype getters, not enumerable own fields.
 // Spreading it drops width/height in native landscape WebViews.
 if(!size.rotated)return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,x:rect.left,y:rect.top};
 const left=rect.top,top=size.physicalWidth-rect.right,width=rect.height,height=rect.width;
 return {left,top,width,height,right:left+width,bottom:top+height,x:left,y:top};
}
export function gameRect(element:Element){return logicalRect(element.getBoundingClientRect(),gameViewport());}
export function landscapeInsets(insets:{top:number;right:number;bottom:number;left:number},rotated:boolean){
 return rotated?{top:insets.right,right:insets.bottom,bottom:insets.left,left:insets.top}:insets;
}
export function installLandscape(){
 const root=document.documentElement,body=document.body;
 const probe=document.createElement('div');probe.setAttribute('aria-hidden','true');
 probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;padding:0;padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px)';body.appendChild(probe);
 function update(){
  const size=gameViewport();root.dataset.gameRotation=size.rotated?'90':'0';
  for(const [key,value]of Object.entries({width:size.width,height:size.height,vw:size.width/100,vh:size.height/100,vmin:size.height/100,vmax:size.width/100}))root.style.setProperty('--game-'+key,value+'px');
  const computed=getComputedStyle(probe),host=getComputedStyle(root),insets={top:0,right:0,bottom:0,left:0};
  for(const edge of ['top','right','bottom','left'] as const){
   const raw=parseFloat(root.style.getPropertyValue('--safe-'+edge));
   const fallback=parseFloat(host.getPropertyValue('--safe-area-inset-'+edge))||parseFloat(computed.getPropertyValue('padding-'+edge))||0;
   insets[edge]=Number.isFinite(raw)?raw:Math.max(12,fallback);
  }
  const mapped=landscapeInsets(insets,size.rotated);
  for(const edge of ['top','right','bottom','left'] as const){body.style.setProperty('--safe-'+edge,mapped[edge]+'px');body.style.setProperty('--safe-area-inset-'+edge,mapped[edge]+'px');}
  body.style.setProperty('--safe',mapped.bottom+'px');
 }
 update();window.addEventListener('resize',update);window.addEventListener('orientationchange',update);document.addEventListener('minitool-window-info',update);
}
