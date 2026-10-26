/* ============================================================================
 * PokéBonk 离线版 —— 存档 UI
 *
 *  1. 把主菜单的「保存到账号」改成「存档管理」，点击打开存档面板
 *  2. 首次进入 / 长时间没备份时弹提醒
 *  3. 对局结束时自动备份
 * ==========================================================================*/
(function (global) {
  'use strict';

  const SAVE = global.PB_SAVE;
  if (!SAVE) return;

  const BTN_TEXT = '存档管理';
  const OLD_TEXT = '保存到账号';

  let panel = null;
  let scanTimer = null;

  /* ---------------- 小工具 ---------------- */
  function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toast(msg, color) {
    const t = el('div',
      'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 20px;border-radius:10px;background:rgba(20,16,42,.96);' +
      'color:' + (color || '#fff') + ';font:600 14px system-ui;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.6);border:1px solid rgba(160,120,255,.35);' +
      'pointer-events:none;opacity:0;transition:opacity .18s', msg);
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 1800);
  }

  /* ---------------- 面板 ---------------- */
  function buildPanel() {
    const wrap = el('div',
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.62);' +
      'display:flex;align-items:center;justify-content:center;');
    wrap.onclick = (e) => { if (e.target === wrap) close(); };

    const box = el('div',
      'width:420px;maxWidth:94vw;max-height:86vh;overflow-y:auto;padding:18px 20px;' +
      'border-radius:14px;color:#f0ecff;font:13px system-ui;' +
      'background:linear-gradient(160deg,rgba(42,26,66,.99),rgba(24,16,46,.99));' +
      'border:1px solid rgba(160,120,255,.35);' +
      'box-shadow:0 20px 60px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.1) inset;');
    box.onclick = (e) => e.stopPropagation();

    // 标题
    const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px');
    head.appendChild(el('div',
      'font-weight:800;font-size:16px;letter-spacing:.3px;' +
      'background:linear-gradient(90deg,#ffd23a,#ff6ec7);' +
      '-webkit-background-clip:text;-webkit-text-fill-color:transparent',
      '存档管理'));
    const x = el('button',
      'background:rgba(255,93,108,.12);border:1px solid rgba(255,93,108,.3);color:#ff5d6c;' +
      'width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;line-height:1', '✕');
    x.onclick = close;
    head.appendChild(x);
    box.appendChild(head);
    box.appendChild(el('div', 'font-size:10.5px;opacity:.5;margin-bottom:12px',
      '进度保存在这个浏览器里，清理缓存会丢失 · 建议定期导出备份'));

    // 当前存档信息
    const sum = SAVE.summary();
    const info = el('div',
      'padding:10px 12px;border-radius:10px;margin-bottom:14px;font-size:12px;line-height:1.7;' +
      'background:rgba(18,14,36,.6);border:1px solid rgba(160,120,255,.2)');
    if (sum) {
      info.innerHTML =
        '<div style="opacity:.55;font-size:10.5px;margin-bottom:2px">当前存档</div>' +
        '<div><b style="color:#ffd23a">' + esc(sum.name) + '</b></div>' +
        '<div>星尘 <b>' + fmt(sum.stardust) + '</b> · 邦币 <b>' + fmt(sum.bonk) + '</b>' +
        ' · 联盟 <b>' + sum.league + '</b> · 图鉴 <b>' + sum.captured + '/151</b></div>' +
        '<div style="opacity:.55;font-size:10.5px">最后保存：' + fmtTime(sum.savedAt) + '</div>';
    } else {
      info.textContent = '还没有存档（先玩一局？）';
    }
    box.appendChild(info);

    // 按钮
    const btnWrap = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px');
    const mk = (label, color, fn, dark) => {
      const b = el('button',
        'padding:10px 12px;border-radius:9px;cursor:pointer;font:600 12.5px system-ui;' +
        'border:' + (dark ? '0' : '1px solid rgba(255,255,255,.18)') + ';' +
        (dark
          ? 'background:linear-gradient(180deg,' + color + ',' + color + 'cc);color:#1a1430;'
          : 'background:rgba(255,255,255,.06);color:#f0ecff;'),
        label);
      b.onclick = fn;
      return b;
    };

    btnWrap.appendChild(mk('📋 复制存档', '#4ea8ff', async () => {
      const r = await SAVE.exportToClipboard();
      if (r === 'ok') { toast('✔ 存档已复制到剪贴板', '#6fdc8c'); SAVE.markWarned(); }
      else toast('✘ 复制失败，试试「下载文件」', '#ff7b7b');
    }, true));

    btnWrap.appendChild(mk('💾 下载文件', '#5fe08a', () => {
      const n = SAVE.exportToFile();
      if (n === 'no data') toast('✘ 没有存档', '#ff7b7b');
      else { toast('✔ 已下载 ' + n, '#6fdc8c'); SAVE.markWarned(); }
    }, true));

    btnWrap.appendChild(mk('📂 导入文件', '#a06aff', async () => {
      const r = await SAVE.importFromFile();
      if (r === 'ok') { toast('✔ 导入成功，正在刷新…', '#6fdc8c'); setTimeout(() => location.reload(), 900); }
      else if (r !== '没选文件') toast('✘ ' + r, '#ff7b7b');
    }));

    btnWrap.appendChild(mk('📝 粘贴导入', '#ffd23a', () => {
      const ta = el('textarea',
        'width:100%;height:110px;margin-top:10px;padding:8px;border-radius:8px;' +
        'background:#12102a;color:#cfd6ff;border:1px solid rgba(160,120,255,.3);' +
        'font:11px monospace;resize:vertical;box-sizing:border-box');
      ta.placeholder = '把之前复制的存档串粘贴到这里';
      const ok = el('button',
        'margin-top:8px;padding:8px 18px;border-radius:8px;border:0;cursor:pointer;' +
        'background:linear-gradient(180deg,#5fe08a,#4cc477);color:#1a1430;font:700 12.5px system-ui',
        '确认导入');
      ok.onclick = () => {
        const r = SAVE.importFromText(ta.value);
        if (r === 'ok') { toast('✔ 导入成功，正在刷新…', '#6fdc8c'); setTimeout(() => location.reload(), 900); }
        else toast('✘ ' + r, '#ff7b7b');
      };
      const holder = el('div', 'margin-top:4px');
      holder.appendChild(ta);
      holder.appendChild(ok);
      const exist = box.querySelector('#pb-save-import');
      if (exist) exist.remove();
      holder.id = 'pb-save-import';
      box.appendChild(holder);
      ta.focus();
    }, true));

    box.appendChild(btnWrap);

    // 自动备份列表
    const bks = SAVE.listBackups();
    box.appendChild(el('div', 'font-size:11px;opacity:.55;margin-bottom:6px',
      '自动备份（最近 ' + bks.length + ' 份，每局结束自动生成）'));
    const listBox = el('div', 'display:flex;flex-direction:column;gap:5px;margin-bottom:14px');
    if (!bks.length) {
      listBox.appendChild(el('div', 'font-size:11px;opacity:.35;padding:6px 2px', '还没有备份'));
    } else {
      bks.forEach((b) => {
        const row = el('div',
          'display:flex;justify-content:space-between;align-items:center;padding:7px 10px;' +
          'border-radius:8px;background:rgba(18,14,36,.5);font-size:11px');
        const t = b.time.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/,
          '$1-$2-$3 $4:$5');
        row.appendChild(el('span', 'opacity:.7', t + (b.summary ? ' · 星尘 ' + fmt(b.summary.stardust) : '')));
        const rb = el('button',
          'padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);' +
          'background:rgba(255,255,255,.06);color:#f0ecff;cursor:pointer;font:600 11px system-ui', '恢复');
        rb.onclick = () => {
          if (!confirm('用这个备份覆盖当前存档？')) return;
          SAVE.restoreBackup(b.id);
        };
        row.appendChild(rb);
        listBox.appendChild(row);
      });
    }
    box.appendChild(listBox);

    // 危险区
    const danger = el('div',
      'padding-top:10px;border-top:1px solid rgba(160,120,255,.18);font-size:11px;opacity:.6;line-height:1.6',
      '⚠️ 清理浏览器缓存 / 使用无痕模式会让存档永久消失，请务必先导出备份。');
    box.appendChild(danger);

    wrap.appendChild(box);
    return { wrap, box };
  }

  function esc(s) {
    return String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(n);
  }

  function open() {
    if (panel && document.body.contains(panel.wrap)) { panel.wrap.style.display = 'flex'; return; }
    panel = buildPanel();
    document.body.appendChild(panel.wrap);
  }
  function close() {
    if (panel) panel.wrap.style.display = 'none';
  }

  /* ---------------- 替换主菜单按钮 ---------------- */
  function replaceButton() {
    const btns = [...document.querySelectorAll('button,a,[role=button]')];
    let hit = 0;
    for (const b of btns) {
      const t = (b.textContent || '').trim();
      if (t === OLD_TEXT || t === BTN_TEXT) {
        if (t !== BTN_TEXT) {
          b.textContent = BTN_TEXT;
          // 清掉原来绑的事件：克隆替换
          const nb = b.cloneNode(true);
          nb.textContent = BTN_TEXT;
          b.parentNode.replaceChild(nb, b);
          nb.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); }, true);
          hit++;
        }
      }
    }
    return hit;
  }

  /* ---------------- 对局结束自动备份 ---------------- */
  let lastBackupAt = 0;
  function watchRunEnd() {
    const timer = setInterval(() => {
      const R = global.__RUN;
      if (!R) return;
      if (R.state === 'over' && Date.now() - lastBackupAt > 5000) {
        lastBackupAt = Date.now();
        SAVE.autoBackup();
        console.log('[pb-save] 对局结束，已自动备份');
      }
    }, 2000);
    if (timer.unref) timer.unref();
  }

  /* ---------------- 提醒 ---------------- */
  const WARN_KEY = 'pb.offline.warnedonce';
  function maybeWarn() {
    let first;
    try { first = !global.localStorage.getItem(WARN_KEY); } catch (e) { first = false; }
    if (first) {
      try { global.localStorage.setItem(WARN_KEY, '1'); } catch (e) {}
      showWarnBanner(
        '存档保存在这个浏览器里 —— 清理缓存会永久丢失！',
        '现在就去「存档管理」导出一份备份',
        true
      );
      return;
    }
    // 玩过一段时间但很久没备份
    const stale = SAVE.staleSeconds();
    if (stale > 1800 && SAVE.shouldWarn(1800000)) {
      SAVE.markWarned();
      showWarnBanner('已经玩了 ' + Math.floor(stale / 60) + ' 分钟没备份了', '建议导出一份存档', false);
    }
  }

  function showWarnBanner(title, sub, force) {
    if (document.getElementById('pb-warn')) return;
    const b = el('div',
      'position:fixed;left:50%;top:10%;transform:translateX(-50%);z-index:2147483645;' +
      'max-width:min(440px,92vw);padding:12px 16px;border-radius:12px;' +
      'background:linear-gradient(160deg,rgba(60,30,20,.98),rgba(40,18,30,.98));' +
      'border:1px solid rgba(255,168,60,.5);color:#ffe0b2;font:13px system-ui;' +
      'box-shadow:0 14px 40px rgba(0,0,0,.75);display:flex;gap:12px;align-items:flex-start');
    const icon = el('div', 'font-size:20px;line-height:1.1', '⚠️');
    const body = el('div', 'flex:1');
    body.appendChild(el('div', 'font-weight:700;margin-bottom:3px;color:#ffcb6b', title));
    body.appendChild(el('div', 'font-size:11.5px;opacity:.85;line-height:1.5', sub));
    const act = el('button',
      'margin-top:8px;padding:6px 14px;border-radius:7px;border:0;cursor:pointer;' +
      'background:linear-gradient(180deg,#ffd23a,#e8b81f);color:#3a2a00;font:700 12px system-ui',
      '打开存档管理');
    act.onclick = () => { b.remove(); open(); };
    body.appendChild(act);
    const x = el('button',
      'background:transparent;border:0;color:#ffcb6b;font-size:16px;cursor:pointer;opacity:.7;line-height:1', '✕');
    x.onclick = () => b.remove();
    b.appendChild(icon);
    b.appendChild(body);
    b.appendChild(x);
    b.id = 'pb-warn';
    document.body.appendChild(b);
    if (!force) setTimeout(() => { if (b.parentNode) b.remove(); }, 12000);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    replaceButton();
    watchRunEnd();
    // 主菜单出现后再扫一次（按钮是动态渲染的）
    let n = 0;
    scanTimer = setInterval(() => {
      replaceButton();
      if (++n === 30) clearInterval(scanTimer);
    }, 1000);
    setTimeout(maybeWarn, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.PB_SAVE_UI = { open, close, toast };
})(typeof window !== 'undefined' ? window : globalThis);
