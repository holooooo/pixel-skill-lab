// 入口：组装战斗、渲染、编辑器、HUD 与输入
import { Battle } from './engine/battle.js';
import { Arena } from './render/arena.js';
import { ENEMY_TEMPLATES } from './data/presets.js';
import { loadLibrary, saveLibrary, freshLibrary, exportAll, importData, copyText, readClipboard } from './store.js';
import { uid, newFormula } from './engine/model.js';
import { defaultParams } from './engine/actions.js';
import * as E from './editor.js';
import { buildHud, updateHud, flashPassive, flashSlot, SLOT_KEYS } from './hud.js';
import { LANG, setLang, addTerms, startI18n } from './i18n.js';
import { PRESET_ABILITIES, ENEMY_ABILITIES } from './data/presets.js';

const GH = 'https://github.com/holooooo/pixel-skill-lab';
// 预设的英文名/描述注册进词典
for (const a of [...PRESET_ABILITIES, ...ENEMY_ABILITIES]) if (a.en) addTerms({ [a.name]: a.en.name, [a.desc]: a.en.desc });
startI18n();

const lib = loadLibrary();
const battle = new Battle(lib);
const arenaWrap = document.getElementById('arenaWrap');
const arena = new Arena(arenaWrap, document.getElementById('overlay'), battle);

const app = {
  lib, battle, arena, enemyTemplates: ENEMY_TEMPLATES, timeScale: 1,
  sel: { tab: 'active', abilityId: 'fireball', blockId: null, buffId: 'burn' },
  tl: { zoom: 170, snap: 0.1, playhead: null },
  curAbility() { return lib.abilities[this.sel.abilityId]; },
  save() { saveLibrary(lib); },
  refreshLibrary() { E.renderLibrary(app); },
  refresh() { E.renderLibrary(app); E.renderTimeline(app); E.renderInspector(app); buildHud(app); },
  changed(full) {
    this.save();
    E.renderTimeline(app); E.renderLibrary(app); buildHud(app);
    if (full) E.renderInspector(app);
  },
  selectAbility(id) {
    const a = lib.abilities[id]; if (!a) return;
    this.sel.abilityId = id; this.sel.blockId = null;
    if (this.sel.tab === 'active' || this.sel.tab === 'passive') this.sel.tab = a.kind;
    this.refresh();
  },
  toggleEquip(id) {
    const a = lib.abilities[id], lo = lib.hero.loadout;
    if (a.kind === 'active') {
      const i = lo.skills.indexOf(id);
      if (i >= 0) lo.skills[i] = null;
      else {
        let j = -1;
        for (let k = 0; k < SLOT_KEYS.length; k++) if (!lo.skills[k]) { j = k; break; }
        if (j < 0) return this.toast('技能栏已满：拖拽卡片到技能栏槽位即可替换');
        lo.skills[j] = id;
      }
    } else {
      const i = lo.passives.indexOf(id);
      if (i >= 0) lo.passives.splice(i, 1);
      else { if (lo.passives.length >= 6) return this.toast('被动栏已满（最多6个）'); lo.passives.push(id); }
    }
    this.save(); this.refresh();
  },
  duplicate(id) {
    const a = structuredClone(lib.abilities[id]);
    a.id = `${id}_${uid('')}`; a.name += ' 副本';
    for (const b of a.timeline) b.id = uid();
    lib.abilities[a.id] = a; this.save(); this.selectAbility(a.id);
    this.toast(`已复制为「${a.name}」`);
  },
  removeAbility(id) {
    delete lib.abilities[id];
    const lo = lib.hero.loadout;
    lo.skills = lo.skills.map(x => x === id ? null : x);
    lo.passives = lo.passives.filter(x => x !== id);
    if (this.sel.abilityId === id) this.sel.abilityId = null;
    this.save(); this.refresh();
  },
  newItem() {
    const tab = this.sel.tab;
    if (tab === 'buff') {
      const id = 'buff_' + uid('');
      lib.buffs[id] = { id, name: '新Buff', icon: '新', color: '#ff9fdc', debuff: true, duration: 4, maxStacks: 3, tickInterval: 0, tick: null, mods: { dmgTakenPct: 0.05 }, flags: {}, vfx: [{ type: 'glow' }] };
      this.sel.buffId = id; this.save(); this.refresh(); return;
    }
    const id = (tab === 'passive' ? 'p_' : 's_') + uid('');
    const a = tab === 'passive'
      ? { id, kind: 'passive', name: '新被动', icon: '新', color: '#ffcf6e', desc: '', icd: 0.5, conditions: [], trigger: { event: 'onHit', kind: 'attack', ignoreProc: true },
        timeline: [{ id: uid(), type: 'applyBuff', t: 0, track: 0, p: defaultParams('applyBuff') }] }
      : { id, kind: 'active', name: '新技能', icon: '新', color: '#ff9fdc', desc: '', cooldown: 3, manaCost: 20, range: 10, targeting: 'unit', root: false,
        timeline: [{ id: uid(), type: 'projectile', t: 0, track: 0, p: defaultParams('projectile') }] };
    lib.abilities[id] = a; this.save(); this.selectAbility(id);
  },
  tryAbility(id) {
    const a = lib.abilities[id], hero = battle.hero;
    if (!a || !hero?.alive) return;
    if (a.kind === 'active') battle.tryCast(hero, id, { free: true });
    else {
      const t = hero.target?.alive ? hero.target : battle.nearestEnemy(hero);
      battle.firePassive(hero, a, t, { source: hero, target: t, amount: 100, depth: 0, kind: 'skill' });
    }
  },
  castSlot(i) {
    const id = lib.hero.loadout.skills[i], hero = battle.hero;
    if (!id || !hero) return;
    if (battle.tryCast(hero, id)) flashSlot(app, i);
  },
  spawnEnemy(key, x, z, quiet) {
    const t = ENEMY_TEMPLATES[key];
    const u = battle.addUnit(t, 1, x ?? 4 + Math.random() * 7, z ?? (Math.random() - 0.5) * 12);
    if (!quiet) battle.fx.spawn(u);
    return u;
  },
  clearEnemies() { battle.units = battle.units.filter(u => u.team === 0); },
  resetArena() {
    battle.units = []; battle.projectiles = []; battle.zones = []; battle.beams = []; battle.orbits = []; battle.lasers = []; battle.timers = [];
    spawnHero();
    for (const [k, x, z] of [['dummy', 3.5, -3.5], ['dummy', 5.5, 0], ['dummy', 3.5, 3.5], ['golem', 10, 0], ['slime', 8, -5], ['slime', 8, 5]]) this.spawnEnemy(k, x, z, true);
    battle.resetMeter();
  },
  toast(msg) {
    const d = document.createElement('div'); d.textContent = msg;
    document.getElementById('toast').append(d); setTimeout(() => d.remove(), 2500);
  },
  modal(title, body, actions) {
    const m = document.getElementById('modal');
    document.getElementById('modalTitle').textContent = title;
    const b = document.getElementById('modalBody'); b.innerHTML = ''; typeof body === 'string' ? (b.innerHTML = body) : b.append(body);
    const ac = document.getElementById('modalActions'); ac.innerHTML = '';
    for (const [label, fn, cls] of [...actions, ['关闭', () => true]]) {
      const btn = document.createElement('button'); btn.className = 'btn ' + (cls || ''); btn.textContent = label;
      btn.onclick = async () => { if (await fn()) m.classList.add('hidden'); };
      ac.append(btn);
    }
    m.classList.remove('hidden');
  },
};
window.app = app;

