// 数据仓库：技能库/Buff库/英雄配置的持久化与导入导出
import { PRESET_ABILITIES, PRESET_BUFFS, HERO_TEMPLATE, ENEMY_ABILITIES } from './data/presets.js';
import { ACTIONS } from './engine/actions.js';
import { uid } from './engine/model.js';

const KEY = 'pixel-skill-lab-v1';
const FORMAT = 'pixel-skill-lab';
export const REF_KEYS = ['ability', 'then', 'else', 'onHit', 'onExpire', 'timerAbility', 'deathAbility'];

export function freshLibrary() {
  const abilities = {};
  for (const a of [...PRESET_ABILITIES, ...ENEMY_ABILITIES]) abilities[a.id] = structuredClone(a);
  return { abilities, buffs: structuredClone(PRESET_BUFFS), hero: structuredClone(HERO_TEMPLATE) };
}

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const base = freshLibrary();
      // 保证敌人技能存在
      for (const a of ENEMY_ABILITIES) d.abilities[a.id] ??= structuredClone(a);
      const buffs = d.buffs || base.buffs;
      // 迁移：旧存档里的预设 Buff 补上内置着色特效
      for (const [id, pb] of Object.entries(PRESET_BUFFS)) if (buffs[id] && buffs[id].vfx === undefined && pb.vfx) buffs[id].vfx = structuredClone(pb.vfx);
      return { abilities: d.abilities, buffs, hero: d.hero || base.hero };
    }
  } catch (e) { console.warn('读取存档失败', e); }
  return freshLibrary();
}

let saveT = 0;
export function saveLibrary(lib) {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    localStorage.setItem(KEY, JSON.stringify({ abilities: lib.abilities, buffs: lib.buffs, hero: lib.hero }));
  }, 250);
}

// 收集技能引用的 Buff 与子技能
function collectDeps(lib, ids) {
  const abil = new Set(), buffs = new Set(), queue = [...ids];
  while (queue.length) {
    const id = queue.pop();
    const a = lib.abilities[id];
    if (!a || abil.has(id)) continue;
    abil.add(id);
    const scan = (v) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(scan);
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string') {
          if (k === 'buff' && lib.buffs[x]) buffs.add(x);
          if (REF_KEYS.includes(k) && lib.abilities[x]) queue.push(x);
        } else scan(x);
      }
    };
    scan(a.timeline); scan(a.trigger); scan(a.conditions);
  }
  return { abil: [...abil], buffs: [...buffs] };
}

export function exportAbilities(lib, ids) {
  const d = collectDeps(lib, ids);
  return JSON.stringify({
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
    root: ids, abilities: d.abil.map(id => lib.abilities[id]),
    buffs: Object.fromEntries(d.buffs.map(id => [id, lib.buffs[id]])),
  }, null, 2);
}
export function exportAll(lib) {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), full: true,
    abilities: Object.values(lib.abilities), buffs: lib.buffs, hero: lib.hero }, null, 2);
}

// 导入：同名冲突时自动改名并重写内部引用
export function importData(lib, text) {
  let d;
  try { d = JSON.parse(text.trim()); } catch { throw new Error('不是有效的 JSON'); }
  if (d && d.kind && d.timeline) d = { format: FORMAT, abilities: [d], buffs: {} };
  if (!d || d.format !== FORMAT || !Array.isArray(d.abilities)) throw new Error('格式不符：需要 Pixel Skill Lab 导出的数据');
  const remap = {};
  for (const a of d.abilities) {
    if (!a?.id || !a.kind || !Array.isArray(a.timeline)) throw new Error('技能数据缺少 id/kind/timeline');
    for (const b of a.timeline) if (!ACTIONS[b.type]) throw new Error(`未知动作类型: ${b.type}`);
    const exist = lib.abilities[a.id];
    remap[a.id] = exist && !d.full && JSON.stringify(exist) !== JSON.stringify(a) ? `${a.id}_${uid('')}` : a.id;
  }
  const fix = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(fix);
    for (const k of Object.keys(v)) {
      if (typeof v[k] === 'string' && REF_KEYS.includes(k) && remap[v[k]]) v[k] = remap[v[k]];
      else fix(v[k]);
    }
  };
  let added = 0, buffsAdded = 0;
  for (const [id, b] of Object.entries(d.buffs || {})) {
    if (!lib.buffs[id] || d.full) { lib.buffs[id] = { ...b, id }; buffsAdded++; }
  }
  const out = [];
  for (const src of d.abilities) {
    const a = structuredClone(src);
    a.id = remap[src.id];
    if (a.id !== src.id) a.name += ' (导入)';
    fix(a.timeline); fix(a.trigger);
    lib.abilities[a.id] = a; out.push(a.id); added++;
  }
  if (d.full && d.hero) lib.hero = d.hero;
  return { ids: out, added, buffsAdded, root: (d.root || []).map(r => remap[r] || r) };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
export async function readClipboard() {
  try { return await navigator.clipboard.readText(); } catch { return null; }
}
