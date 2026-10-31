/** Documented XHS bridge only. Gameplay reads a synchronous cache hydrated before boot. */
export interface NativeRect { left:number; top:number; right:number; bottom:number; width:number; height:number }
export interface NativeWindowInfo { windowWidth:number; windowHeight:number; safeArea?:NativeRect; menuButtons?:{back:NativeRect|null;me:NativeRect|null;share:NativeRect|null}; pixelRatio?:number }
export interface NativeFrame { x:number;y:number;z:number }
export interface MiniTool {
 getLaunchOptions?:()=>Promise<{miniToolEnv?:{buildVersion?:number|string}}>;
 getStorage?:(options:{key:string})=>Promise<{data:string|null}>;
 setStorage?:(options:{key:string;data:string})=>Promise<unknown>;
 removeStorage?:(options:{key:string})=>Promise<unknown>;
 getWindowInfo?:()=>Promise<NativeWindowInfo>;
 interactionOpenApi?:(options:{payload:{action:'post_comment';content?:string};saveToAlbum:boolean})=>Promise<{routed:boolean}>;
 startGyroscope?:(options:{interval:'ui'|'normal'})=>Promise<unknown>;
 stopGyroscope?:()=>Promise<unknown>;
 onGyroscopeChange?:(callback:(frame:NativeFrame)=>void)=>void;
 offGyroscopeChange?:(callback:(frame:NativeFrame)=>void)=>void;
}
export interface ContainerHost { miniTool?:MiniTool; launchOptions?:{miniToolEnv?:{buildVersion?:number|string}} }
export const miniTool=():MiniTool|undefined=>(window as Window & {xhs?:ContainerHost}).xhs?.miniTool;
let version=0;
export const clientVersion=():number=>version;
export const parseClientVersion=(build:unknown):number=>Math.floor((Number(build)||0)/1000);
const errorText=(error:unknown)=>error && typeof error==='object' && 'errMsg' in error?String((error as {errMsg:unknown}).errMsg):error instanceof Error?error.message:String(error);

