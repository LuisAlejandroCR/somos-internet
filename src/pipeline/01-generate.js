// 01-generate.js — pipeline stage 1: generates the synthetic session-level
// dataset (raw/sessions.json) that every later stage builds on.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRng } from "../lib/rng.js";
import { isMain } from "../lib/is-main.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RAW_DIR = join(ROOT, "raw");

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT — THIS DATA IS SYNTHETIC.
//
// Somos Internet does not publish funnel data, and none was ever accessed. The
// generator below is calibrated to the *publicly observable structure* of the
// funnel and to plausible industry ranges — not to real Somos numbers. Every
// artifact this pipeline writes carries a `synthetic: true` marker for that
// reason.
//
// What IS grounded in real, independently verifiable observation:
//   - the funnel shape: home → WhatsApp CTA | web form → eligibility → install
//   - the ~200-country phone selector on a Colombia-only service
//   - eligibility (portería/administración) being asked AFTER personal data
//   - WhatsApp being the primary CTA, not just support
//   - an operations install backlog as a real constraint
// ─────────────────────────────────────────────────────────────────────────────

export const SEED = 20260803; // interview date — arbitrary but fixed for reproducibility
const DAYS = 90;
const START_DATE = new Date(Date.UTC(2026, 3, 1)); // 2026-04-01

const CITIES = {
  // weight = share of traffic; installCapacity = installs/day the ops crew can absorb.
  // Capacity is deliberately set just BELOW average scheduled demand: the internal
  // notes describe a real waiting list of hundreds of customers, and a demo where
  // ops absorbs everything instantly would hide the most important insight —
  // that conversion gains hit a physical install ceiling.
  medellin: { label: "Medellín", weight: 44, installCapacity: 70 },
  bogota: { label: "Bogotá", weight: 38, installCapacity: 55 },
  caldas: { label: "Caldas", weight: 7, installCapacity: 14 },
  rionegro: { label: "Rionegro", weight: 6, installCapacity: 12 },
  llanogrande: { label: "Llanogrande", weight: 5, installCapacity: 9 },
};

// rng.weighted() takes plain { key: number } — CITIES carries extra config per
// city, so the weights are projected out of it here.
const CITY_WEIGHTS = Object.fromEntries(Object.entries(CITIES).map(([k, v]) => [k, v.weight]));

const SOURCES = { organic: 34, referral: 22, hyperlocal: 18, paid: 16, direct: 10 };

// Estrato drives price shown (Essential 63k vs 75k) and price sensitivity.
const ESTRATO_GROUPS = { "1-3": 72, "4-6": 28 };

const DEVICES = { mobile: 78, desktop: 22 };

// Base per-step pass rates for the web self-serve path.
const WEB_BASE = {
  startForm: 0.42, // landing → opens "Cuéntanos sobre ti"
  identityStep: 0.81, // name + surname
  phoneStep: 0.74, // ← the ~200-country selector lives here
  emailStep: 0.9,
  eligibilityStep: 0.86, // portería question, asked late today
  scheduled: 0.79,
};

// WhatsApp path: easier to start, but qualification happens in conversation.
const WA_BASE = {
  openConversation: 0.58,
  userSendsFirst: 0.83,
  agentReplies: 0.94,
  qualified: 0.62,
  scheduled: 0.71,
};

// Fraction of buildings that are actually serviceable (vertical w/ portería).
const ELIGIBLE_RATE = { "1-3": 0.58, "4-6": 0.79 };

const SOURCE_INTENT = { organic: 1.0, referral: 1.22, hyperlocal: 1.12, paid: 0.86, direct: 1.08 };
const ESTRATO_INTENT = { "1-3": 0.94, "4-6": 1.08 };
const DEVICE_FRICTION = { mobile: 0.93, desktop: 1.0 }; // small screens hurt the long form

/**
 * Experiments planted into the data. The analyzer in 03-experiments.js does not
 * know these values — it re-measures them from the generated events, which is
 * the whole point: if the measured lift lands near the planted `trueLift`, the
 * statistics are working.
 *
 * The mix is deliberate and mirrors a healthy program:
 *   EXP-01 a clean win · EXP-02 a win that trips a guardrail
 *   EXP-03 a null result (must be killed) · EXP-04 still underpowered
 */
