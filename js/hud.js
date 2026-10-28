// HUD：技能栏、被动栏、血蓝条、伤害统计、战斗日志
import { icon } from './editor.js';
import { ACTIONS } from './engine/actions.js';

export const SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const MAX_PASSIVES = 6;

export function hoverInfo(a) {
  if (!a) return null;
  const aoe = a.timeline.find(b => ['aoe', 'zone'].includes(b.type));
  const blink = a.timeline.find(b => ['blink', 'dash'].includes(b.type) && b.p.mode === 'cursor');
  return {
    range: a.targeting === 'unit' ? a.range : blink ? blink.p.distance : (a.targeting === 'point' ? a.range : 0),
    radius: aoe ? aoe.p.radius : 0, center: aoe?.p.center || 'cursor',
  };
}

export function buildHud(app) {
  const hb = document.getElementById('hotbar'), pb = document.getElementById('passbar');
  hb.innerHTML = ''; pb.innerHTML = '';
  app.hud = { slots: [], pslots: [], logN: -1, meterT: 0 };
  const lo = app.lib.hero.loadout;
  const dropTo = (el, kind, i) => {
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop'); };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => {
      e.preventDefault(); el.classList.remove('drop');
      const id = e.dataTransfer.getData('text/ability'); const a = app.lib.abilities[id];
      if (!a) return;
      if (a.kind !== kind) return app.toast(kind === 'active' ? '这里只能放主动技能' : '这里只能放被动');
      const arr = kind === 'active' ? lo.skills : lo.passives;
      const old = arr.indexOf(id);
      if (old >= 0) arr[old] = arr[i] || null;
      arr[i] = id;
      if (kind === 'passive') lo.passives = arr.filter(Boolean);
      app.save(); app.refresh();
    };
  };
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const id = lo.skills[i], a = app.lib.abilities[id];
    const el = document.createElement('div');
    el.className = 'slot' + (a ? '' : ' empty');
    el.innerHTML = `<span class="key">${SLOT_KEYS[i]}</span>`;
    if (a) {
      el.append(icon(a));
      el.insertAdjacentHTML('beforeend', `<div class="cd"></div><div class="cdt"></div><span class="cost">${a.manaCost || ''}</span>`);
      el.title = `${a.name}\n${a.desc || ''}`;
      el.onclick = () => app.castSlot(i);
      el.oncontextmenu = (e) => { e.preventDefault(); app.selectAbility(id); };
      el.onmouseenter = () => { app.arena.hover = hoverInfo(a); };
      el.onmouseleave = () => { app.arena.hover = null; };
    }
    dropTo(el, 'active', i);
    hb.append(el);
    app.hud.slots.push({ el, id, cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), wasCd: false });
  }
  for (let i = 0; i < MAX_PASSIVES; i++) {
    const id = lo.passives[i], a = app.lib.abilities[id];
    const el = document.createElement('div');
    el.className = 'slot passive' + (a ? '' : ' empty');
    if (a) {
      el.append(icon(a));
      el.insertAdjacentHTML('beforeend', '<div class="icd"></div>');
      el.title = `${a.name}（被动）\n${a.desc || ''}\n右键编辑`;
      el.onclick = el.oncontextmenu = (e) => { e.preventDefault(); app.selectAbility(id); };
    }
    dropTo(el, 'passive', i);
    pb.append(el);
    app.hud.pslots.push({ el, id, icd: el.querySelector('.icd') });
  }
}

export function flashPassive(app, id) {
  const s = app.hud?.pslots.find(p => p.id === id);
  if (!s) return;
  s.el.classList.remove('proc'); void s.el.offsetWidth; s.el.classList.add('proc');
}
export function flashSlot(app, i) {
  const s = app.hud?.slots[i]; if (!s) return;
  s.el.classList.remove('fired'); void s.el.offsetWidth; s.el.classList.add('fired');
}

export function updateHud(app, dt) {
  const b = app.battle, hero = b.hero;
  if (!hero || !app.hud) return;
  for (const s of app.hud.slots) {
    if (!s.id || !s.cd) continue;
    const a = app.lib.abilities[s.id]; if (!a) continue;
    const left = Math.max(0, (hero.cd[s.id] || 0) - b.time);
    const total = (a.cooldown || 1) * (1 - b.stat(hero, 'cdr'));
    s.cd.style.setProperty('--p', left > 0 ? (left / total * 100) + '%' : '0%');
    s.cdt.textContent = left > 0 ? (left < 1 ? left.toFixed(1) : Math.ceil(left)) : '';
    s.el.classList.toggle('nomana', hero.mana < (a.manaCost || 0));
    if (s.wasCd && left <= 0) { s.el.classList.remove('ready-flash'); void s.el.offsetWidth; s.el.classList.add('ready-flash'); }
    s.wasCd = left > 0;
  }
  for (const s of app.hud.pslots) {
    if (!s.id || !s.icd) continue;
    const a = app.lib.abilities[s.id]; if (!a) continue;
    const left = Math.max(0, (hero.icd[s.id] || 0) - b.time);
    s.icd.style.setProperty('--p', a.icd && left > 0 ? (left / a.icd * 100) + '%' : '0%');
  }
  const max = b.stat(hero, 'maxHp'), sh = b.shieldOf(hero);
  const hpb = document.querySelector('#heroBars .hp');
  hpb.children[0].style.width = Math.max(0, hero.hp / max * 100) + '%';
  hpb.children[1].style.width = Math.min(100, sh / max * 100) + '%';
  hpb.children[2].textContent = `${Math.ceil(hero.hp)} / ${Math.round(max)}${sh ? ` +${Math.round(sh)}` : ''}`;
  const mpb = document.querySelector('#heroBars .mp');
  const mm = hero.base.maxMana || 1;
  mpb.children[0].style.width = hero.mana / mm * 100 + '%';
  mpb.children[1].textContent = `${Math.floor(hero.mana)} / ${mm}`;

  // 伤害统计
  app.hud.meterT -= dt;
  if (app.hud.meterT <= 0) {
    app.hud.meterT = 0.25;
    const m = b.meter;
    const el = Math.max(1, b.time - m.start);
    const dps5 = m.recent.reduce((s, r) => s + r.a, 0) / Math.min(5, el);
    const rows = Object.entries(m.by).sort((x, y) => y[1] - x[1]).slice(0, 7);
    const top = rows[0]?.[1] || 1;
    const colors = Object.fromEntries(Object.values(app.lib.abilities).map(a => [a.name, a.color]));
    for (const bf of Object.values(app.lib.buffs)) colors[bf.name] = bf.color;
    document.getElementById('meter').innerHTML =
      `<h4><span>DPS (5s)</span><span>总 ${fmt(m.total)}</span></h4><div class="big">${fmt(dps5)}</div>` +
      `<div style="font-size:10px;color:#8f86b8">平均 ${fmt(m.total / el)}/s · 治疗 ${fmt(m.heal)}</div>` +
      rows.map(([k, v]) => `<div class="row"><i style="width:${v / top * 100}%;background:${colors[k] || '#ffe2b0'}"></i><span><em>${k}</em><b>${fmt(v)}</b></span></div>`).join('');
  }
  if (b.log.length !== app.hud.logN || b.log.at(-1)?.t !== app.hud.logT) {
    app.hud.logN = b.log.length; app.hud.logT = b.log.at(-1)?.t;
    document.getElementById('log').innerHTML = b.log.slice(-12).reverse().map(l => `<div style="color:${l.color}">${l.text}</div>`).join('');
  }
}
const fmt = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString();
void ACTIONS;