export class PlatformStorage {
 private cache=new Map<string,string>();
 private writes:Promise<void>=Promise.resolve();
 private native:MiniTool|undefined;
 private ready=false;
 backend:'native'|'browser'|'memory'='memory';
 errors:string[]=[];
 constructor(private host:()=>ContainerHost|undefined,private fallback:()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>|undefined,private notify?:(message:string)=>void){}
 private issue(error:unknown):void{const message=errorText(error);this.errors.push(message);if(this.errors.length>8)this.errors.shift();this.notify?.(message);}
 async bootstrap(keys:string[]):Promise<number>{
  const host=this.host();let build=host?.launchOptions?.miniToolEnv?.buildVersion;
  if(!Number(build)&&host?.miniTool?.getLaunchOptions){try{build=(await host.miniTool.getLaunchOptions()).miniToolEnv?.buildVersion;}catch(error){this.issue(error);}}
  const client=parseClientVersion(build),native=host?.miniTool;
  this.native=client>=9460&&native?.getStorage&&native.setStorage?native:undefined;
  this.backend=this.native?'native':'browser';
  await Promise.all(keys.map(async key=>{
   if(this.native){
    try{const result=await this.native.getStorage!({key});
     if(result.data!==null&&result.data!==undefined){const value=JSON.parse(result.data);this.cache.set(key,typeof value==='string'?value:JSON.stringify(value));return;}
     // A missing native value may migrate from the older local fallback once.
     const previous=this.fallback()?.getItem(key);if(previous!==null&&previous!==undefined){this.cache.set(key,previous);this.enqueue(()=>this.native!.setStorage!({key,data:JSON.stringify(previous)}));}
    }catch(error){this.issue(error);}
   }else{try{const store=this.fallback();if(!store){this.backend='memory';return;}const value=store.getItem(key);if(value!==null)this.cache.set(key,value);}catch(error){this.backend='memory';this.issue(error);}}
  }));
  this.ready=true;return client;
 }
 getItem(key:string):string|null{return this.cache.get(key)??null;}
 setItem(key:string,value:string):void{
  this.cache.set(key,String(value));
  if(this.native)this.enqueue(()=>this.native!.setStorage!({key,data:JSON.stringify(String(value))}));
  else if(this.backend==='browser')try{this.fallback()?.setItem(key,String(value));}catch(error){this.backend='memory';this.issue(error);}
 }
 removeItem(key:string):void{
  this.cache.delete(key);
  if(this.native?.removeStorage)this.enqueue(()=>this.native!.removeStorage!({key}));
  else if(this.backend==='browser')try{this.fallback()?.removeItem(key);}catch(error){this.issue(error);}
 }
 private enqueue(work:()=>Promise<unknown>):void{this.writes=this.writes.then(async()=>{try{await work();}catch(error){this.issue(error);}});}
 flush():Promise<void>{return this.writes;}
 status(){return {ready:this.ready,backend:this.backend,errors:this.errors.slice()};}
}
export const storage=new PlatformStorage(
 ()=>(window as Window & {xhs?:ContainerHost}).xhs,
 ()=>{try{return window.localStorage;}catch{return undefined;}},
 ()=>{if(typeof document!=='undefined')document.dispatchEvent(new CustomEvent('sandline-storage-status',{detail:'本次设置仅在当前会话生效，离开后可能无法保存。'}));}
);
export const flushStorage=()=>storage.flush();
export const platformStatus=()=>({version,...storage.status()});
export function supportsFlexGap():boolean{
 const node=document.createElement('div');node.style.cssText='position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;top:-9999px';
 node.appendChild(document.createElement('div'));node.appendChild(document.createElement('div'));document.body.appendChild(node);
 const supported=node.scrollHeight===1;node.parentNode!.removeChild(node);return supported;
}
export function windowInsets(info:NativeWindowInfo,viewportWidth:number){
 const scale=info.windowWidth>0?viewportWidth/info.windowWidth:1,safe=info.safeArea;
 let top=Math.max(0,safe?.top??0);
 if(info.menuButtons)for(const name of ['back','me','share'] as const){const rect=info.menuButtons[name];if(rect&&Number.isFinite(rect.bottom))top=Math.max(top,rect.bottom+8);}
 return {top:Math.max(14,top*scale),left:Math.max(14,(safe?.left??0)*scale),right:Math.max(14,(info.windowWidth-(safe?.right??info.windowWidth))*scale),bottom:Math.max(12,(info.windowHeight-(safe?.bottom??info.windowHeight))*scale)};
}
let windowUpdate=0;
export async function updateWindowInfo():Promise<void>{
 const ticket=++windowUpdate,root=document.documentElement;
 root.style.setProperty('--app-height',`${window.innerHeight}px`);
 const api=miniTool();if(version<9490||!api?.getWindowInfo)return;
 try{const info=await api.getWindowInfo();if(ticket!==windowUpdate||!info||!Number.isFinite(info.windowWidth)||!Number.isFinite(info.windowHeight))return;
  const insets=windowInsets(info,window.innerWidth);for(const key of ['top','right','bottom','left'] as const)root.style.setProperty(`--safe-${key}`,`${insets[key]}px`);
  root.classList.add('native-window-info');document.dispatchEvent(new Event('minitool-window-info'));
 }catch{root.classList.remove('native-window-info');for(const key of ['top','right','bottom','left'])root.style.removeProperty(`--safe-${key}`);}
}
export async function bootstrapPlatform(keys=['sandline-settings-v1','sandline-stats-v1','sandline-bots-v1','sandline-mode-v1']):Promise<void>{
 version=await storage.bootstrap(keys);
 document.documentElement.classList.toggle('supports-flex-gap',supportsFlexGap());
 await updateWindowInfo();window.addEventListener('resize',()=>{void updateWindowInfo();});
 window.addEventListener('orientationchange',()=>{void updateWindowInfo();});
}
