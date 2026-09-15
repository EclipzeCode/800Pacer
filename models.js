/* =============================================================
   800m Race Strategy Simulator — models.js

   Pure computation only (no DOM access). Shared by index.html,
   training.html and dashboard.html.

   1. Input parsing & validation
   2. Prediction models  (Riegel, Critical Speed, MSS/MAS Blend, VDOT)
   3. Ensemble           (single consolidated function)
   4. Pacing             (strategy multipliers, always sums to 1)
   5. Fatigue index      (presentation heuristic — not a physics model)
   6. Simulation         (combines pacing + fatigue into segments)

   Honest labelling
   ────────────────
   • The ensemble output is a "model-based estimate", not a
     statistically validated race prediction.
   • The spread-derived uncertainty band is labelled "est. range ±Xs",
     not "95% CI", because it is not a formal confidence interval.
   • Strategy changes the shape of splits, not the total time.
   ============================================================= */

"use strict";
/* ═══════════════════════════════════════════════════════════
   1. INPUT PARSING & VALIDATION
═══════════════════════════════════════════════════════════ */

// Plausible bounds (seconds) for sanity-checking raw inputs.
const BOUNDS = {
  t400:  { min: 40,  max: 180 },  // 40s world class → 3:00 slowest plausible
  t1600: { min: 200, max: 900 },  // 3:20 → 15:00
  t800:  { min: 90,  max: 400 },  // 1:30 → 6:40
};

/**
 * Parse "m:ss(.x)" or plain-seconds string → seconds, or null.
 * Strict: rejects empty parts, negative values, and seconds ≥ 60
 * in m:ss form (so "1:70" and "1:" are no longer silently accepted).
 */
function parseTime(value) {
  if (!value || !value.trim()) return null;
  const str   = value.trim();
  const parts = str.split(":");
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[0]) || !/^\d+(\.\d+)?$/.test(parts[1])) return null;
    const m = Number(parts[0]), s = Number(parts[1]);
    if (s >= 60) return null;
    return m * 60 + s;
  }
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  return Number(str);
}

const FIELD_LABEL = { t400: "400m PR", t1600: "1600m PR", t800: "800m time" };

/**
 * Parse and range-check one time input.
 * Returns { sec, error, warn } — `sec` is null when absent or invalid.
 * `warn` flags a value that parsed but probably wasn't what the user
 * meant (e.g. "428" read as 7:08 instead of 4:28).
 */
function validateTimeInput(value, key) {
  const raw = (value ?? "").trim();
  if (!raw) return { sec: null, error: null, warn: null };
  const t = parseTime(raw);
  const { min, max } = BOUNDS[key];
  if (t == null) {
    return { sec: null, error: `Enter seconds (e.g. 52.4) or m:ss (e.g. 1:58.0).`, warn: null };
  }
  if (t < min || t > max) {
    return {
      sec: null,
      error: `${FIELD_LABEL[key]} must be between ${formatTime(min)} and ${formatTime(max)} (read as ${formatTime(t)}).`,
      warn: null,
    };
  }
  let warn = null;
  if (!raw.includes(":") && t >= 100) {
    warn = `Read as ${formatTime(t)} — use m:ss if you meant ${Math.floor(t / 100)}:${String(t % 100).padStart(2, "0")}.`;
  }
  return { sec: t, error: null, warn };
}

/** Backwards-compatible wrapper: seconds or null. */
function parseAndValidate(value, key) {
  return validateTimeInput(value, key).sec;
}

