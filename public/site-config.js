// Public settings only. Never put passwords or API secrets here.
// After editing, rebuild so the offline cache version is updated.
window.SANDLINE_CONFIG = {
  analytics: {
    provider: 'none',
    baiduSiteId: '', // 32-character site ID from hm.baidu.com/hm.js?...
    plausibleDomain: '',
    plausibleEndpoint: 'https://plausible.io/api/event',
    debug: false // true logs events locally and disables external reporting
  },
  feedbackWechatQr: '', // e.g. './feedback-wechat.png'; supply the actual WeChat contact QR image
  shareUrl: '' // optional canonical public URL; default strips query/hash
};
