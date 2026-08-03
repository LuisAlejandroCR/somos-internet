// invariant.test.js — properties that must hold for ANY generated dataset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDataset } from "../src/pipeline/01-generate.js";
import { computeFunnel } from "../src/pipeline/02-funnel.js";
import { analyzeExperiments } from "../src/pipeline/03-experiments.js";
import { deriveProductLayer } from "../src/pipeline/04-derive.js";

// These are the guardrails on the demo itself: if one of these breaks, a
// number on the dashboard is lying, and a lying dashboard is worse than no
// dashboard.

// A smaller window keeps the suite fast while exercising the same code paths.
const data = generateDataset({ seed: 424242, days: 30 });
const funnel = computeFunnel(data.sessions);
const results = analyzeExperiments({
  sessions: data.sessions,
  conversations: data.conversations,
  experiments: data.experiments,
});
const derived = deriveProductLayer({
  funnel,
  experimentResults: results,
  operations: data.operations,
  meta: data.meta,
});

test("invariant: every artifact is flagged as synthetic", () => {
  assert.equal(data.meta.synthetic, true);
  assert.equal(funnel.synthetic, true);
  assert.equal(derived.synthetic, true);
  assert.match(data.meta.warning, /SINTÉTICOS/);
});

test("invariant: the generator is reproducible for a fixed seed", () => {
  const a = generateDataset({ seed: 7, days: 5 });
  const b = generateDataset({ seed: 7, days: 5 });
  assert.equal(a.sessions.length, b.sessions.length);
  assert.deepEqual(a.sessions[0], b.sessions[0]);
  assert.deepEqual(a.operations, b.operations);
});

test("invariant: funnels never gain users as they descend", () => {
  for (const name of ["web_funnel", "wa_funnel"]) {
    const steps = funnel[name];
    for (let i = 1; i < steps.length; i++) {
      assert.ok(
        steps[i].reached <= steps[i - 1].reached,
        `${name}: "${steps[i].label}" (${steps[i].reached}) exceeds "${steps[i - 1].label}" (${steps[i - 1].reached})`
      );
    }
  }
});

test("invariant: all rates stay within [0,1]", () => {
  const rates = [
    funnel.totals.conversion,
    ...funnel.web_funnel.flatMap((s) => [s.step_conversion, s.cumulative_conversion, s.drop_off_rate]),
    ...funnel.wa_funnel.flatMap((s) => [s.step_conversion, s.cumulative_conversion, s.drop_off_rate]),
    ...funnel.by_city.map((s) => s.conversion),
    ...funnel.by_source.map((s) => s.conversion),
  ];
  for (const r of rates) assert.ok(r >= 0 && r <= 1, `rate out of range: ${r}`);
});

test("invariant: every configured dimension actually splits into groups", () => {
  // Regression guard: a bad weights map once collapsed all 86k sessions onto a
  // single city, and every total still reconciled — so only an explicit
  // "did this dimension actually vary?" check catches it.
  const expected = { by_city: 5, by_source: 5, by_estrato: 2, by_device: 2, by_path: 2 };
  for (const [key, minGroups] of Object.entries(expected)) {
    assert.equal(funnel[key].length, minGroups, `${key} produced ${funnel[key].length} groups, expected ${minGroups}`);
    // And no single group may swallow everything.
    const biggest = Math.max(...funnel[key].map((g) => g.sessions));
    assert.ok(biggest < funnel.totals.sessions, `${key} collapsed onto a single value`);
  }
});

test("invariant: session counts reconcile across every breakdown", () => {
  const total = funnel.totals.sessions;
  for (const key of ["by_city", "by_source", "by_estrato", "by_device", "by_path"]) {
    const sum = funnel[key].reduce((s, g) => s + g.sessions, 0);
    assert.equal(sum, total, `${key} sums to ${sum}, expected ${total}`);
  }
  assert.equal(funnel.totals.web_sessions + funnel.totals.wa_sessions, total);
});

test("invariant: scheduled sessions equal the sum of scheduled across segments", () => {
  const bySegment = funnel.by_city.reduce((s, g) => s + g.scheduled, 0);
  assert.equal(bySegment, funnel.totals.scheduled);
});

test("invariant: a session marked scheduled actually reached the scheduled step", () => {
  for (const s of data.sessions) {
    if (s.outcome === "scheduled") assert.ok(s.reached.includes("scheduled"), `${s.session_id} claims scheduled without the step`);
    if (s.reached.includes("scheduled")) assert.equal(s.outcome, "scheduled", `${s.session_id} reached scheduled but outcome is ${s.outcome}`);
  }
});

