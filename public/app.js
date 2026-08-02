// Main page rendering. Deliberately a dumb view layer: it formats and paints,
// it never recomputes a metric. Every number here was produced by the pipeline
// and served by the API, so the page and the CSVs can never disagree.
//
// Every section labels what it shows: OBSERVACIÓN (structure of the public
// funnel), HIPÓTESIS (interpretation), SIMULACIÓN (experiment results) and
// REQUIERE VALIDACIÓN INTERNA (would need real internal data). The labels are
// the honesty layer of the exercise.

const pct = (v, digits = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);
const num = (v) => (v === null || v === undefined ? "—" : v.toLocaleString("es-CO"));
const signed = (v, digits = 1) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`);
const pval = (v) => (v === null ? "—" : v < 0.0001 ? "<0.0001" : v.toFixed(4));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "—");

const DECISION_META = {
  lanzar: { label: "Lanzar", cls: "ok" },
  descartar: { label: "Descartar", cls: "info" },
  listo_para_descartar: { label: "Listo para descartar", cls: "info" },
  no_lanzar_guardia: { label: "No lanzar — guardia rota", cls: "danger" },
  no_concluyente: { label: "No concluyente", cls: "ghost" },
  en_curso: { label: "En curso", cls: "warn" },
  listo_para_decidir: { label: "Listo para decidir", cls: "info" },
  sin_datos: { label: "Sin datos", cls: "ghost" },
  sin_probar: { label: "Sin probar", cls: "ghost" },
};
const badge = (key) => {
  const d = DECISION_META[key] ?? { label: key, cls: "ghost" };
  return `<span class="badge ${d.cls}">${d.label}</span>`;
};

const el = (id) => document.getElementById(id);

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── Resumen (tesis) ───────────────────────────────────────────────────────
function renderOverviewStats(overview) {
  const h = overview.headline;
  const o = overview.operations;
  el("overview-stats").innerHTML = `
    <div class="cstat"><div class="v">${num(h.sessions)}</div><div class="k">Sesiones (90 días)</div><div class="s">estructura pública del embudo</div></div>
    <div class="cstat"><div class="v">${pct(h.conversion, 2)}</div><div class="k">Conversión global</div><div class="s">${num(h.scheduled)} agendamientos</div></div>
    <div class="cstat"><div class="v">${num(h.eligibility_waste_late)}</div><div class="k">Datos capturados en vano</div><div class="s">nombre, celular y correo antes de la elegibilidad</div></div>
    <div class="cstat"><div class="v warn2">${num(o.final_backlog)}</div><div class="k">Agendamientos en cola</div><div class="s">${o.backlog_days_recent.toLocaleString("es-CO")} días de espera · uso de capacidad ${pct(o.capacity_utilisation, 0)}</div></div>`;
}

// ── Métricas dentro de las tarjetas de hipótesis ──────────────────────────
const CARD_EXPERIMENTS = {
  elegibilidad: "EXP-02",
  waResponse: "EXP-03",
  wf_experience: "EXP-04",
  tel: "EXP-01",
};

function guardrailText(g) {
  if (!g) return "—";
  const vals =
    g.kind === "duration"
      ? `${g.control_value} → ${g.variant_value} min`
      : `${pct(g.control_value)} → ${pct(g.variant_value)}`;
  return `${g.label}: ${vals} · ${signed(g.relativeDelta)} (tolerancia ${pct(g.toleranceRelative, 0)})`;
}

function fillCardMetrics(results) {
  for (const [key, expId] of Object.entries(CARD_EXPERIMENTS)) {
    const r = results.find((x) => x.id === expId);
    if (!r) continue;
    const set = (field, text) => {
      const node = document.querySelector(`[data-metric="${key}.${field}"]`);
      if (node) node.innerHTML = text;
    };
    set("prim", r.primary_metric_label);
    set(
      "guardrail",
      `${guardrailText(r.guardrail)}${r.guardrail?.breached ? ' <span class="badge danger">GUARDIA ROTA</span>' : ""}`
    );
    set(
      "result",
      `Control ${pct(r.control.rate, 1)} → Variante ${pct(r.variant.rate, 1)} · ${signed(r.relative_lift)}${r.significant ? " · significativo" : " · no significativo"}`
    );
    set("decision", badge(r.decision));
  }
}

// ── Embudos ───────────────────────────────────────────────────────────────
// Cada barra se escala contra el paso anterior: una barra corta significa
// "aquí se van", no "este paso es pequeño en total". La fuga principal se
// marca con color semántico (aviso, no error: es un dato analítico).
// El paso 1 (abrir formulario/chat) se excluye: su caída es el "no estaba
// interesado", no fricción del embudo.
function hotStep(steps) {
  let best = 1;
  for (let i = 2; i < steps.length; i++) {
    if (steps[i].drop_off_rate > steps[best].drop_off_rate) best = i;
  }
  return best;
}

function renderFunnel(containerId, steps) {
  const hotIdx = hotStep(steps);
  el(containerId).innerHTML = steps
    .map((s, i) => {
      const width = i === 0 ? 100 : s.step_conversion * 100;
      const isHot = i === hotIdx && i > 0;
      return `
        <div class="fstep${isHot ? " hot-step" : ""}">
          <div class="fstep-label">
            <b>${s.label}${isHot ? ' <span class="leak-badge">FUGA PRINCIPAL</span>' : ""}</b>
            <small class="mono">${num(s.reached)} ${i === 0 ? "visitas al home" : "llegaron a este paso"}</small>
          </div>
          <div class="fbar-track" role="img" aria-label="De los ${num(s.reached)} que llegaron a ${s.label}, continuaron ${pct(s.step_conversion)}">
            <div class="fbar${isHot ? " hot" : ""}" style="width:${Math.max(width, 3)}%">${i === 0 ? "100%" : pct(s.step_conversion)}</div>
          </div>
          <div class="fstep-stats">
            ${i === 0 ? '<span class="small muted">punto de partida</span>' : `
              <b>${pct(s.step_conversion)}</b> del paso anterior<br>
              <span class="drop">−${num(s.drop_off)} <b>${pct(s.drop_off_rate)}</b></span>
            `}
          </div>
        </div>`;
    })
    .join("");
}

function renderWaFlow(steps) {
  const hotIdx = hotStep(steps);
  const chips = steps
    .map((s, i) => {
      const hl = i === hotIdx && i > 0;
      const label = i === 0 ? s.label : `${s.label} <span class="num">${pct(s.step_conversion, 0)}</span>`;
      return `<span${hl ? ' class="hl"' : ""}>${label}</span>`;
    })
    .join('<span class="a" aria-hidden="true">→</span>');
  el("wa-flow").innerHTML = chips;
  el("funnel-wa-insight").innerHTML = `
    <span class="lbl obs">OBSERVACIÓN PÚBLICA</span>
    <b>La fuga está entre el primer mensaje y la calificación:</b>
    −${num(steps[hotIdx].drop_off)} personas (${pct(steps[hotIdx].drop_off_rate)} de los que escriben).
    El asesor no da abasto — o la primera respuesta llega tarde.
  `;
}

// ── Experimentos ──────────────────────────────────────────────────────────
function renderExperiments(payload, overview) {
  el("exp-meta").textContent =
    `α = ${payload.alpha} · poder = ${pct(payload.power, 0)} · MDE = ${pct(payload.target_mde, 0)} · ` +
    `ventana ${overview.generated.start} → ${overview.generated.end} · seed ${overview.generated.seed}`;

  el("exp-table-body").innerHTML = payload.results
    .map((r) => {
      const g = r.guardrail;
      const guard =
        g === undefined || g === null
          ? "—"
          : `<div style="font-size:12px;line-height:1.55">
               ${g.label}<br>
               <span class="small mono muted-2">${g.kind === "duration" ? `${g.control_value} → ${g.variant_value} min` : `${pct(g.control_value)} → ${pct(g.variant_value)}`} · ${signed(g.relativeDelta)}</span>
             </div>
             ${g.breached ? '<span class="badge danger" style="margin-top:6px">GUARDIA ROTA</span>' : '<span class="badge ok" style="margin-top:6px">Guardia OK</span>'}`;
      return `
        <tr>
          <td>
            <b style="font-size:13.5px">${r.name}</b>
            <div class="small muted mono">${r.id} · propuesta ${r.proposal}</div>
            <div class="small muted-2" style="max-width:340px;margin-top:4px">${r.hypothesis}</div>
          </td>
          <td class="small" style="max-width:210px">${r.primary_metric_label}</td>
          <td class="num"><b>${pct(r.control.rate, 1)}</b> → <b>${pct(r.variant.rate, 1)}</b><br><span class="small muted mono">n = ${num(r.control.n)} / ${num(r.variant.n)}</span></td>
          <td class="num"><b>${signed(r.relative_lift)}</b><br><span class="small muted mono">p ${pval(r.p_value)}${r.significant ? "" : " · no sig."}</span></td>
          <td style="max-width:240px">${guard}</td>
          <td>
            ${badge(r.decision)}
            <div class="small muted-2" style="max-width:240px;margin-top:6px">${r.rationale}</div>
          </td>
        </tr>`;
    })
    .join("");
}

// Qué está disponible en la simulación vs qué necesitaría de la operación real.
function renderWaInstrumentation(results) {
  const wa = results.find((r) => r.id === "EXP-03");
  const g = wa?.guardrail;
  const dur = g?.kind === "duration" ? `${g.control_value} → ${g.variant_value} min` : "—";
  el("wa-avail-1").textContent =
    "Embudo conversacional completo: CTA → chat → primer mensaje → calificación → agendamiento, con las caídas de cada paso";
  el("wa-avail-2").innerHTML =
    `Guardia de tiempo de respuesta: al empujar más volumen al canal, la primera respuesta empeora (${dur})`;
  el("wa-avail-3").textContent =
    "Decisión simulada: no lanzar cambios de jerarquía sin operación de chat que absorba la demanda";
  el("wa-rec-1").textContent =
    "WhatsApp Business API: minutos reales hasta la primera respuesta y hasta la calificación";
  el("wa-rec-2").textContent =
    "Asesores por turno y hora pico, para dimensionar la capacidad de respuesta del canal";
  el("wa-rec-3").textContent =
    "Etiquetas de conversación: calificado / no calificado / re-agendado, para medir resultado real";
}

// ── Siguiente experimento ─────────────────────────────────────────────────
function renderNextExperiment(overview) {
  const n = overview.next_experiment_planning;
  el("next-exp").innerHTML =
    `<b>${n.target_step}</b> — simplificar el selector de país (EXP-01, decisión simulada: lanzar).<br>` +
    `Tamaño: ${num(n.required_per_variant)} por variante (MDE ${pct(n.mde, 0)}, α 5%, poder 80%).`;
  el("next-exp-summary").innerHTML =
    `Con el tráfico web actual (${num(n.daily_web_traffic)} sesiones/día sobre el paso), el experimento se completaría en <b>${n.estimated_days} días</b>. ` +
    `La línea base del paso es ${pct(n.baseline_rate)}. Antes de lanzarlo con datos reales, habría que confirmar el tráfico y el límite operativo de la primera respuesta.`;
}

// ── Segmentación ──────────────────────────────────────────────────────────
function renderSegments(funnel) {
  const bars = (rows, containerId, noteId) => {
    const maxConv = Math.max(...rows.map((r) => r.conversion));
    const best = rows.reduce((b, r) => (r.conversion > b.conversion ? r : b));
    const worst = rows.reduce((b, r) => (r.conversion < b.conversion ? r : b));
    const spread = best.conversion - worst.conversion;
    el(containerId).innerHTML = rows
      .map((r) => {
        const isBest = r.value === best.value;
        return `
          <div class="seg-row">
            <div class="nm">${cap(r.value)}</div>
            <div class="seg-bar-track" role="img" aria-label="${cap(r.value)}: ${pct(r.conversion)} de conversión, ${num(r.sessions)} sesiones">
              <div class="seg-bar${isBest ? " best" : ""}" style="width:${Math.max((r.conversion / maxConv) * 100, 4)}%"></div>
            </div>
            <div class="seg-num"><b>${pct(r.conversion, 1)}</b><br><span class="muted-2">n = ${num(r.sessions)}</span></div>
          </div>`;
      })
      .join("");
    el(noteId).innerHTML =
      `De <b>${pct(worst.conversion, 1)}</b> (${cap(worst.value)}) a <b>${pct(best.conversion, 1)}</b> (${cap(best.value)}): ` +
      `${spread < 0.03 ? "la conversión no discrimina por este contexto en la simulación." : "una diferencia que sí vale la pena explotar por este contexto."} ` +
      `Con n de decenas de miles, los intervalos de confianza son estrechos (ej. ${cap(rows[0].value)}: ${pct(rows[0].ci_low)}–${pct(rows[0].ci_high)}).`;
  };
  bars(funnel.segments.city, "seg-city", "seg-city-note");
  bars(funnel.segments.source, "seg-source", "seg-source-note");
  bars(funnel.segments.estrato, "seg-estrato", "seg-estrato-note");
  bars(funnel.segments.device, "seg-device", "seg-device-note");
}

// ── Guardrail de capacidad (SVG sin dependencias) ─────────────────────────
const SVG = (w, h, aria, body) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${aria}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

function renderCapacity(operations) {
  const o = operations.summary;
  el("cap-stats").innerHTML = `
    <div class="cstat"><div class="v">${num(o.avg_daily_scheduled, 0)}</div><div class="k">Agendamientos por día</div><div class="s">demanda promedio simulada</div></div>
    <div class="cstat"><div class="v">${num(o.avg_daily_capacity, 0)}</div><div class="k">Capacidad de instalación</div><div class="s">por día</div></div>
    <div class="cstat"><div class="v warn2">${pct(o.capacity_utilisation, 0)}</div><div class="k">Uso de capacidad</div><div class="s">por encima del 100% desde el día 3</div></div>
    <div class="cstat"><div class="v">${num(o.final_backlog)}</div><div class="k">En cola al cierre</div><div class="s">≈ ${o.backlog_days_recent.toLocaleString("es-CO")} días de espera</div></div>`;

  const daily = operations.daily;
  const W = 600, H = 240, PAD = 12;
  const maxDemand = Math.max(...daily.map((d) => d.scheduled), ...daily.map((d) => d.capacity));
  const y = (v) => H - PAD - (v / maxDemand) * (H - PAD * 2);
  const x = (i) => PAD + (i / Math.max(daily.length - 1, 1)) * (W - PAD * 2);
  const line = (key) =>
    daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => `<line x1="${PAD}" x2="${W - PAD}" y1="${y(maxDemand * f)}" y2="${y(maxDemand * f)}" stroke="#1f1f26" stroke-width="1"/>`)
    .join("");

  el("cap-chart").innerHTML = SVG(
    W,
    H,
    `Gráfico de línea: la demanda de agendamientos supera a la capacidad de instalación desde el tercer día`,
    grid +
      `<path d="${line("capacity")}" fill="none" stroke="#565664" stroke-width="2"/>` +
      `<path d="${line("scheduled")}" fill="none" stroke="#f0b95c" stroke-width="2.5"/>`
  );

  const maxBacklog = Math.max(...daily.map((d) => d.backlog_end_of_day));
  const bw = (W - PAD * 2) / daily.length;
  el("backlog-chart").innerHTML = SVG(
    W,
    H,
    `Gráfico de barras: la cola de instalaciones pendientes crece de 0 a ${num(maxBacklog)} agendamientos en 90 días`,
    daily
      .map((d, i) => {
        const h = (d.backlog_end_of_day / maxBacklog) * (H - PAD * 2);
        return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(H - PAD - h).toFixed(1)}" width="${Math.max(bw - 1.5, 1).toFixed(1)}" height="${h.toFixed(1)}" fill="#ff6ee7" opacity="0.85"><title>Día ${d.day_index + 1}: ${num(d.backlog_end_of_day)} pendientes</title></rect>`;
      })
      .join("")
  );
}

