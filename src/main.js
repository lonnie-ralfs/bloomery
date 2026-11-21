import { B, V3, damp, ease, Tweens } from './util.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Tools } from './tools.js';
import { Containers } from './containers.js';
import { state, purity } from './state.js';
import { StreamStation } from './stations/stream.js';
import { ClayStation } from './stations/clay.js';
import { TroughStation } from './stations/trough.js';
import { FurnaceStation, NC } from './stations/furnace.js';
import { ForgeStation } from './stations/forge.js';
import { AnvilStation, BILLETS } from './stations/anvil.js';
import { Workpiece } from './workpiece.js';

const canvas = document.getElementById('c');
const engine = new B.Engine(canvas, true, { stencil: true }, true);
const scene = new B.Scene(engine);
const camera = new B.UniversalCamera('cam', V3(0, 1.7, 0), scene);
camera.inputs.clear(); camera.minZ = 0.03; camera.maxZ = 300; camera.fov = 0.9;

const g = { engine, scene, camera, canvas, state, time: 0, timeScale: 1, shake: 0, hover: null };
window.game = g; // handy for poking at from the console
g.sfx = new Sfx();
g.hud = new Hud();
g.tweens = new Tweens();
g.input = { x: innerWidth / 2, y: innerHeight / 2, lx: innerWidth / 2, ly: innerHeight / 2, vx: 0, vy: 0, down: false, h: innerHeight };

g.tag = (meshes, act, hl) => {
  const group = hl === undefined ? meshes : hl;
  for (const m of meshes) { m.metadata = Object.assign(m.metadata || {}, { act, hl: group }); m.isPickable = true; }
};
g.rayPlane = (point, normal) => {
  const ray = scene.createPickingRay(g.input.x, g.input.y, B.Matrix.Identity(), camera);
  const d = ray.intersectsPlane(B.Plane.FromPositionAndNormal(point, normal));
  return d == null ? null : ray.origin.add(ray.direction.scale(d));
};

g.world = buildWorld(scene);
g.tools = new Tools(scene, g.world);
g.containers = new Containers(g);

const order = ['stream', 'clay', 'trough', 'furnace', 'forge', 'anvil'];
const stations = {
  stream: new StreamStation(g),
  clay: new ClayStation(g),
  trough: new TroughStation(g),
};
stations.furnace = new FurnaceStation(g);
stations.forge = new ForgeStation(g);
stations.anvil = new AnvilStation(g);
g.stations = stations;

// The workpiece is created from the smelted bloom the first time you carry it to the forge/anvil.
g.piece = null;
g.makePiece = o => {
  if (g.piece) g.piece.dispose();
  g.piece = new Workpiece(g, o);
  const fb = stations.furnace.bloom; if (fb) fb.setEnabled(false);
  return g.piece;
};
g.ensurePiece = () => {
  if (g.piece) return g.piece;
  const fs = stations.furnace;
  if (!fs.placed) return null;
  const R = fs.sim.result(state.ore);
  return g.makePiece({ mass: Math.max(0.3, fs.bloomMass), slag: 0.08 + R.incl * 0.4, carbon: fs.sim.carbon, T: fs.bloomT });
};

// ---------------------------------------------------------------- station travel
const camPos = stations.stream.pose.pos.clone(), camTgt = stations.stream.pose.target.clone();
let active = null, travelling = false;
function goTo(id, instant = false) {
  const next = stations[id];
  if (!next || next === active) return;
  if (active) { if (g.input.down && active.up) active.up(); active.exit && active.exit(); }
  active = next; g.active = next;
  next.enter && next.enter();
  next.panel && next.panel();
  g.tools.snap = true;
  if (instant) { camPos.copyFrom(next.pose.pos); camTgt.copyFrom(next.pose.target); return; }
  const p0 = camPos.clone(), t0 = camTgt.clone();
  travelling = true;
  g.tweens.add(0.9, k => {
    const e = ease.inOut(k);
    B.Vector3.LerpToRef(p0, next.pose.pos, e, camPos); B.Vector3.LerpToRef(t0, next.pose.target, e, camTgt);
    camPos.y += Math.sin(Math.PI * k) * 0.15; // a little bob as you walk
  }, () => { travelling = false; g.tools.snap = true; });
  g.sfx.play('whoosh', 0.4);
}
g.goTo = goTo;
const cycle = d => goTo(order[(order.indexOf(active.id) + d + order.length) % order.length]);