export const EXPERIMENTS = [
  {
    id: "EXP-01",
    name: "Selector de país simplificado",
    proposal: "P2",
    hypothesis:
      "Reemplazar el selector de ~200 países por un prefijo fijo +57 reduce la fricción del campo de celular y sube la completitud del Paso 1.",
    primaryMetric: "step1_completion",
    guardrailMetric: "phone_validity_rate",
    startDay: 8,
    endDay: 38,
    trueLift: 0.071, // relative
    guardrailTrueLift: -0.004,
    status: "completed",
  },
  {
    id: "EXP-02",
    name: "Filtro de elegibilidad al inicio",
    proposal: "P3",
    hypothesis:
      "Preguntar por portería/administración ANTES de pedir datos personales sube la calidad del lead, aunque reduzca el volumen bruto de formularios completos.",
    primaryMetric: "qualified_lead_rate",
    guardrailMetric: "step1_completion",
    startDay: 12,
    endDay: 46,
    trueLift: 0.185,
    guardrailTrueLift: -0.096, // fewer total completions — the trade-off is real
    status: "completed",
  },
  {
    id: "EXP-03",
    name: "Jerarquía WhatsApp-primero",
    proposal: "P1",
    hypothesis:
      "Hacer del CTA de WhatsApp el botón primario (y del formulario el secundario) sube la conversión combinada del home.",
    primaryMetric: "combined_conversion",
    guardrailMetric: "wa_first_response_minutes",
    startDay: 30,
    endDay: 68,
    // Nothing is planted on conversion directly. The variant only shifts *path
    // mix* (more people take the WhatsApp route), so any measured lift is a
    // composition effect, not a real improvement in persuasion — and it comes
    // at the cost of flooding the WhatsApp queue. The guardrail is what should
    // stop this one from shipping.
    trueLift: 0,
    guardrailTrueLift: 0.21,
    status: "completed",
  },
  {
    id: "EXP-04",
    name: "Copy anti-inercia en checkout",
    proposal: "P4",
    hypothesis:
      "Microcopy que ataca la inercia de cambiarse de operador ('cancelas cuando quieras, sin cláusula') sube la completitud del último paso.",
    primaryMetric: "scheduled_rate",
    guardrailMetric: "eligible_share_of_scheduled",
    startDay: 74,
    endDay: null, // still running at the end of the window
    trueLift: 0.038,
    guardrailTrueLift: 0.01,
    status: "running",
  },
];

function dateForDay(day) {
  const d = new Date(START_DATE.getTime() + day * 86400000);
  return d.toISOString().slice(0, 10);
}

// Weekday seasonality: weekends are quieter for a considered purchase like ISP.
function trafficMultiplier(day) {
  const dow = new Date(START_DATE.getTime() + day * 86400000).getUTCDay();
  if (dow === 0) return 0.71; // Sunday
  if (dow === 6) return 0.79; // Saturday
  if (dow === 1) return 1.09; // Monday
  return 1.0;
}

function experimentsActiveOn(day) {
  return EXPERIMENTS.filter((e) => day >= e.startDay && (e.endDay === null || day <= e.endDay));
}

