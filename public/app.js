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

const pct = (v, digits = 1) =>
  v === null || v === undefined
    ? "—"
    : `${(v * 100).toLocaleString("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
// El segundo argumento se ignoraba: `num(165.6, 0)` devolvía "165,6" mientras
// el veredicto del pipeline decía "166/día" para el mismo dato.
const num = (v, digits) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString(
        "es-CO",
        digits === undefined ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits }
      );

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
    <div class="cstat"><div class="v">${num(h.sessions)}</div><div class="k">Sesiones (${overview.generated.days} días)</div><div class="s">estructura pública del embudo</div></div>
    <div class="cstat"><div class="v">${pct(h.conversion, 2)}</div><div class="k">Conversión global</div><div class="s">sesiones → agendamiento</div></div>
    <div class="cstat"><div class="v">${num(h.scheduled)}</div><div class="k">Agendamientos</div><div class="s">web + WhatsApp</div></div>
    <div class="cstat"><div class="v warn2">${num(overview.operations.final_backlog)}</div><div class="k">En cola de instalación</div><div class="s">${overview.operations.backlog_days_recent.toLocaleString("es-CO")} días de espera</div></div>`;
}

// ── Backlog por ICE — gráfico, no tabla ─────────────────────────────────
// El orden de trabajo se ve de un vistazo: la barra más larga es lo primero.
// El puntaje viene del pipeline; aquí solo se escala contra el máximo.
function renderIceBars(backlog) {
  const items = backlog.items;
  const max = Math.max(...items.map((i) => i.ice));
  el("ice-bars").innerHTML = items
    .map((it, i) => `
      <div class="icebar${i === 0 ? " top" : ""}">
        <span class="ib-id">${it.id}</span>
        <div class="ib-track" role="img" aria-label="${it.title}: ICE ${it.ice.toFixed(1)}">
          <div class="ib-fill" style="width:${(it.ice / max) * 100}%"></div>
          <span class="ib-label">${it.title}</span>
        </div>
        <span class="ib-score">${it.ice.toFixed(1)}</span>
      </div>`)
    .join("");
}

const setM = (k, v) => document.querySelectorAll(`[data-m="${k}"]`).forEach((n) => (n.textContent = v));

// Totales de cada carril del embudo. Estaban escritos a mano en el HTML
// ("32.624 visitas → 4.166 agendamientos"): si cambia la semilla o el modelo,
// un número quemado deja de coincidir con su propio gráfico sin avisar.
function renderFunnelTotals(funnel) {
  const first = (steps) => num(steps[0]?.reached);
  const last = (steps) => num(steps[steps.length - 1]?.reached);
  setM("wasteLate", num(funnel.eligibility_waste.filtered_late));
  setM("webSessions", first(funnel.web));
  setM("webScheduled", last(funnel.web));
  setM("waSessions", first(funnel.whatsapp));
  setM("waScheduled", last(funnel.whatsapp));
}

