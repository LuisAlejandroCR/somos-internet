// Frequentist A/B test math for two-proportion experiments.
//
// This file is the reason the demo exists: the job posting asks for
// experiments with "hipótesis, métricas primarias, métricas de guardia y
// criterios de descarte claros". A criterio de descarte is only meaningful if
// something actually computes significance and required sample size — so this
// is real math, not a formatted guess.

// Abramowitz & Stegun 7.1.26 — max abs error ~1.5e-7, far below what any
// experiment decision needs.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inverse normal CDF (Acklam's rational approximation). Needed to turn a
// confidence level into a z critical value without hardcoding a lookup table.
export function normalQuantile(p) {
  if (p <= 0 || p >= 1) throw new RangeError("normalQuantile expects 0 < p < 1");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q;
  let r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Two-proportion z-test with pooled standard error (the standard choice for
 * testing H0: p_control === p_variant).
 *
 * The confidence interval, by contrast, uses the UNPOOLED standard error —
 * that is deliberate, not an inconsistency: pooling assumes the null is true,
 * which is right for the test statistic but wrong for estimating the size of a
 * difference you already believe exists.
 */
export function twoProportionTest({ controlConversions, controlTotal, variantConversions, variantTotal, confidenceLevel = 0.95 }) {
  if (controlTotal <= 0 || variantTotal <= 0) throw new RangeError("totals must be > 0");
  if (controlConversions < 0 || variantConversions < 0) throw new RangeError("conversions must be >= 0");
  if (controlConversions > controlTotal || variantConversions > variantTotal) {
    throw new RangeError("conversions cannot exceed total");
  }

  const pControl = controlConversions / controlTotal;
  const pVariant = variantConversions / variantTotal;
  const absoluteLift = pVariant - pControl;
  const relativeLift = pControl === 0 ? null : absoluteLift / pControl;

  const pPooled = (controlConversions + variantConversions) / (controlTotal + variantTotal);
  const sePooled = Math.sqrt(pPooled * (1 - pPooled) * (1 / controlTotal + 1 / variantTotal));
  const z = sePooled === 0 ? 0 : absoluteLift / sePooled;
  const pValue = 2 * (1 - normalCdf(Math.abs(z))); // two-tailed

  const seUnpooled = Math.sqrt((pControl * (1 - pControl)) / controlTotal + (pVariant * (1 - pVariant)) / variantTotal);
  const zCrit = normalQuantile(1 - (1 - confidenceLevel) / 2);
  const ciLow = absoluteLift - zCrit * seUnpooled;
  const ciHigh = absoluteLift + zCrit * seUnpooled;

  return {
    pControl,
    pVariant,
    absoluteLift,
    relativeLift,
    z,
    pValue,
    ciLow,
    ciHigh,
    confidenceLevel,
    significant: pValue < 1 - confidenceLevel,
  };
}

/**
 * Sample size per variant for a two-proportion test.
 * `mde` is the *relative* minimum detectable effect (0.10 === "detect a 10%
 * relative lift"), which is how the business states it in practice.
 */
export function sampleSizePerVariant({ baselineRate, mde, power = 0.8, alpha = 0.05 }) {
  if (baselineRate <= 0 || baselineRate >= 1) throw new RangeError("baselineRate must be strictly between 0 and 1");
  if (mde <= 0) throw new RangeError("mde must be > 0");
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + mde);
  if (p2 >= 1) throw new RangeError("baselineRate * (1 + mde) must stay below 1");
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  const pBar = (p1 + p2) / 2;
  const numerator = Math.pow(zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2);
  return Math.ceil(numerator / Math.pow(p2 - p1, 2));
}

/** Days to reach the required sample, given traffic split evenly across variants. */
export function daysToSignificance({ baselineRate, mde, dailyTraffic, variants = 2, power = 0.8, alpha = 0.05 }) {
  if (dailyTraffic <= 0) throw new RangeError("dailyTraffic must be > 0");
  const perVariant = sampleSizePerVariant({ baselineRate, mde, power, alpha });
  const dailyPerVariant = dailyTraffic / variants;
  return { perVariant, totalRequired: perVariant * variants, days: Math.ceil(perVariant / dailyPerVariant) };
}

/**
 * Guardrail check: is the guardrail metric materially WORSE in the variant?
 * `higherIsBetter=false` means the metric is a cost (e.g. install backlog days,
 * opt-out rate) and an increase is the bad direction.
 *
 * Deliberately one-tailed and tolerance-based: a guardrail is not "is there any
 * difference at all", it's "did we break something by more than we agreed to
 * tolerate before launching".
 */
export function guardrailBreached({ controlValue, variantValue, toleranceRelative = 0.05, higherIsBetter = false }) {
  if (controlValue === 0) return { breached: false, delta: 0, relativeDelta: null };
  const delta = variantValue - controlValue;
  const relativeDelta = delta / controlValue;
  const worse = higherIsBetter ? -relativeDelta : relativeDelta;
  return { breached: worse > toleranceRelative, delta, relativeDelta, toleranceRelative };
}

/** Wilson score interval — better than normal approximation at small n or extreme p. */
export function wilsonInterval({ conversions, total, confidenceLevel = 0.95 }) {
  if (total <= 0) throw new RangeError("total must be > 0");
  const z = normalQuantile(1 - (1 - confidenceLevel) / 2);
  const p = conversions / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt(p * (1 - p) / total + (z * z) / (4 * total * total));
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

/** ICE = (Impact + Confidence + Ease) / 3, the framework already used in the docs. */
export function iceScore({ impact, confidence, ease }) {
  for (const [name, v] of Object.entries({ impact, confidence, ease })) {
    if (!Number.isFinite(v) || v < 1 || v > 10) throw new RangeError(`${name} must be within 1..10`);
  }
  return Number(((impact + confidence + ease) / 3).toFixed(2));
}
