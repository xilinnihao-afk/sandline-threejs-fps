/** Use native Touch Events on touch WebViews, including those without usable
 * Pointer Events/capture. Mouse and pen retain the Pointer Events path.
 * Call handlers directly: never manufacture DOM clicks or audio gestures. */
export function bindGameplayPointer(
 target:EventTarget|null|undefined,type:string,handler:(event:PointerEvent)=>void,
 options?:AddEventListenerOptions|boolean,
):void{
 if(!target)return;
 const nativeTouch='ontouchstart' in window||typeof window.TouchEvent==='function';
 target.addEventListener(type,((event:PointerEvent)=>{
  if(nativeTouch&&event.pointerType==='touch')return;
  handler(event);
 }) as EventListener,options);
 const touchType=({pointerdown:'touchstart',pointermove:'touchmove',pointerup:'touchend',pointercancel:'touchcancel'} as Record<string,string>)[type];
 if(!touchType||!nativeTouch)return;
 target.addEventListener(touchType,((event:TouchEvent)=>{
  for(let i=0;i<event.changedTouches.length;i++){
   const touch=event.changedTouches[i];
   handler({type,pointerId:-touch.identifier-1,pointerType:'touch',button:0,
    clientX:touch.clientX,clientY:touch.clientY,target:touch.target,
    preventDefault:()=>{if(event.cancelable)event.preventDefault();},
    stopPropagation:()=>event.stopPropagation(),
   } as unknown as PointerEvent);
  }
 }) as EventListener,{passive:false,capture:typeof options==='boolean'?options:options?.capture});
}
