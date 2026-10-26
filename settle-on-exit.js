/* ============================================================================
 * PokéBonk 离线版 —— 刷新/关闭页面时的兜底结算
 *
 * 问题：单机模式下游戏不写 pb.live / pb.pending，直接刷新会丢掉整局进度。
 * 做法：在 beforeunload 里把 __RUN 的当前统计直接结算进存档（纯本地，不走网络）。
 * ==========================================================================*/
(function (global) {
  'use strict';

  const api = global.PB_OFFLINE_API;
  if (!api) return;

  let done = false;

  function settleNow(reason) {
    if (done) return;
    const R = global.__RUN;
    if (!R) return;
    // 只在真正对局中结算
    if (R.state !== 'play' && R.state !== 'paused' && R.state !== 'transition') return;
    try {
      const st = R.stats || {};
      const kills = st.kills | 0;
      const time = Math.round(R.time || 0);
      // 太短的局不记（避免刷一堆 0 秒记录）
      if (time < 5 && kills < 1) return;

      const result = {
        species: (R.player && R.player.species) || R.species || 4,
        finalSpecies: (R.player && R.player.species) || R.species || 4,
        biome: (R.biome && R.biome.id) || 'forest',
        tier: (R.tier | 0),
        stage: (R.stage | 0) || 1,
        time,
        kills,
        damage: Math.round(st.damage || 0),
        level: (R.player && R.player.level) | 0 || 1,
        victory: false,
        bosses: st.bosses | 0,
        legendaries: st.legendaries | 0,
        alphas: st.alphas | 0,
        reactions: st.reactions | 0,
        moves: (R.player && R.player.moves ? [] : []),
        items: [],
        splits: (R.splits || []).slice(),
        mode: R.endless ? 'endless' : (R.tower ? 'tower' : 'standard'),
        econ: { gold: Math.round((R.player && R.player.stats && R.player.stats.gold) || 0), balls: 0, shop: 0, sold: 0 },
        end: { how: reason || 'reload' },
      };

      const res = api.handle('POST', '/runs/' + (R.runId || ('local-' + Date.now())) + '/finish', new Map(), { result });
      done = true;
      console.log('[pb-settle] 刷新前已本地结算：' + time + 's / ' + kills + ' 杀');
      return res;
    } catch (e) {
      console.warn('[pb-settle] 结算失败', e);
    }
  }

  // 页面要关闭/刷新
  global.addEventListener('beforeunload', () => {
    settleNow('reload');
  });
  // 手机切后台也可能直接被杀
  global.addEventListener('pagehide', () => {
    settleNow('pagehide');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') settleNow('hidden');
  });

  global.PB_SETTLE = { settleNow };
})(typeof window !== 'undefined' ? window : globalThis);