function spawnHero() {
  const u = battle.addUnit(lib.hero, 0, -7, 0);
  u.base = lib.hero.stats; u.loadout = lib.hero.loadout;
  u.hp = battle.stat(u, 'maxHp'); u.mana = u.base.maxMana;
  return u;
}

// 被动触发 → HUD 闪烁
const fx0 = battle.fx.proc;
battle.fx.proc = (u, a) => { fx0(u, a); if (u === battle.hero) flashPassive(app, a.id); };
arena.onAssetStatus = (s) => { document.getElementById('assetStatus').textContent = s; };
const flashEl = document.getElementById('flash');
arena.onFlash = (c, a) => {
  flashEl.style.transition = 'none'; flashEl.style.background = c; flashEl.style.opacity = a;
  requestAnimationFrame(() => { flashEl.style.transition = 'opacity .45s'; flashEl.style.opacity = 0; });
};

// ---------- UI 绑定 ----------
document.querySelectorAll('#libTabs button').forEach(b => b.onclick = () => {
  app.sel.tab = b.dataset.tab;
  if ((b.dataset.tab === 'active' || b.dataset.tab === 'passive') && app.curAbility()?.kind !== b.dataset.tab) {
    const first = Object.values(lib.abilities).find(a => a.kind === b.dataset.tab && !a.enemy);
    app.sel.abilityId = first?.id; app.sel.blockId = null;
  }
  app.refresh();
});
document.getElementById('libSearch').oninput = () => E.renderLibrary(app);
document.getElementById('btnNew').onclick = () => app.newItem();
document.getElementById('btnTry').onclick = () => app.sel.abilityId && app.tryAbility(app.sel.abilityId);
const btnPause = document.getElementById('btnPause');
const togglePause = () => { battle.paused = !battle.paused; btnPause.textContent = battle.paused ? '▶ 继续' : '⏸ 暂停'; btnPause.classList.toggle('on', battle.paused); };
btnPause.onclick = togglePause;
document.getElementById('timeScale').oninput = (e) => { app.timeScale = +e.target.value; document.getElementById('timeScaleV').textContent = app.timeScale.toFixed(1) + 'x'; };
document.getElementById('btnReset').onclick = () => {
  if (!confirm('恢复全部预设？你的自定义技能将被清除（建议先导出）。')) return;
  const f = freshLibrary();
  for (const k of ['abilities', 'buffs', 'hero']) lib[k] = f[k];
  app.save(); app.resetArena(); app.sel.abilityId = 'fireball'; app.refresh();
};
document.getElementById('btnExportAll').onclick = async () => {
  const text = exportAll(lib);
  const ok = await copyText(text);
  const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true;
  app.modal(ok ? '已复制全部数据到剪贴板' : '复制失败，请手动复制', ta, [['下载 JSON 文件', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'pixel-skill-lab.json'; a.click(); return false;
  }]]);
};
document.getElementById('btnImport').onclick = async () => {
  const clip = await readClipboard();
  openImport(clip && clip.includes('pixel-skill-lab') ? clip : '');
};
function openImport(prefill) {
  const ta = document.createElement('textarea'); ta.placeholder = '在此粘贴导出的技能 JSON…'; ta.value = prefill;
  const wrap = document.createElement('div');
  wrap.innerHTML = '<p class="help">支持单个技能、多个技能（含其依赖的 Buff 与子技能）或整库导出数据。ID 冲突时会自动改名，不会覆盖你的技能。</p>';
  wrap.append(ta);
  app.modal('从剪贴板导入技能', wrap, [['导入', () => {
    try {
      const r = importData(lib, ta.value);
      app.save();
      const first = r.root[0] || r.ids[0];
      if (first) app.selectAbility(first); else app.refresh();
      app.toast(`导入成功：${r.added} 个技能，${r.buffsAdded} 个 Buff`);
      return true;
    } catch (e) { app.toast('导入失败：' + e.message); return false; }
  }, 'accent']]);
};
document.getElementById('btnHelp').onclick = showHelp;
const btnLang = document.getElementById('btnLang');
btnLang.textContent = LANG === 'zh' ? 'EN' : '中';
btnLang.onclick = () => setLang(LANG === 'zh' ? 'en' : 'zh');
document.getElementById('btnAgent').onclick = showAgent;

