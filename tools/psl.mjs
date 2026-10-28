#!/usr/bin/env node
// psl — Pixel Skill Lab 命令行：让 Agent 读取 schema、编写/校验/打包技能，并生成可一键导入的数据
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ACTIONS, defaultParams, TARGETS, CENTERS, AIMS, MOTIONS, SUMMON_MODES, FX_STYLES } from '../js/engine/actions.js';
import { TRIGGERS, CONDITIONS, SCALE_STATS, DMG_TYPES, MOD_KEYS, VFX_TYPES, STAT_DEFS, SOURCE_KINDS, uid } from '../js/engine/model.js';
import { abilityDuration } from '../js/engine/battle.js';
import { presetLibrary, simulate } from './selftest.mjs';

const FORMAT = 'pixel-skill-lab';
const REF_KEYS = ['ability', 'then', 'else', 'onHit', 'onExpire', 'timerAbility', 'deathAbility'];
const SITE = process.env.PSL_SITE || 'https://pixel-skill-lab.pages.dev';
const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; (flags[k] ??= []).push(v); }
  else if (a === '-o') flags.out = [argv[++i]];
  else pos.push(a);
}
const flag = (k, d) => flags[k]?.[0] ?? d;
const out = (s) => process.stdout.write(typeof s === 'string' ? s + '\n' : JSON.stringify(s, null, 2) + '\n');
const die = (m) => { process.stderr.write('psl: ' + m + '\n'); process.exit(1); };

function readPack(file) {
  if (!file || !existsSync(file)) return { format: FORMAT, version: 1, abilities: [], buffs: {} };
  const d = JSON.parse(readFileSync(file, 'utf8'));
  if (d.kind && d.timeline) return { format: FORMAT, version: 1, abilities: [d], buffs: {} };
  d.abilities ||= []; d.buffs ||= {}; d.format ||= FORMAT; d.version ||= 1;
  return d;
}
function writePack(file, d) { writeFileSync(file, JSON.stringify(d, null, 2) + '\n'); }
function merged(pack) {
  const lib = presetLibrary();
  for (const a of pack.abilities) lib.abilities[a.id] = a;
  Object.assign(lib.buffs, pack.buffs);
  return lib;
}
function parseVal(v) { if (v === true) return true; try { return JSON.parse(v); } catch { return v; } }

// ---------------- schema ----------------
function schema() {
  return {
    format: FORMAT, version: 1,
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, {
      label: a.label, category: a.cat, hasDuration: !!a.dur,
      params: a.params.map(p => ({ key: p.key, label: p.label, type: p.type, default: p.def, ...(p.options ? { options: Object.keys(p.options) } : {}), ...(p.min !== undefined ? { min: p.min, max: p.max } : {}), ...(p.group ? { group: p.group } : {}) })),
    }])),
    enums: { targets: TARGETS, centers: CENTERS, aims: AIMS, motions: MOTIONS, summonModes: SUMMON_MODES, fxStyles: FX_STYLES, damageTypes: DMG_TYPES, sourceKinds: SOURCE_KINDS },
    triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([k, t]) => [k, { label: t.label, subject: t.subject, other: t.other, extra: [t.buffFilter && 'buff', t.pct && 'pct', t.every && 'every', t.radius && 'radius', k === 'onCast' && 'ability'].filter(Boolean) }])),
    conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, c]) => [k, c.label])),
    formula: { shape: '{ base:number, type:"physical"|"magic"|"true", canCrit:boolean, rows:[{ src:"caster"|"target", stat, ratio, buff? }] }', stats: SCALE_STATS },
    buffMods: MOD_KEYS, buffVfx: { shape: 'buff.vfx = [{ type, color?: "#hex" (default buff.color), intensity?: number=1, speed?: number=1 }]', types: VFX_TYPES }, heroStats: STAT_DEFS.map(s => s.key),
    buffs: Object.keys(presetLibrary().buffs),
  };
}

