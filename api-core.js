/* ============================================================================
 * PokéBonk 离线版 —— 浏览器内 API（替代 offline/server.js 的 Node 后端）
 *
 * 设计：
 *   - 纯函数，不依赖 Node，只用 localStorage
 *   - 存档结构严格对齐游戏真实 schema（见 baseProfile 注释）
 *   - 由 offline-fetch.js 拦截 /status /auth /profile /runs 等请求
 *
 * 存档：localStorage['pb.offline.profile']
 * ==========================================================================*/
(function (global) {
  'use strict';

  const STORE_KEY = 'pb.offline.profile';
  const BUILD = 'mwe4m5hw';
  const VERSION = '0.9.26';
  const KANTO_MAX = 151;

  const LAB = [
    ['slot-move', 1], ['slot-vit', 2], ['reroll', 6], ['skip', 6], ['banish', 6],
    ['dmg', 8], ['hp', 8], ['spd', 6], ['xp', 6], ['gold', 6], ['luck', 6], ['magnet', 6],
    ['regen', 5], ['armor', 6], ['revive', 1], ['research', 4], ['party', 1], ['area', 5],
    ['crit', 5], ['atkspd', 5], ['ult', 5], ['bag', 1],
  ];

  // 游戏 settings 的完整默认值（从主包 cW 提取）
  const SETTINGS_DEFAULT = {
    master: 0.8, music: 0.5, sfx: 0.7, cries: 0.6, menuMusic: 'auto',
    quality: 'high', aimMode: 'auto', sensitivity: 1, invertY: false,
    damageNumbers: true, floatText: true, shakeOn: true, screenShake: 1,
    fov: 70, showFps: false, reduceFlashes: false, pixel: 0, muteHidden: true,
    theme: 'auto', hudScale: 1, hudOpacity: 1, bossBarOpacity: 1,
    bossHpText: 'num', showBanners: true, showBossBanners: true,
    showMinimap: true, showLadder: true, showToasts: true, showStreak: true,
    showItems: true, showTracked: true, lootMinRarity: 0, lootHideUse: false,
    lootHideTreasure: false, mapScale: 1, mapIcons: 1, mapNorthUp: false,
    mapFps: 'smooth', fxOpacity: 1, ownFxOpacity: 1, fxGlow: 1, touchScale: 1,
    camDist: 9, calmCandies: false, pickupFx: 'full', mateFx: 'full',
    skipEmptyLevelUp: false, hideOwnFx: false, fixedStick: false,
    padRumble: true, padDead: 0.15,
  };

  /* ---------------------------------------------------------------- 工具 */
  const now = () => Date.now();
  const rnd32 = () => {
    const a = new Uint32Array(1);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return a[0];
  };
  const token = () => {
    const b = new Uint8Array(18);
    (global.crypto || global.msCrypto).getRandomValues(b);
    return 'pb' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };
  const PERIOD = () => ({ idx: 0, ids: [], prog: [], claimed: [], rerolls: 0 });

  /* ---------------------------------------------------------------- SCHEMA
   * 严格对齐游戏 lW() 的返回结构：
   *   captured 是对象（id → 次数），不是数组
   *   biomes   是对象（biomeId → 等级，forest 初始 0）
   *   quests / research / lab / counters / best / times / kills / medals /
   *   endless / forms 都是对象
   *   starter  关都伙伴（1-151）
   *   starterJ 城都伙伴（152-251）
   * ------------------------------------------------------------------- */
  function baseProfile(name) {
    return {
      v: 1,
      name: name || 'Entrenador',
      created: now(),
      stardust: 0,
      totalStardust: 0,
      bonk: 0,
      totalBonk: 0,
      unlocked: [],
      league: [],
      starter: 0,
      starterJ: 0,
      johtoForms: [],
      forms: [],
      research: {},
      captured: {},
      seen: [],
      played: [],
      shinies: [],
      classics: [],
      skins: [],
      team: [],
      lab: {},
      biomes: { forest: 0 },
      quests: {},
      counters: {},
      runs: [],
      best: {},
      times: {},
      kills: {},
      medals: {},
      endless: {},
      settings: { ...SETTINGS_DEFAULT },
      lastSpecies: 4,
      lastBiome: 'forest',
      banished: [],
      itemsOwned: [],
      itemsOff: [],
      movesOff: {},
      typesOff: {},
      daily: PERIOD(),
      weekly: PERIOD(),
      dailyStreak: { last: 0, n: 0 },
      bag: {},
      avatar: '',
      frame: '',
      title: '',
      banner: '',
      cosmetics: [],
    };
  }

  function freshProfile() {
    return baseProfile('Entrenador');
  }

  // 富有的新号：给资源，但引导状态保持全新（starter/starterJ/league 都是初始值）
  function fullProfile() {
    const p = baseProfile('Entrenador');
    p.stardust = 999999;
    p.totalStardust = 999999;
    p.bonk = 500;
    p.totalBonk = 500;
    for (const [id, max] of LAB) p.lab[id] = max;
    // 全地图解锁（对象形式，等级 0 = 已开放但没打过）
    p.biomes = {};
    for (const b of ['forest', 'desert', 'coast', 'glacier', 'graveyard', 'volcano', 'iris']) {
      p.biomes[b] = 0;
    }
    p.bag = { 'rare-candy': 99, 'lucky-egg': 1, 'amulet-coin': 1 };
    p.itemsOwned = ['toxic-orb'];
    return p;
  }

  function normalize(p) {
    const base = baseProfile(p && p.name);
    const out = { ...base, ...(p || {}) };

    // 对象型字段
    for (const k of ['research', 'captured', 'lab', 'quests', 'counters', 'best',
                     'times', 'kills', 'medals', 'endless', 'forms', 'movesOff',
                     'typesOff', 'bag']) {
      if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = {};
    }
    // 数组型字段
    for (const k of ['unlocked', 'league', 'seen', 'played', 'shinies', 'classics',
                     'skins', 'team', 'johtoForms', 'banished', 'itemsOwned',
                     'itemsOff', 'cosmetics', 'runs']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    // biomes 必须是对象
    if (!out.biomes || typeof out.biomes !== 'object' || Array.isArray(out.biomes)) {
      out.biomes = { forest: 0 };
    }
    if (!('forest' in out.biomes)) out.biomes.forest = 0;

    out.settings = { ...SETTINGS_DEFAULT, ...(p && p.settings) };
    out.daily = { ...PERIOD(), ...(p && p.daily) };
    out.weekly = { ...PERIOD(), ...(p && p.weekly) };
    out.dailyStreak = { last: 0, n: 0, ...(p && p.dailyStreak) };
    if (typeof out.starter !== 'number') out.starter = 0;
    if (typeof out.starterJ !== 'number') out.starterJ = 0;
    return out;
  }

  /* ---------------------------------------------------------------- 存储 */
  let store = null;
  let guestSession = false;

  function load() {
    if (store) return store;
    try {
      const raw = global.localStorage.getItem(STORE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        store = normalize(o.profile || o);
        guestSession = !!o.guest;
        return store;
      }
    } catch (e) {}
    store = fullProfile();
    save();
    return store;
  }

  function save() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1, profile: store, guest: guestSession, savedAt: now(),
      }));
    } catch (e) {
      console.warn('[pb-offline] 存档写入失败', e);
    }
  }

  function account() {
    return { id: 'local-1', name: store.name, guest: guestSession, created: store.created };
  }
  function publicProfile() { return store; }

  /* ---------------------------------------------------------------- 结算 */
  function applyActions(actions) {
    for (const a of actions || []) {
      try {
        switch (a.t) {
          case 'addStardust':
            store.stardust = (store.stardust | 0) + (a.v | 0);
            store.totalStardust = (store.totalStardust | 0) + (a.v | 0);
            break;
          case 'addBonk':
            store.bonk = (store.bonk | 0) + (a.v | 0);
            store.totalBonk = (store.totalBonk | 0) + (a.v | 0);
            break;
          case 'unlock':
            if (!store.unlocked.includes(a.id | 0)) store.unlocked.push(a.id | 0);
            break;
          case 'capture':
            store.captured[a.id | 0] = (store.captured[a.id | 0] | 0) + 1;
            break;
          case 'seen':
            if (!store.seen.includes(a.id | 0)) store.seen.push(a.id | 0);
            break;
          case 'item': {
            const ids = Array.isArray(a.id) ? a.id : [a.id];
            for (const id of ids) if (!store.itemsOwned.includes(id)) store.itemsOwned.push(id);
            break;
          }
          case 'bag':
            store.bag[a.id] = (store.bag[a.id] | 0) + (a.v | 0);
            break;
          case 'league':
            if (!Array.isArray(store.league)) store.league = [];
            if (!store.league.includes(a.v | 0)) store.league.push(a.v | 0);
            break;
          case 'biome':
            if (store.biomes[a.id] === undefined) store.biomes[a.id] = 0;
            break;
          default:
            break;
        }
      } catch (e) {}
    }
  }

  function applyRunResult(result, runId) {
    const r = result || {};
    const id = runId || r.id || ('r' + now());
    const rec = {
      id, date: now(), species: r.species, finalSpecies: r.finalSpecies,
      biome: r.biome, tier: r.tier | 0, stage: r.stage | 0,
      time: r.time || 0, kills: r.kills | 0, damage: r.damage || 0,
      level: r.level | 0, victory: !!r.victory, score: r.score || 0,
      seed: r.seed, moves: r.moves || [], items: r.items || [],
      splits: r.splits || [], ranked: true, mode: r.mode || 'standard',
    };
    if (!Array.isArray(store.runs)) store.runs = [];
    store.runs.unshift(rec);
    if (store.runs.length > 200) store.runs.length = 200;

    const c = store.counters;
    c.runs = (c.runs | 0) + 1;
    c.kills = (c.kills | 0) + (r.kills | 0);
    c.maxTime = Math.max(c.maxTime | 0, Math.round(r.time || 0));
    c.maxLevel = Math.max(c.maxLevel | 0, r.level | 0);
    c.playtime = (c.playtime | 0) + Math.round(r.time || 0);
    c.bosses = (c.bosses | 0) + (r.bosses | 0);
    c.legendaries = (c.legendaries | 0) + (r.legendaries | 0);
    if (r.econ && r.econ.gold) c.gold = (c.gold | 0) + (r.econ.gold | 0);

    const gain = Math.max(1, Math.round((r.kills | 0) * 0.5 + (r.time || 0) * 0.2));
    store.stardust = (store.stardust | 0) + gain;
    store.totalStardust = (store.totalStardust | 0) + gain;

    let bonk = 0;
    if (r.bosses) {
      bonk = r.bosses * (1 + Math.floor(Math.random() * 3));
      store.bonk = (store.bonk | 0) + bonk;
      store.totalBonk = (store.totalBonk | 0) + bonk;
    }
    save();
    return { gain, bonk, record: rec };
  }

  /* ---------------------------------------------------------------- 路由 */
  function j(obj) { return { __json: obj }; }
  function noContent() { return { __status: 204 }; }

  function handle(method, P, query, body) {
    load();
    body = body || {};
    const q = query || new Map();

    /* ---- 公共状态 ---- */
    if (method === 'GET' && P === '/status') {
      return j({
        ok: true, build: BUILD, version: VERSION, offline: true,
        maintenance: { on: false, msg: '' }, bypass: false,
        registration: { inviteOnly: false, open: true },
        players: 1, online: 1, server: 'github-pages-offline',
      });
    }
    if (method === 'GET' && P === '/version.json') {
      return j({ build: BUILD, version: VERSION });
    }

    /* ---- 认证 ---- */
    if (method === 'POST' && P === '/auth/guest') {
      guestSession = true;
      if (!store.name || store.name === 'Entrenador') {
        store.name = 'Invitado' + String(rnd32() % 10000).padStart(4, '0');
      }
      save();
      return j({ ...account(), guest: true, token: token() });
    }
    if (method === 'GET' && P === '/auth/me') {
      return j({ ...account(), token: token() });
    }
    if (method === 'GET' && P === '/auth/name') {
      const name = String(q.get('name') || '').trim();
      const ok = name.length >= 3;
      return j({ ok, free: ok, taken: !ok, available: ok, name });
    }
    if (method === 'POST' && (P === '/auth/register' || P === '/auth/login' ||
                              P === '/auth/upgrade' || P === '/auth/guest-name')) {
      const name = String(body.name || '').trim();
      if (name) store.name = name.slice(0, 16);
      guestSession = false;
      save();
      return j({ ...account(), guest: false, token: token() });
    }
    if (method === 'POST' && P === '/auth/logout') return noContent();

    /* ---- 存档 ---- */
    if (method === 'GET' && P === '/profile') {
      return j({ now: now(), profile: publicProfile() });
    }
    if (method === 'PUT' && P === '/profile/prefs') {
      for (const k of ['lastSpecies', 'lastBiome', 'avatar', 'frame', 'title', 'banner']) {
        if (body[k] !== undefined) store[k] = body[k];
      }
      if (body.settings && typeof body.settings === 'object') {
        store.settings = { ...store.settings, ...body.settings };
      }
      if (Array.isArray(body.skins)) store.skins = body.skins;
      if (Array.isArray(body.team) && body.team.length) store.team = body.team;
      if (Array.isArray(body.banished)) store.banished = body.banished;
      if (Array.isArray(body.itemsOff)) store.itemsOff = body.itemsOff;
      save();
      return j({ ok: true, profile: publicProfile() });
    }
    if (method === 'POST' && P === '/profile/actions') {
      applyActions(body.actions || []);
      save();
      return j({ ok: true, profile: publicProfile() });
    }
    if (method === 'POST' && P === '/profile/stash') {
      if (body.bag && typeof body.bag === 'object') {
        Object.assign(store.bag, body.bag);
      }
      save();
      return j({ ok: true, profile: publicProfile() });
    }

    /* ---- 选择初始伙伴 ---- */
    if (method === 'POST' && P === '/profile/starter') {
      const id = (body.id | 0) || 4;
      // 关都（1-151）写 starter，城都（152-251）写 starterJ
      if (id > KANTO_MAX) {
        if (!store.starterJ) store.starterJ = id;
        if (!Array.isArray(store.johtoForms)) store.johtoForms = [];
        if (!store.johtoForms.includes(id)) store.johtoForms.push(id);
      } else {
        if (!store.starter) store.starter = id;
      }
      store.lastSpecies = id;
      for (const k of ['team', 'league', 'unlocked', 'seen']) {
        if (!Array.isArray(store[k])) store[k] = [];
        if (!store[k].includes(id)) store[k].push(id);
      }
      if (!store.captured[id]) store.captured[id] = 1;
      save();
      return j({ ok: true, profile: publicProfile() });
    }

    /* ---- 对局 ---- */
    if (method === 'POST' && /^\/runs\/start$/.test(P)) {
      return j({ id: 'run-' + rnd32().toString(16), seed: rnd32() | 0, started: now() });
    }
    if (method === 'POST' && /^\/runs\/[^/]+\/finish$/.test(P)) {
      const id = P.split('/')[2];
      const res = applyRunResult(body.result || body, id);
      return j({ ok: true, record: res.record, reward: { stardust: res.gain, bonk: res.bonk } });
    }
    if (method === 'POST' && /^\/runs\/[^/]+\/(checkpoint|abandon)$/.test(P)) {
      return j({ ok: true });
    }
    if (method === 'GET' && P === '/runs') {
      return j({ runs: (store.runs || []).slice(0, 50) });
    }

    /* ---- 实验室 ---- */
    if (method === 'POST' && /^\/lab\/[^/]+\/buy$/.test(P)) {
      const id = P.split('/')[2];
      const max = (LAB.find((x) => x[0] === id) || [id, 1])[1];
      const cur = store.lab[id] | 0;
      if (cur >= max) return j({ ok: false, error: 'MAX' });
      const cost = 10 * (cur + 1);
      if ((store.stardust | 0) < cost) return j({ ok: false, error: 'NO_STARDUST' });
      store.stardust -= cost;
      store.lab[id] = cur + 1;
      save();
      return j({ ok: true, profile: publicProfile() });
    }

    /* ---- 排行榜（离线版：用玩家自己的记录） ---- */
    if (method === 'GET' && /^\/leaderboard/.test(P)) {
      if (/^\/leaderboard\/pokemon/.test(P)) {
        return j({ entries: [], info: { season: 1, total: 0 } });
      }
      const mode = String(q.get('mode') || 'standard');
      const limit = Math.min(100, Number(q.get('limit') || 50));
      const list = (store.runs || [])
        .slice()
        .sort((a, b) => (b.score || b.kills || 0) - (a.score || a.kills || 0))
        .slice(0, limit)
        .map((r, i) => ({
          rank: i + 1, me: true, id: r.id, name: store.name,
          species: r.species, avatar: store.avatar, frame: store.frame,
          skins: [], tag: '', title: store.title,
          value: r.score || r.kills || 0,
          floor: r.stage || 1, wave: 3, time: Math.round(r.time || 0),
        }));
      return j({
        entries: list,
        me: list.length ? list[0] : null,
        info: { season: 1, mode, total: list.length, teams: 0, clans: 0 },
      });
    }
    if (method === 'GET' && /^\/records/.test(P)) {
      const best = {};
      for (const r of store.runs || []) {
        const k = r.biome + '-' + (r.tier | 0);
        if (!best[k] || (r.score || r.kills || 0) > (best[k].score || best[k].kills || 0)) best[k] = r;
      }
      return j(best);
    }
    if (method === 'GET' && /^\/seasons/.test(P)) {
      return j({ season: 1, ends: 0, awards: [], claimed: false });
    }

    /* ---- 任务 ---- */
    if (method === 'GET' && (P === '/quests' || P === '/tasks')) {
      return j({ list: [], claimed: [] });
    }
    if (method === 'POST' && /^\/(quests|tasks)\/[^/]+\/claim$/.test(P)) {
      return j({ ok: true, profile: publicProfile() });
    }

    /* ---- 商店 / 道具 ---- */
    if (method === 'POST' && /^\/items\/[^/]+\/(buy|equip|off|sell)$/.test(P)) {
      return j({ ok: true, profile: publicProfile() });
    }

    /* ---- 其他：空壳 ---- */
    if (method === 'GET' && /^\/(events|news|players|friends|clans)/.test(P)) {
      return j({ list: [], ok: true });
    }
    if (method === 'POST' && /^\/(events)/.test(P)) {
      return j({ ok: true });
    }

    /* ---- 兜底 ---- */
    return j({ ok: true });
  }

  /* ---------------------------------------------------------------- 导出 */
  const api = {
    handle, load, save, normalize,
    fullProfile, freshProfile,
    get store() { return load(); },
    reset(toFull) {
      store = toFull ? fullProfile() : freshProfile();
      guestSession = false;
      save();
      return store;
    },
    exportRaw() { load(); return global.localStorage.getItem(STORE_KEY); },
    importRaw(s) {
      const o = JSON.parse(s);
      store = normalize(o.profile || o);
      guestSession = !!o.guest;
      save();
      return store;
    },
    STORE_KEY, BUILD, VERSION,
  };

  global.PB_OFFLINE_API = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
