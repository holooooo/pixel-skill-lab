// 无头自测：逐个施放全部预设技能/触发被动，检查运行时错误与伤害输出
//   node tools/selftest.mjs [library.json]
import { readFileSync } from 'node:fs';
import { Battle } from '../js/engine/battle.js';
import { PRESET_ABILITIES, ENEMY_ABILITIES, PRESET_BUFFS, HERO_TEMPLATE, ENEMY_TEMPLATES } from '../js/data/presets.js';

export function simulate(lib, ids, { seconds = 10 } = {}) {
  const errors = [], results = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.map(x => x?.stack || String(x)).join(' '));
  for (const id of ids) {
    const a = lib.abilities[id];
    if (!a || a.enemy) continue;
    const b = new Battle(lib);
    const hero = b.addUnit(lib.hero, 0, -4, 0);
    hero.loadout = { skills: [], passives: a.kind === 'passive' ? [a.id] : [] };
    for (const [x, z] of [[2, -2], [3, 0], [2, 2], [5, 1]]) b.addUnit(ENEMY_TEMPLATES.dummy, 1, x, z);
    b.addUnit(ENEMY_TEMPLATES.slime, 1, 0, 3);
    b.input.point = { x: 3, z: 0 };
    hero.target = b.units[1];
    const errBefore = errors.length;
    try {
      if (a.kind === 'active') b.tryCast(hero, a.id, { free: true });
      for (let i = 0; i < seconds * 60; i++) {
        if (a.kind === 'passive' && i % 60 === 0) b.firePassive(hero, a, hero.target, { source: hero, target: hero.target, amount: 100, depth: 0, kind: 'skill' });
        b.update(1 / 60);
      }
    } catch (e) { errors.push(`${a.id}: ${e.stack}`); }
    results.push({ id: a.id, name: a.name, kind: a.kind, damage: Math.round(b.meter.total), heal: Math.round(b.meter.heal), units: b.units.length, ok: errors.length === errBefore });
  }
  console.error = origErr;
  return { results, errors };
}

export function presetLibrary() {
  const lib = { abilities: {}, buffs: structuredClone(PRESET_BUFFS), hero: structuredClone(HERO_TEMPLATE) };
  for (const a of [...PRESET_ABILITIES, ...ENEMY_ABILITIES]) lib.abilities[a.id] = structuredClone(a);
  return lib;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lib = presetLibrary();
  if (process.argv[2]) {
    const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    for (const a of d.abilities || []) lib.abilities[a.id] = a;
    Object.assign(lib.buffs, d.buffs || {});
  }
  const { results, errors } = simulate(lib, Object.keys(lib.abilities));
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id.padEnd(16)} ${r.kind.padEnd(8)} dmg ${String(r.damage).padStart(7)}  heal ${String(r.heal).padStart(5)}  units ${r.units}`);
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(e);
  process.exit(errors.length ? 1 : 0);
}
