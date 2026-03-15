/* =============================================================
   800m Race Strategy Simulator — script.js
   Models from: Executive Summary PDF
   ① Riegel:        T800 = T400 · (800/400)^1.06
   ② Critical Speed: CS & D' from 400m + 1600m; T800 = (800−D')/CS
   ③ MSS/MAS Blend: v800 = w·MSS + (1−w)·MAS  (w=0.3 fast, 0.2 slow)
   ④ Ensemble:      weighted average + 95% CI
   Fatigue: physiological model scaled so it reaches ~85-100% at finish,
            modulated by strategy shape AND ensemble model weights.
   ============================================================= */

/* ── DOM refs ─────────────────────────────────────────────── */
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

let simulationState = null;
let replayTimers    = [];

/* ── Time helpers ─────────────────────────────────────────── */
function parseTime(value) {
  if (!value || !value.trim()) return null;
  const str = value.trim();
  const parts = str.split(":");
  if (parts.length === 2) {
    const t = Number(parts[0]) * 60 + Number(parts[1]);
    return isNaN(t) ? null : t;
  }
  const t = Number(str);
  return isNaN(t) ? null : t;
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

/* ═══════════════════════════════════════════════════════════
   PREDICTION MODELS
═══════════════════════════════════════════════════════════ */

/* ── Sex correction ──────────────────────────────────────────
   Female 800m world record is ~11.5% slower than male (1:53.28 vs 1:40.91).
   The gap between sexes in the 400m is ~10% (47.60 vs 43.03).
   The difference in conversion ratio means female athletes carry slightly
   less speed reserve into the 800m relative to their 400m — the Riegel
   exponent should be marginally higher for females, and the MSS/MAS
   blend shifts toward MAS (females have proportionally stronger aerobic
   contribution to 800m performance).

   Rather than require separate male/female PR inputs, we apply a
   sex-specific scaling to the RAW model outputs:
     - Riegel:   female exponent nudged +0.01 (1.07/1.08/1.04 vs 1.06/1.09/1.03)
     - CS:       no correction needed — it operates on the athlete's own PRs,
                 which already embed sex differences
     - MSS/MAS:  female w nudged −0.03 (more weight on aerobic MAS)
     - Ensemble: female athletes get a small boost to CS weight (+0.5)
                 since aerobic models predict female 800m better
*/

/* ① Riegel Power-Law: T800 = T400 · (800/400)^exponent */
function modelRiegel(t400, profile, sex) {
  if (!t400) return null;
  const base = { speed: 1.09, balanced: 1.06, endurance: 1.03 }[profile] ?? 1.06;
  // Female athletes: marginally higher exponent (speed transfers slightly less)
  const exponent = sex === 'female' ? base + 0.01 : base;
  return t400 * Math.pow(800 / 400, exponent);
}

/* ② Critical Speed
   CS and D' are derived directly from the athlete's own PRs — sex differences
   are already embedded in those times, so no additional correction is needed.
*/
function modelCriticalSpeed(t400, t1600) {
  if (!t400 || !t1600) return null;
  const D1 = 400, T1 = t400;
  const D2 = 1600, T2 = t1600;
  if (T1 === T2) return null;
  const CS = (D1 - D2) / (T1 - T2);
  const Dp = D1 - CS * T1;
  if (CS <= 0 || Dp <= 0) return null;
  const T800 = (800 - Dp) / CS;
  return T800 > 0 ? T800 : null;
}

/* ③ MSS/MAS Blend
   v800 = w·MSS + (1−w)·MAS
   Profile sets w; sex nudges it toward MAS for females
   (female 800m performance is more aerobically driven relative to sprint speed).
*/
function modelMSSMAS(t400, t1600, profile, sex) {
  if (!t400) return null;
  const MSS = 400 / t400;
  const T1600est = t1600 ?? (t400 * Math.pow(1600 / 400, 1.06));
  const MAS = 1600 / T1600est;

  const baseW = { speed: 0.35, balanced: 0.25, endurance: 0.15 }[profile] ?? 0.25;
  // Female: shift 3% more toward MAS
  const sexAdj = sex === 'female' ? -0.03 : 0;

  const v_est = (baseW + sexAdj) * MSS + (1 - baseW - sexAdj) * MAS;
  const T_est = 800 / v_est;
  // Fast-athlete tier nudge (PDF: +0.05 for T800 < 160s)
  const tierAdj = T_est < 160 ? 0.05 : 0;
  const w = Math.max(0.10, Math.min(baseW + sexAdj + tierAdj, 0.40));

  const v800 = w * MSS + (1 - w) * MAS;
  return 800 / v800;
}

/* ④ Ensemble: weighted average + CI
   Profile shifts model trust; sex further adjusts CS weight for females.
*/
function ensemblePredict(riegel, cs, blend, pr800, profile, sex) {
  const profileWeights = {
    speed:     { riegel: 2.5, cs: 1.5, blend: 2.0 },
    balanced:  { riegel: 2.0, cs: 2.5, blend: 1.5 },
    endurance: { riegel: 1.5, cs: 3.0, blend: 1.0 },
  };
  const pw = { ...( profileWeights[profile] ?? profileWeights.balanced ) };

  // Female: CS model is a stronger predictor → boost its weight
  if (sex === 'female' && cs != null) {
    pw.cs    += 0.5;
    pw.riegel = Math.max(pw.riegel - 0.25, 1.0);
  }

  const predictions = [];
  if (pr800  != null) predictions.push({ val: pr800,  w: 3.0,      name: "prior"  });
  if (riegel != null) predictions.push({ val: riegel, w: pw.riegel, name: "riegel" });
  if (cs     != null) predictions.push({ val: cs,     w: pw.cs,     name: "cs"     });
  if (blend  != null) predictions.push({ val: blend,  w: pw.blend,  name: "blend"  });
  if (!predictions.length) return null;

  const totalW = predictions.reduce((s, p) => s + p.w, 0);
  const mean   = predictions.reduce((s, p) => s + p.val * p.w, 0) / totalW;

  const variance = predictions.reduce((s, p) => s + p.w * Math.pow(p.val - mean, 2), 0) / totalW;
  const sigma    = Math.sqrt(variance);
  const ci       = Math.max(sigma * 1.96, 2.0);

  const weightMap = {};
  predictions.forEach(p => { weightMap[p.name] = p.w / totalW; });

  return { mean, ci, weightMap };
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY PACING SHAPE
   8 multipliers, normalised so mean = 1.0
═══════════════════════════════════════════════════════════ */
function getStrategyMultipliers(strategy, profile) {
  const n = 8;
  const swing = { speed: 1.0, balanced: 0.78, endurance: 0.60 }[profile] ?? 0.78;
  let raw = new Array(n).fill(1.0);

  switch (strategy) {
    case "even":
      // Nearly flat, tiny natural fatigue drift
      raw = raw.map((_, i) => 1 + (i / (n - 1)) * 0.012 * swing);
      break;

    case "negative":
      // Go out ~3% conservative, come home ~3% fast
      raw = raw.map((_, i) => {
        const prog = i / (n - 1);
        return 1 + 0.04 * swing * (0.5 - prog);
      });
      break;

    case "frontLoaded":
      // First 200m blazing, then progressive exponential fade
      raw = raw.map((_, i) => {
        const prog = i / (n - 1);
        if (i < 2) return 1 - 0.055 * swing;
        return 1 + 0.028 * swing * Math.pow((prog - 0.25) / 0.75, 1.8);
      });
      break;

    case "sitAndKick":
      // Conserved first 600m, pronounced final 200m kick
      raw = raw.map((_, i) => {
        if (i < 6) return 1 + 0.022 * swing;
        const kickProg = (i - 6);            // 0 or 1
        return 1 + 0.022 * swing - 0.075 * swing * kickProg;
      });
      break;
  }

  // Normalise so sum == n
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(m => (m * n) / sum);
}

/* ═══════════════════════════════════════════════════════════
   PHYSIOLOGICAL FATIGUE MODEL
   ─────────────────────────────────────────────────────────
   Design goals:
   • Starts near 0%, finishes at ~85–100%
   • Increases non-linearly: slow early, accelerating in lap 2
   • Adaptive to strategy: front-loaded athletes peak fatigue sooner
   • Adaptive to profile: speed athletes fatigue faster, endurance slower
   • Adaptive to ensemble: if CS model (high aerobic) dominates, fatigue
     rises slower; if Riegel/blend (speed-based), fatigue is more front-loaded

   Mechanism:
   1. Base fatigue rises as a scaled power-law of global race progress.
      exponent drives the curve shape (>1 = convex = accelerating)
   2. Intensity premium: each segment faster than threshold pace adds
      extra fatigue proportional to how far above threshold it is.
   3. Final values are rescaled so segment 8 always lands in [82%, 100%].
═══════════════════════════════════════════════════════════ */
function computeFatigue(splits, goalSec, profile, strategy, weightMap) {
  const n = splits.length;   // 8

  /* --- Profile parameters --- */
  // endurance athletes hold up better; speed athletes burn out faster
  const profileFactor = { speed: 1.18, balanced: 1.0, endurance: 0.84 }[profile] ?? 1.0;

  /* --- Strategy curvature --- */
  // front-loaded → more convex curve (fatigue spikes early)
  // sit-and-kick → more linear until the kick, then spikes
  const strategyCurve = {
    even:        1.7,
    negative:    1.9,
    frontLoaded: 1.3,   // lower exponent = fatigue arrives sooner
    sitAndKick:  2.1,   // fatigue held off, then explodes
  }[strategy] ?? 1.7;

  /* --- Ensemble weight modifier ---
     If Critical Speed model dominates (aerobic dominant), fatigue
     accumulates more slowly in lap 1 (higher exponent = more convex).
     If Riegel or blend dominates (speed/anaerobic dominant), fatigue
     comes earlier (lower exponent).
  */
  const csWeight     = (weightMap && weightMap.cs)     ?? 0;
  const riegelWeight = (weightMap && weightMap.riegel)  ?? 0;
  const blendWeight  = (weightMap && weightMap.blend)   ?? 0;
  // cs-heavy → curve more convex; speed-heavy → curve less convex
  const ensembleMod  = 1 + (csWeight - riegelWeight * 0.5 - blendWeight * 0.3) * 0.4;
  const curveExp     = strategyCurve * ensembleMod * (1 / profileFactor);

  /* --- Threshold intensity premium ---
     The 800m is run well above lactate threshold the entire race.
     Threshold ≈ 1600m pace. Intensity = (splitPace − thresholdPace) / thresholdPace
     where a LOWER split time = FASTER pace = higher intensity above threshold.
  */
  const thresholdSplit = goalSec / 8 / 1.08;  // threshold per-100m pace

  /* --- Build raw fatigue array ---
     raw[i] = base_curve(i) + intensity_premium(i)
  */
  const rawFatigue = splits.map((split, i) => {
    const progress  = (i + 1) / n;                        // 0.125 → 1.0
    // Base curve: power-law of progress, scaled to reach ~100 at end
    const base      = Math.pow(progress, curveExp) * 100;

    // Intensity premium: how much faster than threshold?
    // split < thresholdSplit means we're running FASTER than threshold
    const intensityAbove = Math.max(0, (thresholdSplit - split) / thresholdSplit);
    const premium   = intensityAbove * 45 * profileFactor;

    return base + premium;
  });

  /* --- Rescale so segment 8 = finalFatigue ---
     Target final fatigue: 82–98% depending on profile + strategy.
     speed+frontLoaded → higher (athlete blows up more)
     endurance+negative → lower (well-managed finish)
  */
  const targetFinalMap = {
    speed:     { even: 93, negative: 88, frontLoaded: 99, sitAndKick: 91 },
    balanced:  { even: 88, negative: 85, frontLoaded: 97, sitAndKick: 87 },
    endurance: { even: 84, negative: 82, frontLoaded: 93, sitAndKick: 83 },
  };
  const targetFinal = (targetFinalMap[profile] ?? targetFinalMap.balanced)[strategy] ?? 88;

  const rawFinal = rawFatigue[n - 1];
  const scale    = targetFinal / rawFinal;

  return rawFatigue.map(v => Math.min(+(v * scale).toFixed(1), 100));
}

/* ═══════════════════════════════════════════════════════════
   CORE RACE SIMULATION — 8 × 100m
═══════════════════════════════════════════════════════════ */
function simulateRace(goalSec, strategy, profile, weightMap) {
  const n         = 8;
  const baseSplit = goalSec / n;
  const mults     = getStrategyMultipliers(strategy, profile);
  const splits    = mults.map(m => baseSplit * m);
  const fatigues  = computeFatigue(splits, goalSec, profile, strategy, weightMap);

  let elapsed = 0;
  return splits.map((split, i) => {
    elapsed += split;
    // ovalProgress: position on the oval (0→1), continuous across both laps.
    // globalProgress 0→0.5 maps to ovalProgress 0→1 (lap 1)
    // globalProgress 0.5→1 maps to ovalProgress 0→1 again (lap 2, same oval)
    const globalProg = (i + 1) / n;
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
   GRAPH RENDERING
═══════════════════════════════════════════════════════════ */
function renderGraph(segments, goalSec) {
  const W = 520, H = 200, PX = 36, PY = 18;
  const usableW = W - PX * 2;
  const usableH = H - PY * 2;

  graphGrid.innerHTML = "";

  // Grid lines at 25 / 50 / 75 / 100%
  [25, 50, 75, 100].forEach(pct => {
    const y = PY + usableH - (pct / 100) * usableH;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", PX); line.setAttribute("x2", W - PX);
    line.setAttribute("y1", y);  line.setAttribute("y2", y);
    line.setAttribute("class", "graph-grid-line");
    graphGrid.appendChild(line);

    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", PX - 4);
    lbl.setAttribute("y", y + 4);
    lbl.setAttribute("text-anchor", "end");
    lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(148,174,202,0.55)");
    lbl.textContent = pct + "%";
    graphGrid.appendChild(lbl);
  });

  // Lap divider at 400m (midpoint)
  const lapX = PX + usableW * 0.5;
  lapDivider.setAttribute("x1", lapX); lapDivider.setAttribute("x2", lapX);
  lapDivider.setAttribute("y1", PY);   lapDivider.setAttribute("y2", H - PY);

  // X-axis labels
  graphLabels.innerHTML = "";
  segments.forEach((s, i) => {
    const x = PX + usableW * ((i + 1) / segments.length);
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", x);
    lbl.setAttribute("y", H - 3);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(148,174,202,0.5)");
    lbl.textContent = s.dist + "m";
    graphLabels.appendChild(lbl);
  });

  // Lap labels
  ["Lap 1", "Lap 2"].forEach((txt, li) => {
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", PX + usableW * (0.25 + li * 0.5));
    lbl.setAttribute("y", PY + 10);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(148,174,202,0.35)");
    lbl.textContent = txt;
    graphLabels.appendChild(lbl);
  });

  // Fatigue curve
  graphPoints.innerHTML = "";
  const fPts = segments.map((s, i) => ({
    x: PX + usableW * ((i + 1) / segments.length),
    y: PY + usableH - (s.fatigue / 100) * usableH,
  }));

  const fLine = fPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  fatigueLine.setAttribute("d", fLine);
  fatigueArea.setAttribute("d",
    fLine +
    ` L ${fPts[fPts.length - 1].x.toFixed(1)} ${H - PY}` +
    ` L ${fPts[0].x.toFixed(1)} ${H - PY} Z`
  );

  // Pace curve — INVERTED: slower splits sit higher (more seconds = worse pace)
  // This means a front-loaded strategy falls left→right (fast start, slowing finish)
  // and a negative split rises then falls, matching real race intuition.
  const maxSplit = Math.max(...segments.map(s => s.segmentSeconds));
  const minSplit = Math.min(...segments.map(s => s.segmentSeconds));
  const range    = Math.max(maxSplit - minSplit, 0.3);

  const pPts = segments.map((s, i) => ({
    x: PX + usableW * ((i + 1) / segments.length),
    // slower split → higher y value (closer to top) = higher on SVG = lower y coord
    y: PY + usableH - ((s.segmentSeconds - minSplit) / range) * usableH * 0.75 - usableH * 0.1,
  }));

  const pLine = pPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  paceLine.setAttribute("d", pLine);
  paceArea.setAttribute("d",
    pLine +
    ` L ${pPts[pPts.length - 1].x.toFixed(1)} ${H - PY}` +
    ` L ${pPts[0].x.toFixed(1)} ${H - PY} Z`
  );

  // Fatigue dots
  fPts.forEach((p, i) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", p.x.toFixed(1));
    c.setAttribute("cy", p.y.toFixed(1));
    c.setAttribute("r", "3.5");
    c.setAttribute("class", "graph-point");
    c.dataset.index = i;
    graphPoints.appendChild(c);
  });
}

/* ═══════════════════════════════════════════════════════════
   TABLE RENDERING
═══════════════════════════════════════════════════════════ */
function renderTable(segments) {
  splitTableBody.innerHTML = "";
  const avgSplit = segments.reduce((s, seg) => s + seg.segmentSeconds, 0) / segments.length;

  segments.forEach((s, i) => {
    const diff     = s.segmentSeconds - avgSplit;
    const diffStr  = (diff >= 0 ? "+" : "") + diff.toFixed(2) + "s";
    const colour   = diff < -0.25
      ? "color:var(--accent-2)"
      : diff > 0.25
        ? "color:var(--warning)"
        : "";

    const row = document.createElement("tr");
    if (i === 3) row.classList.add("lap-boundary");  // visual lap divider

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
   SPLIT MARKERS ON TRACK — single layer, 4 physical positions
   We render exactly 4 marker groups (one per 100m position on
   the oval). On lap 1 they show 100/200/300/400m; on lap 2 the
   same groups are updated in place to show 500/600/700/800m.
   Labels sit outward from the track centre on a dark backdrop.
═══════════════════════════════════════════════════════════ */
function renderSplitMarkers(segments) {
  splitMarkers.innerHTML = "";
  const len = trackPath.getTotalLength();
  const cx = 380, cy = 160; // track visual centre

  // Only render the first 4 (lap 1 positions = the 4 physical spots on the oval)
  const lap1Segs = segments.filter(s => s.lap === 1);

  lap1Segs.forEach((seg, i) => {
    const pt = trackPath.getPointAtLength(len * seg.ovalProgress);

    const dotColorDim = "rgba(46,242,193,0.30)";
    const dotStroke   = "#2ef2c1";
    const ringColor   = "rgba(46,242,193,0.15)";

    // Group at this oval position — shared by both laps
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${pt.x.toFixed(2)},${pt.y.toFixed(2)})`);
    g.setAttribute("class", "marker-group");
    g.dataset.posIndex = i;  // 0–3, physical position on oval

    // Pulse ring (in local coords)
    const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pulse.setAttribute("cx", "0"); pulse.setAttribute("cy", "0"); pulse.setAttribute("r", "6");
    pulse.setAttribute("fill", "none");
    pulse.setAttribute("stroke", ringColor);
    pulse.setAttribute("stroke-width", "1.5");
    pulse.setAttribute("class", "split-pulse");
    const animR = document.createElementNS("http://www.w3.org/2000/svg", "animate");
    animR.setAttribute("attributeName", "r");
    animR.setAttribute("from", "6"); animR.setAttribute("to", "20");
    animR.setAttribute("dur", "2s"); animR.setAttribute("repeatCount", "indefinite");
    animR.setAttribute("begin", `${(i * 0.25).toFixed(2)}s`);
    pulse.appendChild(animR);
    const animO = document.createElementNS("http://www.w3.org/2000/svg", "animate");
    animO.setAttribute("attributeName", "opacity");
    animO.setAttribute("from", "0.45"); animO.setAttribute("to", "0");
    animO.setAttribute("dur", "2s"); animO.setAttribute("repeatCount", "indefinite");
    animO.setAttribute("begin", `${(i * 0.25).toFixed(2)}s`);
    pulse.appendChild(animO);
    g.appendChild(pulse);

    // Dot
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", "0"); dot.setAttribute("cy", "0"); dot.setAttribute("r", "5");
    dot.setAttribute("fill", dotColorDim);
    dot.setAttribute("stroke", dotStroke);
    dot.setAttribute("stroke-width", "1.5");
    dot.setAttribute("class", "split-marker");
    g.appendChild(dot);

    // Label offset outward from track centre
    const dx = pt.x - cx, dy = pt.y - cy;
    const d  = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / d, ny = dy / d;
    const lox = +(nx * 24).toFixed(1);
    const loy = +(ny * 24 + 4).toFixed(1);

    // Dark backdrop for legibility
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x",      (lox - 14).toFixed(1));
    bg.setAttribute("y",      (loy - 9).toFixed(1));
    bg.setAttribute("width",  "28");
    bg.setAttribute("height", "11");
    bg.setAttribute("rx",     "3");
    bg.setAttribute("fill",   "rgba(5,14,24,0.75)");
    bg.setAttribute("class",  "marker-bg");
    g.appendChild(bg);

    // Label — starts as lap 1 distance
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", lox);
    lbl.setAttribute("y", loy);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("font-size", "8.5");
    lbl.setAttribute("fill", "rgba(255,255,255,0.92)");
    lbl.setAttribute("font-family", "Bahnschrift,sans-serif");
    lbl.setAttribute("font-weight", "700");
    lbl.setAttribute("class", "split-label");
    lbl.textContent = seg.dist + "m";
    g.appendChild(lbl);

    splitMarkers.appendChild(g);
  });
}

/* ── Highlight active marker + update label for lap 2 ───── */
function highlightMarker(segIndex) {
  if (!simulationState) return;
  const seg       = simulationState[segIndex];
  const posIndex  = seg.lap === 1 ? segIndex : segIndex - 4;  // which of the 4 physical spots
  const isLap2    = seg.lap === 2;

  document.querySelectorAll(".marker-group").forEach(g => {
    const pi  = Number(g.dataset.posIndex);
    const dot = g.querySelector(".split-marker");
    const lbl = g.querySelector(".split-label");
    const pulse = g.querySelector(".split-pulse");

    if (pi === posIndex) {
      // Active marker: bright, enlarged
      const activeColor  = isLap2 ? "#56a8ff" : "#2ef2c1";
      const activeRing   = isLap2 ? "rgba(86,168,255,0.2)" : "rgba(46,242,193,0.2)";
      dot.setAttribute("fill",         activeColor);
      dot.setAttribute("stroke",       activeColor);
      dot.setAttribute("r",            "7");
      dot.setAttribute("stroke-width", "2.5");
      pulse.setAttribute("stroke",     activeRing);
      // Crossfade label to current lap's distance
      const newText  = seg.dist + "m";
      const newColor = isLap2 ? "rgba(180,210,255,0.95)" : "rgba(255,255,255,0.95)";
      if (lbl && lbl.textContent !== newText) {
        lbl.style.opacity = "0";
        setTimeout(() => {
          lbl.textContent = newText;
          lbl.setAttribute("fill", newColor);
          lbl.style.opacity = "1";
        }, 150);
      } else if (lbl) {
        lbl.setAttribute("fill", newColor);
      }
    } else {
      // Inactive: determine what lap this physical position is currently on
      // (if we're in lap 2, positions already passed show their lap 2 label;
      //  positions not yet reached still show lap 1 label)
      const thisPosSegIndex = isLap2 ? (pi + 4) : pi;
      const passed = thisPosSegIndex < segIndex;

      dot.setAttribute("r",            "5");
      dot.setAttribute("stroke-width", "1.5");

      if (isLap2 && passed) {
        // Already visited this spot in lap 2 — show lap 2 distance, blue-dim
        dot.setAttribute("fill",   "rgba(86,168,255,0.25)");
        dot.setAttribute("stroke", "#56a8ff");
        const newText = simulationState[pi + 4] ? simulationState[pi + 4].dist + "m" : lbl?.textContent;
        if (lbl && newText && lbl.textContent !== newText) {
          lbl.style.opacity = "0";
          setTimeout(() => {
            lbl.textContent = newText;
            lbl.setAttribute("fill", "rgba(180,210,255,0.70)");
            lbl.style.opacity = "1";
          }, 150);
        } else if (lbl) {
          lbl.setAttribute("fill", "rgba(180,210,255,0.70)");
        }
        if (pulse) pulse.setAttribute("stroke", "rgba(86,168,255,0.12)");
      } else {
        // Ahead or in lap 1 — show current lap's label, teal-dim
        dot.setAttribute("fill",   "rgba(46,242,193,0.25)");
        dot.setAttribute("stroke", "#2ef2c1");
        const baseIndex = isLap2 ? pi + 4 : pi;
        const newText = simulationState[baseIndex] ? simulationState[baseIndex].dist + "m" : lbl?.textContent;
        if (lbl && newText && lbl.textContent !== newText) {
          lbl.style.opacity = "0";
          setTimeout(() => {
            lbl.textContent = newText;
            lbl.setAttribute("fill", "rgba(255,255,255,0.75)");
            lbl.style.opacity = "1";
          }, 150);
        } else if (lbl) {
          lbl.setAttribute("fill", "rgba(255,255,255,0.75)");
        }
        if (pulse) pulse.setAttribute("stroke", "rgba(46,242,193,0.12)");
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   RUNNER ANIMATION — smooth path interpolation
   The runner travels continuously along the oval using
   requestAnimationFrame, interpolating between the lapProgress
   values of consecutive segments.  Each 700ms step smoothly
   eases the runner from the previous 100m mark to the next.
═══════════════════════════════════════════════════════════ */
let runnerRafId   = null;   // active rAF handle
let runnerFromProg = 0;     // lapProgress at start of current tween
let runnerToProg   = 0;     // lapProgress at end of current tween

function placeRunner(lapProgress) {
  const len = trackPath.getTotalLength();
  const pt  = trackPath.getPointAtLength(len * Math.min(Math.max(lapProgress, 0), 0.9999));
  runnerDot.setAttribute("cx",   pt.x);
  runnerDot.setAttribute("cy",   pt.y);
  runnerPulse.setAttribute("cx", pt.x);
  runnerPulse.setAttribute("cy", pt.y);
}

// Ease function: smooth cubic in-out
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function animateRunnerTo(fromProg, toProg, durationMs, onDone) {
  if (runnerRafId) cancelAnimationFrame(runnerRafId);

  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    const raw     = Math.min(elapsed / durationMs, 1);
    const t       = easeInOut(raw);
    const prog    = fromProg + (toProg - fromProg) * t;

    placeRunner(prog);

    if (raw < 1) {
      runnerRafId = requestAnimationFrame(frame);
    } else {
      runnerRafId = null;
      if (onDone) onDone();
    }
  }

  runnerRafId = requestAnimationFrame(frame);
}

/* ─────────────────────────────────────────────────────────
   SMOOTH COUNTER ANIMATIONS
   Interpolates a numeric value from `from` to `to` over
   `durationMs`, calling `onFrame(value)` each rAF tick.
   Returns a cancel function.
───────────────────────────────────────────────────────── */
function animateValue(from, to, durationMs, onFrame, easing) {
  const easeFn = easing || (t => t);  // default linear
  const startTime = performance.now();
  let rafId;

  function tick(now) {
    const raw = Math.min((now - startTime) / durationMs, 1);
    const t   = easeFn(raw);
    onFrame(from + (to - from) * t);
    if (raw < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onFrame(to);  // ensure we land exactly on the target
    }
  }

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

// Track active counter cancel functions so we can stop them on clearReplay
let cancelCounters = [];

/* ── Replay ─────────────────────────────────────────────── */
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

  // Reset runner to start/finish line and markers to lap 1 labels
  placeRunner(0.001);
  if (simulationState) {
    document.querySelectorAll(".marker-group").forEach(g => {
      const pi    = Number(g.dataset.posIndex);
      const lbl   = g.querySelector(".split-label");
      const dot   = g.querySelector(".split-marker");
      const pulse = g.querySelector(".split-pulse");
      if (lbl && simulationState[pi]) lbl.textContent = simulationState[pi].dist + "m";
      if (lbl) lbl.setAttribute("fill", "rgba(255,255,255,0.75)");
      if (dot) {
        dot.setAttribute("fill", "rgba(46,242,193,0.25)");
        dot.setAttribute("stroke", "#2ef2c1");
        dot.setAttribute("r", "5");
        dot.setAttribute("stroke-width", "1.5");
      }
      if (pulse) pulse.setAttribute("stroke", "rgba(46,242,193,0.12)");
    });
  }

  // Reset counters to zero state
  elapsedMetric.textContent = formatTime(0);
  fatigueMetric.textContent = "0%";
  lapMetric.textContent     = "Lap 1";

  const finalTime   = simulationState[simulationState.length - 1].elapsed;
  const segDuration = 700;   // ms per 100m segment step

  projectionMetric.textContent = formatTime(finalTime);

  simulationState.forEach((seg, i) => {
    const prevSeg   = i === 0 ? null : simulationState[i - 1];
    const prevProg  = i === 0 ? 0.001 : prevSeg.ovalProgress;
    const thisProg  = seg.ovalProgress;

    // Values to count FROM (previous segment's values, or zero at start)
    const fromElapsed = prevSeg ? prevSeg.elapsed  : 0;
    const fromFatigue = prevSeg ? prevSeg.fatigue  : 0;

    const id = setTimeout(() => {
      // Update lap indicator and table immediately (these are discrete)
      lapMetric.textContent = `Lap ${seg.lap}`;
      highlightMarker(i);
      document.querySelectorAll("#splitTableBody tr").forEach((r, ri) => {
        r.classList.toggle("active-row", ri === i);
      });

      // Animate elapsed time counter smoothly over the segment duration
      const cancelElapsed = animateValue(
        fromElapsed, seg.elapsed,
        segDuration * 0.88,
        val => { elapsedMetric.textContent = formatTime(val); },
        t => t  // linear — time should count up evenly
      );
      cancelCounters.push(cancelElapsed);

      // Animate fatigue counter with ease-out (slows as it approaches target)
      const cancelFatigue = animateValue(
        fromFatigue, seg.fatigue,
        segDuration * 0.88,
        val => { fatigueMetric.textContent = Math.round(val) + "%"; },
        t => 1 - Math.pow(1 - t, 2)  // ease-out quad
      );
      cancelCounters.push(cancelFatigue);

      // Runner path animation (with lap-boundary wrap handling)
      const isWrap = thisProg < prevProg;
      if (isWrap) {
        const totalDist  = (0.9999 - prevProg) + thisProg;
        const phase1Frac = totalDist > 0 ? (0.9999 - prevProg) / totalDist : 0.5;
        const dur        = segDuration * 0.9;
        animateRunnerTo(prevProg, 0.9999, dur * phase1Frac, () => {
          animateRunnerTo(0.0001, thisProg, dur * (1 - phase1Frac));
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

/* ═══════════════════════════════════════════════════════════
   MODEL TILE POPUPS
═══════════════════════════════════════════════════════════ */
const MODEL_INFO = {
  riegel: {
    title: "Riegel Power-Law",
    formula: "T₈₀₀ = T₄₀₀ · (800 ÷ 400) ^ e",
    body: `This is the simplest and most widely used race prediction formula, developed by Pete Riegel in 1977. It assumes that as race distance doubles, your time increases by a predictable factor — you slow down because fatigue compounds over longer efforts.

The exponent <em>e</em> controls how much you slow down with distance. The standard value is <strong>1.06</strong>, but this simulator adjusts it based on your profile:
<ul>
<li><strong>Speed/Sprinter (e = 1.09)</strong> — sprint speed doesn't carry as cleanly to 800m, so the model predicts a slightly larger slowdown.</li>
<li><strong>800m Specialist (e = 1.06)</strong> — the empirical average across all runners.</li>
<li><strong>Endurance/Miler (e = 1.03)</strong> — aerobic base helps you maintain speed over longer distances, so the slowdown is smaller.</li>
</ul>
For female athletes, the exponent is nudged up by 0.01 — research shows sprint speed transfers slightly less to 800m performance for women relative to men.

<strong>Best used when:</strong> you only have a 400m PR. It's fast, simple, and typically accurate to within 3–5%.`,
  },
  cs: {
    title: "Critical Speed Model",
    formula: "CS = (D₁ − D₂) ÷ (T₁ − T₂) · · · T₈₀₀ = (800 − D′) ÷ CS",
    body: `This model is grounded in exercise physiology. It uses two of your PRs — typically your 400m and 1600m — to solve for two fundamental properties of your fitness:

<ul>
<li><strong>Critical Speed (CS)</strong> — the fastest pace you can sustain indefinitely without accumulating fatigue. Think of it as your aerobic ceiling. It's found by solving a simple linear system: two known (distance, time) pairs give two equations, two unknowns.</li>
<li><strong>Anaerobic Reserve (D′)</strong> — a fixed "tank" of high-intensity energy above CS that gets depleted as you run faster than your aerobic limit. Once it's gone, you slow to CS or stop.</li>
</ul>

To predict your 800m time, the model asks: how long does it take to cover 800m if you burn through D′ and run at CS simultaneously? That gives T₈₀₀ = (800 − D′) ÷ CS.

Because it uses both your aerobic and anaerobic capacity, it's more physiologically complete than Riegel. The Critical Speed model is most trusted for <strong>endurance-type athletes</strong> whose 1600m PR is a strong reflection of their aerobic engine. It's not available if you haven't entered a 1600m PR.`,
  },
  blend: {
    title: "MSS / MAS Blend",
    formula: "v₈₀₀ = w · MSS + (1 − w) · MAS",
    body: `This model comes from research by Loporto & Mannion (2021) and directly addresses what makes the 800m unique: it's split roughly 30/70 between anaerobic (sprint) and aerobic systems, but that ratio shifts depending on the athlete.

It works by estimating two key speeds:
<ul>
<li><strong>MSS (Maximal Sprint Speed)</strong> — derived from your 400m PR. It represents your top-end speed, the anaerobic ceiling.</li>
<li><strong>MAS (Maximal Aerobic Speed)</strong> — derived from your 1600m PR. It's the fastest pace you can sustain purely aerobically.</li>
</ul>

Your predicted 800m velocity is a weighted blend of the two. The weight <em>w</em> is set by your athlete profile (SRR tier):
<ul>
<li><strong>Sprinter (w ≈ 0.35)</strong> — more of your 800m speed comes from raw sprint ability.</li>
<li><strong>Specialist (w ≈ 0.25)</strong> — balanced contribution from both systems.</li>
<li><strong>Miler (w ≈ 0.15)</strong> — aerobic base dominates; MAS is the stronger predictor.</li>
</ul>

For female athletes, <em>w</em> shifts further toward MAS, reflecting research showing women's 800m performance is proportionally more aerobically driven.`,
  },
  ensemble: {
    title: "Ensemble (Weighted Average)",
    formula: "T̂ = Σ (wᵢ · Tᵢ) ÷ Σ wᵢ",
    body: `No single model is perfect for every athlete. The ensemble combines all available models into one final prediction by taking a weighted average — giving more influence to the models best suited to your profile.

<strong>How the weights are assigned:</strong>
<ul>
<li>If you've entered a previous 800m PR, it anchors the prediction heavily (weight 3.0) — a real race is the best data point we have.</li>
<li>For <strong>speed athletes</strong>: Riegel and the MSS/MAS Blend are trusted more, since sprint-based predictors work best.</li>
<li>For <strong>endurance athletes</strong>: Critical Speed is trusted most, since the aerobic threshold model is most physiologically relevant.</li>
<li>For <strong>female athletes</strong>: Critical Speed weight is boosted further (+0.5), reflecting stronger aerobic contributions to 800m performance.</li>
</ul>

The <strong>±95% CI</strong> (confidence interval) shown below the time tells you how much the individual models disagree with each other. A wide interval means the models are giving different answers — which usually happens when only a 400m PR is available and profile information matters most. A narrow interval means the models converge, and the prediction is more reliable.`,
  },
};

// Active modal state
let activeModal = null;

function openModal(key) {
  closeModal();
  const info = MODEL_INFO[key];
  if (!info) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${info.title}</h3>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      <p class="modal-formula">${info.formula}</p>
      <div class="modal-body">${info.body}</div>
    </div>
  `;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  document.body.appendChild(overlay);
  // Trigger transition
  requestAnimationFrame(() => overlay.classList.add('modal-visible'));
  activeModal = overlay;

  // Close on Escape
  document.addEventListener('keydown', handleEscape);
}

function closeModal() {
  if (!activeModal) return;
  const el = activeModal;   // capture before nulling
  activeModal = null;
  document.removeEventListener('keydown', handleEscape);
  el.classList.remove('modal-visible');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // Fallback in case transitionend never fires
  setTimeout(() => el.remove(), 350);
}

function handleEscape(e) { if (e.key === 'Escape') closeModal(); }

/* ── Model tiles ────────────────────────────────────────── */
function updateModelTiles(riegel, cs, blend, ens) {
  document.getElementById('riegelVal').textContent  = riegel != null ? formatTime(riegel) : 'N/A';
  document.getElementById('csVal').textContent      = cs     != null ? formatTime(cs)     : '—';
  document.getElementById('blendVal').textContent   = blend  != null ? formatTime(blend)  : 'N/A';
  if (ens) {
    document.getElementById('ensembleVal').textContent = formatTime(ens.mean);
    document.getElementById('ensembleCI').textContent  = `95% CI ±${ens.ci.toFixed(1)}s`;
  }
}

/* ═══════════════════════════════════════════════════════════
   GRAPH HOVER TOOLTIP
═══════════════════════════════════════════════════════════ */
function attachGraphTooltip(segments) {
  const svg     = document.getElementById('fatigueGraph');
  const tooltip = document.getElementById('graphTooltip');
  if (!tooltip) return;

  // Build hit-target circles on top of visual dots
  let hitGroup = document.getElementById('graphHitTargets');
  if (!hitGroup) {
    hitGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    hitGroup.setAttribute('id', 'graphHitTargets');
    svg.appendChild(hitGroup);
  }
  hitGroup.innerHTML = '';

  const W = 520, H = 200, PX = 36, PY = 18;
  const usableW = W - PX * 2;
  const usableH = H - PY * 2;

  segments.forEach((s, i) => {
    const cx = PX + usableW * ((i + 1) / segments.length);
    const cy = PY + usableH - (s.fatigue / 100) * usableH;

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.setAttribute('cx', cx);
    hit.setAttribute('cy', cy);
    hit.setAttribute('r', '14');
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = 'crosshair';

    hit.addEventListener('mouseenter', evt => {
      tooltip.innerHTML = `
        <span class="tt-dist">${s.dist}m — Lap ${s.lap}</span>
        <span class="tt-row"><span>Fatigue</span><strong>${s.fatigue}%</strong></span>
        <span class="tt-row"><span>Split</span><strong>${s.segmentSeconds.toFixed(2)}s</strong></span>
        <span class="tt-row"><span>Elapsed</span><strong>${formatTime(s.elapsed)}</strong></span>
      `;
      tooltip.classList.add('tt-visible');
      positionTooltip(evt);
    });

    hit.addEventListener('mousemove', positionTooltip);

    hit.addEventListener('mouseleave', () => {
      tooltip.classList.remove('tt-visible');
    });

    hitGroup.appendChild(hit);
  });

  function positionTooltip(evt) {
    const rect = document.getElementById('graph-card-wrap')?.getBoundingClientRect()
               ?? document.body.getBoundingClientRect();
    const x = evt.clientX - rect.left + 12;
    const y = evt.clientY - rect.top  - 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }
}

/* ── Hero card ──────────────────────────────────────────── */
const STRATEGY_META = {
  even:        { insight: "Metered effort — same pace for both laps." },
  negative:    { insight: "Conserve Lap 1, unleash a stronger Lap 2." },
  frontLoaded: { insight: "Hammer early, hold on for the finish." },
  sitAndKick:  { insight: "Draft the field, fire a decisive final 200m kick." },
};

function updateHero(strategy, predictedTime) {
  heroPredicted.textContent    = predictedTime != null ? formatTime(predictedTime) : "—";
  heroInsight.textContent      = STRATEGY_META[strategy]?.insight ?? "";
  document.body.dataset.strategy = strategy;
}

/* ═══════════════════════════════════════════════════════════
   MAIN — RUN SIMULATION
═══════════════════════════════════════════════════════════ */
function runSimulation() {
  const t400     = parseTime(pr400Input.value);
  const t1600    = parseTime(pr1600Input.value);
  const t800     = parseTime(pr800Input.value);
  const strategy = strategyInput.value;
  const profile  = profileInput.value;
  const sex      = document.getElementById("sex").value;

  if (!t400) {
    alert("Please enter a valid 400m PR to run the simulation.");
    return;
  }

  const riegel = modelRiegel(t400, profile, sex);
  const cs     = modelCriticalSpeed(t400, t1600);
  const blend  = modelMSSMAS(t400, t1600, profile, sex);
  const ens    = ensemblePredict(riegel, cs, blend, t800, profile, sex);
  if (!ens) return;

  const goalSec   = ens.mean;
  const weightMap = ens.weightMap;

  // Pass weightMap into simulation so fatigue is adaptive to model confidence
  const segments = simulateRace(goalSec, strategy, profile, weightMap);
  simulationState = segments;

  updateModelTiles(riegel, cs, blend, ens);
  updateHero(strategy, goalSec);
  updateLapPills(segments);
  renderGraph(segments, goalSec);
  attachGraphTooltip(segments);
  renderTable(segments);
  renderSplitMarkers(segments);
  startReplay();
}

/* ── Events ─────────────────────────────────────────────── */
form.addEventListener("submit", e => { e.preventDefault(); runSimulation(); });
document.getElementById("replayButton").addEventListener("click", startReplay);
strategyInput.addEventListener("change", () => {
  document.body.dataset.strategy = strategyInput.value;
  if (simulationState) runSimulation();
});
document.getElementById("sex").addEventListener("change", () => {
  if (simulationState) runSimulation();
});

// Model tile click → open explanation popup
document.querySelectorAll('.model-tile[data-model]').forEach(tile => {
  tile.addEventListener('click', () => openModal(tile.dataset.model));
});

runSimulation();