g.hud.buildStations(order.map(id => ({ id, label: stations[id].label })), goTo);

// ---------------------------------------------------------------- input
function setPos(e) {
  const r = canvas.getBoundingClientRect();
  g.input.x = e.clientX - r.left; g.input.y = e.clientY - r.top;
  g.hud.moveReticle(e.clientX, e.clientY);
}
canvas.addEventListener('pointerdown', e => {
  if (e.button === 2 && !g.hud.modalOpen && !travelling) { active.roll && active.roll(1); return; }
  if (e.button !== 0 || g.hud.modalOpen) return;
  g.sfx.init();
  canvas.setPointerCapture(e.pointerId);
  setPos(e); g.input.down = true;
  if (!travelling) { updateHover(); active.down && active.down(); }
});
canvas.addEventListener('pointermove', setPos);
window.addEventListener('pointerup', e => {
  if (e.button !== 0 || !g.input.down) return;
  g.input.down = false;
  active.up && active.up();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
let wheelT = 0;
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (g.hud.modalOpen || travelling || performance.now() - wheelT < 220) return;
  wheelT = performance.now();
  active.roll && active.roll(e.deltaY > 0 ? 1 : -1);
}, { passive: false });
canvas.addEventListener('pointerleave', () => { g.hud.reticle.style.display = 'none'; });
canvas.addEventListener('pointerenter', () => { g.hud.reticle.style.display = ''; });
window.addEventListener('keydown', e => {
  if (e.repeat || g.hud.modalOpen) return;
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'arrowleft') cycle(-1);
  else if (k === 'd' || k === 'arrowright') cycle(1);
  else if ('123456'.includes(k)) goTo(order[+k - 1]);
  else if (k === 'e' && !travelling) active.stand && active.stand();
  else if (e.key === '`') toggleDev();
});
window.addEventListener('resize', () => engine.resize());

// ---------------------------------------------------------------- hover + highlight
let hlGroup = null;
function updateHover() {
  let hit = null;
  if (!travelling && !active.mode && !active.anim && !active.busy) {
    const r = scene.pick(g.input.x, g.input.y, m => m.isPickable && m.isEnabled() && m.isVisible && m.metadata && m.metadata.act && active.accepts(m.metadata.act, m));
    if (r && r.hit) hit = { act: r.pickedMesh.metadata.act, mesh: r.pickedMesh, point: r.pickedPoint };
  }
  g.hover = hit;
  const grp = hit ? hit.mesh.metadata.hl : null;
  if (grp !== hlGroup) {
    g.world.hl.removeAllMeshes();
    if (grp) for (const m of grp) if (m instanceof B.Mesh && !m.isDisposed()) g.world.hl.addMesh(m, new B.Color3(1, 0.75, 0.4));
    hlGroup = grp;
  }
}

