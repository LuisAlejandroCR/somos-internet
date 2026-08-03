// metodologia.js — feeds the methodology page from the API, same as every
// other page.
//
// This page used to have hand-typed figures ("55 invariants", "86,806
// sessions", "α = 0.05", "MDE 8%"). That contradicted the project's own rule:
// if the pipeline changes, a number baked into the HTML silently starts
// lying. Now every one of them comes from /api/*.

const set = (k, v) => document.querySelectorAll(`[data-m="${k}"]`).forEach((el) => (el.textContent = v));

Promise.all([
  fetch("/api/overview").then((r) => r.json()),
  fetch("/api/experiments").then((r) => r.json()),
])
  .then(([overview, experiments]) => {
    set("tests", overview.headline.test_count ?? "—");
    set("seed", overview.generated.seed);
    set("sessions", overview.headline.sessions.toLocaleString("es-CO"));
    set("days", overview.generated.days);
    set("mde", `${(experiments.target_mde * 100).toFixed(0)}%`);
    set("alpha", experiments.alpha);
    set("power", `${(experiments.power * 100).toFixed(0)}%`);
    // The interval is derived from alpha: 1 − 0.05 = 95%. Never write "95%" by hand.
    set("ci", `${((1 - experiments.alpha) * 100).toFixed(0)}%`);
  })
  .catch(() => {
    // With no data, the "—" placeholders stay visible: a marked gap is better
    // than a stale hand-typed number that looks correct.
  });
