/* ============================================================================
 * PokéBonk 离线版 —— 网络守卫（内网安全关键）
 *
 * 目标：**零外联、零上传**。
 *
 * 拦截层：
 *   1. fetch            —— 非本源一律拒绝
 *   2. XMLHttpRequest   —— 同上
 *   3. navigator.sendBeacon —— 直接吞掉（这是最典型的上传 API）
 *   4. WebSocket / EventSource —— 非本源拒绝
 *   5. 动态 <script>/<link>/<iframe> 注入 —— 非本源直接移除
 *   6. <img> 外链 —— 非本源改成透明占位（防像素追踪）
 *
 * 所有被拦截的尝试都会：
 *   - 记录到 window.PB_NETLOG
 *   - console.warn 输出
 *   - 在角落显示计数（可点开看详情）
 *
 * 这一段必须在所有其他脚本之前加载。
 * ==========================================================================*/
(function (global) {
  'use strict';

  const ORIGIN = global.location.origin;
  const LOG = [];
  const MAX_LOG = 200;

  function isSameOrigin(u) {
    if (!u) return true;
    const s = String(u);
    if (s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('about:')) return true;
    if (s.startsWith('#')) return true;
    try {
      const url = new URL(s, global.location.href);
      return url.origin === ORIGIN;
    } catch (e) {
      // 相对路径解析失败的一律放行（极少见）
      return true;
    }
  }

  function note(kind, url, extra) {
    const entry = { t: Date.now(), kind, url: String(url).slice(0, 300), extra: extra || '' };
    LOG.push(entry);
    if (LOG.length > MAX_LOG) LOG.shift();
    try {
      console.warn('[pb-net] 已拦截 ' + kind + ' → ' + entry.url);
    } catch (e) {}
    updateBadge();
    return entry;
  }

  /* ---------------- 1. fetch ---------------- */
  const realFetch = global.fetch;
  if (realFetch) {
    global.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!isSameOrigin(url)) {
        note('fetch', url, (init && init.method) || 'GET');
        // 返回一个"看起来像网络失败"的响应，让游戏走离线分支
        return Promise.reject(new TypeError('Failed to fetch (blocked by pb-net)'));
      }
      return realFetch.apply(this, arguments);
    };
  }

  /* ---------------- 2. XMLHttpRequest ---------------- */
  const RealXHR = global.XMLHttpRequest;
  if (RealXHR) {
    const origOpen = RealXHR.prototype.open;
    RealXHR.prototype.open = function (method, url) {
      if (!isSameOrigin(url)) {
        note('xhr', url, method);
        this.__pbBlocked = true;
        return;
      }
      this.__pbBlocked = false;
      return origOpen.apply(this, arguments);
    };
    const origSend = RealXHR.prototype.send;
    RealXHR.prototype.send = function () {
      if (this.__pbBlocked) {
        const self = this;
        setTimeout(function () {
          try {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: 0, configurable: true });
            if (self.onerror) self.onerror(new Event('error'));
            if (self.onreadystatechange) self.onreadystatechange();
          } catch (e) {}
        }, 0);
        return;
      }
      return origSend.apply(this, arguments);
    };
  }

  /* ---------------- 3. sendBeacon（最重要的上传 API） ---------------- */
  if (global.navigator && global.navigator.sendBeacon) {
    const realBeacon = global.navigator.sendBeacon.bind(global.navigator);
    global.navigator.sendBeacon = function (url, data) {
      if (!isSameOrigin(url)) {
        note('sendBeacon', url, data ? (data.size || data.byteLength || 'payload') : '');
        return true; // 假装成功，避免调用方重试
      }
      return realBeacon(url, data);
    };
  }

  /* ---------------- 4. WebSocket / EventSource ---------------- */
  const RealWS = global.WebSocket;
  if (RealWS) {
    global.WebSocket = function (url, protocols) {
      if (!isSameOrigin(url)) {
        note('websocket', url);
        throw new DOMException('blocked by pb-net', 'SecurityError');
      }
      return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
    };
    global.WebSocket.prototype = RealWS.prototype;
    global.WebSocket.CONNECTING = RealWS.CONNECTING;
    global.WebSocket.OPEN = RealWS.OPEN;
    global.WebSocket.CLOSING = RealWS.CLOSING;
    global.WebSocket.CLOSED = RealWS.CLOSED;
  }
  const RealES = global.EventSource;
  if (RealES) {
    global.EventSource = function (url, cfg) {
      if (!isSameOrigin(url)) {
        note('eventsource', url);
        throw new DOMException('blocked by pb-net', 'SecurityError');
      }
      return new RealES(url, cfg);
    };
    global.EventSource.prototype = RealES.prototype;
  }

  /* ---------------- 5/6. DOM 注入监控 ---------------- */
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function sanitize(el) {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName;
    if (tag === 'LINK') {
      // rel="alternate" / "canonical" / "dns-prefetch" 之类不会发请求，不用管
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      if (rel === 'alternate' || rel === 'canonical' || rel === 'dns-prefetch' ||
          rel === 'preconnect' || rel === 'author' || rel === 'license' || rel === 'me') return;
    }
    if (tag === 'SCRIPT' || tag === 'LINK' || tag === 'IFRAME') {
      const u = el.getAttribute('src') || el.getAttribute('href');
      if (u && !isSameOrigin(u)) {
        note(tag.toLowerCase(), u);
        try { el.remove(); } catch (e) {}
        return;
      }
    }
    if (tag === 'IMG') {
      const u = el.getAttribute('src');
      if (u && !isSameOrigin(u)) {
        note('img', u);
        try { el.setAttribute('src', TRANSPARENT); } catch (e) {}
      }
    }
  }

  function scanNode(node) {
    if (!node) return;
    if (node.nodeType === 1) {
      sanitize(node);
      if (node.querySelectorAll) {
        node.querySelectorAll('script[src],link[href],iframe[src],img[src]').forEach(sanitize);
      }
    }
  }

  if (global.MutationObserver) {
    const mo = new MutationObserver(function (records) {
      for (const r of records) {
        for (const n of r.addedNodes) scanNode(n);
      }
    });
    const start = function () {
      mo.observe(document.documentElement, { childList: true, subtree: true });
      // 已存在的也扫一遍
      scanNode(document.documentElement);
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  /* ---------------- 角标 ---------------- */
  let badge = null;
  function updateBadge() {
    try {
      if (!document.body) return;
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'pb-net-badge';
        badge.style.cssText =
          'position:fixed;left:8px;bottom:8px;z-index:2147483644;' +
          'padding:3px 9px;border-radius:9px;cursor:pointer;' +
          'background:rgba(20,16,42,.85);border:1px solid rgba(95,224,138,.5);' +
          'color:#5fe08a;font:600 10.5px system-ui;user-select:none';
        badge.title = '点击查看详情';
        badge.onclick = function () {
          const lines = LOG.slice(-40).map(function (x) {
            return new Date(x.t).toLocaleTimeString() + '  ' + x.kind + '  ' + x.url + (x.extra ? '  [' + x.extra + ']' : '');
          });
          alert('被拦截的外联尝试（最近 40 条）：\n\n' + (lines.length ? lines.join('\n') : '无'));
        };
        document.body.appendChild(badge);
      }
      const n = LOG.length;
      badge.textContent = n === 0 ? '🛡 无外联' : '🛡 已拦截 ' + n;
      badge.style.color = n === 0 ? '#5fe08a' : '#ffcb6b';
      badge.style.borderColor = n === 0 ? 'rgba(95,224,138,.5)' : 'rgba(255,203,107,.5)';
    } catch (e) {}
  }

  /* ---------------- 导出 ---------------- */
  global.PB_NET = {
    log: LOG,
    count: function () { return LOG.length; },
    dump: function () { return LOG.slice(); },
    clear: function () { LOG.length = 0; updateBadge(); },
    isSameOrigin: isSameOrigin,
    ORIGIN: ORIGIN,
  };

  // 首次渲染角标
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateBadge, { once: true });
  } else {
    updateBadge();
  }
})(typeof window !== 'undefined' ? window : globalThis);
