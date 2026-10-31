/** Debug build only. Exercise the same native-event adapter as touch devices. */
export function dispatchQAPointer(target:EventTarget,type:string,id:number,x:number,y:number):boolean{
 if('ontouchstart' in window||typeof window.TouchEvent==='function'){
  const names:Record<string,string>={pointerdown:'touchstart',pointermove:'touchmove',pointerup:'touchend',pointercancel:'touchcancel'};
  const event=new Event(names[type],{bubbles:true,cancelable:true});
  Object.defineProperty(event,'changedTouches',{value:[{identifier:id,clientX:x,clientY:y,target}]});
  return target.dispatchEvent(event);
 }
 return target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0}));
}
