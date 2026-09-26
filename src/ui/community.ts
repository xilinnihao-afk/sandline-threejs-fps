import { siteConfig, telemetry } from '../analytics/telemetry';

export const controls = `<div class="welcome-controls"><article><h3>手机 · 建议横屏</h3><p>左下摇杆移动，右侧空白处滑动瞄准。按住开火按钮射击，也可边拖动边瞄准；「精瞄」降低瞄准速度。</p><p>换弹、切枪、手雷、蹲伏使用屏幕按钮；靠近目标后按住「目标」安放或拆除炸弹。</p></article><article><h3>电脑 · 键鼠操作</h3><p>WASD / 方向键移动，鼠标瞄准，左键开火。R 换弹，1 / 2 切枪，G 手雷，C 蹲伏，按住 E 安放 / 拆除，Esc 暂停。</p></article></div>`;
function safeURL(value: string | undefined) { try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function shareURL() { return safeURL(siteConfig.shareUrl) || location.origin + location.pathname; }
async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.append(area); area.select();
    try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
  }
}
export function setupCommunity() {
  const dialog = document.createElement('dialog'); dialog.className = 'community-dialog'; dialog.setAttribute('aria-labelledby', 'community-title');
  dialog.innerHTML = `<div class="community-heading"><h2 id="community-title"></h2><button type="button" id="community-close" aria-label="关闭弹窗">关闭</button></div><div id="community-content"></div>`;
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('#community-content')!;
  dialog.querySelector('#community-close')!.addEventListener('click', () => dialog.close());
  // Keep game keyboard shortcuts out of feedback fields; native dialog handles focus trapping.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('keyup', event => event.stopPropagation());
  const show = (title: string) => { dialog.querySelector('#community-title')!.textContent = title; if (!dialog.open) dialog.showModal(); };
  document.addEventListener('click', async event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-community]')?.dataset.community;
    if (!action) return;
    if (action === 'help') { telemetry.event('help_open'); content.innerHTML = controls; show('操作说明'); }
    if (action === 'share') {
      telemetry.event('share_open');
      const url = shareURL();
      const inWechat = /MicroMessenger/i.test(navigator.userAgent);
      content.innerHTML = `<p>把沙线行动分享给微信好友，或发布到朋友圈。</p><div class="community-actions wechat-share-actions"><button data-wechat-share="friend">微信好友</button><button data-wechat-share="timeline">朋友圈</button></div><p id="wechat-share-guide" role="status">请选择分享方式。</p><div id="wechat-share-link" hidden><label>游戏链接<input id="share-link" readonly></label><button id="wechat-copy">复制游戏链接</button><p id="wechat-copy-status" role="status"></p></div>`;
      (content.querySelector('#share-link') as HTMLInputElement).value = url;
      for (const button of content.querySelectorAll<HTMLButtonElement>('[data-wechat-share]')) {
        button.addEventListener('click', () => {
          const channel = button.dataset.wechatShare!;
          telemetry.event('share_channel', { channel });
          for (const option of content.querySelectorAll('[data-wechat-share]')) option.setAttribute('aria-pressed', String(option === button));
          content.querySelector('#wechat-share-guide')!.textContent = inWechat
            ? channel === 'friend'
              ? '点击微信右上角「…」，选择「发送给朋友」，再选择好友发送。'
              : '点击微信右上角「…」，选择「分享到朋友圈」，编辑后发布。'
            : channel === 'friend'
              ? '复制下方游戏链接，打开微信，粘贴到好友聊天中发送。'
              : '复制下方游戏链接，先在微信聊天中打开，再点右上角「…」→「分享到朋友圈」。';
          (content.querySelector('#wechat-share-link') as HTMLElement).hidden = false;
        });
      }
      content.querySelector('#wechat-copy')!.addEventListener('click', async () => {
        const copied = await copy(url);
        content.querySelector('#wechat-copy-status')!.textContent = copied ? '链接已复制，请到微信继续分享。' : '自动复制不可用，请长按或选中上方链接复制。';
        if (copied) telemetry.event('share_link_copy');
      });
      show('分享到微信');
    }
    if (action === 'feedback') {
      telemetry.event('feedback_open');
      content.innerHTML = `<p>遇到加载失败、卡顿或操作问题？添加反馈微信，直接告诉我们。</p><div class="wechat-feedback"><img id="feedback-qr" alt="沙线行动问题反馈微信二维码" hidden><p id="feedback-qr-status" role="status"></p></div><p class="community-note">反馈时请附上问题截图、手机型号和复现步骤，方便我们排查。</p>`;
      const qr = content.querySelector<HTMLImageElement>('#feedback-qr')!;
      const status = content.querySelector<HTMLElement>('#feedback-qr-status')!;
      let qrUrl = '';
      try {
        const value = siteConfig.feedbackWechatQr?.trim();
        if (value) { const parsed = new URL(value, document.baseURI); if (['https:', 'http:'].includes(parsed.protocol)) qrUrl = parsed.href; }
      } catch { /* invalid config uses the honest unavailable state */ }
      if (qrUrl) {
        status.textContent = '正在加载微信二维码…';
        qr.addEventListener('load', () => { qr.hidden = false; status.textContent = /MicroMessenger/i.test(navigator.userAgent) ? '长按二维码，选择「识别图中二维码」添加微信。' : '使用微信扫一扫添加；同一部手机可保存图片后，在微信扫一扫中从相册识别。'; });
        qr.addEventListener('error', () => { qr.hidden = true; status.textContent = '二维码暂时无法加载，请检查网络后重新打开。'; telemetry.event('feedback_qr_error'); });
        qr.src = qrUrl;
      } else status.textContent = '反馈微信二维码即将上线，请稍后再来。';
      show('微信反馈');
    }
  });
}
