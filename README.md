# Bloomery — blacksmithing game (Babylon.js)

**▶ Play: https://lonnie-ralfs.github.io/bloomery/**

Phase 1: **smelting**. Phase 2: **forging the bloom into a billet**. First person, mouse only, one action at a time.

## Forging (forge + anvil)

- **Forge**: the work goes into the fire when you arrive. Work the bellows (same gesture as the furnace). Bloom needs
  welding heat (1150–1320 °C); billets forge at 950–1250 °C. Above 1340 °C it burns (sparks, lost metal).
- **Anvil**: the hammer follows the mouse in the plane over the anvil, so there's nothing to click. Lift the mouse and bring it down:
  the head's speed when it meets the metal is the blow. **Right-click or scroll** turns the work a quarter turn.
  1. *Consolidate* — gentle blows (0.5–2.2 m/s) weld the spongy bloom and squeeze slag out (~20 blows at heat).
     Hard or cold blows before it sets knock chunks off.
  2. *Rough ingot* — hit hard; match the outline (a square section, judged on squareness/evenness/straightness).
  3. *Billet* — pick knife / axe / tool bar; the outline is sized from your metal. Draw it out: hit along it, quarter-turn,
     repeat. Bars curl a little toward the struck face; a curled bar rocks if you hit a lifted end — roll it over so it
     rests on its ends and hit the hump to press it straight. Hitting one spot too often mushrooms it.
- Dev panel (`): "Skip to forging" gives a 2 kg bloom on the anvil; "Skip consolidation" jumps to the ingot stage.

- **Stand it on end (E)** in the ingot/billet stages to square the ends: a blow upsets the bar — it shortens near both
  ends (more at the struck top), the end sections fill out toward the body's shape, and both end faces stay flat
  (hammer on top, anvil underneath). Right-click flips it end for end; E lays it back down.

### Deformation model

- **Bloom** (workpiece.js): a lattice of material points with the mesh embedded by a tricubic B-spline (smooth, no
  kinks). Each blow squeezes the vertical lattice columns under the hammer between two planes — hammer face on top,
  anvil underneath — then flows outward to conserve volume (with a mid-height barrel bulge).
- **Ingot and billet** (bar.js): when the bloom sets it's converted to a stack of cross-sections along the bar (24-point
  outlines). The mesh is a tube through them with flat end caps, so it can't fold or crumple, and volume is exact
  (section area × spacing). A blow clips the struck sections flat on top (round hammer face) and underneath (anvil);
  the lost area goes partly into length (spacing) and partly into width (barrel bulge), split by which free surface is
  nearer. A lifted bar is pressed straight between its supports or swung down about where it rests (whole-bar bending,
  so no waves); a badly curved one rocks. The hammer lands on the high spot across the width, as a smith's does.

## Run it

```
.venv/Scripts/python blacksmith/serve.py
```

then open http://localhost:8090 (Babylon.js loads from its CDN). Or start the `blacksmith` entry in `.claude/launch.json`.

## Controls

- **A / D** (or the tabs at the top) move between stations. A dot on a tab marks where the next objective is.
- Everything else is the mouse. Hover over something and the hint line at the bottom says what you can do.
- **`** (backtick) opens a dev panel: give materials, give daub, build & dry the furnace instantly, time ×4.

## The process

| Station | What you do | Gesture |
|---|---|---|
| Stream | Scoop sand, wash it in the water, empty the concentrate into the ore bucket | click the sand bed · hold over water and shake side to side · click the bucket |
| Clay Bank | Dig clay (the bank is carved where you dig), pull straw | press and pull toward you · press and pull up |
| Mixing Trough | Add clay, straw, water; stir until even | click basket / straw / bucket · press and rub around |
| Furnace | Lay 8 coil courses, fit the tuyere, plug the arch, dry it, patch cracks | press and sweep around · click |
| Furnace | Smelt: charge charcoal + iron sand, work the bellows, tap the slag | click basket/bucket · press on bellows, move down/up · click tap hole |
| Furnace | Break the front plug, pull the bloom onto the stump | swing the mallet down fast through the plug · drag with tongs |

## What matters (sim.js)

- **Bellows**: air ≈ full strokes per second. About one steady stroke a second holds 1150–1350 °C.
- **Too cold** (< ~1050 °C): ore doesn't reduce and smothers the fire. **Too hot** (> 1400 °C): the iron soaks up carbon toward cast iron, and above 1480 °C the walls erode.
- **Slag** builds as ore reduces. When it reaches the tuyere it chokes the air and gets trapped in the bloom. Tap it while it's hot enough to run, or it freezes in the tap hole.
- **Fuel**: let the charcoal run out with the bellows going and the bloom burns back to oxide.
- **Upstream quality carries through**: daub mix → drying cracks → wall integrity (heat loss); pan purity → extra slag and less iron.

## Files

- `src/main.js`: engine, camera travel, input, hover/highlight, objectives, dev panel
- `src/sim.js`: the smelting model (pure logic, tables at the top)
- `src/stations/*.js`: stream, clay, trough, furnace (each owns its props, input and HUD panel)
- `src/tools.js`: the floating first-person tools (hand, spade, stick, mallet, rod, tongs; the pan lives in stream.js)
- `src/bloom.js`: the bloom mesh (updatable, dense, ready for per-blow deformation in the next phase)
- `src/containers.js`, `src/world.js`, `src/hud.js`, `src/audio.js` (synthesized sound), `src/util.js`