export function generateDataset({ seed = SEED, days = DAYS } = {}) {
  const rng = makeRng(seed);
  const sessions = [];
  const conversations = [];
  const assignments = [];

  // Traffic grows over the window. Calibrated so that scheduled installs land
  // near the ~6.000 users/month Somos publicly reports adding — that anchor is
  // the one piece of real-world scale this synthetic set is tied to.
  const baseDaily = 850;
  const growthPerDay = 4;

  let sessionSeq = 0;
  let conversationSeq = 0;

  for (let day = 0; day < days; day++) {
    const date = dateForDay(day);
    const active = experimentsActiveOn(day);
    const expectedSessions = (baseDaily + growthPerDay * day) * trafficMultiplier(day);
    const nSessions = Math.max(20, Math.round(rng.normal(expectedSessions, expectedSessions * 0.11)));

    for (let i = 0; i < nSessions; i++) {
      const cityKey = rng.weighted(CITY_WEIGHTS);
      const source = rng.weighted(SOURCES);
      const estrato = rng.weighted(ESTRATO_GROUPS);
      const device = rng.weighted(DEVICES);
      const sessionId = `S${String(++sessionSeq).padStart(6, "0")}`;

      // Variant assignment: 50/50, independent per experiment.
      const variants = {};
      for (const exp of active) {
        variants[exp.id] = rng.bool(0.5) ? "variant" : "control";
        assignments.push({ session_id: sessionId, experiment_id: exp.id, variant: variants[exp.id], date });
      }

      const intent = SOURCE_INTENT[source] * ESTRATO_INTENT[estrato];
      const isEligibleBuilding = rng.bool(ELIGIBLE_RATE[estrato]);

      const lift = (expId, base) => {
        const exp = EXPERIMENTS.find((e) => e.id === expId);
        if (!exp || variants[expId] !== "variant") return base;
        return base;
      };
      void lift; // variant effects are applied explicitly per-step below

      const isVariant = (expId) => variants[expId] === "variant";

      // ── Path choice: WhatsApp vs web self-serve ──
      let waShare = 0.54;
      if (isVariant("EXP-03")) waShare += 0.17; // WhatsApp promoted to primary CTA
      if (device === "mobile") waShare += 0.06;
      const path = rng.bool(Math.min(0.95, waShare)) ? "whatsapp" : "web";

      const session = {
        session_id: sessionId,
        date,
        day_index: day,
        city: cityKey,
        source,
        estrato_group: estrato,
        device,
        path,
        eligible_building: isEligibleBuilding,
        experiments: variants,
        reached: ["landing"],
        outcome: "bounced",
      };

      if (path === "web") {
        const clamp = (p) => Math.min(0.98, Math.max(0.01, p));
        let ok = rng.bool(clamp(WEB_BASE.startForm * intent * DEVICE_FRICTION[device]));
        if (ok) {
          session.reached.push("form_start");

          // EXP-02 moves the eligibility question to the front of the form.
          const eligibilityFirst = isVariant("EXP-02");
          if (eligibilityFirst) {
            // Ineligible users self-select out immediately — that is the point.
            const passes = isEligibleBuilding || rng.bool(0.12);
            if (!passes) {
              session.outcome = "filtered_out_early";
              sessions.push(session);
              continue;
            }
            session.reached.push("eligibility");
          }

          ok = rng.bool(clamp(WEB_BASE.identityStep * intent));
          if (ok) {
            session.reached.push("identity");

            // ── The country-selector step (EXP-01) ──
            let phoneRate = WEB_BASE.phoneStep * DEVICE_FRICTION[device];
            if (isVariant("EXP-01")) phoneRate *= 1 + EXPERIMENTS[0].trueLift * 1.55;
            ok = rng.bool(clamp(phoneRate));
            if (ok) {
              session.reached.push("phone");
              ok = rng.bool(clamp(WEB_BASE.emailStep));
              if (ok) {
                session.reached.push("email");
                if (!eligibilityFirst) {
                  // Late eligibility question: ineligible users bail here, after
                  // already handing over name/phone/email.
                  const passes = isEligibleBuilding || rng.bool(0.1);
                  if (!passes) {
                    session.outcome = "filtered_out_late";
                    sessions.push(session);
                    continue;
                  }
                  session.reached.push("eligibility");
                }
                let schedRate = WEB_BASE.scheduled * intent;
                if (isVariant("EXP-04")) schedRate *= 1 + EXPERIMENTS[3].trueLift;
                if (rng.bool(clamp(schedRate))) {
                  session.reached.push("scheduled");
                  session.outcome = "scheduled";
                } else {
                  session.outcome = "abandoned_scheduling";
                }
              } else session.outcome = "abandoned_email";
            } else session.outcome = "abandoned_phone";
          } else session.outcome = "abandoned_identity";
        }
      } else {
        // ── WhatsApp conversational path ──
        const clamp = (p) => Math.min(0.98, Math.max(0.01, p));
        if (rng.bool(clamp(WA_BASE.openConversation * intent))) {
          session.reached.push("wa_open");
          const convId = `W${String(++conversationSeq).padStart(6, "0")}`;
          session.conversation_id = convId;

          // Response time degrades when EXP-03 floods the channel.
          const queueLoad = isVariant("EXP-03") ? 1 + EXPERIMENTS[2].guardrailTrueLift : 1;
          const firstResponseMinutes = Math.max(1, Math.round(rng.normal(9 * queueLoad, 4 * queueLoad)));

          const conv = {
            conversation_id: convId,
            session_id: sessionId,
            date,
            city: cityKey,
            estrato_group: estrato,
            source,
            first_response_minutes: firstResponseMinutes,
            messages_user: 0,
            messages_agent: 0,
            qualified: false,
            outcome: "no_reply",
            eligible_building: isEligibleBuilding,
          };

          if (rng.bool(clamp(WA_BASE.userSendsFirst))) {
            conv.messages_user += 1;
            session.reached.push("wa_first_message");
            if (rng.bool(clamp(WA_BASE.agentReplies))) {
              conv.messages_agent += 1;
              // Slow first response bleeds conversion — a real, well-documented effect.
              const latencyPenalty = firstResponseMinutes > 15 ? 0.74 : firstResponseMinutes > 8 ? 0.9 : 1.0;
              const qualifyRate = WA_BASE.qualified * intent * latencyPenalty * (isEligibleBuilding ? 1.25 : 0.35);
              conv.messages_user += rng.int(1, 5);
              conv.messages_agent += rng.int(1, 4);
              if (rng.bool(clamp(qualifyRate))) {
                conv.qualified = true;
                session.reached.push("wa_qualified");
                if (rng.bool(clamp(WA_BASE.scheduled * intent))) {
                  session.reached.push("scheduled");
                  session.outcome = "scheduled";
                  conv.outcome = "scheduled";
                } else {
                  session.outcome = "abandoned_scheduling";
                  conv.outcome = "qualified_not_scheduled";
                }
              } else {
                session.outcome = "wa_not_qualified";
                conv.outcome = "not_qualified";
              }
            }
          }
          conversations.push(conv);
        }
      }

      sessions.push(session);
    }
  }

  // ── Operations: installs are capacity-bound, so a backlog forms ──
  // This is the guardrail the whole demo hinges on: conversion can rise while
  // the customer experience gets worse, because installs are the real bottleneck.
  const totalCapacity = Object.values(CITIES).reduce((s, c) => s + c.installCapacity, 0);
  const scheduledByDay = new Map();
  for (const s of sessions) {
    if (s.outcome === "scheduled") scheduledByDay.set(s.day_index, (scheduledByDay.get(s.day_index) ?? 0) + 1);
  }
  const operations = [];
  let backlog = 0;
  for (let day = 0; day < days; day++) {
    const scheduled = scheduledByDay.get(day) ?? 0;
    backlog += scheduled;
    const capacityToday = Math.round(totalCapacity * (trafficMultiplier(day) > 0.8 ? 1 : 0.55));
    const installed = Math.min(backlog, capacityToday);
    backlog -= installed;
    operations.push({
      date: dateForDay(day),
      day_index: day,
      scheduled,
      installed,
      capacity: capacityToday,
      backlog_end_of_day: backlog,
      backlog_days: Number((backlog / Math.max(1, capacityToday)).toFixed(2)),
    });
  }

  return {
    meta: {
      synthetic: true,
      seed,
      days,
      generated_from: "src/pipeline/01-generate.js",
      warning:
        "DATOS SINTÉTICOS. No provienen de Somos Internet ni de ningún sistema real. Calibrados sobre la estructura pública del embudo documentada en el repo.",
      start_date: dateForDay(0),
      end_date: dateForDay(days - 1),
    },
    sessions,
    conversations,
    assignments,
    operations,
    experiments: EXPERIMENTS,
  };
}

