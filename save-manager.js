/* ============================================================================
 * PokéBonk 离线版 —— 存档管理（导出 / 导入 / 自动备份提醒）
 *
 * 挂到 window.PB_SAVE：
 *   exportToClipboard()  复制存档串到剪贴板
 *   exportToFile()       下载 .json 文件
 *   importFromText(s)    从字符串导入
 *   importFromFile()     选文件导入
 *   autoBackup()         生成本地自动备份（另存一份）
 *   listBackups()        列出自动备份
 * ==========================================================================*/
(function (global) {
  'use strict';

  const api = global.PB_OFFLINE_API;
  const KEY = 'pb.offline.profile';
  const BACKUP_PREFIX = 'pb.offline.backup.';
  const MAX_BACKUPS = 5;
  const LAST_WARN_KEY = 'pb.offline.lastwarn';

  function read() {
    try { return global.localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function write(s) {
    global.localStorage.setItem(KEY, s);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function summary() {
    try {
      const o = JSON.parse(read() || '{}');
      const p = o.profile || o;
      return {
        name: p.name || '?',
        starter: p.starter || 0,
        stardust: p.stardust || 0,
        bonk: p.bonk || 0,
        league: Array.isArray(p.league) ? p.league.length : (p.league || 0),
        captured: (p.captured || []).length,
        runs: (p.runs || []).length,
        savedAt: o.savedAt || null,
      };
    } catch (e) { return null; }
  }

  /* ---------------- 自动备份（保留最近 5 份） ---------------- */
  function autoBackup() {
    const s = read();
    if (!s) return null;
    try {
      const id = BACKUP_PREFIX + stamp();
      global.localStorage.setItem(id, s);
      // 清理旧的
      const keys = [];
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && k.indexOf(BACKUP_PREFIX) === 0) keys.push(k);
      }
      keys.sort();
      while (keys.length > MAX_BACKUPS) {
        const old = keys.shift();
        global.localStorage.removeItem(old);
      }
      return id;
    } catch (e) {
      return null;
    }
  }

  function listBackups() {
    const out = [];
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && k.indexOf(BACKUP_PREFIX) === 0) {
          let sum = null;
          try {
            const o = JSON.parse(global.localStorage.getItem(k));
            const p = o.profile || o;
            sum = { name: p.name, stardust: p.stardust, league: Array.isArray(p.league) ? p.league.length : p.league };
          } catch (e) {}
          out.push({ id: k, time: k.slice(BACKUP_PREFIX.length), summary: sum });
        }
      }
    } catch (e) {}
    return out.sort((a, b) => (a.time < b.time ? 1 : -1));
  }

  function restoreBackup(id) {
    const s = global.localStorage.getItem(id);
    if (!s) return '找不到备份';
    write(s);
    location.reload();
    return 'ok';
  }

  /* ---------------- 导出 ---------------- */
  function exportString() {
    const s = read();
    if (!s) return null;
    // 加一层校验，防止导入时拿到残缺数据
    const o = JSON.parse(s);
    o.__exported = new Date().toISOString();
    o.__version = (api && api.VERSION) || '0.8.58';
    return JSON.stringify(o);
  }

  async function exportToClipboard() {
    const s = exportString();
    if (!s) return 'no data';
    try {
      await navigator.clipboard.writeText(s);
      return 'ok';
    } catch (e) {
      // 退路：老式 execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return 'ok';
      } catch (e2) {
        return 'fail';
      }
    }
  }

  function exportToFile() {
    const s = exportString();
    if (!s) return 'no data';
    const sum = summary();
    const name = 'pokebonk-save-' + (sum ? sum.name.replace(/[^\w\u4e00-\u9fa5-]/g, '') + '-' : '') + stamp() + '.json';
    const blob = new Blob([s], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return name;
  }

  /* ---------------- 导入 ---------------- */
  function importFromText(text) {
    if (!text || typeof text !== 'string') return '空内容';
    let s = text.trim();
    // 容忍用户复制时带上的包裹
    if (s[0] !== '{') {
      const i = s.indexOf('{');
      const j = s.lastIndexOf('}');
      if (i >= 0 && j > i) s = s.slice(i, j + 1);
    }
    let o;
    try { o = JSON.parse(s); } catch (e) { return 'JSON 解析失败'; }
    const p = o.profile || o;
    if (!p || typeof p !== 'object') return '格式不对';
    if (!p.name && p.stardust === undefined) return '看起来不是存档';
    // 导入前先备份当前
    autoBackup();
    try {
      write(JSON.stringify({ v: 1, profile: p, guest: !!o.guest, savedAt: Date.now() }));
    } catch (e) {
      return '写入失败（存储满了？）';
    }
    return 'ok';
  }

  function importFromFile() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return resolve('没选文件');
        const fr = new FileReader();
        fr.onload = () => {
          const r = importFromText(String(fr.result || ''));
          resolve(r);
        };
        fr.onerror = () => resolve('读文件失败');
        fr.readAsText(f);
      };
      inp.click();
    });
  }

  /* ---------------- 提醒 ---------------- */
  /** 距离上次提醒是否超过 ms（默认 10 分钟） */
  function shouldWarn(ms) {
    try {
      const last = Number(global.localStorage.getItem(LAST_WARN_KEY) || 0);
      return Date.now() - last > (ms || 600000);
    } catch (e) { return true; }
  }

  function markWarned() {
    try { global.localStorage.setItem(LAST_WARN_KEY, String(Date.now())); } catch (e) {}
  }

  /** 存档多久没变过（秒） */
  function staleSeconds() {
    const sum = summary();
    if (!sum || !sum.savedAt) return 0;
    return Math.floor((Date.now() - sum.savedAt) / 1000);
  }

  global.PB_SAVE = {
    read, write, summary,
    autoBackup, listBackups, restoreBackup,
    exportString, exportToClipboard, exportToFile,
    importFromText, importFromFile,
    shouldWarn, markWarned, staleSeconds,
    KEY, BACKUP_PREFIX,
  };
})(typeof window !== 'undefined' ? window : globalThis);
