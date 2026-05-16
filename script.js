/* =============================================================
   800m Race Strategy Simulator — script.js

   Architecture
   ────────────
   1. Input parsing & validation
   2. Prediction models  (Riegel, Critical Speed, MSS/MAS Blend)
   3. Ensemble           (single consolidated function)
   4. Pacing             (strategy multipliers, always sums to 1)
   5. Fatigue index      (presentation heuristic — not a physics model)
   6. Simulation         (combines pacing + fatigue into segments)
   7. Rendering          (graph, table, track, replay)
   8. UI glue            (DOM refs, events, modals)

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
   DOM REFS
═══════════════════════════════════════════════════════════ */
const form             = document.getElementById("simForm");
const pr400Input       = document.getElementById("pr400");
const pr1600Input      = document.getElementById("pr1600");
const pr800Input       = document.getElementById("pr800");
const strategyInput    = document.getElementById("strategy");
const profileInput     = document.getElementById("profile");

const elapsedMetric    = document.getElementById("elapsedMetric");
const projectionMetric = document.getElementById("projectionMetric");
const fatigueMetric    = document.getElementById("fatigueMetric");
const lapMetric        = document.getElementById("lapMetric");

const heroPredicted    = document.getElementById("heroPredicted");
const heroInsight      = document.getElementById("heroInsight");

const lap1Time         = document.getElementById("lap1Time");
const lap2Time         = document.getElementById("lap2Time");
const splitRatio       = document.getElementById("splitRatio");

const riegelVal        = document.getElementById("riegelVal");
const csVal            = document.getElementById("csVal");
const blendVal         = document.getElementById("blendVal");
const vdotVal          = document.getElementById("vdotVal");
const ensembleVal      = document.getElementById("ensembleVal");
const ensembleCI       = document.getElementById("ensembleCI");

const splitTableBody   = document.getElementById("splitTableBody");
const fatigueLine      = document.getElementById("fatigueLine");
const fatigueArea      = document.getElementById("fatigueArea");
const paceLine         = document.getElementById("paceLine");
const paceArea         = document.getElementById("paceArea");
const graphPoints      = document.getElementById("graphPoints");
const graphGrid        = document.getElementById("graphGrid");
const graphLabels      = document.getElementById("graphLabels");
const lapDivider       = document.getElementById("lapDivider");

const trackPath        = document.getElementById("trackPath");
const splitMarkers     = document.getElementById("splitMarkers");
const runnerDot        = document.getElementById("runnerDot");
const runnerPulse      = document.getElementById("runnerPulse");
const replayBtn        = document.getElementById("replayButton");
const runnerPrice      = document.getElementById("runnerPrice");
const coachPrice       = document.getElementById("coachPrice");
const runnerCta        = document.getElementById("runnerCta");
const coachCta         = document.getElementById("coachCta");
const teamCta          = document.getElementById("teamCta");
const offerHeadline    = document.getElementById("offerHeadline");
const offerSummary     = document.getElementById("offerSummary");
const pricingNote      = document.getElementById("pricingNote");

let simulationState = null;
let replayTimers    = [];

const MONETIZATION_CONFIG = {
  contactEmail: "you@example.com",
  runnerPro: {
    name: "Runner Pro",
    price: "$12/mo",
    checkoutUrl: "",
    buttonLabel: "Join Pro Waitlist",
    subject: "Runner Pro early access",
  },
  coachPack: {
    name: "Coach Pack",
    price: "$49/mo",
    checkoutUrl: "",
    buttonLabel: "Coach Pack",
    subject: "Coach Pack demo request",
  },
  teamLicensing: {
    name: "Team Licensing",
    price: "Custom",
    inquiryUrl: "",
    buttonLabel: "Team Licensing",
    subject: "Team licensing inquiry",
  },
};

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
 * Parse "m:ss" or plain-seconds string → seconds, or null.
 */
function parseTime(value) {
  if (!value || !value.trim()) return null;
  const str   = value.trim();
  const parts = str.split(":");
  const t     = parts.length === 2
    ? Number(parts[0]) * 60 + Number(parts[1])
    : Number(str);
  return isNaN(t) ? null : t;
}

/**
 * Parse and range-check one time input.
 * Returns seconds if valid, null if absent or implausible.
 */
function parseAndValidate(value, key) {
  const t = parseTime(value);
  if (t == null) return null;
  const { min, max } = BOUNDS[key];
  if (t < min || t > max) {
    console.warn(`[Simulator] ${key} = ${t}s is outside plausible range [${min}, ${max}]. Ignoring.`);
    return null;
  }
  return t;
}

