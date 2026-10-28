// 动作（时间轴积木）注册表：参数结构驱动检查器表单，run 驱动战斗逻辑
import { newFormula, evalFormula } from './model.js';

export const TARGETS = {
  target: '当前目标', self: '自身', nearest: '最近敌人', random: '随机敌人',
  lowest: '生命最低敌人', farthest: '最远敌人', cursorEnemy: '鼠标附近敌人', allEnemies: '所有敌人',
  nearestAlly: '最近队友', lowestAlly: '生命最低队友', allAllies: '所有队友', owner: '召唤者',
};
export const CENTERS = { target: '目标位置', self: '自身位置', cursor: '鼠标位置', random: '随机敌人位置', origin: '触发点(载荷位置)' };
export const AIMS = { target: '朝向目标', cursor: '朝向鼠标', facing: '沿当前朝向', random: '随机方向' };
export const MOTIONS = { straight: '直线', wave: '波浪', spiral: '螺旋', boomerang: '回旋镖', lob: '抛物线(榴弹)' };
export const SUMMON_MODES = { totem: '图腾(固定)', minion: '仆从(追击)', drone: '浮游炮(环绕)' };
export const SUMMON_MODELS = { auto: '自动', slime: '史莱姆', totem: '图腾', drone: '浮游球', robot: '机器人', girl: '少女' };
export const FX_STYLES = { fire: '烈焰', frost: '冰霜', arcane: '奥术', holy: '圣光', shadow: '暗影', poison: '剧毒', blood: '鲜血', storm: '雷暴' };
export const STYLE_COLORS = {
  fire: '#ff7a1a', frost: '#6fe3ff', arcane: '#c86bff', holy: '#ffe066',
  shadow: '#9b5cff', poison: '#7dff4a', blood: '#ff2e4d', storm: '#7fb2ff',
};

const T = (def = 'target') => ({ key: 'target', label: '目标', type: 'select', options: TARGETS, def });
const C = (def = 'target') => ({ key: 'center', label: '中心', type: 'select', options: CENTERS, def });
const F = (base = 50, rows = [{ src: 'caster', stat: 'atk', ratio: 1 }], type = 'physical') =>
  ({ key: 'formula', label: '数值公式', type: 'formula', def: newFormula(base, rows, type) });
const BUFF = [
  { key: 'buff', label: '附加Buff', type: 'buff', def: '' },
  { key: 'stacks', label: 'Buff层数', type: 'number', def: 1, min: 1, max: 99, step: 1 },
];
const STYLE = (def = 'fire') => ({ key: 'style', label: '特效风格', type: 'select', options: FX_STYLES, def });