// ---------------- validate ----------------
function validate(pack) {
  const lib = merged(pack);
  const issues = [];
  const err = (where, msg) => issues.push({ level: 'error', where, msg });
  const warn = (where, msg) => issues.push({ level: 'warn', where, msg });
  const checkFormula = (where, f) => {
    if (!f || typeof f !== 'object') return err(where, 'formula 必须是对象');
    if (typeof f.base !== 'number') err(where, 'formula.base 必须是数字');
    if (f.type && !DMG_TYPES[f.type]) err(where, `未知伤害类型 ${f.type}`);
    for (const r of f.rows || []) {
      if (!SCALE_STATS[r.stat]) err(where, `未知属性 ${r.stat}`);
      if (r.src && !['caster', 'target'].includes(r.src)) err(where, `src 只能是 caster/target`);
      if (typeof r.ratio !== 'number') err(where, 'ratio 必须是数字');
      if ((r.stat === 'buffStacks' || r.stat === 'buffRemain') && !lib.buffs[r.buff]) err(where, `${r.stat} 引用了不存在的 Buff ${r.buff}`);
    }
  };
  for (const [id, b] of Object.entries(pack.buffs)) {
    const w = `buff:${id}`;
    if (b.id !== id) warn(w, 'buff.id 与键名不一致');
    for (const k of ['name', 'duration', 'maxStacks']) if (b[k] === undefined) err(w, `缺少 ${k}`);
    for (const k of Object.keys(b.mods || {})) if (!MOD_KEYS[k]) warn(w, `未知属性修正 ${k}`);
    if (b.tickInterval > 0) checkFormula(w + '.tick', b.tick);
    if (b.vfx !== undefined && !Array.isArray(b.vfx)) err(w, 'vfx 必须是数组');
    for (const e of Array.isArray(b.vfx) ? b.vfx : []) {
      if (!VFX_TYPES[e?.type]) err(w, `未知着色特效 ${e?.type}（可选 ${Object.keys(VFX_TYPES).join('/')}）`);
      if (e?.color !== undefined && !/^#[0-9a-f]{3,8}$/i.test(e.color)) err(w, `vfx.color 必须是 #hex`);
      for (const k of ['intensity', 'speed']) if (e?.[k] !== undefined && typeof e[k] !== 'number') err(w, `vfx.${k} 必须是数字`);
    }
  }
  for (const a of pack.abilities) {
    const w = `ability:${a.id}`;
    if (!a.id || !/^[\w-]+$/.test(a.id)) err(w, 'id 只能包含字母数字下划线');
    if (!['active', 'passive'].includes(a.kind)) err(w, 'kind 必须是 active/passive');
    if (!a.name) err(w, '缺少 name');
    if (!Array.isArray(a.timeline)) { err(w, 'timeline 必须是数组'); continue; }
    if (a.kind === 'passive') {
      if (!TRIGGERS[a.trigger?.event]) err(w, `未知触发事件 ${a.trigger?.event}`);
      if (a.trigger?.buff && !lib.buffs[a.trigger.buff]) err(w, `trigger.buff 不存在 ${a.trigger.buff}`);
      for (const c of a.conditions || []) {
        if (!CONDITIONS[c.type]) err(w, `未知条件 ${c.type}`);
        if ((c.type === 'hasBuff' || c.type === 'noBuff') && !lib.buffs[c.buff]) err(w, `条件引用了不存在的 Buff ${c.buff}`);
      }
    } else {
      for (const k of ['cooldown', 'manaCost']) if (typeof a[k] !== 'number') warn(w, `${k} 应为数字`);
      if (a.targeting && !['unit', 'point', 'self'].includes(a.targeting)) err(w, 'targeting 必须是 unit/point/self');
    }
    if (!a.timeline.length) warn(w, '时间轴为空');
    a.timeline.forEach((b, i) => {
      const bw = `${w}.timeline[${i}](${b.type})`;
      const def = ACTIONS[b.type];
      if (!def) return err(bw, `未知动作类型 ${b.type}`);
      if (typeof b.t !== 'number' || b.t < 0) err(bw, 't 必须是 ≥0 的数字');
      const known = new Set(def.params.map(p => p.key));
      for (const k of Object.keys(b.p || {})) if (!known.has(k)) warn(bw, `未知参数 ${k}（会被忽略）`);
      for (const pd of def.params) {
        const v = b.p?.[pd.key];
        if (v === undefined) continue;
        if (pd.type === 'select' && !(v in pd.options)) err(bw, `${pd.key}=${v} 不是可选值：${Object.keys(pd.options).join('/')}`);
        if (pd.type === 'number' && typeof v !== 'number' && typeof v !== 'boolean') err(bw, `${pd.key} 必须是数字`);
        if (pd.type === 'number' && typeof v === 'number' && (v < pd.min || v > pd.max)) warn(bw, `${pd.key}=${v} 超出编辑器范围 [${pd.min}, ${pd.max}]`);
        if (pd.type === 'buff' && v && !lib.buffs[v]) err(bw, `${pd.key} 引用了不存在的 Buff ${v}`);
        if (pd.type === 'ability' && v && v !== '*' && !lib.abilities[v]) err(bw, `${pd.key} 引用了不存在的技能 ${v}`);
        if (pd.type === 'formula') checkFormula(`${bw}.${pd.key}`, v);
      }
    });
  }
  // 引用环检测（自引用合法但受 8 层深度限制，提示一下）
  for (const a of pack.abilities) for (const b of a.timeline || []) for (const k of REF_KEYS) if (b.p?.[k] === a.id) warn(`ability:${a.id}`, `${b.type}.${k} 引用了自身：会递归到深度上限 8 层`);
  return issues;
}

// ---------------- pack / deps ----------------
function deps(lib, ids) {
  const abil = new Set(), buffs = new Set(), q = [...ids];
  while (q.length) {
    const id = q.pop(); const a = lib.abilities[id];
    if (!a || abil.has(id)) continue; abil.add(id);
    const scan = (v) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(scan);
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string') { if (k === 'buff' && lib.buffs[x]) buffs.add(x); if (REF_KEYS.includes(k) && lib.abilities[x]) q.push(x); }
        else scan(x);
      }
    };
    scan(a.timeline); scan(a.trigger); scan(a.conditions);
  }
  return { abilities: [...abil].map(id => lib.abilities[id]), buffs: Object.fromEntries([...buffs].map(id => [id, lib.buffs[id]])) };
}

