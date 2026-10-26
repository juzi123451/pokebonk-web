/* ============================================================================
 * PokéBonk 离线版 —— fetch 拦截层
 *
 * 在页面最早执行（<head> 开头），把发往 api.pokebonk.com 的请求
 * 全部转给 PB_OFFLINE_API（localStorage 版后端）。
 *
 * 依赖同目录下的 api-core.js（也在 <head> 里，先加载）。
 * ==========================================================================*/
(function (global) {
  'use strict';

  const API_HOST = 'api.pokebonk.com';
  const api = global.PB_OFFLINE_API;
  if (!api) {
    console.error('[pb-offline] api-core.js 没加载，离线后端不可用');
    return;
  }

  const realFetch = global.fetch ? global.fetch.bind(global) : null;

  // 主包里的 api 域名已被替换成空串，所以请求变成同源相对路径
  const API_PATHS = /^\/(status|version\.json|auth|profile|runs|lab|items|quests|tasks|seasons|events|records|leaderboard|news|players|friends|clans|coop|mail|account|feedback|rooms|signal|ice|invites|chat|me|standing|access|decline|invite|join|kick|leave|start|again|team|bag|shop|skins|medals|treasures|daily|weekly|pokedex|research)(\/|$|\?)/;

  function isApiUrl(u) {
    try {
      const raw = typeof u === 'string' ? u : (u && u.url) || '';
      if (raw.indexOf(API_HOST) >= 0) return true;
      const url = new URL(raw, global.location.href);
      // 只拦同源的
      if (url.origin !== global.location.origin) return false;
      // 静态资源不拦
      if (/\/assets\/|\/data\/|\/icons\/|\.(js|css|json|png|jpg|webp|woff2?|ico|svg|webmanifest)$/i.test(url.pathname)) {
        // 但 /data/ 除外（游戏数据是静态的，API 里没有 /data）
        return false;
      }
      return API_PATHS.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  function parseBody(init) {
    try {
      if (!init || !init.body) return {};
      if (typeof init.body === 'string') return JSON.parse(init.body) || {};
      return {};
    } catch (e) {
      return {};
    }
  }

  function makeResponse(payload, status) {
    let bodyStr = '';
    let code = status || 200;
    if (payload && payload.__status) {
      code = payload.__status;
      bodyStr = '';
    } else if (payload && payload.__json !== undefined) {
      bodyStr = JSON.stringify(payload.__json);
    } else {
      bodyStr = JSON.stringify(payload || {});
    }
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    return new Response(bodyStr, { status: code, headers });
  }

  global.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isApiUrl(url)) {
      return realFetch ? realFetch(input, init) : Promise.reject(new Error('no fetch'));
    }

    let method = 'GET';
    let pathname = '/';
    let search = new URLSearchParams();

    try {
      const u = new URL(url, global.location.href);
      pathname = u.pathname;
      search = u.searchParams;
      method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    } catch (e) {}

    const body = parseBody(init);

    return new Promise((resolve) => {
      try {
        const out = api.handle(method, pathname, search, body);
        // 模拟一点点网络延迟，避免前端逻辑因同步返回而出错
        setTimeout(() => resolve(makeResponse(out)), 16);
      } catch (e) {
        console.error('[pb-offline] handle 异常', method, pathname, e);
        resolve(makeResponse({ ok: false, error: String(e && e.message || e) }, 500));
      }
    });
  };

  // 有些代码用 XMLHttpRequest，也一并拦
  const RealXHR = global.XMLHttpRequest;
  if (RealXHR) {
    const origOpen = RealXHR.prototype.open;
    const origSend = RealXHR.prototype.send;
    RealXHR.prototype.open = function (method, url) {
      this.__pbMethod = String(method || 'GET').toUpperCase();
      this.__pbUrl = String(url || '');
      if (isApiUrl(url)) {
        this.__pbIntercept = true;
        return;
      }
      return origOpen.apply(this, arguments);
    };
    RealXHR.prototype.send = function (bodyStr) {
      if (!this.__pbIntercept) return origSend.apply(this, arguments);
      let parsed = {};
      try { if (bodyStr) parsed = JSON.parse(bodyStr) || {}; } catch (e) {}
      let pathname = '/';
      let search = new URLSearchParams();
      try {
        const u = new URL(this.__pbUrl, global.location.href);
        pathname = u.pathname;
        search = u.searchParams;
      } catch (e) {}
      let out;
      try {
        out = api.handle(this.__pbMethod, pathname, search, parsed);
      } catch (e) {
        out = { __json: { ok: false, error: String(e && e.message || e) } };
      }
      const payload = out && out.__json !== undefined ? out.__json : (out || {});
      const status = out && out.__status ? out.__status : 200;
      const self = this;
      setTimeout(function () {
        try {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', { value: status, configurable: true });
          Object.defineProperty(self, 'responseText', { value: JSON.stringify(payload), configurable: true });
          Object.defineProperty(self, 'response', { value: JSON.stringify(payload), configurable: true });
          if (self.onreadystatechange) self.onreadystatechange();
          if (self.onload) self.onload();
        } catch (e) {}
      }, 16);
      return undefined;
    };
  }

  console.log('[pb-offline] 离线后端已接管 API，存档存在 localStorage');
})(typeof window !== 'undefined' ? window : globalThis);