// ── Embudos ───────────────────────────────────────────────────────────────
// Cada barra se escala contra el paso anterior: una barra corta significa
// "aquí se van", no "este paso es pequeño en total". La fuga principal se
// marca con color semántico (aviso, no error: es un dato analítico).
// Arranca en el índice 2, no en el 1: la caída de "landing → abre el
// formulario/chat" es calidad de tráfico ("no estaba interesado"), no fricción
// del embudo. Es la misma definición que usa el pipeline en 04-derive.js
// (`funnel.web_funnel.slice(2)`); antes arrancaba en 1 y por eso marcaba el
// rebote (58,4%) como fuga principal, contradiciendo al propio copy de la
// página ("el cuello es el celular", 29,5%).
function hotStep(steps) {
  let best = Math.min(2, steps.length - 1);
  for (let i = best + 1; i < steps.length; i++) {
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

// La fuga principal, como número grande en vez de párrafo. El paso y la cifra
// salen del propio embudo: si cambia dónde se pierde la gente, cambia el texto.
function renderLeak(containerId, steps, note) {
  const s = steps[hotStep(steps)];
  el(containerId).innerHTML = `
    <div class="leak-n">−${num(s.drop_off)}</div>
    <div class="leak-b">
      <b>${s.label}</b> es donde más se pierde — ${pct(s.drop_off_rate)} de los que llegan. ${note}
      <span class="lbl obs">OBSERVACIÓN PÚBLICA</span>
    </div>`;
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
}

// ── Guardrail de capacidad (SVG sin dependencias) ─────────────────────────
const SVG = (w, h, aria, body) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${aria}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

// Un tooltip HTML reutilizado por gráfico, posicionado con el mouse — el SVG
// aria-label ya cubre accesibilidad; esto es una mejora progresiva al pasar
// el cursor, no la única forma de leer el dato.
function chartTooltip(container) {
  let t = container.querySelector(".chart-tooltip");
  if (!t) {
    t = document.createElement("div");
    t.className = "chart-tooltip";
    container.appendChild(t);
  }
  return t;
}

function positionTooltip(tooltip, container, clientX, clientY) {
  const box = container.getBoundingClientRect();
  const left = Math.min(Math.max(clientX - box.left + 14, 4), box.width - tooltip.offsetWidth - 4);
  const top = Math.min(Math.max(clientY - box.top - tooltip.offsetHeight - 10, 4), box.height - tooltip.offsetHeight - 4);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// Línea de guía + dos puntos que siguen el día más cercano al cursor.
function attachLineHover(svgEl, container, daily, { W, H, PAD, x, y }) {
  const tooltip = chartTooltip(container);
  const guide = document.createElementNS("http://www.w3.org/2000/svg", "g");
  guide.style.display = "none";
  guide.innerHTML =
    `<line class="chart-guide-line" x1="0" x2="0" y1="0" y2="${H}"/>` +
    `<circle class="chart-guide-dot cap" r="4" cx="0" cy="0"/>` +
    `<circle class="chart-guide-dot dem" r="4" cx="0" cy="0"/>`;
  svgEl.appendChild(guide);
  const line = guide.querySelector(".chart-guide-line");
  const dotCap = guide.querySelector(".cap");
  const dotDem = guide.querySelector(".dem");

  function onMove(e) {
    const rect = svgEl.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let idx = Math.round(((mx - PAD) / (W - PAD * 2)) * (daily.length - 1));
    idx = Math.max(0, Math.min(daily.length - 1, idx));
    const d = daily[idx];
    const px = x(idx);
    line.setAttribute("x1", px);
    line.setAttribute("x2", px);
    dotCap.setAttribute("cx", px);
    dotCap.setAttribute("cy", y(d.capacity));
    dotDem.setAttribute("cx", px);
    dotDem.setAttribute("cy", y(d.scheduled));
    guide.style.display = "";
    tooltip.innerHTML = `<b>Día ${d.day_index + 1}</b><br>Demanda: ${num(d.scheduled)}<br>Capacidad: ${num(d.capacity)}`;
    tooltip.style.display = "block";
    positionTooltip(tooltip, container, e.clientX, e.clientY);
  }
  svgEl.addEventListener("mousemove", onMove);
  svgEl.addEventListener("mouseleave", () => {
    guide.style.display = "none";
    tooltip.style.display = "none";
  });
}

// Resalta la barra bajo el cursor y muestra su valor exacto.
function attachBarHover(svgEl, container, daily) {
  const tooltip = chartTooltip(container);
  svgEl.querySelectorAll(".chart-bar-rect").forEach((rect, i) => {
    const d = daily[i];
    const show = (e) => {
      rect.classList.add("hovered");
      tooltip.innerHTML = `<b>Día ${d.day_index + 1}</b><br>${num(d.backlog_end_of_day)} pendientes`;
      tooltip.style.display = "block";
      positionTooltip(tooltip, container, e.clientX, e.clientY);
    };
    rect.addEventListener("mousemove", show);
    rect.addEventListener("mouseleave", () => {
      rect.classList.remove("hovered");
      tooltip.style.display = "none";
    });
  });
}

function renderCapacity(operations) {
  const o = operations.summary;
  // "desde el día N" estaba escrito a mano ("día 3"). Se calcula: el primer
  // día en que la demanda agendada supera a la capacidad de instalación.
  const firstOverloadIdx = operations.daily.findIndex((d) => d.scheduled > d.capacity);
  const overloadNote =
    firstOverloadIdx === -1
      ? "la capacidad absorbió la demanda todos los días"
      : `por encima del 100% desde el día ${operations.daily[firstOverloadIdx].day_index + 1}`;
  el("cap-stats").innerHTML = `
    <div class="cstat"><div class="v">${num(o.avg_daily_scheduled, 0)}</div><div class="k">Agendamientos por día</div><div class="s">demanda promedio simulada</div></div>
    <div class="cstat"><div class="v">${num(o.avg_daily_capacity, 0)}</div><div class="k">Capacidad de instalación</div><div class="s">por día</div></div>
    <div class="cstat"><div class="v warn2">${pct(o.capacity_utilisation, 0)}</div><div class="k">Uso de capacidad</div><div class="s">${overloadNote}</div></div>
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
  attachLineHover(el("cap-chart").querySelector("svg"), el("cap-chart").closest(".chart"), daily, { W, H, PAD, x, y });

  const maxBacklog = Math.max(...daily.map((d) => d.backlog_end_of_day));
  const bw = (W - PAD * 2) / daily.length;
  el("backlog-chart").innerHTML = SVG(
    W,
    H,
    `Gráfico de barras: la cola de instalaciones pendientes crece de 0 a ${num(maxBacklog)} agendamientos en 90 días`,
    daily
      .map((d, i) => {
        const h = (d.backlog_end_of_day / maxBacklog) * (H - PAD * 2);
        return `<rect class="chart-bar-rect" x="${(x(i) - bw / 2).toFixed(1)}" y="${(H - PAD - h).toFixed(1)}" width="${Math.max(bw - 1.5, 1).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--brand-pink)" opacity="0.85"/>`;
      })
      .join("")
  );
  attachBarHover(el("backlog-chart").querySelector("svg"), el("backlog-chart").closest(".chart"), daily);
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
    const [overview, funnel, operations, backlog, experiments, research] = await Promise.all([
      get("/api/overview"),
      get("/api/funnel"),
      get("/api/operations"),
      get("/api/backlog"),
      get("/api/experiments"),
      get("/api/research"),
    ]);

    // Ventana del dataset y cifras externas verificadas: también del API.
    setM("days", overview.generated.days);
    setM("countryOptions", research.facts.somos.form_country_options.value);
    // Tiempo de primera respuesta (guardrail del experimento de WhatsApp),
    // para el detalle de la hipótesis 02 — no escrito a mano.
    const waResp = experiments.results.map((r) => r.guardrail).find((g) => g && g.kind === "duration");
    setM("waRespMin", waResp ? waResp.control_value.toLocaleString("es-CO") : "—");

    renderOverviewStats(overview);
    renderFunnelTotals(funnel);
    renderIceBars(backlog);
    renderFunnel("funnel-web", funnel.web);
    renderWaFlow(funnel.whatsapp);
    renderFunnel("funnel-wa", funnel.whatsapp);
    renderLeak("funnel-web-insight", funnel.web, "Y hay quien entrega sus datos sin calificar.");
    renderLeak("funnel-wa-insight", funnel.whatsapp, "El asesor no da abasto — o responde tarde.");
    renderCapacity(operations);
  } catch (err) {
    showError(err);
  }
}

main();
