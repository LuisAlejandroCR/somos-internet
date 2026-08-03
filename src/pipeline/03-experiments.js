// 03-experiments.js — pipeline stage 3: simulates the four A/B experiments
// and analyzes each with real two-proportion significance tests.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { twoProportionTest, sampleSizePerVariant, daysToSignificance, guardrailBreached } from "../lib/stats.js";
import { writeCsv } from "../lib/csv.js";
import { isMain } from "../lib/is-main.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RAW_DIR = join(ROOT, "raw");

const ALPHA = 0.05;
const POWER = 0.8;
// Agreed before launch, not after seeing results — that is what makes it a
// criterio de descarte and not a rationalisation.
const TARGET_MDE = 0.08; // detect a relative lift of 8% or better

/**
 * How each experiment's primary metric is measured from raw sessions.
 * `denominator` decides who is even eligible to be counted — getting this wrong
 * is the most common way an A/B readout lies.
 */
const METRIC_DEFS = {
  step1_completion: {
    label: "Completitud del Paso 1 (checkout web)",
    denominator: (s) => s.path === "web" && s.reached.includes("form_start"),
    numerator: (s) => s.reached.includes("phone"),
  },
  qualified_lead_rate: {
    label: "Leads calificados / formularios iniciados",
    denominator: (s) => s.path === "web" && s.reached.includes("form_start"),
    numerator: (s) => s.reached.includes("eligibility") && s.eligible_building,
  },
  combined_conversion: {
    label: "Conversión combinada (web + WhatsApp)",
    denominator: () => true,
    numerator: (s) => s.outcome === "scheduled",
  },
  scheduled_rate: {
    label: "Tasa de agendamiento",
    denominator: (s) => s.reached.includes("eligibility") || s.reached.includes("wa_qualified"),
    numerator: (s) => s.outcome === "scheduled",
  },
  phone_validity_rate: {
    label: "Guardia: teléfonos válidos capturados",
    denominator: (s) => s.reached.includes("phone"),
    numerator: (s) => s.reached.includes("email"),
  },
  // Guardia de calidad para cambios de copy en el checkout: que subir el
  // agendamiento no se logre agendando gente que no califica.
  eligible_share_of_scheduled: {
    label: "Guardia: % de agendados que sí son elegibles",
    denominator: (s) => s.outcome === "scheduled",
    numerator: (s) => s.eligible_building,
  },
};

function measure(sessions, metricKey, expId, variant) {
  const def = METRIC_DEFS[metricKey];
  if (!def) throw new Error(`Unknown metric: ${metricKey}`);
  const pool = sessions.filter((s) => s.experiments?.[expId] === variant && def.denominator(s));
  const conversions = pool.filter((s) => def.numerator(s)).length;
  return { total: pool.length, conversions, label: def.label };
}

/** Mean first-response minutes — the WhatsApp guardrail is a duration, not a rate. */
function measureResponseTime(conversations, sessionsById, expId, variant) {
  const pool = conversations.filter((c) => sessionsById.get(c.session_id)?.experiments?.[expId] === variant);
  if (pool.length === 0) return null;
  const mean = pool.reduce((s, c) => s + c.first_response_minutes, 0) / pool.length;
  return { mean: Number(mean.toFixed(2)), n: pool.length };
}

