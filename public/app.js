// Main page rendering. Deliberately a dumb view layer: it formats and paints,
// it never recomputes a metric. Every number here was produced by the pipeline
// and served by the API, so the page and the CSVs can never disagree.
//
// This page is the 30% of the site: evidence and hypotheses, compact. The 70%
// — research, own ideas, the operations finding, the method — lives in /pitch.
//
// Every section labels what it shows: OBSERVACIÓN (structure of the public
// funnel), HIPÓTESIS (interpretation) and REQUIERE VALIDACIÓN INTERNA (would
// need real internal data). The labels are the honesty layer of the exercise.

const pct = (v, digits = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);
const num = (v) => (v === null || v === undefined ? "—" : v.toLocaleString("es-CO"));

const el = (id) => document.getElementById(id);

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── Resumen (tesis) ───────────────────────────────────────────────────────
function renderOverviewStats(overview) {
  const h = overview.headline;
  el("overview-stats").innerHTML = `
    <div class="cstat"><div class="v">${num(h.sessions)}</div><div class="k">Sesiones (90 días)</div><div class="s">estructura pública del embudo</div></div>
    <div class="cstat"><div class="v">${pct(h.conversion, 2)}</div><div class="k">Conversión global</div><div class="s">sesiones → agendamiento</div></div>
    <div class="cstat"><div class="v">${num(h.scheduled)}</div><div class="k">Agendamientos</div><div class="s">web + WhatsApp</div></div>
    <div class="cstat"><div class="v warn2">${num(overview.operations.final_backlog)}</div><div class="k">En cola de instalación</div><div class="s">${overview.operations.backlog_days_recent.toLocaleString("es-CO")} días de espera</div></div>`;
}

function renderEligibilityWaste(funnel) {
  document.querySelectorAll('[data-m="wasteLate"]').forEach((n) => (n.textContent = num(funnel.eligibility_waste.filtered_late)));
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
    .map((f) => `<line x1="${PAD}" x2="${W - PAD}" y1="${y(maxDemand * f)}" y2="${y(maxDemand * f)}" stroke="var(--border)" stroke-width="1"/>`)
    .join("");

  el("cap-chart").innerHTML = SVG(
    W,
    H,
    `Gráfico de línea: la demanda de agendamientos supera a la capacidad de instalación desde el tercer día`,
    grid +
      `<path d="${line("capacity")}" fill="none" stroke="var(--text-3)" stroke-width="2"/>` +
      `<path d="${line("scheduled")}" fill="none" stroke="var(--warn)" stroke-width="2.5"/>`
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
        return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(H - PAD - h).toFixed(1)}" width="${Math.max(bw - 1.5, 1).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--brand-pink)" opacity="0.85"><title>Día ${d.day_index + 1}: ${num(d.backlog_end_of_day)} pendientes</title></rect>`;
      })
      .join("")
  );
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
    const [overview, funnel, operations] = await Promise.all([
      get("/api/overview"),
      get("/api/funnel"),
      get("/api/operations"),
    ]);

    renderOverviewStats(overview);
    renderEligibilityWaste(funnel);
    renderFunnel("funnel-web", funnel.web);
    renderWaFlow(funnel.whatsapp);
    renderFunnel("funnel-wa", funnel.whatsapp);
    renderCapacity(operations);
  } catch (err) {
    showError(err);
  }
}

main();
