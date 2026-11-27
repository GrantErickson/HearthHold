# Hearthold — Game Spec

A browser game in the "carry, sell, build" style seen in mobile base-builder ads.
You run around a medieval village, chop and mine resources, drop them at the
market for coins, and spend coins by standing on build pads. What you build
defends the keep through **100 waves in five acts**, each with new enemies, a
new look and a boss every ten waves.

All names, characters, models and sounds are original. **No ads, no tracking,
no accounts.** Progress is stored only in the player's browser.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Setting | Medieval village |
| Pressure | Enemy waves on a timer, each bigger than the last |
| Visuals | Low-poly 3D (Three.js), tilted camera following the hero; day for building, dusk/night for fighting |
| Devices | Desktop (keyboard) and phone (touch joystick + on-screen ability buttons) |
| Length | 100 waves in 5 acts (≈5× the original 20). Boss every 10 waves, champions every 5. Endless mode afterwards |
| Losing | Keep destroyed = game over; retry from the start of that wave (auto-save) |
| Progression | Hero XP + perk picks, abilities, boss relics, equipment, research, keep levels, repeatable Glory |
| Speed | 1×, 1.5×, 2×, 3× (remembered); the simulation sub-steps so 3× plays like 1× |
| Tech | Vite + TypeScript, Three.js from npm, static build output (`dist/`) |

## 2. Tech

- Vite 6 + TypeScript 5 (strict), Three.js r170. No backend.
- All 3D models are built in code from primitives (no asset files), merged into
  one geometry per model with vertex colours **and a per-vertex glow value**.
  Boxes are rounded, curved parts keep smooth normals and get enough segments to
  read as round; only crystals, spikes and other deliberately sharp shapes are
  faceted. Static models get baked ambient occlusion (darker near the ground).
- **Cartoon rendering**: the shared shader cel-shades sunlight into three soft
  bands and adds a rim highlight to characters and buildings. Post-processing
  (`src/post.ts`) draws ink outlines from depth discontinuities and blooms
  anything brighter than white (magic, fire, sparks, lit windows). Touch devices
  skip the bloom. `?nopost` turns post-processing off.
- One shared shader extension (injected into `MeshLambertMaterial`) adds:
  wind sway for trees and grass, act seasons (autumn/grey/winter tints on leafy
  colours), snow on upward faces, self-lit glow (torches, crystals, runes, eyes)
  and windows that light up at night.
- Particles and health bars are instanced (a handful of draw calls in total):
  rounded debris chunks (big blasts make them trail smoke), cartoon smoke puffs
  (shaded balls that pop in and shrink away), white-hot fire puffs, additive
  glows, star-shaped impact sparks, velocity-stretched spark streaks, fresnel
  blast shells and ground scorch marks.
- Explosions also flash a real point light (a fixed pool of three, so the shader
  never recompiles) and the big ones send a screen-space shockwave ripple through
  the post pass. Big blows freeze the action for a few frames (hit-stop), shake
  the camera (smooth trauma shake with a little roll) and punch it inward.
  Every material variant is compiled at boot to avoid mid-battle hitches.
- Each character has its own material instance (same shader), so hits and
  status effects tint smoothly instead of swapping whole-model colours.