function formatTime(sec) {
  if (sec == null || isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/** Format for re-populating an input: "52.40" under a minute, else m:ss. */
function formatInput(sec) {
  if (sec == null || isNaN(sec)) return "";
  return sec < 60 ? sec.toFixed(2).replace(/\.?0+$/, "") : formatTime(sec);
}

function formatShort(sec) {
  if (sec == null || isNaN(sec)) return "—";
  return sec.toFixed(2) + "s";
}

function median(values) {
  const valid = values.filter(v => v != null && isFinite(v));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ═══════════════════════════════════════════════════════════
   2. PREDICTION MODELS
   All three return seconds or null. Formulas unchanged.
═══════════════════════════════════════════════════════════ */

/**
 * Riegel Power-Law:  T800 = T400 · (800/400)^e
 * Exponent varies by profile and sex per empirical literature.
 * Limitation: derived solely from t400; ignores aerobic capacity.
 */
function modelRiegel(t400, profile, sex) {
  if (!t400) return null;
  const base     = { speed: 1.09, balanced: 1.06, endurance: 1.03 }[profile] ?? 1.06;
  const exponent = sex === "female" ? base + 0.01 : base;
  return t400 * Math.pow(800 / 400, exponent);
}

/**
 * Critical Speed (2-point linear model):
 *   CS  = (D1 − D2) / (T1 − T2)
 *   D′  = D1 − CS·T1
 *   T800 = (800 − D′) / CS
 *
 * Requires both t400 and t1600. Returns null if CS or D′ ≤ 0.
 * Limitation: 2-point CS is a rough estimate; most valid for
 * endurance athletes with a genuine 1600m PR.
 */
function modelCriticalSpeed(t400, t1600) {
  if (!t400 || !t1600) return null;
  const CS = (400 - 1600) / (t400 - t1600);
  const Dp = 400 - CS * t400;
  if (CS <= 0 || Dp <= 0) return null;
  const T800 = (800 - Dp) / CS;
  return T800 > 0 ? T800 : null;
}

/**
 * MSS/MAS Blend (Loporto & Mannion, 2021):
 *   v800 = w·MSS + (1−w)·MAS
 *
 * When t1600 is absent, MAS is estimated from t400 via Riegel — both
 * inputs then derive from t400, so independence is reduced. This is
 * noted in the popup text.
 */
function modelMSSMAS(t400, t1600, profile, sex) {
  if (!t400) return null;
  const MSS      = 400 / t400;
  const t1600est = t1600 ?? (t400 * Math.pow(1600 / 400, 1.06));
  const MAS      = 1600 / t1600est;
  const baseW    = { speed: 0.35, balanced: 0.25, endurance: 0.15 }[profile] ?? 0.25;
  const sexAdj   = sex === "female" ? -0.03 : 0;
  const vEst     = (baseW + sexAdj) * MSS + (1 - baseW - sexAdj) * MAS;
  const tEst     = 800 / vEst;
  const tierAdj  = tEst < 160 ? 0.05 : 0;
  const w        = Math.max(0.10, Math.min(baseW + sexAdj + tierAdj, 0.40));
  return 800 / (w * MSS + (1 - w) * MAS);
}

/* ═══════════════════════════════════════════════════════════
   2B. VDOT MODEL (Jack Daniels oxygen-cost equivalent performance)

   Uses Daniels' validated VO2max/running-economy formula to estimate
   VDOT from a known race time, then binary-searches for the equivalent
   800m time at the same VDOT. Requires t1600; returns null otherwise.
   Most reliable for aerobic-dominant (balanced/endurance) athletes.
═══════════════════════════════════════════════════════════ */

function computeVdot(distM, timeSec) {
  if (!distM || !timeSec || timeSec <= 0) return null;
  const t   = timeSec / 60;
  const v   = distM / t;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t)
                  + 0.2989558 * Math.exp(-0.1932605 * t);
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  return (vo2 > 0 && pct > 0) ? vo2 / pct : null;
}

function predictFromVdot(distM, vdot) {
  if (!vdot || vdot <= 0) return null;
  let lo = distM / 14, hi = distM / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v   = computeVdot(distM, mid);
    if (v === null) return null;
    v > vdot ? lo = mid : hi = mid;
  }
  const result = (lo + hi) / 2;
  return result > 0 ? result : null;
}

function modelVdot(t1600) {
  if (!t1600) return null;
  const vdot = computeVdot(1600, t1600);
  return vdot ? predictFromVdot(800, vdot) : null;
}

/* ═══════════════════════════════════════════════════════════
   3. ENSEMBLE  (single consolidated function)

   Key design decisions
   ─────────────────────
   • Band is set by the prior 800 PR when available, else model median.
   • CS carries very low weight in Bands B–D; it is least reliable for
     non-elite athletes whose 400/1600 PRs may not reflect true CS.
   • Prior 800 PR is the strongest signal when present; its weight
     grows substantially in slower bands.
   • The "spreadRange" output is a model-disagreement measure, not a
     statistical confidence interval. It is labelled "est. range" in UI.
═══════════════════════════════════════════════════════════ */
function computeEnsemble(riegel, cs, blend, vdot, pr800, profile, sex, t400, t1600) {

  // Collect valid model predictions
  const models = {};
  if (riegel != null) models.riegel = riegel;
  if (cs     != null) models.cs     = cs;
  if (blend  != null) models.blend  = blend;
  if (vdot   != null) models.vdot   = vdot;
  if (!Object.keys(models).length) return null;

  // Performance band
  const provisional = pr800 != null ? pr800 : median(Object.values(models));
  const band =
    provisional < 120 ? "A" :
    provisional < 130 ? "B" :
    provisional < 140 ? "C" : "D";

  // Infer athlete profile from speed ratio when both distances available
  let inferredProfile = profile;
  if (t400 && t1600) {
    const ratio    = (400 / t400) / (1600 / t1600);
    // Same cut-offs as the profile dropdown labels (≥1.58 speed, ≤1.47 endurance).
    inferredProfile = ratio >= 1.58 ? "speed" : ratio <= 1.47 ? "endurance" : "balanced";
  }
  // Agreement between declared and inferred profile modulates
  // trust in profile-sensitive models (Riegel, CS).
  const isOpposite = (profile === "speed"     && inferredProfile === "endurance") ||
                     (profile === "endurance" && inferredProfile === "speed");
  const agreement  = profile === inferredProfile ? 1.0 : isOpposite ? 0.55 : 0.75;

  // Base weights by band.
  // Riegel (400m-derived) is the primary speed signal for 800m — 400m speed
  // is the strongest single predictor at this event distance.
  // Prior 800m PR dominates when present — actual race data beats model estimates.
  // VDOT and CS both require 1600m and are suppressed when speed dominance is detected.
  const BASE = {
    A: { riegel: 5.0, cs: 0.7, blend: 2.0, vdot: 1.0, prior: 10.0 },
    B: { riegel: 5.0, cs: 0.4, blend: 2.0, vdot: 1.0, prior: 14.0 },
    C: { riegel: 4.0, cs: 0.3, blend: 2.2, vdot: 1.2, prior: 15.0 },
    D: { riegel: 2.5, cs: 0.2, blend: 2.5, vdot: 0.8, prior: 16.0 },
  };
  const bw = { ...BASE[band] };

  // Profile-based weight adjustments
  if (profile === "speed") {
    bw.riegel *= 1.35;
    bw.blend  *= 1.05;
    bw.cs     *= 0.30;  // CS least valid for sprinters
    bw.vdot   *= 0.50;  // VDOT calibrated on aerobic athletes; least reliable for sprinters
  } else if (profile === "endurance") {
    bw.cs     *= 0.75;  // CS most valid here, still limited for non-elites
    bw.blend  *= 1.10;
    bw.riegel *= 0.85;
    bw.vdot   *= 1.30;  // VDOT most reliable for true aerobic athletes
  } else {              // balanced / 800m specialist
    bw.blend  *= 1.10;
    bw.riegel *= 1.10;
    bw.cs     *= 0.50;
    bw.vdot   *= 0.90;
  }

  // Speed-dominance correction: when the 400m-based Riegel model predicts
  // significantly faster than aerobic models (VDOT/CS), the athlete's 1600m
  // likely underrepresents their 800m ceiling. Suppress aerobic models heavily.
  if (models.riegel != null) {
    if (models.vdot != null && models.riegel < models.vdot - 5) {
      const suppression = Math.min(0.70, 0.25 + (models.vdot - models.riegel - 5) * 0.03);
      bw.vdot *= (1 - suppression);
    }
    if (models.cs != null && models.riegel < models.cs - 5) {
      const suppression = Math.min(0.70, 0.25 + (models.cs - models.riegel - 5) * 0.03);
      bw.cs *= (1 - suppression);
    }
  }

  // Agreement modifier — Blend and VDOT are less sensitive to declared profile,
  // keeping them as stabilisers even when profile is mis-declared.
  if (models.riegel != null) bw.riegel *= agreement;
  if (models.cs     != null) bw.cs     *= agreement;
  bw.blend *= (0.90 + agreement * 0.10);
  if (models.vdot   != null) bw.vdot   *= (0.92 + agreement * 0.08);

  // Outlier penalty — models far from group median are down-weighted.
  const modelVals = Object.values(models);
  const center    = median(modelVals);

  function outlierPenalty(val, w) {
    const d = Math.abs(val - center);
    if (d > 8) return w * 0.40;
    if (d > 5) return w * 0.65;
    if (d > 3) return w * 0.85;
    return w;
  }
  if (models.riegel != null) bw.riegel = outlierPenalty(models.riegel, bw.riegel);
  if (models.cs     != null) bw.cs     = outlierPenalty(models.cs,     bw.cs);
  if (models.blend  != null) bw.blend  = outlierPenalty(models.blend,  bw.blend);
  if (models.vdot   != null) bw.vdot   = outlierPenalty(models.vdot,   bw.vdot);

  // CS stability — if CS diverges heavily from Blend, treat as unstable.
  if (models.cs != null && models.blend != null) {
    if (Math.abs(models.cs - models.blend) > 7) bw.cs *= 0.60;
  }

  // Riegel optimism penalty for slow bands.
  // Band C threshold is looser (6s) because Riegel is intentionally
  // weighted higher there to correct systematic under-prediction.
  if (band === "D" && models.riegel != null && models.blend != null) {
    if (models.riegel < models.blend - 4) bw.riegel *= 0.65;
  }
  if (band === "C" && models.riegel != null && models.blend != null) {
    if (models.riegel < models.blend - 6) bw.riegel *= 0.65;
  }

  // Blend boost when models disagree significantly.
  if (modelVals.length > 1) {
    const spread = Math.max(...modelVals) - Math.min(...modelVals);
    if      (spread > 9) bw.blend *= 1.40;
    else if (spread > 6) bw.blend *= 1.25;
  }

  // Prior 800 PR — coherence check + corroboration boost.
  // Actual race data is the strongest possible signal; only discount heavily
  // when the PR is implausibly far from every model (likely a data entry error).
  let priorW = null;
  if (pr800 != null) {
    priorW = bw.prior;
    const pd = Math.abs(pr800 - center);
    if      (pd > 20) priorW *= 0.45;  // implausibly far from all models
    else if (pd > 12) priorW *= 0.70;  // large gap — possible stale/different-conditions PR
    else if (pd <  2) priorW *= 1.30;  // near-perfect corroboration
    else if (pd <  5) priorW *= 1.15;  // good corroboration
  }

  // Assemble entries and normalise
  const entries = [];
  if (models.riegel != null) entries.push({ val: models.riegel, w: bw.riegel, name: "riegel" });
  if (models.cs     != null) entries.push({ val: models.cs,     w: bw.cs,     name: "cs"     });
  if (models.blend  != null) entries.push({ val: models.blend,  w: bw.blend,  name: "blend"  });
  if (models.vdot   != null) entries.push({ val: models.vdot,   w: bw.vdot,   name: "vdot"   });
  if (pr800 != null && priorW != null) entries.push({ val: pr800, w: priorW,   name: "prior"  });

  const totalW = entries.reduce((s, e) => s + e.w, 0);
  let mean     = entries.reduce((s, e) => s + e.val * (e.w / totalW), 0);

  // Median stabilisation for Band D only.
  if (band === "D") {
    const med = median(entries.map(e => e.val));
    mean = mean * 0.85 + med * 0.15;
  }

  // Spread-based uncertainty range (model disagreement, not a CI).
  // Floor rises when fewer models are active — less evidence → wider uncertainty.
  const nModels     = entries.filter(e => e.name !== "prior").length;
  const variance    = entries.reduce((s, e) => s + (e.w / totalW) * Math.pow(e.val - mean, 2), 0);
  let spreadRange   = Math.max(Math.sqrt(variance) * 1.2, nModels < 3 ? 2.5 : 1.5);
  spreadRange      *= { A: 0.95, B: 0.90, C: 0.80, D: 0.75 }[band];
  if (pr800 != null) {
    spreadRange *= 0.80;
    if (Math.abs(mean - pr800) < 3) spreadRange *= 0.70;
  }
  spreadRange = Math.max(1.5, Math.min(8.0, spreadRange));

  const weightMap = {};
  entries.forEach(e => { weightMap[e.name] = e.w / totalW; });

  return { mean, spreadRange, weightMap, band };
}

/* ═══════════════════════════════════════════════════════════
   4. PACING — STRATEGY MULTIPLIERS
   Always normalised so splits sum to the predicted total.
   Strategy reshapes splits; it does not change the total time.
═══════════════════════════════════════════════════════════ */
function getStrategyMultipliers(strategy, profile) {
  const n     = 8;
  const swing = { speed: 1.0, balanced: 0.78, endurance: 0.60 }[profile] ?? 0.78;
  let raw     = new Array(n).fill(1.0);

  switch (strategy) {
    case "even":
      raw = raw.map((_, i) => 1 + (i / (n - 1)) * 0.012 * swing);
      break;
    case "negative":
      raw = raw.map((_, i) => 1 + 0.04 * swing * (0.5 - i / (n - 1)));
      break;
    case "frontLoaded":
      raw = raw.map((_, i) => {
        const p = i / (n - 1);
        return i < 2
          ? 1 - 0.055 * swing
          : 1 + 0.028 * swing * Math.pow((p - 0.25) / 0.75, 1.8);
      });
      break;
    case "sitAndKick":
      raw = raw.map((_, i) =>
        i < 6
          ? 1 + 0.022 * swing
          : 1 + 0.022 * swing - 0.075 * swing * (i - 6)
      );
      break;
  }

  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(m => (m * n) / sum);
}

/* ═══════════════════════════════════════════════════════════
   5. FATIGUE INDEX
   This is a presentation heuristic, not a validated physiology
   model. It generates a plausible-looking fatigue curve that
   is rescaled to hit target end-values by profile/strategy.
   The output is a visual aid; treat it as indicative only.
═══════════════════════════════════════════════════════════ */
function computeFatigue(splits, goalSec, profile, strategy, weightMap) {
  const n             = splits.length;
  const profileFactor = { speed: 1.18, balanced: 1.0, endurance: 0.84 }[profile] ?? 1.0;
  const strategyCurve = { even: 1.7, negative: 1.9, frontLoaded: 1.3, sitAndKick: 2.1 }[strategy] ?? 1.7;

  // Ensemble composition slightly modulates curve shape.
  const csW      = weightMap?.cs     ?? 0;
  const riegelW  = weightMap?.riegel ?? 0;
  const blendW   = weightMap?.blend  ?? 0;
  const mod      = 1 + (csW - riegelW * 0.5 - blendW * 0.3) * 0.4;
  const curveExp = strategyCurve * mod * (1 / profileFactor);
  const threshold = goalSec / 8 / 1.08;

  const raw = splits.map((split, i) => {
    const progress = (i + 1) / n;
    const base     = Math.pow(progress, curveExp) * 100;
    const above    = Math.max(0, (threshold - split) / threshold);
    return base + above * 45 * profileFactor;
  });

  // Rescale to plausible end-fatigue targets (heuristic values).
  const targetMap = {
    speed:     { even: 93, negative: 88, frontLoaded: 99, sitAndKick: 91 },
    balanced:  { even: 88, negative: 85, frontLoaded: 97, sitAndKick: 87 },
    endurance: { even: 84, negative: 82, frontLoaded: 93, sitAndKick: 83 },
  };
  const target = (targetMap[profile] ?? targetMap.balanced)[strategy] ?? 88;
  const scale  = target / raw[n - 1];
  return raw.map(v => Math.min(+(v * scale).toFixed(1), 100));
}

/* ═══════════════════════════════════════════════════════════
   6. CORE SIMULATION
═══════════════════════════════════════════════════════════ */
function simulateRace(goalSec, strategy, profile, weightMap) {
  const n         = 8;
  const baseSplit = goalSec / n;
  const mults     = getStrategyMultipliers(strategy, profile);
  const splits    = mults.map(m => baseSplit * m);
  const fatigues  = computeFatigue(splits, goalSec, profile, strategy, weightMap);
  let elapsed     = 0;

  return splits.map((split, i) => {
    elapsed += split;
    const globalProg   = (i + 1) / n;
    const ovalProgress = (globalProg * 2) % 1 || (i === n - 1 ? 0.9999 : 0.0001);
    return {
      dist:           (i + 1) * 100,
      lap:            i < 4 ? 1 : 2,
      segmentSeconds: split,
      elapsed,
      fatigue:        fatigues[i],
      ovalProgress,
      globalProgress: globalProg,
    };
  });
}
