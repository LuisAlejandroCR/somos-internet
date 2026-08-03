// info.js — shared info-icon popovers: hover or click any metric's "i" icon
// to see how it was calculated, with a link to the exact API endpoint or
// methodology section that produces it. Loaded by index.html, pitch.html
// and metodologia.html — event delegation means it works on icons rendered
// after page load too (e.g. the ones app.js/pitch.js build from API data).

const INFO = {
  sessions: { text: "Suma de sesiones simuladas del embudo web + WhatsApp para el periodo generado.", href: "/api/overview" },
  conversion: { text: "Agendamientos totales ÷ sesiones totales.", href: "/api/overview" },
  scheduled: { text: "Instalaciones agendadas, sumando el embudo web y el conversacional.", href: "/api/overview" },
  backlog: { text: "Agendamientos que siguen sin instalarse al cierre de la simulación (día 90).", href: "/api/operations" },
  demand: { text: "Promedio de agendamientos completados por día en los 90 días simulados.", href: "/api/operations" },
  capacity: { text: "Capacidad de instalación configurada por día en el modelo de operaciones.", href: "/api/operations" },
  utilisation: { text: "Demanda diaria promedio de agendamientos ÷ capacidad diaria de instalación.", href: "/api/operations" },
  "funnel-step": { text: "Cada paso se mide contra el anterior: usuarios que continúan ÷ usuarios que llegaron a este paso, con intervalo de Wilson.", href: "/metodologia#stats-title" },
  ice: { text: "Impacto + Confianza + Facilidad, promediados (0 a 10 cada uno). Prioriza el backlog — no es un dato de Somos.", href: "/metodologia#stats-title" },
  experiment: { text: "Prueba z de dos proporciones, control vs. variante. El lift es la diferencia relativa; una guardia rota bloquea el lanzamiento aunque la métrica primaria gane.", href: "/api/experiments" },
  helium: { text: "Dato externo verificado — Helium Foundation, reporte Q4-2025. No lo genera este pipeline.", href: "/api/research" },
};

function initInfoIcons() {
  const pop = document.createElement("div");
  pop.className = "info-pop";
  pop.setAttribute("role", "tooltip");
  document.body.appendChild(pop);

  let activeBtn = null;
  let pinned = false;
  let closeTimer = null;

  function place(btn) {
    const r = btn.getBoundingClientRect();
    const popW = pop.offsetWidth || 260;
    let left = Math.min(r.left, window.innerWidth - popW - 12);
    left = Math.max(8, left);
    let top = r.bottom + 7;
    if (top + pop.offsetHeight + 8 > window.innerHeight) top = r.top - 7 - pop.offsetHeight;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function close() {
    clearTimeout(closeTimer);
    pop.classList.remove("open");
    if (activeBtn) activeBtn.setAttribute("aria-expanded", "false");
    activeBtn = null;
    pinned = false;
  }

  function open(btn) {
    const entry = INFO[btn.dataset.info];
    if (!entry) return;
    clearTimeout(closeTimer);
    if (activeBtn && activeBtn !== btn) activeBtn.setAttribute("aria-expanded", "false");
    pop.innerHTML = `<div>${entry.text}</div>` + (entry.href ? `<a class="link" href="${entry.href}">Explorar →</a>` : "");
    pop.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    activeBtn = btn;
    place(btn);
  }

  function scheduleClose() {
    if (pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 150);
  }

  document.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".info-ico");
    if (btn) open(btn);
  });
  document.addEventListener("mouseout", (e) => {
    const btn = e.target.closest(".info-ico");
    if (btn && !e.relatedTarget?.closest?.(".info-pop")) scheduleClose();
  });
  pop.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  pop.addEventListener("mouseleave", scheduleClose);

  document.addEventListener("focusin", (e) => {
    const btn = e.target.closest(".info-ico");
    if (btn) open(btn);
  });
  document.addEventListener("focusout", (e) => {
    const btn = e.target.closest(".info-ico");
    if (btn) scheduleClose();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".info-ico");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (activeBtn === btn && pinned) { close(); return; }
      open(btn);
      pinned = true;
      return;
    }
    if (!pop.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", () => { if (activeBtn) place(activeBtn); });
}

initInfoIcons();
