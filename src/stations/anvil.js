// Anvil: the floating hammer follows the mouse in the vertical plane over the anvil. Lift the mouse,
// bring it down; the head's speed when it meets the metal is the blow. No clicking to swing.
// Right-click or scroll wheel turns the work a quarter turn.
//
// Stages: consolidate the bloom (gentle!) -> square it into a rough ingot -> draw out a billet.
import { B, V3, C3, clamp, lerp, smooth, rand, mat, noiseTex, tempColor, flareTex, ease } from '../util.js';
import { HAMMER_R, plasticity } from '../workpiece.js';
import { WELD, FORGE } from './forge.js';

const A = V3(5.5, 0, -2.0), YA = 0.8;   // anvil centre and face height
const FACE = 0.25;                       // half length of the flat face
const GENTLE = [0.5, 2.2], HEAVY = 3.2;  // hammer speeds (m/s)
export const BILLETS = [
  { id: 'knife', label: 'Knife billet', ratio: 10, note: 'long and square — for a blade' },
  { id: 'axe', label: 'Axe-head billet', ratio: 4, note: 'short and chunky' },
  { id: 'bar', label: 'Tool bar', ratio: 14, note: 'long, thin square stock for chisels and punches' },
];

export class AnvilStation {
  constructor(g) {
    this.g = g; this.id = 'anvil'; this.label = 'Anvil';
    this.pose = { pos: V3(A.x - 0.04, YA + 0.4, A.z - 0.46), target: V3(A.x, YA + 0.02, A.z + 0.03) };
    const s = g.scene;
    this.frame = new B.TransformNode('anvilFrame', s); this.frame.position.set(A.x, YA, A.z);
    // stump + anvil
    const bark = s.getTextureByName('plankTex');
    const stump = B.MeshBuilder.CreateCylinder('anvilStump', { diameter: 0.5, height: YA - 0.3, tessellation: 18 }, s);
    stump.position.set(A.x, (YA - 0.3) / 2, A.z); stump.material = mat(s, 'anvilStumpMat', [0.7, 0.58, 0.46], { tex: bark });
    const iron = mat(s, 'anvilMat', [0.16, 0.16, 0.17], { spec: 0.35, specPow: 40 });
    const face = mat(s, 'anvilFaceMat', [0.3, 0.3, 0.32], { spec: 0.9, specPow: 90 });
    const parts = [stump];
    const box = (w, h, d, x, y, z, m = iron) => { const b = B.MeshBuilder.CreateBox('anvilPart', { width: w, height: h, depth: d }, s); b.position.set(A.x + x, y, A.z + z); b.material = m; parts.push(b); return b; };
    box(0.36, 0.06, 0.22, 0, YA - 0.3 + 0.03, 0);
    box(0.2, 0.17, 0.12, 0, YA - 0.3 + 0.145, 0);
    box(0.5, 0.06, 0.12, 0, YA - 0.055, 0);
    box(0.5, 0.025, 0.115, 0, YA - 0.0125, 0, face);
    box(0.08, 0.05, 0.08, -0.29, YA - 0.03, 0);
    const horn = B.MeshBuilder.CreateCylinder('horn', { height: 0.2, diameterTop: 0.0, diameterBottom: 0.085, tessellation: 16 }, s);
    horn.rotation.z = -Math.PI / 2; horn.position.set(A.x + 0.35, YA - 0.045, A.z); horn.material = iron; parts.push(horn);
    for (const m of parts) m.isPickable = false;
    g.world.caster(parts);

    // target outline
    this.target = B.MeshBuilder.CreateBox('targetBox', { size: 1 }, s);
    this.target.parent = this.frame; this.target.isPickable = false;
    const tm = this.targetMat = new B.StandardMaterial('targetMat', s);
    tm.disableLighting = true; tm.emissiveColor = new B.Color3(0.5, 0.8, 1); tm.alpha = 0.1; tm.backFaceCulling = false;
    this.target.material = tm;
    this.target.enableEdgesRendering(); this.target.edgesWidth = 1.2; this.target.edgesColor = new B.Color4(0.6, 0.85, 1, 0.9);
    this.target.setEnabled(false);
    g.world.glow.addExcludedMesh(this.target);

    // hit effects
    const fl = flareTex(s);
    const mk = (name, n, o) => {
      const ps = new B.ParticleSystem(name, n, s);
      ps.particleTexture = fl; ps.emitter = V3(A.x, YA, A.z); ps.emitRate = 0;
      Object.assign(ps, o); ps.start(); return ps;
    };
    this.sparks = mk('hitSparks', 300, {
      minSize: 0.006, maxSize: 0.016, minLifeTime: 0.25, maxLifeTime: 0.7, blendMode: B.ParticleSystem.BLENDMODE_ADD,
      gravity: V3(0, -6, 0), direction1: V3(-2, 1.5, -2), direction2: V3(2, 3.5, 2), minEmitPower: 0.4, maxEmitPower: 1.4,
      color1: new B.Color4(1, 0.9, 0.5, 1), color2: new B.Color4(1, 0.6, 0.2, 1), colorDead: new B.Color4(0.6, 0.1, 0, 0),
    });
    this.spatter = mk('slagSpatter', 300, {
      minSize: 0.008, maxSize: 0.022, minLifeTime: 0.3, maxLifeTime: 0.8, blendMode: B.ParticleSystem.BLENDMODE_ADD,
      gravity: V3(0, -9, 0), direction1: V3(-2.5, 1, -2.5), direction2: V3(2.5, 2.5, 2.5), minEmitPower: 0.5, maxEmitPower: 1.3,
      color1: new B.Color4(1, 0.55, 0.15, 1), color2: new B.Color4(0.9, 0.3, 0.05, 1), colorDead: new B.Color4(0.2, 0.05, 0, 0),
    });
    this.debris = [];

    // hammer state (anvil-local)
    this.hp = V3(0, 0.25, 0); this.hv = V3(); this.armed = true; this.lastBlow = 0; this.lastBlowShow = 0; this.lastKind = '';
    this.fitV = 0; this.hint = ''; this.status = ''; this._rockToast = 0; this.billet = null;
  }