// ---------------------------------------------------------------- the steps
// One list drives the objectives on the left and the Test tools (skip / jump) panel.
// skip() completes that one step as if you'd done it; jumping to a step skips everything before it.
const fs = stations.furnace, an = stations.anvil;
const STAGES = ['consolidate', 'ingot', 'billet', 'done'];
const after = s => { const p = g.piece; return !!p && STAGES.indexOf(p.stage) > STAGES.indexOf(s); };
const pct = v => Math.round(v * 100) + '%';
// the forging steps need a workpiece: the smelted bloom if there is one, otherwise a fresh 2 kg bloom
const needPiece = () => {
  if (g.piece) return g.piece;
  if (fs.placed) return g.ensurePiece();
  if (fs.broken || fs.bloom) fs.skipPull();
  return g.ensurePiece() || g.makePiece({ mass: 2, slag: 0.12, carbon: 0.5, T: 1250 });
};
const placeAtAnvil = p => { if (active === an) an.place(p); };
const STEPS = [
  { phase: 'smelt', st: 'stream', text: () => `Pan iron sand at the stream (${state.orePanned.toFixed(1)} / 4 kg)`,
    done: () => state.orePanned >= 4 || fs.sim.chargedOre >= 4,
    skip: () => { state.ore += 5; state.oreIronKg += 4.4; state.orePanned = Math.max(state.orePanned + 5, 5); } },
  { phase: 'smelt', st: 'clay', text: () => `Dig clay (${Math.min(state.clayDug, 8)} / 8)`,
    done: () => state.clayDug >= 8 || state.furnace.courses >= NC,
    skip: () => { state.clay = Math.max(state.clay, 8); state.clayDug = Math.max(state.clayDug, 8); } },
  { phase: 'smelt', st: 'clay', text: () => `Pull straw (${Math.min(state.strawPulled, 3)} / 3)`,
    done: () => state.strawPulled >= 3 || state.furnace.courses >= NC,
    skip: () => { state.straw = Math.max(state.straw, 3); state.strawPulled = Math.max(state.strawPulled, 3); } },
  { phase: 'smelt', st: 'trough', text: () => 'Mix clay, straw & water into daub',
    done: () => state.daubBatches > 0 || state.furnace.courses >= NC,
    skip: () => { state.clay = Math.max(0, state.clay - 8); state.straw = Math.max(0, state.straw - 3); state.daubQ = state.daub ? state.daubQ : 0.85; state.daub += 10; state.daubBatches++; } },
  { phase: 'smelt', st: 'furnace', text: () => `Build the furnace walls (${state.furnace.courses} / ${NC} courses)`,
    done: () => state.furnace.courses >= NC, skip: () => fs.skipWalls() },
  { phase: 'smelt', st: 'furnace', text: () => 'Fit the clay tuyere (air pipe)', done: () => state.furnace.tuyere, skip: () => fs.skipTuyere() },
  { phase: 'smelt', st: 'furnace', text: () => 'Plug the front arch', done: () => state.furnace.plug, skip: () => fs.skipPlug() },
  { phase: 'smelt', st: 'furnace', text: () => 'Dry the furnace with a gentle fire', done: () => state.furnace.dried, skip: () => fs.skipDry() },
  { phase: 'smelt', st: 'furnace', optional: true, text: () => `Patch drying cracks${fs.openCracks ? ` (${fs.openCracks} left)` : ''}`,
    done: () => state.furnace.dried && fs.openCracks === 0, skip: () => fs.skipPatch() },
  { phase: 'smelt', st: 'furnace', text: () => 'Fill with charcoal & bring it to 1100 °C', done: () => fs.sim.reachedHeat, skip: () => fs.skipHeat() },
  { phase: 'smelt', st: 'furnace', text: () => `Charge your iron sand & smelt (${fs.sim.chargedOre.toFixed(1)} kg in)`,
    done: () => fs.breakReady || fs.broken, skip: () => fs.skipSmelt() },
  { phase: 'smelt', st: 'furnace', optional: true, text: () => 'Tap the slag as it rises', done: () => fs.sim.slagTapped > 0.3, skip: () => fs.skipTap() },
  { phase: 'smelt', st: 'furnace', text: () => 'Break open the front arch', done: () => fs.broken, skip: () => fs.skipBreak() },
  { phase: 'smelt', st: 'furnace', text: () => 'Pull the bloom onto the stump', done: () => fs.placed || !!g.piece, skip: () => { fs.skipPull(); g.hud.closeModal(); } },
  { phase: 'forge', st: 'forge', text: () => 'Bring the bloom to welding heat in the forge (1150 °C+)',
    done: () => !!(g.piece && (g.piece.stats.weldHeat || after('consolidate'))),
    skip: () => { const p = needPiece(); p.T = 1250; p.stats.weldHeat = true; } },
  { phase: 'forge', st: 'anvil', text: () => `Consolidate it with gentle blows (${pct(g.piece ? g.piece.cohesion : 0)})`,
    done: () => after('consolidate'),
    skip: () => { const p = needPiece(); p.cohesion = 1; p.porosity = 0.05; p.densify(); p.stage = 'ingot'; p.T = 1250; p.stats.weldHeat = true; placeAtAnvil(p); } },
  { phase: 'forge', st: 'anvil', text: () => `Square it into a rough ingot${g.piece && g.piece.stage === 'ingot' ? ` (${pct(an.fitV)} to shape)` : ''}`,
    done: () => after('ingot'),
    skip: () => { const p = needPiece(); p.stats.ingotFit = p.stats.ingotFit ?? 0.7; an._startBillet(an.billet || BILLETS[0]); p.T = 1250; placeAtAnvil(p); } },
  { phase: 'forge', st: 'anvil', text: () => `Draw it out into a billet${g.piece && g.piece.stage === 'billet' ? ` (${pct(an.fitV)} to shape)` : ''}`,
    done: () => after('billet'),
    skip: () => { const p = needPiece(); if (!an.billet) an._startBillet(BILLETS[0]); an.tg = p.target(an.billet.ratio); an.fitV = p.fit(an.tg, true); an.finishBillet(); } },
];
const firstOpen = () => STEPS.find(s => !s.done() && !s.optional);
function skipStep(step) {
  try { step.skip(); } catch (e) { console.error(e); g.hud.toast('Could not skip: ' + e.message, 'bad'); }
  g.containers.refresh();
}
function skipCurrent() {
  const cur = firstOpen();
  if (!cur) return g.hud.toast('Nothing left to skip');
  skipStep(cur);
  const next = firstOpen();
  g.hud.toast('Skipped: ' + cur.text().replace(/\s*\(.*\)$/, ''), 'info', 2);
  if (next && next.st !== active.id) goTo(next.st);
}
function jumpTo(i) {
  for (let j = 0; j < i; j++) if (!STEPS[j].done()) skipStep(STEPS[j]);
  g.hud.closeModal();
  const st = STEPS[i].st;
  if (st !== active.id) goTo(st); else { active.enter && active.enter(); active.panel && active.panel(); }
  g.hud.toast('Jumped to: ' + STEPS[i].text().replace(/\s*\(.*\)$/, ''), 'info', 2);
}

