// 视觉等级：用显卡 / CPU / 内存估一个起点，再按真实帧时间升降，避免只看瞬间卡顿。
import { LANG } from '../i18n.js';

const STORAGE_KEY = 'psl-quality';
export const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];

export const TIER_LABEL = {
  low: { zh: '流畅', en: 'Low' },
  medium: { zh: '均衡', en: 'Med' },
  high: { zh: '标准', en: 'High' },
  ultra: { zh: '极致', en: 'Ultra' },
};

// 数值对齐改动前的默认画面（像素 3、泛光 0.9、1024 阴影、5 火把 + 8 盏动态光）。
// 粒子池按极致一次性分配，低等级只收紧存活上限和每帧发射预算。
const PRESETS = {
  low: {
    pixel: 5, bloom: 0, shadows: false, shadowSize: 256,
    dynLights: 2, torches: 1,
    glowCap: 900, smokeCap: 280, glowBudget: 160, smokeBudget: 40,
    fx: 0.34, dust: false, torchParticles: false, buffParticles: false,
  },
  medium: {
    pixel: 4, bloom: 0.55, shadows: true, shadowSize: 512,
    dynLights: 4, torches: 3,
    glowCap: 2600, smokeCap: 900, glowBudget: 480, smokeBudget: 110,
    fx: 0.62, dust: false, torchParticles: true, buffParticles: true,
  },
  high: {
    pixel: 3, bloom: 0.9, shadows: true, shadowSize: 1024,
    dynLights: 8, torches: 5,
    glowCap: 7000, smokeCap: 2500, glowBudget: 4000, smokeBudget: 900,
    fx: 1, dust: true, torchParticles: true, buffParticles: true,
  },
  ultra: {
    pixel: 2, bloom: 1.05, shadows: true, shadowSize: 1024,
    dynLights: 8, torches: 5,
    glowCap: 7000, smokeCap: 2500, glowBudget: 5200, smokeBudget: 1200,
    fx: 1, dust: true, torchParticles: true, buffParticles: true,
  },
};

function tierFromScore(score) {
  if (score <= 0) return 'low';
  if (score <= 2) return 'medium';
  if (score <= 4) return 'high';
  return 'ultra';
}

// null = 读不到具体型号，交给核心数和内存
function gpuScore(raw) {
  const s = raw || '';
  if (/SwiftShader|llvmpipe|Microsoft Basic Render|Basic Render Driver/i.test(s)) return -4;
  if (/Apple M4|Apple M3 Max|Apple M3 Ultra|Apple M2 Ultra|Apple M2 Max|Apple M1 Ultra|Apple M1 Max|M4 Max|M4 Pro|M3 Pro/i.test(s)) return 5;
  if (/Apple M3|Apple M2|Apple M1 Pro/i.test(s)) return 4;
  if (/Apple M1\b/i.test(s)) return 3;
  if (/RTX 50|RTX 40|RTX 3090|RTX 3080|RX 7900|RX 7800|RX 6900/i.test(s)) return 5;
  if (/RTX 30|RTX 20|GTX 16[6-9]|GTX 1080|GTX 1070|RX 6[6-9]|RX 5[6-9]|Arc A7|Arc B/i.test(s)) return 4;
  if (/GTX|GeForce|Radeon RX|Radeon Pro|Arc A/i.test(s)) return 3;
  if (/Iris Xe|Iris\(R\) Xe|Iris Plus/i.test(s)) return 1;
  if (/UHD Graphics|HD Graphics|Intel\(R\) HD|Radeon\(TM\) Graphics|Radeon Graphics/i.test(s)) return -1;
  if (/Mali-G7[2-9]|Mali-G8|Adreno \(TM\) [7-9]|Adreno \(TM\) 6[6-9]/i.test(s)) return 1;
  if (/Mali|Adreno|PowerVR|Immortalis|Xclipse/i.test(s)) return -1;
  if (/Apple GPU/i.test(s)) return null;
  if (!s || /WebKit WebGL|WebGL 1\.0/i.test(s)) return null;
  return 2;
}

function readGpu(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(raw || '');
  } catch { return ''; }
}

function shortGpu(raw) {
  if (!raw) return 'GPU';
  let s = raw;
  const angle = s.match(/ANGLE \((.*)\)/i);
  if (angle) {
    const parts = angle[1].split(',');
    s = (parts[1] || parts[0] || s).trim();
  }
  s = s.replace(/ANGLE Metal Renderer:\s*/i, '')
    .replace(/\((?:R|TM)\)/g, '')
    .replace(/\b(?:Direct3D|OpenGL|Metal|Unspecified Version|vs_\d.*|ps_\d.*)\b.*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = 'GPU';
  return s.length > 36 ? s.slice(0, 34) + '…' : s;
}

export function detectHardware(renderer) {
  const raw = readGpu(renderer);
  const cores = navigator.hardwareConcurrency || 4;
  const memory = Number(navigator.deviceMemory) || 0;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let score = gpuScore(raw);
  if (score == null) score = 2;
  if (cores >= 12) score += 1;
  else if (cores <= 2) score -= 2;
  else if (cores <= 4) score -= 1;
  if (memory) {
    if (memory <= 2) score -= 2;
    else if (memory <= 4) score -= 1;
    else if (memory >= 16) score += 1;
  }
  let tier = tierFromScore(score);
  if (saveData) tier = TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];
  if (reduced) tier = 'low';
  return { raw, gpuShort: shortGpu(raw), cores, memory, saveData, reduced, score, tier, hz: 0 };
}