  // ------------------------------------------------------------------ station plumbing
  get piece() { return this.g.piece; }
  enter() {
    const p = this.g.ensurePiece();
    if (p) this.place(p);
    this.g.tools.use('hammer'); this.hp.set(0, 0.25, 0); this.hv.set(0, 0, 0);
  }
  place(p) {
    p.location = 'anvil'; p.root.setEnabled(true);
    p.root.position.copyFrom(this.frame.position); p.root.rotation.set(0, 0, 0);
    p.mesh.rotation.set(0, 0, 0);
    this._refreshTarget();
  }
  exit() { this.target.setEnabled(false); }
  accepts() { return false; }
  down() {}
  up() {}
  roll(dir) {
    const p = this.piece;
    if (!p || p.location !== 'anvil' || p.stage === 'done') return;
    p.roll(dir);
    const m = p.mesh, b = p.bounds();
    m.setPivotPoint(V3(0, (b.minY + b.maxY) / 2, 0));
    this.g.tweens.add(0.16, k => { m.rotation.x = (1 - ease.out(k)) * dir * Math.PI / 2; }, () => { m.rotation.x = 0; });
    this.g.sfx.play('tick', 1.5);
    this._refreshTarget();
  }

  // ------------------------------------------------------------------ hammer
  update(dt) {
    const g = this.g, tools = g.tools, p = this.piece;
    tools.use('hammer');
    // target point: mouse ray onto the vertical plane through the work
    const w = g.rayPlane(V3(0, 0, A.z), V3(0, 0, 1));
    const tgt = w ? V3(clamp(w.x - A.x, -0.42, 0.42), clamp(w.y - YA, -0.02, 0.65), 0) : this.hp.clone();
    // spring-damper head (a little weight, but it tracks your hand)
    const K = 2600, Cd = 2 * Math.sqrt(K) * 0.7, n = 6, h = dt / n;
    const onAnvil = p && p.location === 'anvil';
    for (let i = 0; i < n; i++) {
      const ax = K * (tgt.x - this.hp.x) - Cd * this.hv.x, ay = K * (tgt.y - this.hp.y) - Cd * this.hv.y;
      this.hv.x += ax * h; this.hv.y += ay * h;
      this.hp.x += this.hv.x * h; this.hp.y += this.hv.y * h;
      // what's under the face?
      const sl = onAnvil ? p.sliceAt(this.hp.x) : null;
      this.hz = sl ? sl.zc : 0;
      let surf = sl ? p.topAt(this.hp.x, sl.zc) : -1, onMetal = surf >= 0;
      if (!onMetal) surf = Math.abs(this.hp.x) < FACE ? 0 : this.hp.x > FACE && this.hp.x < FACE + 0.18 ? -0.02 - (this.hp.x - FACE) * 0.1 : -0.3;
      if (this.hp.y < surf) {
        if (this.armed && this.hv.y < -0.5) this._impact(-this.hv.y, this.hp.x, onMetal);
        this.hp.y = surf;
        if (this.hv.y < 0) this.hv.y = -this.hv.y * 0.18;
        this.armed = false;
      } else if (this.hp.y > surf + 0.012) this.armed = true;
    }
    const height = clamp(this.hp.y / 0.4);
    const cock = clamp(0.15 + height * 0.7 + this.hv.y * 0.05, 0, 0.95);
    this.vz = lerp(this.vz || 0, this.hz || 0, 1 - Math.exp(-15 * dt));
    tools.root.position.set(A.x + this.hp.x, YA + this.hp.y, A.z + this.vz);
    tools.root.rotation.set(-cock, tools.yaw, 0);
    this.lastBlowShow = Math.max(0, this.lastBlowShow - dt * 0.6);
    this.hint = this._hint();
  }

