// rng.js — seeded PRNG so the whole synthetic dataset is reproducible: anyone
// who runs `npm run run-all` gets byte-identical output. That reproducibility
// is the point — a demo built on unseeded randomness can't be audited by a
// reviewer.

// mulberry32: small, fast, good enough distribution for simulation work.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    // Uniform float in [min, max).
    float: (min, max) => min + next() * (max - min),
    // Integer in [min, max] inclusive.
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    // True with probability p.
    bool: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Picks a key from { key: weight } proportionally to weight.
    //
    // The validation is not decoration: passing a nested config object (e.g.
    // { medellin: { weight: 44, ... } }) instead of plain numbers used to make
    // every draw silently collapse onto the last key, which quietly destroyed a
    // whole segment breakdown. Failing loudly is much cheaper than debugging
    // a dashboard that renders one city.
    weighted: (weights) => {
      const entries = Object.entries(weights);
      if (entries.length === 0) throw new RangeError("weighted() needs at least one entry");
      let total = 0;
      for (const [key, w] of entries) {
        if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
          throw new TypeError(`weighted(): weight for "${key}" must be a non-negative finite number, got ${JSON.stringify(w)}`);
        }
        total += w;
      }
      if (total <= 0) throw new RangeError("weighted(): weights must sum to more than 0");
      let roll = next() * total;
      for (const [key, w] of entries) {
        roll -= w;
        if (roll <= 0) return key;
      }
      return entries[entries.length - 1][0];
    },
    // Box-Muller. Used for day-to-day traffic noise.
    normal: (mean = 0, sd = 1) => {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