function showAgent() {
  const zh = LANG === 'zh';
  app.modal(zh ? '🤖 让 Agent 帮你设计技能' : '🤖 Let an agent design skills for you', `
  <p>${zh ? '本项目在 GitHub 提供一个 <b>Agent Skill</b>（适用于 Claude Code 等支持 SKILL.md 的 Agent）和零依赖 CLI <code>psl</code>。Agent 读完 schema 后即可编写、校验、无头模拟并打包技能，最后给你一个一键导入链接。'
    : 'The GitHub repo ships an <b>Agent Skill</b> (for Claude Code and other SKILL.md-aware agents) plus a zero-dependency CLI <code>psl</code>. The agent reads the schema, then writes, validates, simulates and packs skills — and hands you a one-click import link.'}</p>
  <ol>
    <li>${zh ? '克隆仓库' : 'Clone the repo'}：<code>git clone ${GH}</code></li>
    <li>${zh ? '安装技能' : 'Install the skill'}：<code>cp -r pixel-skill-lab/skills/pixel-skill-lab ~/.claude/skills/</code></li>
    <li>${zh ? '对 Agent 说：「用 pixel-skill-lab 帮我做一个命中后分裂成 8 枚冰锥的霰弹」' : 'Ask your agent: "Use pixel-skill-lab to make a shotgun whose pellets split into 8 ice shards on hit"'}</li>
    <li>${zh ? 'Agent 会运行' : 'The agent runs'} <code>node tools/psl.mjs validate my.json --sim</code> ${zh ? '和' : 'and'} <code>psl link my.json</code></li>
  </ol>
  <p class="help">${zh ? '也可以手动：卡片上的 ⇧ 导出 JSON，粘贴给 Agent 修改后再「从剪贴板导入」。' : 'Or manually: export a card with ⇧, let the agent edit the JSON, then use "Import from clipboard".'}</p>`,
  [[zh ? '打开 GitHub 获取技能 ↗' : 'Get it on GitHub ↗', () => { window.open(GH + '/tree/main/skills/pixel-skill-lab', '_blank'); return false; }, 'accent']]);
}