test("invariant: experiment assignment is a fair coin", () => {
  const byExp = new Map();
  for (const a of data.assignments) {
    if (!byExp.has(a.experiment_id)) byExp.set(a.experiment_id, { control: 0, variant: 0 });
    byExp.get(a.experiment_id)[a.variant]++;
  }
  for (const [id, { control, variant }] of byExp) {
    const total = control + variant;
    const share = control / total;
    // 45–55% is a generous band; a real imbalance (broken bucketing) blows past it.
    assert.ok(share > 0.45 && share < 0.55, `${id} assignment skewed: ${(share * 100).toFixed(1)}% control of ${total}`);
  }
});

test("invariant: operations conserve installs and never go negative", () => {
  let cumulativeScheduled = 0;
  let cumulativeInstalled = 0;
  for (const day of data.operations) {
    cumulativeScheduled += day.scheduled;
    cumulativeInstalled += day.installed;
    assert.ok(day.backlog_end_of_day >= 0, `negative backlog on ${day.date}`);
    assert.ok(day.installed <= day.capacity, `installed ${day.installed} exceeded capacity ${day.capacity} on ${day.date}`);
    assert.ok(day.installed >= 0 && day.scheduled >= 0);
    // Nothing is installed that was never scheduled.
    assert.ok(cumulativeInstalled <= cumulativeScheduled, `over-installed by ${day.date}`);
    // Backlog is exactly what came in minus what went out.
    assert.equal(day.backlog_end_of_day, cumulativeScheduled - cumulativeInstalled, `backlog drifted on ${day.date}`);
  }
});

test("invariant: experiment readouts are internally consistent", () => {
  for (const r of results) {
    assert.ok(r.control.n >= 0 && r.variant.n >= 0);
    assert.ok(r.control.conversions <= r.control.n, `${r.id}: control conversions exceed n`);
    assert.ok(r.variant.conversions <= r.variant.n, `${r.id}: variant conversions exceed n`);
    assert.ok(typeof r.decision === "string" && r.decision.length > 0);
    assert.ok(typeof r.rationale === "string" && r.rationale.length > 0, `${r.id}: every decision needs a written rationale`);

    if (r.decision === "sin_datos") {
      // No data is a valid state — it must degrade to nulls, never to fake numbers.
      assert.equal(r.p_value, null, `${r.id}: reported a p-value with no data`);
      assert.equal(r.significant, false);
      continue;
    }
    assert.ok(r.p_value >= 0 && r.p_value <= 1, `${r.id}: p out of range`);
    assert.ok(r.ci_low <= r.ci_high, `${r.id}: inverted CI`);
    assert.equal(r.significant, r.p_value < 0.05, `${r.id}: significance disagrees with p`);
  }
});

test("invariant: an experiment with no assigned traffic degrades instead of crashing", () => {
  // Regression guard: analysing a window that predates an experiment's launch
  // used to throw and take down every other readout with it.
  const notStarted = analyzeExperiments({
    sessions: data.sessions,
    conversations: data.conversations,
    experiments: [
      { id: "EXP-NEVER", name: "no ha arrancado", proposal: "PZ", hypothesis: "h", primaryMetric: "step1_completion", guardrailMetric: null, status: "running" },
    ],
  });
  assert.equal(notStarted[0].decision, "sin_datos");
  assert.equal(notStarted[0].control.n, 0);
});

test("invariant: a breached guardrail always blocks the launch", () => {
  for (const r of results) {
    if (r.guardrail?.breached && r.status === "completed") {
      assert.notEqual(r.decision, "lanzar", `${r.id} would ship despite a broken guardrail`);
    }
  }
});

test("invariant: the ICE backlog is sorted and scored in range", () => {
  for (let i = 1; i < derived.backlog.length; i++) {
    assert.ok(derived.backlog[i - 1].ice >= derived.backlog[i].ice, "backlog not sorted by ICE descending");
  }
  for (const item of derived.backlog) {
    assert.ok(item.ice >= 1 && item.ice <= 10, `${item.id}: ICE ${item.ice} out of range`);
    assert.ok(item.doc && item.hypothesis, `${item.id}: every backlog item must cite its source doc and hypothesis`);
  }
});

test("invariant: the operations verdict matches the measured utilisation", () => {
  const ops = derived.operations;
  if (ops.capacity_utilisation >= 1) {
    assert.equal(ops.constraint, "operaciones");
    assert.match(ops.verdict, /supera la capacidad de instalación/);
    // Framed as a system hypothesis needing internal validation, never as an
    // asserted diagnosis of Somos — see descubrimientos brief, correction 25.
    assert.match(ops.verdict, /hipótesis de sistema|requiere validación/);
  } else {
    assert.equal(ops.constraint, "demanda");
  }
});

test("invariant: headline numbers agree with the funnel they summarise", () => {
  assert.equal(derived.headline.sessions, funnel.totals.sessions);
  assert.equal(derived.headline.conversion, funnel.totals.conversion);
  assert.equal(derived.headline.scheduled, funnel.totals.scheduled);
  assert.equal(derived.headline.experiments_run, results.length);
});
