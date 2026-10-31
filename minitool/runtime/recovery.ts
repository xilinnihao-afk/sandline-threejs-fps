let panel: HTMLElement | null = null;
export function showRecovery(message: string): void {
  if (!panel) {
    panel = document.createElement('section'); panel.className = 'minitool-recovery'; panel.setAttribute('role', 'alert');
    const heading = document.createElement('h1'); heading.textContent = '暂时无法显示战场';
    const detail = document.createElement('p'); detail.className = 'recovery-detail';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新进入';
    retry.addEventListener('click', () => location.reload());
    panel.appendChild(heading); panel.appendChild(detail); panel.appendChild(retry); document.body.appendChild(panel);
  }
  panel.querySelector('.recovery-detail')!.textContent = message; panel.hidden = false;
}
