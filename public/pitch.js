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
document.addEventListener("click", (e) => { if (!e.target.closest("a") && !e.target.closest("button") && !e.target.closest("details")) show(idx + 1); });
show(0);

// ── Todos los números salen de la API ──
// Ni una cifra del deck está escrita a mano: si el pipeline cambia, el pitch
// cambia con él. Un número quemado en el HTML es un número que algún día va a
// contradecir al dashboard.
const pct = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v) => (v == null ? "—" : v.toLocaleString("es-CO"));
const set = (k, v) => document.querySelectorAll(`[data-m="${k}"]`).forEach((el) => (el.textContent = v));
// Rellena por id solo si el elemento existe (el deck cambia de estructura;
// un hook huérfano no puede tumbar la carga del resto).
const fill = (id, html) => {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
};

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

// ── Mini embudos (slide 2) ──
// Cuatro barras por canal, cada una contra el paso anterior. La fuga mayor se
// pinta con el color semántico de aviso (análisis, no error).
function miniFunnel(steps, keys) {
  const picked = keys.map((k) => steps.find((s) => s.step === k)).filter(Boolean);
  if (!picked.length) return "";
  let hot = 1;
  for (let i = 1; i < picked.length; i++) {
    if (picked[i].drop_off_rate > picked[hot].drop_off_rate) hot = i;
  }
  return picked
    .map((s, i) => {
      const w = i === 0 ? 100 : s.step_conversion * 100;
      const isHot = i === hot && i > 0;
      const title = i === 0 ? "punto de partida" : `${num(s.reached)} llegaron · −${num(s.drop_off)} (${pct(s.drop_off_rate, 0)})`;
      return `<div class="mf-row" title="${title}">
        <div class="l">${s.label}</div>
        <div class="mf-track"><div class="mf-bar${isHot ? " hot" : ""}" style="width:${Math.max(w, 3)}%"></div></div>
        <div class="mf-val">${i === 0 ? "100%" : pct(s.step_conversion, 1)}</div>
      </div>`;
    })
    .join("");
}

// ── Sparkline del guardrail (slide 10) ──
// Los paths se pintan con setAttribute("d", …): un innerHTML crearía texto de
// contenido dentro del path, no su atributo de dibujo.
function renderSpark(daily) {
  const W = 560, H = 150, PAD = 8, TOP = 10, BOT = 130;
  const maxV = Math.max(...daily.map((d) => d.scheduled), ...daily.map((d) => d.capacity));
  const x = (i) => PAD + (i / Math.max(daily.length - 1, 1)) * (W - PAD * 2);
  const y = (v) => BOT - (v / maxV) * (BOT - TOP);
  const line = (key) => daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const cap = document.getElementById("cap-spark");
  const dem = document.getElementById("dem-spark");
  if (cap) cap.setAttribute("d", line("capacity"));
  if (dem) dem.setAttribute("d", line("scheduled"));
}

