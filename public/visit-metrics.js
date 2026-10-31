/* First-party page visits only. No game state, URL parameters, or fingerprinting. */
(function () {
  'use strict';
  try {
    var script = document.currentScript;
    var site = script && script.dataset.site;
    if (!['sandline', 'midway', 'tidewater', 'dota', 'redalert'].includes(site) || window.__IHCA_METRICS_V1__) return;
    if (!['ihca.cn', '39.105.40.112'].includes(location.hostname) || !/^https?:$/.test(location.protocol)) return;
    var query = new URLSearchParams(location.search);
    if (['debug', 'qa', 'preview', 'capture', 'noanalytics'].some(function (name) { return query.has(name); })) return;
    window.__IHCA_METRICS_V1__ = true;
    var endpoint = '/metrics/collect';
    var valid = /^[a-f0-9]{32}$/;
    function id() {
      var values = new Uint8Array(16);
      crypto.getRandomValues(values);
      return Array.from(values, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    }
    var visitor;
    // Local storage is shared by same-origin games, enabling real union UV.
    for (var storageName of ['localStorage', 'sessionStorage']) {
      try {
        var storage = window[storageName];
        visitor = storage.getItem('ihca.metrics.visitor.v1');
        if (!valid.test(visitor || '')) { visitor = id(); storage.setItem('ihca.metrics.visitor.v1', visitor); }
        break;
      } catch (_) { visitor = null; }
    }
    visitor = visitor || id();
    function send(body, attempt) {
      // The same event id is retained on retries: the server counts it only once.
      try {
        fetch(endpoint, { method: 'POST', credentials: 'omit', keepalive: true,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: body
        }).then(function (response) {
          if (response.status === 429 || response.status >= 500) retry();
        }).catch(retry);
      } catch (_) { retry(); }
      function retry() {
        if (attempt < 2) setTimeout(function () { send(body, attempt + 1); }, (attempt + 1) * 2000);
      }
    }
    var viewed = false;
    function visit() {
      if (document.visibilityState === 'hidden' || document.prerendering || viewed) return;
      viewed = true;
      send(JSON.stringify({ site: site, visitor_id: visitor, event_id: id() }), 0);
    }
    visit();
    document.addEventListener('visibilitychange', visit);
    document.addEventListener('prerenderingchange', visit);
    window.addEventListener('pageshow', function (event) {
      if (event.persisted) { viewed = false; visit(); }
    });
  } catch (_) { /* Statistics never prevent the game from loading. */ }
})();
