export function fullscreenAdvice(_userAgent=''):string{return '游戏已适配横屏。若小红书仍为竖屏，请将手机向左横握，让游戏文字朝上；左侧摇杆移动，右侧滑动瞄准。';}
export async function toggleFullscreen(_doc:Document=document,_ua=''):Promise<string|null>{return fullscreenAdvice();}
export function requestGameFullscreen():void{const button=document.querySelector<HTMLButtonElement>('[data-community="help"]');button?.click();}
export function setupMobileBrowser():void{
 document.addEventListener('contextmenu',event=>{const target=event.target as HTMLElement;if(target.closest('#game-ui, #game-canvas'))event.preventDefault();});
 document.addEventListener('dblclick',event=>{const target=event.target as HTMLElement;if(target.closest('#game-ui, #game-canvas')&&!target.closest('input,select,textarea'))event.preventDefault();},{passive:false});
}
