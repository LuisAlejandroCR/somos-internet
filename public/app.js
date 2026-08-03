// app.js — main page (index.html) rendering. Deliberately a dumb view layer: it formats and paints,
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
// The second argument used to be ignored: `num(165.6, 0)` returned "165.6"
// while the pipeline's own verdict said "166/day" for the same figure.
const num = (v, digits) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString(
        "es-CO",
        digits === undefined ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits }
      );

const el = (id) => document.getElementById(id);

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Animates a number from 0 to its target, formatting every frame the same
// way the final value is formatted — a real animated number, not a static
// figure that just appears once the API responds.
function countUp(node, target, format, duration = 900) {
  if (!node || !Number.isFinite(target)) return;
  if (reduceMotion()) { node.textContent = format(target); return; }
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = format(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Sets a bar's width in two steps (0, then the real value on the next frame)
// so the CSS width transition actually has something to animate — setting
// the final width directly leaves nothing for the transition to run.
function animateWidth(node, finalWidth) {
  if (!node) return;
  if (reduceMotion()) { node.style.width = finalWidth; return; }
  node.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => { node.style.width = finalWidth; }));
}

// Makes an SVG path draw itself in instead of appearing all at once.
function drawIn(path) {
  if (!path || reduceMotion()) return;
  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;
  path.classList.add("draw-in");
  requestAnimationFrame(() => requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; }));
}

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── Overview (thesis) ──────────────────────────────────────────────────────
// Each big number counts up from 0 on load instead of just appearing —
// the numbers are the headline visual here, so they're the ones worth
// animating for real, not just fading in.
function renderOverviewStats(overview) {
  const h = overview.headline;
  const stats = [
    { v: h.sessions, k: `Sesiones (${overview.generated.days} días)`, s: "estructura pública del embudo", fmt: (x) => num(Math.round(x)) },
    { v: h.conversion, k: "Conversión global", s: "sesiones → agendamiento", fmt: (x) => pct(x, 2) },
    { v: h.scheduled, k: "Agendamientos", s: "web + WhatsApp", fmt: (x) => num(Math.round(x)) },
    { v: overview.operations.final_backlog, k: "En cola de instalación", s: `${overview.operations.backlog_days_recent.toLocaleString("es-CO")} días de espera`, fmt: (x) => num(Math.round(x)), cls: "warn2" },
  ];
  el("overview-stats").innerHTML = stats
    .map((s, i) => `<div class="cstat"><div class="v ${s.cls || ""}" id="ov-stat-${i}">0</div><div class="k">${s.k}</div><div class="s">${s.s}</div></div>`)
    .join("");
  stats.forEach((s, i) => countUp(el(`ov-stat-${i}`), s.v, s.fmt));
}

// Ties two hypothesis cards to their real backlog priority. Only cards 01
// and 04 get a badge: they map 1:1 to a specific backlog proposal (P3, P2).
// Cards 02/03/05 don't have a single matching backlog item, so they get no
// badge rather than a made-up one.
function renderHypothesisPriority(backlog) {
  const byId = (id) => backlog.items.find((i) => i.id === id);
  const p3 = byId("P3"); // portería-before-data → hypothesis 01
  const p2 = byId("P2"); // country selector → hypothesis 04
  if (p3) el("ice-h1").textContent = `ICE ${p3.ice.toFixed(1)}`;
  if (p2) el("ice-h4").textContent = `ICE ${p2.ice.toFixed(1)}`;
}

// ── ICE backlog — a chart, not a table ──────────────────────────────────
// The work order is visible at a glance: the longest bar goes first. The
// score comes from the pipeline; this just scales it against the max.
function renderIceBars(backlog) {
  const items = backlog.items;
  const max = Math.max(...items.map((i) => i.ice));
  el("ice-bars").innerHTML = items
    .map((it, i) => `
      <div class="icebar${i === 0 ? " top" : ""}">
        <span class="ib-id">${it.id}</span>
        <div class="ib-track" role="img" aria-label="${it.title}: ICE ${it.ice.toFixed(1)}">
          <div class="ib-fill" data-w="${(it.ice / max) * 100}%"></div>
          <span class="ib-label">${it.title}</span>
        </div>
        <span class="ib-score">${it.ice.toFixed(1)}</span>
      </div>`)
    .join("");
  el("ice-bars").querySelectorAll(".ib-fill").forEach((node) => animateWidth(node, node.dataset.w));
}

const setM = (k, v) => document.querySelectorAll(`[data-m="${k}"]`).forEach((n) => (n.textContent = v));

// Totals for each funnel lane. These used to be hand-typed in the HTML
// ("32,624 visits → 4,166 scheduled"): if the seed or the model changes, a
// baked-in number silently stops matching its own chart.
function renderFunnelTotals(funnel) {
  const first = (steps) => num(steps[0]?.reached);
  const last = (steps) => num(steps[steps.length - 1]?.reached);
  setM("wasteLate", num(funnel.eligibility_waste.filtered_late));
  setM("webSessions", first(funnel.web));
  setM("webScheduled", last(funnel.web));
  setM("waSessions", first(funnel.whatsapp));
  setM("waScheduled", last(funnel.whatsapp));
}

