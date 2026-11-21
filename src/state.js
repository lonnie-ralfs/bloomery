// Player progress shared by all stations.
export const state = {
  // carried containers
  clay: 0, clayCap: 12,
  straw: 0, strawCap: 6,
  ore: 0, oreIronKg: 0, // kg in the ore bucket, and how much of that is actual iron sand (the rest is quartz)
  // lifetime counters (for objectives)
  clayDug: 0, strawPulled: 0, orePanned: 0,
  // daub (clay + straw + water, mixed) ready for building
  daub: 0, daubQ: 0, daubBatches: 0,
  furnace: { courses: 0, tuyere: false, plug: false, drying: false, dry: 0, dried: false },
};
export const purity = () => (state.ore > 0 ? state.oreIronKg / state.ore : 0);