export function pixelFor(tier, w, h) {
  let pixel = PRESETS[tier].pixel;
  if (Math.max(0, w) * Math.max(0, h) >= 1920 * 1080) pixel = Math.min(6, pixel + 1);
  return pixel;
}

function presetFor(tier, w, h) {
  return { ...PRESETS[tier], pixel: pixelFor(tier, w, h) };
}

function loadMode() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'auto' || PRESETS[s]) return s;
  } catch { /* 隐私模式 */ }
  return 'auto';
}

export function createQuality(arena) {
  const info = detectHardware(arena.renderer);
  const state = {
    info,
    mode: loadMode(),
    tier: 'high',
    fps: 0,
    cooldown: 6,
    goodStreak: 0,
    win: [],
    winT: 0,
    fpsAcc: 0,
    fpsN: 0,
    boot: [],
  };
  state.tier = state.mode === 'auto' ? info.tier : state.mode;

  function view() {
    const w = arena.el.clientWidth || 1280, h = arena.el.clientHeight || 720;
    return presetFor(state.tier, w, h);
  }

  const api = {
    info,
    get mode() { return state.mode; },
    get tier() { return state.tier; },
    get fps() { return state.fps; },
    tierLabel() {
      const L = TIER_LABEL[state.tier] || TIER_LABEL.high;
      return LANG === 'en' ? L.en : L.zh;
    },
    statusText() {
      const en = LANG === 'en';
      const rec = (TIER_LABEL[info.tier] || TIER_LABEL.high)[en ? 'en' : 'zh'];
      const cur = (TIER_LABEL[state.tier] || TIER_LABEL.high)[en ? 'en' : 'zh'];
      const fps = state.fps ? Math.round(state.fps) : '–';
      const mem = info.memory ? ` · ${info.memory} GB` : '';
      const stepped = state.mode === 'auto' && state.tier !== info.tier;
      if (en) {
        return `${info.gpuShort}${mem} · ${info.cores} cores · recommended ${rec} · now ${cur} · pixel ${arena.pixel} · ${fps} FPS`
          + (info.reduced ? ' · reduced motion' : '')
          + (stepped ? ' · lowered for frame rate' : '');
      }
      return `${info.gpuShort}${mem} · ${info.cores} 核 · 推荐「${rec}」· 当前「${cur}」· 像素 ${arena.pixel} · ${fps} FPS`
        + (info.reduced ? ' · 减少动态' : '')
        + (stepped ? ' · 已按帧数下调' : '');
    },
    syncPixel() {
      const p = pixelFor(state.tier, arena.el.clientWidth, arena.el.clientHeight);
      if (p === arena.pixel) return false;
      arena.pixel = p;
      if (arena.q) arena.q.pixel = p;
      return true;
    },
    apply() {
      arena.applyQuality(view());
      arena.onQuality?.();
    },
    setMode(mode) {
      if (mode !== 'auto' && !PRESETS[mode]) return;
      state.mode = mode;
      try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
      state.tier = mode === 'auto' ? info.tier : mode;
      state.cooldown = 6;
      state.goodStreak = 0;
      state.win.length = 0;
      state.winT = 0;
      api.apply();
    },
    // rawDt 是未钳制的真实帧间隔（秒）。切标签的长帧直接丢掉，避免误降级。
    sample(rawDt) {
      if (!(rawDt > 0) || rawDt > 0.2 || document.hidden) {
        state.win.length = 0;
        state.winT = 0;
        return;
      }
      state.fpsAcc += rawDt;
      state.fpsN++;
      if (state.fpsAcc >= 0.5) {
        const inst = state.fpsN / state.fpsAcc;
        state.fps = state.fps ? state.fps * 0.45 + inst * 0.55 : inst;
        state.fpsAcc = 0;
        state.fpsN = 0;
        arena.onQuality?.();
      }
      if (!info.hz && state.boot && state.boot.length < 48) {
        state.boot.push(rawDt);
        if (state.boot.length === 48) {
          const s = state.boot.slice().sort((a, b) => a - b);
          const med = s[24];
          const hz = med > 0 ? Math.round(1 / med) : 60;
          info.hz = Math.min(240, Math.max(30, Math.round(hz / 10) * 10 || 60));
          state.boot = null;
        }
      }
      state.win.push(rawDt);
      state.winT += rawDt;
      if (state.winT < 2.5) return;
      const arr = state.win;
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      const avg = sum / arr.length;
      const sorted = arr.slice().sort((a, b) => a - b);
      const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
      state.win = [];
      state.winT = 0;
      if (state.mode !== 'auto') return;
      if (state.cooldown > 0) { state.cooldown -= 2.5; return; }
      const frame = 1 / (info.hz || 60);
      const bad = avg > frame * 1.42 || p90 > frame * 2.05;
      const good = avg < frame * 1.1 && p90 < frame * 1.5;
      const cur = TIER_ORDER.indexOf(state.tier);
      const rec = TIER_ORDER.indexOf(info.tier);
      if (bad && cur > 0) {
        state.goodStreak = 0;
        state.tier = TIER_ORDER[cur - 1];
        state.cooldown = 8;
        api.apply();
      } else if (good && cur < rec) {
        state.goodStreak++;
        if (state.goodStreak >= 2) {
          state.goodStreak = 0;
          state.tier = TIER_ORDER[cur + 1];
          state.cooldown = 8;
          api.apply();
        }
      } else state.goodStreak = 0;
    },
  };
  api.apply();
  return api;
}
