/* Load the shared production widget without affecting local or offline games. */
(function () {
  'use strict';
  try {
    if (!['ihca.cn', '39.105.40.112'].includes(location.hostname)) return;
    var current = document.currentScript, site = current && current.dataset.site;
    if (!['sandline','midway','tidewater','dota','redalert'].includes(site) || window.__IHCA_FEEDBACK_LOADING__) return;
    window.__IHCA_FEEDBACK_LOADING__ = true;
    var script = document.createElement('script');
    script.src = '/metrics/feedback-v1.js'; script.dataset.site = site; script.defer = true;
    document.head.appendChild(script);
  } catch (_) { /* Optional feedback must not prevent the game from loading. */ }
})();