- Sound is synthesized with the Web Audio API (no audio files): layered
  effects (transient, body, sub thump, tail) with pitch variation, stereo pan
  and distance muffling, a shared reverb, a limiter and a voice cap. **War
  drums** play during waves and build with the danger level (taiko, toms, a low
  drone, a string ostinato when it's dire); the keep's heartbeat sounds when it
  is low. No sound is scheduled until a user gesture has started the audio
  context. Pause menu: Sound on/off, War drums on/off.
- Save data: `localStorage` key `hearthold-save-v2` (v1 saves from the 20-wave
  version are ignored). Every read/write is wrapped.

## 3. Controls

| Action | Desktop | Phone |
|---|---|---|
| Move | WASD / arrows (mouse drag works too) | Touch and drag (floating joystick) |
| Chop / mine / attack | Automatic | same |
| Sell / collect / buy | Stand on the pad | same |
| Abilities | Q Whirlwind · E War Cry · R Meteor · F Bastion | Ability buttons |
| Choose perk / relic | L (1/2/3 to pick) or click the level badge | Tap the level badge |
| Game speed | `[` / `]` (also `-` / `=`) or the speed button | Speed button |
| Call the wave early | Space / Enter or the button | Button |
| Zoom | Mouse wheel | — |
| Pause / mute | Esc or P / M | Buttons |

## 4. Core loop

1. **Gather** wood, stone, gold ore and crystal (auto-harvest when close).
2. **Sell** at the market's SELL pad; the market turns items into coins.
3. **Collect** coins from the COINS pad.
4. **Build** by standing on pads; partial payments are kept.
5. **Defend** at dusk. Clearing a wave pays a bonus, repairs everything,
   grants XP and starts the next day.
6. **Grow the hero**: pick perks on level-up, claim relics after boss waves,
   use abilities in battle.

## 5. World layout

Top of the screen is north. Enemies enter from the north edge.

```
 z=-62  ~~~~~~~~~~~~~~~~ enemy camp / spawn line ~~~~~~~~~~~~~~~~
 z=-27   [spikes]  [tar]   [spikes]   [tar]  [spikes]          traps in the field
 z=-20  |==W0==|==W1==|==W2==|==W3==|==W4==|==W5==|           wall (6 × 10 wide)
 z=-15  Fire  T1  Frost  T2  Ballista  T3  Mage  T4  Spire     tower row, 5 behind the wall
 z=-8   Roost       Cannon  Catapult  Cannon      Aerie
        forest |  MktUp [MARKET]   [SMITH] Boots | quarry
               |  Pack  SELL COINS  Sword Armor Tools
               | Merchant  KeepUp  Merchant      | GoldPad
               | [BARRACKS] [KEEP] [ARCHERY]     | gold mine
               | LumberPad  Academy  MinerPad    |
 z=22          | [LUMBER]  research pads [MINERS]|
 z=25          |          [ACADEMY]              |
 z=30          |            Glory      CrystalPad| crystal cavern
        x=-30                    x=0                          x=30
```

- Map bounds: x −29.5…29.5, z −64…39.5.
- Forest (west), quarry (east), gold field (south-east), crystal field (far south-east).
- Torches line the back of the wall; lamps and windows light up the village at night.

## 6. Resources

| Resource | Unlock | Sell value | Units per node | Regrow | Harvest time |
|---|---|---|---|---|---|
| Wood 🪵 | Start | 4 | 5 | 18 s | 1.0× |
| Stone 🪨 | Open Quarry (Keep 2) | 9 | 4 | 28 s | 1.5× |
| Gold ore 🔶 | Open Gold Mine (Keep 3) | 22 | 3 | 40 s | 2.2× |
| Crystal 💎 | Open Crystal Cavern (Keep 5) | 38 | 3 | 55 s | 3.0× |

Market levels multiply value ×1 / 1.2 / 1.4 / 1.6 / 1.8. Commerce research and
the Haggler perk add more; a **Gold Rush** makes everything sell for +50%.

## 7. Buildings, defenses and upgrades

All costs and unlocks live in `src/pads.ts`; stats live in `src/config.ts`.

| Pad | Stages | Unlock |
|---|---|---|
| Walls ×6 | Palisade 25 · Stone 80 · Fortified 220 · Iron 480 · **Runic** 1200 (reflects 20%) · **Adamant** 2600 (reflects 35%) | waves 0/1/3, then Keep 2–6 |
| Archer Towers ×4 | Build 50/90 · Lv2 160 · Lv3 420 · Lv4 1500 · Lv5 3500 (3 arrows) | first wall / wave 2, then wave 3 / Keep 3 / 5 / 6 |
| **Ballista** | 1100 · 2200 · 4500 · 9000 — piercing bolts, picks the toughest target | wave 16 |
| **Frost Tower** | 1400 · 2800 · 6000 — slowing aura + frost bolts | wave 22 |
| **Mage Tower** | 2000 · 3500 · 7000 · 13000 — chain lightning (ignores armor) | wave 26 |
| **Fire Tower** | 2600 · 4500 · 9000 · 16000 — fireballs that set groups alight | wave 32 |
| **Holy Spire** | 5000 · 9000 · 16000 — heals troops, mends walls, smites (×2 vs undead) | wave 44 |
| **Cannon Battery** ×2 | 3500 · 7500 · 16000 · 34000 — range 30–36, explosive shot; targets siege engines and boulder-throwers first, then archers and casters, then bosses | waves 26 / 33 + Keep 4 |
| **Griffin Aerie** | 9000 · 19000 · 38000 · 72000 — 2–5 griffin riders that fly anywhere and dive on siege engines, ranged enemies, flyers and stragglers | wave 36 + Keep 5 |
| **Dragon Roost** | 45000 · 110000 · 240000 — the village dragon circles the field and strafes the densest enemies with fire (burns) | waves 56 / 70 / 84 + Keep 7–8 |
| **Spike Pits** ×3 | 150 · 400 · 1100 · 3000 — damage everything walking over | waves 5 / 7 / 9 |
| **Tar Pits** ×2 | 500 · 1400 · 3500 — slow, Lv3 burns | wave 18 |
| Catapult | 900 · 2000 · **Great Trebuchet** 6000 | Keep 3 / 4 / 6 |
| Keep | Lv2 200 … Lv8 26000 (HP 600 → 12000, arrows from Lv3) | waves 3, 8, 13, 24, 38, 55, 72 |
| Barracks | 6 levels: 2 → 12 soldiers | Keep 2–6 |
| **Archery Range** | 4 levels: 2 → 6 rangers shooting from behind the wall | Keep 3–6 |
| Lumber Camp / Miners' Lodge | Build, then hire up to 6 workers each (hires 5–6 need Keep 5) | wave 1 / quarry |
| Market Upgrade | 4 levels | wave 2, Keep 3/4/6 |
| Backpack | 6 levels: 8 → 66 | first sale … Keep 5 |
| Blacksmith → Sword (10 tiers), Armor (8), Tools (5), Boots (5) | | wave 2, tiers gated by Keep level |
| **Academy** | Research: Fletching, Masonry, Drill, Commerce, Alchemy, Logistics (5 levels each, +10% per level) | Keep 3 |
| **Glory of Hearthold** | Repeatable: +2% damage and HP for everything, cost ×1.22 each level | Keep 5 |
| **Merchant** (temporary) | Two random offers: Perk Scroll, Fury Elixir, Treasure Map, Tome of Wisdom, Ancient Relic | random visits |

Destroyed walls, towers, catapult and special towers leave rubble and a
**Rebuild** pad at half price.

## 8. Hero

- Stats come from equipment × perks × relics × Glory (see `Stat` in `src/progress.ts`).
- Auto-attacks with cleave; crits, lifesteal, dodge and thorns come from perks/relics.
- **XP** from every kill (hero kills ×1.5), wave clears, chests and tomes.
  Level curve `12·L^1.6 + 8`. Each level gives a **perk pick** (1 of 3, 20 perks with stack limits).
- **Abilities** (unlock by level; cooldowns reset each wave):
  Whirlwind (Lv 2), War Cry (Lv 5: +40% attack speed for towers, troops and hero),
  Meteor (Lv 10: huge splash on the densest group), Bastion (Lv 16: repair 30%, heal troops).
- **Relics**: after every boss wave (10, 20, …) choose 1 of 3 from 14 permanent relics.
- Can be slowed (frost) and stunned (boss slams). Respawns at the keep after 4 s.

## 9. Enemies

Five acts, each with its own roster (weights in `ACTS` in `src/config.ts`):

| Act | Waves | New enemies | Boss (wave 10s) |
|---|---|---|---|
| I · The Raider Clans | 1–20 | Raider, Runner, Brute, Archer, Shieldbearer | Chieftain (10), Warlord (20) |
| II · The Beast Tribes | 21–40 | Wolf, Berserker (enrages), Sapper (blows up walls), Shaman (heals), Battering Ram | Troll King (regen + slam), Great Mammoth (charges walls) |
| III · The Restless Dead | 41–60 | Skeleton, Necromancer (summons), Giant Bat (flies), Wraith (passes through walls), Bone Golem | The Lich (summons, shields), Wraith Queen (phases, lifesteal) |
| IV · The Frozen North | 61–80 | Ice Wolf, Frost Mage (slows, freezes towers), Frost Giant (throws boulders) | Frost Jarl (frost nova), Winter Witch |
| V · The Dark Legion | 81–100 | Dark Knight (armor), Fire Drake (flying tower-hunter), Trebuchet (siege from range) | The Red Dragon (90), The Dread King (100) |

- **Champions** (waves ending in 5): an act's toughest unit with 8× HP and a boss bar.
- **Elites** (from wave 25): Armored, Swift, Regenerating, Shielded, Vampiric or
  Explosive, shown with a coloured ring. More HP, more coins and XP. From wave 45
  also **Warded**: a rune bubble that towers and troops can't hurt until the hero
  strikes it.
- **Goblin Thief** (in tunnel parties from wave 30, climbs walls from wave 66):
  ignores fights, runs for the market, grabs coins (the uncollected pile first,
  then up to 15% of your purse) and flees north. Kill it to get the coins back.
- **Wall Scaler** (waves 63+): throws a grappling hook and climbs over standing
  walls, then hunts towers from behind.
- **Boss wards** (from wave 40): bosses raise a ward at half HP (at two thirds and
  one third from wave 70); champions from wave 45 at half HP. While it holds,
  only the hero's blows count (3 to 6 hits). Breaking it stuns a boss for 2.5 s
  and it takes +50% damage for 6 s. Flying bosses out of reach never ward.
- **Wave modifiers** (announced one wave ahead): Blood Moon, Swarm, Forced
  March, Golden Horde, Wide Front, Siege Train, Iron Horde, Champions' Muster.
- **Armor** reduces each physical hit (melee, arrows, splash, ballista).
  Magic, fire and holy damage ignore it. Ethereal enemies take half physical damage.
- **Scaling**: HP `1 + 0.12(w−1) + 0.0045(w−20)²` after wave 20; damage, coins and
  XP scale more gently. Act I keeps the original 20-wave numbers.

### Danger and the hero's job

From Act II the walls alone aren't enough:

- **Tunnel ambushes** (wave 25+: sometimes; 45+: one or two a wave; 70+: two or
  three): the ground rumbles inside the walls, a pulsing circle marks the spot
  for 3.4 s, then a party bursts out (wolves and a berserker; skeletons and a
  necromancer in Act III; ice wolves and a frost mage; then berserker, knight,
  sappers and scalers), plus thieves from wave 30.
- **Telegraphs**: boss slams wind up for about a second over a filling red
  circle (step out!), and enemy boulders mark where they'll land.
- **Alarms**: a bell when a wall falls or enemies get inside; off-screen arrows
  at the screen edge point at tunnels, thieves, warded enemies, bosses and
  intruders; the screen edges glow red while enemies are inside, the keep is
  low, or the hero just took a heavy hit.
- **Feel**: big enemies' footsteps thud and shake the ground; hits knock enemies
  back and heavy blows (crits, whirlwind, explosions) send the fallen flying.

## 10. Between waves

- Countdown 90 s before wave 1, 45 s normally (50 s from wave 40), 60–65 s
  before boss waves (+15 s with the Hourglass relic). **Call early** for bonus coins.
- **Treasure chests** appear around the map (walk over them).
- The **travelling merchant** visits every few waves.
- **Gold Rush**: +50% sell value for that build phase.

## 11. Look and feel

- Daytime build phases; waves are fought at dusk with torches, lamps and lit
  windows. Blood Moon turns the night red.
- Each act changes the palette and weather: fireflies (I), autumn leaves and
  amber trees (II), grey ash and fog (III), snow on every roof and field (IV),
  embers under a crimson sky (V).
- Cartoon look: rounded models, cel shading, ink outlines, bloom on magic and fire.
- Hits squash the target, knock it back, pop a star and spray spark streaks away
  from the blow; crits freeze the frame for a beat. Deaths squash, spring and
  vanish in a puff of smoke, or tumble through the air when an explosion or a
  heavy blow kills them. Explosions: a white-hot flash and blast shell, rolling
  fireballs that rise into a smoke column, spark streaks, falling embers,
  smoking debris, a dust skirt, a shockwave ring, a light flash, a scorch mark
  and (for the big ones) a screen ripple. Buildings shudder when struck and
  collapse in a dust cloud; the hero's sword leaves swooshes. Chill, burn and
  holy show as gentle tints.
- HUD: coins, backpack, HP, level and XP, objective, buffs; wave card with act,
  countdown/enemies left and the next wave's boss or modifier; keep HP; boss bar
  (with shield and ward); speed, pause and mute; ability bar; threat arrows.

## 12. Win, lose, save

- **Victory**: clear wave 100 (the Dread King). Then endless mode or a new game.
- **Defeat**: keep HP reaches 0 → retry from the checkpoint.
- **Checkpoint** at the start of every build phase: coins, waves, every pad's
  stage, hero level/XP/perks/relics, research and stats.

## 13. Debug and tuning

- **Skip ahead** (dev server, or any build with `?debug`): a panel on the main
  menu starts at any wave from 2 to 150. It grants the income, hero level, perks
  and relics the honest bot had by that wave and spends the coins wave by wave
  in the bot's order, so the base matches a typical run without battle damage.
  The options are a typical base, a strong base (2× income) or coins only, plus
  god mode. The URL form is `?wave=N&base=fair|strong|coins&god`. Using it turns
  on the debug keys for the rest of the tab session; pressing Play turns them off.
- `?debug` keys: `C` coins, `N` start wave, `K` kill all, `H` heal keep, `G` god
  mode, `U` +1 wave cleared, `X` +500 XP, `J` skip 10 waves (between waves).
  `?debug&start` skips the menu. `?debug&preset=N` plays N waves with the bot
  and free coins, so the base shows real wear (`&fight=S`, `&at=x,z`).
- `?autotest` runs a bot through all 100 waves with free coins (smoke test of
  every building, enemy, boss and save). `?autotest&honest` makes the bot earn
  its own coins (balance check). `&waves=N` stops early. The bot's hero walks at
  its real speed and answers threats the way a player would (wards first, then
  thieves, intruders and tunnels about to open); `&passive` keeps it parked
  behind the centre of the wall instead. The report lists each wave's lowest
  keep HP, defenses lost, tunnels, coins stolen and escaped, wards and hero
  deaths, plus any enemy that got stuck.
- Balance at the time of writing: the generous bot clears all 100 waves. The
  honest bot that answers threats won its run (34 defenses lost, about 12k coins
  stolen of 1.6M earned, waves of 55 to 85 s, about three minutes for the Dread
  King). Parked behind the wall, two runs lost 56 and 86 defenses, had 51k and
  109k coins stolen, dragged on for 150 to 500 s while warded enemies roamed, and
  one of them fell at wave 100. The honest bot can still lose early in Act I.
