// i18n：中文为源语言；英文模式下用词典 + MutationObserver 翻译所有渲染出来的文本
const KEY = 'psl-lang';
export const LANG = localStorage.getItem(KEY) || (navigator.language?.startsWith('zh') ? 'zh' : 'en');
export function setLang(l) { localStorage.setItem(KEY, l); location.reload(); }
const CJK = /[㐀-鿿]/;

const DICT = {
  // 顶栏 / 布局
  '像素技能实验室': 'Pixel Skill Lab', '加载模型中…': 'Loading models…', '⏸ 暂停': '⏸ Pause', '▶ 继续': '▶ Resume', '速度': 'Speed',
  '⇩ 从剪贴板导入': '⇩ Import from clipboard', '⇧ 导出全部': '⇧ Export all', '↺ 恢复预设': '↺ Reset presets', '？ 操作说明': '? Help',
  '技能': 'Skills', '被动': 'Passives', '单位/场景': 'Units/Arena', '搜索…': 'Search…', '＋ 新建': '＋ New',
  '▶ 试放': '▶ Test cast', '缩放': 'Zoom', '吸附': 'Snap', '无': 'None', '关闭': 'Close', '导入': 'Import',
  'WASD 移动 · 左键选目标 · 右键移动 · 1-8 施法 · Tab 切换目标 · P 暂停': 'WASD move · LMB target · RMB move · 1-8 cast · Tab cycle target · P pause',
  '← 回到主站': '← Main site', '获取 Agent 技能': 'Get the Agent Skill', '语言': 'Lang',
  // 库
  '已装备': 'Equipped', '技能库': 'Skill library', '被动库': 'Passive library', '子技能 (供 召唤/循环/分支 调用)': 'Sub-skills (called by summon/loop/branch/payloads)',
  '● 装备中': '● equipped', '卸下': 'Unequip', '装备': 'Equip', '导出到剪贴板': 'Export to clipboard', '复制一份': 'Duplicate', '删除': 'Delete',
  '生成敌人': 'Spawn enemies', '清空敌人': 'Clear enemies', '重置场景': 'Reset arena', '场景规则': 'Arena rules',
  '敌人主动攻击（触发受击类被动）': 'Enemies attack (fires on-damaged passives)', '敌人死亡后复活': 'Enemies respawn', '英雄无敌（不会死亡）': 'Hero is immortal',
  '画面': 'Display', '像素尺寸': 'Pixel size', '泛光强度': 'Bloom', '统计': 'Stats', '重置伤害统计': 'Reset damage meter',
  '训练木桩：高血量高回复，适合测试DPS；史莱姆：近战小怪会主动攻击；熔岩巨像：Boss，带范围重击与弹幕技能，可测试护盾/受击/斩杀。':
    'Training Dummy: huge HP & regen, great for DPS tests. Slime: melee mob that attacks you. Lava Colossus: a boss with slams and barrages for testing shields, on-hit passives and executes.',
  // 时间轴
  '← 从左侧选择一个技能 / 被动开始编辑': '← Pick a skill / passive on the left to start editing', '时间轴为空：从左侧动作面板拖入积木': 'Empty timeline: drag blocks in from the action palette',
  '个动作': ' actions', '定身': 'rooted', '指定单位': 'Unit-targeted', '指向地面': 'Ground-targeted', '自身': 'Self', '对方': 'Other', '拖到轨道上，或单击追加': 'Drag onto a track, or click to append',
  '请先在左侧选择一个技能或被动': 'Select a skill or passive first',
  // 检查器
  '基础属性': 'Basics', '名称': 'Name', '图标字': 'Icon glyph', '颜色': 'Color', '描述': 'Description', '冷却(秒)': 'Cooldown (s)', '法力消耗': 'Mana cost',
  '施法距离': 'Cast range', '目标方式': 'Targeting', '指向地面(鼠标)': 'Ground (mouse)', '施法时定身': 'Root while casting', '作为子技能': 'Mark as sub-skill',
  '数值预估 (当前英雄 vs 目标)': 'Damage preview (hero vs target)', '▶ 试放/模拟触发': '▶ Test / simulate trigger', '⇧ 导出到剪贴板': '⇧ Export to clipboard', '⧉ 复制': '⧉ Duplicate',
  '提示：选中时间轴积木可编辑参数；←/→ 微调时间，Delete 删除，Ctrl/⌘+D 复制积木。': 'Tip: select a block to edit it; ←/→ nudge time, Delete removes, Ctrl/⌘+D duplicates.',
  '触发器 (WHEN)': 'Trigger (WHEN)', '触发事件': 'Event', '来源类型': 'Source kind', '指定Buff': 'Buff filter', '生命阈值%': 'HP threshold %', '间隔(秒)': 'Interval (s)', '范围(米)': 'Radius (m)',
  '指定技能': 'Skill filter', '任意技能': 'Any skill', '忽略被动产生的事件': 'Ignore events from passives', '内置冷却(秒)': 'Internal CD (s)',
  '「对方」= 事件中的另一方：造成伤害时是受击者，受到伤害时是攻击者。被动的动作以「对方」为当前目标。连锁触发最多 6 层，防止死循环。':
    '"Other" = the other party of the event: the victim when you deal damage, the attacker when you take damage. Passive actions use "Other" as their target. Chains are capped at 8 levels to prevent infinite loops.',
  '条件 (IF · 全部满足)': 'Conditions (IF · all must pass)', '无条件：每次事件都触发。': 'No conditions: fires on every event.',
  '开始时间(秒)': 'Start time (s)', '参数': 'Parameters', '⧉ 复制积木': '⧉ Duplicate block', '✕ 删除': '✕ Delete', '← 技能属性': '← Skill properties',
  '目标「当前目标」：主动技能为选中的敌人；被动为事件中的对方。': '"Current target": the selected enemy for actives; the event\'s other party for passives.',
  '载荷/召唤调用的技能以“免费施放”执行（不耗蓝不进冷却），并以触发点为原点、继承飞行方向——可无限嵌套组合（最多8层），类似 Noita 的触发/定时法术。':
    'Payload/summon skills are free-cast (no mana, no cooldown) from the trigger point and inherit the flight direction — nest them freely (up to 8 levels), like Noita trigger/timer spells.',
  '基础': 'Base', '可暴击': 'Can crit', '暴': 'Crit', '＋ 属性加成': '＋ Stat scaling', '每层数值': 'per stack', '系数(1=100%)': 'ratio (1 = 100%)', '公式': 'Formula', '当前数值': 'Now',
  '对': 'vs', '减免后≈': 'after mitigation ≈', '暴击≈': 'crit ≈', '— 无 —': '— none —', '— 选择 —': '— pick —', '全部已装备技能': 'All equipped skills',
  '选择一个 Buff 进行编辑。Buff 可作为 DoT/HoT、属性修正、控制效果，并可被触发器的条件检测。': 'Pick a buff to edit. Buffs can be DoT/HoT, stat modifiers or CC, and can be checked by trigger conditions.',
  '负面效果': 'Debuff', '持续(秒)': 'Duration (s)', '最大层数': 'Max stacks', '周期效果 (DoT / HoT)': 'Periodic (DoT / HoT)', '跳动间隔(0=无)': 'Tick interval (0 = none)', '类型': 'Type',
  '伤害': 'Damage', '治疗': 'Heal', '每跳数值 × 当前层数。「施法者」为施加 Buff 的单位，「目标」为 Buff 持有者。': 'Per-tick value × stacks. "Caster" applied the buff, "Target" holds it.',
  '属性修正 (每层)': 'Stat mods (per stack)', '带 % 的键为百分比乘区（0.1 = +10%）；dmgTakenPct 为易伤，负数为减伤。': 'Keys with % are multipliers (0.1 = +10%); damage-taken % > 0 is vulnerability, < 0 is reduction.',
  '控制标记': 'Control flags', '眩晕(无法行动)': 'Stun (no actions)', '沉默(无法施法)': 'Silence (no casting)', '定身(无法移动)': 'Root (no moving)', '缴械(无法普攻)': 'Disarm (no attacks)', '▶ 施加测试': '▶ Apply test',
  '基础属性（实时生效）': 'Base stats (live)', '最终属性（含 Buff）': 'Final stats (with buffs)', '伤害公式': 'Damage formula', '受到伤害': 'Damage taken',
  // 动作
  '直接打击': 'Strike', '投射物': 'Projectile', '激光炮': 'Laser Cannon', '范围爆发': 'AoE Burst', '持续区域': 'Zone', '连锁弹射': 'Chain', '引导光束': 'Channel Beam',
  '施加Buff': 'Apply Buff', '移除Buff': 'Remove Buff', '护盾': 'Shield', '闪现': 'Blink', '冲锋': 'Dash', '击退/拉拽': 'Knock/Pull', '自损代价': 'Self Cost',
  '冷却调整': 'Cooldown', '释放技能': 'Cast Skill', '镜头特效': 'Camera FX', '引爆层数': 'Detonate', '斩杀': 'Execute', '环绕法球': 'Orbit', '召唤': 'Summon', '换位': 'Swap',
  '条件分支': 'Branch', '循环施放': 'Repeat', '传染扩散': 'Spread', '净化': 'Cleanse', '法力操作': 'Mana', '状态': 'Status', '支援': 'Support', '位移': 'Movement', '机制': 'Logic',
  // 参数
  '目标': 'Target', '目标/追踪对象': 'Target / homing', '中心': 'Center', '数值公式': 'Value formula', '附加Buff': 'Apply buff', 'Buff层数': 'Buff stacks', '特效风格': 'FX style',
  '段数': 'Hits', '段间隔': 'Hit interval', '打击特效': 'Hit FX', '斩击': 'Slash', '重击': 'Impact', '爪痕': 'Claw', '穿刺': 'Pierce',
  '瞄准': 'Aim', '发射方向': 'Direction', '弹道': 'Ballistics', '多重施法': 'Multicast', '扇形角度': 'Spread angle', '随机散布°': 'Jitter °', '飞行速度': 'Speed', '速度随机': 'Speed variance',
  '加速度': 'Acceleration', '存活时间': 'Lifetime', '尺寸': 'Size', '轨迹': 'Motion', '修饰': 'Modifiers', '追踪转向(0=无)': 'Homing turn (0 = off)', '穿透次数': 'Pierce count',
  '弹射次数': 'Bounces', '撞墙反弹': 'Bounce off walls', '每次弹射增伤': 'Damage per bounce', '分裂数量': 'Split count', '分裂时机': 'Split when', '命中时': 'On hit', '消失时': 'On expire', '两者': 'Both',
  '分裂角度': 'Split arc', '分裂伤害倍率': 'Split damage ×', '递归分裂(最多3代)': 'Recursive split (3 gens)', '溅射半径': 'Splash radius', '击退': 'Knockback',
  '载荷 (Noita 式触发)': 'Payloads (Noita-style triggers)', '命中触发技能': 'On-hit payload', '消失触发技能': 'On-expire payload', '定时触发技能': 'Timer payload', '定时间隔': 'Timer interval', '表现': 'Visuals',
  '方向': 'Direction', '持续跟随瞄准': 'Keep tracking aim', '扫射角速度°/s': 'Sweep °/s', '形态': 'Shape', '长度': 'Length', '宽度': 'Width', '持续(0=瞬发)': 'Duration (0 = instant)',
  '跳伤间隔': 'Tick interval', '每跳增幅': 'Ramp per tick', '贯穿所有敌人': 'Pierce all', '载荷': 'Payload', '半径': 'Radius', '预警时间': 'Telegraph', '击退距离': 'Knockback', '持续时间': 'Duration',
  '跟随施法者': 'Follow caster', '吸附力': 'Pull force', '弹射次数 ': 'Bounces', '弹射范围': 'Bounce range', '每次衰减': 'Decay per bounce', '弹射间隔': 'Bounce delay',
  '持续(0=默认)': 'Duration (0 = default)', '层数(0=全部)': 'Stacks (0 = all)', '层数': 'Stacks', '方式': 'Mode', '向鼠标': 'To mouse', '目标身后': 'Behind target', '远离目标': 'Away from target', '贴近目标': 'Next to target',
  '最大距离': 'Max distance', '距离': 'Distance', '速度': 'Speed', '向目标': 'To target', '后撤': 'Backstep', '距离(负=拉)': 'Distance (neg = pull)', '减少秒数(0=重置)': 'Reduce by s (0 = reset)',
  '震屏': 'Shake', '顿帧(秒)': 'Hit-stop (s)', '闪屏颜色': 'Flash color', '闪屏强度': 'Flash alpha', '飘字': 'Float text', '引爆Buff': 'Detonate buff', '波及半径': 'Blast radius', '消耗层数': 'Consume stacks',
  '斩杀线(生命%)': 'Execute below HP %', '数量': 'Count', '环绕半径': 'Orbit radius', '转速': 'Spin', '同目标间隔': 'Per-target cooldown',
  '召唤物': 'Summon', '召唤物类型': 'Summon type', '外观': 'Look', '继承行为': 'Inherited behavior', '召唤物施放技能': 'Summon casts skill', '施放间隔': 'Cast interval', '仆从近战普攻': 'Minion melee attacks',
  '消失时触发技能': 'On-death payload', '属性继承': 'Stat inheritance', '存在时间': 'Lifetime', '生命(施法者%)': 'HP (caster %)', '继承攻击%': 'Inherit ATK %', '继承被动': 'Inherit passives',
  '条件': 'Condition', '满足则释放': 'Then cast', '否则释放': 'Else cast', '次数': 'Times', '间隔': 'Gap', '扩散半径': 'Spread radius', '层数比例': 'Stack ratio', '移除': 'Remove', '负面': 'Debuffs', '正面': 'Buffs', '全部': 'All',
  '回复': 'Restore', '吸取': 'Drain', '数值': 'Amount',
  // 目标与枚举
  '当前目标': 'Current target', '最近敌人': 'Nearest enemy', '随机敌人': 'Random enemy', '生命最低敌人': 'Lowest-HP enemy', '最远敌人': 'Farthest enemy', '鼠标附近敌人': 'Enemy near mouse',
  '所有敌人': 'All enemies', '最近队友': 'Nearest ally', '生命最低队友': 'Lowest-HP ally', '所有队友': 'All allies', '召唤者': 'Summoner',
  '目标位置': 'Target position', '自身位置': 'Self position', '鼠标位置': 'Mouse position', '随机敌人位置': 'Random enemy position', '触发点(载荷位置)': 'Trigger point (payload origin)',
  '朝向目标': 'Toward target', '朝向鼠标': 'Toward mouse', '沿当前朝向': 'Along current heading', '随机方向': 'Random',
  '直线': 'Straight', '波浪': 'Wave', '螺旋': 'Spiral', '回旋镖': 'Boomerang', '抛物线(榴弹)': 'Lob (grenade)',
  '图腾(固定)': 'Totem (static)', '仆从(追击)': 'Minion (chases)', '浮游炮(环绕)': 'Drone (orbits)', '自动': 'Auto', '史莱姆': 'Slime', '图腾': 'Totem', '浮游球': 'Drone', '机器人': 'Robot', '少女': 'Girl',
  '烈焰': 'Fire', '冰霜': 'Frost', '奥术': 'Arcane', '圣光': 'Holy', '暗影': 'Shadow', '剧毒': 'Poison', '鲜血': 'Blood', '雷暴': 'Storm',
  '物理': 'Physical', '魔法': 'Magic', '真实': 'True', '施法者': 'Caster',
  // 数值模型
  '最大生命': 'Max HP', '攻击力': 'ATK', '护甲': 'Armor', '魔抗': 'Magic Res', '暴击率': 'Crit chance', '暴击倍率': 'Crit damage', '攻速/秒': 'Attack speed', '移速': 'Move speed',
  '吸血': 'Lifesteal', '闪避率': 'Dodge', '最大法力': 'Max mana', '法力回复': 'Mana regen', '生命回复': 'HP regen', '冷却缩减': 'CDR', '当前生命': 'Current HP', '已损生命': 'Missing HP',
  '当前法力': 'Current mana', '事件数值': 'Event amount', '攻击力%': 'ATK %', '护甲%': 'Armor %', '最大生命%': 'Max HP %', '攻速%': 'Attack speed %', '移速%': 'Move speed %',
  '造成伤害%': 'Damage dealt %', '受到伤害%': 'Damage taken %', '受治疗%': 'Healing taken %',
  // 触发器与条件
  '造成伤害时': 'On deal damage', '暴击时': 'On crit', '受到伤害时': 'On take damage', '击杀时': 'On kill', '施放技能时': 'On cast', '获得Buff时': 'On gain buff', '施加Buff时': 'On apply buff',
  '生命低于阈值': 'HP drops below', '护盾破碎时': 'On shield break', '闪避攻击时': 'On dodge', '受到治疗时': 'On healed', 'Buff结束时': 'On buff expire', '闪现/冲锋时': 'On blink/dash',
  '附近敌人死亡': 'Nearby enemy dies', '复活/登场时': 'On spawn', '每隔N秒': 'Every N seconds', '任意': 'Any', '普攻': 'Basic attack', '持续伤害': 'DoT', '被动触发': 'Passive proc',
  '拥有Buff': 'Has buff', '没有Buff': 'Lacks buff', '生命百分比': 'HP %', '概率': 'Chance', '法力百分比': 'Mana %', '拥有护盾': 'Has shield', '正在施法': 'Is casting', '被控制中': 'Is stunned',
  // 战斗提示
  '眩晕中': 'Stunned', '沉默中': 'Silenced', '施法中': 'Casting', '冷却中': 'On cooldown', '法力不足': 'Not enough mana', '超出范围': 'Out of range', '太远了': 'Too far', '已阵亡': 'Dead',
  '被击败': 'defeated', '施放': 'casts', '触发被动': 'procs', '冷却重置!': 'Cooldown reset!', '斩杀!': 'EXECUTE!', '引爆': 'Detonate', '净化': 'Cleanse', '分支': 'branch', '其他': 'Other',
  '训练木桩': 'Training Dummy', '熔岩巨像': 'Lava Colossus', '浮游炮': 'Drone', '仆从': 'Minion', '熔岩重击': 'Lava Slam', '熔岩弹': 'Lava Bolt',
  '平均': 'avg', '治疗量': 'healing', '总': 'Total',
  // Buff
  '灼烧': 'Burn', '中毒': 'Poison', '流血': 'Bleed', '感电': 'Shock', '减速': 'Slow', '冻结': 'Frozen', '眩晕': 'Stun', '沉默': 'Silence', '破甲': 'Armor Break', '猎杀印记': 'Hunter Mark',
  '战意': 'Rage', '疾风': 'Haste', '坚韧': 'Fortify', '嗜血': 'Bloodlust', '专注': 'Focus', '再生': 'Regen', '残影': 'Afterimage', '新Buff': 'New Buff', '新技能': 'New Skill', '新被动': 'New Passive', '副本': 'copy',
  '角色着色特效 (Shader)': 'Character shader FX', '辉光': 'Glow', '闪烁': 'Flash', '流血': 'Bleed', '燃烧': 'Burn FX', '毒雾': 'Toxic', '冰霜': 'Frost', '电弧': 'Arc',
  '为持有者的模型叠加内置着色器：辉光/闪烁/流血/燃烧/毒雾/冰霜/电弧。依次为 类型、颜色、强度、速度；可叠加多个。VRM 角色退化为自发光脉冲。': 'Overlays built-in shaders on the holder: glow / flash / bleed / burn / toxic / frost / arc. Fields: type, color, intensity, speed; stack several. VRM characters fall back to an emissive pulse.',
  '最多': 'max ', '层': ' stacks', '跳伤': 'DoT', '跳疗': 'HoT',
  'Buff剩余跳伤': 'Buff remaining ticks', '结算引爆': 'Settle Detonation',
  // 弹窗
  '操作说明': 'Help', '从剪贴板导入技能': 'Import skills from clipboard', '在此粘贴导出的技能 JSON…': 'Paste exported skill JSON here…',
  '支持单个技能、多个技能（含其依赖的 Buff 与子技能）或整库导出数据。ID 冲突时会自动改名，不会覆盖你的技能。': 'Accepts a single skill, several skills (with dependent buffs and sub-skills) or a full library export. ID clashes are renamed automatically; nothing of yours is overwritten.',
  '已复制全部数据到剪贴板': 'Full library copied to clipboard', '复制失败，请手动复制': 'Copy failed, please copy manually', '下载 JSON 文件': 'Download JSON',
  '恢复全部预设？你的自定义技能将被清除（建议先导出）。': 'Reset all presets? Your custom skills will be removed (export first!).',
  '技能栏已满：拖拽卡片到技能栏槽位即可替换': 'Hotbar full: drag a card onto a slot to replace it', '被动栏已满（最多6个）': 'Passive bar full (max 6)',
  '这里只能放主动技能': 'Only active skills go here', '这里只能放被动': 'Only passives go here', '已复制到剪贴板': 'Copied to clipboard',
  '导入成功': 'Imported', '导入失败': 'Import failed', '个技能': ' skills', '个 Buff': ' buffs',
  '模型已加载 (CC0 RobotExpressive)': 'Models loaded (CC0)', '模型加载失败，使用像素精灵': 'Model load failed, using pixel sprites',
};

