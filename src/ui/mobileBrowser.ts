type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void | Promise<void> };

export function fullscreenAdvice(userAgent: string): string {
  if (/MicroMessenger/i.test(userAgent)) return '微信内置浏览器限制网页全屏。请点右上角「…」，选择在浏览器中打开，再尝试全屏。';
  if (/iPhone|iPod/i.test(userAgent)) return '当前 iPhone 浏览器不支持网页全屏。可在 Safari 分享菜单中选择「添加到主屏幕」，再从主屏幕打开；横屏可获得更大视野。';
  return '当前浏览器未允许全屏。请使用最新版 Chrome 或 Safari，横屏后重试。';
}

/** Call synchronously from a click, before any await consumes user activation. */
export async function toggleFullscreen(doc: Document = document, ua = navigator.userAgent): Promise<string | null> {
  const d = doc as FullscreenDocument, root = d.documentElement as FullscreenRoot;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      return null;
    }
    if (root.requestFullscreen && d.fullscreenEnabled !== false) await root.requestFullscreen();
    else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    else return fullscreenAdvice(ua);
    return null;
  } catch { return fullscreenAdvice(ua); }
}

export function setupMobileBrowser() {
  const dialog = document.createElement('dialog'); dialog.className = 'community-dialog';
  dialog.setAttribute('aria-labelledby', 'fullscreen-title');
  dialog.innerHTML = '<div class="community-heading"><h2 id="fullscreen-title">全屏提示</h2><button aria-label="关闭全屏提示">关闭</button></div><p id="fullscreen-advice"></p>';
  document.body.append(dialog);
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  document.addEventListener('sandline-fullscreen-help', event => {
    dialog.querySelector('p')!.textContent = (event as CustomEvent<string>).detail;
    if (!dialog.open) dialog.showModal();
  });
  // CSS handles normal taps without delaying or swallowing button clicks.
  // Safari gesture events additionally guard gameplay pinch gestures, while QR
  // images and scrollable dialogs keep their native long-press/scroll behavior.
  document.addEventListener('dblclick', event => {
    const target = event.target as HTMLElement;
    if (target.closest('#game-ui, #game-canvas, .loading-shell') && !target.closest('input,select,textarea')) event.preventDefault();
  }, { passive: false });
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => {
    if ((event.target as HTMLElement).closest('#game-ui, #game-canvas')) event.preventDefault();
  }, { passive: false });
}

export function requestGameFullscreen() {
  void toggleFullscreen().then(message => {
    if (message) document.dispatchEvent(new CustomEvent('sandline-fullscreen-help', { detail: message }));
  });
}
