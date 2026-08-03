// research.js — verified external facts; the site's second source of truth.
//
// The pipeline produces the SYNTHETIC numbers. But the pages also show
// real-world facts (Somos funding rounds, Helium traction, the observed
// signup form). The pipeline can't produce those, and hand-typing them into
// HTML has the usual problem: if the research gets corrected, the page keeps
// showing the stale number with no warning.
//
// They live here exactly once, each with its source and date, and are served
// via /api/research like everything else. Rule: no number in this file may
// exist without `source` and `as_of` — a test enforces it.
//
// Values are stored as NUMBERS, not pre-formatted text, so anything derived
// (funding total, third-party %) gets computed, never transcribed by hand.

/** Somos Internet — publicly reported facts. */
const SOMOS = {
  serie_a_musd: { value: 18, source: "Forbes Colombia", as_of: "2024" },
  serie_b_musd: { value: 40, source: "Forbes Colombia", as_of: "2026-04" },
  users_public: { value: 90000, source: "somosinternet.com", as_of: "2026-07-27" },
  // Observed directly on the public signup form, not reported anywhere.
  form_country_options: { value: 200, approx: true, source: "my.somosinternet.com (observación directa)", as_of: "2026-07-27" },
};

/** Helium network / DePIN traction. */
const HELIUM = {
  accounts: { value: 595800, qoq: 0.29, source: "Helium Foundation — reporte Q4-2025", as_of: "2025-Q4" },
  hotspots: { value: 121138, third_party_share: 0.705, source: "Helium Foundation — reporte Q4-2025", as_of: "2025-Q4" },
  offload_tb: { value: 4388, qoq: 0.61, source: "Helium Foundation — reporte Q4-2025", as_of: "2025-Q4" },
  token_volatility_x: { value: 4.5, window_months: 3, source: "CoinGecko (HNT, US$0,79 → US$3,54)", as_of: "2026-01" },
  omv_obi_months: { value: 4, source: "CRC — Res. 5108/2017, régimen OMV", as_of: "2017" },
};

/** Illustrative example for idea 01 — not a real Somos figure. */
const HYPERLOCAL = {
  neighbors_example: { value: 127, source: "ejemplo ilustrativo, no una cifra real de Somos", as_of: "2026-08-02" },
};

/** Proposed MVP scope — own estimate, not third-party data. */
const MVP = {
  buildings_min: { value: 5, source: "propuesta propia — piloto Passpoint, alcance estimado", as_of: "2026-08-02" },
  buildings_max: { value: 10, source: "propuesta propia — piloto Passpoint, alcance estimado", as_of: "2026-08-02" },
  weeks_min: { value: 8, source: "propuesta propia — piloto Passpoint, duración estimada", as_of: "2026-08-02" },
  weeks_max: { value: 12, source: "propuesta propia — piloto Passpoint, duración estimada", as_of: "2026-08-02" },
  blockers_mapped: { value: 7, source: "análisis propio del despliegue de Helium en Colombia", as_of: "2026-08-02" },
  blockers_shown: { value: 5, source: "análisis propio del despliegue de Helium en Colombia", as_of: "2026-08-02" },
};

export const RESEARCH_FACTS = { somos: SOMOS, helium: HELIUM, hyperlocal: HYPERLOCAL, mvp: MVP };

/** Every fact, flattened — so the test suite can audit all of them in one pass. */
export function allFacts() {
  return Object.entries(RESEARCH_FACTS).flatMap(([group, facts]) =>
    Object.entries(facts).map(([key, fact]) => ({ id: `${group}.${key}`, ...fact }))
  );
}

/**
 * What the frontend consumes: raw values plus the DERIVED figures computed
 * here (never hand-typed on the page). Formatting is the view's job;
 * computing is this module's.
 */
export function researchPayload() {
  const s = RESEARCH_FACTS.somos;
  const h = RESEARCH_FACTS.helium;
  const m = RESEARCH_FACTS.mvp;
  return {
    facts: RESEARCH_FACTS,
    derived: {
      // 18 + 40 — used to be hand-typed as "US$58M" on the pitch cover.
      funding_total_musd: s.serie_a_musd.value + s.serie_b_musd.value,
      // 7 mapped minus 5 shown — used to be hand-typed as "+2 more blockers".
      blockers_remaining: m.blockers_mapped.value - m.blockers_shown.value,
      helium_third_party_pct: h.hotspots.third_party_share,
    },
    note: "Cifras de fuentes externas verificadas o de estimación propia declarada. Cada una lleva `source` y `as_of`. No provienen del pipeline sintético.",
  };
}