export function analyzeExperiments({ sessions, conversations, experiments }) {
  const sessionsById = new Map(sessions.map((s) => [s.session_id, s]));

  return experiments.map((exp) => {
    const control = measure(sessions, exp.primaryMetric, exp.id, "control");
    const variant = measure(sessions, exp.primaryMetric, exp.id, "variant");

    // An experiment can legitimately have no data yet: it is scheduled but has
    // not started, or the analysis window predates its launch. Returning an
    // explicit "sin_datos" row keeps it visible on the board instead of
    // crashing the whole readout for every other experiment.
    if (control.total === 0 || variant.total === 0) {
      return {
        id: exp.id,
        name: exp.name,
        proposal: exp.proposal,
        hypothesis: exp.hypothesis,
        status: exp.status,
        primary_metric: exp.primaryMetric,
        primary_metric_label: control.label,
        control: { n: control.total, conversions: control.conversions, rate: null },
        variant: { n: variant.total, conversions: variant.conversions, rate: null },
        absolute_lift: null,
        relative_lift: null,
        p_value: null,
        z: null,
        ci_low: null,
        ci_high: null,
        significant: false,
        required_per_variant: null,
        powered: false,
        target_mde: TARGET_MDE,
        alpha: ALPHA,
        power: POWER,
        guardrail: null,
        decision: "sin_datos",
        rationale: "Todavía no hay sesiones asignadas a este experimento en la ventana analizada. No se puede leer nada.",
      };
    }

    const test = twoProportionTest({
      controlConversions: control.conversions,
      controlTotal: control.total,
      variantConversions: variant.conversions,
      variantTotal: variant.total,
    });

    // Clamp the baseline before sizing. A degenerate observed rate (exactly 0
    // or exactly 1, which happens in small or skewed segments) would otherwise
    // throw out of sampleSizePerVariant and take the whole readout down with it.
    const baselineForSizing = Math.min(0.9, Math.max(0.01, test.pControl || 0.1));
    const requiredPerVariant = sampleSizePerVariant({
      baselineRate: baselineForSizing,
      mde: TARGET_MDE,
      power: POWER,
      alpha: ALPHA,
    });
    const powered = control.total >= requiredPerVariant && variant.total >= requiredPerVariant;

    // ── Guardrail ──
    let guardrail = null;
    if (exp.guardrailMetric === "wa_first_response_minutes") {
      const c = measureResponseTime(conversations, sessionsById, exp.id, "control");
      const v = measureResponseTime(conversations, sessionsById, exp.id, "variant");
      if (c && v) {
        const g = guardrailBreached({ controlValue: c.mean, variantValue: v.mean, toleranceRelative: 0.1, higherIsBetter: false });
        guardrail = {
          metric: exp.guardrailMetric,
          label: "Guardia: minutos hasta la primera respuesta en WhatsApp",
          kind: "duration",
          control_value: c.mean,
          variant_value: v.mean,
          ...g,
        };
      }
    } else if (exp.guardrailMetric && METRIC_DEFS[exp.guardrailMetric]) {
      const gc = measure(sessions, exp.guardrailMetric, exp.id, "control");
      const gv = measure(sessions, exp.guardrailMetric, exp.id, "variant");
      if (gc.total > 0 && gv.total > 0) {
        const cRate = gc.conversions / gc.total;
        const vRate = gv.conversions / gv.total;
        const g = guardrailBreached({ controlValue: cRate, variantValue: vRate, toleranceRelative: 0.05, higherIsBetter: true });
        guardrail = {
          metric: exp.guardrailMetric,
          label: gc.label,
          kind: "rate",
          control_value: Number(cRate.toFixed(4)),
          variant_value: Number(vRate.toFixed(4)),
          ...g,
        };
      }
    }

    // ── Decision ──
    // Order matters: a guardrail breach outranks a significant win. Shipping a
    // primary-metric win that broke a guardrail is exactly the failure mode the
    // Duolingo case in the knowledge base warns about.
    let decision;
    let rationale;
    if (exp.status === "running" && !powered) {
      decision = "en_curso";
      rationale = `Aún no alcanza la muestra mínima (${requiredPerVariant.toLocaleString("es-CO")} por variante). No leer todavía — mirar resultados parciales infla el error tipo I.`;
    } else if (exp.status === "running" && powered && !test.significant) {
      decision = "listo_para_descartar";
      rationale = `Ya tiene muestra suficiente y el efecto no alcanza significancia (p=${test.pValue.toFixed(3)}). El experimento se diseñó para detectar un ${(TARGET_MDE * 100).toFixed(0)}% relativo; si existe un efecto, es más pequeño que eso y no justifica el esfuerzo de implementación. Cerrar y documentar.`;
    } else if (exp.status === "running" && powered && test.significant) {
      decision = "listo_para_decidir";
      rationale = `Alcanzó la muestra requerida y el efecto es significativo (p=${test.pValue.toFixed(4)}). Se puede cerrar y decidir.`;
    } else if (guardrail?.breached) {
      decision = "no_lanzar_guardia";
      rationale = `La métrica primaria ${test.significant ? "mejoró de forma significativa" : "no mejoró"}, pero la métrica de guardia se deterioró ${(guardrail.relativeDelta * 100).toFixed(1)}%, por encima de la tolerancia acordada del ${(guardrail.toleranceRelative * 100).toFixed(0)}%. No se lanza.`;
    } else if (test.significant && test.absoluteLift > 0) {
      decision = "lanzar";
      rationale = `Lift relativo de ${(test.relativeLift * 100).toFixed(1)}% (p=${test.pValue.toFixed(4)}), IC 95% del lift absoluto [${(test.ciLow * 100).toFixed(2)}pp, ${(test.ciHigh * 100).toFixed(2)}pp]. Guardia sin deterioro.`;
    } else if (!powered) {
      decision = "no_concluyente";
      rationale = `No significativo y sin potencia suficiente (${Math.min(control.total, variant.total).toLocaleString("es-CO")} vs. ${requiredPerVariant.toLocaleString("es-CO")} requeridos). No se puede concluir nada.`;
    } else {
      decision = "descartar";
      rationale = `Con muestra suficiente, el efecto no es distinguible de cero (p=${test.pValue.toFixed(3)}, IC 95% [${(test.ciLow * 100).toFixed(2)}pp, ${(test.ciHigh * 100).toFixed(2)}pp] cruza el cero). Se descarta la hipótesis y se documenta.`;
    }

    return {
      id: exp.id,
      name: exp.name,
      proposal: exp.proposal,
      hypothesis: exp.hypothesis,
      status: exp.status,
      primary_metric: exp.primaryMetric,
      primary_metric_label: control.label,
      control: { n: control.total, conversions: control.conversions, rate: Number(test.pControl.toFixed(4)) },
      variant: { n: variant.total, conversions: variant.conversions, rate: Number(test.pVariant.toFixed(4)) },
      absolute_lift: Number(test.absoluteLift.toFixed(4)),
      relative_lift: test.relativeLift === null ? null : Number(test.relativeLift.toFixed(4)),
      p_value: Number(test.pValue.toFixed(5)),
      z: Number(test.z.toFixed(3)),
      ci_low: Number(test.ciLow.toFixed(4)),
      ci_high: Number(test.ciHigh.toFixed(4)),
      significant: test.significant,
      required_per_variant: requiredPerVariant,
      powered,
      target_mde: TARGET_MDE,
      alpha: ALPHA,
      power: POWER,
      guardrail,
      decision,
      rationale,
    };
  });
}

