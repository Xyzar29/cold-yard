# cold-yard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Xyzar29/cold-yard/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Xyzar29/cold-yard/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**COLD YARD — a tactical FPS in three.js**

An original, round-based tactical first-person shooter for the browser, built with
three.js 0.187.0 as an entry to make.fun's **"Make the best three.js tactical FPS"**
bounty (threejs-fps-02). Counter-Strike in spirit, never in assets: the map, names,
art and sounds are all its own.

Two teams of five fight over a container yard at dusk. The **Jackals** carry a breach
charge to site A or B and defend it for 40 seconds; the **Wardens** hold the sites or
defuse. Rounds pay money, money buys rifles, a shotgun, an SMG, a bolt-action
Longshot, armour and frag/flash/smoke grenades. First to 7 rounds, sides swap at the
half. Accuracy is the whole game: spread blooms with movement, airtime and sustained
fire, and collapses when you stop, crouch and tap.

## Play it

```sh
node serve.ts          # Node 22, no dependencies, nothing to install
# open http://localhost:8080
```

Static files only — `game/` can be served by any static file server, and
`game/index.html` is the entry point. No build step, no network requests.

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to the output
  directory and writes `dossier.json` with the vendored make.fun library.
- `vendor/makefun-threejs.ts` — make.fun's dossier library, copied from the kit unchanged.
- `game/index.html` — the page, HUD and menus (import map pins `three` to the vendored build).
- `game/src/` — the game, one module per job:
  - `main.js` — boot, fixed-step loop, the shared hitscan resolver, grenades, round phases, screenshot poses
  - `world.js` — the Cold Yard map: solids, colliders, ray tests, the bot waypoint graph
  - `player.js` — first-person controller (acceleration, crouch, jump, view bob)
  - `weapon.js` — weapon data, spread/recoil model, damage falloff, the viewmodel
  - `bots.js` — bot perception (sight cones, hearing), jobs, pathfinding, burst fire
  - `rounds.js` — round plans, bot jobs, the economy and the buy catalogue
  - `state.js` — the one match-state object and the rules constants
  - `hud.js` — HUD, buy menu, killfeed, minimap, banners
  - `audio.js` — synthesised sound effects (WebAudio, no audio files)
  - `input.js`, `palette.js` — input wiring; the yard's colours and team identities
- `game/vendor/three/` — three.js 0.187.0, vendored byte for byte from npm.
- `screenshots/` — real renders of the game in a browser, taken by its maker.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=86zc8pnt&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
