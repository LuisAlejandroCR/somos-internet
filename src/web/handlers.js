// handlers.js — single source of truth for every API response.
//
// These functions are PURE: they take the already-loaded dataset and return
// plain objects. That matters because the same logic runs in two very different
// runtimes — Node (local dev, reads the filesystem) and Cloudflare Workers
// (production, where there is no filesystem and the JSON is inlined at build
// time). Keeping I/O out of here is what lets both share one implementation
// instead of drifting into two.

import { researchPayload } from "../lib/research.js";

/**
 * @param {{meta, funnel, experiments, operations, derived}} data
 */
export function createApi(data) {
  const { meta, funnel, experiments, operations, derived } = data;

  function getOverview() {
    return {
      synthetic: true,
      warning: meta.warning,
      generated: { seed: meta.seed, start: meta.start_date, end: meta.end_date, days: meta.days },
      headline: derived.headline,
      operations: derived.operations,
      totals: funnel.totals,
      next_experiment_planning: derived.next_experiment_planning,
    };
  }

  function getFunnel(path = "all") {
    const base = {
      synthetic: true,
      warning: meta.warning,
      totals: funnel.totals,
      loss_reasons: funnel.loss_reasons,
      eligibility_waste: funnel.eligibility_waste,
    };
    if (path === "web") return { ...base, path: "web", steps: funnel.web_funnel };
    if (path === "whatsapp") return { ...base, path: "whatsapp", steps: funnel.wa_funnel };
    return {
      ...base,
      path: "all",
      web: funnel.web_funnel,
      whatsapp: funnel.wa_funnel,
      segments: {
        city: funnel.by_city,
        source: funnel.by_source,
        estrato: funnel.by_estrato,
        device: funnel.by_device,
        path: funnel.by_path,
      },
    };
  }

  function getExperiments(id = null) {
    if (!id) {
      return {
        synthetic: true,
        warning: meta.warning,
        alpha: experiments.alpha,
        power: experiments.power,
        target_mde: experiments.target_mde,
        results: experiments.results,
      };
    }
    const found = experiments.results.find((r) => r.id.toLowerCase() === String(id).toLowerCase());
    return found ? { synthetic: true, warning: meta.warning, ...found } : { error: "not_found", id };
  }

  function getOperations() {
    return { synthetic: true, warning: meta.warning, summary: derived.operations, daily: operations };
  }

  function getBacklog() {
    return { synthetic: true, warning: meta.warning, items: derived.backlog, note: "Priorizado por ICE = (Impact + Confidence + Ease) / 3. Puntuación de priorización, no dato de Somos." };
  }

  /**
   * External verified facts (funding rounds, Helium traction, the observed
   * form). NOT synthetic — so this is the one response without
   * `synthetic: true`. Every fact carries its own source and date instead.
   */
  function getResearch() {
    return { synthetic: false, ...researchPayload() };
  }

  /** Maps a pathname + query to a result, or null when the route is unknown. */
  function route(pathname, query = {}) {
    switch (pathname) {
      case "/api/research":
        return getResearch();
      case "/api/overview":
        return getOverview();
      case "/api/funnel":
        return getFunnel(query.path);
      case "/api/experiments":
        return getExperiments(query.id);
      case "/api/operations":
        return getOperations();
      case "/api/backlog":
        return getBacklog();
      default:
        return null;
    }
  }

  return { getOverview, getFunnel, getExperiments, getOperations, getBacklog, getResearch, route };
}