  _impact(v, x, onMetal) {
    const g = this.g, p = this.piece;
    const world = V3(A.x + x, YA + this.hp.y, A.z);
    this.lastBlow = v; this.lastBlowShow = v;
    g.shake = Math.max(g.shake, 0.002 + v * 0.0012);
    if (!onMetal || !p || p.stage === 'done') { g.sfx.play('clang', clamp(v / 3, 0.3, 1)); this._sparks(world, 4); this.lastKind = 'anvil'; return; }
    p.stats.blows++;
    p.T -= 2.5;
    const T = p.T;
    g.sfx.play('hit', clamp(v / 3.5, 0.3, 1.2));
    if (T > 900) g.sfx.play('clink', 0.4); else g.sfx.play('clang', clamp(v / 4, 0.3, 0.8));
    this._sparks(world, Math.round(3 + v * 4));

    if (p.stage === 'consolidate') {
      const heat = smooth(950, 1150, T);
      const hard = v > HEAVY, medium = v > GENTLE[1];
      const fragile = 1 - p.cohesion;
      let crumble = false;
      if (T < 850 && v > 1.2) crumble = true;
      else if (hard && p.cohesion < 0.6) crumble = true;
      else if (medium && p.cohesion < 0.35 && Math.random() < 0.5) crumble = true;
      if (crumble) {
        const loss = p.mass * (0.012 + 0.02 * clamp(v / 4)) * (0.5 + fragile);
        const at = p.crumble(x, loss);
        this._chunks(at, Math.round(3 + v));
        g.sfx.play('crack', 0.8);
        g.hud.toast(T < 850 ? 'Crumbled — too cold to weld. Reheat it.' : `Crumbled! Still fragile — gentle blows until it sets (lost ${(loss * 1000).toFixed(0)} g)`, 'bad', 2.5);
        this.lastKind = 'crumble';
        return;
      }
      const gain = (medium ? 0.025 : v >= GENTLE[0] ? 0.045 : 0.012) * heat;
      p.cohesion = Math.min(1, p.cohesion + gain);
      p.porosity = 0.35 - 0.3 * p.cohesion;
      // squeeze slag out of the sponge
      const out = p.slag * 0.05 * heat;
      p.mass -= p.mass * out; p.stats.slagOut += p.mass * out; p.slag -= out;
      this.spatter.emitter = world; this.spatter.manualEmitCount = Math.round(4 + 60 * p.slag * heat * (0.5 + v / 2));
      p.stats.consHeat += T; p.stats.consBlows++;
      p.blow(x, v, { soft: 1 + p.porosity * 3, smooth: 0.3 * heat });
      this.lastKind = medium ? 'medium' : 'gentle';
      if (p.cohesion >= 1) {
        p.stage = 'ingot';
        g.hud.toast('The bloom has set — it\'s solid iron now. Hit it hard and square it into a rough ingot.', 'good', 5);
        this.panel();
      }
    } else {
      if (T < 750) {
        p.stats.coldHits++;
        g.hud.toast('Too cold! Hammering cold iron cracks it — back to the forge', 'bad', 2);
      }
      const r = p.blow(x, v, { bending: true, smooth: 0.12 });
      this.lastKind = r.kind;
      if (r.kind === 'rock') {
        const m = p.mesh, side = r.side;
        g.tweens.add(0.35, k => { m.rotation.z = Math.sin(k * Math.PI) * 0.06 * side; }, () => { m.rotation.z = 0; });
        if (g.time - this._rockToast > 6) { this._rockToast = g.time; g.hud.toast('It rocks on the curve. Roll it over (right-click twice) so it rests on its ends, then hit the hump.', 'warn', 4.5); }
      }
    }
    this._refreshTarget();
  }
  _sparks(at, n) { this.sparks.emitter = at; this.sparks.manualEmitCount = n; }
  _chunks(at, n) {
    const s = this.g.scene, w = V3(A.x + at.x, YA + at.y, A.z + at.z);
    for (let i = 0; i < n; i++) {
      const m = B.MeshBuilder.CreateIcoSphere('chunk', { radius: rand(0.006, 0.014), subdivisions: 1 }, s);
      m.material = this.piece.mat; m.position.copyFrom(w); m.isPickable = false;
      this.debris.push({ m, v: V3(rand(-0.8, 0.8), rand(0.4, 1.4), rand(-0.9, 0.4)), t: 0 });
    }
  }

