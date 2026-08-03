// 04-derive.js — pipeline stage 4: computes the ICE-scored proposal backlog,
// the operations capacity check, and every other derived/summary figure.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { iceScore, daysToSignificance } from "../lib/stats.js";
import { isMain } from "../lib/is-main.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RAW_DIR = join(ROOT, "raw");
const TEST_DIR = join(ROOT, "test");

/**
 * Counts the test cases by reading the suite files. Derived, not written down:
 * a hardcoded "48 tests" on the pitch deck is a number that silently goes stale
 * the moment anyone adds a test.
 */
function countTests() {
  try {
    return readdirSync(TEST_DIR)
      .filter((f) => f.endsWith(".test.js"))
      .reduce((total, f) => total + (readFileSync(join(TEST_DIR, f), "utf-8").match(/^test\(/gm) ?? []).length, 0);
  } catch {
    return null;
  }
}

/**
 * The hypothesis backlog. These proposals started as written-up research —
 * this is where they stop being a document and become a scored, sortable
 * queue the product/dev team can actually work from.
 */
const BACKLOG = [
  {
    id: "P1",
    title: "Jerarquía WhatsApp-primero en el home",
    doc: "análisis propio de priorización — backlog ICE",
    hypothesis: "WhatsApp es el canal de mayor apertura en Colombia; hacerlo el CTA primario debería subir la conversión combinada.",
    primary_metric: "combined_conversion",
    guardrail: "Tiempo de primera respuesta en WhatsApp",
    impact: 8,
    confidence: 7,
    ease: 8,
    experiment_id: "EXP-03",
  },
  {
    id: "P2",
    title: "Simplificar el selector de país (+57 fijo)",
    doc: "hipótesis propia del embudo de checkout",
    hypothesis: "Un selector de ~200 países en un servicio 100% Colombia es fricción pura en el campo más sensible del formulario.",
    primary_metric: "step1_completion",
    guardrail: "Validez de teléfonos capturados",
    impact: 5,
    confidence: 6,
    ease: 9,
    experiment_id: "EXP-01",
  },
  {
    id: "P3",
    title: "Adelantar el filtro de elegibilidad (portería)",
    doc: "hipótesis propia del embudo de checkout",
    hypothesis: "Preguntar por portería antes de pedir datos personales sube la calidad del lead y evita capturar datos de gente no elegible.",
    primary_metric: "qualified_lead_rate",
    guardrail: "Completitud total del Paso 1",
    impact: 7,
    confidence: 6,
    ease: 6,
    experiment_id: "EXP-02",
  },
  {
    id: "P4",
    title: "Copy anti-inercia en el checkout",
    doc: "análisis propio de priorización — backlog ICE",
    hypothesis: "El mercado casi no crece: la mayoría de clientes nuevos vienen de otro operador, así que el obstáculo real es la inercia de cambiarse, no el precio.",
    primary_metric: "scheduled_rate",
    guardrail: "Cancelaciones antes de instalar",
    impact: 7,
    confidence: 5,
    ease: 7,
    experiment_id: "EXP-04",
  },
  {
    id: "P5",
    title: "Calificación automática en WhatsApp — lo que no necesita criterio humano",
    doc: "hipótesis propia de optimización de WhatsApp",
    hypothesis: "Elegibilidad (ciudad + tipo de vivienda) es una regla determinista, no un juicio: resolverla en los primeros 2 mensajes ataca la fuga de la calificación y libera al asesor para cerrar. Precedente de categoría documentado, no validado en Somos.",
    primary_metric: "wa_qualified_rate",
    guardrail: "Percepción de atención / solicitudes de hablar con humano",
    impact: 7,
    confidence: 7,
    ease: 6,
    experiment_id: null,
  },
  {
    id: "P7",
    title: "Framing identitario en referidos y activación de edificio",
    doc: "concepto propio de identidad hiperlocal",
    hypothesis: "'Ayuda a que tu edificio también SEA Somos' apela a pertenencia, no a una recompensa transaccional.",
    primary_metric: "referral_completion_rate",
    guardrail: "Percepción de marca / fragmentación",
    impact: 6,
    confidence: 5,
    ease: 7,
    experiment_id: null,
  },
  {
    id: "P8",
    title: "Trabajo de calle y pasacalles como canal formal de demanda",
    doc: "concepto propio de identidad hiperlocal",
    hypothesis: "Las activaciones de calle ya demostraron tracción (pasacalles); formalizarlas como canal con métricas propias — leads, costo por lead, conversión a instalación — las vuelve escalables y optimizables.",
    primary_metric: "qualified_lead_rate",
    guardrail: "Costo por lead vs. canales digitales",
    impact: 9,
    confidence: 7,
    ease: 8,
    experiment_id: null,
  },
];

/**
 * The operational reality check.
 *
 * Internal notes describe a waiting list of hundreds of customers. If installs
 * are the true bottleneck, then "more conversion" is not automatically good —
 * it can just mean a longer queue and a worse experience. Any honest CRO plan
 * for Somos has to state this out loud before proposing to raise conversion.
 */
function analyzeOperations(operations) {
  const last30 = operations.slice(-30);
  const totalScheduled = operations.reduce((s, d) => s + d.scheduled, 0);
  const totalInstalled = operations.reduce((s, d) => s + d.installed, 0);
  const finalBacklog = operations.at(-1).backlog_end_of_day;
  const avgCapacity = operations.reduce((s, d) => s + d.capacity, 0) / operations.length;
  const avgScheduled = totalScheduled / operations.length;
  const recentBacklogDays = last30.reduce((s, d) => s + d.backlog_days, 0) / last30.length;

  const utilisation = avgScheduled / avgCapacity;

  return {
    total_scheduled: totalScheduled,
    total_installed: totalInstalled,
    final_backlog: finalBacklog,
    avg_daily_scheduled: Number(avgScheduled.toFixed(1)),
    avg_daily_capacity: Number(avgCapacity.toFixed(1)),
    capacity_utilisation: Number(utilisation.toFixed(3)),
    backlog_days_recent: Number(recentBacklogDays.toFixed(1)),
    constraint: utilisation >= 1 ? "operaciones" : "demanda",
    verdict:
      utilisation >= 1
        ? `En el modelo, la demanda agendada (${avgScheduled.toFixed(0)}/día) supera la capacidad de instalación (${avgCapacity.toFixed(0)}/día): una hipótesis de sistema, no un diagnóstico de Somos. Si se confirma con datos internos, subir la conversión sin ampliar capacidad alargaría la lista de espera (${finalBacklog} pendientes) en vez de mejorar el resultado — requiere validación.`
        : `En el modelo, la capacidad de instalación (${avgCapacity.toFixed(0)}/día) todavía absorbe la demanda agendada (${avgScheduled.toFixed(0)}/día): la conversión seguiría siendo la palanca correcta, sujeto a validación con datos internos.`,
    note:
      "Este es el chequeo que decide si una propuesta de CRO tiene sentido AHORA, antes de priorizar cuál probar primero.",
  };
}

export function deriveProductLayer({ funnel, experimentResults, operations, meta }) {
  const resultsById = new Map(experimentResults.map((r) => [r.id, r]));

  const backlog = BACKLOG.map((item) => {
    const result = item.experiment_id ? resultsById.get(item.experiment_id) : null;
    return {
      ...item,
      ice: iceScore({ impact: item.impact, confidence: item.confidence, ease: item.ease }),
      status: result ? result.decision : "sin_probar",
      measured_lift: result?.relative_lift ?? null,
      p_value: result?.p_value ?? null,
    };
  }).sort((a, b) => b.ice - a.ice);

  // Biggest single leak in the web funnel, excluding the landing→form step
  // (that one is traffic quality, not form friction).
  const webInner = funnel.web_funnel.slice(2);
  const biggestLeak = [...webInner].sort((a, b) => b.drop_off - a.drop_off)[0];

  const ops = analyzeOperations(operations);

  // What it would take to run the next experiment on the biggest leak.
  const leakBaseline = biggestLeak.step_conversion || 0.5;
  const dailyWebTraffic = Math.round(funnel.totals.web_sessions / 90);
  const planning = daysToSignificance({
    baselineRate: Math.min(0.95, Math.max(0.05, leakBaseline)),
    mde: 0.08,
    dailyTraffic: Math.max(50, dailyWebTraffic),
  });

  return {
    synthetic: true,
    meta,
    headline: {
      sessions: funnel.totals.sessions,
      conversion: funnel.totals.conversion,
      scheduled: funnel.totals.scheduled,
      biggest_leak_step: biggestLeak.label,
      biggest_leak_lost: biggestLeak.drop_off,
      eligibility_waste_late: funnel.eligibility_waste.filtered_late,
      experiments_run: experimentResults.length,
      experiments_shipped: experimentResults.filter((r) => r.decision === "lanzar").length,
      experiments_killed: experimentResults.filter((r) => r.decision.startsWith("descartar") || r.decision.startsWith("no_lanzar") || r.decision === "listo_para_descartar").length,
      test_count: countTests(),
    },
    operations: ops,
    backlog,
    next_experiment_planning: {
      target_step: biggestLeak.label,
      baseline_rate: Number(leakBaseline.toFixed(4)),
      mde: 0.08,
      required_per_variant: planning.perVariant,
      estimated_days: planning.days,
      daily_web_traffic: dailyWebTraffic,
    },
  };
}

export function runDerive() {
  const funnel = JSON.parse(readFileSync(join(RAW_DIR, "funnel.json"), "utf-8"));
  const { results } = JSON.parse(readFileSync(join(RAW_DIR, "experiment-results.json"), "utf-8"));
  const operations = JSON.parse(readFileSync(join(RAW_DIR, "operations.json"), "utf-8"));
  const meta = JSON.parse(readFileSync(join(RAW_DIR, "meta.json"), "utf-8"));

  const derived = deriveProductLayer({ funnel, experimentResults: results, operations, meta });
  writeFileSync(join(RAW_DIR, "derived.json"), JSON.stringify(derived, null, 2));

  console.log("=== 04 derive (SYNTHETIC) ===");
  console.log(`cuello de botella: ${derived.operations.constraint.toUpperCase()} (uso de capacidad ${(derived.operations.capacity_utilisation * 100).toFixed(0)}%)`);
  console.log(`backlog: ${derived.operations.final_backlog} instalaciones · ${derived.operations.backlog_days_recent} días de espera`);
  console.log(`top backlog ICE: ${derived.backlog[0].id} ${derived.backlog[0].title} (${derived.backlog[0].ice})`);
  console.log(`próximo experimento: ${derived.next_experiment_planning.required_per_variant}/variante ≈ ${derived.next_experiment_planning.estimated_days} días`);
  return derived;
}

if (isMain(import.meta.url)) {
  runDerive();
}
