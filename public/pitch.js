// ── Navegación del deck ──
const slides = [...document.querySelectorAll(".slide")];
let idx = 0;
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
function show(next) {
  idx = Math.max(0, Math.min(slides.length - 1, next));
  slides.forEach((s, i) => s.classList.toggle("on", i === idx));
  document.getElementById("progress").style.width = `${((idx + 1) / slides.length) * 100}%`;
  document.getElementById("slide-num").textContent = `${idx + 1} / ${slides.length}`;
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === slides.length - 1;
  if (idx === 0) prevBtn.blur();
  if (idx === slides.length - 1) nextBtn.blur();
}
prevBtn.addEventListener("click", () => show(idx - 1));
nextBtn.addEventListener("click", () => show(idx + 1));
document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(idx + 1); }
  else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); show(idx - 1); }
  else if (e.key === "Home") show(0);
  else if (e.key === "End") show(slides.length - 1);
  else if (e.key.toLowerCase() === "f") {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  }
});
document.addEventListener("click", (e) => { if (!e.target.closest("a") && !e.target.closest("button")) show(idx + 1); });
show(0);

// ── Todos los números salen de la API ──
// Ni una cifra del deck está escrita a mano: si el pipeline cambia, el pitch
// cambia con él. Un número quemado en el HTML es un número que algún día va a
// contradecir al dashboard.
const pct = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v) => (v == null ? "—" : v.toLocaleString("es-CO"));
const set = (k, v) => document.querySelectorAll(`[data-m="${k}"]`).forEach((el) => (el.textContent = v));

const DECISION_TERM = {
  lanzar: ['hl', "LANZAR"],
  no_lanzar_guardia: ['bad', "GUARDIA ROTA"],
  descartar: ['c', "DESCARTAR"],
  listo_para_descartar: ['c', "DESCARTAR"],
  listo_para_decidir: ['hl', "DECIDIR"],
  en_curso: ['c', "EN CURSO"],
  no_concluyente: ['c', "NO CONCLUYENTE"],
  sin_datos: ['c', "SIN DATOS"],
};

Promise.all([
  fetch("/api/overview").then((r) => r.json()),
  fetch("/api/funnel").then((r) => r.json()),
  fetch("/api/experiments").then((r) => r.json()),
  fetch("/api/backlog").then((r) => r.json()),
])
  .then(([overview, funnel, experiments, backlog]) => {
    const ops = overview.operations;

    // Slide 1 — portada (sin datos)
    set("seed", overview.generated.seed);
    set("testCount", overview.headline.test_count ?? "—");
    set("testCount2", overview.headline.test_count ?? "—");

    // Slide 5 — WhatsApp: chips simulados
    const totalLanding = funnel.totals.sessions;
    const waLanding = funnel.totals.wa_sessions;
    set("waShare", pct(waLanding / totalLanding, 0));
    const waResp = experiments.results
      .map((r) => r.guardrail)
      .find((g) => g && g.kind === "duration");
    set("waResponse", waResp ? `${waResp.control_value} min` : "—");
    const qualStep = funnel.whatsapp.find((s) => s.step === "wa_qualified");
    set("waQualLoss", qualStep ? pct(qualStep.drop_off_rate, 0) : "—");

    // Slide 9 — embudo modelado
    const phoneStep = funnel.web.find((s) => s.step === "phone");
    set("phoneLoss", phoneStep ? `~${(phoneStep.drop_off_rate * 100).toFixed(0)}%` : "—");
    document.getElementById("pf").innerHTML = funnel.web
      .map((s, i) => {
        const w = i === 0 ? 100 : s.step_conversion * 100;
        const bad = i > 0 && s.drop_off_rate > 0.28;
        return `<div class="pf-row">
          <div>${s.label}</div>
          <div class="pf-track"><div class="pf-bar ${bad ? "bad" : ""}" style="width:${Math.max(w, 4)}%">${i === 0 ? "100%" : (s.step_conversion * 100).toFixed(1) + "%"}</div></div>
          <div class="pf-lost">${i === 0 ? "" : "−" + num(s.drop_off)}</div>
        </div>`;
      })
      .join("");

    // Slide 4 — elegibilidad: chip simulado
    set("wasteLate", num(funnel.eligibility_waste.filtered_late));

    // Slide 9 — terminal: se arma desde los resultados reales
    set("expCount", experiments.results.length);
    set("mde", pct(experiments.target_mde, 0));
    set("power", experiments.power);
    const pad = (s, n) => String(s).padEnd(n, " ");
    document.getElementById("term-lines").innerHTML = experiments.results
      .map((r) => {
        const [cls, label] = DECISION_TERM[r.decision] ?? ["c", r.decision.toUpperCase()];
        const lift = r.relative_lift == null ? "—" : `${r.relative_lift > 0 ? "+" : ""}${(r.relative_lift * 100).toFixed(1)}%`;
        const p = r.p_value == null ? "—" : r.p_value < 0.0001 ? "p<0.0001" : `p=${r.p_value.toFixed(4)}`;
        return `<span class="p">${r.id}</span> ${pad(r.name.slice(0, 26), 28)}${pad(lift, 8)}${pad(p, 11)}→ <span class="${cls}">${label}</span>`;
      })
      .join("<br>") + "<br>";

    const shipped = experiments.results.filter((r) => r.decision === "lanzar").length;
    const blocked = experiments.results.filter((r) => r.decision === "no_lanzar_guardia").length;
    const killed = experiments.results.filter((r) => r.decision.includes("descartar")).length;
    set(
      "expSummary",
      `${shipped} se lanza. ${blocked} ganaron en la métrica primaria y aun así se bloquean. ${killed} se descarta y se documenta.`
    );

    // Slide 10 — motor de decisiones: tarjetas de los bloqueados
    document.getElementById("blocked-cards").innerHTML = experiments.results
      .filter((r) => r.guardrail?.breached)
      .map((r) => {
        const g = r.guardrail;
        const from = g.kind === "duration" ? `${g.control_value} a ${g.variant_value} min` : `${pct(g.control_value)} a ${pct(g.variant_value)}`;
        return `<div class="pcard pink">
          <div class="t" style="color:var(--pink)">${r.id} · ${r.name}</div>
          <div class="n" style="font-size:32px;margin-top:12px">${r.relative_lift > 0 ? "+" : ""}${(r.relative_lift * 100).toFixed(1)}%</div>
          <div class="s">en la métrica primaria… pero <b style="color:var(--pink)">${g.label.replace(/^Guardia: /, "")}</b> se mueve de ${from}
          (${(g.relativeDelta * 100).toFixed(1)}%), por encima de la tolerancia de ${pct(g.toleranceRelative, 0)}.</div>
        </div>`;
      })
      .join("");

    // Slide 12 — apéndice: ranking ICE — capacidad: simulación como guardrail
    set("utilisation", pct(ops.capacity_utilisation, 0));
    set("opsVerdict", ops.verdict);

    // Slide 12 — apéndice: ranking ICE
    set("backlogCount", backlog.items.length);
    document.getElementById("backlog-rank").innerHTML = backlog.items
      .slice(0, 4)
      .map(
        (b, i) =>
          `<li><span class="rank-n">${i + 1}</span><b>${b.id}</b> ${b.title} <span class="mono rank-ice">ICE ${b.ice.toFixed(1)}</span></li>`
      )
      .join("");
  })
  .catch((err) => {
    document.getElementById("pf").innerHTML = `<div class="lead">No se pudo cargar la data (${err.message}). Corré <span class="mono">npm run run-all</span>.</div>`;
  });