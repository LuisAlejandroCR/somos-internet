import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalCdf,
  normalQuantile,
  twoProportionTest,
  sampleSizePerVariant,
  daysToSignificance,
  guardrailBreached,
  wilsonInterval,
  iceScore,
} from "../src/lib/stats.js";
import { makeRng } from "../src/lib/rng.js";
import { createRateLimiter, clientKeyFrom } from "../src/lib/rate-limit.js";
import { writeCsv, readCsv } from "../src/lib/csv.js";
import { computeFunnel, WEB_STEPS } from "../src/pipeline/02-funnel.js";
import { analyzeExperiments } from "../src/pipeline/03-experiments.js";

// ── stats: normal distribution ──
test("normalCdf matches known values", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
  assert.ok(Math.abs(normalCdf(2.5758) - 0.995) < 1e-3);
});

test("normalQuantile inverts normalCdf", () => {
  for (const p of [0.025, 0.1, 0.5, 0.8, 0.975, 0.99]) {
    const z = normalQuantile(p);
    assert.ok(Math.abs(normalCdf(z) - p) < 1e-4, `round-trip failed for p=${p}`);
  }
});

test("normalQuantile rejects out-of-range input", () => {
  assert.throws(() => normalQuantile(0), RangeError);
  assert.throws(() => normalQuantile(1), RangeError);
});

// ── stats: the z-test, against a hand-computed example ──
test("twoProportionTest reproduces a hand-computed z and p", () => {
  // control 100/1000 = 0.10, variant 130/1000 = 0.13
  // pooled p = 0.115 → SE = sqrt(0.115*0.885*0.002) ≈ 0.0142672
  // z = 0.03 / 0.0142672 ≈ 2.1027 → two-tailed p ≈ 0.0355
  const r = twoProportionTest({
    controlConversions: 100,
    controlTotal: 1000,
    variantConversions: 130,
    variantTotal: 1000,
  });
  assert.ok(Math.abs(r.z - 2.1027) < 0.01, `z was ${r.z}`);
  assert.ok(Math.abs(r.pValue - 0.0355) < 0.002, `p was ${r.pValue}`);
  assert.equal(r.significant, true);
  assert.ok(Math.abs(r.absoluteLift - 0.03) < 1e-9);
  assert.ok(Math.abs(r.relativeLift - 0.3) < 1e-9);
});

test("twoProportionTest: identical rates give z=0 and p=1", () => {
  const r = twoProportionTest({ controlConversions: 50, controlTotal: 500, variantConversions: 50, variantTotal: 500 });
  assert.equal(r.z, 0);
  // The erf approximation carries ~1.5e-7 of error by construction, so p lands
  // adjacent to 1 rather than exactly on it.
  assert.ok(Math.abs(r.pValue - 1) < 1e-6);
  assert.equal(r.significant, false);
});

test("twoProportionTest: confidence interval brackets the observed lift", () => {
  const r = twoProportionTest({ controlConversions: 200, controlTotal: 2000, variantConversions: 260, variantTotal: 2000 });
  assert.ok(r.ciLow < r.absoluteLift && r.absoluteLift < r.ciHigh);
});

test("twoProportionTest rejects impossible inputs", () => {
  assert.throws(() => twoProportionTest({ controlConversions: 5, controlTotal: 0, variantConversions: 1, variantTotal: 10 }), RangeError);
  assert.throws(() => twoProportionTest({ controlConversions: 20, controlTotal: 10, variantConversions: 1, variantTotal: 10 }), RangeError);
  assert.throws(() => twoProportionTest({ controlConversions: -1, controlTotal: 10, variantConversions: 1, variantTotal: 10 }), RangeError);
});

// ── stats: sample size ──
test("sampleSizePerVariant grows as the effect shrinks", () => {
  const big = sampleSizePerVariant({ baselineRate: 0.1, mde: 0.2 });
  const small = sampleSizePerVariant({ baselineRate: 0.1, mde: 0.05 });
  assert.ok(small > big * 3, "halving MDE should multiply required n substantially");
  assert.ok(Number.isInteger(big) && big > 0);
});

test("sampleSizePerVariant rejects impossible targets", () => {
  assert.throws(() => sampleSizePerVariant({ baselineRate: 0.9, mde: 0.5 }), RangeError); // p2 >= 1
  assert.throws(() => sampleSizePerVariant({ baselineRate: 0, mde: 0.1 }), RangeError);
  assert.throws(() => sampleSizePerVariant({ baselineRate: 0.1, mde: 0 }), RangeError);
});

test("daysToSignificance splits traffic across variants", () => {
  const r = daysToSignificance({ baselineRate: 0.2, mde: 0.1, dailyTraffic: 1000, variants: 2 });
  assert.equal(r.totalRequired, r.perVariant * 2);
  assert.ok(r.days >= 1);
  // Doubling daily traffic should roughly halve the days needed.
  const faster = daysToSignificance({ baselineRate: 0.2, mde: 0.1, dailyTraffic: 2000, variants: 2 });
  assert.ok(faster.days <= r.days);
});