// ── Backlog (tabla ICE ordenable) ─────────────────────────────────────────
let backlogState = { items: [], key: null, dir: 1 };

function renderBacklogTable() {
  const { items, key, dir } = backlogState;
  const rows = key ? [...items].sort((a, b) => (a[key] - b[key]) * dir) : items;
  el("ice-body").innerHTML = rows
    .map((it) => `
      <tr>
        <td class="mono muted">${it.id}</td>
        <td style="max-width:380px">
          <b>${it.title}</b>
          <div class="small muted" style="margin-top:4px">${it.hypothesis}</div>
        </td>
        <td class="small" style="max-width:170px">${it.primary_metric}</td>
        <td class="small muted-2" style="max-width:170px">${it.guardrail}</td>
        <td class="num">${it.impact}</td>
        <td class="num">${it.confidence}</td>
        <td class="num">${it.ease}</td>
        <td class="num"><b style="color:var(--brand-mint)">${it.ice}</b></td>
        <td>
          ${badge(it.status)}
          ${it.measured_lift !== null ? `<div class="small muted mono" style="margin-top:5px">${signed(it.measured_lift)} medido</div>` : ""}
        </td>
      </tr>`)
    .join("");
  document.querySelectorAll("th.sortable").forEach((th) => {
    const on = th.dataset.sort === key;
    th.querySelector(".arr").textContent = on ? (dir === 1 ? "▲" : "▼") : "";
    th.setAttribute("aria-sort", on ? (dir === 1 ? "ascending" : "descending") : "none");
  });
}

