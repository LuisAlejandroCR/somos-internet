import { test } from "node:test";
import assert from "node:assert/strict";
import {
  twoProportionTest,
  sampleSizePerVariant,
  wilsonInterval,
  guardrailBreached,
  normalCdf,
  normalQuantile,
} from "../src/lib/stats.js";
import { makeRng } from "../src/lib/rng.js";

// Randomised property tests. Seeded so a failure is always reproducible —
// a fuzz test you can't re-run is just a flaky test.
const ITERATIONS = 2000;

test("fuzz: twoProportionTest never returns NaN and keeps p in [0,1]", () => {
  const rng = makeRng(1337);
  for (let i = 0; i < ITERATIONS; i++) {
    const controlTotal = rng.int(1, 50000);
    const variantTotal = rng.int(1, 50000);
    const controlConversions = rng.int(0, controlTotal);
    const variantConversions = rng.int(0, variantTotal);
    const r = twoProportionTest({ controlConversions, controlTotal, variantConversions, variantTotal });

    assert.ok(Number.isFinite(r.z), `z not finite at i=${i}`);
    assert.ok(Number.isFinite(r.pValue), `p not finite at i=${i}`);
    assert.ok(r.pValue >= 0 && r.pValue <= 1, `p out of range (${r.pValue}) at i=${i}`);
    assert.ok(r.pControl >= 0 && r.pControl <= 1);
    assert.ok(r.pVariant >= 0 && r.pVariant <= 1);
    assert.ok(Number.isFinite(r.ciLow) && Number.isFinite(r.ciHigh));
    assert.ok(r.ciLow <= r.ciHigh, `inverted CI at i=${i}`);
  }
});

test("fuzz: the observed lift always sits inside its own confidence interval", () => {
  const rng = makeRng(4242);
  for (let i = 0; i < ITERATIONS; i++) {
    const controlTotal = rng.int(30, 20000);
    const variantTotal = rng.int(30, 20000);
    const r = twoProportionTest({
      controlConversions: rng.int(0, controlTotal),
      controlTotal,
      variantConversions: rng.int(0, variantTotal),
      variantTotal,
    });
    assert.ok(r.ciLow <= r.absoluteLift + 1e-12 && r.absoluteLift - 1e-12 <= r.ciHigh, `lift outside CI at i=${i}`);
  }
});

test("fuzz: significance and p-value never disagree", () => {
  const rng = makeRng(555);
  for (let i = 0; i < ITERATIONS; i++) {
    const controlTotal = rng.int(50, 30000);
    const variantTotal = rng.int(50, 30000);
    const r = twoProportionTest({
      controlConversions: rng.int(0, controlTotal),
      controlTotal,
      variantConversions: rng.int(0, variantTotal),
      variantTotal,
    });
    assert.equal(r.significant, r.pValue < 0.05, `significant/p mismatch at i=${i} (p=${r.pValue})`);
  }
});

test("fuzz: sampleSizePerVariant returns a positive integer for valid inputs", () => {
  const rng = makeRng(909);
  for (let i = 0; i < 1000; i++) {
    const baselineRate = rng.float(0.01, 0.7);
    const maxMde = (1 - baselineRate) / baselineRate;
    const mde = rng.float(0.01, Math.min(0.9, maxMde * 0.95));
    const n = sampleSizePerVariant({ baselineRate, mde });
    assert.ok(Number.isInteger(n) && n > 0, `bad n=${n} for base=${baselineRate} mde=${mde}`);
  }
});

test("fuzz: wilsonInterval stays within [0,1] and contains the point estimate", () => {
  const rng = makeRng(77);
  for (let i = 0; i < ITERATIONS; i++) {
    const total = rng.int(1, 10000);
    const conversions = rng.int(0, total);
    const { low, high } = wilsonInterval({ conversions, total });
    const p = conversions / total;
    assert.ok(low >= 0 && high <= 1, `interval escaped [0,1] at i=${i}`);
    assert.ok(low <= p + 1e-9 && p - 1e-9 <= high, `point estimate outside interval at i=${i}`);
  }
});

test("fuzz: normalCdf is monotonic and bounded", () => {
  const rng = makeRng(31415);
  for (let i = 0; i < ITERATIONS; i++) {
    const a = rng.float(-6, 6);
    const b = a + rng.float(0.0001, 3);
    const ca = normalCdf(a);
    const cb = normalCdf(b);
    assert.ok(ca >= -1e-9 && ca <= 1 + 1e-9, `cdf out of bounds: ${ca}`);
    assert.ok(cb >= ca - 1e-9, `cdf not monotonic between ${a} and ${b}`);
  }
});

test("fuzz: normalQuantile round-trips through normalCdf", () => {
  const rng = makeRng(2718);
  for (let i = 0; i < 1000; i++) {
    const p = rng.float(0.001, 0.999);
    const z = normalQuantile(p);
    assert.ok(Math.abs(normalCdf(z) - p) < 1e-3, `round-trip drifted at p=${p}`);
  }
});

test("fuzz: guardrailBreached is direction-consistent", () => {
  const rng = makeRng(8080);
  for (let i = 0; i < ITERATIONS; i++) {
    const controlValue = rng.float(0.01, 100);
    const variantValue = rng.float(0.01, 100);
    const tolerance = rng.float(0.01, 0.5);
    const asCost = guardrailBreached({ controlValue, variantValue, toleranceRelative: tolerance, higherIsBetter: false });
    const asQuality = guardrailBreached({ controlValue, variantValue, toleranceRelative: tolerance, higherIsBetter: true });
    // A single change can't be "too much worse" under both interpretations.
    assert.ok(!(asCost.breached && asQuality.breached), `both directions breached at i=${i}`);
  }
});

test("fuzz: rng.int always lands within its declared bounds", () => {
  const rng = makeRng(12);
  for (let i = 0; i < ITERATIONS; i++) {
    const lo = rng.int(-100, 100);
    const hi = lo + rng.int(0, 200);
    const v = rng.int(lo, hi);
    assert.ok(Number.isInteger(v) && v >= lo && v <= hi, `${v} escaped [${lo},${hi}]`);
  }
});
