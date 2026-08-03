// La página de metodología también se alimenta del API.
//
// Antes esta página tenía las cifras escritas a mano ("55 invariantes",
// "86.806 sesiones", "α = 0,05", "MDE 8%"). Eso contradecía la regla del
// propio proyecto: si el pipeline cambia, un número quemado en el HTML pasa a
// mentir en silencio. Ahora todos salen de /api/*.

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
    // El intervalo se deriva de alpha: 1 − 0,05 = 95%. No se escribe "95%".
    set("ci", `${((1 - experiments.alpha) * 100).toFixed(0)}%`);
  })
  .catch(() => {
    // Sin datos, los placeholders "—" se quedan visibles: un hueco marcado es
    // mejor que una cifra vieja escrita a mano que parece correcta.
  });
