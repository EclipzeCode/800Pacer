/* =============================================================
   800m Race Strategy Simulator — predictor.js

   DOM layer for index.html. Requires models.js to be loaded first.

   7. Rendering  (graph, table, track, replay, comparison)
   8. UI glue    (DOM refs, events, modals, persistence)
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
const runnerHalo       = document.getElementById("runnerHalo");
const trackSvg         = document.getElementById("trackSvg");
const replayBtn        = document.getElementById("replayButton");

let simulationState = null;
let replayTimers    = [];
let isDemoData      = false;   // true while the form shows placeholder/example values

function updateDemoNote() {
  const el = document.getElementById("demoNote");
  if (el) el.hidden = !isDemoData;
}

/* ═══════════════════════════════════════════════════════════
   7A. GRAPH RENDERING
═══════════════════════════════════════════════════════════ */
const GRAPH = { W: 520, H: 200, PX: 36, PY: 18 };

function renderGraph(segments, goalSec) {
  const { W, H, PX, PY } = GRAPH;
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
  // Axis captions
  [["Fatigue", PX - 4, "end", "rgba(15,138,110,0.8)"], ["s/100m", W - PX + 4, "start", "rgba(37,99,235,0.75)"]]
    .forEach(([txt, x, anchor, fill]) => {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", x); t.setAttribute("y", PY - 6);
      t.setAttribute("text-anchor", anchor); t.setAttribute("font-size", "7.5");
      t.setAttribute("fill", fill); t.setAttribute("font-weight", "600");
      t.textContent = txt;
      graphGrid.appendChild(t);
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

  // Pace series on its own right-hand axis (s / 100m). Plotted so that
  // HIGHER on the chart = FASTER, which matches the "up is good" intuition.
  const splitsArr = segments.map(s => s.segmentSeconds);
  const rawMin = Math.min(...splitsArr), rawMax = Math.max(...splitsArr);
  const pad    = Math.max((rawMax - rawMin) * 0.25, 0.25);
  const pMin   = rawMin - pad, pMax = rawMax + pad;      // s/100m
  const paceY  = sec => PY + usableH * ((sec - pMin) / (pMax - pMin));  // slower → lower
  const pPts   = segments.map((s, i) => ({
    x: PX + usableW * ((i + 1) / segments.length),
    y: paceY(s.segmentSeconds),
  }));
  const pLine = pPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  paceLine.setAttribute("d", pLine);
  paceArea.setAttribute("d", pLine + ` L ${pPts[pPts.length - 1].x.toFixed(1)} ${H - PY} L ${pPts[0].x.toFixed(1)} ${H - PY} Z`);

  // Right axis ticks: fastest at top, slowest at bottom.
  [pMin, (pMin + pMax) / 2, pMax].forEach(sec => {
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", W - PX + 4); lbl.setAttribute("y", paceY(sec) + 3);
    lbl.setAttribute("text-anchor", "start"); lbl.setAttribute("font-size", "8");
    lbl.setAttribute("fill", "rgba(37,99,235,0.75)");
    lbl.textContent = sec.toFixed(1) + "s";
    graphGrid.appendChild(lbl);
  });

  fPts.forEach((p, i) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", p.x.toFixed(1)); c.setAttribute("cy", p.y.toFixed(1));
    c.setAttribute("r", "3.5"); c.setAttribute("class", "graph-point");
    c.dataset.index = i;
    graphPoints.appendChild(c);
  });
  pPts.forEach((p, i) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", p.x.toFixed(1)); c.setAttribute("cy", p.y.toFixed(1));
    c.setAttribute("r", "3"); c.setAttribute("class", "graph-point pace");
    c.dataset.index = i;
    graphPoints.appendChild(c);
  });

  return { fPts, pPts };
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
    // Green = faster than average, orange = slower (same semantics as the other pages).
    const colour  = diff < -0.25 ? "color:var(--positive)" : diff > 0.25 ? "color:var(--warning)" : "";
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
    bg.setAttribute("x", (lox - 21).toFixed(1)); bg.setAttribute("y", (loy - 9).toFixed(1));
    bg.setAttribute("width", "42"); bg.setAttribute("height", "11"); bg.setAttribute("rx", "3");
    bg.setAttribute("fill", "rgba(255,250,245,0.88)"); bg.setAttribute("class", "marker-bg");
    g.appendChild(bg);

    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", lox); lbl.setAttribute("y", loy);
    lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("font-size", "8.5");
    lbl.setAttribute("fill", "rgba(120,50,10,0.92)");
    lbl.setAttribute("font-family", "Bahnschrift,sans-serif"); lbl.setAttribute("font-weight", "700");
    lbl.setAttribute("class", "split-label");
    // Both laps pass this marker: "100 / 500". The active lap's number is
    // emphasised by highlightMarker(); nothing is ever overwritten.
    const lap2Seg = segments[i + 4];
    lbl.innerHTML = `<tspan class="lbl-l1">${seg.dist}</tspan><tspan class="lbl-sep"> / </tspan><tspan class="lbl-l2">${lap2Seg ? lap2Seg.dist : ""}</tspan>`;
    g.appendChild(lbl);

    splitMarkers.appendChild(g);
  });
}