// ---------------------------------------------------------------- objectives
function objectives() {
  const forging = !!g.piece || fs.placed;
  const items = STEPS.filter(s => s.phase === (forging ? 'forge' : 'smelt')).map(s => ({ text: s.text(), done: s.done(), optional: s.optional, st: s.st }));
  const cur = items.find(o => !o.done && !o.optional);
  if (cur) {
    cur.active = true;
    // when the work is too cold to forge, the next stop is the fire
    const p = g.piece;
    if (p && cur.st === 'anvil' && p.T < (p.stage === 'consolidate' ? 1050 : 800)) cur.st = 'forge';
  }
  g.hud.setObjectives(items, forging ? 'Forging' : 'Smelting');
  g.hud.setStation(active.id, cur ? cur.st : null);
  if (forging) {
    const p = g.piece;
    g.hud.setInventory(p ? `<b>Workpiece</b> ${p.mass.toFixed(2)} kg · ${Math.round(p.T)} °C<br><b>Carbon</b> ~${p.carbon.toFixed(2)}%` : '');
  } else {
    const st = state, pur = Math.round(purity() * 100);
    g.hud.setInventory(
      `<b>Clay basket</b> ${st.clay} &nbsp;·&nbsp; <b>Straw</b> ${st.straw}<br>` +
      `<b>Daub</b> ${st.daub.toFixed(1)}${st.daubBatches ? ` (${Math.round(st.daubQ * 100)}% quality)` : ''}<br>` +
      `<b>Iron sand</b> ${st.ore.toFixed(1)} kg${st.ore > 0 ? ` (${pur}% pure)` : ''}`);
  }
  if (!devEl.hidden) refreshDev();
}

// ---------------------------------------------------------------- Test tools panel (button or ` key)
const devEl = document.getElementById('dev'), devToggle = document.getElementById('devToggle');
devEl.innerHTML = `
  <div class="devHead"><b>Test tools</b><button class="devClose" title="Close">×</button></div>
  <button class="devSkip">Skip this step ›</button>
  <div class="devSteps"></div>
  <div class="devExtras"></div>`;
