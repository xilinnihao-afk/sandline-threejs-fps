import {clientVersion,miniTool,platformStatus} from './platform';
export const controls=`<div class="welcome-controls"><article><h3>触屏操作</h3><p>左侧摇杆移动，右侧空白处滑动瞄准。按住开火按钮射击，也可边拖动边瞄准；「精瞄」降低瞄准速度。</p><p>换弹、切枪、手雷、蹲伏使用屏幕按钮；靠近目标后按住「目标」安放或拆除炸弹。竖屏与横屏均可游玩。</p></article><article><h3>作战与补给</h3><p>Bloodstrike 悬赏战：击杀敌人赚取金钱，打开商店购买武器，消灭全部敌人获胜。AWP 弹匣 10 发，沙鹰弹匣 8 发。</p><p>电脑可用 WASD 移动、鼠标按住拖动瞄准，R 换弹，数字 1–8 切枪，G 手雷、C 蹲伏、空格跳跃、Esc 暂停。</p></article></div>`;
const credits=`<p>沙线行动 · 小红书离线版</p><p>Three.js — MIT License。地图、角色与武器经本地转换及移动端精简，来源与许可见本工具内附素材说明。</p><p>沙漠之鹰 .50AE：drcrazzie，CC BY 4.0，原始作品来自 Sketchfab（作品编号 6df0ae09a0034540975c804a28df7037）。模型已进行缩放、纹理和网格优化。</p>`;
export function setupCommunity():void{
 const overlay=document.createElement('div');overlay.className='xhs-modal-overlay';overlay.hidden=true;
 overlay.innerHTML='<section class="community-dialog xhs-community-panel" role="dialog" aria-modal="true" aria-labelledby="community-title"><div class="community-heading"><h2 id="community-title"></h2><button type="button" id="community-close" aria-label="关闭弹窗">关闭</button></div><div id="community-content"></div></section>';
 document.body.appendChild(overlay);const panel=overlay.querySelector<HTMLElement>('.community-dialog')!,content=panel.querySelector<HTMLElement>('#community-content')!,close=panel.querySelector<HTMLButtonElement>('#community-close')!;let previous:HTMLElement|null=null;
 const hide=()=>{overlay.hidden=true;previous?.focus();};close.addEventListener('click',hide);
 overlay.addEventListener('click',event=>{event.stopPropagation();if(event.target===overlay)hide();});
 overlay.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();hide();}if(event.key==='Tab'){const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),textarea,input,[tabindex="0"]'));const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});overlay.addEventListener('keyup',event=>event.stopPropagation());
 const show=(title:string)=>{previous=document.activeElement instanceof HTMLElement?document.activeElement:null;panel.querySelector('#community-title')!.textContent=title;overlay.hidden=false;close.focus();};
 const draft=(feedback:boolean)=>{
  content.innerHTML=`<p>${feedback?'在小红书评论区反馈问题。可附上出现问题的地图、手机型号和操作步骤。':'可通过小红书顶部分享按钮分享小工具，或在评论区交流战绩。'}</p><label class="xhs-feedback-label">${feedback?'问题描述':'想说的话'}<textarea id="xhs-comment-draft" rows="4" maxlength="900" placeholder="写下你的反馈或战绩"></textarea></label><p id="xhs-comment-status" role="status"></p><button id="xhs-open-comment" type="button">前往评论区</button><small class="xhs-community-note">打开评论区会退出本次游戏。内容将作为草稿，由你确认发送。</small>`;
  const button=content.querySelector<HTMLButtonElement>('#xhs-open-comment')!,status=content.querySelector<HTMLElement>('#xhs-comment-status')!;
  if(clientVersion()<9490||typeof miniTool()?.interactionOpenApi!=='function'){button.disabled=true;status.textContent='当前环境不支持打开评论区，请退出工具后在原笔记下反馈。';}
  button.addEventListener('click',async()=>{const api=miniTool();if(!api?.interactionOpenApi)return;button.disabled=true;status.textContent='正在打开评论区…';try{const text=(content.querySelector<HTMLTextAreaElement>('#xhs-comment-draft')!.value||'沙线行动游戏反馈').slice(0,900);const result=await api.interactionOpenApi({payload:{action:'post_comment',content:text},saveToAlbum:false});status.textContent=result.routed?'评论草稿已准备，请在评论区确认。':'评论区暂未打开，请稍后重试。';}catch{status.textContent='评论区暂未打开，草稿仍保留在这里。';}finally{button.disabled=false;}});
 };
 document.addEventListener('click',event=>{const target=event.target as HTMLElement;const action=target.closest<HTMLElement>('[data-community]')?.dataset.community;if(!action)return;
  if(action==='help'){content.innerHTML=controls;show('操作说明');}
  else if(action==='feedback'||action==='share'){draft(action==='feedback');show(action==='feedback'?'问题反馈':'分享游戏');}
  else if(action==='credits'){content.innerHTML=credits;const extra=document.getElementById('xhs-asset-credits');if(extra)content.innerHTML+=extra.innerHTML;show('素材来源');}
  else if(action==='audio-credits'){content.innerHTML='<p>本版本采用离线合成声音：七类枪械、机械换弹、四种脚步、材质命中、刀具与爆炸音效，另有轻量菜单音乐和战场风声。配音仍以界面提示与提示音呈现。</p>';show('音效说明');}
 });
 document.addEventListener('sandline-storage-status',()=>{const existing=document.getElementById('xhs-save-note');if(existing)return;const note=document.createElement('p');note.id='xhs-save-note';note.className='xhs-save-note';note.textContent='设置暂未保存，退出后可能恢复默认。';note.setAttribute('role','status');document.body.appendChild(note);setTimeout(()=>note.remove(),6500);});
 if(platformStatus().errors.length)document.dispatchEvent(new CustomEvent('sandline-storage-status'));
}
