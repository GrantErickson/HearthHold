# Hearthold — Game Spec

A browser game in the "carry, sell, build" style seen in mobile base-builder ads.
You run around a small medieval village, chop and mine resources, drop them at the
market for coins, and spend coins by standing on build pads. What you build
defends the keep against waves of raiders that grow stronger each round.

All names, characters, models and sounds are original. **No ads, no tracking,
no accounts.** Progress is stored only in the player's browser.

---

## 1. Decisions (from Q&A)

| Topic | Decision |
|---|---|
| Setting | Medieval village |
| Pressure | Enemy waves on a timer, each bigger than the last |
| Visuals | Low-poly 3D (Three.js), tilted camera following the hero |
| Devices | Desktop (keyboard) and phone (touch joystick) |
| Length | 20 waves, wave 20 has the Warlord boss; endless mode afterwards |
| Losing | Keep destroyed = game over; retry from the start of that wave (auto-save) |
| Automation | Hire lumberjacks and miners who gather and deliver on their own |
| Tech | Vite + TypeScript, Three.js from npm, static build output (`dist/`) |

## 2. Tech

- Vite 6 + TypeScript 5 (strict), Three.js r170. No backend.
- `npm run dev` for local play with hot reload, `npm run build` type-checks and
  produces a static `dist/` folder that can be hosted anywhere (GitHub Pages,
  Netlify, any static host).
- All 3D models are built in code from primitives (no asset files), merged into
  one geometry per model with vertex colors to keep draw calls low.
- Sound effects are synthesized with the Web Audio API (no audio files).
- One web font (Lilita One from Google Fonts) with a system-font fallback.
- Save data: `localStorage` key `hearthold-save-v1`; every read/write is
  wrapped so the game still runs if storage is blocked.

## 3. Controls

| Action | Desktop | Phone |
|---|---|---|
| Move | WASD or arrow keys (mouse drag also works) | Touch anywhere and drag (floating joystick) |
| Chop / mine | Automatic when next to a tree or rock | same |
| Attack | Automatic when an enemy is in reach | same |
| Sell / collect / buy | Stand on the pad | same |
| Pause | `Esc` or `P`, or the pause button | Pause button |
| Mute | `M`, or the speaker button | Speaker button |

The game auto-pauses when the tab is hidden.

## 4. Core loop

1. **Gather** — walk next to a tree (wood) or rock (stone, gold). The hero swings
   automatically and each swing adds one item to the stack on their back. The
   backpack has a capacity (starts at 8). Depleted nodes regrow after a while.
2. **Sell** — stand on the market's **SELL** pad; items fly off the stack into
   the market one by one. The market turns each item into coins over time.
3. **Collect** — coins pile up on the market's **COINS** pad. Stand on it to
   scoop them into your purse.
4. **Build** — build pads show an icon and a price. Stand on one and coins flow
   into it. Partial payments are kept, so you can pay in installments. When it's
   paid, the building pops up and new pads may appear.
5. **Defend** — when the countdown ends, raiders march in from the north. Walls
   block them, towers and soldiers shoot and fight, and the hero fights too.
   Clearing a wave pays a bonus, repairs damage and starts the next countdown.