// ---------------- commands ----------------
const HELP = `psl — Pixel Skill Lab CLI

  psl schema [--json] [action]          动作/触发器/条件/公式 schema（Agent 先读这个）
  psl list [--file pack.json] [--kind active|passive]
  psl show <id> [--file pack.json]      打印技能 JSON（预设或包内）
  psl new <active|passive> <id> --file pack.json [--name 名称] [--event onHit] [--from presetId]
  psl add-block <abilityId> <type> --file pack.json [--t 0.2] [--track 0] [--set key=jsonValue ...]
  psl set <abilityId> key=jsonValue ... --file pack.json   修改技能字段（如 cooldown=3 trigger.event=\"onCrit\"）
  psl buff <id> --file pack.json [--set key=jsonValue ...]  新建/修改 Buff
  psl validate <pack.json> [--sim]      校验 schema、引用；--sim 无头模拟并报告伤害
  psl pack <pack.json|presetId...> [-o out.json]  生成可导入数据（自动带上依赖的 Buff/子技能）
  psl link <pack.json>                  生成一键导入链接（打开即弹出导入框）
`;

const cmd = pos.shift();
switch (cmd) {
  case 'schema': {
    const s = schema();
    if (pos[0]) { const a = s.actions[pos[0]]; if (!a) die(`未知动作 ${pos[0]}`); out(a); break; }
    if (flag('json')) { out(s); break; }
    out('# Actions');
    for (const [k, a] of Object.entries(s.actions)) out(`- ${k} (${a.label}, ${a.category}): ` + a.params.map(p => `${p.key}:${p.type}${p.options ? `[${p.options.join('|')}]` : ''}=${JSON.stringify(p.default)}`).join(', '));
    out('\n# Triggers'); for (const [k, t] of Object.entries(s.triggers)) out(`- ${k}: ${t.label}${t.extra.length ? ` (trigger.${t.extra.join(', trigger.')})` : ''}`);
    out('\n# Conditions'); out(Object.entries(s.conditions).map(([k, v]) => `${k}(${v})`).join(', '));
    out('\n# Enums'); for (const [k, v] of Object.entries(s.enums)) out(`- ${k}: ${Object.keys(v).join(' | ')}`);
    out(`\n# Formula\n${s.formula.shape}\nstats: ${Object.keys(s.formula.stats).join(', ')}`);
    out(`\n# Preset buffs\n${s.buffs.join(', ')}`);
    out(`\n# Buff mods\n${Object.keys(s.buffMods).join(', ')}`);
    break;
  }
  case 'list': {
    const pack = readPack(flag('file'));
    const lib = flag('file') ? { abilities: Object.fromEntries(pack.abilities.map(a => [a.id, a])) } : presetLibrary();
    for (const a of Object.values(lib.abilities)) {
      if (flag('kind') && a.kind !== flag('kind')) continue;
      out(`${a.id.padEnd(18)} ${a.kind.padEnd(8)} ${a.name}${a.sub ? ' (sub)' : ''} — ${a.timeline.length} blocks, ${abilityDuration(a).toFixed(2)}s${a.kind === 'passive' ? `, WHEN ${a.trigger?.event}` : ''}`);
    }
    break;
  }
  case 'show': {
    const lib = merged(readPack(flag('file')));
    const a = lib.abilities[pos[0]] || die(`没有技能 ${pos[0]}`);
    out(a); break;
  }
  case 'new': {
    const [kind, id] = pos; const file = flag('file') || die('--file 必填');
    if (!['active', 'passive'].includes(kind) || !id) die('用法: psl new <active|passive> <id> --file pack.json');
    const pack = readPack(file);
    if (pack.abilities.some(a => a.id === id)) die(`包内已存在 ${id}`);
    let a;
    if (flag('from')) { a = structuredClone(presetLibrary().abilities[flag('from')] || die(`没有预设 ${flag('from')}`)); a.id = id; a.timeline.forEach(b => b.id = uid()); }
    else a = kind === 'active'
      ? { id, kind, name: flag('name', id), icon: flag('icon', '新'), color: flag('color', '#ff9fdc'), desc: flag('desc', ''), cooldown: 3, manaCost: 20, range: 12, targeting: 'point', root: false, timeline: [] }
      : { id, kind, name: flag('name', id), icon: flag('icon', '被'), color: flag('color', '#ffcf6e'), desc: flag('desc', ''), icd: 0, conditions: [], trigger: { event: flag('event', 'onHit'), kind: 'any', ignoreProc: true }, timeline: [] };
    if (flag('name')) a.name = flag('name');
    pack.abilities.push(a); writePack(file, pack); out(`created ${kind} ${id} in ${file}`); break;
  }
  case 'add-block': {
    const [aid, type] = pos; const file = flag('file') || die('--file 必填');
    const pack = readPack(file); const a = pack.abilities.find(x => x.id === aid) || die(`包内没有 ${aid}`);
    if (!ACTIONS[type]) die(`未知动作 ${type}；可用：${Object.keys(ACTIONS).join(', ')}`);
    const b = { id: uid(), type, t: Number(flag('t', 0)), track: Number(flag('track', a.timeline.length % 4)), p: defaultParams(type) };
    for (const kv of flags.set || []) { const i = kv.indexOf('='); setPath(b.p, kv.slice(0, i), parseVal(kv.slice(i + 1))); }
    a.timeline.push(b); writePack(file, pack); out(`added ${type} @${b.t}s to ${aid} (block ${b.id})`); break;
  }
  case 'set': {
    const aid = pos.shift(); const file = flag('file') || die('--file 必填');
    const pack = readPack(file); const a = pack.abilities.find(x => x.id === aid) || die(`包内没有 ${aid}`);
    for (const kv of pos) { const i = kv.indexOf('='); setPath(a, kv.slice(0, i), parseVal(kv.slice(i + 1))); }
    writePack(file, pack); out(`updated ${aid}`); break;
  }
  case 'buff': {
    const id = pos[0]; const file = flag('file') || die('--file 必填');
    const pack = readPack(file);
    const b = pack.buffs[id] ||= { ...(presetLibrary().buffs[id] || { id, name: id, icon: '新', color: '#ff9fdc', debuff: true, duration: 4, maxStacks: 3, tickInterval: 0, tick: null, mods: {}, flags: {} }) };
    for (const kv of flags.set || []) { const i = kv.indexOf('='); setPath(b, kv.slice(0, i), parseVal(kv.slice(i + 1))); }
    b.id = id; writePack(file, pack); out(`buff ${id} saved`); break;
  }
  case 'validate': {
    const file = pos[0] || die('用法: psl validate pack.json'); const pack = readPack(file);
    const issues = validate(pack);
    for (const i of issues) out(`${i.level === 'error' ? '✗' : '!'} ${i.where}: ${i.msg}`);
    const nerr = issues.filter(i => i.level === 'error').length;
    if (flag('sim') && !nerr) {
      const { results, errors } = simulate(merged(pack), pack.abilities.map(a => a.id));
      for (const r of results) out(`${r.ok ? '✓' : '✗'} sim ${r.id}: ${r.damage} dmg / ${r.heal} heal in 10s vs 4 dummies + 1 slime`);
      for (const e of errors.slice(0, 5)) out('runtime: ' + e);
      if (errors.length) process.exit(1);
    }
    out(nerr ? `${nerr} error(s)` : 'OK'); process.exit(nerr ? 1 : 0);
  }
  case 'pack': {
    let lib = presetLibrary(), ids = [];
    for (const p of pos) {
      if (existsSync(p)) { const pk = readPack(p); for (const a of pk.abilities) { lib.abilities[a.id] = a; ids.push(a.id); } Object.assign(lib.buffs, pk.buffs); }
      else if (lib.abilities[p]) ids.push(p); else die(`既不是文件也不是预设: ${p}`);
    }
    const d = deps(lib, ids);
    const res = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), root: ids, ...d };
    if (flag('out')) { writePack(flag('out'), res); out(`wrote ${flag('out')} (${d.abilities.length} abilities, ${Object.keys(d.buffs).length} buffs)`); } else out(res);
    break;
  }
  case 'link': {
    const pack = readPack(pos[0] || die('用法: psl link pack.json'));
    const lib = merged(pack); const d = deps(lib, pack.abilities.map(a => a.id));
    const json = JSON.stringify({ format: FORMAT, version: 1, root: pack.abilities.map(a => a.id), ...d });
    out(`${SITE}/#import=${Buffer.from(json, 'utf8').toString('base64url')}`); break;
  }
  default: out(HELP);
}

function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks.at(-1)] = val;
}
