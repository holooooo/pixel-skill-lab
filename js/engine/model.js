// 数值模型：属性、公式、伤害类型、触发器/条件定义
export const STAT_DEFS = [
  { key: 'maxHp', label: '最大生命', step: 50 },
  { key: 'atk', label: '攻击力', step: 5 },
  { key: 'armor', label: '护甲', step: 5 },
  { key: 'res', label: '魔抗', step: 5 },
  { key: 'critChance', label: '暴击率', step: 0.05, pct: true },
  { key: 'critDmg', label: '暴击倍率', step: 0.05 },
  { key: 'atkSpeed', label: '攻速/秒', step: 0.1 },
  { key: 'moveSpeed', label: '移速', step: 0.5 },
  { key: 'lifesteal', label: '吸血', step: 0.05, pct: true },
  { key: 'dodge', label: '闪避率', step: 0.05, pct: true },
  { key: 'maxMana', label: '最大法力', step: 10 },
  { key: 'manaRegen', label: '法力回复', step: 1 },
  { key: 'hpRegen', label: '生命回复', step: 1 },
  { key: 'cdr', label: '冷却缩减', step: 0.05, pct: true },
];

// 额外可被 Buff 修改的属性（只存在于修正中）
export const MOD_KEYS = {
  atkPct: '攻击力%', atk: '攻击力', armor: '护甲', armorPct: '护甲%', res: '魔抗',
  maxHpPct: '最大生命%', critChance: '暴击率', critDmg: '暴击倍率', atkSpeedPct: '攻速%',
  moveSpeedPct: '移速%', lifesteal: '吸血', dmgDealtPct: '造成伤害%', dmgTakenPct: '受到伤害%',
  cdr: '冷却缩减', hpRegen: '生命回复', manaRegen: '法力回复', dodge: '闪避率',
  healTakenPct: '受治疗%',
};

// Buff 着色特效（buff.vfx = [{ type, color?, intensity?, speed? }]）：type 为下列内置着色器之一
export const VFX_TYPES = {
  glow: '辉光', flash: '闪烁', bleed: '流血', burn: '燃烧', poison: '毒雾', frost: '冰霜', shock: '电弧',
};

export const SCALE_STATS = {
  atk: '攻击力', maxHp: '最大生命', hp: '当前生命', missingHp: '已损生命',
  armor: '护甲', res: '魔抗', mana: '当前法力', eventAmount: '事件数值', buffStacks: 'Buff层数', buffRemain: 'Buff剩余跳伤',
};
export const SCALE_SRC = { caster: '施法者', target: '目标' };
export const DMG_TYPES = { physical: '物理', magic: '魔法', true: '真实' };

// 触发器：subject = 被动持有者在事件中的角色；other = ctx.target
export const TRIGGERS = {
  onHit:       { label: '造成伤害时', subject: 'source', other: 'target' },
  onCrit:      { label: '暴击时',     subject: 'source', other: 'target' },
  onDamaged:   { label: '受到伤害时', subject: 'target', other: 'source' },
  onKill:      { label: '击杀时',     subject: 'source', other: 'target' },
  onCast:      { label: '施放技能时', subject: 'source', other: 'target' },
  onBuffGained:{ label: '获得Buff时', subject: 'target', other: 'source', buffFilter: true },
  onBuffApplied:{ label: '施加Buff时', subject: 'source', other: 'target', buffFilter: true },
  onLowHp:     { label: '生命低于阈值', subject: 'target', other: 'source', pct: true },
  onShieldBreak:{ label: '护盾破碎时', subject: 'target', other: 'source' },
  onDodge:     { label: '闪避攻击时', subject: 'target', other: 'source' },
  onHeal:      { label: '受到治疗时', subject: 'target', other: 'source' },
  onBuffExpired:{ label: 'Buff结束时', subject: 'target', other: 'source', buffFilter: true },
  onMove:      { label: '闪现/冲锋时', subject: 'source', other: 'target' },
  onEnemyDeath:{ label: '附近敌人死亡', subject: null, other: 'target', radius: true },
  onSpawn:     { label: '复活/登场时', subject: 'target', other: null },
  interval:    { label: '每隔N秒',    subject: null, every: true },
};

export const SOURCE_KINDS = { any: '任意', attack: '普攻', skill: '技能', dot: '持续伤害', proc: '被动触发' };

export const CONDITIONS = {
  hasBuff:  { label: '拥有Buff' },
  noBuff:   { label: '没有Buff' },
  hpPct:    { label: '生命百分比' },
  chance:   { label: '概率' },
  distance: { label: '距离' },
  manaPct:  { label: '法力百分比' },
  hasShield:{ label: '拥有护盾' },
  casting:  { label: '正在施法' },
  stunned:  { label: '被控制中' },
};
export const COND_SUBJECTS = { self: '自身', other: '对方' };

export function newFormula(base = 0, rows = [], type = 'physical', canCrit = true) {
  return { base, rows, type, canCrit };
}

// 计算公式原始值（减伤前）
export function evalFormula(f, ctx, battle) {
  if (!f) return 0;
  let v = Number(f.base) || 0;
  for (const r of f.rows || []) {
    const u = r.src === 'target' ? ctx.target : ctx.caster;
    v += scaleValue(r, u, ctx, battle) * (Number(r.ratio) || 0);
  }
  return Math.max(0, v);
}

function scaleValue(r, u, ctx, battle) {
  if (r.stat === 'eventAmount') return ctx.event?.amount || 0;
  if (!u) return 0;
  switch (r.stat) {
    case 'hp': return u.hp;
    case 'missingHp': return battle.stat(u, 'maxHp') - u.hp;
    case 'mana': return u.mana;
    case 'buffStacks': return battle.buffStacks(u, r.buff);
    case 'buffRemain': return battle.buffRemain(u, r.buff);
    default: return battle.stat(u, r.stat);
  }
}

export function formulaText(f) {
  if (!f) return '';
  const parts = [];
  if (f.base) parts.push(String(f.base));
  for (const r of f.rows || []) {
    const s = r.stat === 'buffStacks' ? `${r.buff}层` : r.stat === 'buffRemain' ? `${r.buff}剩余跳伤` : SCALE_STATS[r.stat];
    const src = r.stat === 'eventAmount' ? '' : (r.src === 'target' ? '目标' : '');
    parts.push(`${fmtRatio(r.ratio, r.stat)}${src}${s}`);
  }
  return (parts.join(' + ') || '0') + ` [${DMG_TYPES[f.type] || ''}]`;
}
function fmtRatio(r, stat) {
  if (stat === 'buffStacks') return `${r}×`;
  return `${Math.round(r * 100)}%`;
}

export const uid = (p = 'b') => p + Math.random().toString(36).slice(2, 8);
