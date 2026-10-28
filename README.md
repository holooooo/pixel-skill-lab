# 像素技能实验室 · Pixel Skill Lab

**[▶ 在线游玩 Play](https://pixel-skill-lab.pages.dev)** · [HOLOOOOO 主站](https://holooooo.pages.dev) · [Agent Skill](skills/pixel-skill-lab/SKILL.md)

一个像素风的技能沙盒：用**时间轴**编排技能动作，用**触发器 → 条件 → 时间轴**搭建被动，用**载荷**把技能像 Noita 法杖一样无限嵌套。Three.js 实时渲染，低分辨率像素化 + 泛光。

A pixel-art skill sandbox. Arrange actions on a **timeline**, build passives as **WHEN → IF → THEN**, and nest skills
through **payloads** like Noita wand crafting. Rendered live with three.js through a low-res pixel pipeline + bloom.

## 功能 Features

- **28 种动作积木**：投射物、激光炮、范围爆发、持续区域、连锁、引导光束、闪现、冲锋、换位、击退/拉拽、召唤、环绕法球、斩杀、引爆层数、传染、净化、护盾、治疗、自损、冷却调整、条件分支、循环施放、镜头特效……
- **射击游戏式武器**：朝鼠标的霰弹枪（散布/随机速度）、跟随鼠标的激光炮、瞬发电磁炮、冲锋枪、抛物线榴弹、弹射飞刀。
- **Noita 式组合**：多重施法、散布、加速度、追踪（可重新索敌）、波浪/螺旋/回旋镖/抛物线轨迹、穿透、弹射（敌人间/墙壁）、递归分裂，以及 **命中 / 消失 / 定时** 三种触发载荷。
- **继承式召唤**：图腾 / 追击仆从 / 环绕浮游炮，召唤物继承攻击力与被动并施放自己的技能，可层层嵌套（召唤物再召唤）。
- **17 种触发事件 + 9 类条件**：造成伤害、受到伤害、暴击、击杀、闪避、施放、获得/施加/结束 Buff、生命跌破阈值、护盾破碎、闪现/冲锋、附近敌人死亡、每 N 秒……
- **数值模型**：伤害 = 基础 + Σ(系数 × 属性)，属性可取攻击、最大/当前/已损生命、护甲、魔抗、法力、目标属性、Buff 层数、事件数值；暴击、增伤/易伤、护甲/魔抗减免、护盾、吸血。
- **Buff 编辑器**：DoT/HoT、按层属性修正、眩晕/沉默/定身/缴械，以及**角色着色特效**（辉光/闪烁/流血/燃烧/毒雾/冰霜/电弧，可叠加）。
- **纯数据结算 DoT**：公式可读取 Buff 层数与「剩余跳伤」，配合引爆即可在普攻时结算并清除 DoT（预设被动「结算引爆」）。
- **导入导出**：单个技能（自动带上依赖的 Buff 与子技能）或整库，复制到剪贴板 / 从剪贴板导入 / 一键导入链接。
- **中文 / English** 界面，DPS 统计、战斗日志、实时数值预估。

## Agent Skill & CLI

`skills/pixel-skill-lab/SKILL.md` 教 Agent（Claude Code 等）如何读 schema、编写、校验、模拟、打包技能：

```bash
cp -r skills/pixel-skill-lab ~/.claude/skills/           # 安装 Agent 技能
node tools/psl.mjs schema                                 # 所有动作 / 触发器 / 条件 / 公式
node tools/psl.mjs new active iceShotgun --file my.json --name 冰霜霰弹
node tools/psl.mjs add-block iceShotgun projectile --file my.json --set aim='"cursor"' --set count=6 --set split=4
node tools/psl.mjs validate my.json --sim                 # 校验 + 无头战斗模拟
node tools/psl.mjs link my.json                           # 生成一键导入链接
npm test                                                  # 全部预设技能无头自测
```

零依赖，Node ≥ 18。

## 运行 Run locally

纯静态页面，无构建步骤：

```bash
python3 -m http.server 5178    # → http://localhost:5178
```

## 素材 Credits

- 角色模型 / Character: VRoid AvatarSample（VRoid Project，CC0）· RobotExpressive by Tomás Laulhé（CC0）
- 其余像素贴图、特效均为程序生成 / All other pixel art and VFX are procedurally generated.
- Built with [three.js](https://threejs.org) and [@pixiv/three-vrm](https://github.com/pixiv/three-vrm).

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Usage guide for LLMs: [llm.txt](llm.txt).