// ── stats: guardrails ──
test("guardrailBreached only fires beyond the agreed tolerance", () => {
  // Cost metric (higher is worse): 10 → 10.4 is +4%, inside a 5% tolerance.
  assert.equal(guardrailBreached({ controlValue: 10, variantValue: 10.4, toleranceRelative: 0.05 }).breached, false);
  assert.equal(guardrailBreached({ controlValue: 10, variantValue: 11.0, toleranceRelative: 0.05 }).breached, true);
});

test("guardrailBreached respects higherIsBetter direction", () => {
  // Quality metric (higher is better): a drop is the bad direction.
  assert.equal(guardrailBreached({ controlValue: 0.8, variantValue: 0.7, toleranceRelative: 0.05, higherIsBetter: true }).breached, true);
  assert.equal(guardrailBreached({ controlValue: 0.8, variantValue: 0.9, toleranceRelative: 0.05, higherIsBetter: true }).breached, false);
});

// ── stats: intervals and scoring ──
test("wilsonInterval stays inside [0,1] at extremes", () => {
  const zero = wilsonInterval({ conversions: 0, total: 30 });
  assert.ok(zero.low >= 0 && zero.high <= 1 && zero.high > 0);
  const all = wilsonInterval({ conversions: 30, total: 30 });
  assert.ok(all.high <= 1 && all.low < 1);
});

test("iceScore averages and validates its inputs", () => {
  assert.equal(iceScore({ impact: 8, confidence: 7, ease: 9 }), 8);
  assert.throws(() => iceScore({ impact: 11, confidence: 5, ease: 5 }), RangeError);
  assert.throws(() => iceScore({ impact: 0, confidence: 5, ease: 5 }), RangeError);
});

