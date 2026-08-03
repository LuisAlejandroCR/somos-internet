// Cifras externas verificadas — el otro origen de verdad del sitio.
//
// El pipeline produce los números SINTÉTICOS. Pero las páginas también muestran
// hechos del mundo real (rondas de Somos, tracción de Helium, el formulario
// observado). Esos no puede producirlos el pipeline, y escribirlos a mano en el
// HTML tenía el mismo problema de siempre: si la investigación se corrige, la
// página sigue mostrando el dato viejo sin avisar.
//
// Acá viven una sola vez, con su fuente y su fecha, y se sirven por /api/research
// igual que el resto. Regla: ningún número de este archivo puede existir sin
// `source` y `as_of` — hay un test que lo verifica.
//
// Los valores se guardan como NÚMEROS, no como texto ya formateado: así lo
// derivado (el total de funding, el % de terceros) se calcula, no se transcribe.

/** Somos Internet — hechos públicos. Detalle en descubrimientos/01. */
const SOMOS = {
  serie_a_musd: { value: 18, source: "Forbes Colombia", as_of: "2024" },
  serie_b_musd: { value: 40, source: "Forbes Colombia", as_of: "2026-04" },
  users_public: { value: 90000, source: "somosinternet.com", as_of: "2026-07-27" },
  // Observado directamente en el formulario público, no reportado por nadie.
  form_country_options: { value: 200, approx: true, source: "my.somosinternet.com (observación directa)", as_of: "2026-07-27" },
};

/** Red Helium / DePIN. Detalle y blockers en descubrimientos/14. */
const HELIUM = {
  accounts: { value: 595800, qoq: 0.29, source: "Helium Foundation — reporte Q4-2025", as_of: "2025-Q4" },
  hotspots: { value: 121138, third_party_share: 0.705, source: "Helium Foundation — reporte Q4-2025", as_of: "2025-Q4" },
  offload_tb: { value: 4388, qoq: 0.61, source: "Helium Foundation — reporte Q4-2025", as_of: "2025-Q4" },
  token_volatility_x: { value: 4.5, window_months: 3, source: "CoinGecko (HNT, US$0,79 → US$3,54)", as_of: "2026-01" },
  omv_obi_months: { value: 4, source: "CRC — Res. 5108/2017, régimen OMV", as_of: "2017" },
};

/** Ejemplo ilustrativo de la idea 01 — no una cifra de Somos. */
const HYPERLOCAL = {
  neighbors_example: { value: 127, source: "ejemplo ilustrativo (descubrimientos/10 §1)", as_of: "2026-08-02" },
};

/** Alcance del MVP propuesto — estimación propia, no un dato de terceros. */
const MVP = {
  buildings_min: { value: 5, source: "propuesta propia (descubrimientos/14 §4-5)", as_of: "2026-08-02" },
  buildings_max: { value: 10, source: "propuesta propia (descubrimientos/14 §4-5)", as_of: "2026-08-02" },
  weeks_min: { value: 8, source: "propuesta propia (descubrimientos/14 §4-5)", as_of: "2026-08-02" },
  weeks_max: { value: 12, source: "propuesta propia (descubrimientos/14 §4-5)", as_of: "2026-08-02" },
  blockers_mapped: { value: 7, source: "análisis propio (descubrimientos/14)", as_of: "2026-08-02" },
  blockers_shown: { value: 5, source: "análisis propio (descubrimientos/14)", as_of: "2026-08-02" },
};

export const RESEARCH_FACTS = { somos: SOMOS, helium: HELIUM, hyperlocal: HYPERLOCAL, mvp: MVP };

/** Todo hecho, aplanado — para que el test pueda auditarlos de una pasada. */
export function allFacts() {
  return Object.entries(RESEARCH_FACTS).flatMap(([group, facts]) =>
    Object.entries(facts).map(([key, fact]) => ({ id: `${group}.${key}`, ...fact }))
  );
}

/**
 * Lo que consume el frontend: valores crudos + los DERIVADOS calculados aquí
 * (no escritos a mano en la página). Formatear es cosa de la vista; calcular,
 * de este módulo.
 */
export function researchPayload() {
  const s = RESEARCH_FACTS.somos;
  const h = RESEARCH_FACTS.helium;
  const m = RESEARCH_FACTS.mvp;
  return {
    facts: RESEARCH_FACTS,
    derived: {
      // 18 + 40 — antes escrito "US$58M" a mano en la portada del pitch.
      funding_total_musd: s.serie_a_musd.value + s.serie_b_musd.value,
      // 7 mapeados − 5 mostrados — antes escrito "+2 blockers más".
      blockers_remaining: m.blockers_mapped.value - m.blockers_shown.value,
      helium_third_party_pct: h.hotspots.third_party_share,
    },
    note: "Cifras de fuentes externas verificadas o de estimación propia declarada. Cada una lleva `source` y `as_of`. No provienen del pipeline sintético.",
  };
}