Promise.all([
  fetch("/api/overview").then((r) => r.json()),
  fetch("/api/funnel").then((r) => r.json()),
  fetch("/api/experiments").then((r) => r.json()),
  fetch("/api/backlog").then((r) => r.json()),
  fetch("/api/operations").then((r) => r.json()),
])
  .then(([overview, funnel, experiments, backlog, operations]) => {
    const ops = overview.operations;

    // Slide 11 — método: conteo de tests
    set("testCount", overview.headline.test_count ?? "—");

    // Slide 2 — embudos mini + chips del canal WhatsApp
    fill("mini-web", miniFunnel(funnel.web, ["landing", "form_start", "phone", "scheduled"]));
    fill("mini-wa", miniFunnel(funnel.whatsapp, ["landing", "wa_first_message", "wa_qualified", "scheduled"]));
    const totalLanding = funnel.totals.sessions;
    const waLanding = funnel.totals.wa_sessions;
    set("waShare", pct(waLanding / totalLanding, 0));
    const waResp = experiments.results
      .map((r) => r.guardrail)
      .find((g) => g && g.kind === "duration");
    set("waResponse", waResp ? `${waResp.control_value} min` : "—");
    const qualStep = funnel.whatsapp.find((s) => s.step === "wa_qualified");
    set("waQualLoss", qualStep ? pct(qualStep.drop_off_rate, 0) : "—");

    // Slide 5 — idea 01: validación externa (trabajo de calle, #1 del backlog)
    const topItem = backlog.items[0];
    set("p8", topItem ? `ICE ${topItem.ice.toFixed(1)} · #1 del backlog` : "—");

    // Slide 10 — guardrail: capacidad + sparkline
    set("utilisation", pct(ops.capacity_utilisation, 0));
    set("opsVerdict", ops.verdict);
    renderSpark(operations.daily ?? []);

    // Slide 11 — resultado de los experimentos como gráfico.
    // Antes acá se repetía el embudo web, que ya se muestra en la slide 2. Un
    // gráfico de lift cuenta lo que el embudo no: que el experimento con el
    // lift más grande es justamente el que se bloquea por guardia rota.
    const maxLift = Math.max(...experiments.results.map((r) => Math.abs(r.relative_lift ?? 0)), 0.01);
    fill("lifts", experiments.results
      .map((r) => {
        const lift = r.relative_lift ?? 0;
        const breached = r.guardrail?.breached;
        const shipped = r.decision === "lanzar";
        const cls = breached ? "blocked" : shipped ? "" : "null";
        const tag = breached
          ? ['blocked', "GUARDIA ROTA"]
          : shipped
            ? ['ship', "LANZAR"]
            : ['null', r.significant ? "REVISAR" : "SIN EFECTO"];
        return `<div class="lift">
          <div class="lf-n"><b>${r.id}</b>${r.name.replace(/^(Filtro|Selector|Jerarquía|Copy) /, "")}</div>
          <div class="lf-track">
            <div class="lf-fill ${cls}" style="left:2px;width:${Math.max((Math.abs(lift) / maxLift) * 96, 3)}%"></div>
            <span class="lf-v">${lift > 0 ? "+" : ""}${(lift * 100).toFixed(1)}%</span>
          </div>
          <span class="lf-tag ${tag[0]}">${tag[1]}</span>
        </div>`;
      })
      .join(""));

    // Slide 11 — terminal: se arma desde los resultados reales
    set("expCount", experiments.results.length);
    set("mde", pct(experiments.target_mde, 0));
    set("power", experiments.power);
    const pad = (s, n) => String(s).padEnd(n, " ");
    fill("term-lines", experiments.results
      .map((r) => {
        const [cls, label] = DECISION_TERM[r.decision] ?? ["c", r.decision.toUpperCase()];
        const lift = r.relative_lift == null ? "—" : `${r.relative_lift > 0 ? "+" : ""}${(r.relative_lift * 100).toFixed(1)}%`;
        const p = r.p_value == null ? "—" : r.p_value < 0.0001 ? "p<0.0001" : `p=${r.p_value.toFixed(4)}`;
        return `<span class="p">${r.id}</span> ${pad(r.name.slice(0, 26), 28)}${pad(lift, 8)}${pad(p, 11)}→ <span class="${cls}">${label}</span>`;
      })
      .join("<br>") + "<br>");


    // Slide 11 — próximo experimento (del planning del pipeline, en /api/overview)
    const next = overview.next_experiment_planning;
    if (next) {
      set("neBaseline", pct(next.baseline_rate, 1));
      set("neMde", pct(next.mde, 0));
      set("neN", num(next.required_per_variant));
      set("neDays", next.estimated_days);
    }

    // Slide 11 — top 3 del backlog por ICE
    fill("top3", backlog.items
      .slice(0, 3)
      .map((b) => `<b>${b.id}</b> ${b.title} <span class="mono">${b.ice.toFixed(1)}</span>`)
      .join(' <span style="color:var(--muted-2)">·</span> '));
  })
  .catch((err) => {
    fill("pf", `<div class="lead">No se pudo cargar la data (${err.message}). Corré <span class="mono">npm run run-all</span>.</div>`);
  });
