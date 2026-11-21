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

### Deformation model (workpiece.js)

The metal is a 40×8×8 lattice of material points; the visible mesh is embedded in it and follows by trilinear
interpolation, so it stays smooth and can't crumple. Each blow: bend (if the bar is genuinely curved under the hammer) →
sink the struck part onto the anvil → flat hammer face squashes each vertical column under it → flow along the bar
(rigid shift beyond the hammer) and across it (struck slice widens), split by which free surface is nearer, solved
so volume is conserved → small curl. A safety net rejects any blow that would fold the material.

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
