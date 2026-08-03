// pitch.js — deck navigation, autoplay timing, and data bindings for pitch.html.
//
// ── Deck navigation ──
const slides = [...document.querySelectorAll(".slide")];
let idx = 0;
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const playBtn = document.getElementById("play");
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

// ── Sync to the recorded narration (somos_audio.mp3) ──
// Audio and slides start together (LEAD = 0). Slides are driven by the AUDIO
// CLOCK (currentTime − LEAD), not a wall timer, so pause/resume never drifts
// and a re-record only needs cue recalibration.
// Calibrate NARRATION_CUES by ear: each entry is the narrated second at
// which that slide's spoken line begins. Narration spans 0…(duration − LEAD).
const audio = document.getElementById("pitch-audio");
const LEAD = 0; // seconds of intro before the narration starts
// Narration window measured with ffmpeg silencedetect (-35dB, 0.3s):
// speech runs ~0.0s → ~114.9s of the 115.25s file (no leading silence).
// Cues = word-proportional start of each slide's line over that window
// (268 words total ≈ 2.33 w/s): [0, 9, 21, 32, 41, 49, 57, 64, 73, 81, 92].
const NARRATION_CUES = [0, 9, 21, 32, 41, 49, 57, 64, 73, 81, 92];
const NARRATION_WINDOW = {
  start: 0, // first audible word (silencedetect)
  end: 114.9, // last audible word (silencedetect)
  words: [22, 27, 25, 21, 19, 18, 18, 20, 19, 26, 53], // per-slide script words
};
audio.dataset.lead = String(LEAD);
audio.dataset.narrStart = String(NARRATION_WINDOW.start);
audio.dataset.narrEnd = String(NARRATION_WINDOW.end);
audio.dataset.words = NARRATION_WINDOW.words.join(",");
audio.dataset.cues = NARRATION_CUES.join(",");
let playing = false;
const narrated = () => Math.max(0, audio.currentTime - LEAD);
function cueSlide() {
  let best = 0;
  const t = narrated();
  for (let i = 0; i < NARRATION_CUES.length && t >= NARRATION_CUES[i]; i++) best = i;
  return best;
}
function syncTick() {
  // The play button's label IS the state: it flips to "❚❚" when the clock
  // runs, so the clock never moves the deck while paused or stopped.
  if (playBtn.textContent !== "❚❚") return;
  const target = cueSlide();
  if (target !== idx) show(target);
  if (audio.ended) stopAutoplay();
}
function stopAutoplay() {
  playing = false;
  if (!audio.paused) audio.pause();
  playBtn.textContent = "▶";
  playBtn.setAttribute("aria-label", "Reproducir con el audio sincronizado");
}
function startAutoplay() {
  playing = true;
  audio.currentTime = 0;
  show(0);
  playBtn.textContent = "❚❚";
  playBtn.setAttribute("aria-label", "Pausar reproducción sincronizada");
  try {
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch(() => fallbackAutoplay());
  } catch {
    fallbackAutoplay();
  }
}
playBtn.addEventListener("click", () => (playing ? stopAutoplay() : startAutoplay()));
audio.addEventListener("timeupdate", syncTick);
audio.addEventListener("ended", stopAutoplay);

// Fallback: if the audio file can't load (e.g. not recorded yet), keep a
// timed dwell plan so the deck still presents itself at ~2 minutes.
const FALLBACK_SECONDS = [9, 12, 11, 9, 8, 8, 7, 9, 8, 11, 23];
let fallbackTimer = null;
function fallbackAutoplay() {
  playing = true;
  playBtn.textContent = "❚❚";
  playBtn.setAttribute("aria-label", "Pausar reproducción automática");
  const step = () => {
    if (!playing) return;
    if (idx >= slides.length - 1) { stopAutoplay(); return; }
    show(idx + 1);
    fallbackTimer = setTimeout(step, (FALLBACK_SECONDS[idx] ?? 8) * 1000);
  };
  clearTimeout(fallbackTimer);
  step();
}

function manualShow(next) { stopAutoplay(); show(next); }
prevBtn.addEventListener("click", () => manualShow(idx - 1));
nextBtn.addEventListener("click", () => manualShow(idx + 1));
document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); manualShow(idx + 1); }
  else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); manualShow(idx - 1); }
  else if (e.key === "Home") manualShow(0);
  else if (e.key === "End") manualShow(slides.length - 1);
  else if (e.key === " ") { e.preventDefault(); playing ? stopAutoplay() : startAutoplay(); }
  else if (e.key.toLowerCase() === "f") {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  }
});
document.addEventListener("click", (e) => { if (!e.target.closest("a") && !e.target.closest("button") && !e.target.closest("details")) manualShow(idx + 1); });
show(0);