// ── rng ──
test("makeRng is deterministic for a given seed", () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test("makeRng produces different streams for different seeds", () => {
  const a = Array.from({ length: 10 }, makeRng(1).next);
  const b = Array.from({ length: 10 }, makeRng(2).next);
  assert.notDeepEqual(a, b);
});

test("rng.weighted only returns declared keys", () => {
  const rng = makeRng(7);
  const keys = new Set();
  for (let i = 0; i < 500; i++) keys.add(rng.weighted({ a: 1, b: 2, c: 3 }));
  assert.deepEqual([...keys].sort(), ["a", "b", "c"]);
});

test("rng.weighted rejects non-numeric weights instead of silently collapsing", () => {
  // Regression guard: passing a nested config object used to make every draw
  // return the last key, which silently flattened a whole segment breakdown
  // onto one value. It must throw now.
  const rng = makeRng(7);
  assert.throws(() => rng.weighted({ medellin: { weight: 44 }, bogota: { weight: 38 } }), TypeError);
  assert.throws(() => rng.weighted({ a: NaN }), TypeError);
  assert.throws(() => rng.weighted({ a: -1 }), TypeError);
  assert.throws(() => rng.weighted({}), RangeError);
  assert.throws(() => rng.weighted({ a: 0, b: 0 }), RangeError);
});

test("rng.weighted respects the declared proportions", () => {
  const rng = makeRng(11);
  const tally = { a: 0, b: 0 };
  for (let i = 0; i < 20000; i++) tally[rng.weighted({ a: 3, b: 1 })]++;
  const shareA = tally.a / 20000;
  assert.ok(Math.abs(shareA - 0.75) < 0.02, `expected ~75% a, got ${(shareA * 100).toFixed(1)}%`);
});

// ── rate limiting ──
test("rateLimiter allows a burst up to capacity, then blocks", () => {
  const rl = createRateLimiter({ capacity: 5, refillPerSecond: 1 });
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check("ip-a", now).allowed, true, `request ${i + 1} should pass`);
  }
  const blocked = rl.check("ip-a", now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("rateLimiter refills over time", () => {
  const rl = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
  const t0 = 5_000_000;
  for (let i = 0; i < 3; i++) rl.check("ip-b", t0);
  assert.equal(rl.check("ip-b", t0).allowed, false);
  // Two seconds later, two tokens are back.
  assert.equal(rl.check("ip-b", t0 + 2000).allowed, true);
  assert.equal(rl.check("ip-b", t0 + 2000).allowed, true);
  assert.equal(rl.check("ip-b", t0 + 2000).allowed, false);
});

test("rateLimiter never refills beyond capacity", () => {
  const rl = createRateLimiter({ capacity: 4, refillPerSecond: 10 });
  const t0 = 9_000_000;
  rl.check("ip-c", t0);
  // A very long idle period must not create a bigger burst than capacity.
  for (let i = 0; i < 4; i++) assert.equal(rl.check("ip-c", t0 + 3_600_000).allowed, true);
  assert.equal(rl.check("ip-c", t0 + 3_600_000).allowed, false);
});

test("rateLimiter isolates callers from each other", () => {
  const rl = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
  const now = 2_000_000;
  rl.check("ip-1", now);
  rl.check("ip-1", now);
  assert.equal(rl.check("ip-1", now).allowed, false);
  // A different caller still has a full bucket.
  assert.equal(rl.check("ip-2", now).allowed, true);
});

test("rateLimiter bounds its memory under a spray of unique keys", () => {
  const rl = createRateLimiter({ capacity: 2, refillPerSecond: 1, maxEntries: 50 });
  for (let i = 0; i < 500; i++) rl.check(`ip-${i}`, 3_000_000 + i);
  assert.ok(rl.size() <= 50, `bucket map grew to ${rl.size()}, expected <= 50`);
});

test("rateLimiter validates its configuration", () => {
  assert.throws(() => createRateLimiter({ capacity: 0 }), RangeError);
  assert.throws(() => createRateLimiter({ refillPerSecond: 0 }), RangeError);
});

test("clientKeyFrom prefers the header the edge controls", () => {
  const headers = new Headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" });
  // x-forwarded-for is client-settable; cf-connecting-ip is set by Cloudflare.
  assert.equal(clientKeyFrom(headers), "9.9.9.9");
  assert.equal(clientKeyFrom(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "1.1.1.1");
  assert.equal(clientKeyFrom(new Headers({}), "fallback"), "fallback");
  // Plain objects work too, for the Node server path.
  assert.equal(clientKeyFrom({ "x-real-ip": "5.5.5.5" }), "5.5.5.5");
});

// ── csv ──
test("csv round-trips values that need quoting", () => {
  const dir = mkdtempSync(join(tmpdir(), "somos-csv-"));
  try {
    const path = join(dir, "t.csv");
    const rows = [{ id: "1", label: 'Con "comillas", y coma', n: "5" }];
    writeCsv(path, ["id", "label", "n"], rows);
    assert.deepEqual(readCsv(path), rows);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── pipeline: funnel ──
test("computeFunnel is monotonic and counts drop-off correctly", () => {
  const sessions = [
    { path: "web", outcome: "scheduled", reached: WEB_STEPS, city: "medellin", source: "organic", estrato_group: "1-3", device: "mobile", eligible_building: true },
    { path: "web", outcome: "abandoned_phone", reached: ["landing", "form_start", "identity"], city: "bogota", source: "paid", estrato_group: "4-6", device: "mobile", eligible_building: true },
    { path: "web", outcome: "bounced", reached: ["landing"], city: "bogota", source: "paid", estrato_group: "1-3", device: "desktop", eligible_building: false },
  ];
  const f = computeFunnel(sessions);
  const reached = f.web_funnel.map((s) => s.reached);
  for (let i = 1; i < reached.length; i++) {
    assert.ok(reached[i] <= reached[i - 1], `step ${i} (${reached[i]}) exceeded previous (${reached[i - 1]})`);
  }
  assert.equal(f.web_funnel[0].reached, 3); // all three hit landing
  assert.equal(f.totals.scheduled, 1);
});

// ── pipeline: experiment analysis ──
test("analyzeExperiments kills a null result once it is powered", () => {
  // 6000 sessions per arm, identical true rate → must not be significant.
  const sessions = [];
  const rng = makeRng(99);
  for (let i = 0; i < 12000; i++) {
    const variant = i % 2 === 0 ? "control" : "variant";
    const reached = ["landing", "form_start", "identity"];
    if (rng.bool(0.5)) reached.push("phone");
    sessions.push({
      session_id: `S${i}`,
      path: "web",
      outcome: "abandoned_phone",
      reached,
      eligible_building: true,
      experiments: { "EXP-X": variant },
    });
  }
  const [result] = analyzeExperiments({
    sessions,
    conversations: [],
    experiments: [
      { id: "EXP-X", name: "null test", proposal: "PX", hypothesis: "h", primaryMetric: "step1_completion", guardrailMetric: null, status: "completed" },
    ],
  });
  assert.equal(result.significant, false);
  assert.equal(result.powered, true);
  assert.equal(result.decision, "descartar");
});

test("analyzeExperiments blocks a win that breaks its guardrail", () => {
  const sessions = [];
  // Draw outcomes from an independent RNG rather than from `i`, so the variant
  // assignment and the outcome aren't accidentally correlated (which would
  // produce degenerate 0%/100% rates instead of a realistic comparison).
  const rng = makeRng(2024);
  for (let i = 0; i < 8000; i++) {
    const variant = i % 2 === 0 ? "control" : "variant";
    const reached = ["landing", "form_start"];
    // Variant wins big on the primary metric (qualified leads)…
    if (rng.bool(variant === "variant" ? 0.75 : 0.5)) reached.push("eligibility");
    // …while collapsing the guardrail (step-1 completion).
    if (rng.bool(variant === "variant" ? 0.2 : 0.6)) reached.push("identity", "phone");
    sessions.push({ session_id: `S${i}`, path: "web", outcome: "x", reached, eligible_building: true, experiments: { "EXP-G": variant } });
  }
  const [result] = analyzeExperiments({
    sessions,
    conversations: [],
    experiments: [
      { id: "EXP-G", name: "guardrail test", proposal: "PG", hypothesis: "h", primaryMetric: "qualified_lead_rate", guardrailMetric: "step1_completion", status: "completed" },
    ],
  });
  assert.equal(result.guardrail.breached, true);
  assert.equal(result.decision, "no_lanzar_guardia");
});