// ── Funnels ─────────────────────────────────────────────────────────────
// Each bar is scaled against the previous step: a short bar means "people
// leave here," not "this step is small overall." The biggest leak is marked
// with the semantic warning color (a warning, not an error — it's analytical
// data). Starts at index 2, not 1: the "landing → opens form/chat" drop-off
// is traffic quality ("wasn't interested"), not funnel friction. This is the
// same definition the pipeline uses in 04-derive.js
// (`funnel.web_funnel.slice(2)`); it used to start at 1, which marked that
// bounce (58.4%) as the main leak — contradicting the page's own copy ("the
// bottleneck is the phone field", 29.5%).
function hotStep(steps) {
  let best = Math.min(2, steps.length - 1);
  for (let i = best + 1; i < steps.length; i++) {
    if (steps[i].drop_off_rate > steps[best].drop_off_rate) best = i;
  }
  return best;
}

function renderFunnel(containerId, steps) {
  const hotIdx = hotStep(steps);
  const container = el(containerId);
  container.innerHTML = steps
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
            <div class="fbar${isHot ? " hot" : ""}" data-w="${Math.max(width, 3)}%">${i === 0 ? "100%" : pct(s.step_conversion)}</div>
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
  container.querySelectorAll(".fbar").forEach((node) => animateWidth(node, node.dataset.w));
}

// The main leak, as a big number instead of a paragraph. The step and the
// figure both come from the funnel itself: if where people drop off changes,
// the text changes with it.
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

// ── Capacity guardrail (dependency-free SVG) ──────────────────────────────
const SVG = (w, h, aria, body) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${aria}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

// One HTML tooltip reused per chart, positioned by the mouse — the SVG
// aria-label already covers accessibility; this is a progressive enhancement
// on hover, not the only way to read the data.
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

// A guide line plus two dots that follow the day closest to the cursor.
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

// Highlights the bar under the cursor and shows its exact value.
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
  // "since day N" used to be hand-typed ("day 3"). It's computed instead: the
  // first day scheduled demand exceeds install capacity.
  const firstOverloadIdx = operations.daily.findIndex((d) => d.scheduled > d.capacity);
  const overloadNote =
    firstOverloadIdx === -1
      ? "la capacidad absorbió la demanda todos los días"
      : `por encima del 100% desde el día ${operations.daily[firstOverloadIdx].day_index + 1}`;
  const capStats = [
    { v: o.avg_daily_scheduled, k: "Agendamientos por día", s: "demanda promedio simulada", fmt: (x) => num(x, 0) },
    { v: o.avg_daily_capacity, k: "Capacidad de instalación", s: "por día", fmt: (x) => num(x, 0) },
    { v: o.capacity_utilisation, k: "Uso de capacidad", s: overloadNote, fmt: (x) => pct(x, 0), cls: "warn2" },
    { v: o.final_backlog, k: "En cola al cierre", s: `≈ ${o.backlog_days_recent.toLocaleString("es-CO")} días de espera`, fmt: (x) => num(x, 0) },
  ];
  el("cap-stats").innerHTML = capStats
    .map((s, i) => `<div class="cstat"><div class="v ${s.cls || ""}" id="cap-stat-${i}">0</div><div class="k">${s.k}</div><div class="s">${s.s}</div></div>`)
    .join("");
  capStats.forEach((s, i) => countUp(el(`cap-stat-${i}`), s.v, s.fmt));

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
      `<path id="cap-line-capacity" d="${line("capacity")}" fill="none" stroke="var(--text-3)" stroke-width="2"/>` +
      `<path id="cap-line-scheduled" d="${line("scheduled")}" fill="none" stroke="var(--warn)" stroke-width="2.5"/>`
  );
  attachLineHover(el("cap-chart").querySelector("svg"), el("cap-chart").closest(".chart"), daily, { W, H, PAD, x, y });
  // Self-drawing lines instead of appearing all at once.
  drawIn(el("cap-chart").querySelector("#cap-line-capacity"));
  drawIn(el("cap-chart").querySelector("#cap-line-scheduled"));

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

// ── Loading ─────────────────────────────────────────────────────────────────
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

    // Dataset window and verified external facts: also from the API.
    setM("days", overview.generated.days);
    setM("countryOptions", research.facts.somos.form_country_options.value);
    // First-response time (the WhatsApp experiment's guardrail), for
    // hypothesis card 02's detail — not hand-typed.
    const waResp = experiments.results.map((r) => r.guardrail).find((g) => g && g.kind === "duration");
    setM("waRespMin", waResp ? waResp.control_value.toLocaleString("es-CO") : "—");

    renderOverviewStats(overview);
    renderFunnelTotals(funnel);
    renderIceBars(backlog);
    renderHypothesisPriority(backlog);
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
