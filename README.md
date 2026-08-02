# Somos CRO Lab

Laboratorio de optimización de conversión: genera un embudo sintético, corre experimentos A/B con estadística real y prioriza un backlog de hipótesis con ICE.

> ⚠ **Todos los datos son sintéticos.** Se generan localmente con una semilla fija. No provienen de Somos Internet ni de ningún sistema real, y no representan métricas reales de ninguna empresa. La estructura del embudo está modelada sobre lo que es observable públicamente en un sitio web; los números no.

---

## Correr

```bash
npm run run-all   # genera el dataset + análisis (~5 s)
npm test          # unit · fuzz · invariantes
npm run web       # dashboard en localhost:3000 · pitch en /pitch
```

Requiere Node ≥ 20. **Cero dependencias** — solo la librería estándar.

---

## Qué hace

| Etapa | Script | Salida |
|---|---|---|
| Genera | `01-generate.js` | ~87k sesiones sintéticas con semilla fija, conversaciones, asignación de experimentos y capacidad de operaciones |
| Agrega | `02-funnel.js` | Embudo por paso e intervalos de Wilson, cortado por ciudad, estrato, origen y dispositivo |
| Analiza | `03-experiments.js` | Prueba z de dos proporciones, IC al 95%, tamaño de muestra y métricas de guardia |
| Deriva | `04-derive.js` | Backlog priorizado con ICE + diagnóstico del cuello de botella |

La estadística es real: prueba z con error estándar agrupado, intervalos de confianza sin agrupar, cálculo de tamaño de muestra por MDE y potencia, e intervalos de Wilson. Nada está escrito a mano — el dashboard y el pitch leen todo desde la API.

---

## Decisiones de diseño

**Reproducibilidad.** Todo sale de un PRNG con semilla fija (`mulberry32`). Dos corridas producen archivos idénticos byte a byte, así que cualquiera puede auditar los números.

**Una sola fuente de verdad para la API.** `src/web/handlers.js` son funciones puras que reciben los datos ya cargados. El servidor de Node los lee del disco; la Cloudflare Pages Function los importa como JSON estático (los Workers no tienen filesystem). Misma lógica, dos runtimes, sin divergencia posible.

**Las guardias mandan.** Una métrica de guardia rota bloquea el lanzamiento aunque la métrica primaria haya ganado — con una tolerancia acordada antes de leer el resultado, no después.

**Los tests encontraron bugs reales.** Tres, durante la construcción: un mapa de pesos mal formado que colapsaba silenciosamente todas las sesiones en una sola ciudad mientras los totales seguían cuadrando; un experimento sin datos que tumbaba el análisis completo; y un cálculo de muestra que explotaba con tasas de exactamente 0 o 1.

---

## Deploy — Cloudflare Pages

| Ajuste | Valor |
|---|---|
| Build command | `npm run run-all` |
| Build output directory | `public` |
| Functions directory | `functions` (detectado automáticamente) |
| Node version | 20 o superior |

`public/_headers` define CSP y cabeceras de seguridad; `public/_redirects` maneja la ruta `/pitch`.

### Guardia contra abuso de la API

Las rutas `/api/*` pasan por un token bucket (60 de ráfaga, 1 req/s sostenido) que responde `429` con `Retry-After`. Solo se aceptan `GET`/`HEAD`; cualquier otro método recibe `405`.

**Limitación declarada, no escondida:** el limitador vive en memoria del isolate. En Cloudflare hay varios isolates, así que esto frena martilleo accidental y scraping barato — no un ataque distribuido. Para eso hacen falta las reglas de Rate Limiting de Cloudflare o un Durable Object.

---

## Estructura

```
src/lib/        rng · stats · rate-limit · csv
src/pipeline/   01-generate → 02-funnel → 03-experiments → 04-derive
src/web/        handlers (puro) · data-node (loader) · server (dev local)
functions/      Cloudflare Pages Function
public/         dashboard · pitch · estilos
test/           unit · fuzz · invariantes
raw/            datos generados (los pesados son regenerables, no se commitean)
```

---

## Licencia

MIT.
