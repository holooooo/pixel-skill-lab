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

// 人工输入会话（蓄力/连打/QTE）行为测试：模拟按键事件，返回失败描述列表
export function inputTests(lib = presetLibrary()) {
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  const mk = () => {
    const b = new Battle(lib); b.humanInput = true;
    const hero = b.addUnit(lib.hero, 0, -4, 0);
    const dummy = b.addUnit(ENEMY_TEMPLATES.dummy, 1, 2, 0);
    hero.base.critChance = 0; dummy.base.dodge = 0; // 去掉随机暴击/闪避，让伤害对比稳定
    hero.target = dummy; b.input.point = { x: 2, z: 0 };
    return { b, hero, dummy };
  };
  const run = (b, sec) => { for (let i = 0; i < sec * 60; i++) b.update(1 / 60); };
  const dmg = (b) => b.meter.total;
  // hold：蓄力越久伤害越高；蓄力不足(minRatio)走 else
  const holdDmg = (sec) => { const { b, hero } = mk(); b.tryCast(hero, 'chargeFireball', { key: 'k1' }); run(b, sec); b.inputUp(hero, 'k1'); run(b, 3); return dmg(b); };
  const d1 = holdDmg(0.3), d2 = holdDmg(2);
  ok(d2 > d1 * 1.5, `蓄力火球：满蓄(${d2})应明显高于轻蓄(${d1})`);
  { const { b, hero } = mk(); b.tryCast(hero, 'chargeFireball', { key: 'k1' }); run(b, 0.5); ok(b.hasInput(hero), '蓄力期间应处于输入会话');
    ok(b.inputDown(hero, 'k1', true) === true, '长按重复事件应被吞掉'); b.inputUp(hero, 'k1'); ok(!b.hasInput(hero), '松手后会话结束'); ok(!hero.casting, '松手后应解除施法定身'); }
  { const { b, hero } = mk(); b.tryCast(hero, 'chargeBow', { key: 'k2' }); run(b, 0.3); b.inputUp(hero, 'k2'); run(b, 1.5);
    ok(b.log.length >= 0 && dmg(b) > 0 && dmg(b) < 80, `蓄力不足应只射出弱箭(${dmg(b)})`); }
  // 增幅光束：按住期间变粗，松手即停
  { const { b, hero } = mk(); b.tryCast(hero, 'chargeBeam', { key: 'k3' }); run(b, 0.2); const w0 = b.lasers[0]?.width;
    run(b, 1.8); const w1 = b.lasers[0]?.width; ok(w0 > 0 && w1 > w0 * 2, `光束应随按住变粗(${w0}→${w1})`);
    b.inputUp(hero, 'k3'); run(b, 0.1); ok(b.lasers.length === 0, '松手后光束应消失'); }
  // mash：敲满成功，不足失败；每次敲击触发 onPress
  const mash = (n) => { const { b, hero } = mk(); b.tryCast(hero, 'mashFist', { key: 'k4' }); for (let i = 0; i < n; i++) { run(b, 0.1); b.inputDown(hero, 'k4'); } run(b, 3); return { d: dmg(b), over: !b.hasInput(hero) }; };
  const full = mash(10), part = mash(3);
  ok(full.over && part.over, '连打结束后会话应关闭');
  ok(full.d > part.d * 1.8, `敲满(${full.d})应明显高于没敲满(${part.d})`);
  // qte：按对成功；按错、超时失败
  const qte = (act) => { const { b, hero } = mk(); b.tryCast(hero, 'qteExecute', { key: 'k5' }); const s = b.inputs[0]; run(b, 0.2); act(b, hero, s); run(b, 2); return { d: dmg(b), s }; };
  const good = qte((b, h, s) => b.inputDown(h, 'k' + s.key)), bad = qte((b, h) => b.inputDown(h, b.inputs[0].key === 'q' ? 'ke' : 'kq')), late = qte(() => {});
  ok(good.s.success === true && good.d > bad.d, `QTE 按对应更高(${good.d} vs ${bad.d})`);
  ok(bad.s.success === false && late.s.success === false, 'QTE 按错/超时应失败');
  // 打断：眩晕取消会话且不结算
  { const { b, hero } = mk(); b.tryCast(hero, 'chargeFireball', { key: 'k1' }); run(b, 0.5); b.applyBuff(null, hero, 'stun', 1); run(b, 1); ok(!b.hasInput(hero) && dmg(b) === 0, '眩晕应取消蓄力且不发射'); }
  return fails;
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
  const fails = inputTests(lib);
  for (const f of fails) console.log('✗ input: ' + f);
  console.log(`input tests: ${fails.length ? fails.length + ' failed' : 'ok'}`);
  console.log(`errors: ${errors.length}`);
  if (fails.length) process.exit(1);
  for (const e of errors.slice(0, 8)) console.log(e);
  process.exit(errors.length ? 1 : 0);
}
