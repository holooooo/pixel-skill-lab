---
name: pixel-skill-lab
description: Author, validate and package game skills/passives for Pixel Skill Lab (像素技能实验室) — a timeline + trigger based skill sandbox. Use when the user wants to design a skill, passive, buff, Noita-style spell combo, shooter weapon (shotgun/laser), summon chain, or wants a JSON they can import into Pixel Skill Lab.
---

# Pixel Skill Lab — skill authoring

Pixel Skill Lab (`https://pixel-skill-lab.pages.dev`) runs skills defined as JSON. A **skill** is a timeline of
**action blocks**; a **passive** is `WHEN trigger → IF conditions → THEN timeline`. Any block can call another skill
(payloads / summons / branch / repeat), so complex mechanics are built by composition, like Noita wand crafting.

You author skills with the bundled CLI (`tools/psl.mjs` in the repo, Node ≥ 18, no dependencies) and hand the user
either a JSON file or a one-click import link.

## Workflow

1. **Read the schema first** — never guess parameter names:
   ```bash
   node tools/psl.mjs schema            # every action, trigger, condition, enum, formula stat
   node tools/psl.mjs schema projectile # one action's params with defaults/ranges/options
   node tools/psl.mjs list              # preset skills you can copy (--kind passive)
   node tools/psl.mjs show sparkTrigger # a preset's full JSON — the best reference
   ```
2. **Create a pack** and add blocks (values after `=` are JSON):
   ```bash
   node tools/psl.mjs new active frostShotgun --file my.json --name "冰霜霰弹"
   node tools/psl.mjs set frostShotgun cooldown=1 manaCost=8 targeting='"point"' --file my.json
   node tools/psl.mjs add-block frostShotgun projectile --file my.json --t 0 \
     --set aim='"cursor"' --set count=6 --set spread=40 --set jitter=6 --set homing=0 --set life=0.5 \
     --set style='"frost"' --set buff='"slow"' \
     --set formula='{"base":12,"type":"physical","canCrit":true,"rows":[{"src":"caster","stat":"atk","ratio":0.3}]}'
   ```
   Or write the JSON directly (format below) — the CLI is a convenience, not a requirement.
3. **Validate + simulate** (headless battle vs 4 dummies + 1 slime for 10s; reports damage and runtime errors):
   ```bash
   node tools/psl.mjs validate my.json --sim
   ```
   Fix every `✗`. `!` warnings are allowed but read them.
4. **Deliver**:
   ```bash
   node tools/psl.mjs pack my.json -o my-skills.json   # adds referenced preset buffs/sub-skills
   node tools/psl.mjs link my.json                     # https://…/#import=… opens the import dialog
   ```
   The user can also paste the JSON via **⇩ Import from clipboard** in the app. Imports never overwrite: ID clashes are renamed.

## Data model

```jsonc
{
  "format": "pixel-skill-lab", "version": 1,
  "abilities": [{
    "id": "frostShotgun", "kind": "active",            // or "passive"
    "name": "冰霜霰弹", "icon": "霜", "color": "#6fe3ff", "desc": "…",
    "cooldown": 1, "manaCost": 8, "range": 10,
    "targeting": "point",                               // unit | point | self
    "root": false, "sub": false,                        // sub = helper skill called by others
    "timeline": [{ "id": "b1", "type": "projectile", "t": 0, "track": 0, "p": { /* params */ } }]
  }, {
    "id": "frostArmor2", "kind": "passive", "icd": 2,
    "trigger": { "event": "onDamaged", "kind": "attack", "ignoreProc": true },
    "conditions": [{ "type": "chance", "value": 30 }, { "type": "hasBuff", "subject": "other", "buff": "slow", "stacks": 1 }],
    "timeline": [{ "id": "b2", "type": "applyBuff", "t": 0, "track": 0, "p": { "target": "target", "buff": "frozen", "stacks": 1 } }]
  }],
  "buffs": { "myBuff": { "id": "myBuff", "name": "…", "icon": "…", "color": "#…", "debuff": true, "duration": 4, "maxStacks": 5,
             "tickInterval": 0.5, "tickKind": "damage", "tick": { /* formula */ }, "mods": { "dmgTakenPct": 0.05 }, "flags": { "stun": false },
             "vfx": [{ "type": "bleed", "color": "#ff2e4d", "intensity": 1, "speed": 1 }] } }
}
```