const toggleDev = () => { devEl.hidden = !devEl.hidden; devToggle.classList.toggle('on', !devEl.hidden); if (!devEl.hidden) refreshDev(); };
devToggle.onclick = toggleDev;
devEl.querySelector('.devClose').onclick = toggleDev;
devEl.querySelector('.devSkip').onclick = skipCurrent;
const stepsEl = devEl.querySelector('.devSteps'), rows = [];
STEPS.forEach((s, i) => {
  if (i === 0 || STEPS[i - 1].phase !== s.phase) {
    const h = document.createElement('div'); h.className = 'devPhase'; h.textContent = s.phase === 'smelt' ? 'Smelting' : 'Forging'; stepsEl.appendChild(h);
  }
  const r = document.createElement('div'); r.className = 'devRow';
  r.innerHTML = `<span class="devMark"></span><span class="devText"></span><button title="Complete everything before this step and go there">Jump</button>`;
  r.querySelector('button').onclick = () => jumpTo(i);
  stepsEl.appendChild(r); rows.push(r);
});
function refreshDev() {
  const cur = firstOpen();
  STEPS.forEach((s, i) => {
    const r = rows[i], d = s.done();
    r.classList.toggle('done', d); r.classList.toggle('cur', s === cur); r.classList.toggle('opt', !!s.optional);
    const t = s.text().replace(/\s*\(.*\)$/, '');
    const te = r.querySelector('.devText'); if (te.textContent !== t) te.textContent = t;
    r.querySelector('.devMark').textContent = d ? '✓' : s === cur ? '▸' : '';
  });
  devEl.querySelector('.devSkip').disabled = !cur;
}
const extras = devEl.querySelector('.devExtras');
const devBtn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); g.containers.refresh(); }; extras.appendChild(b); return b; };
devBtn('Reheat the work to welding heat', () => { if (g.piece) { g.piece.T = 1250; g.hud.toast('1250 °C'); } else g.hud.toast('No workpiece yet'); });
devBtn('Bring the furnace to 1250 °C', () => { fs.skipHeat(); fs.sim.T = 1250; });
const tsBtn = devBtn('Time ×1', () => { g.timeScale = g.timeScale === 1 ? 4 : 1; tsBtn.textContent = 'Time ×' + g.timeScale; });

// ---------------------------------------------------------------- main loop
let hudT = 0;
scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  g.time += dt;
  // mouse velocity in screen-heights per second
  const inp = g.input, h = canvas.clientHeight || 1;
  inp.h = h;
  const rvx = (inp.x - inp.lx) / Math.max(dt, 1e-3) / h, rvy = (inp.y - inp.ly) / Math.max(dt, 1e-3) / h;
  inp.lx = inp.x; inp.ly = inp.y;
  inp.vx = damp(inp.vx, rvx, 30, dt); inp.vy = damp(inp.vy, rvy, 30, dt);

  g.tweens.update(dt);
  // camera
  camera.position.copyFrom(camPos);
  if (g.shake > 0.0005) {
    camera.position.addInPlace(V3((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake, 0));
    g.shake *= Math.exp(-12 * dt);
  }
  camera.setTarget(camTgt);
  const dir = camTgt.subtract(camPos); g.tools.yaw = Math.atan2(dir.x, dir.z);

  updateHover();
  if (!travelling) active.update(dt);
  else g.tools.root.position.copyFrom(camera.position.add(camera.getDirection(B.Axis.Z).scale(0.6)).add(V3(0.15, -0.25, 0)));
  for (const s of Object.values(stations)) s.simulate && s.simulate(dt * g.timeScale, s === active);
  g.hud.hint(travelling ? '' : active.hint);

  hudT -= dt;
  if (hudT <= 0) { hudT = 0.1; objectives(); active.panelUpdate && active.panelUpdate(); }
});

goTo('stream', true);
document.getElementById('loading').remove();
engine.runRenderLoop(() => scene.render());

g.hud.modal(`
  <h2>The Bloomery</h2>
  <p>Smelt your own iron the old way: pan iron sand from the stream, dig clay and pull straw, mix daub,
  build a shaft furnace coil by coil, dry it, then feed it charcoal and ore while you work the bellows.
  Tap the slag, break the furnace open and pull out the glowing bloom.</p>
  <p><b>Controls:</b> everything is the mouse. Hover over things and the hint at the bottom tells you
  what you can do. Move between stations with <kbd>A</kbd> / <kbd>D</kbd> (or click the tabs at the top).
  The objective list on the left marks the next step, and a dot on a tab shows where to go.</p>
  <p style="color:var(--dim)">Testing? The <b>Test tools</b> button (bottom left, or <kbd>\`</kbd>) skips the current step or jumps to any step.</p>`,
  [{ label: 'Begin', onClick: () => g.sfx.init() }]);