// 一键导入链接：#import=<base64url JSON>
function importFromHash() {
  const m = location.hash.match(/^#import=(.+)$/);
  if (!m) return;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    history.replaceState(null, '', location.pathname);
    openImport(text);
  } catch (e) { app.toast('导入链接无效：' + e.message); }
}

function showHelp() {
  app.modal('操作说明', `
  <ul>
  <li><kbd>WASD</kbd> 移动，<kbd>右键</kbd> 点地移动，<kbd>左键</kbd> 选中敌人为目标，<kbd>Tab</kbd> 切换目标</li>
  <li><kbd>1</kbd>-<kbd>8</kbd> 施放技能栏技能；指向型技能以<b>鼠标位置</b>为落点；靠近敌人会自动普攻</li>
  <li><kbd>P</kbd> 暂停，顶栏可调整时间流速（慢动作观察特效）</li>
  </ul>
  <h4>编辑技能</h4>
  <ul>
  <li>左侧选择技能/被动 → 下方<b>时间轴</b>显示其动作积木。从动作面板<b>拖入</b>积木，左右拖动调整触发时间，上下拖动换轨道</li>
  <li>选中积木后在右侧<b>检查器</b>修改参数；伤害公式可叠加多项属性：攻击力、最大生命、当前生命、已损生命、护甲、目标属性、Buff层数、事件数值</li>
  <li>被动 = <b>触发器(WHEN) → 条件(IF) → 时间轴(THEN)</b>，例如「受到伤害时」「目标拥有灼烧≥5层」→「引爆灼烧」</li>
  <li>召唤/循环/分支/释放技能 可以调用其他技能，组合出复杂连招</li>
  <li>把卡片<b>拖到底部技能栏/被动栏</b>即可装备；卡片 ⇧ 按钮导出到剪贴板，顶栏「从剪贴板导入」</li>
  </ul>
  <p class="help">角色模型：RobotExpressive by Tomás Laulhé（CC0）。所有数据自动保存在本地浏览器。</p>`, []);
}

// ---------- 输入 ----------
const keys = new Set();
let moveTarget = null;
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(k)) { keys.add(k); moveTarget = null; }
  const si = SLOT_KEYS.indexOf(e.key);
  if (si >= 0 && !e.metaKey && !e.ctrlKey) { app.castSlot(si); e.preventDefault(); }
  if (k === 'tab') {
    e.preventDefault();
    const hero = battle.hero, en = battle.enemiesOf(hero).sort((a, b) => battle.dist(hero, a) - battle.dist(hero, b));
    if (en.length) hero.target = en[(en.indexOf(hero.target) + 1) % en.length];
  }
  if (k === 'p') togglePause();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
const canvas = arena.renderer.domElement;
canvas.addEventListener('pointermove', (e) => { battle.input.point = arena.pick(e.clientX, e.clientY).point; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const p = arena.pick(e.clientX, e.clientY);
  battle.input.point = p.point;
  const hero = battle.hero;
  if (e.button === 0 && p.unit && p.unit.team !== 0) hero.target = p.unit;
  if (e.button === 2) { moveTarget = p.point; arena.makeFx && battle.fx.zonePulse({ x: p.point.x, z: p.point.z, radius: 0.6, style: 'frost' }); }
});

// ---------- 主循环 ----------
app.resetArena();
E.initTimeline(app);
app.refresh();
importFromHash();
window.addEventListener('hashchange', importFromHash);
let last = performance.now();
function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  const hero = battle.hero;
  let mx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), mz = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  if (!mx && !mz && moveTarget && hero) {
    const dx = moveTarget.x - hero.x, dz = moveTarget.z - hero.z;
    if (Math.hypot(dx, dz) > 0.15) { mx = dx; mz = dz; } else moveTarget = null;
  }
  battle.input.mx = mx; battle.input.mz = mz;
  const t0 = battle.time;
  battle.update(real * app.timeScale);
  const sdt = battle.time - t0;
  arena.render(sdt);
  updateHud(app, real);
  E.updatePlayhead(app);
  if (Math.random() < 0.2) E.updateLiveStats(app);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void newFormula;