Progression comes from pads unlocking over time (by waves cleared, keep level,
and what's already built), so the village keeps growing and there's always a
next thing to save up for.

## 5. World layout

Top of the screen is north. Enemies enter from the north edge.

```
 z=-48  ~~~~~~~~~~~~~~ raider camp / spawn line ~~~~~~~~~~~~~~
        .                 open field                         .
 z=-14  |==W0==|==W1==|==W2==|==W3==|==W4==|==W5==|   wall line (6 segments, 10 wide)
 z=-9         T1        T2     CAT    T3        T4      towers + catapult
        forest |                                  |
        (wood) | MktUp  [MARKET]      [SMITH] Boots| quarry
               | Pack   SELL COINS  Sword Armor Tools (stone)
               |              KeepUp               |
               | BarracksPad  [ KEEP ]             | GoldPad
               |  [BARRACKS]  [      ]             | gold mine
               | LumberPad                MinerPad | (gold ore)
 z=29          | [LUMBER CAMP]        [MINERS' LODGE]
        x=-30                     x=0                       x=30
```

- Map bounds: x −29.5…29.5, z −48…29.5. Mountains and dense trees frame the edges.
- Keep at (0, 13). The hero starts in the plaza at (0, 3).
- Forest (west): x ≤ −15.5, about 50 trees.
- Quarry (east): rocks appear when the quarry is opened.
- Gold field (south-east): gold veins appear when the gold mine is opened.

## 6. Resources

| Resource | Source | Unlock | Sell value | Units per node | Regrow | Harvest time |
|---|---|---|---|---|---|---|
| Wood 🪵 | Trees | Start | 4 | 5 | 18 s | 1.0× |
| Stone 🪨 | Rocks | Open Quarry | 9 | 4 | 28 s | 1.5× |
| Gold ore 🔶 | Gold veins | Open Gold Mine | 22 | 3 | 40 s | 2.2× |

Base hero harvest time is 0.45 s per item, improved by Tools upgrades.

## 7. Build pads

- 2.6 × 2.6 tiles on the ground with a dashed border, icon and remaining cost.
  A floating name label appears when the hero is nearby.
- A pad pulls coins at about `max(30, cost × 1.1)` per second while you stand
  on it, so any affordable pad finishes in about a second.
- Unbuilt buildings show a translucent preview of what you're buying.
- Multi-stage pads (upgrades, hires) reappear showing the next stage once its
  requirement is met.
- Destroyed walls, towers and catapults leave rubble and a **Rebuild** pad at
  50% of the last stage's price.

## 8. Buildings and upgrades

"Wave N" means N waves cleared. All costs are in coins.

| Pad | Stages (cost → effect) | Unlock |
|---|---|---|
| Market | Pre-built. SELL + COINS pads | Start |
| Market upgrade | Lv2 150 (2× speed, +25% value) · Lv3 500 (3× speed, +50%) | Wave 2 · Keep 3 |
| Backpack | 60 → 14 · 180 → 22 · 450 → 32 · 900 → 45 capacity | First sale · Wave 2 · Keep 2 · Keep 3 |
| Walls W2, W3 (center) | Palisade 25 · Stone 80 · Fortified 220 · Iron 480 | Start · Keep 2 · Keep 3 · Keep 4 |
| Walls W1, W4 | same | Wave 1 for palisade |
| Walls W0, W5 (outer) | same | Wave 3 for palisade |
| Archer Towers T2, T3 | Build 50 · Lv2 160 · Lv3 420 | First wall · Wave 3 · Keep 3 |
| Archer Towers T1, T4 | Build 90 · Lv2 160 · Lv3 420 | Wave 2 · Wave 3 · Keep 3 |
| Keep | Lv2 200 · Lv3 700 · Lv4 1800 | Wave 3 · Wave 8 · Wave 13 |
| Lumber Camp | Build 80, then hire lumberjacks 60 / 110 / 170 / 250 (max 4) | Wave 1 |
| Blacksmith | Build 120 | Wave 2 |
| ↳ Sword | 80 · 200 · 450 · 900 · 1600 (damage 12→18→26→38→54→75) | Blacksmith; later tiers need Keep 2/3/4 |
| ↳ Armor | 90 · 240 · 550 · 1100 (HP 100→150→220→320→450) | Blacksmith; Keep 2/3 |
| ↳ Boots | 100 · 300 · 700 (speed 6→7→8→9.2) | Blacksmith; Keep 2/3 |
| ↳ Tools | 70 · 200 · 500 (harvest 0.45→0.36→0.28→0.21 s) | Blacksmith; Keep 2 |
| Open Quarry | 120 → rocks appear | Keep 2 |
| Miners' Lodge | Build 200, then hire miners 120 / 200 / 300 / 450 (max 4) | Quarry open |
| Open Gold Mine | 450 → gold veins appear; miners prefer gold | Keep 3 |
| Barracks | Build 250 (2 soldiers) · Lv2 300 (4) · Lv3 700 (6) · Lv4 1400 (8) | Keep 2 · Keep 2 · Keep 3 · Keep 4 |
| Catapult | Build 900 · Heavy 2000 | Keep 3 · Keep 4 |

## 9. Hero

- Moves at 6 u/s. HP 100. Regenerates 10 HP/s after 3 s without taking damage.
- Auto-attacks the nearest enemy within 2 u every 0.55 s for 12 damage; nearby
  enemies take 40% cleave damage.
- Fighting takes priority over harvesting.
- On death, the carried stack is lost and the hero respawns at the keep after 4 s.
- The hero and soldiers can walk through friendly walls; enemies cannot.

## 10. Workers

- **Lumberjack** — finds the nearest grown tree, chops 4 logs, carries them to
  the SELL pad, repeats.
- **Miner** — same with rocks, preferring gold veins once the gold mine is open.
- Workers spread out (one worker per node). Enemies ignore them.
- Their deliveries go into the market like the hero's, so coins pile up on the
  COINS pad while you're busy fighting.

## 11. Defenders

| Defender | Stats |
|---|---|
| Archer Tower | Range 12/13/14, damage 10/18/28, every 1.0/0.85/0.7 s; Lv3 fires at 2 targets. HP 300/500/800 |
| Catapult | Range 4–18 (20 heavy), 45/80 splash damage (radius 3) every 3.2/2.6 s; aims at the densest group |
| Keep | HP 600/1000/1600/2500. From Lv3 it shoots arrows (range 10, damage 12; Lv4 20 ×2 targets) |
| Walls | HP Palisade 300 · Stone 700 · Fortified 1400 · Iron 2600. Fully repaired after each wave |
| Soldiers | HP 90/120/150/190, damage 9/12/15/19. Guard posts behind the wall, engage enemies within 7.5 u, retrain 6 s after dying |

Defenders with reach (hero, soldiers, archers) can hit enemies on the far side
of a wall; enemy melee units can only hit the wall.

## 12. Enemies and waves

| Enemy | HP | Speed | Damage | Coins | First wave | Notes |
|---|---|---|---|---|---|---|
| Raider | 30 | 2.4 | 5 | 3 | 1 | Basic melee |
| Runner | 20 | 4.2 | 4 | 3 | 4 | Fast |
| Brute | 160 | 1.6 | 18 | 12 | 6 | 2× damage to walls, never looks for gaps |
| Archer | 26 | 2.2 | 7 | 5 | 9 | Ranged (5.5 u), shoots over walls |
| Shieldbearer | 100 | 2.0 | 10 | 8 | 12 | Takes 50% damage from arrows |
| Chieftain (boss) | 900 | 1.9 | 35 | 80 | 10, 15 | 1.5× damage to walls |
| Warlord (final boss) | 5000 | 1.7 | 60 | 300 | 20 | 2× damage to walls, summons 3 raiders every 10 s |

- Wave size: raiders `3 + 1.5w`, runners `0.9(w−3)` from wave 4, brutes
  `(w−4)/2` from wave 6, archers `0.7(w−7)` from wave 9, shieldbearers
  `0.8(w−10)` from wave 12. Bosses at waves 10, 15 (two) and 20.
- Scaling per wave: HP ×(1 + 0.12(w−1)) (bosses ×(1 + 0.05(w−1))), damage
  ×(1 + 0.06(w−1)), coins ×(1 + 0.05(w−1)).
- Spawn spread across the north edge widens from ±7 to ±26 as waves go up.
- Countdown before each wave: 90 s before wave 1 (frozen until the tutorial
  reaches the build step), 60 s before boss waves, otherwise 45 s.
- **Call early** button: start the wave now for bonus coins
  (`remaining seconds × (0.6 + 0.12 × wave)`).
- Wave clear bonus: `15 + 8w` coins. Loot left on the ground flies to the hero.
- Targeting: enemies go for the hero or soldiers within 4.5 u, then towers or the
  catapult within 6 u, otherwise the keep. A wall in the way gets attacked; most
  enemies slide sideways to a nearby gap if one is within 3.5 u.
- Endless mode (after victory): waves keep scaling; a Chieftain every 5 waves and
  the Warlord every 10.

## 13. Win, lose, save

- **Victory**: clear wave 20 (the Warlord). The win screen shows stats and offers
  **Keep playing (endless)** or **New game**.
- **Defeat**: keep HP reaches 0. Slow-motion collapse, then a game-over screen
  with **Retry wave N** (loads the checkpoint) or **New game**.
- **Checkpoint**: saved at the start of every build phase. It stores coins, waves
  cleared, every pad's stage, destroyed state and partial payment, flags,
  tutorial step and stats. Loading replays each pad's purchases to rebuild the
  village exactly.
- The menu shows **Continue (wave N)** when a checkpoint exists.

## 14. Tutorial and guidance

A bouncing gold marker points at the current objective, and a ground arrow
around the hero points toward it when it's off to the side.

1. Chop some wood in the forest (carry 5).
2. Bring it to the market's SELL pad.
3. Collect your coins from the COINS pad.
4. Build a wall (center pads).
5. Build an archer tower.
6. Survive wave 1.

After the tutorial, newly unlocked pads get a "New: …" toast and the marker
points at them for a few seconds.

## 15. HUD and screens

- Top-left: coins, carried/capacity (flashes FULL), hero HP, objective text.
- Top-center: wave card (countdown or enemies left, progress bar, Call-early
  button), keep HP bar, boss HP bar during boss fights.
- Top-right: pause and mute buttons.
- World: floating name labels on nearby pads, HP bars on damaged units and
  buildings, floating "+coins" and damage text, particles for chopping, hits and
  builds.
- Screens: title menu (Play / Continue / How to play), pause, game over, victory.
- Camera zooms out on portrait phones so the playfield stays readable.

## 16. Audio

Synthesized effects: chop, mine, item pickup, drop, coin, pay tick, build fanfare,
unlock ping, sword swing, hit, arrow, catapult boom, enemy death, hero hurt,
wave horn, victory and defeat jingles. Mute state is remembered.

## 17. Debug and tuning

- All balance numbers live in `src/config.ts`; pad costs and unlocks live in
  `src/pads.ts`.
- `?debug` in the URL: `C` +500 coins, `N` start the next wave now, `K` kill all
  enemies, `H` heal the keep, `G` toggle hero invincibility, `U` +1 wave cleared
  (unlocks).
  - `?debug&start` skips the menu.
  - `?debug&preset=N` fast-forwards N waves with free coins. Add `&fight=S` to
    start the next wave and run it for S seconds, or `&at=x,z` to place the hero.
- `?autotest` runs a bot through all waves with free coins and writes a JSON
  report into the page (smoke test for every building, enemy and save/load).
  `?autotest&honest` makes the bot gather, sell and fight for its own coins, as a
  balance check. With the current numbers the honest bot won 5 of 8 test runs.
  Its losses come at waves 10–13 when it hasn't saved up for Keep Lv 3, because
  the bot buys cheap upgrades greedily.
  - `?debug&continue` loads the checkpoint without going through the menu.

## 18. Out of scope (possible later)

Background music, multiple maps, online leaderboards, more resource types
(food, iron), hero abilities, day/night cycle, controller support.
