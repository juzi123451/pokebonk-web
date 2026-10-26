/* ============================================================================
 * PokéBonk 离线版 —— 浏览器内 API（替代 offline/server.js 的 Node 后端）
 *
 * 设计：
 *   - 纯函数，不依赖 Node，只用 localStorage
 *   - 从 offline/server.js 移植，逻辑保持一致
 *   - 由 offline-boot.js 在页面加载前挂到 window.fetch 上，
 *     拦截 /status /auth /profile /runs 等请求，直接返回本地结果
 *
 * 存档：
 *   localStorage['pb.offline.profile'] = JSON
 *   导出/导入由面板的「存档」按钮负责
 * ==========================================================================*/
(function (global) {
  'use strict';

  const STORE_KEY = 'pb.offline.profile';
  const BUILD = 'mvlr7rzv';
  const VERSION = '0.8.34';
  const KANTO = Array.from({ length: 151 }, (_, i) => i + 1);

  const LAB = [
    ['slot-move', 1], ['slot-vit', 2], ['reroll', 6], ['skip', 6], ['banish', 6],
    ['dmg', 8], ['hp', 8], ['spd', 6], ['xp', 6], ['gold', 6], ['luck', 6], ['magnet', 6],
    ['regen', 5], ['armor', 6], ['revive', 1], ['research', 4], ['party', 1], ['area', 5],
    ['crit', 5], ['atkspd', 5], ['ult', 5], ['bag', 1],
  ];

  const BIOMES = ['forest', 'desert', 'coast', 'glacier', 'graveyard', 'volcano'];
  const SETTINGS_DEFAULT = {
    quality: 'high', shake: 1, music: 1, sfx: 1, aimMode: 'auto',
    skipEmptyLevelUp: false, calmCandies: false, pickupFx: 'full', fps: 0,
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
  const union = (arr, add) => {
    const s = new Set(arr || []);
    for (const x of add || []) s.add(x);
    return [...s];
  };
  const PERIOD = () => ({ idx: 0, ids: [], prog: [], claimed: [], rerolls: 0 });
  const sleepSync = () => {};

  /* ---------------------------------------------------------------- 存档骨架 */
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
      league: 1,
      starter: 0,
      forms: {},
      research: {},
      captured: [],
      seen: [],
      played: {},
      shinies: [],
      classics: [],
      skins: [],
      team: [],
      lab: {},
      biomes: ['forest'],
      quests: [],
      counters: {
        gold: 0, runs: 0, kills: 0, bosses: 0, legendaries: 0, chests: 0,
        maxTime: 0, maxLevel: 0, playtime: 0, best_gold: 0,
      },
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
      daily: PERIOD(),
      weekly: PERIOD(),
      dailyStreak: 0,
      bag: {},
      avatar: null,
      frame: null,
      title: null,
      cosmetics: [],
      wins: 0,
      events: {},
      winsAll: 0,
      treasures: {},
    };
  }

  function freshProfile() {
    return baseProfile('Entrenador');
  }

  function fullProfile() {
    const p = baseProfile('Entrenador');
    p.stardust = 999999;
    p.totalStardust = 999999;
    p.league = 151;
    p.unlocked = KANTO.slice();
    p.captured = KANTO.slice();
    p.seen = KANTO.slice();
    p.biomes = BIOMES.slice();
    for (const [id, max] of LAB) p.lab[id] = max;
    p.bag = { 'rare-candy': 99, 'lucky-egg': 1, 'amulet-coin': 1 };
    p.medals = {};
    p.itemsOwned = ['toxic-orb'];
    return p;
  }

  function normalize(p) {
    const base = baseProfile(p && p.name);
    const out = { ...base, ...(p || {}) };
    out.counters = { ...base.counters, ...(p && p.counters) };
    out.settings = { ...SETTINGS_DEFAULT, ...(p && p.settings) };
    out.lab = { ...(p && p.lab) };
    out.daily = { ...PERIOD(), ...(p && p.daily) };
    out.weekly = { ...PERIOD(), ...(p && p.weekly) };
    for (const k of ['unlocked', 'captured', 'seen', 'shinies', 'classics',
                     'skins', 'team', 'banished', 'itemsOwned', 'itemsOff',
                     'cosmetics', 'biomes']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    if (!out.runs) out.runs = [];
    if (!out.best) out.best = {};
    if (!out.times) out.times = {};
    if (!out.kills) out.kills = {};
    if (!out.medals) out.medals = {};
    if (!out.endless) out.endless = {};
    if (!out.bag) out.bag = {};
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
      console.warn('[pb-offline] 存档写入失败（localStorage 满了？）', e);
    }
  }

  function account() {
    return { id: 'local-1', name: store.name, guest: guestSession, created: store.created };
  }

  function publicProfile() {
    return store;
  }

  /* ---------------------------------------------------------------- 结算 */
  function applyActions(actions) {
    for (const a of actions || []) {
      try {
        switch (a.t) {
          case 'addStardust':
            store.stardust += a.v | 0;
            store.totalStardust += a.v | 0;
            break;
          case 'addBonk':
            store.bonk += a.v | 0;
            store.totalBonk += a.v | 0;
            break;
          case 'unlock':
            store.unlocked = union(store.unlocked, [a.id | 0]);
            break;
          case 'capture':
            store.captured = union(store.captured, [a.id | 0]);
            break;
          case 'seen':
            store.seen = union(store.seen, [a.id | 0]);
            break;
          case 'item':
            if (Array.isArray(a.id)) store.itemsOwned = union(store.itemsOwned, a.id);
            else store.itemsOwned = union(store.itemsOwned, [a.id]);
            break;
          case 'bag':
            store.bag[a.id] = (store.bag[a.id] | 0) + (a.v | 0);
            break;
          case 'league':
            store.league = Math.max(store.league, a.v | 0);
            break;
          case 'biome':
            store.biomes = union(store.biomes, [a.id]);
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
    store.runs.unshift(rec);
    if (store.runs.length > 200) store.runs.length = 200;
    store.counters.runs = (store.counters.runs | 0) + 1;
    store.counters.kills = (store.counters.kills | 0) + (r.kills | 0);
    store.counters.maxTime = Math.max(store.counters.maxTime | 0, Math.round(r.time || 0));
    store.counters.maxLevel = Math.max(store.counters.maxLevel | 0, r.level | 0);
    store.counters.playtime = (store.counters.playtime | 0) + Math.round(r.time || 0);
    store.counters.bosses = (store.counters.bosses | 0) + (r.bosses | 0);
    store.counters.legendaries = (store.counters.legendaries | 0) + (r.legendaries | 0);
    if (r.econ && r.econ.gold) store.counters.gold = (store.counters.gold | 0) + (r.econ.gold | 0);
    // 星尘奖励：离线版给得宽松
    const gain = Math.max(1, Math.round((r.kills | 0) * 0.5 + (r.time || 0) * 0.2));
    store.stardust = (store.stardust | 0) + gain;
    store.totalStardust = (store.totalStardust | 0) + gain;
    // 邦币：离线版按 Boss 击杀给，方便体验
    if (r.bosses) {
      const bonk = r.bosses * (1 + Math.floor(Math.random() * 3));
      store.bonk = (store.bonk | 0) + bonk;
      store.totalBonk = (store.totalBonk | 0) + bonk;
    }
    save();
    return { gain, record: rec };
  }

  /* ---------------------------------------------------------------- 路由 */
  function j(obj) { return { __json: obj }; }
  function noContent() { return { __status: 204 }; }

  function handle(method, P, query, body) {
    load();
    body = body || {};
    const q = query || new Map();

    // ---- 公共状态
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

    // ---- 认证
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
    if (method === 'POST' && (P === '/auth/register' || P === '/auth/login' || P === '/auth/guest-name')) {
      const name = String(body.name || '').trim();
      if (name) store.name = name.slice(0, 16);
      guestSession = false;
      save();
      return j({ ...account(), guest: false, token: token() });
    }
    if (method === 'POST' && P === '/auth/logout') return noContent();

    // ---- 存档
    if (method === 'GET' && P === '/profile') {
      return j({ now: now(), profile: publicProfile() });
    }
    if (method === 'PUT' && P === '/profile/prefs') {
      for (const k of ['lastSpecies', 'lastBiome', 'avatar', 'frame', 'title']) {
        if (body[k] !== undefined) store[k] = body[k];
      }
      if (body.settings && typeof body.settings === 'object') {
        store.settings = { ...store.settings, ...body.settings };
      }
      if (Array.isArray(body.skins)) store.skins = body.skins;
      if (Array.isArray(body.team)) store.team = body.team;
      save();
      return j({ ok: true, profile: publicProfile() });
    }

// ---- 选择初始伙伴（POST /profile/starter { id }）
    if (method === 'POST' && P === '/profile/starter') {
      const id = (body.id | 0) || 4;
      store.starter = id;
      store.lastSpecies = id;
      store.team = union(store.team, [id]);
      store.captured = union(store.captured, [id]);
      store.seen = union(store.seen, [id]);
      if (!Array.isArray(store.league)) store.league = [];
      if (Array.isArray(store.league) && !store.league.includes(id)) store.league.push(id);
      save();
      return j({ ok: true, profile: publicProfile() });
    }

    // ---- 对局
    if (method === 'POST' && /^\/runs\/start$/.test(P)) {
      return j({ id: 'run-' + rnd32().toString(16), seed: rnd32() | 0, started: now() });
    }
    if (method === 'POST' && /^\/runs\/[^/]+\/finish$/.test(P)) {
      const id = P.split('/')[2];
      const res = applyRunResult(body.result || body, id);
      return j({ ok: true, record: res.record, reward: { stardust: res.gain } });
    }
    if (method === 'POST' && /^\/runs\/[^/]+\/(checkpoint|abandon)$/.test(P)) {
      return j({ ok: true });
    }
    if (method === 'GET' && P === '/runs') {
      return j({ runs: store.runs.slice(0, 50) });
    }

    // ---- 实验室
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

    // ---- 任务 / 委托
    if (method === 'GET' && (P === '/quests' || P === '/tasks')) {
      return j({ list: [], claimed: [] });
    }
    if (method === 'POST' && /^\/(quests|tasks)\/[^/]+\/claim$/.test(P)) {
      return j({ ok: true, profile: publicProfile() });
    }

    // ---- 商店 / 道具
    if (method === 'POST' && /^\/items\/[^/]+\/(buy|equip|off|sell)$/.test(P)) {
      return j({ ok: true, profile: publicProfile() });
    }

    // ---- 赛季 / 活动：给空壳，避免前端报错
    if (method === 'GET' && /^\/(seasons|events|leaderboard|news|players|friends|clans)/.test(P)) {
      return j({ list: [], ok: true });
    }
    if (method === 'POST' && /^\/(seasons|events|records)/.test(P)) {
      return j({ ok: true });
    }

    // ---- 兜底：任何未实现的写操作都当成功，避免卡流程
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      return j({ ok: true });
    }
    return j({ ok: true });
  }

  /* ---------------------------------------------------------------- 导出 */
  const api = {
    handle, load, save, normalize,
    fullProfile, freshProfile,
    get store() { return load(); },
    reset(toFull) { store = toFull ? fullProfile() : freshProfile(); guestSession = false; save(); return store; },
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
