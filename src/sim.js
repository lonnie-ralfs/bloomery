// Bloomery smelt model. Pure logic, no rendering.
//
// Heat comes from charcoal burning in the air the bellows push through the tuyere. Iron sand charged
// on top descends and is reduced to metallic iron in the hot zone; the iron welds into a spongy bloom
// at the bottom, while the gangue + some iron oxide melt into slag that pools around it. Too cold and
// the ore doesn't reduce; too hot and the iron soaks up carbon (toward cast iron). Slag that rises to
// the tuyere chokes the air and gets trapped in the bloom, so it has to be tapped off.
import { clamp, smooth, interp, lerp } from './util.js';

export const SLAG_CAP = 2.4;   // kg of slag that fills the hearth up to the tuyere
export const FILL_CAP = 7;     // shaft capacity (1 unit = 1 scoop of charcoal; ore takes 0.45/kg)
export const BAND = [1150, 1350];

const KR = [[850, 0], [1000, 0.012], [1100, 0.03], [1200, 0.045], [1400, 0.055]];                 // reduction rate /s
const EFF = [[900, 0], [1050, 0.25], [1150, 0.55], [1250, 0.66], [1350, 0.62], [1450, 0.45], [1550, 0.3]]; // iron recovered
const CARB = [[1000, 0.05], [1150, 0.1], [1250, 0.35], [1325, 0.8], [1400, 1.6], [1475, 3.0], [1550, 4.0]]; // carbon % taken up
const COMPACT = [[1000, 0.2], [1100, 0.45], [1200, 0.85], [1260, 1], [1350, 0.95], [1450, 0.8]];          // how well iron welds together

export class SmeltSim {
  constructor() { this.reset(); }
  reset() {
    Object.assign(this, {
      T: 15, Tss: 15, P: 0, air: 0, airEff: 0, choke: 0,
      F: 0, ore: 0, oreIron: 0, slag: 0,
      bloom: 0, carbon: 0, incl: 0,
      lit: false, override: null, tapping: false, tapFlow: 0, sink: 0,
      wall: 1, erosion: 0,
      chargedOre: 0, chargedFe: 0, charcoalUsed: 0, reachedHeat: false,
      redQ: 0, redIron: 0, hotTime: 0, coldTime: 0, chokeTime: 0, exposedTime: 0, slagTapped: 0, tapCount: 0,
      _fuelWarned: false, _hotWarned: false,
    });
  }
  get slagLevel() { return this.slag / SLAG_CAP; }
  get fill() { return this.F + this.ore * 0.45; }
  get fluidity() { return smooth(1050, 1250, this.T); }
  get integrity() { return clamp(this.wall - this.erosion, 0.2, 1); }
  canAdd(u) { return this.fill + u <= FILL_CAP + 0.01; }
  addCharcoal(u = 1) { this.F += u; this.sink += 8 * u; this.charcoalUsed += u; this._fuelWarned = false; }
  addOre(kg, ironKg) { this.ore += kg; this.oreIron += ironKg; this.sink += 32 * kg; this.chargedOre += kg; this.chargedFe += ironKg; }
  openTap() {
    if (this.slag < 0.08) return 'empty';
    if (this.fluidity < 0.15) return 'cold';
    if (!this.tapping) this.tapCount++;
    this.tapping = true;
    return 'ok';
  }

