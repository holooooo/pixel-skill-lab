// 编辑器：技能库、时间轴、检查器
import { ACTIONS, defaultParams, blockDur, TARGETS } from './engine/actions.js';
import { abilityDuration } from './engine/battle.js';
import { TRIGGERS, CONDITIONS, COND_SUBJECTS, SOURCE_KINDS, SCALE_STATS, SCALE_SRC, DMG_TYPES, MOD_KEYS, VFX_TYPES, STAT_DEFS, evalFormula, formulaText, uid } from './engine/model.js';
import { exportAbilities, copyText } from './store.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
export const icon = (a, cls = '') => h('div', { class: `ico ${a.kind === 'passive' ? 'passive' : ''} ${cls}`, style: { '--c': a.color } }, a.icon || '?');

// ---------- 基础表单组件 ----------
function selectEl(options, value, onChange, cls = '') {
  const s = h('select', { class: cls });
  for (const [k, v] of Object.entries(options)) s.append(h('option', { value: k, selected: String(k) === String(value) }, v));
  s.onchange = () => onChange(s.value);
  return s;
}
function numberEl(def, value, onChange) {
  const row = h('div', { class: 'numrow' });
  const n = h('input', { type: 'number', value, step: def.step ?? 1, min: def.min, max: def.max });
  const r = h('input', { type: 'range', value, step: def.step ?? 1, min: def.min ?? 0, max: def.max ?? 100 });
  r.value = value; n.value = value;
  n.oninput = () => { r.value = n.value; onChange(parseFloat(n.value) || 0); };
  r.oninput = () => { n.value = r.value; onChange(parseFloat(r.value)); };
  row.append(r, n);
  return row;
}
const field = (label, el) => h('div', { class: 'field' }, h('label', {}, label), el);

function formulaEl(app, f, onChange, preview) {
  const box = h('div', { class: 'formula' });
  const redraw = () => {
    box.innerHTML = '';
    const head = h('div', { class: 'frow' },
      h('span', {}, '基础'),
      (() => { const i = h('input', { type: 'number', value: f.base, step: 5 }); i.oninput = () => { f.base = parseFloat(i.value) || 0; changed(); }; return i; })(),
      selectEl(DMG_TYPES, f.type, v => { f.type = v; changed(); }),
      h('label', { title: '可暴击' }, (() => { const c = h('input', { type: 'checkbox', checked: f.canCrit }); c.onchange = () => { f.canCrit = c.checked; changed(); }; return c; })(), '暴'));
    box.append(head);
    (f.rows || []).forEach((r, i) => {
      const row = h('div', { class: 'frow' },
        h('span', {}, '+'),
        (() => { const n = h('input', { type: 'number', value: r.ratio, step: r.stat === 'buffStacks' ? 1 : 0.05, title: r.stat === 'buffStacks' ? '每层数值' : '系数(1=100%)' }); n.oninput = () => { r.ratio = parseFloat(n.value) || 0; changed(); }; return n; })(),
        h('span', {}, '×'),
        selectEl(SCALE_SRC, r.src, v => { r.src = v; changed(); }),
        selectEl(SCALE_STATS, r.stat, v => { r.stat = v; if ((v === 'buffStacks' || v === 'buffRemain') && !r.buff) r.buff = Object.keys(app.lib.buffs)[0]; changed(); redraw(); }),
        (r.stat === 'buffStacks' || r.stat === 'buffRemain') ? selectEl(buffOptions(app), r.buff, v => { r.buff = v; changed(); }) : null,
        h('button', { class: 'xbtn', onclick: () => { f.rows.splice(i, 1); changed(); redraw(); } }, '✕'));
      box.append(row);
    });
    box.append(h('button', { class: 'btn small', onclick: () => { (f.rows ||= []).push({ src: 'caster', stat: 'atk', ratio: 0.5 }); changed(); redraw(); } }, '＋ 属性加成'));
    prev = h('div', { class: 'fprev' }); box.append(prev); updPrev();
  };
  let prev;
  const updPrev = () => { if (prev) prev.innerHTML = preview ? preview(f) : ''; };
  const changed = () => { onChange(f); updPrev(); };
  redraw();
  return box;
}
const buffOptions = (app, none) => ({ ...(none ? { '': '— 无 —' } : {}), ...Object.fromEntries(Object.values(app.lib.buffs).map(b => [b.id, `${b.icon} ${b.name}`])) });
const abilityOptions = (app, extra = {}) => ({ ...extra, ...Object.fromEntries(Object.values(app.lib.abilities).filter(a => a.kind === 'active' && !a.enemy).map(a => [a.id, `${a.name}${a.sub ? ' (子)' : ''}`])) });