// ── Every number comes from the API ──
// Not a single figure in the deck is hand-typed: if the pipeline changes, the
// pitch changes with it. A number baked into the HTML is a number that will
// eventually contradict the dashboard.
const pct = (v, d = 1) =>
  v == null ? "—" : `${(v * 100).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const num = (v) => (v == null ? "—" : v.toLocaleString("es-CO"));
const set = (k, v) => document.querySelectorAll(`[data-m="${k}"]`).forEach((el) => (el.textContent = v));
// Fills by id only if the element exists (the deck's structure changes over
// time; an orphaned hook shouldn't be able to break the rest of the load).
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

// ── Mini funnels (slide 2) ──
// Four bars per channel, each measured against the previous step. The
// biggest leak is painted with the semantic warning color (analysis, not
// an error state).
function miniFunnel(steps, keys) {
  const picked = keys.map((k) => steps.find((s) => s.step === k)).filter(Boolean);
  if (!picked.length) return "";
  // Index 2 onward: the "landing → opens form/chat" bounce is traffic
  // quality, not friction. Same definition used in 04-derive.js.
  let hot = Math.min(2, picked.length - 1);
  for (let i = hot + 1; i < picked.length; i++) {
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

// ── Guardrail sparkline (slide 9) ──
// Paths are painted with setAttribute("d", …): innerHTML would create text
// content inside the path element instead of its drawing attribute.
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
  fetch("/api/research").then((r) => r.json()),
])
  .then(([overview, funnel, experiments, backlog, operations, research]) => {
    const ops = overview.operations;

    // ── Verified external facts (/api/research) ────────────────────────────
    // The pipeline doesn't produce these, but they aren't hand-typed either:
    // they come from the same API, with their source, and anything derived
    // from them is computed there (not here).
    const setR = (k, v) => document.querySelectorAll(`[data-r="${k}"]`).forEach((el) => (el.textContent = v));
    const F = research.facts;
    const D = research.derived;
    const musd = (v) => `US$${v}M`;
    const signedPct = (v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}% QoQ`;
    setR("fundingTotal", musd(D.funding_total_musd));
    setR("serieA", musd(F.somos.serie_a_musd.value));
    setR("serieB", musd(F.somos.serie_b_musd.value));
    setR("usersPublic", num(F.somos.users_public.value));
    setR("heliumAccounts", num(F.helium.accounts.value));
    setR("heliumAccountsQoQ", signedPct(F.helium.accounts.qoq));
    setR("heliumHotspots", num(F.helium.hotspots.value));
    setR("heliumThirdParty", pct(D.helium_third_party_pct));
    setR("heliumOffload", `${num(F.helium.offload_tb.value)} TB`);
    setR("heliumOffloadQoQ", signedPct(F.helium.offload_tb.qoq));
    setR("obiMonths", F.helium.omv_obi_months.value);
    setR("tokenVol", `${F.helium.token_volatility_x.value.toLocaleString("es-CO")}x`);
    setR("tokenWindow", F.helium.token_volatility_x.window_months);
    setR("blockersMapped", F.mvp.blockers_mapped.value);
    setR("blockersLeft", D.blockers_remaining);
    setR("mvpBuildings", `${F.mvp.buildings_min.value}-${F.mvp.buildings_max.value}`);
    setR("mvpWeeks", `${F.mvp.weeks_min.value}-${F.mvp.weeks_max.value}`);
    // Illustrative example for idea 01 — not a real Somos figure.
    setR("neighbors", num(F.hyperlocal.neighbors_example.value));

    // The confidence interval is derived from alpha; never write "95%" by hand.
    set("ci", pct(1 - experiments.alpha, 0));

    // Slide 10 — method: test count
    set("testCount", overview.headline.test_count ?? "—");

    // Slide 2 — mini funnels + WhatsApp channel chips
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

    // Slide 4 — idea 01: external validation (street work, #1 in the backlog)
    const topItem = backlog.items[0];
    set("p8", topItem ? `ICE ${topItem.ice.toFixed(1)} · #1 del backlog` : "—");

    // Slide 9 — guardrail: capacity + sparkline
    set("utilisation", pct(ops.capacity_utilisation, 0));
    set("opsVerdict", ops.verdict);
    // These used to be hand-typed ("2,558", "14.9") next to a chart that DID
    // come from the API: the queue and wait time change with the seed.
    set("queue", num(ops.final_backlog));
    set("queueDays", ops.backlog_days_recent.toLocaleString("es-CO"));
    renderSpark(operations.daily ?? []);

    // Slide 10 — experiment results as a chart.
    // This used to repeat the web funnel, already shown on slide 2. A lift
    // chart tells the story the funnel can't: the experiment with the
    // biggest lift is exactly the one blocked by a broken guardrail.
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

    // Slide 10 — terminal: built from the real experiment results
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


    // Slide 10 — next experiment (from the pipeline's planning, in /api/overview)
    const next = overview.next_experiment_planning;
    if (next) {
      set("neBaseline", pct(next.baseline_rate, 1));
      set("neMde", pct(next.mde, 0));
      set("neN", num(next.required_per_variant));
      set("neDays", next.estimated_days);
    }

    // Slide 10 — top 3 backlog items by ICE
    fill("top3", backlog.items
      .slice(0, 3)
      .map((b) => `<b>${b.id}</b> ${b.title} <span class="mono">${b.ice.toFixed(1)}</span>`)
      .join(' <span style="color:var(--muted-2)">·</span> '));
  })
  .catch((err) => {
    fill("pf", `<div class="lead">No se pudo cargar la data (${err.message}). Corré <span class="mono">npm run run-all</span>.</div>`);
  });