  // pump: bellows outflow (bag volumes per second)
  step(dt, pump) {
    const ev = [];
    if (dt <= 0) return ev;
    this.P += pump * dt; this.P -= this.P * 0.8 * dt;
    this.air = Math.min(1.6, this.P * 0.8); // steady state: air ≈ full bellows strokes per second
    const S = this.slagLevel;
    this.choke = smooth(0.8, 1.02, S);
    const airEff = this.airEff = this.air * (1 - 0.85 * this.choke);

    let Tss = 15;
    if (this.override != null) Tss = this.override + 450 * airEff; // drying fire
    else if (this.lit && this.F > 0) {
      const fuelF = smooth(0, 1.4, this.F);
      Tss = 15 + 1700 * (1 - Math.exp(-1.6 * airEff)) * fuelF * (0.82 + 0.18 * this.integrity);
      Tss = Math.max(Tss, 420 * fuelF); // natural draught keeps it smouldering
      const ratio = this.ore / Math.max(this.F, 0.25);
      Tss -= Math.max(0, ratio - 1.3) * 120; // too much ore smothers the fire
      this.F = Math.max(0, this.F - (0.008 + 0.055 * airEff) * dt);
      if (this.F <= 0.6 && !this._fuelWarned) { this._fuelWarned = true; ev.push('fuellow'); }
    }
    if (this.lit && this.F <= 0 && this.T < 380) { this.lit = false; ev.push('fireout'); }
    this.Tss = Tss;
    const rate = Tss > this.T ? 0.2 : 0.1;
    this.T += (Tss - this.T) * (1 - Math.exp(-rate * dt));
    if (this.sink > 0) { const s = Math.min(this.sink, Math.max(this.sink * 2.2 * dt, 4 * dt)); this.T -= s; this.sink -= s; }

    // slag tapping
    if (this.tapping) {
      const flu = this.fluidity;
      if (flu < 0.12) { this.tapping = false; ev.push('frozen'); }
      else {
        const d = Math.min(this.slag, 0.45 * flu * dt);
        this.slag -= d; this.slagTapped += d; this.tapFlow = 0.45 * flu; this.T -= 3 * dt;
        if (this.slag < 0.06) { this.tapping = false; ev.push('drained'); }
      }
    }
    if (!this.tapping) this.tapFlow = 0;

    // reduction of the ore in the shaft
    if (this.ore > 1e-4) {
      const kr = interp(KR, this.T);
      if (kr > 0) {
        const d = Math.min(this.ore, this.ore * kr * dt + 0.002 * dt);
        const fe = this.oreIron * (d / this.ore);
        this.ore -= d; this.oreIron = Math.max(0, this.oreIron - fe);
        const eff = interp(EFF, this.T);
        const iron = fe * 0.7 * eff; // iron sand (magnetite) is ~70% Fe
        const tC = interp(CARB, this.T);
        this.carbon = (this.carbon * this.bloom + tC * iron) / Math.max(1e-6, this.bloom + iron);
        this.bloom += iron;
        this.slag += (d - fe) * 0.9 + fe * (1 - 0.7 * eff) * 0.8;
        if (S > 0.85) this.incl += iron * (S - 0.85) * 3;
        this.redQ += iron * interp(COMPACT, this.T); this.redIron += iron;
      }
      if (this.T < 1050 && this.ore > 0.2) this.coldTime += dt;
      if (this.T > 1400) this.hotTime += dt;
    }
    // a bloom sitting in a very hot fire keeps absorbing carbon
    if (this.bloom > 0 && this.T > 1320) { const tC = interp(CARB, this.T); if (tC > this.carbon) this.carbon += (tC - this.carbon) * 0.012 * dt; }
    // blowing on a bloom that's no longer covered by charcoal burns it back to oxide
    if (this.bloom > 0 && this.F < 0.6 && airEff > 0.35 && this.T > 1000) {
      this.bloom = Math.max(0, this.bloom - 0.012 * airEff * dt); this.exposedTime += dt;
    }
    if (this.choke > 0.3 && this.lit) this.chokeTime += dt;
    if (this.T > 1480) {
      this.erosion = Math.min(0.8, this.erosion + 0.004 * dt);
      if (!this._hotWarned) { this._hotWarned = true; ev.push('scorch'); }
    } else if (this.T < 1400) this._hotWarned = false;
    if (this.T >= 1100 && this.lit) this.reachedHeat = true;
    return ev;
  }

  result(oreUnused) {
    const M = this.bloom;
    const fe = this.chargedFe * 0.7;
    const yieldPct = fe > 0 ? M / fe : 0;
    const compaction = this.redIron > 0 ? this.redQ / this.redIron : 0;
    const incl = clamp(this.incl / Math.max(0.1, M));
    const C = this.carbon;
    const carbonScore = C <= 1.2 ? 1 : C <= 2 ? lerp(1, 0.4, (C - 1.2) / 0.8) : 0.15;
    const sizeF = clamp(M / 0.8, 0.3, 1);
    const integ = this.integrity;
    const score = Math.round(100 * clamp(0.35 * compaction + 0.25 * (1 - incl) + 0.25 * carbonScore + 0.15 * integ) * sizeF);
    const type = C < 0.2 ? 'soft wrought iron' : C < 0.8 ? 'mild steel' : C < 1.5 ? 'high-carbon steel' : C < 2.1 ? 'very high carbon (brittle)' : 'cast iron — will crumble under the hammer';
    const grade = score >= 88 ? 'Excellent' : score >= 74 ? 'Good' : score >= 55 ? 'Fair' : 'Poor';
    const notes = [];
    if (this.hotTime > 8) notes.push(`Ran above 1400 °C for ${Math.round(this.hotTime)} s — carbon soaked into the iron.`);
    if (this.coldTime > 10) notes.push(`Ore sat below reducing heat for ${Math.round(this.coldTime)} s — poorer yield and a looser bloom.`);
    if (this.chokeTime > 3) notes.push(`Slag drowned the tuyere for ${Math.round(this.chokeTime)} s — slag got trapped in the bloom.`);
    if (this.exposedTime > 3) notes.push(`Air blew on an uncovered bloom for ${Math.round(this.exposedTime)} s — some iron burned back to oxide.`);
    if (integ < 0.85) notes.push('Cracked or eroded walls leaked heat and air.');
    if (this.chargedOre > 0 && this.chargedFe / this.chargedOre < 0.75) notes.push('Dirty iron sand (lots of quartz) made extra slag and less iron.');
    if (this.tapCount === 0 && this.slagTapped < 0.1) notes.push('You never tapped the slag.');
    if (oreUnused > 0.05) notes.push(`${oreUnused.toFixed(1)} kg of iron sand was left in the bucket.`);
    if (!notes.length) notes.push('A clean, steady smelt. Nicely done.');
    return { M, yieldPct, compaction, incl, C, type, score, grade, notes, integ, charged: this.chargedOre, charcoal: this.charcoalUsed, taps: this.tapCount };
  }
}
