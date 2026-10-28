// 战斗模拟核心：单位、属性、Buff、伤害结算、事件总线与触发器
import { ACTIONS, blockDur } from './actions.js';
import { evalFormula, TRIGGERS } from './model.js';

const NOOP = new Proxy({}, { get: () => () => {} });
const MAX_DEPTH = 8;
const STYLE_TINT = { fire: '#ffb08a', frost: '#bff4ff', arcane: '#e6c2ff', holy: '#fff2b0', shadow: '#c9a8ff', poison: '#c8ff9a', blood: '#ff9aa8', storm: '#b8d4ff' };
let NEXT_ID = 1;

export function abilityDuration(a) {
  let d = 0;
  for (const b of a.timeline || []) d = Math.max(d, b.t + blockDur(b));
  return d;
}

export class Battle {
  constructor(lib) {
    this.lib = lib; // { abilities, buffs }
    this.units = []; this.lasers = []; this.orbits = []; this.projectiles = []; this.zones = []; this.beams = []; this.timers = [];
    this.time = 0; this.fx = NOOP; this.hitstopT = 0; this.paused = false;
    this.bounds = { x: 13, z: 8.5 };
    this.input = { mx: 0, mz: 0, point: { x: 0, z: 0 } };
    this.settings = { enemyAggro: true, respawn: true, godMode: false };
    this.log = []; this.runs = [];
    this.resetMeter();
  }

  resetMeter() { this.meter = { start: this.time, total: 0, heal: 0, by: {}, recent: [] }; }