/* ── Highlight active marker ────────────────────────────── */
const MARKER_COLORS = {
  1: { active: "#c94a10", ring: "rgba(200,74,16,0.25)",  passed: "rgba(180,70,10,0.30)"  },
  2: { active: "#c9820a", ring: "rgba(200,130,10,0.25)", passed: "rgba(180,120,10,0.30)" },
};

function setLapIndicator(text) {
  const el = document.getElementById("lapIndicator");
  if (el) el.textContent = text;
}

/**
 * Reset every marker to its idle state. `segIndex` = -1 means "before start".
 * Markers are shared by both laps; the label's tspans are emphasised per lap.
 */
function highlightMarker(segIndex) {
  if (!simulationState) return;
  const seg    = segIndex >= 0 ? simulationState[segIndex] : null;
  const lap    = seg ? seg.lap : 1;
  const posIdx = seg ? (lap === 1 ? segIndex : segIndex - 4) : -1;

  document.querySelectorAll(".marker-group").forEach(g => {
    const pi    = Number(g.dataset.posIndex);
    const dot   = g.querySelector(".split-marker");
    const pulse = g.querySelector(".split-pulse");
    const l1    = g.querySelector(".lbl-l1");
    const l2    = g.querySelector(".lbl-l2");
    const c     = MARKER_COLORS[lap];
    const passedThisLap = pi < posIdx;
    const isActive      = pi === posIdx;

    if (isActive) {
      dot.setAttribute("fill", c.active); dot.setAttribute("stroke", c.active);
      dot.setAttribute("r", "7"); dot.setAttribute("stroke-width", "2.5");
      pulse.setAttribute("stroke", c.ring);
    } else {
      const done = passedThisLap || lap === 2;   // lap-1 markers are all "done" in lap 2
      dot.setAttribute("fill", done ? c.passed : "rgba(180,70,10,0.30)");
      dot.setAttribute("stroke", done ? c.active : "#c94a10");
      dot.setAttribute("r", "5"); dot.setAttribute("stroke-width", "1.5");
      pulse.setAttribute("stroke", "rgba(200,80,20,0.12)");
    }
    // Emphasise the current lap's number in the "100 / 500" label.
    if (l1 && l2) {
      l1.setAttribute("fill", lap === 1 ? "rgba(120,50,10,0.95)" : "rgba(120,50,10,0.45)");
      l2.setAttribute("fill", lap === 2 ? "rgba(100,60,5,0.95)"  : "rgba(100,60,5,0.45)");
      l1.setAttribute("font-weight", lap === 1 ? "700" : "500");
      l2.setAttribute("font-weight", lap === 2 ? "700" : "500");
    }
  });
  setLapIndicator(seg ? (segIndex === simulationState.length - 1 ? "FINISH" : `LAP ${lap} · ${seg.dist}m`) : "800m · 2 LAPS");
}

