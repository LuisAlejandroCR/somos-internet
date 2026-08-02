// Dashboard rendering. Deliberately a dumb view layer: it formats and paints,
// it never recomputes a metric. Every number here was produced by the pipeline
// and served by the API, so the page and the CSVs can never disagree.

const pct = (v, digits = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);
const num = (v) => (v === null || v === undefined ? "—" : v.toLocaleString("es-CO"));
const signed = (v, digits = 1) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`);

const DECISION_META = {
  lanzar: { label: "Lanzar", cls: "mint" },
  descartar: { label: "Descartar", cls: "pink" },
  listo_para_descartar: { label: "Listo para descartar", cls: "pink" },
  no_lanzar_guardia: { label: "No lanzar — guardia rota", cls: "danger" },
  no_concluyente: { label: "No concluyente", cls: "ghost" },
  en_curso: { label: "En curso", cls: "cream" },
  listo_para_decidir: { label: "Listo para decidir", cls: "cream" },
  sin_datos: { label: "Sin datos", cls: "ghost" },
  sin_probar: { label: "Sin probar", cls: "ghost" },
};

const el = (id) => document.getElementById(id);

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function renderKpis(overview) {
  const h = overview.headline;
  const o = overview.operations;
  el("kpis").innerHTML = `
    <div class="kpi mint">
      <div class="kpi-num">${pct(h.conversion, 2)}</div>
      <div class="kpi-lab">Conversión global</div>
      <div class="kpi-note">${num(h.scheduled)} agendadas de ${num(h.sessions)} sesiones</div>
    </div>
    <div class="kpi pink">
      <div class="kpi-num">${num(h.eligibility_waste_late)}</div>
      <div class="kpi-lab">Datos capturados en vano</div>
      <div class="kpi-note">Dieron nombre, celular y correo antes de saber que su edificio no califica</div>
    </div>
    <div class="kpi cream">
      <div class="kpi-num">${num(o.final_backlog)}</div>
      <div class="kpi-lab">Instalaciones en espera</div>
      <div class="kpi-note">${o.backlog_days_recent} días de cola · capacidad al ${pct(o.capacity_utilisation, 0)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-num">${h.experiments_run}</div>
      <div class="kpi-lab">Experimentos leídos</div>
      <div class="kpi-note">${h.experiments_shipped} lanzados · ${h.experiments_killed} bloqueados o descartados</div>
    </div>`;
}

function renderOpsAlert(overview) {
  const o = overview.operations;
  const isOps = o.constraint === "operaciones";
  el("ops-alert").innerHTML = `
    <div class="card alert ${isOps ? "danger" : ""}" style="margin-top:22px">
      <div class="card-title">${isOps ? "El cuello de botella no es la conversión" : "La conversión sigue siendo la palanca"}</div>
      <div class="small muted" style="margin-top:8px;line-height:1.65">${o.verdict}</div>
      <div class="row small" style="margin-top:16px;gap:10px">
        <div><span class="muted">Agendadas/día</span><br><b class="mono">${o.avg_daily_scheduled}</b></div>
        <div><span class="muted">Capacidad/día</span><br><b class="mono">${o.avg_daily_capacity}</b></div>
        <div><span class="muted">Uso de capacidad</span><br><b class="mono" style="color:${isOps ? "var(--danger)" : "var(--mint)"}">${pct(o.capacity_utilisation, 0)}</b></div>
        <div><span class="muted">Espera actual</span><br><b class="mono">${o.backlog_days_recent} días</b></div>
      </div>
    </div>`;
}

function renderFunnel(containerId, steps) {
  // The bar is scaled to the previous step, so a short bar always means
  // "this step is where they left", not "this step is small overall".
  el(containerId).innerHTML = steps
    .map((s, i) => {
      const width = i === 0 ? 100 : s.step_conversion * 100;
      const cls = i === 0 ? "" : s.drop_off_rate > 0.4 ? "bad" : s.drop_off_rate > 0.2 ? "warn" : "";
      return `
        <div class="fstep">
          <div class="fstep-label"><b>${s.label}</b><span class="mono small">${num(s.reached)} usuarios</span></div>
          <div class="fbar-track">
            <div class="fbar ${cls}" style="width:${Math.max(width, 3)}%">${i === 0 ? "100%" : pct(s.step_conversion)}</div>
          </div>
          <div class="fstep-drop">${i === 0 ? '<span class="muted small">punto de partida</span>' : `<b>−${num(s.drop_off)}</b><br><span class="small muted">${pct(s.drop_off_rate)} se va</span>`}</div>
        </div>`;
    })
    .join("");
}

function renderExperiments(payload) {
  el("experiments").innerHTML = payload.results
    .map((r) => {
      const d = DECISION_META[r.decision] ?? { label: r.decision, cls: "ghost" };
      const guard = r.guardrail
        ? `<div class="guard">
             <span class="badge ${r.guardrail.breached ? "danger" : "ghost"}">${r.guardrail.breached ? "GUARDIA ROTA" : "Guardia OK"}</span>
             <span class="muted small">${r.guardrail.label}:
               <span class="mono">${r.guardrail.kind === "duration" ? `${r.guardrail.control_value} → ${r.guardrail.variant_value} min` : `${pct(r.guardrail.control_value)} → ${pct(r.guardrail.variant_value)}`}</span>
               (${signed(r.guardrail.relativeDelta)}, tolerancia ${pct(r.guardrail.toleranceRelative, 0)})</span>
           </div>`
        : "";

      return `
        <div class="exp">
          <div class="exp-head">
            <div style="flex:1 1 380px">
              <div class="exp-id">${r.id} · propuesta ${r.proposal} · ${r.primary_metric_label}</div>
              <div class="exp-name">${r.name}</div>
            </div>
            <span class="badge ${d.cls}">${d.label}</span>
          </div>
          <div class="exp-hyp">${r.hypothesis}</div>
          <div class="exp-grid">
            <div class="stat"><div class="stat-lab">Control</div><div class="stat-val">${pct(r.control.rate, 2)}</div><div class="small muted mono">n=${num(r.control.n)}</div></div>
            <div class="stat"><div class="stat-lab">Variante</div><div class="stat-val">${pct(r.variant.rate, 2)}</div><div class="small muted mono">n=${num(r.variant.n)}</div></div>
            <div class="stat"><div class="stat-lab">Lift relativo</div><div class="stat-val ${r.relative_lift > 0 ? "mint" : "pink"}">${signed(r.relative_lift)}</div></div>
            <div class="stat"><div class="stat-lab">Valor p</div><div class="stat-val ${r.significant ? "mint" : "cream"}">${r.p_value === null ? "—" : r.p_value < 0.0001 ? "<0.0001" : r.p_value.toFixed(4)}</div></div>
            <div class="stat"><div class="stat-lab">IC 95% (abs)</div><div class="stat-val" style="font-size:14px">${r.ci_low === null ? "—" : `${(r.ci_low * 100).toFixed(2)} a ${(r.ci_high * 100).toFixed(2)} pp`}</div></div>
            <div class="stat"><div class="stat-lab">Potencia</div><div class="stat-val" style="font-size:14px;color:${r.powered ? "var(--mint)" : "var(--cream)"}">${r.powered ? "Suficiente" : "Insuficiente"}</div><div class="small muted mono">req. ${num(r.required_per_variant)}/var</div></div>
          </div>
          ${guard}
          <div class="rationale"><b>Decisión:</b> ${r.rationale}</div>
        </div>`;
    })
    .join("");
}

function renderBacklog(payload) {
  el("backlog").innerHTML = payload.items
    .map((it, i) => {
      const d = DECISION_META[it.status] ?? { label: it.status, cls: "ghost" };
      return `
        <tr>
          <td class="mono muted">${i + 1}</td>
          <td>
            <b>${it.id} · ${it.title}</b>
            <div class="small muted" style="margin-top:5px;max-width:520px">${it.hypothesis}</div>
          </td>
          <td class="num">${it.impact}</td>
          <td class="num">${it.confidence}</td>
          <td class="num">${it.ease}</td>
          <td class="num"><b style="color:var(--mint)">${it.ice}</b></td>
          <td><span class="badge ${d.cls}">${d.label}</span>${it.measured_lift !== null ? `<div class="small muted mono" style="margin-top:5px">${signed(it.measured_lift)}</div>` : ""}</td>
        </tr>`;
    })
    .join("");
}

function renderSegments(funnel) {
  const bars = (rows) => {
    const max = Math.max(...rows.map((r) => r.conversion));
    return rows
      .map(
        (r) => `
        <div class="fstep" style="grid-template-columns:120px 1fr 92px;margin-bottom:7px">
          <div class="fstep-label"><b style="text-transform:capitalize">${r.value}</b></div>
          <div class="fbar-track" style="height:26px">
            <div class="fbar" style="width:${Math.max((r.conversion / max) * 100, 4)}%;font-size:11.5px">${pct(r.conversion)}</div>
          </div>
          <div class="fstep-drop small mono">${num(r.sessions)}</div>
        </div>`
      )
      .join("");
  };
  el("seg-city").innerHTML = bars(funnel.segments.city);
  el("seg-source").innerHTML = bars(funnel.segments.source);
}

async function main() {
  try {
    const [overview, funnel, experiments, backlog] = await Promise.all([
      get("/api/overview"),
      get("/api/funnel"),
      get("/api/experiments"),
      get("/api/backlog"),
    ]);

    el("window-label").textContent = `${overview.generated.start} → ${overview.generated.end}`;
    el("seed-label").textContent = `seed ${overview.generated.seed}`;

    renderKpis(overview);
    renderOpsAlert(overview);
    renderFunnel("funnel-web", funnel.web);
    renderFunnel("funnel-wa", funnel.whatsapp);
    renderExperiments(experiments);
    renderBacklog(backlog);
    renderSegments(funnel);
  } catch (err) {
    document.querySelector("main .container").insertAdjacentHTML(
      "afterbegin",
      `<div class="card alert danger"><b>No se pudo cargar la data.</b><div class="small muted" style="margin-top:8px">${err.message}. ¿Corriste <span class="mono">npm run run-all</span> antes de <span class="mono">npm run web</span>?</div></div>`
    );
  }
}

main();