// 预设技能的英文名/描述在 presets 里以 en 字段提供，运行时注册
export function addTerms(map) { for (const [k, v] of Object.entries(map)) if (k && v && CJK.test(k)) DICT[k] = v; KEYS = null; }
let KEYS = null;
export function tr(s) {
  if (LANG === 'zh' || !s || !CJK.test(s)) return s;
  if (DICT[s]) return DICT[s];
  const trimmed = s.trim();
  if (DICT[trimmed]) return s.replace(trimmed, DICT[trimmed]);
  KEYS ||= Object.keys(DICT).sort((a, b) => b.length - a.length);
  let out = s;
  for (const k of KEYS) if (out.includes(k)) { out = out.split(k).join(DICT[k]); if (!CJK.test(out)) break; }
  return out.replace(/【/g, '[').replace(/】/g, ']').replace(/，/g, ', ').replace(/：/g, ': ').replace(/（/g, ' (').replace(/）/g, ')').replace(/。/g, '. ').replace(/、/g, ', ');
}
function translateNode(n) {
  if (n.nodeType === 3) { const v = n.nodeValue; if (CJK.test(v)) { const t = tr(v); if (t !== v) n.nodeValue = t; } return; }
  if (n.nodeType !== 1) return;
  if (n.matches?.('textarea, [data-noi18n]')) return;
  for (const a of ['title', 'placeholder']) {
    const v = n.getAttribute?.(a);
    if (v && CJK.test(v)) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } // 值未变时不写回，否则会让 MutationObserver 无限循环
  }
  if (n.tagName === 'INPUT' && n.type === 'text') return;
  for (const c of n.childNodes) translateNode(c);
}
export function startI18n() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  if (LANG === 'zh') return;
  translateNode(document.body);
  document.title = 'Pixel Skill Lab · Skill sandbox';
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else for (const n of m.addedNodes) translateNode(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
}