/* ═══════════════════════════════════════════════════════════
   7D. RUNNER ANIMATION
═══════════════════════════════════════════════════════════ */
let runnerRafId = null;
let trackLen    = 0;   // cached; the path never changes

function placeRunner(prog) {
  const len = trackLen || (trackLen = trackPath.getTotalLength());
  const pt  = trackPath.getPointAtLength(len * Math.min(Math.max(prog, 0), 0.9999));
  const x = pt.x.toFixed(2), y = pt.y.toFixed(2);
  runnerDot.setAttribute("cx",   x); runnerDot.setAttribute("cy",   y);
  runnerPulse.setAttribute("cx", x); runnerPulse.setAttribute("cy", y);
  if (runnerHalo) { runnerHalo.setAttribute("cx", x); runnerHalo.setAttribute("cy", y); }
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
/* The SVG pulse rings are SMIL animations that repaint forever; keep them
   running only while a replay is in progress (plus a short tail). */
let pulsePauseTimer = null;
function setPulsesRunning(on) {
  if (!trackSvg || typeof trackSvg.pauseAnimations !== "function") return;
  clearTimeout(pulsePauseTimer);
  if (on) trackSvg.unpauseAnimations();
  else    pulsePauseTimer = setTimeout(() => trackSvg.pauseAnimations(), 2500);
}

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

  highlightMarker(-1);
  setPulsesRunning(true);

  elapsedMetric.textContent    = formatTime(0);
  fatigueMetric.textContent    = "0%";
  lapMetric.textContent        = "Lap 1";
  projectionMetric.textContent = "—";

  // Honour reduced-motion: step through the race quickly with no easing time.
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const segDuration  = reduceMotion ? 120 : 700;
  const lastIndex    = simulationState.length - 1;

  simulationState.forEach((seg, i) => {
    const prevSeg     = simulationState[i - 1] ?? null;
    const prevProg    = prevSeg ? prevSeg.ovalProgress : 0.001;
    const thisProg    = seg.ovalProgress;
    const fromElapsed = prevSeg ? prevSeg.elapsed : 0;
    const fromFatigue = prevSeg ? prevSeg.fatigue : 0;
    // Finish time if the race continued at this segment's average pace so far.
    const fromProj    = prevSeg ? prevSeg.elapsed / prevSeg.dist * 800 : seg.elapsed / seg.dist * 800;
    const toProj      = seg.elapsed / seg.dist * 800;

    const id = setTimeout(() => {
      lapMetric.textContent = i === lastIndex ? "Finished" : `Lap ${seg.lap}`;
      if (i === lastIndex) setPulsesRunning(false);
      highlightMarker(i);
      document.querySelectorAll("#splitTableBody tr").forEach((r, ri) => {
        r.classList.toggle("active-row", ri === i);
      });

      cancelCounters.push(animateValue(fromElapsed, seg.elapsed, segDuration * 0.88,
        val => { elapsedMetric.textContent = formatTime(val); }));

      cancelCounters.push(animateValue(fromProj, toProj, segDuration * 0.88,
        val => { projectionMetric.textContent = formatTime(val); }));

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
    ensembleCI.textContent  = `est. range ±${ens.spreadRange.toFixed(1)}s`;
  }
  // Show each model's share of the ensemble so the final number is explainable.
  const wm = ens?.weightMap ?? {};
  [["riegel", riegel], ["cs", cs], ["blend", blend], ["vdot", vdot]].forEach(([key, val]) => {
    const el = document.getElementById(key + "W");
    if (!el) return;
    if (val == null)        { el.textContent = key === "cs" || key === "vdot" ? "needs 1600m PR" : ""; el.className = "tile-weight muted"; return; }
    const pct = Math.round((wm[key] ?? 0) * 100);
    el.textContent = `${pct}% weight`;
    el.className = "tile-weight";
    el.style.setProperty("--w", pct + "%");
  });
  const priorEl = document.getElementById("priorW");
  if (priorEl) priorEl.textContent = wm.prior != null ? ` · prior 800m ${Math.round(wm.prior * 100)}%` : "";
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

let activeModal   = null;
let modalReturnEl = null;   // element to restore focus to on close

function openInfoModal(info) {
  closeModal();
  if (!info) return;
  modalReturnEl = document.activeElement;
  const formulaBlock = info.formula ? `<p class="modal-formula">${info.formula}</p>` : "";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1">
      <div class="modal-header">
        <h3 class="modal-title" id="modalTitle">${info.title}</h3>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      ${formulaBlock}
      <div class="modal-body">${info.body}</div>
    </div>
  `;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector(".modal-close").addEventListener("click", closeModal);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    overlay.classList.add("modal-visible");
    overlay.querySelector(".modal-box").focus();
  });
  activeModal = overlay;
  document.addEventListener("keydown", handleModalKeys);
}

function openModal(key) {
  openInfoModal(MODEL_INFO[key]);
}

function closeModal() {
  if (!activeModal) return;
  const el = activeModal;
  activeModal = null;
  document.removeEventListener("keydown", handleModalKeys);
  document.body.style.overflow = "";
  el.classList.remove("modal-visible");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 350);
  if (modalReturnEl && typeof modalReturnEl.focus === "function") modalReturnEl.focus();
  modalReturnEl = null;
}

/* Escape closes; Tab is trapped inside the dialog. */
function handleModalKeys(e) {
  if (e.key === "Escape") { closeModal(); return; }
  if (e.key !== "Tab" || !activeModal) return;
  const focusable = activeModal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === activeModal.querySelector(".modal-box"))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

/* ── Graph tooltip ──────────────────────────────────────── */
/* Pointer events (mouse + touch + pen). On touch, a tap pins the tooltip
   until the next tap elsewhere. */
function attachGraphTooltip(segments, pts) {
  const svg     = document.getElementById("fatigueGraph");
  const tooltip = document.getElementById("graphTooltip");
  if (!tooltip || !pts) return;

  let hitGroup = document.getElementById("graphHitTargets");
  if (!hitGroup) {
    hitGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    hitGroup.setAttribute("id", "graphHitTargets");
    svg.appendChild(hitGroup);
  }
  hitGroup.innerHTML = "";

  let pinned = false;

  function show(s, evt) {
    tooltip.innerHTML = `
      <span class="tt-dist">${s.dist}m — Lap ${s.lap}</span>
      <span class="tt-row"><span>Split</span><strong>${s.segmentSeconds.toFixed(2)}s</strong></span>
      <span class="tt-row"><span>Elapsed</span><strong>${formatTime(s.elapsed)}</strong></span>
      <span class="tt-row"><span>Fatigue index</span><strong>${s.fatigue}%</strong></span>
    `;
    tooltip.classList.add("tt-visible");
    positionTooltip(evt);
  }
  function hide() { if (!pinned) tooltip.classList.remove("tt-visible"); }

  segments.forEach((s, i) => {
    [pts.fPts[i], pts.pPts[i]].forEach(p => {
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hit.setAttribute("cx", p.x); hit.setAttribute("cy", p.y);
      hit.setAttribute("r", "14"); hit.setAttribute("fill", "transparent");
      hit.style.cursor = "crosshair";
      hit.addEventListener("pointerenter", evt => { if (evt.pointerType !== "touch") show(s, evt); });
      hit.addEventListener("pointermove",  evt => { if (!pinned) positionTooltip(evt); });
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("click", evt => {
        pinned = !(pinned && tooltip.classList.contains("tt-visible") && tooltip.dataset.idx === String(i));
        tooltip.dataset.idx = i;
        if (pinned) show(s, evt); else tooltip.classList.remove("tt-visible");
        evt.stopPropagation();
      });
      hitGroup.appendChild(hit);
    });
  });
  document.addEventListener("click", () => { pinned = false; tooltip.classList.remove("tt-visible"); }, { passive: true });

  function positionTooltip(evt) {
    const wrap = document.getElementById("graph-card-wrap");
    const rect = wrap?.getBoundingClientRect() ?? document.body.getBoundingClientRect();
    let x = evt.clientX - rect.left + 12;
    const y = evt.clientY - rect.top - 10;
    // Keep the tooltip inside the card on narrow screens.
    const ttW = tooltip.offsetWidth || 160;
    if (x + ttW > rect.width) x = Math.max(0, evt.clientX - rect.left - ttW - 12);
    tooltip.style.left = x + "px";
    tooltip.style.top  = y + "px";
  }
}

/* ── Strategy comparison ────────────────────────────────── */
const STRATEGY_LABELS = { even: "Even", negative: "Negative", frontLoaded: "Front Loaded", sitAndKick: "Sit & Kick" };
const STRATEGY_COLORS = { even: "#3b6fe8", negative: "#e85d20", frontLoaded: "#c9820a", sitAndKick: "#16a34a" };

/**
 * Overlay all four strategies' 100m splits for the same predicted total and
 * list lap splits + ratio. Clicking a row or line switches the active strategy.
 */
function renderStrategyComparison(goalSec, profile, activeStrategy) {
  const svg   = document.getElementById("compareGraph");
  const tbody = document.getElementById("compareTableBody");
  if (!svg || !tbody) return;

  const keys = Object.keys(STRATEGY_LABELS);
  const data = keys.map(k => {
    const mults  = getStrategyMultipliers(k, profile);
    const splits = mults.map(m => goalSec / 8 * m);
    const l1 = splits.slice(0, 4).reduce((a, b) => a + b, 0);
    const l2 = splits.slice(4).reduce((a, b) => a + b, 0);
    return { key: k, splits, l1, l2, ratio: l2 / l1, first200: splits[0] + splits[1], last200: splits[6] + splits[7] };
  });

  const W = 520, H = 170, PX = 36, PY = 18, usableW = W - PX * 2, usableH = H - PY * 2;
  const all  = data.flatMap(d => d.splits);
  const pad  = Math.max((Math.max(...all) - Math.min(...all)) * 0.2, 0.2);
  const pMin = Math.min(...all) - pad, pMax = Math.max(...all) + pad;
  const x = i => PX + usableW * (i / 7);
  const y = sec => PY + usableH * ((sec - pMin) / (pMax - pMin));   // higher = faster

  const grid = [0, 0.5, 1].map(f => {
    const sec = pMin + (pMax - pMin) * f;
    const yy  = y(sec).toFixed(1);
    return `<line x1="${PX}" x2="${W - PX}" y1="${yy}" y2="${yy}" class="graph-grid-line"/>` +
           `<text x="${PX - 4}" y="${(y(sec) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="rgba(74,82,102,0.6)">${sec.toFixed(1)}s</text>`;
  }).join("");
  const xLabels = Array.from({ length: 8 }, (_, i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="8" fill="rgba(74,82,102,0.55)">${(i + 1) * 100}m</text>`).join("");
  const lx = x(3.5).toFixed(1);
  const lapLine = `<line x1="${lx}" x2="${lx}" y1="${PY}" y2="${H - PY}" stroke="rgba(0,0,0,0.10)" stroke-width="1.5" stroke-dasharray="4 3"/>`;

  const lines = data.map(d => {
    const active = d.key === activeStrategy;
    const pts = d.splits.map((sec, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(sec).toFixed(1)}`).join(" ");
    return `<path d="${pts}" fill="none" stroke="${STRATEGY_COLORS[d.key]}" stroke-width="${active ? 3 : 1.8}" ` +
           `stroke-opacity="${active ? 1 : 0.45}" stroke-linejoin="round" stroke-linecap="round" ` +
           `class="cmp-line" data-strategy="${d.key}"><title>${STRATEGY_LABELS[d.key]}</title></path>`;
  }).join("");

  svg.innerHTML = grid + lapLine + xLabels + lines;

  tbody.innerHTML = data.map(d => `
    <tr class="cmp-row${d.key === activeStrategy ? " active-row" : ""}" data-strategy="${d.key}" tabindex="0" role="button" title="Switch to ${STRATEGY_LABELS[d.key]}">
      <td><span class="cmp-swatch" style="background:${STRATEGY_COLORS[d.key]}"></span>${STRATEGY_LABELS[d.key]}</td>
      <td>${d.first200.toFixed(1)}s</td>
      <td>${formatTime(d.l1)}</td>
      <td>${formatTime(d.l2)}</td>
      <td>${d.last200.toFixed(1)}s</td>
      <td>${d.ratio.toFixed(3)}</td>
    </tr>`).join("");

  const pick = k => {
    if (!k || k === strategyInput.value) return;
    strategyInput.value = k;
    strategyInput.dispatchEvent(new Event("change", { bubbles: true }));
  };
  tbody.querySelectorAll(".cmp-row").forEach(r => {
    r.addEventListener("click", () => pick(r.dataset.strategy));
    r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(r.dataset.strategy); } });
  });
  svg.querySelectorAll(".cmp-line").forEach(l => l.addEventListener("click", () => pick(l.dataset.strategy)));
}