  // ---------- 单位 ----------
  addUnit(tpl, team, x, z) {
    const u = {
      id: NEXT_ID++, tpl, name: tpl.name, team, model: tpl.model, ai: tpl.ai || 'none',
      base: { ...tpl.stats }, hp: tpl.stats.maxHp, mana: tpl.stats.maxMana || 0,
      x, z, sx: x, sz: z, facing: 1, buffs: [], shields: [], cd: {}, icd: {}, intervalT: {},
      loadout: tpl.loadout ? structuredClone(tpl.loadout) : { skills: [], passives: [] },
      casting: null, alive: true, radius: tpl.radius || 0.6, atkTimer: 0, aiT: Math.random() * 2,
      target: null, dash: null, knockV: null, moving: false, anim: 0, hurtT: 0, attackT: 0, scale: tpl.scale || 1,
    };
    this.units.push(u);
    return u;
  }
  get hero() { return this.units.find(u => u.team === 0 && u.ai === 'player'); }
  enemiesOf(u) { return this.units.filter(o => o.alive && o.team !== u.team); }
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  nearestEnemy(u, maxR = Infinity) {
    let best = null, bd = maxR;
    for (const o of this.enemiesOf(u)) { const d = this.dist(u, o); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  enemiesInRadius(u, x, z, r) {
    return this.enemiesOf(u).filter(o => Math.hypot(o.x - x, o.z - z) <= r + o.radius * 0.6);
  }

  // ---------- 属性 ----------
  stat(u, key) {
    let base = u.base[key] || 0, flat = 0, pct = 0;
    for (const b of u.buffs) {
      const m = b.def.mods || {};
      if (m[key]) flat += m[key] * b.stacks;
      if (m[key + 'Pct']) pct += m[key + 'Pct'] * b.stacks;
    }
    const v = (base + flat) * (1 + pct);
    if (key === 'moveSpeed' || key === 'atkSpeed') return Math.max(0, v);
    if (key === 'cdr') return Math.min(0.8, v);
    return v;
  }
  hasFlag(u, f) { return u.buffs.some(b => b.def.flags?.[f]); }
  buffStacks(u, id) { return u?.buffs.find(b => b.id === id)?.stacks || 0; }
  shieldOf(u) { return u.shields.reduce((s, x) => s + x.amount, 0); }

  // ---------- 调度 ----------
  schedule(delay, fn, ctx) {
    if (delay <= 0) { if (!ctx || ctx.caster.alive) fn(); return; }
    this.timers.push({ at: this.time + delay, fn, ctx });
  }
  hitstop(s) { this.hitstopT = Math.max(this.hitstopT, s); }
  addLog(text, color = '#ccc') {
    this.log.push({ t: this.time, text, color });
    if (this.log.length > 120) this.log.shift();
  }

  // ---------- 技能释放 ----------
  canCast(u, id) {
    const a = this.lib.abilities[id];
    if (!a || !u.alive) return '无效';
    if (this.hasFlag(u, 'stun')) return '眩晕中';
    if (this.hasFlag(u, 'silence')) return '沉默中';
    if (u.casting && u.casting.root && this.time < u.casting.end) return '施法中';
    if ((u.cd[id] || 0) > this.time) return '冷却中';
    if ((a.manaCost || 0) > u.mana) return '法力不足';
    return null;
  }
  tryCast(u, id, opts = {}) {
    const why = opts.free ? (u.alive ? null : '已阵亡') : this.canCast(u, id);
    const a = this.lib.abilities[id];
    if (why) { if (u.ai === 'player') this.fx.text(u, why, '#ff6b6b'); return false; }
    let target = opts.target && opts.target.alive ? opts.target : (u.target?.alive ? u.target : this.nearestEnemy(u));
    if (!opts.free && a.range && target && a.targeting === 'unit' && this.dist(u, target) > a.range + target.radius) {
      const near = this.nearestEnemy(u, a.range + 1);
      if (near) target = near; else { this.fx.text(u, '超出范围', '#ff6b6b'); return false; }
    }
    if (!opts.free) {
      u.mana -= a.manaCost || 0;
      u.cd[id] = this.time + (a.cooldown || 0) * (1 - this.stat(u, 'cdr'));
    }
    const dur = abilityDuration(a);
    u.casting = { ability: id, start: this.time, end: this.time + dur, root: !!a.root };
    if (target) u.facing = target.x >= u.x ? 1 : -1;
    u.attackT = 0.25;
    const point = opts.point || { ...this.input.point };
    const ctx = { caster: u, target, point, depth: 0, kind: 'skill', ability: id };
    this.fx.cast(u, a);
    this.addLog(`${u.name} 施放 【${a.name}】`, a.color);
    this.emit('onCast', { source: u, target, ability: id, depth: 0, kind: 'skill', amount: a.manaCost || 0 });
    this.runAbility(u, a, ctx);
    return true;
  }
  freeCast(u, id, pctx) {
    const a = this.lib.abilities[id];
    if (!a || (pctx.depth || 0) >= MAX_DEPTH) return;
    this.runAbility(u, a, { ...pctx, depth: (pctx.depth || 0) + 1, ability: id, kind: pctx.kind === 'proc' ? 'proc' : 'skill' });
  }
  runAbility(u, a, ctx) {
    this.runs.push({ ability: a.id, unit: u, start: this.time, end: this.time + abilityDuration(a) + 0.3 });
    if (this.runs.length > 40) this.runs.shift();
    for (const b of [...a.timeline].sort((x, y) => x.t - y.t)) {
      const def = ACTIONS[b.type];
      if (!def) continue;
      this.schedule(b.t, () => {
        try { def.run(this, b.p, ctx); } catch (e) { console.error('action failed', b, e); }
      }, ctx);
    }
  }
  reduceCooldown(u, id, amount) {
    const ids = id === '*' ? u.loadout.skills : [id];
    for (const i of ids) {
      if (!i) continue;
      if (!amount) u.cd[i] = 0; else u.cd[i] = Math.max(0, (u.cd[i] || 0) - amount);
    }
    this.fx.text(u, amount ? `冷却 -${amount}s` : '冷却重置!', '#9dffb0');
  }

  // ---------- 目标解析 ----------
  resolveTargets(sel, ctx) {
    const c = ctx.caster;
    const en = this.enemiesOf(c);
    const al = this.alliesOf(c);
    const from = ctx.origin || c;
    const near = (list) => list.reduce((b, u) => (!b || this.dist(from, u) < this.dist(from, b) ? u : b), null);
    const lowest = (list) => list.reduce((b, u) => (!b || u.hp / this.stat(u, 'maxHp') < b.hp / this.stat(b, 'maxHp') ? u : b), null);
    const one = (u) => u ? [u] : [];
    switch (sel) {
      case 'self': return [c];
      case 'allEnemies': return en;
      case 'nearest': return one(near(en));
      case 'random': return en.length ? [en[Math.floor(Math.random() * en.length)]] : [];
      case 'lowest': return one(lowest(en));
      case 'farthest': return one(en.reduce((b, u) => (!b || this.dist(from, u) > this.dist(from, b) ? u : b), null));
      case 'cursorEnemy': return one(en.reduce((b, u) => (!b || Math.hypot(u.x - ctx.point.x, u.z - ctx.point.z) < Math.hypot(b.x - ctx.point.x, b.z - ctx.point.z) ? u : b), null));
      case 'nearestAlly': return [near(al.filter(u => u !== c)) || c];
      case 'lowestAlly': return one(lowest(al));
      case 'allAllies': return al;
      case 'owner': return [c.summon?.owner?.alive ? c.summon.owner : c];
      default: {
        if (ctx.target && ctx.target.alive && ctx.target !== ctx.exclude) return [ctx.target];
        return one(near(en.filter(u => u !== ctx.exclude)));
      }
    }
  }
  alliesOf(u) { return this.units.filter(o => o.alive && o.team === u.team); }
  resolveCenter(sel, ctx) {
    const c = ctx.caster;
    if (sel === 'self') return { x: c.x, z: c.z };
    if (sel === 'origin') return ctx.origin ? { ...ctx.origin } : { x: c.x, z: c.z };
    if (sel === 'cursor') return this.clampPt(ctx.point);
    if (sel === 'random') {
      const r = this.resolveTargets('random', ctx)[0];
      if (r) return this.clampPt({ x: r.x + (Math.random() - 0.5) * 2, z: r.z + (Math.random() - 0.5) * 2 });
    }
    const t = this.resolveTargets('target', ctx)[0];
    return t ? { x: t.x, z: t.z } : { x: c.x, z: c.z };
  }
  clampPt(p) {
    return { x: Math.max(-this.bounds.x, Math.min(this.bounds.x, p.x)), z: Math.max(-this.bounds.z, Math.min(this.bounds.z, p.z)) };
  }

  // ---------- 伤害 / 治疗 / 护盾 ----------
  dealDamage(src, tgt, raw, opts = {}) {
    if (!tgt || !tgt.alive || !(raw > 0)) return 0;
    const ctx = opts.ctx || {};
    const kind = opts.kind || ctx.kind || 'skill';
    const depth = ctx.depth || 0;
    if (kind === 'attack' && Math.random() < this.stat(tgt, 'dodge')) {
      this.fx.text(tgt, 'MISS', '#b3f0ff');
      this.emit('onDodge', { source: src, target: tgt, amount: raw, kind, depth });
      return 0;
    }
    let amt = raw, crit = false;
    if (opts.canCrit && src && Math.random() < this.stat(src, 'critChance')) { crit = true; amt *= Math.max(1, this.stat(src, 'critDmg')); }
    if (src) amt *= 1 + this.stat(src, 'dmgDealtPct');
    amt *= Math.max(0, 1 + this.stat(tgt, 'dmgTakenPct'));
    const type = opts.type || 'physical';
    if (type !== 'true') {
      const def = Math.max(-60, this.stat(tgt, type === 'magic' ? 'res' : 'armor'));
      amt *= 100 / (100 + def);
    }
    amt = Math.max(1, Math.round(amt));
    // 护盾吸收
    let left = amt, absorbed = 0, broke = false;
    for (const s of tgt.shields) {
      if (left <= 0) break;
      const a = Math.min(s.amount, left); s.amount -= a; left -= a; absorbed += a;
      if (s.amount <= 0) broke = true;
    }
    tgt.shields = tgt.shields.filter(s => s.amount > 0);
    const prevPct = tgt.hp / this.stat(tgt, 'maxHp');
    if (!(this.settings.godMode && tgt.team === 0)) tgt.hp -= left;
    else tgt.hp = Math.max(1, tgt.hp - left);
    if (tgt.tpl.immortal) tgt.hp = Math.max(1, tgt.hp);
    tgt.hurtT = kind === 'dot' ? 0.04 : 0.18; // 持续伤害只做极短受击闪白，否则会盖住 Buff 着色特效
    const label = opts.label || (ctx.ability ? this.lib.abilities[ctx.ability]?.name : kind === 'attack' ? '普攻' : '其他');
    this.fx.number(tgt, amt, { crit, type, absorbed, kind });
    if (crit) { this.fx.shake(0.15); this.hitstop(0.04); }
    if (src && src.team === 0) {
      const m = this.meter;
      m.total += amt; m.by[label] = (m.by[label] || 0) + amt; m.recent.push({ t: this.time, a: amt });
    }
    if (src && kind !== 'dot' && src.alive) {
      const ls = this.stat(src, 'lifesteal');
      if (ls > 0) this.heal(src, src, amt * ls, true);
    }
    const payload = { source: src, target: tgt, amount: amt, crit, kind, depth, ability: ctx.ability, prevPct };
    if (src) this.emit('onHit', payload);
    if (crit && src) this.emit('onCrit', payload);
    this.emit('onDamaged', payload);
    if (broke) this.emit('onShieldBreak', payload);
    this.checkHp(tgt, prevPct, payload);
    if (tgt.hp <= 0 && tgt.alive) this.kill(tgt, src, payload);
    return amt;
  }
  loseHp(u, amt) {
    amt = Math.round(Math.min(amt, u.hp - 1));
    if (amt <= 0) return;
    const prevPct = u.hp / this.stat(u, 'maxHp');
    u.hp -= amt; u.hurtT = 0.15;
    this.fx.number(u, amt, { type: 'self' });
    this.checkHp(u, prevPct, { source: u, target: u, amount: amt, depth: 0, kind: 'proc' });
  }
  checkHp(u, prevPct, payload) {
    const now = u.hp / this.stat(u, 'maxHp');
    if (now < prevPct) this.emit('onLowHp', { ...payload, target: u, prevPct, newPct: now });
  }
  heal(src, tgt, amt, silent = false, ctx = null) {
    if (!tgt.alive || amt <= 0) return;
    amt *= Math.max(0, 1 + this.stat(tgt, 'healTakenPct'));
    const max = this.stat(tgt, 'maxHp');
    const real = Math.min(max - tgt.hp, amt);
    tgt.hp += real;
    if (src?.team === 0) this.meter.heal += real;
    if (!silent || amt > 30) this.fx.number(tgt, Math.round(amt), { heal: true });
    if (!silent) {
      this.fx.heal(tgt);
      this.emit('onHeal', { source: src, target: tgt, amount: amt, depth: ctx?.depth || 0, kind: ctx?.kind || 'skill' });
    }
  }
  addShield(src, tgt, amt, dur) {
    if (!tgt.alive || amt <= 0) return;
    tgt.shields.push({ amount: Math.round(amt), max: Math.round(amt), t: dur });
    this.fx.number(tgt, Math.round(amt), { shield: true });
    this.fx.shieldUp(tgt);
  }
  kill(u, src, payload) {
    u.alive = false; u.hp = 0; u.buffs = []; u.shields = []; u.casting = null; u.dash = null;
    this.fx.death(u);
    this.addLog(`${u.name} 被击败`, '#ff6b6b');
    if (src) this.emit('onKill', { ...payload, source: src, target: u });
    this.emit('onEnemyDeath', { ...payload, source: src, target: u, depth: payload?.depth || 0 });
    if (u.summon) { this.units = this.units.filter(x => x !== u); return; }
    const wait = u.team === 0 ? 3 : 2.5;
    if (u.team === 0 || this.settings.respawn) {
      this.timers.push({ at: this.time + wait, fn: () => this.respawn(u) });
    } else {
      this.timers.push({ at: this.time + 1.5, fn: () => { this.units = this.units.filter(x => x !== u); } });
    }
  }
  respawn(u) {
    if (!this.units.includes(u)) return;
    u.alive = true; u.hp = this.stat(u, 'maxHp'); u.mana = u.base.maxMana || 0;
    if (u.team !== 0) { u.x = u.sx + (Math.random() - 0.5) * 2; u.z = u.sz + (Math.random() - 0.5) * 2; }
    u.cd = u.team === 0 ? u.cd : {};
    this.fx.spawn(u);
    this.emit('onSpawn', { source: u, target: u, depth: 0, kind: 'skill', amount: 0 });
  }

  // ---------- 召唤 / 环绕 ----------
  summon(c, p, ctx) {
    const depth = (ctx.depth || 0) + 1;
    if (depth >= MAX_DEPTH) return;
    const n = Math.max(1, p.count || 1);
    const mode = p.mode || 'totem';
    for (let i = 0; i < n; i++) {
      const base = this.clampPt(this.resolveCenter(p.center, ctx));
      const a = i / n * Math.PI * 2;
      const at = n > 1 ? this.clampPt({ x: base.x + Math.cos(a) * 1.2, z: base.z + Math.sin(a) * 1.2 }) : base;
      const st = {};
      for (const k of Object.keys(c.base)) st[k] = c.base[k];
      st.maxHp = Math.round(this.stat(c, 'maxHp') * p.hpRatio);
      st.atk = Math.round(this.stat(c, 'atk') * p.inherit);
      st.maxMana = 0; st.hpRegen = 0; st.lifesteal = 0;
      st.moveSpeed = mode === 'totem' ? 0 : Math.max(3, this.stat(c, 'moveSpeed') * 0.9);
      st.atkSpeed = 1;
      const model = p.model && p.model !== 'auto' ? p.model : (mode === 'totem' ? 'totem' : mode === 'drone' ? 'drone' : 'slime');
      const tpl = { name: { totem: '图腾', drone: '浮游炮', minion: '仆从' }[mode], model, ai: 'summon', stats: st,
        radius: mode === 'drone' ? 0.3 : 0.45, unmovable: mode === 'totem', scale: mode === 'drone' ? 0.6 : 0.8,
        tint: STYLE_TINT[p.style], attackRange: 1.4, attackFx: 'impact', attackStyle: p.style,
        loadout: { skills: [], passives: p.passives ? [...c.loadout.passives] : [] }, style: p.style };
      const t = this.addUnit(tpl, c.team, at.x, at.z);
      t.summon = { owner: c, ability: p.ability, every: p.every, life: p.duration, t: 0.2 + i * 0.1, mode,
        melee: mode === 'minion' && p.melee !== false, depth, orbitA: a, deathAbility: p.deathAbility };
      this.fx.spawn(t);
      this.fx.explosion(at.x, at.z, 1, p.style, 0.5);
    }
  }
  spawnOrbit(o) {
    this.orbits.push({ owner: o.owner, p: o, ctx: o.ctx, t: 0, ang: Math.random() * 6.28, cds: new Map(), style: o.style, dead: false });
  }
  updateOrbits(dt) {
    for (const ob of this.orbits) {
      ob.t += dt; ob.ang += ob.p.spin * dt;
      if (ob.t >= ob.p.duration || !ob.owner.alive) { ob.dead = true; continue; }
      ob.points = [];
      for (let i = 0; i < ob.p.count; i++) {
        const a = ob.ang + i / ob.p.count * Math.PI * 2;
        const pt = { x: ob.owner.x + Math.cos(a) * ob.p.radius, z: ob.owner.z + Math.sin(a) * ob.p.radius };
        ob.points.push(pt);
        for (const e of this.enemiesInRadius(ob.owner, pt.x, pt.z, 0.45)) {
          if ((ob.cds.get(e) || 0) > this.time) continue;
          ob.cds.set(e, this.time + ob.p.hitCd);
          this.fx.impact(pt.x, pt.z, ob.style, 0.5);
          this.dealDamage(ob.owner, e, evalFormula(ob.p.formula, { ...ob.ctx, target: e }, this), { ...ob.p.formula, ctx: ob.ctx });
          if (ob.p.buff) this.applyBuff(ob.owner, e, ob.p.buff, ob.p.stacks, ob.ctx);
        }
      }
    }
    this.orbits = this.orbits.filter(o => !o.dead);
  }
  updateTotem(u, dt) {
    const s = u.summon;
    s.life -= dt; s.t -= dt;
    if (s.life <= 0 || !s.owner.alive) {
      u.alive = false; this.fx.death(u);
      if (s.deathAbility) this.freeCast(s.owner, s.deathAbility, { caster: s.owner, target: this.nearestEnemy(u), point: { x: u.x, z: u.z }, origin: { x: u.x, z: u.z }, depth: s.depth, kind: 'skill' });
      this.units = this.units.filter(x => x !== u); return;
    }
    const tg = this.nearestEnemy(u, s.mode === 'minion' ? 30 : 14);
    if (s.mode === 'drone') {
      s.orbitA += dt * 1.6;
      const o = s.owner, tx = o.x + Math.cos(s.orbitA) * 1.8, tz = o.z + Math.sin(s.orbitA) * 1.8;
      u.x += (tx - u.x) * Math.min(1, dt * 6); u.z += (tz - u.z) * Math.min(1, dt * 6);
    } else if (s.mode === 'minion') {
      if (tg) {
        const d = this.dist(u, tg);
        if (d > u.tpl.attackRange + tg.radius) this.move(u, tg.x - u.x, tg.z - u.z, dt); else u.moving = false;
        u.atkTimer -= dt;
        if (s.melee && d <= u.tpl.attackRange + tg.radius + 0.3 && u.atkTimer <= 0) {
          u.atkTimer = 1 / Math.max(0.1, this.stat(u, 'atkSpeed'));
          this.basicAttack(u, tg);
        }
      } else if (this.dist(u, s.owner) > 2.5) this.move(u, s.owner.x - u.x, s.owner.z - u.z, dt); else u.moving = false;
    }
    if (tg) { u.target = tg; u.aimAngle = Math.atan2(tg.z - u.z, tg.x - u.x); }
    if (s.t <= 0 && s.ability) {
      s.t = s.every;
      if (tg) {
        u.facing = tg.x >= u.x ? 1 : -1; u.attackT = 0.2;
        this.freeCast(u, s.ability, { caster: u, target: tg, point: { x: tg.x, z: tg.z }, depth: s.depth - 1, kind: 'skill' });
      }
    }
  }

  // ---------- Buff ----------
  applyBuff(src, tgt, id, stacks = 1, ctx = {}, durOverride = 0) {
    const def = this.lib.buffs[id];
    if (!def || !tgt?.alive) return;
    let b = tgt.buffs.find(x => x.id === id);
    const dur = durOverride || def.duration;
    if (b) {
      b.stacks = Math.min(def.maxStacks || 1, b.stacks + stacks);
      b.t = dur; b.dur = dur; b.source = src;
    } else {
      b = { id, def, stacks: Math.min(def.maxStacks || 1, stacks), t: dur, dur, tickT: def.tickInterval || 1, source: src };
      tgt.buffs.push(b);
    }
    if (def.flags?.stun) { tgt.casting = null; tgt.dash = null; }
    this.fx.buff(tgt, def, b.stacks);
    const payload = { source: src, target: tgt, buffId: id, amount: b.stacks, depth: (ctx.depth || 0), kind: ctx.kind || 'skill' };
    this.emit('onBuffGained', payload);
    if (src) this.emit('onBuffApplied', payload);
  }
  // 单层 Buff 剩余的周期效果总值（跳伤公式 × 剩余跳数），作为公式数据源
  buffRemain(u, id) {
    const b = u?.buffs.find(x => x.id === id), d = b?.def;
    if (!b || !(d.tickInterval > 0) || !d.tick) return 0;
    const n = b.t >= b.tickT ? Math.floor((b.t - b.tickT) / d.tickInterval) + 1 : 0;
    return n * evalFormula(d.tick, { caster: b.source || u, target: u }, this);
  }
  removeBuff(u, id, stacks = 0) {
    const b = u.buffs.find(x => x.id === id);
    if (!b) return 0;
    const had = b.stacks;
    if (!stacks || stacks >= b.stacks) u.buffs = u.buffs.filter(x => x !== b);
    else b.stacks -= stacks;
    this.fx.text(u, `-${b.def.name}`, b.def.color);
    return had;
  }

  // ---------- 事件总线 / 触发器 ----------
  emit(evt, payload) {
    if ((payload.depth || 0) >= MAX_DEPTH) return;
    const trig = TRIGGERS[evt];
    for (const u of this.units) {
      if (!u.alive) continue;
      for (const pid of u.loadout.passives) {
        const a = this.lib.abilities[pid];
        if (!a || a.kind !== 'passive' || a.trigger?.event !== evt) continue;
        if (trig.subject && payload[trig.subject] !== u) continue;
        if (evt === 'onEnemyDeath' && (payload.target.team === u.team || this.dist(u, payload.target) > (a.trigger.radius || 8))) continue;
        if (!this.passiveAccepts(u, a, payload)) continue;
        const other = trig.other ? payload[trig.other] : null;
        this.firePassive(u, a, other, payload);
      }
    }
  }
  passiveAccepts(u, a, payload) {
    const tr = a.trigger;
    if (tr.ignoreProc !== false && payload.kind === 'proc') return false;
    if (tr.kind && tr.kind !== 'any' && payload.kind !== tr.kind) return false;
    if (tr.buff && payload.buffId !== undefined && payload.buffId !== tr.buff) return false;
    if (tr.event === 'onLowHp') {
      const th = (tr.pct ?? 30) / 100;
      if (!(payload.prevPct >= th && payload.newPct < th)) return false;
    }
    if (tr.event === 'onCast' && tr.ability && tr.ability !== '*' && payload.ability !== tr.ability) return false;
    if ((u.icd[a.id] || 0) > this.time) return false;
    const other = TRIGGERS[tr.event].other ? payload[TRIGGERS[tr.event].other] : u.target;
    return (a.conditions || []).every(c => this.checkCond(c, u, other));
  }
  checkCond(c, self, other) {
    const s = c.subject === 'other' ? other : self;
    const cmp = (v) => c.op === '>' ? v > c.value : v < c.value;
    switch (c.type) {
      case 'hasBuff': return !!s && this.buffStacks(s, c.buff) >= (c.stacks || 1);
      case 'noBuff': return !s || this.buffStacks(s, c.buff) === 0;
      case 'hpPct': return !!s && cmp(s.hp / this.stat(s, 'maxHp') * 100);
      case 'chance': return Math.random() * 100 < (c.value ?? 50);
      case 'distance': return !!other && cmp(this.dist(self, other));
      case 'manaPct': return !!s && cmp(s.mana / Math.max(1, s.base.maxMana || 1) * 100);
      case 'hasShield': return !!s && this.shieldOf(s) > 0;
      case 'casting': return !!s && !!s.casting;
      case 'stunned': return !!s && this.hasFlag(s, 'stun');
      default: return true;
    }
  }
  firePassive(u, a, other, payload) {
    u.icd[a.id] = this.time + (a.icd || 0);
    const target = other && other !== u ? other : (u.target?.alive ? u.target : this.nearestEnemy(u));
    const ctx = {
      caster: u, target, point: target ? { x: target.x, z: target.z } : { x: u.x, z: u.z },
      event: payload, depth: (payload.depth || 0) + 1, kind: 'proc', ability: a.id,
    };
    this.fx.proc(u, a);
    if ((a.icd || 0) >= 0.5) this.addLog(`✧ ${u.name} 触发被动 【${a.name}】`, a.color);
    this.runAbility(u, a, ctx);
  }

  // ---------- 投射物 / 区域 / 光束 ----------
  // 方向解析：target / cursor / facing（沿用触发者的飞行方向）/ random
  aimAngle(aim, ctx, from, tgt) {
    const c = ctx.caster;
    if (aim === 'cursor' && c.ai === 'player') return Math.atan2(ctx.point.z - from.z, ctx.point.x - from.x);
    if (aim === 'facing') return ctx.dir ?? c.aimAngle ?? (c.facing > 0 ? 0 : Math.PI);
    if (aim === 'random') return Math.random() * Math.PI * 2;
    if (tgt && this.dist(from, tgt) > 0.05) return Math.atan2(tgt.z - from.z, tgt.x - from.x);
    if (aim === 'cursor') return Math.atan2(ctx.point.z - from.z, ctx.point.x - from.x);
    return ctx.dir ?? c.aimAngle ?? 0;
  }
  spawnProjectile(o) {
    const c = o.owner, p = o;
    const from = o.from || o.ctx.origin || c;
    const off = o.from || o.ctx.origin ? 0.05 : 0.6;
    const sp = p.speed * (1 + (Math.random() * 2 - 1) * (p.speedRand || 0));
    const pr = {
      x: from.x + Math.cos(o.angle) * off, z: from.z + Math.sin(o.angle) * off, y: 1.0,
      angle: o.angle, speed: sp, p, owner: c, ctx: o.ctx, tgt: o.homingTarget,
      life: 0, maxLife: p.life || 3, hit: new Set(o.ignore || []), dead: false, style: p.style, size: p.size,
      pierceLeft: p.pierce === true ? 99 : (p.pierce || 0), bounceLeft: p.bounce || 0, mult: o.mult ?? 1,
      timerT: p.timerEvery || 0, gen: o.gen || 0, sx: from.x, sz: from.z, bx: 0, bz: 0,
    };
    pr.bx = pr.x; pr.bz = pr.z;
    if (p.motion === 'lob') {
      const dest = o.lobTo || (o.homingTarget ? { x: o.homingTarget.x, z: o.homingTarget.z } : { x: pr.x + Math.cos(o.angle) * 6, z: pr.z + Math.sin(o.angle) * 6 });
      pr.lob = { fx: pr.x, fz: pr.z, tx: dest.x, tz: dest.z, dur: Math.max(0.25, Math.hypot(dest.x - pr.x, dest.z - pr.z) / sp) };
      pr.maxLife = pr.lob.dur;
    }
    this.projectiles.push(pr);
    return pr;
  }
  spawnZone(o) {
    this.zones.push({ x: o.x, z: o.z, p: o, owner: o.owner, ctx: o.ctx, t: 0, tickT: 0, dead: false, style: o.style, radius: o.radius });
  }
  spawnBeam(o) {
    this.beams.push({ owner: o.owner, tgt: o.tgt, p: o, ctx: o.ctx, t: 0, tickT: 0, n: 0, dead: false, style: o.style });
  }
  // 在某个位置以某单位为施法者“触发”一个技能（Noita 的触发/定时/失效载荷）
  castPayload(owner, id, pos, ctx, extra = {}) {
    if (!id || !owner.alive) return;
    this.freeCast(owner, id, { ...ctx, ...extra, caster: owner, origin: { x: pos.x, z: pos.z }, kind: ctx.kind === 'proc' ? 'proc' : 'skill' });
  }
  projectileHit(pr, t) {
    const p = pr.p;
    this.fx.impact(t.x, t.z, p.style, p.size);
    const dmg = evalFormula(p.formula, { ...pr.ctx, target: t }, this) * pr.mult;
    this.dealDamage(pr.owner, t, dmg, { ...p.formula, ctx: pr.ctx });
    if (p.buff) this.applyBuff(pr.owner, t, p.buff, p.stacks, pr.ctx);
    if (p.knock) this.knock(t, pr.x - Math.cos(pr.angle), pr.z - Math.sin(pr.angle), p.knock);
    if (p.splash > 0) this.projSplash(pr, pr.x, pr.z, t);
    if (p.onHit) this.castPayload(pr.owner, p.onHit, t, pr.ctx, { target: t, exclude: t, dir: pr.angle });
    if (p.split > 0 && (p.splitOn === 'hit' || p.splitOn === 'both')) this.splitProjectile(pr, t);
  }
  projSplash(pr, x, z, except) {
    const p = pr.p;
    this.fx.explosion(x, z, p.splash, p.style, 0.6);
    for (const o of this.enemiesInRadius(pr.owner, x, z, p.splash)) {
      if (o === except) continue;
      this.dealDamage(pr.owner, o, evalFormula(p.formula, { ...pr.ctx, target: o }, this) * 0.5 * pr.mult, { ...p.formula, ctx: pr.ctx });
      if (p.buff) this.applyBuff(pr.owner, o, p.buff, p.stacks, pr.ctx);
    }
  }
  splitProjectile(pr, hitUnit) {
    const p = pr.p;
    if (pr.gen >= 3) return;
    const n = p.split, arc = (p.splitArc ?? 360) * Math.PI / 180;
    const child = { ...p, split: p.splitRecursive ? p.split : 0, count: 1, homing: p.splitHoming ? p.homing : 0, motion: 'straight', size: p.size * 0.7, life: Math.min(p.life || 3, 1.2) };
    for (let i = 0; i < n; i++) {
      const a = arc >= 6.28 ? pr.angle + i / n * Math.PI * 2 : pr.angle - arc / 2 + (n === 1 ? arc / 2 : i / (n - 1) * arc);
      this.spawnProjectile({ ...child, owner: pr.owner, ctx: pr.ctx, angle: a, from: { x: pr.x, z: pr.z }, ignore: hitUnit ? [hitUnit] : [], mult: pr.mult * (p.splitDmg ?? 0.5), gen: pr.gen + 1,
        homingTarget: null });
    }
    this.fx.burstAt?.(pr.x, pr.z, p.style);
  }
  expireProjectile(pr, reason) {
    if (pr.dead) return;
    pr.dead = true;
    const p = pr.p;
    if (reason === 'land' && p.splash > 0) this.projSplash(pr, pr.x, pr.z, null);
    else this.fx.fizzle?.(pr.x, pr.z, p.style);
    if (p.onExpire) this.castPayload(pr.owner, p.onExpire, pr, pr.ctx, { dir: pr.angle, target: this.nearestEnemyTo(pr.owner, pr) });
    if (p.split > 0 && (p.splitOn === 'expire' || p.splitOn === 'both')) this.splitProjectile(pr, null);
  }
  nearestEnemyTo(u, pos, maxR = Infinity, exclude) {
    let best = null, bd = maxR;
    for (const o of this.enemiesOf(u)) {
      if (o === exclude) continue;
      const d = Math.hypot(o.x - pos.x, o.z - pos.z); if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------- 激光 ----------
  spawnLaser(o) {
    const c = o.owner;
    const L = { owner: c, p: o, ctx: o.ctx, t: 0, tickT: 0, dead: false, style: o.style, angle: o.angle, from: o.ctx.origin ? { ...o.ctx.origin } : null, len: o.length, n: 0 };
    this.lasers.push(L);
    this.tickLaser(L);
    L.tickT = o.tick;
  }
  laserGeom(L) {
    const c = L.owner, p = L.p;
    const from = L.from || { x: c.x, z: c.z };
    if (p.track && !L.from) {
      if (p.aim === 'cursor' && c.ai === 'player') L.angle = Math.atan2(this.input.point.z - c.z, this.input.point.x - c.x);
      else if (p.aim !== 'facing') { const t = this.resolveTargets(p.target, L.ctx)[0]; if (t) L.angle = Math.atan2(t.z - from.z, t.x - from.x); }
    }
    if (p.sweep) L.angle += p.sweep * Math.PI / 180 * this.dtLast;
    const dx = Math.cos(L.angle), dz = Math.sin(L.angle);
    // 沿线命中
    const hits = [];
    for (const e of this.enemiesOf(c)) {
      const rx = e.x - from.x, rz = e.z - from.z;
      const along = rx * dx + rz * dz;
      if (along < 0 || along > p.length + e.radius) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      if (perp <= p.width * 0.5 + e.radius * 0.8) hits.push({ e, along });
    }
    hits.sort((a, b) => a.along - b.along);
    let len = p.length;
    let list = hits;
    if (!p.pierce && hits.length) { list = [hits[0]]; len = hits[0].along; }
    // 墙体截断
    const bx = this.bounds.x + 1, bz = this.bounds.z + 1;
    const tx = dx > 0 ? (bx - from.x) / dx : dx < 0 ? (-bx - from.x) / dx : Infinity;
    const tz = dz > 0 ? (bz - from.z) / dz : dz < 0 ? (-bz - from.z) / dz : Infinity;
    len = Math.min(len, tx, tz);
    L.len = len; L.fx = from.x; L.fz = from.z; L.ex = from.x + dx * len; L.ez = from.z + dz * len;
    return list.map(h => h.e);
  }
  tickLaser(L) {
    const p = L.p;
    const list = this.laserGeom(L);
    const mult = 1 + (p.ramp || 0) * L.n++;
    for (const e of list) {
      this.dealDamage(L.owner, e, evalFormula(p.formula, { ...L.ctx, target: e }, this) * mult, { ...p.formula, ctx: L.ctx });
      if (p.buff) this.applyBuff(L.owner, e, p.buff, p.stacks, L.ctx);
      if (p.knock) this.knock(e, L.fx, L.fz, p.knock);
    }
    if (p.onHit && list.length) this.castPayload(L.owner, p.onHit, { x: L.ex, z: L.ez }, L.ctx, { target: list[0], exclude: list[0], dir: L.angle });
    this.fx.laserTick?.(L);
  }
  updateLasers(dt) {
    for (const L of this.lasers) {
      if (L.dead) continue;
      L.t += dt;
      if (!L.owner.alive || this.hasFlag(L.owner, 'stun') || L.t >= Math.max(0.12, L.p.duration)) { L.dead = true; continue; }
      if (L.p.duration > 0) {
        L.tickT -= dt;
        if (L.tickT <= 0) { L.tickT += L.p.tick; this.tickLaser(L); } else this.laserGeom(L);
      }
    }
    this.lasers = this.lasers.filter(l => !l.dead);
  }

  // ---------- 位移 ----------
  blink(u, p, ctx) {
    const from = { x: u.x, z: u.z };
    const t = this.resolveTargets('target', ctx)[0];
    let to;
    if (p.mode === 'cursor' || !t) {
      const dx = ctx.point.x - u.x, dz = ctx.point.z - u.z, d = Math.hypot(dx, dz) || 1;
      const k = Math.min(p.distance, d) / d;
      to = { x: u.x + dx * k, z: u.z + dz * k };
    } else {
      const dx = t.x - u.x, dz = t.z - u.z, d = Math.hypot(dx, dz) || 1;
      const nx = dx / d, nz = dz / d;
      if (p.mode === 'behind') to = { x: t.x + nx * (t.radius + 0.9), z: t.z + nz * (t.radius + 0.9) };
      else if (p.mode === 'target') to = { x: t.x - nx * (t.radius + 0.8), z: t.z - nz * (t.radius + 0.8) };
      else to = { x: u.x - nx * p.distance, z: u.z - nz * p.distance };
      if (p.mode !== 'away' && Math.hypot(to.x - u.x, to.z - u.z) > p.distance + 6) return this.fx.text(u, '太远了', '#ff6b6b');
    }
    to = this.clampPt(to);
    u.x = to.x; u.z = to.z;
    if (t) u.facing = t.x >= u.x ? 1 : -1;
    this.fx.blink(u, from, to, p.style);
    this.emit('onMove', { source: u, target: t, amount: Math.hypot(to.x - from.x, to.z - from.z), depth: ctx.depth || 0, kind: ctx.kind });
  }
  dash(u, p, ctx) {
    let dx, dz;
    const t = this.resolveTargets('target', ctx)[0];
    if (p.mode === 'target' && t) { dx = t.x - u.x; dz = t.z - u.z; }
    else if (p.mode === 'back' && t) { dx = u.x - t.x; dz = u.z - t.z; }
    else { dx = ctx.point.x - u.x; dz = ctx.point.z - u.z; }
    const d = Math.hypot(dx, dz) || 1;
    const dist = p.mode === 'target' && t ? Math.min(p.distance, Math.max(0, d - t.radius - 0.5) + 1.2) : p.distance;
    u.dash = { nx: dx / d, nz: dz / d, left: dist, speed: p.speed, p, ctx, hit: new Set() };
    u.facing = dx >= 0 ? 1 : -1;
    this.fx.dashStart(u, p.style);
    this.emit('onMove', { source: u, target: t, amount: dist, depth: ctx.depth || 0, kind: ctx.kind });
  }
  knock(u, cx, cz, dist) {
    if (u.tpl.unmovable) return;
    let dx = u.x - cx, dz = u.z - cz, d = Math.hypot(dx, dz);
    if (d < 0.01) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); d = 1; }
    if (dist < 0) dist = -Math.min(-dist, Math.max(0, d - 1));
    u.knockV = { vx: dx / d * dist / 0.22, vz: dz / d * dist / 0.22, t: 0.22 };
    u.casting = u.team === 0 ? u.casting : null;
  }

  // ---------- 主循环 ----------
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    if (this.hitstopT > 0) { this.hitstopT -= dt; dt *= 0.06; }
    this.time += dt;
    this.dtLast = dt;

    // 计时器
    const due = this.timers.filter(t => t.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter(t => t.at > this.time);
      due.sort((a, b) => a.at - b.at);
      for (const t of due) {
        if (t.ctx && !t.ctx.caster.alive) continue;
        try { t.fn(); } catch (e) { console.error(e); }
      }
    }

    for (const u of this.units) this.updateUnit(u, dt);
    this.separate();
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateBeams(dt);
    this.updateOrbits(dt);
    this.updateLasers(dt);
    this.meter.recent = this.meter.recent.filter(r => r.t > this.time - 5);
  }

  updateUnit(u, dt) {
    u.anim += dt; u.hurtT = Math.max(0, u.hurtT - dt); u.attackT = Math.max(0, u.attackT - dt);
    if (!u.alive) return;
    const maxHp = this.stat(u, 'maxHp');
    u.hp = Math.min(maxHp, u.hp + this.stat(u, 'hpRegen') * dt);
    u.mana = Math.min(u.base.maxMana || 0, u.mana + this.stat(u, 'manaRegen') * dt);
    if (u.casting && this.time >= u.casting.end) u.casting = null;

    // buff 计时与跳伤
    for (const b of [...u.buffs]) {
      b.t -= dt;
      const d = b.def;
      if (d.tickInterval > 0 && d.tick && (d.tick.base || d.tick.rows?.length)) {
        b.tickT -= dt;
        while (b.tickT <= 0 && u.alive) {
          b.tickT += d.tickInterval;
          const src = b.source?.alive ? b.source : null;
          const amt = evalFormula(d.tick, { caster: b.source || u, target: u }, this) * b.stacks;
          if (d.tickKind === 'heal') this.heal(src, u, amt);
          else this.dealDamage(src, u, amt, { type: d.tick.type, canCrit: false, kind: 'dot', label: d.name, ctx: { depth: 0, kind: 'dot' } });
          this.fx.dotTick(u, d);
        }
      }
      if (b.t <= 0 && u.buffs.includes(b)) {
        u.buffs = u.buffs.filter(x => x !== b);
        this.emit('onBuffExpired', { source: b.source, target: u, buffId: b.id, amount: b.stacks, depth: 0, kind: 'skill' });
      }
    }
    for (const s of u.shields) s.t -= dt;
    u.shields = u.shields.filter(s => s.t > 0 && s.amount > 0);

    // interval 被动
    for (const pid of u.loadout.passives) {
      const a = this.lib.abilities[pid];
      if (a?.trigger?.event !== 'interval') continue;
      u.intervalT[pid] = (u.intervalT[pid] ?? a.trigger.every ?? 3) - dt;
      if (u.intervalT[pid] <= 0) {
        u.intervalT[pid] = a.trigger.every || 3;
        const payload = { source: u, target: u.target, depth: 0, kind: 'skill', amount: 0 };
        if (this.passiveAccepts(u, a, payload)) this.firePassive(u, a, null, payload);
      }
    }

    // 位移状态
    if (u.knockV) {
      u.x += u.knockV.vx * dt; u.z += u.knockV.vz * dt; u.knockV.t -= dt;
      if (u.knockV.t <= 0) u.knockV = null;
      this.clampUnit(u); return;
    }
    if (u.dash) { this.updateDash(u, dt); return; }
    const stunned = this.hasFlag(u, 'stun');
    if (stunned) { u.moving = false; return; }

    if (u.summon) this.updateTotem(u, dt);
    else if (u.ai === 'player') this.updatePlayer(u, dt);
    else this.updateAI(u, dt);
    this.clampUnit(u);
  }
  clampUnit(u) {
    u.x = Math.max(-this.bounds.x, Math.min(this.bounds.x, u.x));
    u.z = Math.max(-this.bounds.z, Math.min(this.bounds.z, u.z));
  }
  updateDash(u, dt) {
    const d = u.dash, step = Math.min(d.left, d.speed * dt);
    u.x += d.nx * step; u.z += d.nz * step; d.left -= step;
    this.clampUnit(u);
    const f = d.p.formula;
    for (const o of this.enemiesInRadius(u, u.x, u.z, 1.1)) {
      if (d.hit.has(o)) continue;
      d.hit.add(o);
      if (f && (f.base || f.rows?.length)) {
        this.fx.strike(u, o, 'impact', d.p.style, 0);
        this.dealDamage(u, o, evalFormula(f, { ...d.ctx, target: o }, this), { ...f, ctx: d.ctx });
      }
      if (d.p.buff) this.applyBuff(u, o, d.p.buff, d.p.stacks, d.ctx);
    }
    if (d.left <= 0.001) u.dash = null;
  }
  move(u, dx, dz, dt) {
    const len = Math.hypot(dx, dz);
    if (len < 0.01 || this.hasFlag(u, 'root') || (u.casting?.root)) { u.moving = false; return; }
    const sp = this.stat(u, 'moveSpeed');
    u.x += dx / len * sp * dt; u.z += dz / len * sp * dt;
    u.moving = true;
    if (Math.abs(dx) > 0.05) u.facing = dx > 0 ? 1 : -1;
  }
  updatePlayer(u, dt) {
    u.aimAngle = Math.atan2(this.input.point.z - u.z, this.input.point.x - u.x);
    this.move(u, this.input.mx, this.input.mz, dt);
    if (u.target && !u.target.alive) u.target = null;
    const range = u.tpl.attackRange || 2.2;
    const t = (u.target && this.dist(u, u.target) <= range + u.target.radius + 0.4) ? u.target : this.nearestEnemy(u, range + 0.6);
    u.atkTimer -= dt;
    if (t && !u.casting && u.atkTimer <= 0 && !this.hasFlag(u, 'disarm')) {
      u.atkTimer = 1 / Math.max(0.1, this.stat(u, 'atkSpeed'));
      this.basicAttack(u, t);
    }
  }
  basicAttack(u, t) {
    u.facing = t.x >= u.x ? 1 : -1; u.attackT = 0.22;
    this.fx.strike(u, t, u.tpl.attackFx || 'slash', u.tpl.attackStyle || 'blood', 0);
    this.dealDamage(u, t, this.stat(u, 'atk'), { type: 'physical', canCrit: true, kind: 'attack', ctx: { caster: u, depth: 0, kind: 'attack' } });
  }
  updateAI(u, dt) {
    const hero = this.hero;
    if (!this.settings.enemyAggro || !hero?.alive || u.ai === 'none') { u.moving = false; return; }
    u.target = hero;
    u.aimAngle = Math.atan2(hero.z - u.z, hero.x - u.x);
    const d = this.dist(u, hero);
    const range = u.tpl.attackRange || 1.6;
    if (u.ai === 'melee' || u.ai === 'boss') {
      if (d > range + hero.radius) this.move(u, hero.x - u.x, hero.z - u.z, dt);
      else u.moving = false;
      u.atkTimer -= dt;
      if (d <= range + hero.radius + 0.3 && u.atkTimer <= 0 && !u.casting) {
        u.atkTimer = 1 / Math.max(0.1, this.stat(u, 'atkSpeed'));
        this.basicAttack(u, hero);
      }
    }
    // 怪物技能
    if (u.loadout.skills.length) {
      u.aiT -= dt;
      if (u.aiT <= 0) {
        u.aiT = 2 + Math.random() * 2;
        const ready = u.loadout.skills.filter(id => !this.canCast(u, id));
        if (ready.length) this.tryCast(u, ready[Math.floor(Math.random() * ready.length)], { target: hero, point: { x: hero.x, z: hero.z } });
      }
    }
  }
  separate() {
    const al = this.units.filter(u => u.alive);
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j];
      if (a.dash || b.dash) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = (a.radius + b.radius) * 0.85;
      if (d < min && d > 0.0001) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        const wa = a.tpl.unmovable ? 0 : 1, wb = b.tpl.unmovable ? 0 : 1;
        a.x -= nx * push * wa * (wb ? 1 : 2); a.z -= nz * push * wa * (wb ? 1 : 2);
        b.x += nx * push * wb * (wa ? 1 : 2); b.z += nz * push * wb * (wa ? 1 : 2);
      }
    }
  }
  updateProjectiles(dt) {
    const list = this.projectiles;
    for (let i = 0; i < list.length; i++) {
      const pr = list[i];
      if (pr.dead) continue;
      const p = pr.p;
      pr.life += dt;
      pr.speed = Math.max(0.5, pr.speed + (p.accel || 0) * dt);
      // 追踪：转向速率(弧度/秒)，丢失目标时按 homeOn 重新索敌
      const turn = p.homing === true ? 8 : (p.homing || 0);
      if (turn > 0 && pr.life > 0.06 && p.motion !== 'lob') {
        if (!pr.tgt?.alive || pr.hit.has(pr.tgt)) pr.tgt = this.nearestEnemyTo(pr.owner, pr, 14, null);
        if (pr.tgt && !pr.hit.has(pr.tgt)) {
          const want = Math.atan2(pr.tgt.z - pr.z, pr.tgt.x - pr.x);
          const diff = ((want - pr.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          pr.angle += Math.max(-turn * dt, Math.min(turn * dt, diff));
        }
      }
      const step = pr.speed * dt;
      switch (p.motion) {
        case 'wave': {
          pr.bx += Math.cos(pr.angle) * step; pr.bz += Math.sin(pr.angle) * step;
          const w = Math.sin(pr.life * 12) * 0.9;
          pr.x = pr.bx - Math.sin(pr.angle) * w; pr.z = pr.bz + Math.cos(pr.angle) * w;
          break;
        }
        case 'spiral':
          pr.angle += 9 / (1 + pr.life * 2.5) * dt;
          pr.x += Math.cos(pr.angle) * step; pr.z += Math.sin(pr.angle) * step; break;
        case 'boomerang': {
          if (pr.life > pr.maxLife * 0.45) {
            const o = pr.owner, want = Math.atan2(o.z - pr.z, o.x - pr.x);
            const diff = ((want - pr.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            pr.angle += Math.max(-7 * dt, Math.min(7 * dt, diff));
            if (pr.life > pr.maxLife * 0.6 && this.dist(o, pr) < 0.8) { pr.hit.clear(); this.expireProjectile(pr, 'return'); continue; }
            if (pr.hit.size && pr.life > pr.maxLife * 0.5 && !pr.returning) { pr.returning = true; pr.hit.clear(); }
          }
          pr.x += Math.cos(pr.angle) * step; pr.z += Math.sin(pr.angle) * step; break;
        }
        case 'lob': {
          const L = pr.lob, k = Math.min(1, pr.life / L.dur);
          pr.x = L.fx + (L.tx - L.fx) * k; pr.z = L.fz + (L.tz - L.fz) * k;
          pr.y = 0.6 + Math.sin(k * Math.PI) * (1.5 + L.dur * 2);
          if (k >= 1) this.expireProjectile(pr, 'land');
          continue;
        }
        default:
          pr.x += Math.cos(pr.angle) * step; pr.z += Math.sin(pr.angle) * step;
      }
      // 定时载荷
      if (p.timerAbility && p.timerEvery > 0) {
        pr.timerT -= dt;
        if (pr.timerT <= 0) { pr.timerT += p.timerEvery; this.castPayload(pr.owner, p.timerAbility, pr, pr.ctx, { dir: pr.angle, target: this.nearestEnemyTo(pr.owner, pr) }); }
      }
      // 碰撞
      for (const o of this.enemiesOf(pr.owner)) {
        if (pr.hit.has(o)) continue;
        if (Math.hypot(o.x - pr.x, o.z - pr.z) < o.radius + 0.3 * pr.size) {
          pr.hit.add(o); this.projectileHit(pr, o);
          if (pr.pierceLeft > 0) { pr.pierceLeft--; continue; }
          if (pr.bounceLeft > 0) {
            pr.bounceLeft--; pr.mult *= 1 + (p.bounceGrow || 0);
            const nx = this.nearestEnemyTo(pr.owner, pr, p.bounceRange || 8, o);
            pr.angle = nx ? Math.atan2(nx.z - pr.z, nx.x - pr.x) : pr.angle + Math.PI + (Math.random() - 0.5);
            pr.tgt = nx; pr.hit = new Set([o]); pr.life = Math.min(pr.life, pr.maxLife * 0.5);
            pr.bx = pr.x; pr.bz = pr.z;
            this.fx.text?.(o, '↯', STYLE_TINT[p.style] || '#fff');
            break;
          }
          this.expireProjectile(pr, 'hit');
          break;
        }
      }
      if (pr.dead) continue;
      // 墙体：反弹或消失
      const bx = this.bounds.x + 1, bz = this.bounds.z + 1;
      if (Math.abs(pr.x) > bx || Math.abs(pr.z) > bz) {
        if (p.bounceWall && pr.bounceLeft > 0) {
          pr.bounceLeft--;
          if (Math.abs(pr.x) > bx) { pr.angle = Math.PI - pr.angle; pr.x = Math.sign(pr.x) * bx; }
          if (Math.abs(pr.z) > bz) { pr.angle = -pr.angle; pr.z = Math.sign(pr.z) * bz; }
          pr.bx = pr.x; pr.bz = pr.z; pr.hit.clear();
          this.fx.impact(pr.x, pr.z, p.style, 0.5);
        } else { this.expireProjectile(pr, 'wall'); continue; }
      }
      if (pr.life > pr.maxLife) this.expireProjectile(pr, 'timeout');
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
  }
  updateZones(dt) {
    for (const z of this.zones) {
      if (z.dead) continue;
      z.t += dt; z.tickT -= dt;
      if (z.p.follow && z.owner.alive) { z.x = z.owner.x; z.z = z.owner.z; }
      const inside = this.enemiesInRadius(z.owner, z.x, z.z, z.radius);
      if (z.p.pull) for (const o of inside) {
        if (o.tpl.unmovable) continue;
        const dx = z.x - o.x, dz = z.z - o.z, d = Math.hypot(dx, dz);
        if (d > 0.5) { o.x += dx / d * z.p.pull * dt; o.z += dz / d * z.p.pull * dt; }
      }
      if (z.tickT <= 0) {
        z.tickT += z.p.tick;
        this.fx.zonePulse(z);
        for (const o of inside) {
          this.dealDamage(z.owner, o, evalFormula(z.p.formula, { ...z.ctx, target: o }, this), { ...z.p.formula, canCrit: z.p.formula.canCrit, ctx: z.ctx });
          if (z.p.buff) this.applyBuff(z.owner, o, z.p.buff, z.p.stacks, z.ctx);
        }
      }
      if (z.t >= z.p.duration || !z.owner.alive) z.dead = true;
    }
    this.zones = this.zones.filter(z => !z.dead);
  }
  updateBeams(dt) {
    for (const bm of this.beams) {
      if (bm.dead) continue;
      bm.t += dt; bm.tickT -= dt;
      if (!bm.tgt.alive) bm.tgt = this.nearestEnemy(bm.owner, 12);
      if (!bm.tgt || !bm.owner.alive || this.hasFlag(bm.owner, 'stun')) { bm.dead = true; continue; }
      bm.owner.facing = bm.tgt.x >= bm.owner.x ? 1 : -1;
      if (bm.tickT <= 0) {
        bm.tickT += bm.p.tick;
        const mult = 1 + bm.p.ramp * bm.n++;
        this.dealDamage(bm.owner, bm.tgt, evalFormula(bm.p.formula, { ...bm.ctx, target: bm.tgt }, this) * mult, { ...bm.p.formula, ctx: bm.ctx });
        if (bm.p.buff) this.applyBuff(bm.owner, bm.tgt, bm.p.buff, bm.p.stacks, bm.ctx);
        this.fx.impact(bm.tgt.x, bm.tgt.z, bm.style, 0.6);
      }
      if (bm.t >= bm.p.duration) bm.dead = true;
    }
    this.beams = this.beams.filter(b => !b.dead);
  }
}