function renderPrioRows(items) {
  el("prio-rows").innerHTML = items
    .map((it) => `
      <details>
        <summary>${it.id} · ${it.title} <span class="badge ghost" style="margin-left:8px">ICE ${it.ice}</span></summary>
        <div class="method-body">
          <div class="m" style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:8px">
            <span class="k" style="color:var(--text-3);font-size:10.5px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Por qué</span>
            <span>${it.hypothesis}</span>
          </div>
          <div class="m" style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:8px">
            <span class="k" style="color:var(--text-3);font-size:10.5px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Qué aprender</span>
            <span>${it.primary_metric} · guardia: ${it.guardrail}</span>
          </div>
          <div class="m" style="display:grid;grid-template-columns:140px 1fr;gap:10px">
            <span class="k" style="color:var(--text-3);font-size:10.5px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Qué decisión habilita</span>
            <span>${badge(it.status)} — I ${it.impact} · C ${it.confidence} · E ${it.ease} · ICE ${it.ice}</span>
          </div>
        </div>
      </details>`)
    .join("");
}

// ── Carga ─────────────────────────────────────────────────────────────────
function showError(err) {
  const box = document.createElement("div");
  box.className = "error-box";
  box.setAttribute("role", "alert");
  box.innerHTML =
    `<b>No pudimos cargar la simulación.</b> Los datos no representan sistemas reales de Somos Internet. ` +
    `<span class="small">(${err.message} — ¿corriste <span class="mono">npm run run-all</span> antes de <span class="mono">npm run web</span>?)</span><br>` +
    `<button class="btn small" style="margin-top:10px" onclick="location.reload()">Reintentar</button>`;
  document.querySelector("main .container").insertAdjacentElement("afterbegin", box);
}

async function main() {
  try {
    const [overview, funnel, experiments, operations, backlog] = await Promise.all([
      get("/api/overview"),
      get("/api/funnel"),
      get("/api/experiments"),
      get("/api/operations"),
      get("/api/backlog"),
    ]);

    renderOverviewStats(overview);
    fillCardMetrics(experiments.results);
    renderFunnel("funnel-web", funnel.web);
    renderWaFlow(funnel.whatsapp);
    renderFunnel("funnel-wa", funnel.whatsapp);
    renderExperiments(experiments, overview);
    renderWaInstrumentation(experiments.results);
    renderNextExperiment(overview);
    renderSegments(funnel);
    renderCapacity(operations);

    backlogState.items = backlog.items;
    renderBacklogTable();
    renderPrioRows(backlog.items);
    document.querySelectorAll("th.sortable").forEach((th) =>
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        backlogState.dir = backlogState.key === key ? -backlogState.dir : 1;
        backlogState.key = key;
        renderBacklogTable();
      })
    );
  } catch (err) {
    showError(err);
  }
}

main();
