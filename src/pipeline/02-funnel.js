import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wilsonInterval } from "../lib/stats.js";
import { writeCsv } from "../lib/csv.js";
import { isMain } from "../lib/is-main.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RAW_DIR = join(ROOT, "raw");

// Canonical step order per path. Keeping these explicit (rather than deriving
// them from the data) means a step with zero traffic still shows up as a 0 in
// the funnel instead of silently disappearing.
export const WEB_STEPS = ["landing", "form_start", "identity", "phone", "email", "eligibility", "scheduled"];
export const WA_STEPS = ["landing", "wa_open", "wa_first_message", "wa_qualified", "scheduled"];

const STEP_LABELS = {
  landing: "Visita al home",
  form_start: "Abre el formulario",
  identity: "Nombre y apellidos",
  phone: "Celular (selector de país)",
  email: "Correo",
  eligibility: "Portería / administración",
  scheduled: "Instalación agendada",
  wa_open: "Abre WhatsApp",
  wa_first_message: "Envía primer mensaje",
  wa_qualified: "Calificado por el asesor",
};

function buildFunnel(sessions, steps) {
  const counts = steps.map((step) => ({
    step,
    label: STEP_LABELS[step] ?? step,
    reached: sessions.filter((s) => s.reached.includes(step)).length,
  }));

  const top = counts[0]?.reached || 0;
  return counts.map((c, i) => {
    const prev = i === 0 ? c.reached : counts[i - 1].reached;
    const stepRate = prev === 0 ? 0 : c.reached / prev;
    const ci = c.reached > 0 && prev > 0 ? wilsonInterval({ conversions: c.reached, total: prev }) : { low: 0, high: 0 };
    return {
      ...c,
      step_conversion: Number(stepRate.toFixed(4)),
      cumulative_conversion: top === 0 ? 0 : Number((c.reached / top).toFixed(4)),
      drop_off: prev - c.reached,
      // Where the biggest absolute loss happens is what a CRO team acts on first.
      drop_off_rate: prev === 0 ? 0 : Number(((prev - c.reached) / prev).toFixed(4)),
      ci_low: Number(ci.low.toFixed(4)),
      ci_high: Number(ci.high.toFixed(4)),
    };
  });
}

function segmentBreakdown(sessions, key) {
  const groups = new Map();
  for (const s of sessions) {
    const g = s[key];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  return [...groups.entries()]
    .map(([value, group]) => {
      const scheduled = group.filter((s) => s.outcome === "scheduled").length;
      const ci = wilsonInterval({ conversions: scheduled, total: group.length });
      return {
        segment: key,
        value,
        sessions: group.length,
        scheduled,
        conversion: Number((scheduled / group.length).toFixed(4)),
        ci_low: Number(ci.low.toFixed(4)),
        ci_high: Number(ci.high.toFixed(4)),
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
}

export function computeFunnel(sessions) {
  const web = sessions.filter((s) => s.path === "web");
  const wa = sessions.filter((s) => s.path === "whatsapp");

  const scheduled = sessions.filter((s) => s.outcome === "scheduled").length;

  // Loss reasons, ranked. This is the "¿por qué no terminan?" the JD asks about.
  const outcomes = new Map();
  for (const s of sessions) outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
  const lossReasons = [...outcomes.entries()]
    .filter(([o]) => o !== "scheduled")
    .map(([outcome, count]) => ({ outcome, count, share: Number((count / sessions.length).toFixed(4)) }))
    .sort((a, b) => b.count - a.count);

  // Eligibility waste: users who handed over personal data and only THEN were
  // told their building doesn't qualify. This is the single most defensible
  // finding in the whole demo, because it is visible from the public form.
  const filteredLate = sessions.filter((s) => s.outcome === "filtered_out_late").length;
  const filteredEarly = sessions.filter((s) => s.outcome === "filtered_out_early").length;

  return {
    synthetic: true,
    totals: {
      sessions: sessions.length,
      scheduled,
      conversion: Number((scheduled / sessions.length).toFixed(4)),
      web_sessions: web.length,
      wa_sessions: wa.length,
    },
    web_funnel: buildFunnel(web, WEB_STEPS),
    wa_funnel: buildFunnel(wa, WA_STEPS),
    by_city: segmentBreakdown(sessions, "city"),
    by_source: segmentBreakdown(sessions, "source"),
    by_estrato: segmentBreakdown(sessions, "estrato_group"),
    by_device: segmentBreakdown(sessions, "device"),
    by_path: segmentBreakdown(sessions, "path"),
    loss_reasons: lossReasons,
    eligibility_waste: {
      filtered_late: filteredLate,
      filtered_early: filteredEarly,
      note:
        "filtered_late = usuarios que entregaron nombre, celular y correo ANTES de que se les dijera que su edificio no califica. Es fricción evitable y datos personales capturados sin necesidad.",
    },
  };
}

export function runFunnel() {
  const sessions = JSON.parse(readFileSync(join(RAW_DIR, "sessions.json"), "utf-8"));
  const funnel = computeFunnel(sessions);
  writeFileSync(join(RAW_DIR, "funnel.json"), JSON.stringify(funnel, null, 2));

  writeCsv(
    join(RAW_DIR, "funnel-web.csv"),
    ["step", "label", "reached", "step_conversion", "cumulative_conversion", "drop_off", "drop_off_rate"],
    funnel.web_funnel
  );
  writeCsv(
    join(RAW_DIR, "funnel-whatsapp.csv"),
    ["step", "label", "reached", "step_conversion", "cumulative_conversion", "drop_off", "drop_off_rate"],
    funnel.wa_funnel
  );

  console.log("=== 02 funnel (SYNTHETIC) ===");
  console.log(`conversión global: ${(funnel.totals.conversion * 100).toFixed(2)}%`);
  const worstWeb = [...funnel.web_funnel].slice(1).sort((a, b) => b.drop_off - a.drop_off)[0];
  console.log(`mayor caída (web): ${worstWeb.label} — se pierden ${worstWeb.drop_off} (${(worstWeb.drop_off_rate * 100).toFixed(1)}%)`);
  console.log(`elegibilidad tardía: ${funnel.eligibility_waste.filtered_late} usuarios dieron sus datos y no calificaban`);
  return funnel;
}

if (isMain(import.meta.url)) {
  runFunnel();
}
