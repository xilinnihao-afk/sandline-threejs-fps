import { VisitSession, type Props } from './session';

type SiteConfig = { analytics?: { provider?: 'baidu' | 'plausible' | ''; baiduSiteId?: string; plausibleDomain?: string; plausibleEndpoint?: string; debug?: boolean }; feedbackWechatQr?: string; shareUrl?: string };
declare global { interface Window { SANDLINE_CONFIG?: SiteConfig; _hmt?: unknown[][] } }
export const siteConfig = window.SANDLINE_CONFIG ?? {};
const config = siteConfig.analytics ?? {};
const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const debug = config.debug === true || new URLSearchParams(location.search).has('debug');
const enabled = !local && !debug;
let send: (name: string, props: Props) => void = () => {};
if (enabled && config.provider === 'baidu' && /^[a-f0-9]{32}$/i.test(config.baiduSiteId ?? '')) {
  window._hmt = window._hmt || [];
  const script = document.createElement('script'); script.async = true; script.src = `https://hm.baidu.com/hm.js?${config.baiduSiteId}`; document.head.append(script);
  send = (name, props) => {
    // Bounded labels: no free text, user IDs, URL query strings or bug reports.
    const label = `${props.stage}/${props.phase}${props.kind ? '/' + props.kind : ''}${props.channel ? '/' + props.channel : ''}`;
    if (window._hmt!.length > 300) return; // bound the queue when a blocker prevents script loading
    window._hmt!.push(['_trackEvent', 'sandline', name, label, Number(props.seconds ?? 1)]);
  };
} else if (enabled && config.provider === 'plausible' && config.plausibleDomain) {
  const endpoint = config.plausibleEndpoint || 'https://plausible.io/api/event';
  send = (name, props) => {
    const body = JSON.stringify({ name, domain: config.plausibleDomain, url: location.origin + location.pathname, props });
    if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain' }))) void fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  };
  try { send('pageview', {}); } catch { /* unavailable analytics must not block startup */ }
}
export const telemetry = new VisitSession((name, props) => {
  if (debug) console.info('[sandline:event]', name, JSON.stringify(props));
  // Observability failures must never break loading, input or rendering.
  try { send(name, props); } catch { /* tracking is best effort */ }
});
telemetry.event('visit');
telemetry.visibility(!document.hidden);
document.addEventListener('visibilitychange', () => telemetry.visibility(!document.hidden));
window.addEventListener('pagehide', event => telemetry.leave(event.persisted));
window.addEventListener('pageshow', event => { if (event.persisted) telemetry.visibility(!document.hidden); });
window.setInterval(() => telemetry.flush(), 15000);