export function runGenerate() {
  mkdirSync(RAW_DIR, { recursive: true });
  const data = generateDataset();

  writeFileSync(join(RAW_DIR, "meta.json"), JSON.stringify(data.meta, null, 2));
  writeFileSync(join(RAW_DIR, "sessions.json"), JSON.stringify(data.sessions));
  writeFileSync(join(RAW_DIR, "conversations.json"), JSON.stringify(data.conversations));
  writeFileSync(join(RAW_DIR, "assignments.json"), JSON.stringify(data.assignments));
  writeFileSync(join(RAW_DIR, "operations.json"), JSON.stringify(data.operations, null, 2));
  writeFileSync(join(RAW_DIR, "experiments.json"), JSON.stringify(data.experiments, null, 2));

  const scheduled = data.sessions.filter((s) => s.outcome === "scheduled").length;
  console.log("=== 01 generate (SYNTHETIC) ===");
  console.log(`seed=${data.meta.seed} · ${data.meta.start_date} → ${data.meta.end_date}`);
  console.log(`sessions:      ${data.sessions.length}`);
  console.log(`conversations: ${data.conversations.length}`);
  console.log(`assignments:   ${data.assignments.length}`);
  console.log(`scheduled:     ${scheduled} (${((scheduled / data.sessions.length) * 100).toFixed(2)}%)`);
  console.log(`backlog final: ${data.operations.at(-1).backlog_end_of_day} instalaciones pendientes`);
  return data;
}

if (isMain(import.meta.url)) {
  runGenerate();
}