/* ── Hero panel ─────────────────────────────────────────── */
const STRATEGY_META = {
  even:        { insight: "Metered effort — same pace for both laps." },
  negative:    { insight: "Conserve Lap 1, unleash a stronger Lap 2." },
  frontLoaded: { insight: "Hammer early, hold on for the finish." },
  sitAndKick:  { insight: "Draft the field, fire a decisive final 200m kick." },
};

const BAND_LABEL = { A: "Band A · Elite", B: "Band B · Sub-elite", C: "Band C · Competitive", D: "Band D · Developing" };

function updateHero(strategy, ens, segments) {
  heroPredicted.textContent      = ens ? formatTime(ens.mean) : "—";
  heroInsight.textContent        = STRATEGY_META[strategy]?.insight ?? "";
  document.body.dataset.strategy = strategy;

  const bandEl  = document.getElementById("heroBand");
  const rangeEl = document.getElementById("heroRange");
  const factsEl = document.getElementById("heroFacts");
  if (!ens) return;

  if (bandEl)  { bandEl.textContent = BAND_LABEL[ens.band] ?? ""; bandEl.hidden = !ens.band; }
  if (rangeEl) rangeEl.textContent = `est. range ±${ens.spreadRange.toFixed(1)}s`;
  if (factsEl && segments) {
    const l1 = segments.filter(x => x.lap === 1).reduce((a, x) => a + x.segmentSeconds, 0);
    const l2 = segments.filter(x => x.lap === 2).reduce((a, x) => a + x.segmentSeconds, 0);
    const nModels = Object.keys(ens.weightMap).filter(k => k !== "prior").length;
    factsEl.innerHTML = `
      <span>Lap 1 <b>${formatTime(l1)}</b></span>
      <span>Lap 2 <b>${formatTime(l2)}</b></span>
      <span>Avg <b>${(ens.mean / 8).toFixed(1)}s</b>/100m</span>
      <span><b>${nModels}</b> model${nModels === 1 ? "" : "s"}${ens.weightMap.prior ? " + prior" : ""}</span>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   8B. MAIN — RUN SIMULATION
═══════════════════════════════════════════════════════════ */
const TIME_FIELDS = [
  { input: pr400Input,  key: "t400",  msg: document.getElementById("pr400Msg")  },
  { input: pr1600Input, key: "t1600", msg: document.getElementById("pr1600Msg") },
  { input: pr800Input,  key: "t800",  msg: document.getElementById("pr800Msg")  },
];

/** Validate one field, paint its message slot, return the result. */
function showFieldState(field) {
  const res = validateTimeInput(field.input.value, field.key);
  if (field.msg) {
    field.msg.classList.remove("is-error", "is-warn");
    if (res.error)      { field.msg.textContent = res.error; field.msg.classList.add("is-error"); }
    else if (res.warn)  { field.msg.textContent = res.warn;  field.msg.classList.add("is-warn");  }
    else if (res.sec != null && field.input.value.trim() && !field.input.value.includes(":")) {
      field.msg.textContent = `= ${formatTime(res.sec)}`;
    }
    else field.msg.textContent = "";
  }
  field.input.setAttribute("aria-invalid", res.error ? "true" : "false");
  return res;
}

/**
 * @param {{persist?: boolean}} opts
 *   persist — remember the athlete's inputs in localStorage.
 *   Only true on an explicit form submit, never on page load or on
 *   strategy/sex/profile toggles, so history isn't polluted.
 */
function runSimulation({ persist = false } = {}) {
  const results  = TIME_FIELDS.map(showFieldState);
  const [r400, r1600, r800] = results;
  const t400     = r400.sec;
  const t1600    = r1600.sec;
  const t800     = r800.sec;
  const strategy = strategyInput.value;
  const profile  = profileInput.value;
  const sex      = document.getElementById("sex").value;

  if (!t400) {
    if (!r400.error && TIME_FIELDS[0].msg) {
      TIME_FIELDS[0].msg.textContent = "A 400m PR is required to run the simulation.";
      TIME_FIELDS[0].msg.classList.add("is-error");
      pr400Input.setAttribute("aria-invalid", "true");
    }
    pr400Input.focus();
    return;
  }
  // Any optional field with an error blocks the run so nothing is silently dropped.
  const firstBad = TIME_FIELDS.find((f, i) => results[i].error);
  if (firstBad) { firstBad.input.focus(); return; }

  const riegel = modelRiegel(t400, profile, sex);
  const cs     = modelCriticalSpeed(t400, t1600);
  const blend  = modelMSSMAS(t400, t1600, profile, sex);
  const vdot   = modelVdot(t1600);
  const ens    = computeEnsemble(riegel, cs, blend, vdot, t800, profile, sex, t400, t1600);

  if (!ens) return;

  const segments  = simulateRace(ens.mean, strategy, profile, ens.weightMap);
  simulationState = segments;

  updateModelTiles(riegel, cs, blend, vdot, ens);
  updateHero(strategy, ens, segments);
  updateLapPills(segments);
  const graphPts = renderGraph(segments, ens.mean);
  attachGraphTooltip(segments, graphPts);
  renderTable(segments);
  renderSplitMarkers(segments);
  renderStrategyComparison(ens.mean, profile, strategy);
  startReplay();

  updateDemoNote();

  // Remember the athlete so the form is pre-filled next visit — explicit submit only.
  if (!persist) return;
  isDemoData = false;
  updateDemoNote();
  try {
    localStorage.setItem("athleteProfile", JSON.stringify({
      t400, t1600, t800, profile, sex, strategy, savedAt: Date.now(),
    }));
    localStorage.removeItem("formDraft");   // submitted -> draft no longer needed
    showToast(`Predicted ${formatTime(ens.mean)}. Your PRs are remembered for next time.`, { type: "success", duration: 3500 });
  } catch (_) {}
}

/**
 * Re-populate the form. Priority: unsubmitted draft (what the user was
 * typing last visit) -> saved profile -> placeholder demo values.
 * Neither path writes history.
 */
function prefillFromSavedProfile() {
  try {
    const draft = JSON.parse(localStorage.getItem("formDraft"));
    if (draft && typeof draft === "object") {
      if (draft.pr400  != null) pr400Input.value  = draft.pr400;
      if (draft.pr1600 != null) pr1600Input.value = draft.pr1600;
      if (draft.pr800  != null) pr800Input.value  = draft.pr800;
      if (draft.profile)  profileInput.value  = draft.profile;
      if (draft.sex)      document.getElementById("sex").value = draft.sex;
      if (draft.strategy) strategyInput.value = draft.strategy;
      return true;
    }
    const p = JSON.parse(localStorage.getItem("athleteProfile"));
    if (!p || !p.t400) return false;
    pr400Input.value  = formatInput(p.t400);
    pr1600Input.value = p.t1600 ? formatInput(p.t1600) : "";
    pr800Input.value  = p.t800  ? formatInput(p.t800)  : "";
    if (p.profile)  profileInput.value  = p.profile;
    if (p.sex)      document.getElementById("sex").value = p.sex;
    if (p.strategy) strategyInput.value = p.strategy;
    return true;
  } catch (_) { return false; }
}

/** Save the raw form state so a returning user finds it as they left it. */
function saveFormDraft() {
  try {
    localStorage.setItem("formDraft", JSON.stringify({
      pr400: pr400Input.value, pr1600: pr1600Input.value, pr800: pr800Input.value,
      profile: profileInput.value, sex: document.getElementById("sex").value,
      strategy: strategyInput.value,
    }));
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════
   8C. EVENT BINDING
═══════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  if (!form) return;   // Guard: only run on index.html which has #simForm

  form.addEventListener("submit", e => { e.preventDefault(); runSimulation({ persist: true }); });

  if (replayBtn) replayBtn.addEventListener("click", startReplay);

  // Example athletes — fill the form (not persisted until the user submits).
  const PRESETS = {
    hs:      { pr400: "56.5", pr1600: "4:52",  pr800: "",       sex: "male", profile: "balanced", strategy: "negative" },
    college: { pr400: "49.8", pr1600: "4:12",  pr800: "1:53.4", sex: "male", profile: "balanced", strategy: "negative" },
    elite:   { pr400: "46.9", pr1600: "3:52",  pr800: "1:45.8", sex: "male", profile: "speed",    strategy: "sitAndKick" },
  };
  document.querySelectorAll(".preset-btn[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = PRESETS[btn.dataset.preset];
      if (!p) return;
      pr400Input.value = p.pr400; pr1600Input.value = p.pr1600; pr800Input.value = p.pr800;
      document.getElementById("sex").value = p.sex;
      profileInput.value  = p.profile;
      strategyInput.value = p.strategy;
      TIME_FIELDS.forEach(showFieldState);
      isDemoData = true;
      runSimulation();
      showToast(`Loaded the ${btn.textContent.split(" ·")[0].toLowerCase()} example. Edit any field to make it yours.`, { type: "info" });
    });
  });

  document.getElementById("resetButton")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear the form?",
      body: "This clears every input and forgets your remembered PRs on this device.",
      confirmLabel: "Clear form",
    });
    if (!ok) return;
    pr400Input.value = ""; pr1600Input.value = ""; pr800Input.value = "";
    document.getElementById("sex").value = "male";
    profileInput.value  = "balanced";
    strategyInput.value = "negative";
    TIME_FIELDS.forEach(showFieldState);
    try { localStorage.removeItem("formDraft"); localStorage.removeItem("athleteProfile"); } catch (_) {}
    isDemoData = false; updateDemoNote();
    pr400Input.focus();
    showToast("Form cleared.", { type: "success", duration: 2500 });
  });

  // Live echo / validation as the user types; remember the draft.
  TIME_FIELDS.forEach(f => f.input.addEventListener("input", () => { showFieldState(f); saveFormDraft(); isDemoData = false; updateDemoNote(); }));
  ["sex", "profile", "strategy"].forEach(id => document.getElementById(id).addEventListener("change", saveFormDraft));

  strategyInput.addEventListener("change", () => {
    document.body.dataset.strategy = strategyInput.value;
    if (simulationState) runSimulation();
  });

  ["sex", "profile"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      if (simulationState) runSimulation();
    });
  });

  document.querySelectorAll(".model-tile[data-model]").forEach(tile => {
    tile.addEventListener("click", () => openModal(tile.dataset.model));
    tile.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(tile.dataset.model); }
    });
  });

  // Initial render: use the saved profile if there is one, otherwise the
  // placeholder demo values. Neither is written to history.
  // Tidy keys left behind by the retired Training/Dashboard pages.
  try { ["predictionHistory", "raceLog", "athleteGoal"].forEach(k => localStorage.removeItem(k)); } catch (_) {}
  isDemoData = !prefillFromSavedProfile();   // nothing saved → placeholder values
  document.body.dataset.strategy = strategyInput.value;
  runSimulation();
});