function condEl(app, c, onChange, onDelete) {
  const box = h('div', { class: 'cond' });
  const redraw = () => {
    box.innerHTML = '';
    const ch = () => onChange(c);
    box.append(selectEl(Object.fromEntries(Object.entries(CONDITIONS).map(([k, v]) => [k, v.label])), c.type, v => { c.type = v; ch(); redraw(); }));
    if (!['chance', 'distance'].includes(c.type)) box.append(selectEl(COND_SUBJECTS, c.subject || 'self', v => { c.subject = v; ch(); }));
    if (c.type === 'hasBuff' || c.type === 'noBuff') {
      box.append(selectEl(buffOptions(app), c.buff, v => { c.buff = v; ch(); }));
      if (c.type === 'hasBuff') { box.append('≥'); const n = h('input', { type: 'number', value: c.stacks ?? 1, min: 1 }); n.oninput = () => { c.stacks = +n.value; ch(); }; box.append(n, '层'); }
    }
    if (['hpPct', 'manaPct', 'distance'].includes(c.type)) {
      box.append(selectEl({ '<': '<', '>': '>' }, c.op || '<', v => { c.op = v; ch(); }));
      const n = h('input', { type: 'number', value: c.value ?? 50 }); n.oninput = () => { c.value = +n.value; ch(); }; box.append(n, c.type === 'distance' ? '米' : '%');
    }
    if (c.type === 'chance') { const n = h('input', { type: 'number', value: c.value ?? 50, min: 0, max: 100 }); n.oninput = () => { c.value = +n.value; ch(); }; box.append(n, '%'); }
    if (onDelete) box.append(h('button', { class: 'xbtn', onclick: onDelete }, '✕'));
  };
  redraw();
  return box;
}