  // ------------------------------------------------------------------ shape target
  // the rough ingot is judged on a square, even, straight section at whatever length it is
  _ratio() { const p = this.piece; return p.stage === 'ingot' ? 0 : this.billet ? this.billet.ratio : 0; }
  _refreshTarget() {
    const p = this.piece;
    const show = p && p.location === 'anvil' && (p.stage === 'ingot' || p.stage === 'billet');
    this.target.setEnabled(!!show);
    if (!show) return;
    const tg = this.tg = p.target(this._ratio());
    this.target.scaling.set(tg.L, tg.s, tg.s); this.target.position.set(0, tg.s / 2, 0);
    this.fitV = p.fit(tg, p.stage === 'billet');
    const c = C3(lerp(1, 0.35, this.fitV), lerp(0.45, 1, this.fitV), lerp(0.35, 0.55, this.fitV));
    this.targetMat.emissiveColor = c; this.target.edgesColor = new B.Color4(c.r, c.g, c.b, 0.9);
  }

  simulate(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      d.v.y -= 9.8 * dt; d.m.position.addInPlace(d.v.scale(dt));
      if (d.m.position.y < 0.01) { d.m.position.y = 0.01; d.v.scaleInPlace(0.3); d.v.y = Math.abs(d.v.y) * 0.3; }
      if (d.t > 6) { d.m.dispose(); this.debris.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ stage endings
  finishIngot() {
    const p = this.piece, g = this.g;
    if (!p || p.stage !== 'ingot') return;
    p.stats.ingotFit = this.fitV;
    g.hud.modal(`<h2>Rough ingot — ${Math.round(this.fitV * 100)}% to shape</h2>
      <p>What will this billet become? The outline will be sized to the metal you have (${p.mass.toFixed(2)} kg).</p>`,
      BILLETS.map(b => ({ label: `${b.label} — ${b.note}`, onClick: () => this._startBillet(b) })));
  }
  _startBillet(b) {
    const p = this.piece; this.billet = b; p.stage = 'billet'; p.billet = b.id;
    this._refreshTarget(); this.panel();
    const tg = this.tg;
    this.g.hud.toast(`Draw it out to ${(tg.s * 100).toFixed(1)} cm square × ${(tg.L * 100).toFixed(0)} cm: hit along its length, roll a quarter turn, repeat.`, 'info', 6);
  }
  finishBillet() {
    const p = this.piece, g = this.g;
    if (!p || p.stage !== 'billet') return;
    p.stage = 'done';
    const st = p.stats, d = p.dims(), fit = this.fitV;
    const consT = st.consBlows ? st.consHeat / st.consBlows : 0;
    const consQ = smooth(1000, 1200, consT) * clamp(1 - st.crumbled / st.startMass * 4);
    const retained = p.mass / st.startMass;
    const crack = clamp(1 - st.coldHits * 0.08);
    const score = Math.round(100 * clamp(0.5 * fit + 0.2 * consQ + 0.15 * clamp((p.ingotFitBonus ?? st.ingotFit ?? 0.5)) + 0.15 * crack));
    const grade = score >= 88 ? 'Excellent' : score >= 74 ? 'Good' : score >= 55 ? 'Fair' : 'Poor';
    const notes = [];
    if (st.crumbled > 0.02) notes.push(`${(st.crumbled * 1000).toFixed(0)} g crumbled off the bloom from blows that were too hard (or too cold) before it set.`);
    if (consT && consT < 1100) notes.push(`Consolidated at an average of ${Math.round(consT)} °C — below welding heat, so the sponge didn't weld fully.`);
    if (st.coldHits) notes.push(`${st.coldHits} blow${st.coldHits > 1 ? 's' : ''} on cold iron — risk of hidden cracks.`);
    if (st.burned > 0.01) notes.push(`${(st.burned * 1000).toFixed(0)} g burned away in the forge.`);
    if (fit < 0.6) notes.push('The shape is well off the outline — curls, mushroomed spots or an uneven section.');
    if (!notes.length) notes.push('Clean work.');
    this.target.setEnabled(true);
    g.hud.modal(`<h2>${this.billet.label} finished</h2>
      <div class="grade">${grade} — <b>${score}</b>/100</div>
      <table>
        <tr><td>Size</td><td>${(d.L * 100).toFixed(1)} × ${(d.W * 100).toFixed(1)} × ${(d.H * 100).toFixed(1)} cm</td></tr>
        <tr><td>Target</td><td>${(this.tg.L * 100).toFixed(1)} × ${(this.tg.s * 100).toFixed(1)} × ${(this.tg.s * 100).toFixed(1)} cm</td></tr>
        <tr><td>Match to outline</td><td>${Math.round(fit * 100)}%</td></tr>
        <tr><td>Rough ingot match</td><td>${Math.round((st.ingotFit ?? 0) * 100)}%</td></tr>
        <tr><td>Consolidation</td><td>${Math.round(consQ * 100)}%</td></tr>
        <tr><td>Mass</td><td>${p.mass.toFixed(2)} kg (${Math.round(retained * 100)}% of the bloom; slag squeezed out ${(st.slagOut * 1000).toFixed(0)} g)</td></tr>
        <tr><td>Carbon</td><td>~${p.carbon.toFixed(2)}%</td></tr>
        <tr><td>Blows</td><td>${st.blows}</td></tr>
      </table>
      <ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul>
      <p style="color:var(--dim)">Next phase: forging this billet into the piece itself.</p>`,
      [{ label: 'Start over', onClick: () => location.reload() }, { label: 'Admire it' }]);
  }

  // ------------------------------------------------------------------ hud
  _hint() {
    const p = this.piece;
    if (!p) return 'No workpiece yet — finish the smelt and set the bloom on the stump (or use the dev panel: `)';
    if (p.location !== 'anvil') return '';
    return 'Lift the mouse, then bring it down to strike — faster is harder. Right-click / scroll: quarter turn.';
  }
  _advice() {
    const p = this.piece;
    if (!p) return 'No workpiece.';
    const T = p.T;
    if (p.stage === 'done') return 'Finished.';
    if (p.stage === 'consolidate') {
      if (T < 1000) return 'Too cold to weld the bloom — reheat it in the forge (D)';
      if (T < WELD[0]) return 'Cooling below welding heat — a few more taps, then reheat';
      return 'Gentle blows all over! It\'s a fragile sponge until it sets. Turn it to work every face.';
    }
    if (T < 750) return 'Too cold — back to the forge before it cracks (D)';
    if (T < FORGE[0]) return 'Getting cold: blows barely move it now. Reheat soon.';
    if (p.stage === 'ingot') return 'Hit hard now. Square it to the outline: hit, quarter turn, hit…';
    return 'Draw it out: work along the length, quarter-turn often. Curled? Flip it and hit the hump.';
  }
  panel() {
    const p = this.piece, h = this.g.hud, stage = p ? p.stage : 'none';
    this._stage = stage;
    const defs = [{ id: 'status', type: 'text', cls: 'status' }];
    const band = stage === 'consolidate' ? WELD : FORGE;
    defs.push({ id: 'temp', label: 'Temperature', min: 0, max: 1450, marker: true, bands: [{ from: band[0], to: band[1], cls: 'good' }, { from: 0, to: 750, cls: 'bad' }] });
    defs.push({ id: 'blow', label: 'Last blow', min: 0, max: 6, bands: stage === 'consolidate' ? [{ from: GENTLE[0], to: GENTLE[1], cls: 'good' }, { from: HEAVY, to: 6, cls: 'bad' }] : [] });
    if (stage === 'consolidate') defs.push({ id: 'coh', label: 'Consolidation', min: 0, max: 1, color: '#6fbf73' });
    if (stage === 'ingot' || stage === 'billet' || stage === 'done') defs.push({ id: 'fit', label: 'Match to outline', min: 0, max: 1, color: '#7fb8e0', bands: [{ from: 0.85, to: 1, cls: 'good' }] });
    defs.push({ id: 'info', type: 'text' });
    if (stage === 'ingot') defs.push({ id: 'fin', type: 'button', label: 'This is my rough ingot', onClick: () => this.finishIngot() });
    if (stage === 'billet') defs.push({ id: 'fin', type: 'button', label: 'Finish the billet', onClick: () => this.finishBillet() });
    const title = { consolidate: 'Anvil — consolidate the bloom', ingot: 'Anvil — rough ingot', billet: 'Anvil — ' + (this.billet ? this.billet.label.toLowerCase() : 'billet'), done: 'Anvil — done', none: 'Anvil' }[stage];
    h.panel(title, defs);
  }
  panelUpdate() {
    const p = this.piece, h = this.g.hud;
    if ((p ? p.stage : 'none') !== this._stage) this.panel();
    h.text('status', this._advice());
    if (!p) return;
    h.set('temp', p.T, `${Math.round(p.T)} °C`);
    const v = this.lastBlowShow, kind = this.lastBlow < GENTLE[0] ? 'tap' : this.lastBlow <= GENTLE[1] ? 'gentle' : this.lastBlow <= HEAVY ? 'medium' : 'heavy';
    h.set('blow', v, this.lastBlow ? `${kind} (${this.lastBlow.toFixed(1)} m/s)` : '—');
    h.set('coh', p.cohesion, Math.round(p.cohesion * 100) + '%');
    h.set('fit', this.fitV, Math.round(this.fitV * 100) + '%');
    const d = p.dims(), cm = x => (x * 100).toFixed(1);
    let info = `<b>Size:</b> ${cm(d.L)} × ${cm(d.W)} × ${cm(d.H)} cm · <b>${p.mass.toFixed(2)} kg</b>`;
    if (this.tg && (p.stage === 'ingot' || p.stage === 'billet')) info += `<br><b>Outline:</b> ${cm(this.tg.L)} × ${cm(this.tg.s)} × ${cm(this.tg.s)} cm`;
    if (p.stage === 'consolidate') info += `<br>Slag still in it: ${Math.round(p.slag * 100)}%`;
    h.text('info', info);
  }
}