function formatTime(sec) {
  if (sec == null || isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
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
    inferredProfile = ratio > 1.55 ? "speed" : ratio < 1.45 ? "endurance" : "balanced";
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

/* ═══════════════════════════════════════════════════════════
   7A. GRAPH RENDERING
═══════════════════════════════════════════════════════════ */
function renderGraph(segments, goalSec) {
  const W = 520, H = 200, PX = 36, PY = 18;
  const usableW = W - PX * 2;
  const usableH = H - PY * 2;

  graphGrid.innerHTML = "";
  [25, 50, 75, 100].forEach(pct => {
    const y    = PY + usableH - (pct / 100) * usableH;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", PX); line.setAttribute("x2", W - PX);
    line.setAttribute("y1", y);  line.setAttribute("y2", y);
    line.setAttribute("class", "graph-grid-line");
    graphGrid.appendChild(line);
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", PX - 4); lbl.setAttribute("y", y + 4);
    lbl.setAttribute("text-anchor", "end"); lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(74,82,102,0.6)");
    lbl.textContent = pct + "%";
    graphGrid.appendChild(lbl);
  });

  const lapX = PX + usableW * 0.5;
  lapDivider.setAttribute("x1", lapX); lapDivider.setAttribute("x2", lapX);
  lapDivider.setAttribute("y1", PY);   lapDivider.setAttribute("y2", H - PY);

  graphLabels.innerHTML = "";
  segments.forEach((s, i) => {
    const x   = PX + usableW * ((i + 1) / segments.length);
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", x); lbl.setAttribute("y", H - 3);
    lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(74,82,102,0.55)");
    lbl.textContent = s.dist + "m";
    graphLabels.appendChild(lbl);
  });
  ["Lap 1", "Lap 2"].forEach((txt, li) => {
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", PX + usableW * (0.25 + li * 0.5)); lbl.setAttribute("y", PY + 10);
    lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(74,82,102,0.35)");
    lbl.textContent = txt;
    graphLabels.appendChild(lbl);
  });

  graphPoints.innerHTML = "";
  const fPts = segments.map((s, i) => ({
    x: PX + usableW * ((i + 1) / segments.length),
    y: PY + usableH - (s.fatigue / 100) * usableH,
  }));
  const fLine = fPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  fatigueLine.setAttribute("d", fLine);
  fatigueArea.setAttribute("d", fLine + ` L ${fPts[fPts.length - 1].x.toFixed(1)} ${H - PY} L ${fPts[0].x.toFixed(1)} ${H - PY} Z`);

  const maxSplit = Math.max(...segments.map(s => s.segmentSeconds));
  const minSplit = Math.min(...segments.map(s => s.segmentSeconds));
  const range    = Math.max(maxSplit - minSplit, 0.3);
  const pPts     = segments.map((s, i) => ({
    x: PX + usableW * ((i + 1) / segments.length),
    y: PY + usableH - ((s.segmentSeconds - minSplit) / range) * usableH * 0.75 - usableH * 0.1,
  }));
  const pLine = pPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  paceLine.setAttribute("d", pLine);
  paceArea.setAttribute("d", pLine + ` L ${pPts[pPts.length - 1].x.toFixed(1)} ${H - PY} L ${pPts[0].x.toFixed(1)} ${H - PY} Z`);

  fPts.forEach((p, i) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", p.x.toFixed(1)); c.setAttribute("cy", p.y.toFixed(1));
    c.setAttribute("r", "3.5"); c.setAttribute("class", "graph-point");
    c.dataset.index = i;
    graphPoints.appendChild(c);
  });
}

/* ═══════════════════════════════════════════════════════════
   7B. TABLE
═══════════════════════════════════════════════════════════ */
function renderTable(segments) {
  splitTableBody.innerHTML = "";
  const avgSplit = segments.reduce((s, seg) => s + seg.segmentSeconds, 0) / segments.length;
  segments.forEach((s, i) => {
    const diff    = s.segmentSeconds - avgSplit;
    const diffStr = (diff >= 0 ? "+" : "") + diff.toFixed(2) + "s";
    const colour  = diff < -0.25 ? "color:#3b6fe8" : diff > 0.25 ? "color:#d97706" : "";
    const row     = document.createElement("tr");
    if (i === 3) row.classList.add("lap-boundary");
    row.innerHTML = `
      <td>${s.dist}m</td>
      <td>Lap ${s.lap}</td>
      <td style="${colour}">${formatShort(s.segmentSeconds)}</td>
      <td>${formatTime(s.elapsed)}</td>
      <td style="${colour}">${diffStr}</td>
      <td>${s.fatigue}%</td>
    `;
    splitTableBody.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════════
   7C. SPLIT MARKERS ON TRACK
═══════════════════════════════════════════════════════════ */
function renderSplitMarkers(segments) {
  splitMarkers.innerHTML = "";
  const len      = trackPath.getTotalLength();
  const cx = 380, cy = 160;
  const lap1Segs = segments.filter(s => s.lap === 1);

  lap1Segs.forEach((seg, i) => {
    const pt = trackPath.getPointAtLength(len * seg.ovalProgress);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${pt.x.toFixed(2)},${pt.y.toFixed(2)})`);
    g.setAttribute("class", "marker-group");
    g.dataset.posIndex = i;

    const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pulse.setAttribute("cx", "0"); pulse.setAttribute("cy", "0"); pulse.setAttribute("r", "6");
    pulse.setAttribute("fill", "none"); pulse.setAttribute("stroke", "rgba(200,80,20,0.20)");
    pulse.setAttribute("stroke-width", "1.5"); pulse.setAttribute("class", "split-pulse");
    const animR = document.createElementNS("http://www.w3.org/2000/svg", "animate");
    animR.setAttribute("attributeName", "r"); animR.setAttribute("from", "6"); animR.setAttribute("to", "20");
    animR.setAttribute("dur", "2s"); animR.setAttribute("repeatCount", "indefinite");
    animR.setAttribute("begin", `${(i * 0.25).toFixed(2)}s`);
    pulse.appendChild(animR);
    const animO = document.createElementNS("http://www.w3.org/2000/svg", "animate");
    animO.setAttribute("attributeName", "opacity"); animO.setAttribute("from", "0.5"); animO.setAttribute("to", "0");
    animO.setAttribute("dur", "2s"); animO.setAttribute("repeatCount", "indefinite");
    animO.setAttribute("begin", `${(i * 0.25).toFixed(2)}s`);
    pulse.appendChild(animO);
    g.appendChild(pulse);

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", "0"); dot.setAttribute("cy", "0"); dot.setAttribute("r", "5");
    dot.setAttribute("fill", "rgba(180,70,10,0.35)"); dot.setAttribute("stroke", "#c94a10");
    dot.setAttribute("stroke-width", "1.5"); dot.setAttribute("class", "split-marker");
    g.appendChild(dot);

    const dx  = pt.x - cx, dy = pt.y - cy;
    const d   = Math.sqrt(dx * dx + dy * dy) || 1;
    const lox = +((dx / d) * 24).toFixed(1);
    const loy = +((dy / d) * 24 + 4).toFixed(1);

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", (lox - 14).toFixed(1)); bg.setAttribute("y", (loy - 9).toFixed(1));
    bg.setAttribute("width", "28"); bg.setAttribute("height", "11"); bg.setAttribute("rx", "3");
    bg.setAttribute("fill", "rgba(255,250,245,0.88)"); bg.setAttribute("class", "marker-bg");
    g.appendChild(bg);

    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", lox); lbl.setAttribute("y", loy);
    lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("font-size", "8.5");
    lbl.setAttribute("fill", "rgba(120,50,10,0.92)");
    lbl.setAttribute("font-family", "Bahnschrift,sans-serif"); lbl.setAttribute("font-weight", "700");
    lbl.setAttribute("class", "split-label");
    lbl.textContent = seg.dist + "m";
    g.appendChild(lbl);

    splitMarkers.appendChild(g);
  });
}

/* ── Highlight active marker ────────────────────────────── */
function highlightMarker(segIndex) {
  if (!simulationState) return;
  const seg      = simulationState[segIndex];
  const posIndex = seg.lap === 1 ? segIndex : segIndex - 4;
  const isLap2   = seg.lap === 2;

  document.querySelectorAll(".marker-group").forEach(g => {
    const pi    = Number(g.dataset.posIndex);
    const dot   = g.querySelector(".split-marker");
    const lbl   = g.querySelector(".split-label");
    const pulse = g.querySelector(".split-pulse");

    if (pi === posIndex) {
      const activeColor = isLap2 ? "#c9820a" : "#c94a10";
      const activeRing  = isLap2 ? "rgba(200,130,10,0.25)" : "rgba(200,74,16,0.25)";
      dot.setAttribute("fill", activeColor); dot.setAttribute("stroke", activeColor);
      dot.setAttribute("r", "7"); dot.setAttribute("stroke-width", "2.5");
      pulse.setAttribute("stroke", activeRing);
      const newText  = seg.dist + "m";
      const newColor = isLap2 ? "rgba(100,60,5,0.90)" : "rgba(120,50,10,0.92)";
      if (lbl && lbl.textContent !== newText) {
        lbl.style.opacity = "0";
        setTimeout(() => { lbl.textContent = newText; lbl.setAttribute("fill", newColor); lbl.style.opacity = "1"; }, 150);
      } else if (lbl) { lbl.setAttribute("fill", newColor); }
    } else {
      const thisPosSegIndex = isLap2 ? pi + 4 : pi;
      const passed          = thisPosSegIndex < segIndex;
      dot.setAttribute("r", "5"); dot.setAttribute("stroke-width", "1.5");

      if (isLap2 && passed) {
        dot.setAttribute("fill", "rgba(180,120,10,0.30)"); dot.setAttribute("stroke", "#c9820a");
        const newText = simulationState[pi + 4]?.dist + "m";
        if (lbl && newText && lbl.textContent !== newText) {
          lbl.style.opacity = "0";
          setTimeout(() => { lbl.textContent = newText; lbl.setAttribute("fill", "rgba(100,60,5,0.80)"); lbl.style.opacity = "1"; }, 150);
        } else if (lbl) { lbl.setAttribute("fill", "rgba(100,60,5,0.80)"); }
        if (pulse) pulse.setAttribute("stroke", "rgba(200,130,10,0.12)");
      } else {
        dot.setAttribute("fill", "rgba(180,70,10,0.30)"); dot.setAttribute("stroke", "#c94a10");
        const baseIndex = isLap2 ? pi + 4 : pi;
        const newText   = simulationState[baseIndex]?.dist + "m";
        if (lbl && newText && lbl.textContent !== newText) {
          lbl.style.opacity = "0";
          setTimeout(() => { lbl.textContent = newText; lbl.setAttribute("fill", "rgba(120,50,10,0.80)"); lbl.style.opacity = "1"; }, 150);
        } else if (lbl) { lbl.setAttribute("fill", "rgba(120,50,10,0.80)"); }
        if (pulse) pulse.setAttribute("stroke", "rgba(200,80,20,0.12)");
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   7D. RUNNER ANIMATION
═══════════════════════════════════════════════════════════ */
let runnerRafId = null;

function placeRunner(prog) {
  const len = trackPath.getTotalLength();
  const pt  = trackPath.getPointAtLength(len * Math.min(Math.max(prog, 0), 0.9999));
  runnerDot.setAttribute("cx",   pt.x); runnerDot.setAttribute("cy",   pt.y);
  runnerPulse.setAttribute("cx", pt.x); runnerPulse.setAttribute("cy", pt.y);
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

function animateRunnerTo(fromProg, toProg, durationMs, onDone) {
  if (runnerRafId) cancelAnimationFrame(runnerRafId);
  const start = performance.now();
  function frame(now) {
    const raw  = Math.min((now - start) / durationMs, 1);
    const prog = fromProg + (toProg - fromProg) * easeInOut(raw);
    placeRunner(prog);
    if (raw < 1) { runnerRafId = requestAnimationFrame(frame); }
    else { runnerRafId = null; if (onDone) onDone(); }
  }
  runnerRafId = requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════════════════════
   7E. SMOOTH COUNTER ANIMATIONS
═══════════════════════════════════════════════════════════ */
function animateValue(from, to, durationMs, onFrame, easing) {
  const easeFn    = easing || (t => t);
  const startTime = performance.now();
  let rafId;
  function tick(now) {
    const raw = Math.min((now - startTime) / durationMs, 1);
    onFrame(from + (to - from) * easeFn(raw));
    if (raw < 1) { rafId = requestAnimationFrame(tick); } else { onFrame(to); }
  }
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

let cancelCounters = [];

/* ═══════════════════════════════════════════════════════════
   7F. REPLAY
═══════════════════════════════════════════════════════════ */
function clearReplay() {
  replayTimers.forEach(clearTimeout);
  replayTimers = [];
  if (runnerRafId) { cancelAnimationFrame(runnerRafId); runnerRafId = null; }
  cancelCounters.forEach(fn => fn());
  cancelCounters = [];
}

function startReplay() {
  if (!simulationState) return;
  clearReplay();
  placeRunner(0.001);

  document.querySelectorAll(".marker-group").forEach(g => {
    const pi    = Number(g.dataset.posIndex);
    const lbl   = g.querySelector(".split-label");
    const dot   = g.querySelector(".split-marker");
    const pulse = g.querySelector(".split-pulse");
    if (lbl && simulationState[pi]) lbl.textContent = simulationState[pi].dist + "m";
    if (lbl)   lbl.setAttribute("fill", "rgba(120,50,10,0.80)");
    if (dot)   { dot.setAttribute("fill", "rgba(180,70,10,0.30)"); dot.setAttribute("stroke", "#c94a10"); dot.setAttribute("r", "5"); dot.setAttribute("stroke-width", "1.5"); }
    if (pulse) pulse.setAttribute("stroke", "rgba(200,80,20,0.12)");
  });

  elapsedMetric.textContent    = formatTime(0);
  fatigueMetric.textContent    = "0%";
  lapMetric.textContent        = "Lap 1";
  projectionMetric.textContent = formatTime(simulationState[simulationState.length - 1].elapsed);

  const segDuration = 700;

  simulationState.forEach((seg, i) => {
    const prevSeg     = simulationState[i - 1] ?? null;
    const prevProg    = prevSeg ? prevSeg.ovalProgress : 0.001;
    const thisProg    = seg.ovalProgress;
    const fromElapsed = prevSeg ? prevSeg.elapsed : 0;
    const fromFatigue = prevSeg ? prevSeg.fatigue : 0;

    const id = setTimeout(() => {
      lapMetric.textContent = `Lap ${seg.lap}`;
      highlightMarker(i);
      document.querySelectorAll("#splitTableBody tr").forEach((r, ri) => {
        r.classList.toggle("active-row", ri === i);
      });

      cancelCounters.push(animateValue(fromElapsed, seg.elapsed, segDuration * 0.88,
        val => { elapsedMetric.textContent = formatTime(val); }));

      cancelCounters.push(animateValue(fromFatigue, seg.fatigue, segDuration * 0.88,
        val => { fatigueMetric.textContent = Math.round(val) + "%"; },
        t => 1 - Math.pow(1 - t, 2)));

      const isWrap = thisProg < prevProg;
      if (isWrap) {
        const totalDist = (0.9999 - prevProg) + thisProg;
        const p1Frac    = totalDist > 0 ? (0.9999 - prevProg) / totalDist : 0.5;
        const dur       = segDuration * 0.9;
        animateRunnerTo(prevProg, 0.9999, dur * p1Frac, () => {
          animateRunnerTo(0.0001, thisProg, dur * (1 - p1Frac));
        });
      } else {
        animateRunnerTo(prevProg, thisProg, segDuration * 0.9);
      }
    }, i * segDuration + 150);

    replayTimers.push(id);
  });
}

/* ── Lap pills ──────────────────────────────────────────── */
function updateLapPills(segments) {
  const l1 = segments.filter(s => s.lap === 1).reduce((s, x) => s + x.segmentSeconds, 0);
  const l2 = segments.filter(s => s.lap === 2).reduce((s, x) => s + x.segmentSeconds, 0);
  lap1Time.textContent   = formatTime(l1);
  lap2Time.textContent   = formatTime(l2);
  splitRatio.textContent = (l2 / l1).toFixed(3);
}

/* ── Model tiles ────────────────────────────────────────── */
function updateModelTiles(riegel, cs, blend, vdot, ens) {
  riegelVal.textContent = riegel != null ? formatTime(riegel) : "N/A";
  csVal.textContent     = cs     != null ? formatTime(cs)     : "—";
  blendVal.textContent  = blend  != null ? formatTime(blend)  : "N/A";
  if (vdotVal) vdotVal.textContent = vdot != null ? formatTime(vdot) : "—";
  if (ens) {
    ensembleVal.textContent = formatTime(ens.mean);
    ensembleCI.textContent  = `±${ens.spreadRange.toFixed(1)}s`;
  }
}

/* ── Monetization helpers ──────────────────────────────── */
function hasConfiguredUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function hasRealContactEmail(value) {
  return typeof value === "string"
    && !!value.trim()
    && !/@example\.com$/i.test(value.trim());
}

function setPlanContent() {
  if (runnerPrice) runnerPrice.textContent = MONETIZATION_CONFIG.runnerPro.price;
  if (coachPrice)  coachPrice.textContent  = MONETIZATION_CONFIG.coachPack.price;
  if (runnerCta)   runnerCta.textContent   = MONETIZATION_CONFIG.runnerPro.buttonLabel;
  if (coachCta)    coachCta.textContent    = MONETIZATION_CONFIG.coachPack.buttonLabel;
  if (teamCta)     teamCta.textContent     = MONETIZATION_CONFIG.teamLicensing.buttonLabel;
}

function updatePricingNote() {
  if (!pricingNote) return;

  const linksLive = [
    MONETIZATION_CONFIG.runnerPro.checkoutUrl,
    MONETIZATION_CONFIG.coachPack.checkoutUrl,
    MONETIZATION_CONFIG.teamLicensing.inquiryUrl,
  ].filter(hasConfiguredUrl).length;

  if (linksLive === 3) {
    pricingNote.textContent = "Checkout and inquiry links are live.";
    return;
  }

  if (hasRealContactEmail(MONETIZATION_CONFIG.contactEmail)) {
    pricingNote.innerHTML = `Email fallback is active at <a href="mailto:${MONETIZATION_CONFIG.contactEmail}">${MONETIZATION_CONFIG.contactEmail}</a> until checkout links are live.`;
    return;
  }

  pricingNote.textContent = "Replace the placeholder email and add checkout links in script.js before sending paid traffic here.";
}

function buildWaitlistBody(planName) {
  return [
    `Hi, I'm interested in ${planName}.`,
    "",
    "What I want to use it for:",
    "- Athlete self-serve",
    "- Coach workflow",
    "- Team or club licensing",
    "",
    "Biggest feature I want next:",
    "- Saved history",
    "- Strategy comparisons",
    "- Reports / exports",
    "- Team roster tools",
  ].join("\n");
}

function openCheckoutOrContact(planKey) {
  const plan = MONETIZATION_CONFIG[planKey];
  if (!plan) return;

  const targetUrl = plan.checkoutUrl || plan.inquiryUrl;
  if (hasConfiguredUrl(targetUrl)) {
    window.open(targetUrl, "_blank", "noopener");
    return;
  }

  if (hasRealContactEmail(MONETIZATION_CONFIG.contactEmail)) {
    const subject = encodeURIComponent(plan.subject || `${plan.name} inquiry`);
    const body    = encodeURIComponent(buildWaitlistBody(plan.name));
    window.location.href = `mailto:${MONETIZATION_CONFIG.contactEmail}?subject=${subject}&body=${body}`;
    return;
  }

  openInfoModal({
    title: `${plan.name} setup`,
    body: `
      <p>Add a real contact email and a checkout or inquiry URL in <strong>script.js</strong> to activate this CTA.</p>
      <ul>
        <li><strong>Runner Pro / Coach Pack</strong> — add a Stripe Payment Link to <em>checkoutUrl</em>.</li>
        <li><strong>Team Licensing</strong> — add a Calendly, Typeform, or sales page URL to <em>inquiryUrl</em>.</li>
      </ul>
      <p>Until then, this page is ready for waitlist-style monetization once those placeholders are replaced.</p>
    `,
  });
}

function getOfferCopy({ predictedTime, t1600, t800, strategy }) {
  const projection = formatTime(predictedTime);
  const strategyLabel = {
    even: "even-split",
    negative: "negative-split",
    frontLoaded: "front-loaded",
    sitAndKick: "sit-and-kick",
  }[strategy] ?? "race-plan";

  if (!t800) {
    return {
      headline: "Unlock Runner Pro",
      summary: `Save this ${projection} projection, log your actual 800m races, and calibrate future plans from real outcomes instead of one-time estimates.`,
    };
  }

  if (!t1600) {
    return {
      headline: "Unlock Runner Pro",
      summary: `Add aerobic benchmarks, compare each strategy around ${projection}, and export a pacing card instead of rebuilding this forecast from scratch.`,
    };
  }

  return {
    headline: "Unlock Runner Pro",
    summary: `Save this ${strategyLabel} setup, compare it against the other three race shapes, and build a season-long library of pacing plans around ${projection}.`,
  };
}

function updateOfferCopy(context) {
  if (!offerHeadline || !offerSummary) return;
  const copy = getOfferCopy(context);
  offerHeadline.textContent = copy.headline;
  offerSummary.textContent  = copy.summary;
}

/* ═══════════════════════════════════════════════════════════
   8A. MODEL INFO POPUPS
═══════════════════════════════════════════════════════════ */
const MODEL_INFO = {
  riegel: {
    title:   "Riegel Power-Law",
    formula: "T₈₀₀ = T₄₀₀ · (800 ÷ 400) ^ e",
    body: `Developed by Pete Riegel in 1977, this formula assumes that as race distance doubles, time increases by a predictable factor driven by fatigue accumulation over longer efforts.

The exponent <em>e</em> is adjusted by profile:
<ul>
  <li><strong>Sprinter (e = 1.09)</strong> — sprint speed transfers less cleanly to 800m, predicting a larger slowdown.</li>
  <li><strong>Specialist (e = 1.06)</strong> — empirical average across all 800m runners.</li>
  <li><strong>Miler (e = 1.03)</strong> — aerobic base reduces the penalty at distance.</li>
</ul>
For female athletes the exponent is nudged +0.01 based on available literature.

<strong>Limitation:</strong> Riegel uses only your 400m PR. It has no information about aerobic capacity and can be optimistic for athletes with limited aerobic development.`,
  },
  cs: {
    title:   "Critical Speed Model",
    formula: "CS = (D₁ − D₂) ÷ (T₁ − T₂) · · · T₈₀₀ = (800 − D′) ÷ CS",
    body: `This model estimates two physiological parameters from your 400m and 1600m PRs:
<ul>
  <li><strong>Critical Speed (CS)</strong> — the fastest pace you can sustain aerobically without accumulating fatigue.</li>
  <li><strong>Anaerobic Reserve (D′)</strong> — a fixed energy buffer above CS that depletes at high intensity.</li>
</ul>
Your 800m time is estimated as the duration required to cover 800m exhausting D′ while running at CS.

<strong>Limitation:</strong> Fitting CS from just two data points is a rough approximation. It is most reliable for endurance athletes with a genuine 1600m PR. For sprinters and specialists this model receives very low ensemble weight because the 400/1600 inputs may not cleanly reflect true CS physiology. Not available without a 1600m PR.`,
  },
  blend: {
    title:   "MSS / MAS Blend",
    formula: "v₈₀₀ = w · MSS + (1 − w) · MAS",
    body: `Based on Loporto & Mannion (2021), this model treats 800m velocity as a weighted blend of two speed anchors:
<ul>
  <li><strong>MSS (Maximal Sprint Speed)</strong> — derived from your 400m PR.</li>
  <li><strong>MAS (Maximal Aerobic Speed)</strong> — derived from your 1600m PR.</li>
</ul>
The blend weight <em>w</em> shifts by profile:
<ul>
  <li><strong>Sprinter (w ≈ 0.35)</strong> — sprint ability drives more of your 800m velocity.</li>
  <li><strong>Specialist (w ≈ 0.25)</strong> — balanced contribution from both systems.</li>
  <li><strong>Miler (w ≈ 0.15)</strong> — aerobic base dominates; MAS is the stronger predictor.</li>
</ul>
<strong>Limitation:</strong> If no 1600m PR is entered, MAS is estimated from your 400m using Riegel. In that case both MSS and MAS share the same source data, so the model is less independent than it appears.`,
  },
  vdot: {
    title:   "VDOT — Jack Daniels Equivalent Performance",
    formula: "VDOT = VO₂(t) ÷ %VO₂max(t)  →  solve T₈₀₀ at same VDOT",
    body: `Based on Jack Daniels' oxygen-cost model (<em>Daniels' Running Formula</em>, 1998), this method estimates your aerobic capacity (VDOT) from your 1600m PR and then finds the equivalent 800m time that would require the same aerobic output.

<strong>How it works:</strong>
<ol>
  <li>VO₂ demand at your 1600m pace is estimated using Daniels' empirical formula.</li>
  <li>The fraction of VO₂max used at that duration is estimated (longer efforts use a lower fraction).</li>
  <li>VDOT = VO₂ demand ÷ fraction used.</li>
  <li>The 800m equivalent time is the race time that produces the same VDOT at the shorter distance.</li>
</ol>

<strong>Strengths:</strong> One of the most empirically validated equivalent-performance models for middle distance. Accounts for the different %VO₂max contribution at 800m vs. 1600m, not just a flat ratio.

<strong>Limitation:</strong> VDOT was calibrated primarily on aerobic athletes. For pure sprinters whose 800m performance is more anaerobic-speed-limited than aerobic, this model receives reduced ensemble weight. Not available without a 1600m PR.`,
  },
  ensemble: {
    title:   "Model-Based Estimate",
    formula: "T̂ = Σ (wᵢ · Tᵢ) ÷ Σ wᵢ",
    body: `The final estimate is a weighted average of all available models. Weights are determined by:
<ul>
  <li><strong>Performance band</strong> — elite athletes (Band A) receive a balanced model mix; developing athletes (Bands C–D) rely more heavily on the MSS/MAS Blend and the prior PR.</li>
  <li><strong>Athlete profile</strong> — sprinters heavily down-weight Critical Speed; milers keep a modest CS contribution.</li>
  <li><strong>Profile–physiology agreement</strong> — if your declared profile disagrees with what your 400/1600 ratio implies, profile-sensitive models are trusted less.</li>
  <li><strong>Outlier penalty</strong> — models far from the group median are automatically down-weighted.</li>
  <li><strong>Prior 800m PR</strong> — when present, this is the strongest single input, especially in Bands B–D. A real race result is more reliable than any formula.</li>
</ul>

The <strong>±Xs</strong> shown below the time reflects how much the individual models disagree. It is <em>not</em> a statistical confidence interval — it is a model-disagreement score. A narrow range indicates model convergence; a wide range is a signal to treat the estimate cautiously.

<strong>Note:</strong> This tool provides a model-based estimate for pacing guidance. Treat it as a useful starting point, not a precise race prediction.`,
  },
};

let activeModal = null;

function openInfoModal(info) {
  closeModal();
  if (!info) return;
  const formulaBlock = info.formula ? `<p class="modal-formula">${info.formula}</p>` : "";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${info.title}</h3>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      ${formulaBlock}
      <div class="modal-body">${info.body}</div>
    </div>
  `;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector(".modal-close").addEventListener("click", closeModal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("modal-visible"));
  activeModal = overlay;
  document.addEventListener("keydown", handleEscape);
}

function openModal(key) {
  openInfoModal(MODEL_INFO[key]);
}

function closeModal() {
  if (!activeModal) return;
  const el = activeModal;
  activeModal = null;
  document.removeEventListener("keydown", handleEscape);
  el.classList.remove("modal-visible");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 350);
}

function handleEscape(e) { if (e.key === "Escape") closeModal(); }

/* ── Graph tooltip ──────────────────────────────────────── */
function attachGraphTooltip(segments) {
  const svg     = document.getElementById("fatigueGraph");
  const tooltip = document.getElementById("graphTooltip");
  if (!tooltip) return;

  let hitGroup = document.getElementById("graphHitTargets");
  if (!hitGroup) {
    hitGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    hitGroup.setAttribute("id", "graphHitTargets");
    svg.appendChild(hitGroup);
  }
  hitGroup.innerHTML = "";

  const W = 520, H = 200, PX = 36, PY = 18;
  const usableW = W - PX * 2, usableH = H - PY * 2;

  segments.forEach((s, i) => {
    const cx  = PX + usableW * ((i + 1) / segments.length);
    const cy  = PY + usableH - (s.fatigue / 100) * usableH;
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("cx", cx); hit.setAttribute("cy", cy);
    hit.setAttribute("r", "14"); hit.setAttribute("fill", "transparent");
    hit.style.cursor = "crosshair";
    hit.addEventListener("mouseenter", evt => {
      tooltip.innerHTML = `
        <span class="tt-dist">${s.dist}m — Lap ${s.lap}</span>
        <span class="tt-row"><span>Fatigue index</span><strong>${s.fatigue}%</strong></span>
        <span class="tt-row"><span>Split</span><strong>${s.segmentSeconds.toFixed(2)}s</strong></span>
        <span class="tt-row"><span>Elapsed</span><strong>${formatTime(s.elapsed)}</strong></span>
      `;
      tooltip.classList.add("tt-visible");
      positionTooltip(evt);
    });
    hit.addEventListener("mousemove", positionTooltip);
    hit.addEventListener("mouseleave", () => tooltip.classList.remove("tt-visible"));
    hitGroup.appendChild(hit);
  });

  function positionTooltip(evt) {
    const rect = document.getElementById("graph-card-wrap")?.getBoundingClientRect()
                 ?? document.body.getBoundingClientRect();
    tooltip.style.left = (evt.clientX - rect.left + 12) + "px";
    tooltip.style.top  = (evt.clientY - rect.top  - 10) + "px";
  }
}

/* ── Hero panel ─────────────────────────────────────────── */
const STRATEGY_META = {
  even:        { insight: "Metered effort — same pace for both laps." },
  negative:    { insight: "Conserve Lap 1, unleash a stronger Lap 2." },
  frontLoaded: { insight: "Hammer early, hold on for the finish." },
  sitAndKick:  { insight: "Draft the field, fire a decisive final 200m kick." },
};

function updateHero(strategy, predictedTime) {
  heroPredicted.textContent      = predictedTime != null ? formatTime(predictedTime) : "—";
  heroInsight.textContent        = STRATEGY_META[strategy]?.insight ?? "";
  document.body.dataset.strategy = strategy;
}

/* ═══════════════════════════════════════════════════════════
   8B. MAIN — RUN SIMULATION
═══════════════════════════════════════════════════════════ */
function runSimulation() {
  const t400     = parseAndValidate(pr400Input.value,  "t400");
  const t1600    = parseAndValidate(pr1600Input.value, "t1600");
  const t800     = parseAndValidate(pr800Input.value,  "t800");
  const strategy = strategyInput.value;
  const profile  = profileInput.value;
  const sex      = document.getElementById("sex").value;

  if (!t400) {
    alert("Please enter a valid 400m PR (between 40s and 3:00) to run the simulation.");
    return;
  }

  const riegel = modelRiegel(t400, profile, sex);
  const cs     = modelCriticalSpeed(t400, t1600);
  const blend  = modelMSSMAS(t400, t1600, profile, sex);
  const vdot   = modelVdot(t1600);
  const ens    = computeEnsemble(riegel, cs, blend, vdot, t800, profile, sex, t400, t1600);

  if (!ens) return;

  const segments  = simulateRace(ens.mean, strategy, profile, ens.weightMap);
  simulationState = segments;

  updateModelTiles(riegel, cs, blend, vdot, ens);
  updateHero(strategy, ens.mean);
  updateOfferCopy({ predictedTime: ens.mean, t1600, t800, strategy });
  updateLapPills(segments);
  renderGraph(segments, ens.mean);
  attachGraphTooltip(segments);
  renderTable(segments);
  renderSplitMarkers(segments);
  startReplay();

  // Persist to localStorage for Dashboard / Training pages.
  try {
    localStorage.setItem("athleteProfile", JSON.stringify({
      t400, t1600, t800, profile, sex, savedAt: Date.now(),
    }));
    const hist = JSON.parse(localStorage.getItem("predictionHistory") || "[]");
    hist.push({ date: Date.now(), predicted: ens.mean, t400, t1600: t1600 ?? null, band: ens.band });
    localStorage.setItem("predictionHistory", JSON.stringify(hist.slice(-50)));
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════
   8C. EVENT BINDING
═══════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  if (!form) return;   // Guard: only run on index.html which has #simForm
  setPlanContent();
  updatePricingNote();

  form.addEventListener("submit", e => { e.preventDefault(); runSimulation(); });

  if (replayBtn) replayBtn.addEventListener("click", startReplay);
  if (runnerCta) runnerCta.addEventListener("click", () => openCheckoutOrContact("runnerPro"));
  if (coachCta)  coachCta.addEventListener("click",  () => openCheckoutOrContact("coachPack"));
  if (teamCta)   teamCta.addEventListener("click",   () => openCheckoutOrContact("teamLicensing"));

  strategyInput.addEventListener("change", () => {
    document.body.dataset.strategy = strategyInput.value;
    if (simulationState) runSimulation();
  });

  document.getElementById("sex").addEventListener("change", () => {
    if (simulationState) runSimulation();
  });

  document.querySelectorAll(".model-tile[data-model]").forEach(tile => {
    tile.addEventListener("click", () => openModal(tile.dataset.model));
  });

  runSimulation();
});
