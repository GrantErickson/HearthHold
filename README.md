# Hearthold

Gather, sell, build and hold the keep. A low-poly 3D wave-defense game for the
browser, in the carry-and-build style of mobile base-builder ads. No ads.

**[▶ Play it in your browser](https://granterickson.github.io/HearthHold/)**

- **100 waves in five acts**: raider clans, beast tribes, the restless dead, the
  frozen north and the Dark Legion, with a boss every ten waves.
- **25+ enemy types**: flyers, wall-phasing wraiths, sappers, healers, summoners,
  siege engines, armored knights, elites with special affixes and wave modifiers.
- **Deep defenses**: walls with six tiers, archer towers, ballista, frost, mage,
  fire and holy towers, spike and tar traps, catapult, soldiers and rangers —
  plus **cannon batteries** that out-range siege engines, a **griffin aerie**
  whose riders hunt enemies anywhere on the field, and a **dragon roost**.
- **Danger that needs a hero**: tunnelers burst up inside the walls, goblin
  thieves raid your coins, scalers climb over, warded elites and bosses shrug
  off towers until you strike them, and boss slams and boulders are telegraphed
  so you can dodge. Off-screen arrows point at what needs you.
- **Take the fight to them**: from Act II the enemy pitches war camps on the
  field (war drums, siege workshops, goblin warrens, shaman totems) that make
  every wave harder until they're razed. Walk out past the wall and your
  soldiers follow you; come back and they return to their posts. Archers man
  the wall walk.
- **Cartoon look and feel**: rounded models, cel shading, ink outlines, bloom,
  squash and stretch, knock-back, hit-stop, big layered explosions with screen
  shockwaves, scorch marks and enemies sent flying.
- **Synthesized sound**: layered, positional effects with reverb, and war drums
  that build as the danger grows.
- **Many ways to level up**: hero XP with perk choices, four abilities, boss
  relics, equipment, Academy research, keep levels and repeatable Glory.
- **Game speed** 1× to 3×, day/night, act seasons and weather.

The full design is in [SPEC.md](SPEC.md).

## Run it

Requires Node 22+.

```sh
npm install
npm run dev        # play at the URL Vite prints (usually http://localhost:5173)
```

## Build for hosting

```sh
npm run build      # type-checks, then writes a static site to dist/
npm run preview    # serve dist/ locally to check it
```

Upload the contents of `dist/` to any static host (GitHub Pages, Netlify,
Cloudflare Pages, an S3 bucket…). Paths are relative, so it also works from a
sub-folder. The built page has to be served over http(s); opening
`dist/index.html` straight from disk won't load the module script.

## GitHub Pages

The site is published at <https://granterickson.github.io/HearthHold/>. Every
push to `main` builds and deploys the site through GitHub Actions.

## iPhone, iPad and Android

The same game ships as a native app through Capacitor 8, built and signed by
Capawesome Cloud (no Mac or Android Studio needed). App id
`net.micapeak.Hearthold`. The native projects are `ios/` and `android/`;
`npm run app:sync` builds the game and copies it in. In the app the status bar
is hidden, the screen stays on, the game pauses when you switch away, and
Android's back button pauses. Setup, signing, version numbers and publishing:
[docs/native-app-capawesome.md](docs/native-app-capawesome.md).

## Controls

- **Move:** WASD / arrow keys, or touch and drag anywhere (mouse drag works too).
- Chopping, mining and fighting happen automatically when you're close enough.
- **Step out of red circles**: they mark boss slams and incoming boulders.
- **Abilities:** Q Whirlwind · E War Cry · R Meteor · F Bastion (or the buttons).
- **Perks and relics:** L or click the level badge, then 1/2/3.
- **Game speed:** `[` and `]` or the speed button. **Call wave early:** Space.
- **Zoom:** mouse wheel. **Pause:** Esc / P · **Mute:** M (the pause menu also
  toggles the war drums)

## Project layout

| File                                             | What it does                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `src/config.ts`                                  | Balance: hero, resources, defenses, enemies, acts, modifiers, perks, relics, wave formulas |
| `src/pads.ts`                                    | Every build pad: costs, unlock rules, what each purchase does             |
| `src/progress.ts`                                | Derived stats (`Stat`), XP and levels, perk and relic choices             |
| `src/abilities.ts`                               | Hero abilities                                                            |
| `src/allies.ts`                                  | Griffin riders and the village dragon                                     |
| `src/threats.ts`                                 | Tunnel ambushes, the danger level, alarms and off-screen threat arrows    |
| `src/camps.ts`                                   | Enemy war camps on the far field: pitching, guards, effects, razing       |
| `src/post.ts`                                    | Post-processing: ink outlines and bloom                                   |
| `src/main.ts`                                    | Boot, game loop (sub-stepped for game speed), camera, keys                |
| `src/hero.ts` / `src/units.ts`                   | Hero; enemies, soldiers, rangers and workers                              |
| `src/structures.ts`                              | Keep, walls, towers, special towers, traps, market economy, collisions    |
| `src/projectiles.ts`                             | Arrows, magic bolts, boulders, ballista bolts, fireballs, meteors         |
| `src/world.ts`                                   | Ground, grass, scenery, trees / rocks / gold / crystals                   |
| `src/env.ts`                                     | Lighting, day/night, act palettes, seasons and weather                    |
| `src/models.ts`                                  | Every 3D model, built from primitives in code, and the shared shaders     |
| `src/fx.ts`                                      | Instanced particles, explosions, telegraph circles, hit-stop, shake, light flashes, health bars, coin drops |
| `src/audio.ts`                                   | Synthesized sound effects and the procedural war drums                    |
| `src/happenings.ts`                              | Treasure chests, the travelling merchant, gold rushes                     |
| `src/waves.ts`, `src/tutorial.ts`, `src/save.ts` | Wave flow, objectives, checkpoint save                                    |
| `src/ui.ts`, `src/style.css`, `index.html`       | HUD, ability bar, perk picker and menus                                   |
| `src/debug.ts`                                   | Debug cheats and the autotest bot (see SPEC §13)                          |
| `src/native.ts`                                  | App-only glue: status bar, keep awake, pause in background, back button   |
| `ios/`, `android/`, `capacitor.config.json`       | The native app projects (Capacitor 8)                                     |
| `capawesome.config.json`, `scripts/app-version.mjs` | Capawesome Cloud build commands; writes version and build numbers      |
| `resources/`                                     | App icon and splash (drawn in `keep.svg`)                                 |

## Testing

- `npm run typecheck` checks the types.
- Open `/?autotest` (smoke test of all 100 waves with free coins) or
  `/?autotest&honest` (balance check). Either one writes a JSON report into the
  page, including each wave's lowest keep HP, defenses lost, tunnels, coins
  stolen, wards raised and hero deaths. Add `&passive` to keep the bot's hero
  parked behind the wall instead of answering threats.
- **Skip ahead to a later wave:** on the dev server, the main menu has a
  *Skip ahead* panel. Pick a wave (or an act / boss shortcut), a starting base
  and optional god mode. You can also link straight to it, e.g.
  `http://localhost:5173/?wave=61&base=strong&god`. In game, `J` skips another
  10 waves, `N` starts the wave, `K` kills everything; the keys are listed
  bottom-left. On the published site, add `?debug` to get the same tools.
- `/?debug` enables cheat keys; `/?debug&preset=60&fight=20` plays the first 60
  waves with the bot instead (slower, but the base shows battle damage). See
  SPEC §13.