export function runExperiments() {
  const sessions = JSON.parse(readFileSync(join(RAW_DIR, "sessions.json"), "utf-8"));
  const conversations = JSON.parse(readFileSync(join(RAW_DIR, "conversations.json"), "utf-8"));
  const experiments = JSON.parse(readFileSync(join(RAW_DIR, "experiments.json"), "utf-8"));

  const results = analyzeExperiments({ sessions, conversations, experiments });
  writeFileSync(join(RAW_DIR, "experiment-results.json"), JSON.stringify({ synthetic: true, alpha: ALPHA, power: POWER, target_mde: TARGET_MDE, results }, null, 2));

  writeCsv(
    join(RAW_DIR, "experiment-results.csv"),
    ["id", "name", "primary_metric", "control_rate", "variant_rate", "relative_lift", "p_value", "significant", "decision"],
    results.map((r) => ({
      id: r.id,
      name: r.name,
      primary_metric: r.primary_metric,
      control_rate: r.control.rate,
      variant_rate: r.variant.rate,
      relative_lift: r.relative_lift,
      p_value: r.p_value,
      significant: r.significant,
      decision: r.decision,
    }))
  );

  console.log("=== 03 experiments (SYNTHETIC) ===");
  for (const r of results) {
    const lift = r.relative_lift === null ? "n/a" : `${(r.relative_lift * 100).toFixed(1)}%`;
    console.log(`${r.id} ${r.name}`);
    console.log(`   lift ${lift} · p=${r.p_value} · n=${r.control.n}/${r.variant.n} · → ${r.decision.toUpperCase()}`);
    if (r.guardrail?.breached) console.log(`   ⚠ guardia rota: ${r.guardrail.label}`);
  }
  return results;
}

if (isMain(import.meta.url)) {
  runExperiments();
}