export const ACTIONS = {
  strike: {
    label: '直接打击', icon: '⚔', color: '#ff5470', cat: '伤害',
    params: [T(), F(), { key: 'hits', label: '段数', type: 'number', def: 1, min: 1, max: 20, step: 1 },
      { key: 'interval', label: '段间隔', type: 'number', def: 0.12, min: 0.02, max: 2, step: 0.02 },
      { key: 'vfx', label: '打击特效', type: 'select', options: { slash: '斩击', impact: '重击', claw: '爪痕', pierce: '穿刺' }, def: 'slash' },
      STYLE('blood'), ...BUFF],
    dur: p => (p.hits - 1) * p.interval,
    run(b, p, ctx) {
      for (let i = 0; i < p.hits; i++) b.schedule(i * p.interval, () => {
        for (const t of b.resolveTargets(p.target, ctx)) {
          b.fx.strike(ctx.caster, t, p.vfx, p.style, i);
          b.dealDamage(ctx.caster, t, evalFormula(p.formula, { ...ctx, target: t }, b), { ...p.formula, ctx });
          if (p.buff) b.applyBuff(ctx.caster, t, p.buff, p.stacks, ctx);
        }
      }, ctx);
    },
  },
  projectile: {
    label: '投射物', icon: '➹', color: '#ff9f1c', cat: '伤害',
    params: [
      { ...T(), label: '目标/追踪对象', group: '瞄准' },
      { key: 'aim', label: '发射方向', type: 'select', options: AIMS, def: 'target' },
      F(60, [{ src: 'caster', stat: 'atk', ratio: 1.2 }], 'magic'),
      { key: 'count', label: '多重施法', type: 'number', def: 1, min: 1, max: 32, step: 1, group: '弹道' },
      { key: 'spread', label: '扇形角度', type: 'number', def: 30, min: 0, max: 360, step: 5 },
      { key: 'jitter', label: '随机散布°', type: 'number', def: 0, min: 0, max: 90, step: 1 },
      { key: 'speed', label: '飞行速度', type: 'number', def: 16, min: 2, max: 60, step: 1 },
      { key: 'speedRand', label: '速度随机', type: 'number', def: 0, min: 0, max: 0.9, step: 0.05 },
      { key: 'accel', label: '加速度', type: 'number', def: 0, min: -40, max: 60, step: 1 },
      { key: 'life', label: '存活时间', type: 'number', def: 2.5, min: 0.1, max: 10, step: 0.1 },
      { key: 'size', label: '尺寸', type: 'number', def: 1, min: 0.3, max: 4, step: 0.1 },
      { key: 'motion', label: '轨迹', type: 'select', options: MOTIONS, def: 'straight' },
      { key: 'homing', label: '追踪转向(0=无)', type: 'number', def: 8, min: 0, max: 30, step: 0.5, group: '修饰' },
      { key: 'pierce', label: '穿透次数', type: 'number', def: 0, min: 0, max: 99, step: 1 },
      { key: 'bounce', label: '弹射次数', type: 'number', def: 0, min: 0, max: 30, step: 1 },
      { key: 'bounceWall', label: '撞墙反弹', type: 'bool', def: false },
      { key: 'bounceGrow', label: '每次弹射增伤', type: 'number', def: 0, min: -0.5, max: 2, step: 0.05 },
      { key: 'split', label: '分裂数量', type: 'number', def: 0, min: 0, max: 16, step: 1 },
      { key: 'splitOn', label: '分裂时机', type: 'select', options: { hit: '命中时', expire: '消失时', both: '两者' }, def: 'hit' },
      { key: 'splitArc', label: '分裂角度', type: 'number', def: 360, min: 10, max: 360, step: 10 },
      { key: 'splitDmg', label: '分裂伤害倍率', type: 'number', def: 0.5, min: 0.05, max: 2, step: 0.05 },
      { key: 'splitRecursive', label: '递归分裂(最多3代)', type: 'bool', def: false },
      { key: 'splash', label: '溅射半径', type: 'number', def: 0, min: 0, max: 8, step: 0.25 },
      { key: 'knock', label: '击退', type: 'number', def: 0, min: -5, max: 8, step: 0.25 },
      { key: 'onHit', label: '命中触发技能', type: 'ability', def: '', group: '载荷 (Noita 式触发)' },
      { key: 'onExpire', label: '消失触发技能', type: 'ability', def: '' },
      { key: 'timerAbility', label: '定时触发技能', type: 'ability', def: '' },
      { key: 'timerEvery', label: '定时间隔', type: 'number', def: 0.3, min: 0.05, max: 5, step: 0.05 },
      { ...STYLE('fire'), group: '表现' }, ...BUFF],
    run(b, p, ctx) {
      const tgts = b.resolveTargets(p.target, ctx);
      const main = tgts[0];
      const c = ctx.caster;
      const from = ctx.origin || c;
      const base = b.aimAngle(p.aim || 'target', ctx, from, main);
      const lobTo = p.motion === 'lob' ? (p.aim === 'cursor' && c.ai === 'player' ? b.clampPt(ctx.point) : main ? { x: main.x, z: main.z } : null) : null;
      for (let i = 0; i < p.count; i++) {
        let off = p.count === 1 ? 0 : (p.spread >= 360 ? i / p.count * Math.PI * 2 : (i / (p.count - 1) - 0.5) * p.spread * Math.PI / 180);
        off += (Math.random() * 2 - 1) * (p.jitter || 0) * Math.PI / 180;
        const homingTarget = p.target === 'allEnemies' ? tgts[i % Math.max(1, tgts.length)] : main;
        let to = lobTo;
        if (to && p.count > 1) to = { x: to.x + Math.cos(base + off + 1.57) * (i - (p.count - 1) / 2) * 0.9, z: to.z + Math.sin(base + off + 1.57) * (i - (p.count - 1) / 2) * 0.9 };
        b.spawnProjectile({ ...p, angle: base + off, owner: c, homingTarget, ctx, lobTo: to });
      }
      b.fx.muzzle(ctx.origin ? { ...ctx.origin, radius: 0.5 } : c, p.style);
    },
  },
  laser: {
    label: '激光炮', icon: '⌁', color: '#ff2bd6', cat: '伤害',
    params: [
      { ...T(), group: '瞄准' },
      { key: 'aim', label: '方向', type: 'select', options: AIMS, def: 'cursor' },
      { key: 'track', label: '持续跟随瞄准', type: 'bool', def: true },
      { key: 'sweep', label: '扫射角速度°/s', type: 'number', def: 0, min: -360, max: 360, step: 10 },
      F(12, [{ src: 'caster', stat: 'atk', ratio: 0.22 }], 'magic'),
      { key: 'length', label: '长度', type: 'number', def: 16, min: 2, max: 40, step: 0.5, group: '形态' },
      { key: 'width', label: '宽度', type: 'number', def: 0.8, min: 0.1, max: 4, step: 0.05 },
      { key: 'duration', label: '持续(0=瞬发)', type: 'number', def: 1.5, min: 0, max: 10, step: 0.1 },
      { key: 'tick', label: '跳伤间隔', type: 'number', def: 0.1, min: 0.03, max: 1, step: 0.01 },
      { key: 'ramp', label: '每跳增幅', type: 'number', def: 0.03, min: 0, max: 1, step: 0.01 },
      { key: 'pierce', label: '贯穿所有敌人', type: 'bool', def: true },
      { key: 'knock', label: '击退', type: 'number', def: 0, min: -3, max: 3, step: 0.1 },
      { key: 'onHit', label: '命中触发技能', type: 'ability', def: '', group: '载荷' },
      { ...STYLE('arcane'), group: '表现' }, ...BUFF],
    dur: p => p.duration,
    run(b, p, ctx) {
      const c = ctx.caster, from = ctx.origin || c;
      const t = b.resolveTargets(p.target, ctx)[0];
      b.spawnLaser({ ...p, owner: c, ctx, angle: b.aimAngle(p.aim, ctx, from, t) });
      b.fx.shake(0.15);
    },
  },
  aoe: {
    label: '范围爆发', icon: '✸', color: '#ff3d7f', cat: '伤害',
    params: [C(), F(80, [{ src: 'caster', stat: 'atk', ratio: 1.5 }], 'magic'),
      { key: 'radius', label: '半径', type: 'number', def: 3, min: 0.5, max: 12, step: 0.25 },
      { key: 'delay', label: '预警时间', type: 'number', def: 0.5, min: 0, max: 5, step: 0.05 },
      { key: 'knockback', label: '击退距离', type: 'number', def: 0, min: -8, max: 10, step: 0.5 },
      STYLE('fire'), ...BUFF],
    dur: p => p.delay,
    run(b, p, ctx) {
      const at = b.resolveCenter(p.center, ctx);
      if (p.delay > 0) b.fx.telegraph(at.x, at.z, p.radius, p.delay, p.style);
      b.schedule(p.delay, () => {
        b.fx.explosion(at.x, at.z, p.radius, p.style);
        for (const t of b.enemiesInRadius(ctx.caster, at.x, at.z, p.radius)) {
          b.dealDamage(ctx.caster, t, evalFormula(p.formula, { ...ctx, target: t }, b), { ...p.formula, ctx });
          if (p.buff) b.applyBuff(ctx.caster, t, p.buff, p.stacks, ctx);
          if (p.knockback) b.knock(t, at.x, at.z, p.knockback);
        }
      }, ctx);
    },
  },
  zone: {
    label: '持续区域', icon: '◎', color: '#7dff4a', cat: '伤害',
    params: [C(), F(20, [{ src: 'caster', stat: 'atk', ratio: 0.3 }], 'magic'),
      { key: 'radius', label: '半径', type: 'number', def: 3, min: 0.5, max: 12, step: 0.25 },
      { key: 'duration', label: '持续时间', type: 'number', def: 4, min: 0.2, max: 20, step: 0.1 },
      { key: 'tick', label: '跳伤间隔', type: 'number', def: 0.5, min: 0.1, max: 5, step: 0.05 },
      { key: 'follow', label: '跟随施法者', type: 'bool', def: false },
      { key: 'pull', label: '吸附力', type: 'number', def: 0, min: -10, max: 10, step: 0.5 },
      STYLE('poison'), ...BUFF],
    dur: p => p.duration,
    run(b, p, ctx) {
      const at = b.resolveCenter(p.center, ctx);
      b.spawnZone({ ...p, x: at.x, z: at.z, owner: ctx.caster, ctx });
    },
  },
  chain: {
    label: '连锁弹射', icon: 'ϟ', color: '#7fb2ff', cat: '伤害',
    params: [T(), F(50, [{ src: 'caster', stat: 'atk', ratio: 0.9 }], 'magic'),
      { key: 'bounces', label: '弹射次数', type: 'number', def: 5, min: 1, max: 30, step: 1 },
      { key: 'range', label: '弹射范围', type: 'number', def: 6, min: 1, max: 20, step: 0.5 },
      { key: 'decay', label: '每次衰减', type: 'number', def: 0.15, min: -1, max: 0.9, step: 0.05 },
      { key: 'gap', label: '弹射间隔', type: 'number', def: 0.08, min: 0, max: 1, step: 0.02 },
      STYLE('storm'), ...BUFF],
    run(b, p, ctx) {
      let cur = b.resolveTargets(p.target, ctx)[0];
      if (!cur) return;
      let from = ctx.origin ? { ...ctx.origin, radius: 0.5 } : ctx.caster; const hit = new Set(); let mult = 1;
      const step = (i) => {
        if (!cur || i > p.bounces) return;
        b.fx.lightning(from, cur, p.style);
        b.dealDamage(ctx.caster, cur, evalFormula(p.formula, { ...ctx, target: cur }, b) * mult, { ...p.formula, ctx });
        if (p.buff) b.applyBuff(ctx.caster, cur, p.buff, p.stacks, ctx);
        hit.add(cur); mult *= 1 - p.decay;
        let pool = b.enemiesInRadius(ctx.caster, cur.x, cur.z, p.range).filter(u => !hit.has(u));
        if (!pool.length) { pool = b.enemiesInRadius(ctx.caster, cur.x, cur.z, p.range).filter(u => u !== cur); hit.clear(); }
        from = cur; cur = pool.sort((a, c) => b.dist(a, from) - b.dist(c, from))[0];
        b.schedule(p.gap, () => step(i + 1), ctx);
      };
      step(1);
    },
  },
  beam: {
    label: '引导光束', icon: '═', color: '#ffe066', cat: '伤害',
    params: [T(), F(15, [{ src: 'caster', stat: 'atk', ratio: 0.25 }], 'magic'),
      { key: 'duration', label: '持续时间', type: 'number', def: 2, min: 0.2, max: 10, step: 0.1 },
      { key: 'tick', label: '跳伤间隔', type: 'number', def: 0.2, min: 0.05, max: 2, step: 0.05 },
      { key: 'width', label: '宽度', type: 'number', def: 1, min: 0.2, max: 4, step: 0.1 },
      { key: 'ramp', label: '每跳增幅', type: 'number', def: 0.1, min: 0, max: 2, step: 0.05 },
      STYLE('holy'), ...BUFF],
    dur: p => p.duration,
    run(b, p, ctx) {
      const t = b.resolveTargets(p.target, ctx)[0];
      if (t) b.spawnBeam({ ...p, owner: ctx.caster, tgt: t, ctx });
    },
  },
  applyBuff: {
    label: '施加Buff', icon: '✚', color: '#c86bff', cat: '状态',
    params: [T(), { key: 'buff', label: 'Buff', type: 'buff', def: 'burn' },
      { key: 'stacks', label: '层数', type: 'number', def: 1, min: 1, max: 99, step: 1 },
      { key: 'duration', label: '持续(0=默认)', type: 'number', def: 0, min: 0, max: 60, step: 0.5 }],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) b.applyBuff(ctx.caster, t, p.buff, p.stacks, ctx, p.duration);
    },
  },
  removeBuff: {
    label: '移除Buff', icon: '✖', color: '#8a7dff', cat: '状态',
    params: [T(), { key: 'buff', label: 'Buff', type: 'buff', def: 'burn' },
      { key: 'stacks', label: '层数(0=全部)', type: 'number', def: 0, min: 0, max: 99, step: 1 }],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) b.removeBuff(t, p.buff, p.stacks);
    },
  },
  heal: {
    label: '治疗', icon: '❤', color: '#4dff9a', cat: '支援',
    params: [T('self'), F(50, [{ src: 'caster', stat: 'maxHp', ratio: 0.08 }], 'true')],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) b.heal(ctx.caster, t, evalFormula(p.formula, { ...ctx, target: t }, b), false, ctx);
    },
  },
  shield: {
    label: '护盾', icon: '⛨', color: '#6fe3ff', cat: '支援',
    params: [T('self'), F(0, [{ src: 'caster', stat: 'maxHp', ratio: 0.2 }], 'true'),
      { key: 'duration', label: '持续时间', type: 'number', def: 5, min: 0.5, max: 60, step: 0.5 }],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) b.addShield(ctx.caster, t, evalFormula(p.formula, { ...ctx, target: t }, b), p.duration);
    },
  },
  blink: {
    label: '闪现', icon: '✦', color: '#b3f0ff', cat: '位移',
    params: [{ key: 'mode', label: '方式', type: 'select', def: 'cursor', options: { cursor: '向鼠标', behind: '目标身后', away: '远离目标', target: '贴近目标' } },
      { key: 'distance', label: '最大距离', type: 'number', def: 6, min: 0.5, max: 20, step: 0.5 }, STYLE('arcane')],
    run(b, p, ctx) { b.blink(ctx.caster, p, ctx); },
  },
  dash: {
    label: '冲锋', icon: '➤', color: '#ffd23f', cat: '位移',
    params: [{ key: 'mode', label: '方向', type: 'select', def: 'cursor', options: { cursor: '向鼠标', target: '向目标', back: '后撤' } },
      { key: 'distance', label: '距离', type: 'number', def: 7, min: 0.5, max: 20, step: 0.5 },
      { key: 'speed', label: '速度', type: 'number', def: 28, min: 4, max: 80, step: 1 },
      F(30, [{ src: 'caster', stat: 'atk', ratio: 0.8 }]), STYLE('storm'), ...BUFF],
    dur: p => p.distance / p.speed,
    run(b, p, ctx) { b.dash(ctx.caster, p, ctx); },
  },
  knock: {
    label: '击退/拉拽', icon: '⇆', color: '#ffa8e0', cat: '位移',
    params: [T(), { key: 'distance', label: '距离(负=拉)', type: 'number', def: 3, min: -15, max: 15, step: 0.5 }],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) b.knock(t, ctx.caster.x, ctx.caster.z, p.distance);
    },
  },
  selfCost: {
    label: '自损代价', icon: '☠', color: '#ff2e4d', cat: '支援',
    params: [F(0, [{ src: 'caster', stat: 'hp', ratio: 0.1 }], 'true')],
    run(b, p, ctx) { b.loseHp(ctx.caster, evalFormula(p.formula, { ...ctx, target: ctx.caster }, b)); },
  },
  cooldown: {
    label: '冷却调整', icon: '↺', color: '#9dffb0', cat: '机制',
    params: [{ key: 'ability', label: '技能', type: 'ability', def: '*' },
      { key: 'amount', label: '减少秒数(0=重置)', type: 'number', def: 0, min: 0, max: 60, step: 0.5 }],
    run(b, p, ctx) { b.reduceCooldown(ctx.caster, p.ability, p.amount); },
  },
  castAbility: {
    label: '释放技能', icon: '⟲', color: '#ffb3ff', cat: '机制',
    params: [{ key: 'ability', label: '技能', type: 'ability', def: '' }],
    run(b, p, ctx) { b.freeCast(ctx.caster, p.ability, ctx); },
  },
  detonate: {
    label: '引爆层数', icon: '✺', color: '#ff6a00', cat: '伤害',
    params: [T(), { key: 'buff', label: '引爆Buff', type: 'buff', def: 'burn' },
      F(30, [{ src: 'caster', stat: 'atk', ratio: 0.3 }], 'magic'),
      { key: 'radius', label: '波及半径', type: 'number', def: 2.5, min: 0, max: 10, step: 0.25 },
      { key: 'consume', label: '消耗层数', type: 'bool', def: true }, STYLE('fire')],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) {
        const n = b.buffStacks(t, p.buff);
        if (!n) continue;
        const dmg = evalFormula(p.formula, { ...ctx, target: t }, b) * n;
        b.fx.explosion(t.x, t.z, Math.max(1.2, p.radius), p.style, 1 + n * 0.1);
        b.fx.text(t, `引爆×${n}`, STYLE_COLORS[p.style]);
        const victims = p.radius > 0 ? b.enemiesInRadius(ctx.caster, t.x, t.z, p.radius) : [t];
        if (p.consume) b.removeBuff(t, p.buff, 0);
        for (const v of victims) b.dealDamage(ctx.caster, v, v === t ? dmg : dmg * 0.5, { ...p.formula, ctx });
      }
    },
  },
  execute: {
    label: '斩杀', icon: '✝', color: '#ff0040', cat: '伤害',
    params: [T(), { key: 'threshold', label: '斩杀线(生命%)', type: 'number', def: 15, min: 1, max: 100, step: 1 },
      F(50, [{ src: 'target', stat: 'missingHp', ratio: 0.25 }], 'physical'), STYLE('blood')],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) {
        b.fx.strike(ctx.caster, t, 'pierce', p.style, 0);
        const pct = t.hp / b.stat(t, 'maxHp') * 100;
        if (pct <= p.threshold && !t.tpl.immortal) {
          b.fx.text(t, '斩杀!', '#ff0040'); b.fx.shake(0.6); b.hitstop(0.12);
          b.dealDamage(ctx.caster, t, t.hp + b.shieldOf(t) + 1, { type: 'true', ctx, label: ACTIONS.execute.label });
        } else b.dealDamage(ctx.caster, t, evalFormula(p.formula, { ...ctx, target: t }, b), { ...p.formula, ctx });
      }
    },
  },
  orbit: {
    label: '环绕法球', icon: '❂', color: '#ffcf6e', cat: '伤害',
    params: [{ key: 'count', label: '数量', type: 'number', def: 3, min: 1, max: 12, step: 1 },
      { key: 'radius', label: '环绕半径', type: 'number', def: 2, min: 0.8, max: 6, step: 0.1 },
      { key: 'duration', label: '持续时间', type: 'number', def: 5, min: 0.5, max: 30, step: 0.5 },
      { key: 'spin', label: '转速', type: 'number', def: 4, min: 0.5, max: 15, step: 0.5 },
      F(25, [{ src: 'caster', stat: 'atk', ratio: 0.35 }], 'magic'),
      { key: 'hitCd', label: '同目标间隔', type: 'number', def: 0.5, min: 0.1, max: 3, step: 0.05 },
      STYLE('arcane'), ...BUFF],
    dur: p => p.duration,
    run(b, p, ctx) { b.spawnOrbit({ ...p, owner: ctx.caster, ctx }); },
  },
  summon: {
    label: '召唤', icon: '♜', color: '#ffb347', cat: '召唤',
    params: [{ key: 'mode', label: '召唤物类型', type: 'select', options: SUMMON_MODES, def: 'totem', group: '召唤物' },
      { key: 'model', label: '外观', type: 'select', options: SUMMON_MODELS, def: 'auto' },
      C('self'), { key: 'count', label: '数量', type: 'number', def: 1, min: 1, max: 8, step: 1 },
      { key: 'ability', label: '召唤物施放技能', type: 'ability', def: '', group: '继承行为' },
      { key: 'every', label: '施放间隔', type: 'number', def: 1, min: 0.2, max: 10, step: 0.1 },
      { key: 'melee', label: '仆从近战普攻', type: 'bool', def: true },
      { key: 'deathAbility', label: '消失时触发技能', type: 'ability', def: '' },
      { key: 'duration', label: '存在时间', type: 'number', def: 6, min: 1, max: 60, step: 0.5, group: '属性继承' },
      { key: 'hpRatio', label: '生命(施法者%)', type: 'number', def: 0.3, min: 0.05, max: 3, step: 0.05 },
      { key: 'inherit', label: '继承攻击%', type: 'number', def: 0.6, min: 0, max: 3, step: 0.05 },
      { key: 'passives', label: '继承被动', type: 'bool', def: false }, STYLE('arcane')],
    dur: p => p.duration,
    run(b, p, ctx) { b.summon(ctx.caster, p, ctx); },
  },
  swap: {
    label: '换位', icon: '⇄', color: '#d0a8ff', cat: '位移',
    params: [T(), STYLE('shadow')],
    run(b, p, ctx) {
      const t = b.resolveTargets(p.target, ctx)[0], c = ctx.caster;
      if (!t || t === c) return;
      const a = { x: c.x, z: c.z }, d = { x: t.x, z: t.z };
      if (!t.tpl.unmovable) { t.x = a.x; t.z = a.z; }
      b.fx.blink(t, d, a, p.style);
      c.x = d.x; c.z = d.z; b.fx.blink(c, a, d, p.style);
    },
  },
  branch: {
    label: '条件分支', icon: '⋔', color: '#00e5c0', cat: '机制',
    params: [{ key: 'cond', label: '条件', type: 'cond', def: { type: 'hasBuff', subject: 'other', buff: 'burn', stacks: 3, op: '<', value: 50 } },
      { key: 'then', label: '满足则释放', type: 'ability', def: '' },
      { key: 'else', label: '否则释放', type: 'ability', def: '' }],
    run(b, p, ctx) {
      const other = b.resolveTargets('target', ctx)[0];
      const ok = b.checkCond(p.cond, ctx.caster, other);
      b.fx.text(ctx.caster, ok ? '✓分支' : '✗分支', ok ? '#00e5c0' : '#888');
      const id = ok ? p.then : p.else;
      if (id) b.freeCast(ctx.caster, id, ctx);
    },
  },
  repeat: {
    label: '循环施放', icon: '∞', color: '#ff7ad9', cat: '机制',
    params: [{ key: 'ability', label: '技能', type: 'ability', def: '' },
      { key: 'times', label: '次数', type: 'number', def: 3, min: 1, max: 20, step: 1 },
      { key: 'gap', label: '间隔', type: 'number', def: 0.3, min: 0, max: 5, step: 0.05 }],
    dur: p => (p.times - 1) * p.gap,
    run(b, p, ctx) {
      if (!p.ability) return;
      for (let i = 0; i < p.times; i++) b.schedule(i * p.gap, () => b.freeCast(ctx.caster, p.ability, ctx), ctx);
    },
  },
  spread: {
    label: '传染扩散', icon: '☣', color: '#a6ff00', cat: '状态',
    params: [T(), { key: 'buff', label: 'Buff', type: 'buff', def: 'poison' },
      { key: 'radius', label: '扩散半径', type: 'number', def: 4, min: 1, max: 12, step: 0.5 },
      { key: 'ratio', label: '层数比例', type: 'number', def: 1, min: 0.1, max: 2, step: 0.1 }, STYLE('poison')],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) {
        const n = Math.ceil(b.buffStacks(t, p.buff) * p.ratio);
        if (!n) continue;
        for (const o of b.enemiesInRadius(ctx.caster, t.x, t.z, p.radius)) {
          if (o === t) continue;
          b.fx.lightning(t, o, p.style);
          b.applyBuff(ctx.caster, o, p.buff, n, ctx);
        }
      }
    },
  },
  cleanse: {
    label: '净化', icon: '❈', color: '#e0fff8', cat: '状态',
    params: [T('self'), { key: 'which', label: '移除', type: 'select', def: 'debuff', options: { debuff: '负面', buff: '正面', all: '全部' } }],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) {
        const n = t.buffs.length;
        t.buffs = t.buffs.filter(x => p.which === 'all' ? false : p.which === 'debuff' ? !x.def.debuff : x.def.debuff);
        if (n !== t.buffs.length) { b.fx.text(t, '净化', '#e0fff8'); b.fx.heal(t); }
      }
    },
  },
  mana: {
    label: '法力操作', icon: '◆', color: '#4d8bff', cat: '支援',
    params: [T('self'), { key: 'mode', label: '方式', type: 'select', def: 'gain', options: { gain: '回复', drain: '吸取' } },
      { key: 'amount', label: '数值', type: 'number', def: 40, min: 0, max: 1000, step: 5 }],
    run(b, p, ctx) {
      for (const t of b.resolveTargets(p.target, ctx)) {
        if (p.mode === 'gain') { t.mana = Math.min(t.base.maxMana || 0, t.mana + p.amount); b.fx.text(t, `+${p.amount}MP`, '#4d8bff'); }
        else { const d = Math.min(t.mana, p.amount); t.mana -= d; ctx.caster.mana = Math.min(ctx.caster.base.maxMana || 0, ctx.caster.mana + d); b.fx.lightning(t, ctx.caster, 'arcane'); }
      }
    },
  },
  vfx: {
    label: '镜头特效', icon: '☄', color: '#ffffff', cat: '机制',
    params: [{ key: 'shake', label: '震屏', type: 'number', def: 0.4, min: 0, max: 2, step: 0.05 },
      { key: 'hitstop', label: '顿帧(秒)', type: 'number', def: 0, min: 0, max: 0.5, step: 0.01 },
      { key: 'flash', label: '闪屏颜色', type: 'color', def: '#ffffff' },
      { key: 'flashAlpha', label: '闪屏强度', type: 'number', def: 0, min: 0, max: 1, step: 0.05 },
      { key: 'text', label: '飘字', type: 'text', def: '' }],
    run(b, p, ctx) {
      if (p.shake) b.fx.shake(p.shake);
      if (p.hitstop) b.hitstop(p.hitstop);
      if (p.flashAlpha) b.fx.flash(p.flash, p.flashAlpha);
      if (p.text) b.fx.text(ctx.caster, p.text, '#ffe066');
    },
  },
};

export function defaultParams(type) {
  const p = {};
  for (const d of ACTIONS[type].params) p[d.key] = structuredClone(d.def);
  return p;
}
export function blockDur(block) {
  const a = ACTIONS[block.type];
  return a?.dur ? Math.max(0, a.dur(block.p)) : 0;
}