// =============== 技能库 ===============
export function renderLibrary(app) {
  const list = document.getElementById('libList');
  const q = document.getElementById('libSearch').value.trim();
  const tab = app.sel.tab;
  list.innerHTML = '';
  document.querySelectorAll('#libTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('btnNew').style.display = tab === 'unit' ? 'none' : '';
  if (tab === 'unit') return renderUnitPanel(app, list);
  if (tab === 'buff') {
    for (const b of Object.values(app.lib.buffs)) {
      if (q && !b.name.includes(q)) continue;
      const c = h('div', { class: 'card' + (app.sel.buffId === b.id ? ' sel' : ''), onclick: () => { app.sel.buffId = b.id; app.refresh(); } },
        h('div', { class: 'ico', style: { '--c': b.color, width: '28px', height: '28px', flex: '0 0 28px', fontSize: '14px' } }, b.icon),
        h('div', { class: 'meta' }, h('div', { class: 'nm' }, b.name, ' ', h('span', { class: 'eq', style: { color: b.debuff ? '#ff8ca0' : '#4dff9a' } }, b.debuff ? 'DEBUFF' : 'BUFF')),
          h('div', { class: 'sub' }, `${b.duration}s · 最多${b.maxStacks}层${b.tick ? ' · 跳' + (b.tickKind === 'heal' ? '疗' : '伤') : ''}`)),
        h('div', { class: 'acts' }, h('button', { title: '删除', onclick: (e) => { e.stopPropagation(); if (confirm(`删除 Buff「${b.name}」?`)) { delete app.lib.buffs[b.id]; app.save(); app.refresh(); } } }, '✕')));
      list.append(c);
    }
    return;
  }
  const lo = app.lib.hero.loadout;
  const all = Object.values(app.lib.abilities).filter(a => a.kind === tab && !a.enemy && (!q || a.name.includes(q) || (a.desc || '').includes(q)));
  const equipped = tab === 'active' ? lo.skills : lo.passives;
  const groups = [
    ['已装备', all.filter(a => equipped.includes(a.id)).sort((x, y) => equipped.indexOf(x.id) - equipped.indexOf(y.id))],
    [tab === 'active' ? '技能库' : '被动库', all.filter(a => !equipped.includes(a.id) && !a.sub)],
    ['子技能 (供 召唤/循环/分支 调用)', all.filter(a => !equipped.includes(a.id) && a.sub)],
  ];
  for (const [title, items] of groups) {
    if (!items.length) continue;
    list.append(h('div', { class: 'lib-group' }, title));
    for (const a of items) list.append(abilityCard(app, a, equipped));
  }
}

function abilityCard(app, a, equipped) {
  const isEq = equipped.includes(a.id);
  const sub = a.kind === 'passive'
    ? `${TRIGGERS[a.trigger?.event]?.label || '?'}${a.conditions?.length ? ` · ${a.conditions.length}条件` : ''}${a.icd ? ` · ICD ${a.icd}s` : ''}`
    : `CD ${a.cooldown}s · ${a.manaCost}MP · ${a.timeline.length}个动作`;
  const c = h('div', { class: 'card' + (app.sel.abilityId === a.id ? ' sel' : ''), draggable: 'true',
    onclick: () => { app.selectAbility(a.id); },
    ondragstart: (e) => { e.dataTransfer.setData('text/ability', a.id); e.dataTransfer.effectAllowed = 'copy'; } },
  icon(a),
  h('div', { class: 'meta' }, h('div', { class: 'nm' }, a.name, ' ', isEq ? h('span', { class: 'eq' }, '● 装备中') : null), h('div', { class: 'sub' }, sub)),
  h('div', { class: 'acts' },
    !a.sub ? h('button', { title: isEq ? '卸下' : '装备', onclick: (e) => { e.stopPropagation(); app.toggleEquip(a.id); } }, isEq ? '卸' : '装') : null,
    h('button', { title: '导出到剪贴板', onclick: async (e) => { e.stopPropagation(); await copyText(exportAbilities(app.lib, [a.id])); app.toast(`已复制「${a.name}」到剪贴板（含依赖的Buff与子技能）`); } }, '⇧'),
    h('button', { title: '复制一份', onclick: (e) => { e.stopPropagation(); app.duplicate(a.id); } }, '⧉'),
    h('button', { title: '删除', onclick: (e) => { e.stopPropagation(); if (confirm(`删除「${a.name}」?`)) app.removeAbility(a.id); } }, '✕')));
  return c;
}

function renderUnitPanel(app, list) {
  const b = app.battle;
  list.append(h('div', { class: 'lib-group' }, '生成敌人'));
  const sp = h('div', { class: 'row-btns' });
  for (const [k, t] of Object.entries(app.enemyTemplates)) sp.append(h('button', { class: 'btn small', onclick: () => app.spawnEnemy(k) }, `＋ ${t.name}`));
  sp.append(h('button', { class: 'btn small danger', onclick: () => app.clearEnemies() }, '清空敌人'));
  sp.append(h('button', { class: 'btn small', onclick: () => app.resetArena() }, '重置场景'));
  list.append(sp);
  list.append(h('div', { class: 'lib-group' }, '场景规则'));
  const tog = (label, key) => { const c = h('input', { type: 'checkbox', checked: b.settings[key] }); c.onchange = () => { b.settings[key] = c.checked; }; return h('label', { class: 'field', style: { gridTemplateColumns: '20px 1fr' } }, c, label); };
  list.append(tog('敌人主动攻击（触发受击类被动）', 'enemyAggro'), tog('敌人死亡后复活', 'respawn'), tog('英雄无敌（不会死亡）', 'godMode'));
  list.append(h('div', { class: 'lib-group' }, '画面'));
  const px = numberEl({ min: 1, max: 6, step: 1 }, app.arena.pixel, v => app.arena.setPixel(v));
  list.append(field('像素尺寸', px));
  const bl = numberEl({ min: 0, max: 2.5, step: 0.05 }, app.arena.bloom.strength, v => { app.arena.bloom.strength = v; });
  list.append(field('泛光强度', bl));
  list.append(h('div', { class: 'lib-group' }, '统计'));
  list.append(h('button', { class: 'btn small', onclick: () => b.resetMeter() }, '重置伤害统计'));
  list.append(h('p', { class: 'help' }, '训练木桩：高血量高回复，适合测试DPS；史莱姆：近战小怪会主动攻击；熔岩巨像：Boss，带范围重击与弹幕技能，可测试护盾/受击/斩杀。'));
}

// =============== 时间轴 ===============
export function initTimeline(app) {
  const pal = document.getElementById('palette');
  const cats = {};
  for (const [k, a] of Object.entries(ACTIONS)) (cats[a.cat] ||= []).push([k, a]);
  for (const [cat, items] of Object.entries(cats)) {
    pal.append(h('div', { class: 'cat' }, cat));
    for (const [k, a] of items) {
      const chip = h('div', { class: 'pchip', style: { '--c': a.color }, title: `拖到轨道上，或单击追加` }, `${a.icon} ${a.label}`);
      chip.addEventListener('pointerdown', (e) => startPaletteDrag(app, e, k, chip));
      pal.append(chip);
    }
  }
  document.getElementById('tlZoom').oninput = (e) => { app.tl.zoom = +e.target.value; renderTimeline(app); };
  document.getElementById('tlSnap').onchange = (e) => { app.tl.snap = +e.target.value; };
  document.getElementById('tracks').addEventListener('pointerdown', (e) => {
    if (e.target.closest('.block')) return;
    if (app.sel.blockId) { app.sel.blockId = null; renderTimeline(app); renderInspector(app); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const a = app.curAbility();
    if (!a || !app.sel.blockId) return;
    const i = a.timeline.findIndex(b => b.id === app.sel.blockId);
    if (i < 0) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { a.timeline.splice(i, 1); app.sel.blockId = null; app.changed(true); e.preventDefault(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); dupBlock(app, a, a.timeline[i]); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const st = app.tl.snap || 0.05;
      a.timeline[i].t = Math.max(0, +(a.timeline[i].t + (e.key === 'ArrowRight' ? st : -st)).toFixed(3));
      app.changed(true); e.preventDefault();
    }
  });
}
function dupBlock(app, a, b) {
  const nb = { ...structuredClone(b), id: uid(), t: +(b.t + Math.max(0.1, blockDur(b))).toFixed(2) };
  a.timeline.push(nb); app.sel.blockId = nb.id; app.changed(true);
}
const LEFT = 8;
function snapT(app, t) { const s = app.tl.snap; return Math.max(0, s ? Math.round(t / s) * s : t); }

function startPaletteDrag(app, e, type, chip) {
  e.preventDefault();
  const ghost = chip.cloneNode(true); ghost.classList.add('drag-ghost'); document.body.append(ghost);
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  const mv = (ev) => {
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) moved = true;
    ghost.style.left = ev.clientX + 6 + 'px'; ghost.style.top = ev.clientY + 6 + 'px';
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove();
    const a = app.curAbility();
    if (!a) return app.toast('请先在左侧选择一个技能或被动');
    const tr = document.getElementById('tracks').getBoundingClientRect();
    let t, track;
    if (moved) {
      if (ev.clientX < tr.left || ev.clientY < tr.top || ev.clientX > tr.right || ev.clientY > tr.bottom) return;
      t = snapT(app, (ev.clientX - tr.left - LEFT) / app.tl.zoom);
      track = Math.max(0, Math.floor((ev.clientY - tr.top - 20) / 34));
    } else {
      const sel = a.timeline.find(b => b.id === app.sel.blockId);
      t = sel ? +(sel.t + blockDur(sel)).toFixed(2) : 0;
      const used = new Set(a.timeline.filter(b => Math.abs(b.t - t) < 0.3).map(b => b.track));
      track = 0; while (used.has(track)) track++;
    }
    const nb = { id: uid(), type, t: +t.toFixed(3), track, p: defaultParams(type) };
    a.timeline.push(nb); app.sel.blockId = nb.id; app.changed(true);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  mv(e);
}

function blockSummary(app, b) {
  const p = b.p;
  const bits = [];
  if (p.formula && (p.formula.base || p.formula.rows?.length)) bits.push(formulaText(p.formula));
  if (p.buff && app.lib.buffs[p.buff]) bits.push(`+${app.lib.buffs[p.buff].name}${p.stacks > 1 ? '×' + p.stacks : ''}`);
  if (p.ability && app.lib.abilities[p.ability]) bits.push(`→${app.lib.abilities[p.ability].name}`);
  if (p.ability === '*') bits.push('全部技能');
  if (b.type === 'blink' || b.type === 'dash') bits.push(p.mode);
  if (p.text) bits.push(`"${p.text}"`);
  return bits.join(' ');
}

export function renderTimeline(app) {
  const a = app.curAbility();
  const tracks = document.getElementById('tracks');
  const title = document.getElementById('tlTitle');
  const flow = document.getElementById('tlFlow');
  tracks.innerHTML = ''; title.innerHTML = ''; flow.innerHTML = '';
  if (!a) { tracks.append(h('div', { class: 'tl-empty' }, '← 从左侧选择一个技能 / 被动开始编辑')); return; }
  const dur = abilityDuration(a);
  title.append(icon(a), h('span', {}, a.name), h('small', {}, `${dur.toFixed(2)}s`));
  renderFlow(app, a, flow);
  const Z = app.tl.zoom;
  const total = Math.max(dur + 1.5, 4);
  const W = LEFT + total * Z + 40;
  const nTracks = Math.max(4, ...a.timeline.map(b => b.track + 2));
  tracks.style.width = W + 'px';
  const ruler = h('div', { class: 'ruler', style: { width: W + 'px' } });
  const step = Z >= 150 ? 0.1 : 0.25;
  for (let t = 0; t <= total + 1e-6; t = +(t + step).toFixed(3)) {
    const major = Math.abs(t * 2 - Math.round(t * 2)) < 1e-6;
    ruler.append(h('div', { class: 'tick' + (major ? '' : ' minor'), style: { left: LEFT + t * Z + 'px' } }, major ? `${t}s` : ''));
  }
  tracks.append(ruler);
  const rows = [];
  for (let i = 0; i < nTracks; i++) {
    const r = h('div', { class: 'track' }, h('div', { class: 'tname' }, `T${i + 1}`));
    rows.push(r); tracks.append(r);
  }
  for (const b of a.timeline) {
    const def = ACTIONS[b.type]; if (!def) continue;
    const d = blockDur(b);
    const el = h('div', { class: 'block' + (b.id === app.sel.blockId ? ' sel' : ''), style: { '--c': def.color, left: LEFT + b.t * Z + 'px', width: Math.max(30, d * Z) + 'px' }, title: `${def.label} @ ${b.t}s` },
      h('span', { class: 'bi2' }, def.icon), h('span', {}, def.label), h('span', { class: 'bt' }, `${b.t.toFixed(2)}s ${blockSummary(app, b)}`));
    el.addEventListener('pointerdown', (e) => dragBlock(app, e, b, el));
    (rows[b.track] || rows[0]).append(el);
  }
  if (!a.timeline.length) tracks.append(h('div', { class: 'tl-empty' }, '时间轴为空：从左侧动作面板拖入积木'));
  app.tl.playhead = h('div', { class: 'playhead', style: { display: 'none' } });
  tracks.append(app.tl.playhead);
}

function renderFlow(app, a, flow) {
  const node = (tag, text, c) => h('div', { class: 'flow-node', style: { '--c': c }, onclick: () => { app.sel.blockId = null; renderTimeline(app); renderInspector(app); } }, h('b', {}, tag), text);
  const arrow = () => h('span', { class: 'flow-arrow' }, '▸');
  if (a.kind === 'passive') {
    const tr = a.trigger || {};
    let ev = TRIGGERS[tr.event]?.label || '?';
    if (tr.kind && tr.kind !== 'any') ev += `(${SOURCE_KINDS[tr.kind]})`;
    if (tr.buff) ev += `[${app.lib.buffs[tr.buff]?.name || tr.buff}]`;
    if (tr.event === 'onLowHp') ev += ` <${tr.pct ?? 30}%`;
    if (tr.event === 'interval') ev = `每 ${tr.every || 3}s`;
    flow.append(node('WHEN', ev, '#ffe066'));
    for (const c of a.conditions || []) {
      flow.append(arrow());
      let t = CONDITIONS[c.type]?.label || c.type;
      if (c.buff) t += ` ${app.lib.buffs[c.buff]?.name || c.buff}${c.stacks > 1 ? '≥' + c.stacks : ''}`;
      if (['hpPct', 'manaPct', 'distance'].includes(c.type)) t += ` ${c.op || '<'}${c.value}`;
      if (c.type === 'chance') t += ` ${c.value}%`;
      flow.append(node('IF', `${c.subject === 'other' ? '对方' : c.type === 'chance' ? '' : '自身'}${t}`, '#00e5c0'));
    }
    if (a.icd) { flow.append(arrow()); flow.append(node('ICD', `${a.icd}s`, '#8f86b8')); }
    flow.append(arrow()); flow.append(node('THEN', `${a.timeline.length} 个动作`, '#b16bff'));
  } else {
    flow.append(node('CAST', { unit: '指定单位', point: '指向地面', self: '自身' }[a.targeting] || a.targeting, '#ffe066'), arrow(),
      node('COST', `${a.manaCost}MP / CD ${a.cooldown}s`, '#6fe3ff'), arrow(), node('RUN', `${a.timeline.length} 个动作${a.root ? ' · 定身' : ''}`, '#b16bff'));
  }
}

function dragBlock(app, e, b, el) {
  e.preventDefault(); e.stopPropagation();
  const a = app.curAbility();
  if (app.sel.blockId !== b.id) { app.sel.blockId = b.id; document.querySelectorAll('.block.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); renderInspector(app); }
  const sx = e.clientX, sy = e.clientY, t0 = b.t, tr0 = b.track;
  let moved = false;
  el.classList.add('dragging');
  const rows = [...document.querySelectorAll('#tracks .track')];
  const mv = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    b.t = +snapT(app, t0 + dx / app.tl.zoom).toFixed(3);
    b.track = Math.max(0, Math.min(rows.length - 1, tr0 + Math.round(dy / 34)));
    el.style.left = LEFT + b.t * app.tl.zoom + 'px';
    if (el.parentElement !== rows[b.track]) rows[b.track].append(el);
    el.querySelector('.bt').textContent = `${b.t.toFixed(2)}s ${blockSummary(app, b)}`;
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    el.classList.remove('dragging');
    if (moved) app.changed(true);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  void a;
}

export function updatePlayhead(app) {
  const ph = app.tl.playhead, a = app.curAbility();
  if (!ph || !a) return;
  const b = app.battle;
  const run = [...b.runs].reverse().find(r => r.ability === a.id && b.time <= r.end && r.unit.team === 0);
  if (!run) { ph.style.display = 'none'; return; }
  ph.style.display = '';
  ph.style.left = LEFT + (b.time - run.start) * app.tl.zoom + 'px';
}

// =============== 检查器 ===============
export function renderInspector(app) {
  const root = document.getElementById('inspector');
  root.innerHTML = '';
  const tab = app.sel.tab;
  if (tab === 'buff') return buffInspector(app, root);
  if (tab === 'unit') return heroInspector(app, root);
  const a = app.curAbility();
  if (!a) { root.append(h('p', { class: 'help' }, '选择一个技能或被动以编辑其属性。')); return; }
  const blk = a.timeline.find(b => b.id === app.sel.blockId);
  if (blk) return blockInspector(app, root, a, blk);
  abilityInspector(app, root, a);
}

function previewFn(app) {
  return (f) => {
    const b = app.battle, hero = b.hero;
    if (!hero) return '';
    const tgt = hero.target?.alive ? hero.target : b.nearestEnemy(hero) || hero;
    const raw = evalFormula(f, { caster: hero, target: tgt, event: { amount: 100 } }, b);
    let after = raw;
    if (f.type !== 'true') after = raw * 100 / (100 + b.stat(tgt, f.type === 'magic' ? 'res' : 'armor'));
    const cr = f.canCrit ? ` · 暴击≈<b>${Math.round(after * b.stat(hero, 'critDmg'))}</b>` : '';
    return `公式: ${formulaText(f)}<br>当前数值 <b>${Math.round(raw)}</b> → 对【${tgt.name}】减免后≈<b>${Math.round(after)}</b>${cr}`;
  };
}

function abilityInspector(app, root, a) {
  const ch = () => app.changed(false);
  root.append(h('h3', {}, icon(a), a.name));
  if (a.desc) root.append(h('p', { class: 'help' }, a.desc));
  root.append(h('div', { class: 'sec' }, '基础属性'));
  const text = (label, key, multi) => {
    const i = h(multi ? 'textarea' : 'input', { type: 'text', value: a[key] ?? '' }); if (multi) i.value = a[key] ?? '';
    i.oninput = () => { a[key] = i.value; ch(); };
    root.append(field(label, i));
  };
  text('名称', 'name'); text('图标字', 'icon');
  const cc = h('input', { type: 'color', value: a.color }); cc.oninput = () => { a.color = cc.value; ch(); };
  root.append(field('颜色', cc));
  text('描述', 'desc', true);
  if (a.kind === 'active') {
    root.append(field('冷却(秒)', numberEl({ min: 0, max: 60, step: 0.1 }, a.cooldown, v => { a.cooldown = v; ch(); })));
    root.append(field('法力消耗', numberEl({ min: 0, max: 300, step: 5 }, a.manaCost, v => { a.manaCost = v; ch(); })));
    root.append(field('施法距离', numberEl({ min: 0, max: 30, step: 0.5 }, a.range, v => { a.range = v; ch(); })));
    root.append(field('目标方式', selectEl({ unit: '指定单位', point: '指向地面(鼠标)', self: '自身' }, a.targeting, v => { a.targeting = v; ch(); })));
    const rt = h('input', { type: 'checkbox', checked: a.root }); rt.onchange = () => { a.root = rt.checked; ch(); };
    root.append(field('施法时定身', rt));
    const sb = h('input', { type: 'checkbox', checked: !!a.sub }); sb.onchange = () => { a.sub = sb.checked; ch(); app.refreshLibrary(); };
    root.append(field('作为子技能', sb));
  } else {
    passiveTriggerEditor(app, root, a);
  }
  // 数值预估
  const fs = a.timeline.filter(b => b.p.formula);
  if (fs.length) {
    root.append(h('div', { class: 'sec' }, '数值预估 (当前英雄 vs 目标)'));
    const pf = previewFn(app);
    for (const b of fs) root.append(h('div', { class: 'help', html: `<span style="color:${ACTIONS[b.type].color}">${ACTIONS[b.type].icon} ${ACTIONS[b.type].label} @${b.t}s</span><br>${pf(b.p.formula)}` }));
  }
  root.append(h('div', { class: 'row-btns' },
    h('button', { class: 'btn accent', onclick: () => app.tryAbility(a.id) }, '▶ 试放/模拟触发'),
    h('button', { class: 'btn', onclick: async () => { await copyText(exportAbilities(app.lib, [a.id])); app.toast('已复制到剪贴板'); } }, '⇧ 导出到剪贴板'),
    h('button', { class: 'btn', onclick: () => app.duplicate(a.id) }, '⧉ 复制')));
  root.append(h('p', { class: 'help' }, '提示：选中时间轴积木可编辑参数；←/→ 微调时间，Delete 删除，Ctrl/⌘+D 复制积木。'));
}

function passiveTriggerEditor(app, root, a) {
  const ch = () => app.changed(false);
  const tr = a.trigger ||= { event: 'onHit', ignoreProc: true, kind: 'any' };
  root.append(h('div', { class: 'sec' }, '触发器 (WHEN)'));
  root.append(field('触发事件', selectEl(Object.fromEntries(Object.entries(TRIGGERS).map(([k, v]) => [k, v.label])), tr.event, v => { tr.event = v; ch(); renderInspector(app); renderTimeline(app); })));
  const T = TRIGGERS[tr.event] || {};
  if (['onHit', 'onCrit', 'onDamaged', 'onKill'].includes(tr.event))
    root.append(field('来源类型', selectEl(SOURCE_KINDS, tr.kind || 'any', v => { tr.kind = v; ch(); renderTimeline(app); })));
  if (T.buffFilter) root.append(field('指定Buff', selectEl(buffOptions(app, true), tr.buff || '', v => { tr.buff = v || undefined; ch(); renderTimeline(app); })));
  if (T.pct) root.append(field('生命阈值%', numberEl({ min: 1, max: 99, step: 1 }, tr.pct ?? 30, v => { tr.pct = v; ch(); renderTimeline(app); })));
  if (T.every) root.append(field('间隔(秒)', numberEl({ min: 0.2, max: 60, step: 0.1 }, tr.every ?? 3, v => { tr.every = v; ch(); renderTimeline(app); })));
  if (T.radius) root.append(field('范围(米)', numberEl({ min: 1, max: 30, step: 0.5 }, tr.radius ?? 8, v => { tr.radius = v; ch(); })));
  if (tr.event === 'onCast') root.append(field('指定技能', selectEl(abilityOptions(app, { '*': '任意技能' }), tr.ability || '*', v => { tr.ability = v; ch(); })));
  const ip = h('input', { type: 'checkbox', checked: tr.ignoreProc !== false }); ip.onchange = () => { tr.ignoreProc = ip.checked; ch(); };
  root.append(field('忽略被动产生的事件', ip));
  root.append(field('内置冷却(秒)', numberEl({ min: 0, max: 60, step: 0.1 }, a.icd || 0, v => { a.icd = v; ch(); renderTimeline(app); })));
  root.append(h('p', { class: 'help' }, '「对方」= 事件中的另一方：造成伤害时是受击者，受到伤害时是攻击者。被动的动作以「对方」为当前目标。连锁触发最多 6 层，防止死循环。'));
  root.append(h('div', { class: 'sec' }, '条件 (IF · 全部满足)', h('button', { class: 'btn small', onclick: () => { (a.conditions ||= []).push({ type: 'hasBuff', subject: 'other', buff: Object.keys(app.lib.buffs)[0], stacks: 1 }); ch(); renderInspector(app); renderTimeline(app); } }, '＋')));
  (a.conditions || []).forEach((c, i) => root.append(condEl(app, c, () => { ch(); renderTimeline(app); }, () => { a.conditions.splice(i, 1); ch(); renderInspector(app); renderTimeline(app); })));
  if (!a.conditions?.length) root.append(h('p', { class: 'help' }, '无条件：每次事件都触发。'));
}

function blockInspector(app, root, a, b) {
  const def = ACTIONS[b.type];
  const ch = () => app.changed(false, true);
  root.append(h('h3', {}, h('div', { class: 'ico', style: { '--c': def.color } }, def.icon), def.label, h('small', { style: { font: '8px var(--pix)', color: 'var(--dim)' } }, `in ${a.name}`)));
  root.append(field('开始时间(秒)', numberEl({ min: 0, max: 20, step: 0.05 }, b.t, v => { b.t = v; ch(); })));
  root.append(h('div', { class: 'sec' }, def.params[0]?.group || '参数'));
  let group = def.params[0]?.group;
  for (const pd of def.params) {
    if (pd.group && pd.group !== group) { group = pd.group; root.append(h('div', { class: 'sec' }, group)); }
    const v = b.p[pd.key] ?? structuredClone(pd.def);
    const set = (x) => { b.p[pd.key] = x; ch(); };
    let el;
    switch (pd.type) {
      case 'number': el = numberEl(pd, v, set); break;
      case 'select': el = selectEl(pd.options, v, set); break;
      case 'bool': el = h('input', { type: 'checkbox', checked: v }); el.onchange = () => set(el.checked); break;
      case 'color': el = h('input', { type: 'color', value: v }); el.oninput = () => set(el.value); break;
      case 'text': el = h('input', { type: 'text', value: v }); el.oninput = () => set(el.value); break;
      case 'buff': el = selectEl(buffOptions(app, true), v, set); break;
      case 'ability': el = selectEl(abilityOptions(app, pd.key === 'ability' && b.type === 'cooldown' ? { '*': '全部已装备技能' } : { '': '— 选择 —' }), v, set); break;
      case 'formula': b.p[pd.key] = v; el = formulaEl(app, v, () => ch(), previewFn(app)); break;
      case 'cond': b.p[pd.key] = v; el = condEl(app, v, () => ch()); break;
    }
    if (pd.type === 'formula' || pd.type === 'cond') { root.append(h('div', { class: 'sec' }, pd.label)); root.append(el); }
    else root.append(field(pd.label, el));
  }
  if (['summon', 'repeat', 'branch', 'castAbility', 'projectile', 'laser'].includes(b.type))
    root.append(h('p', { class: 'help' }, '载荷/召唤调用的技能以“免费施放”执行（不耗蓝不进冷却），并以触发点为原点、继承飞行方向——可无限嵌套组合（最多8层），类似 Noita 的触发/定时法术。'));
  if (TARGETS && def.params.some(p => p.key === 'target'))
    root.append(h('p', { class: 'help' }, '目标「当前目标」：主动技能为选中的敌人；被动为事件中的对方。'));
  root.append(h('div', { class: 'row-btns' },
    h('button', { class: 'btn', onclick: () => dupBlock(app, a, b) }, '⧉ 复制积木'),
    h('button', { class: 'btn danger', onclick: () => { a.timeline = a.timeline.filter(x => x !== b); app.sel.blockId = null; app.changed(true); } }, '✕ 删除'),
    h('button', { class: 'btn', onclick: () => { app.sel.blockId = null; renderTimeline(app); renderInspector(app); } }, '← 技能属性')));
}

function buffInspector(app, root) {
  const bf = app.lib.buffs[app.sel.buffId];
  if (!bf) { root.append(h('p', { class: 'help' }, '选择一个 Buff 进行编辑。Buff 可作为 DoT/HoT、属性修正、控制效果，并可被触发器的条件检测。')); return; }
  const ch = () => app.changed(false);
  root.append(h('h3', {}, h('div', { class: 'ico', style: { '--c': bf.color } }, bf.icon), bf.name, h('small', { style: { font: '8px var(--pix)', color: 'var(--dim)' } }, bf.id)));
  const text = (label, key) => { const i = h('input', { type: 'text', value: bf[key] ?? '' }); i.oninput = () => { bf[key] = i.value; ch(); }; root.append(field(label, i)); };
  text('名称', 'name'); text('图标字', 'icon');
  const cc = h('input', { type: 'color', value: bf.color }); cc.oninput = () => { bf.color = cc.value; ch(); }; root.append(field('颜色', cc));
  const db = h('input', { type: 'checkbox', checked: bf.debuff }); db.onchange = () => { bf.debuff = db.checked; ch(); }; root.append(field('负面效果', db));
  root.append(field('持续(秒)', numberEl({ min: 0.1, max: 60, step: 0.1 }, bf.duration, v => { bf.duration = v; ch(); })));
  root.append(field('最大层数', numberEl({ min: 1, max: 99, step: 1 }, bf.maxStacks, v => { bf.maxStacks = v; ch(); })));
  root.append(h('div', { class: 'sec' }, '周期效果 (DoT / HoT)'));
  root.append(field('跳动间隔(0=无)', numberEl({ min: 0, max: 5, step: 0.05 }, bf.tickInterval || 0, v => { bf.tickInterval = v; if (v && !bf.tick) bf.tick = { base: 10, rows: [], type: 'magic', canCrit: false }; ch(); renderInspector(app); })));
  if (bf.tickInterval) {
    root.append(field('类型', selectEl({ damage: '伤害', heal: '治疗' }, bf.tickKind || 'damage', v => { bf.tickKind = v; ch(); })));
    root.append(h('p', { class: 'help' }, '每跳数值 × 当前层数。「施法者」为施加 Buff 的单位，「目标」为 Buff 持有者。'));
    root.append(formulaEl(app, bf.tick ||= { base: 10, rows: [], type: 'magic', canCrit: false }, ch, previewFn(app)));
  }
  root.append(h('div', { class: 'sec' }, '属性修正 (每层)', h('button', { class: 'btn small', onclick: () => { bf.mods ||= {}; const k = Object.keys(MOD_KEYS).find(k => !(k in bf.mods)); if (k) bf.mods[k] = 0.1; ch(); renderInspector(app); } }, '＋')));
  for (const [k, v] of Object.entries(bf.mods || {})) {
    const row = h('div', { class: 'kv' },
      selectEl(MOD_KEYS, k, nk => { delete bf.mods[k]; bf.mods[nk] = v; ch(); renderInspector(app); }),
      (() => { const i = h('input', { type: 'number', value: v, step: 0.01 }); i.oninput = () => { bf.mods[k] = parseFloat(i.value) || 0; ch(); }; return i; })(),
      h('button', { class: 'xbtn', onclick: () => { delete bf.mods[k]; ch(); renderInspector(app); } }, '✕'));
    root.append(row);
  }
  root.append(h('p', { class: 'help' }, '带 % 的键为百分比乘区（0.1 = +10%）；dmgTakenPct 为易伤，负数为减伤。'));
  root.append(h('div', { class: 'sec' }, '角色着色特效 (Shader)', h('button', { class: 'btn small', onclick: () => { (bf.vfx ||= []).push({ type: Object.keys(VFX_TYPES)[0] }); ch(); renderInspector(app); } }, '＋')));
  for (const e of bf.vfx || []) {
    const num = (key, def, step) => { const i = h('input', { type: 'number', value: e[key] ?? def, step, min: 0, max: 5, title: key === 'speed' ? '速度' : '强度' }); i.oninput = () => { e[key] = parseFloat(i.value) || 0; ch(); }; return i; };
    const col = h('input', { type: 'color', value: e.color || bf.color, title: '颜色' }); col.oninput = () => { e.color = col.value; ch(); };
    root.append(h('div', { class: 'kv' }, selectEl(VFX_TYPES, e.type, v => { e.type = v; ch(); }), col, num('intensity', 1, 0.1), num('speed', 1, 0.1),
      h('button', { class: 'xbtn', onclick: () => { bf.vfx = bf.vfx.filter(x => x !== e); ch(); renderInspector(app); } }, '✕')));
  }
  root.append(h('p', { class: 'help' }, '为持有者的模型叠加内置着色器：辉光/闪烁/流血/燃烧/毒雾/冰霜/电弧。依次为 类型、颜色、强度、速度；可叠加多个。VRM 角色退化为自发光脉冲。'));
  root.append(h('div', { class: 'sec' }, '控制标记'));
  bf.flags ||= {};
  for (const [k, label] of Object.entries({ stun: '眩晕(无法行动)', silence: '沉默(无法施法)', root: '定身(无法移动)', disarm: '缴械(无法普攻)' })) {
    const c = h('input', { type: 'checkbox', checked: !!bf.flags[k] }); c.onchange = () => { bf.flags[k] = c.checked; ch(); };
    root.append(field(label, c));
  }
  root.append(h('div', { class: 'row-btns' }, h('button', { class: 'btn accent', onclick: () => { const hero = app.battle.hero; const t = hero.target?.alive ? hero.target : app.battle.nearestEnemy(hero); if (t) app.battle.applyBuff(hero, bf.debuff ? t : hero, bf.id, 1, {}); } }, '▶ 施加测试')));
}

function heroInspector(app, root) {
  const hero = app.battle.hero, st = app.lib.hero.stats;
  root.append(h('h3', {}, h('div', { class: 'ico', style: { '--c': '#6fe3ff' } }, '我'), app.lib.hero.name));
  root.append(h('div', { class: 'sec' }, '基础属性（实时生效）'));
  const grid = h('div', { class: 'stat-grid' });
  for (const d of STAT_DEFS) {
    const i = h('input', { type: 'number', value: st[d.key] ?? 0, step: d.step });
    i.oninput = () => { st[d.key] = parseFloat(i.value) || 0; if (hero) hero.hp = Math.min(hero.hp, app.battle.stat(hero, 'maxHp')); app.save(); };
    grid.append(h('div', { class: 'field' }, h('label', {}, d.label), i));
  }
  root.append(grid);
  root.append(h('div', { class: 'sec' }, '最终属性（含 Buff）'));
  const live = h('div', { id: 'liveStats' }); root.append(live);
  app.liveStatsEl = live;
  root.append(h('div', { class: 'sec' }, '伤害公式'));
  root.append(h('p', { class: 'help', html: `原始值 = 基础 + Σ(系数 × 属性)<br>× 暴击倍率（若暴击）× (1+造成伤害%) × (1+受到伤害%)<br>× 100/(100+护甲) 物理 · 100/(100+魔抗) 魔法 · 真实伤害无视防御<br>→ 先扣护盾，再扣生命；普攻/技能按吸血回血。` }));
}
export function updateLiveStats(app) {
  const el = app.liveStatsEl; if (!el || !el.isConnected) return;
  const b = app.battle, hero = b.hero; if (!hero) return;
  el.innerHTML = STAT_DEFS.map(d => {
    const base = hero.base[d.key] || 0, v = b.stat(hero, d.key);
    const cls = v > base + 1e-6 ? 'up' : v < base - 1e-6 ? 'down' : '';
    const fmt = (x) => d.pct ? (x * 100).toFixed(0) + '%' : (Math.round(x * 100) / 100);
    return `<div class="statline"><span>${d.label}</span><b class="${cls}">${fmt(v)}</b></div>`;
  }).join('') + `<div class="statline"><span>受到伤害</span><b>${((1 + b.stat(hero, 'dmgTakenPct')) * 100).toFixed(0)}%</b></div>`;
}