**Formula** (every damage/heal/shield value): `{ base, type: physical|magic|true, canCrit, rows: [{ src: caster|target, stat, ratio }] }`
— `stat` ∈ `atk maxHp hp missingHp armor res mana eventAmount buffStacks buffRemain` (`buffStacks`/`buffRemain` need `buff`; `buffStacks` ratio is per stack; `buffRemain` = remaining DoT/HoT value of ONE stack = tick formula × ticks left, pre-mitigation. Pair it with `detonate` (radius 0, consume true; detonate multiplies by stacks) to settle a DoT instantly).
Damage pipeline: raw → crit × critDmg → ×(1+dmgDealtPct) ×(1+dmgTakenPct) → ×100/(100+armor|res) → shields → HP.

**Context rules** that make composition work:
- `target: "target"` = selected enemy for actives; the event's *other party* for passives (attacker for `onDamaged`, victim for `onHit`).
- A payload skill (`onHit` / `onExpire` / `timerAbility` / `deathAbility` / `castAbility` / `repeat` / `branch` / summon `ability`)
  is free-cast (no mana/CD) with **origin = the trigger point** and **heading = the parent projectile's direction**.
  Inside it use `aim: "facing"` to continue the flight direction, `center: "origin"` for AoE at the impact point.
- Summons run their `ability` every `every` seconds with themselves as caster; they inherit `inherit`×ATK and can themselves summon.
- Recursion depth is capped at 8, splits at 3 generations.

## Recipes

| Want | How |
| --- | --- |
| Shotgun | `projectile` aim=cursor, count 6-8, spread 35-45, jitter 5, speedRand 0.2, life 0.4, homing 0 |
| Laser following mouse | `laser` aim=cursor, track=true, duration 1.5, tick 0.08, pierce=true |
| Railgun | `laser` duration=0 (instant), width 1.4, big formula + `vfx` shake/hitstop |
| Noita trigger | projectile `onHit: "<sub skill>"`; sub skill = projectile aim=random/facing, count N, spread 360 |
| Noita timer | projectile `timerAbility` + `timerEvery`; `onExpire` for expiration trigger |
| Divide by N | `split: N`, `splitOn: "expire"`, short `life`, `splitRecursive: true` |
| Ricochet | `bounce: N` (retargets nearest enemy), `bounceWall: true`, `bounceGrow` for ramping damage |
| Grenade | `motion: "lob"`, aim=cursor, `splash`, optionally `split` on expire for shrapnel |
| Homing on allies | `target: "lowestAlly"` + `heal` / `shield`; projectiles home with `homing` > 0 |
| Summon chain | `summon` mode=totem ability=<skill that summons minions> … |
| Stack & detonate | passive `onHit` + condition `hasBuff other burn stacks 5` → `detonate` |
| HP-scaling nuke | formula rows `{src:"caster",stat:"maxHp",ratio:0.35}`; pay with `selfCost` (`hp` ratio) |
| Execute | `execute` threshold 20, formula on `target.missingHp` |

Always prefer reusing preset buffs (`node tools/psl.mjs schema` lists them) and preset sub-skills; `pack` bundles them automatically.

## Buff shader effects (`buff.vfx`)

A buff can paint its holder with built-in shaders: `"vfx": [{ "type", "color"?, "intensity"?=1, "speed"?=1 }]`.
`type` ∈ `glow flash bleed burn poison frost shock` (`node tools/psl.mjs schema` prints the live list). `color`
defaults to `buff.color`; several entries stack (same type → the strongest wins). Effects scale slightly with stacks.
VRM characters can't take injected shaders and fall back to an emissive pulse. Presets already use them
(burn→burn, bleed→bleed, poison→poison, frozen/slow→frost, shock→shock, rage/haste→glow, stun→flash).
