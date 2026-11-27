# Hearthold

Gather, sell, build and hold the keep. A low-poly 3D wave-defense game for the
browser, in the carry-and-build style of mobile base-builder ads. No ads.

The full design is in [SPEC.md](SPEC.md).

## Run it

Requires Node 18+.

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

## Controls

- **Move:** WASD / arrow keys, or touch and drag anywhere (mouse drag works too).
- Chopping, mining and fighting happen automatically when you're close enough.
- **Pause:** Esc / P · **Mute:** M

## Project layout

| File | What it does |
|---|---|
| `src/config.ts` | All balance numbers: hero, resources, defenses, enemies, wave formulas |
| `src/pads.ts` | Every build pad: costs, unlock rules, what each purchase does |
| `src/main.ts` | Boot, game loop, camera |
| `src/hero.ts` / `src/units.ts` | Hero; enemies, soldiers and workers |
| `src/structures.ts` | Keep, walls, towers, catapult, market economy, collisions |
| `src/world.ts` | Ground, scenery, trees / rocks / gold veins |
| `src/models.ts` | Every 3D model, built from primitives in code |
| `src/waves.ts`, `src/tutorial.ts`, `src/save.ts` | Wave flow, objectives, checkpoint save |
| `src/ui.ts`, `src/style.css`, `index.html` | HUD and menus |
| `src/debug.ts` | Debug cheats and the autotest bot (see SPEC §17) |

## Testing

- `npm run typecheck` checks the types.
- Open `/?autotest` (smoke test with free coins) or `/?autotest&honest`
  (balance check) in a browser. Either one writes a JSON report into the page.
- `/?debug` enables cheat keys. See SPEC §17.
