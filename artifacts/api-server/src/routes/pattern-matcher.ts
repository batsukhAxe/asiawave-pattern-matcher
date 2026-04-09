import { Router, type IRouter } from "express";
import * as fs from "fs";
import * as path from "path";

const router: IRouter = Router();

const SWING_LOOKBACK     = 2;  // H1:  2-bar lookback = ~2h context
const SWING_LOOKBACK_M5  = 8;  // M5:  8-bar lookback = ~40min context (100% session coverage)
const SWING_LOOKBACK_M15 = 3;  // M15: 3-bar lookback = ~45min context (100% session coverage)

// ── HIGH PROBABILITY PATTERNS (ML-derived from GOLD_AsiaWave_ML_v2.xlsx) ──────
// Source: ⭐ High-Prob Patterns sheet — Edge ≥ 20%, Count ≥ 3, GMT 21:00→07:55
// Wave values are Fibonacci-quantized % of Asia Range (W1–W4).
// Fibonacci levels used: 0, 11, 12, 23, 38, 50, 61, 78, 88, 100
// type=PEAK uses peakWavePercents; type=BOTTOM uses bottomWavePercents.
const FIB_LEVELS = [0, 11, 12, 23, 38, 50, 61, 78, 88, 100];

function quantizeToFib(v: number): number {
  return FIB_LEVELS.reduce((prev, curr) =>
    Math.abs(curr - v) < Math.abs(prev - v) ? curr : prev
  );
}

interface HighProbPattern {
  type: "PEAK" | "BOTTOM";
  waves: number[];    // quantized Fibonacci values [W1,W2,W3,W4]
  label: string;      // "23-0-0-0"
  count: number;      // historical occurrence count
  bullPct: number;    // % of Bull outcomes
  bearPct: number;    // % of Bear outcomes
  dominant: string;   // "BULL" | "BEAR"
  edge: number;       // directional edge %
  mlScore: number;    // ML score from Excel
  signal: string;     // "STRONG BUY" | "STRONG SELL"
}

const HIGH_PROB_PATTERNS: HighProbPattern[] = [
  // ── PEAK patterns ───────────────────────────────────────────────────────────
  { type:"PEAK",   waves:[23, 0,  0,  0 ], label:"23-0-0-0",   count:4,  bullPct:100.0, bearPct:0.0,   dominant:"BULL", edge:100.0, mlScore:80,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 23, 38, 23], label:"38-23-38-23", count:7,  bullPct:85.7,  bearPct:14.3,  dominant:"BULL", edge:71.4,  mlScore:71.4, signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 23, 23, 38], label:"38-23-23-38", count:3,  bullPct:0.0,   bearPct:100.0, dominant:"BEAR", edge:100.0, mlScore:60,   signal:"STRONG SELL" },
  { type:"PEAK",   waves:[23, 23, 61, 23], label:"23-23-61-23", count:3,  bullPct:100.0, bearPct:0.0,   dominant:"BULL", edge:100.0, mlScore:60,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 23, 50, 23], label:"38-23-50-23", count:3,  bullPct:100.0, bearPct:0.0,   dominant:"BULL", edge:100.0, mlScore:60,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[61, 23, 23, 23], label:"61-23-23-23", count:8,  bullPct:75.0,  bearPct:25.0,  dominant:"BULL", edge:50.0,  mlScore:50,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[23, 23, 23, 23], label:"23-23-23-23", count:11, bullPct:27.3,  bearPct:72.7,  dominant:"BEAR", edge:45.4,  mlScore:45.4, signal:"STRONG SELL" },
  { type:"PEAK",   waves:[50, 23, 23, 23], label:"50-23-23-23", count:7,  bullPct:71.4,  bearPct:28.6,  dominant:"BULL", edge:42.8,  mlScore:42.8, signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 23, 23, 0 ], label:"38-23-23-0",  count:3,  bullPct:66.7,  bearPct:0.0,   dominant:"BULL", edge:66.7,  mlScore:40,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 0,  23, 23], label:"38-0-23-23",  count:3,  bullPct:66.7,  bearPct:0.0,   dominant:"BULL", edge:66.7,  mlScore:40,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 23, 61, 23], label:"38-23-61-23", count:4,  bullPct:75.0,  bearPct:25.0,  dominant:"BULL", edge:50.0,  mlScore:40,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[50, 38, 23, 23], label:"50-38-23-23", count:4,  bullPct:75.0,  bearPct:25.0,  dominant:"BULL", edge:50.0,  mlScore:40,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[61, 23, 23, 38], label:"61-23-23-38", count:4,  bullPct:75.0,  bearPct:25.0,  dominant:"BULL", edge:50.0,  mlScore:40,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[23, 23, 38, 23], label:"23-23-38-23", count:12, bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:33.4, signal:"STRONG SELL" },
  { type:"PEAK",   waves:[50, 23, 38, 23], label:"50-23-38-23", count:6,  bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:33.4, signal:"STRONG SELL" },
  { type:"PEAK",   waves:[23, 23, 50, 23], label:"23-23-50-23", count:6,  bullPct:50.0,  bearPct:16.7,  dominant:"BULL", edge:33.3,  mlScore:33.3, signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[38, 23, 23, 23], label:"38-23-23-23", count:21, bullPct:61.9,  bearPct:33.3,  dominant:"BULL", edge:28.6,  mlScore:28.6, signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[23, 23, 23, 0 ], label:"23-23-23-0",  count:3,  bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:20,   signal:"STRONG SELL" },
  { type:"PEAK",   waves:[78, 23, 23, 23], label:"78-23-23-23", count:5,  bullPct:40.0,  bearPct:60.0,  dominant:"BEAR", edge:20.0,  mlScore:20,   signal:"STRONG SELL" },
  { type:"PEAK",   waves:[23, 23, 38, 38], label:"23-23-38-38", count:5,  bullPct:20.0,  bearPct:40.0,  dominant:"BEAR", edge:20.0,  mlScore:20,   signal:"STRONG SELL" },
  { type:"PEAK",   waves:[78, 38, 23, 23], label:"78-38-23-23", count:3,  bullPct:66.7,  bearPct:33.3,  dominant:"BULL", edge:33.4,  mlScore:20,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[23, 23, 88, 23], label:"23-23-88-23", count:3,  bullPct:66.7,  bearPct:33.3,  dominant:"BULL", edge:33.4,  mlScore:20,   signal:"STRONG BUY"  },
  { type:"PEAK",   waves:[23, 23, 50, 38], label:"23-23-50-38", count:3,  bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:20,   signal:"STRONG SELL" },
  // ── BOTTOM patterns ─────────────────────────────────────────────────────────
  { type:"BOTTOM", waves:[23, 23, 50, 23], label:"23-23-50-23", count:4,  bullPct:100.0, bearPct:0.0,   dominant:"BULL", edge:100.0, mlScore:80,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[23, 23, 23, 38], label:"23-23-23-38", count:8,  bullPct:87.5,  bearPct:12.5,  dominant:"BULL", edge:75.0,  mlScore:75,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[23, 38, 23, 23], label:"23-38-23-23", count:3,  bullPct:100.0, bearPct:0.0,   dominant:"BULL", edge:100.0, mlScore:60,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[38, 38, 23, 23], label:"38-38-23-23", count:3,  bullPct:100.0, bearPct:0.0,   dominant:"BULL", edge:100.0, mlScore:60,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[23, 23, 38, 38], label:"23-23-38-38", count:4,  bullPct:75.0,  bearPct:25.0,  dominant:"BULL", edge:50.0,  mlScore:40,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[50, 38, 23, 23], label:"50-38-23-23", count:4,  bullPct:25.0,  bearPct:75.0,  dominant:"BEAR", edge:50.0,  mlScore:40,   signal:"STRONG SELL" },
  { type:"BOTTOM", waves:[50, 23, 38, 23], label:"50-23-38-23", count:4,  bullPct:25.0,  bearPct:75.0,  dominant:"BEAR", edge:50.0,  mlScore:40,   signal:"STRONG SELL" },
  { type:"BOTTOM", waves:[38, 23, 38, 23], label:"38-23-38-23", count:8,  bullPct:62.5,  bearPct:37.5,  dominant:"BULL", edge:25.0,  mlScore:25,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[50, 23, 23, 23], label:"50-23-23-23", count:8,  bullPct:62.5,  bearPct:37.5,  dominant:"BULL", edge:25.0,  mlScore:25,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[38, 12, 23, 23], label:"38-12-23-23", count:4,  bullPct:25.0,  bearPct:50.0,  dominant:"BEAR", edge:25.0,  mlScore:20,   signal:"STRONG SELL" },
  { type:"BOTTOM", waves:[38, 23, 61, 23], label:"38-23-61-23", count:3,  bullPct:66.7,  bearPct:33.3,  dominant:"BULL", edge:33.4,  mlScore:20,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[23, 11, 23, 23], label:"23-11-23-23", count:3,  bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:20,   signal:"STRONG SELL" },
  { type:"BOTTOM", waves:[23, 23, 23, 11], label:"23-23-23-11", count:3,  bullPct:66.7,  bearPct:33.3,  dominant:"BULL", edge:33.4,  mlScore:20,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[61, 23, 23, 23], label:"61-23-23-23", count:3,  bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:20,   signal:"STRONG SELL" },
  { type:"BOTTOM", waves:[78, 38, 23, 23], label:"78-38-23-23", count:3,  bullPct:66.7,  bearPct:33.3,  dominant:"BULL", edge:33.4,  mlScore:20,   signal:"STRONG BUY"  },
  { type:"BOTTOM", waves:[61, 23, 23, 38], label:"61-23-23-38", count:3,  bullPct:33.3,  bearPct:66.7,  dominant:"BEAR", edge:33.4,  mlScore:20,   signal:"STRONG SELL" },
];

const HIGH_PROB_SCORE_THRESHOLD = 75; // best wave-match score >= 75% → HIGH PROBABILITY

// ── HIGH PROBABILITY PATTERN — Dynamic ML dataset search ─────────────────────
// ХУУЧИН: 35 hardcoded Fibonacci pattern → exact/adjacent match
// ШИНЭ:   400 ML session бүгдийг DTW+Pearson+Direction ашиглан шууд хайна
//
// HIGH PROB threshold: TOP-12 most-similar ML sessions, weighted BULL%/BEAR% >= 62%
// waveType: "PEAK" = peakWavePercents (pw1-pw4), "BOTTOM" = bottomWavePercents (bw1-bw4)
function checkHighProbPattern(waves: number[], waveType: "PEAK" | "BOTTOM" = "BOTTOM"): {
  matched: boolean; patternName: string; patternLabel: string; matchScore: number;
  signal: string; dominant: string; bullPct: number; bearPct: number; edge: number;
  count: number; mlScore: number; quantizedWaves: number[];
  // Extended: top match details
  topMatchDates?: string[]; insidePct?: number;
} {
  const quantized = waves.slice(0, 4).map(quantizeToFib); // still return for display
  const empty = {
    matched: false, patternName: "", patternLabel: "", matchScore: 0,
    signal: "", dominant: "", bullPct: 0, bearPct: 0, edge: 0,
    count: 0, mlScore: 0, quantizedWaves: quantized,
  };

  // Need at least 2 waves + ML data
  const query = waves.slice(0, 4);
  if (query.length < 2 || !mlDataset.length) return empty;

  // Score each ML row against today's waves using DTW+Pearson+Direction
  const MIN_SIMILARITY = 55; // minimum wave similarity to be considered
  const TOP_N = 12;          // top N most-similar sessions (focuses on high-quality matches)

  const scored = mlDataset
    .map(r => {
      // Raw wave values from ML dataset (pw1-pw4 or bw1-bw4)
      const histRaw = waveType === "PEAK"
        ? [r.pw1, r.pw2, r.pw3, r.pw4]
        : [r.bw1, r.bw2, r.bw3, r.bw4];
      const b = histRaw.filter(v => v != null && v > 0).slice(0, query.length);
      if (b.length < 2) return null;
      const a = query.slice(0, b.length);

      // 3-method similarity (same as compareWaveSequences)
      const dtw  = dtwSimilarity(a, b);
      const pear = pearsonScore(a, b);
      const dir  = directionScore(a, b);
      const sim  = dtw * 0.55 + pear * 0.30 + dir * 0.15;
      if (sim < MIN_SIMILARITY) return null;

      return { sim, outcome: r.outcome, date: r.date, dtw, pear, dir };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, TOP_N);

  // Need at least 6 matches for reliable stats
  if (scored.length < 6) return { ...empty, count: scored.length };

  // ── Similarity-WEIGHTED outcome stats ──────────────────────────────────────
  // Тоогоор тоолохын оронд similarity score-оор жиглэнэ.
  // Жишээ: sim=94 BEAR session нь sim=60 BEAR-аас 56% илүү жинтэй.
  // Энэ нь хамгийн ойрхон session-уудын дохионд илүү найдвартай.
  const n = scored.length;
  const totalSim = scored.reduce((s, x) => s + x.sim, 0);
  const wBull   = scored.filter(s => s.outcome === "BULLISH").reduce((s, x) => s + x.sim, 0);
  const wBear   = scored.filter(s => s.outcome === "BEARISH").reduce((s, x) => s + x.sim, 0);
  const wInside = scored.filter(s => s.outcome === "INSIDE").reduce((s, x) => s + x.sim, 0);

  // Count-based (reference) + weighted (primary signal)
  const bull   = scored.filter(s => s.outcome === "BULLISH").length;
  const bear   = scored.filter(s => s.outcome === "BEARISH").length;
  const inside = scored.filter(s => s.outcome === "INSIDE").length;
  const bullPct   = totalSim > 0 ? Math.round(wBull   / totalSim * 100) : Math.round(bull   / n * 100);
  const bearPct   = totalSim > 0 ? Math.round(wBear   / totalSim * 100) : Math.round(bear   / n * 100);
  const insidePct = totalSim > 0 ? Math.round(wInside / totalSim * 100) : Math.round(inside / n * 100);
  const avgSim    = +(totalSim / n).toFixed(1);
  const edge      = Math.abs(bullPct - bearPct);

  // HIGH PROB fires when weighted directional bias >= 62% (among top 12 most-similar sessions)
  const HIGH_PROB_BIAS = 62;
  const isBull = bullPct >= HIGH_PROB_BIAS;
  const isBear = bearPct >= HIGH_PROB_BIAS;
  const matched = isBull || isBear;
  const dominant = isBull ? "BULLISH" : (isBear ? "BEARISH" : "MIXED");

  return {
    matched,
    patternName: `ML Top-${n} ${waveType} Match`,
    patternLabel: `${waveType} (${n} sessions)`,
    matchScore: avgSim,
    signal: isBull ? "STRONG BUY" : (isBear ? "STRONG SELL" : "WAIT"),
    dominant,
    bullPct,
    bearPct,
    insidePct,
    edge,
    count: n,
    mlScore: avgSim,
    quantizedWaves: quantized,
    topMatchDates: scored.slice(0, 5).map(s => s.date),
  };
}

// ── A: Monthly seasonal bias (derived from 400-row ML dataset) ───────────────
// Each month: historical BULL% and BEAR% outcome rate (excluding INSIDE sessions)
const MONTHLY_BIAS: Record<number, { bullPct: number; bearPct: number; n: number; label: string }> = {
  1:  { bullPct: 62, bearPct: 38, n: 39, label: "Jan" },
  2:  { bullPct: 67, bearPct: 33, n: 36, label: "Feb" },
  3:  { bullPct: 54, bearPct: 46, n: 35, label: "Mar" },
  4:  { bullPct: 40, bearPct: 60, n: 20, label: "Apr" }, // BEAR bias
  5:  { bullPct: 53, bearPct: 47, n: 19, label: "May" },
  6:  { bullPct: 55, bearPct: 45, n: 20, label: "Jun" },
  7:  { bullPct: 55, bearPct: 45, n: 22, label: "Jul" },
  8:  { bullPct: 47, bearPct: 53, n: 19, label: "Aug" }, // slight BEAR
  9:  { bullPct: 74, bearPct: 26, n: 19, label: "Sep" }, // strong BULL
  10: { bullPct: 63, bearPct: 37, n: 27, label: "Oct" },
  11: { bullPct: 61, bearPct: 39, n: 38, label: "Nov" },
  12: { bullPct: 57, bearPct: 43, n: 42, label: "Dec" },
};

// D: Wave ratio similarity score (bw_ratio_1_2, bw_ratio_2_3)
// Compares how waves shrink/expand relative to each other
function calcRatioScore(todayWaves: number[], histWaves: number[]): number {
  if (todayWaves.length < 2 || histWaves.length < 2) return 50;
  const safe = (a: number, b: number) => b > 0 ? a / b : 1;
  const todayR12 = safe(todayWaves[1], todayWaves[0]);
  const histR12  = safe(histWaves[1],  histWaves[0]);
  const diff12   = Math.abs(todayR12 - histR12) / Math.max(todayR12, histR12, 0.01);
  let score = 100 * (1 - Math.min(diff12, 1));
  if (todayWaves.length >= 3 && histWaves.length >= 3) {
    const todayR23 = safe(todayWaves[2], todayWaves[1]);
    const histR23  = safe(histWaves[2],  histWaves[1]);
    const diff23   = Math.abs(todayR23 - histR23) / Math.max(todayR23, histR23, 0.01);
    score = (score + 100 * (1 - Math.min(diff23, 1))) / 2;
  }
  return score;
}

// ── ML Dataset (GOLD_AsiaWave_ML_v2.xlsx → AsiaWave_ML.json) ────────────────
// 400 historical sessions with full features + outcomes
interface MLRow {
  date: string;
  outcome: string;          // BULLISH | BEARISH | INSIDE
  first_break: string;      // HIGH | LOW | NONE
  close_vs_sess: string;    // ABOVE | BELOW | INSIDE
  peak_dir_enc: number;     // 1=UP (low first, then high), 0=DOWN
  bottom_dir_enc: number;
  sess_range: number;
  sess_range_pips: number;
  sess_high: number;
  sess_low: number;
  pw1: number; pw2: number; pw3: number; pw4: number;
  bw1: number; bw2: number; bw3: number; bw4: number;
  pf1: number; pf2: number; pf3: number; pf4: number;
  bf1: number; bf2: number; bf3: number; bf4: number;
  pw_ratio_1_2: number;
  pw_ratio_2_3: number;
  bw_ratio_1_2: number;
  bw_ratio_2_3: number;
  pw_declining: number;
  bw_declining: number;
  peak_match_score: number;
  bottom_match_score: number;
  has_peak_match: number;
  has_bottom_match: number;
  broke_high: number;
  broke_low: number;
  max_up_ext_pct: number;
  max_down_ext_pct: number;
  month: string;
  // computed at load time:
  bfibKey?: string;   // "23-38-23-23" from bf1-bf4 quantized
  pfibKey?: string;   // from pf1-pf4 quantized
}

let mlDataset: MLRow[] = [];
try {
  const mlPath = path.join(__dirname, "../data/AsiaWave_ML.json");
  const raw = JSON.parse(fs.readFileSync(mlPath, "utf-8")) as MLRow[];
  // Pre-compute quantized Fib keys for fast lookup
  mlDataset = raw.map(r => ({
    ...r,
    bfibKey: [r.bf1, r.bf2, r.bf3, r.bf4].map(v => v == null ? "X" : quantizeToFib(+v)).join("-"),
    pfibKey: [r.pf1, r.pf2, r.pf3, r.pf4].map(v => v == null ? "X" : quantizeToFib(+v)).join("-"),
  }));
} catch (e) {
  console.warn("AsiaWave_ML.json not found, ML prediction disabled");
}

// ── Range classification vs historical distribution ──────────────────────────
// Historical: Q25=172, median=293, Q75=526 pips
function classifyRange(pips: number): string {
  if (pips < 172)  return "SMALL";
  if (pips < 293)  return "MEDIUM";
  if (pips < 526)  return "LARGE";
  return "HUGE";
}

// ── Outcome stats helper ─────────────────────────────────────────────────────
function computeOutcomeStats(rows: MLRow[]): {
  n: number;
  bullPct: number; bearPct: number; insidePct: number;
  brokeHighPct: number; brokeLowPct: number;
  firstBreakHigh: number; firstBreakLow: number;
  avgUpExt: number; avgDownExt: number;
  medUpExt: number; medDownExt: number;
  closeAbovePct: number; closeBelowPct: number; closeInsidePct: number;
} {
  const n = rows.length;
  if (n === 0) return { n:0, bullPct:0, bearPct:0, insidePct:0, brokeHighPct:0, brokeLowPct:0, firstBreakHigh:0, firstBreakLow:0, avgUpExt:0, avgDownExt:0, medUpExt:0, medDownExt:0, closeAbovePct:0, closeBelowPct:0, closeInsidePct:0 };
  const bull   = rows.filter(r => r.outcome === "BULLISH").length;
  const bear   = rows.filter(r => r.outcome === "BEARISH").length;
  const inside = rows.filter(r => r.outcome === "INSIDE").length;
  const bh     = rows.filter(r => r.broke_high === 1).length;
  const bl     = rows.filter(r => r.broke_low === 1).length;
  const fbH    = rows.filter(r => r.first_break === "HIGH").length;
  const fbL    = rows.filter(r => r.first_break === "LOW").length;
  const upExts = rows.map(r => r.max_up_ext_pct).filter(v => v != null && v > 0);
  const dnExts = rows.map(r => r.max_down_ext_pct).filter(v => v != null && v > 0);
  const avg    = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const med    = (arr: number[]) => { const s=[...arr].sort((a,b)=>a-b); return s.length ? s[Math.floor(s.length/2)] : 0; };
  const closeAbove = rows.filter(r => r.close_vs_sess === "ABOVE").length;
  const closeBelow = rows.filter(r => r.close_vs_sess === "BELOW").length;
  const closeInside = rows.filter(r => r.close_vs_sess === "INSIDE").length;
  return {
    n,
    bullPct:       +(bull/n*100).toFixed(1),
    bearPct:       +(bear/n*100).toFixed(1),
    insidePct:     +(inside/n*100).toFixed(1),
    brokeHighPct:  +(bh/n*100).toFixed(1),
    brokeLowPct:   +(bl/n*100).toFixed(1),
    firstBreakHigh:+(fbH/n*100).toFixed(1),
    firstBreakLow: +(fbL/n*100).toFixed(1),
    avgUpExt:      +avg(upExts).toFixed(1),
    avgDownExt:    +avg(dnExts).toFixed(1),
    medUpExt:      +med(upExts).toFixed(1),
    medDownExt:    +med(dnExts).toFixed(1),
    closeAbovePct: +(closeAbove/n*100).toFixed(1),
    closeBelowPct: +(closeBelow/n*100).toFixed(1),
    closeInsidePct:+(closeInside/n*100).toFixed(1),
  };
}

// ── Main ML Prediction function ───────────────────────────────────────────────
function computeMLPrediction(
  todayDirection: "up" | "down",
  quantizedBottomWaves: number[],
  quantizedPeakWaves: number[],
  rangePips: number,
  rangeUsd: number,
  asiaHigh: number,
  asiaLow: number,
): {
  enabled: boolean;
  rangeClass: string;
  directionBias: { bullPct: number; bearPct: number; n: number };
  patternLookup: {
    type: string; fibKey: string; n: number; bullPct: number; bearPct: number; insidePct: number;
    brokeHighPct: number; brokeLowPct: number;
    firstBreakHigh: number; firstBreakLow: number;
    avgUpExt: number; avgDownExt: number; medUpExt: number; medDownExt: number;
    closeAbovePct: number; closeBelowPct: number; closeInsidePct: number;
    targetUp: number; targetDown: number;
    targetUpPrice: number; targetDownPrice: number;
  } | null;
  combined: {
    bullScore: number; bearScore: number;
    verdict: string; confidence: string;
  };
  waveCharacter: {
    bottomRatio12: number | null; bottomRatio23: number | null;
    peakRatio12: number | null; peakRatio23: number | null;
    bottomDeclining: boolean; peakDeclining: boolean;
  };
  historicalBaseline: ReturnType<typeof computeOutcomeStats>;
} {
  if (mlDataset.length === 0) return { enabled: false } as any;

  // 1. Range classification
  const rangeClass = classifyRange(rangePips);

  // 2. Direction bias — from historical: UP=66% bull, DOWN=59% bear
  const dirEnc = todayDirection === "down" ? 0 : 1; // DOWN=high first=0, UP=low first=1
  const dirRows = mlDataset.filter(r => r.peak_dir_enc === dirEnc);
  const dirStats = computeOutcomeStats(dirRows);

  // 3. Pattern lookup — prefer BOTTOM if enough waves, else PEAK
  const useBottom = quantizedBottomWaves.length >= 3;
  const fibKey = (useBottom ? quantizedBottomWaves : quantizedPeakWaves).slice(0,4).join("-");
  const fibType = useBottom ? "BOTTOM" : "PEAK";

  // Exact match first, then fuzzy (allow 1 Fib level difference for each wave)
  let matchRows = mlDataset.filter(r => (useBottom ? r.bfibKey : r.pfibKey) === fibKey);
  if (matchRows.length < 3) {
    // Fuzzy: quantize waves and check ±15% diff per position
    const refWaves = (useBottom ? quantizedBottomWaves : quantizedPeakWaves).slice(0, 4);
    matchRows = mlDataset.filter(r => {
      const candidateWaves = useBottom
        ? [r.bf1, r.bf2, r.bf3, r.bf4].map(v => quantizeToFib(+v || 0))
        : [r.pf1, r.pf2, r.pf3, r.pf4].map(v => quantizeToFib(+v || 0));
      let pts = 0;
      const n = Math.min(refWaves.length, candidateWaves.length, 4);
      for (let i = 0; i < n; i++) {
        const diff = Math.abs(refWaves[i] - candidateWaves[i]);
        if (diff === 0)       pts += 1;
        else if (diff <= 15)  pts += 0.5;
      }
      return (pts / n) >= 0.75;
    });
  }

  let patternLookup = null;
  if (matchRows.length > 0) {
    const stats = computeOutcomeStats(matchRows);
    // Extension targets as % of Asia Range, then as prices
    const upTarget  = stats.avgUpExt  / 100 * rangeUsd;
    const downTarget= stats.avgDownExt / 100 * rangeUsd;
    patternLookup = {
      type: fibType,
      fibKey,
      ...stats,
      targetUp:        +upTarget.toFixed(2),
      targetDown:      +downTarget.toFixed(2),
      targetUpPrice:   +(asiaHigh + upTarget).toFixed(2),
      targetDownPrice: +(asiaLow  - downTarget).toFixed(2),
    };
  }

  // 4. Wave characteristics (ratios, declining)
  const bw = quantizedBottomWaves;
  const pw = quantizedPeakWaves;
  const waveCharacter = {
    bottomRatio12: bw[0] && bw[1] ? +(bw[0]/bw[1]).toFixed(2) : null,
    bottomRatio23: bw[1] && bw[2] ? +(bw[1]/bw[2]).toFixed(2) : null,
    peakRatio12:   pw[0] && pw[1] ? +(pw[0]/pw[1]).toFixed(2) : null,
    peakRatio23:   pw[1] && pw[2] ? +(pw[1]/pw[2]).toFixed(2) : null,
    bottomDeclining: bw.length >= 3 && bw[0] > bw[1] && bw[1] < bw[2],
    peakDeclining:   pw.length >= 3 && pw[0] > pw[1] && pw[1] < pw[2],
  };

  // 5. Combined score (direction 50% + pattern 30% + declining 20%)
  const dirBull = dirStats.bullPct;
  const patBull = patternLookup ? patternLookup.bullPct : 50;
  const declBonus = (waveCharacter.bottomDeclining || waveCharacter.peakDeclining) ? 55 : 45;
  const bullScore = +(dirBull * 0.5 + patBull * 0.3 + declBonus * 0.2).toFixed(1);
  const bearScore = +(100 - bullScore).toFixed(1);
  const diff = Math.abs(bullScore - 50);
  const verdict = bullScore > 55 ? "BULLISH" : bullScore < 45 ? "BEARISH" : "NEUTRAL";
  const confidence = diff >= 20 ? "HIGH" : diff >= 10 ? "MEDIUM" : "LOW";

  // 6. Historical baseline (all 400 days)
  const historicalBaseline = computeOutcomeStats(mlDataset);

  return {
    enabled: true,
    rangeClass,
    rangePips: Math.round(rangePips),
    directionBias: { bullPct: dirStats.bullPct, bearPct: dirStats.bearPct, n: dirStats.n },
    patternLookup,
    combined: { bullScore, bearScore, verdict, confidence },
    waveCharacter,
    historicalBaseline,
  };
}

// ── Marketsess indicator session definitions ─────────────────────────────────
// Source: Auto_Sessions_v1.5.mq4 (cameofx)
// Times are in broker server time (UTC+2)
const SESSION_DEFS = [
  { name: "SydneyAsia",    begin: "21:00", end: "08:00", color: "#1a4d2e", hex: "#2d8a50" },
  { name: "Asia",          begin: "08:00", end: "09:00", color: "#1a2d4d", hex: "#2d5a8a" },
  { name: "AsiaEuro",      begin: "09:00", end: "12:10", color: "#3d1a2d", hex: "#8a2d5a" },
  { name: "Euro",          begin: "13:10", end: "14:10", color: "#1a2d3d", hex: "#3a6080" },
  { name: "EuroUSA",       begin: "14:10", end: "15:20", color: "#2d3d1a", hex: "#6a8a30" },
  { name: "EuroUsaNasQ",   begin: "15:20", end: "16:30", color: "#3d1a0d", hex: "#8a4a20" },
  { name: "UsaNasQ",       begin: "16:30", end: "19:10", color: "#1a0d3d", hex: "#502080" },
];

// Asia session for pattern matching = SydneyAsia (21:00-08:00)
const ASIA_SESSION_IDX = 0;

// ── Types ────────────────────────────────────────────────────────────────────
interface CandleRaw {
  time: number;   // Unix seconds (treated as broker server time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sessionName: string;
  sessionColor: string;
  sessionHex: string;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sessionName: string;
  sessionColor: string;
  sessionHex: string;
  isAsiaSession: boolean;
}

interface SessionBox {
  name: string;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  color: string;
  hex: string;
}

interface DayGroup {
  dayKey: string;           // "YYYY-MM-DD" of the DAY START (21:00 prev day)
  candles: Candle[];        // H1 aggregated candles for this group
  sessionBoxes: SessionBox[];
}

interface WavePoint {
  time: number;
  price: number;
  wavePercent: number;
  label: string;
}

interface SessionAnalysis {
  date: string;
  dateTimestamp: number;
  asiaHigh: number;
  asiaLow: number;
  asiaRange: number;
  asiaHighTime: number;
  asiaLowTime: number;
  peakWaves: WavePoint[];
  bottomWaves: WavePoint[];
  peakWavePercents: number[];
  bottomWavePercents: number[];
}

interface PatternMatch {
  date: string;
  dateTimestamp: number;
  score: number;
  peakScore: number;
  bottomScore: number;
  rangeScore: number;
  asiaRange: number;
  historicalCandles: Candle[];
  projectionPoints: WavePoint[];
}

// ── Parse broker time string "YYYY.MM.DD HH:MM" → Unix seconds ──────────────
function parseTime(s: string): number {
  const [datePart, timePart] = s.split(" ");
  const [y, mo, d] = datePart.split(".").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, 0) / 1000;
}

// ── Determine session for a given H:MM (broker time) ─────────────────────────
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function getSessionForTime(unixSec: number): { name: string; color: string; hex: string } {
  const d = new Date(unixSec * 1000);
  const barMin = d.getUTCHours() * 60 + d.getUTCMinutes();

  for (const sess of SESSION_DEFS) {
    const beg = timeToMinutes(sess.begin);
    const end = timeToMinutes(sess.end);
    if (beg < end) {
      if (barMin >= beg && barMin < end) return sess;
    } else {
      // Wraps midnight: SydneyAsia 21:00-08:00
      if (barMin >= beg || barMin < end) return sess;
    }
  }
  return { name: "Other", color: "#1a1a1a", hex: "#444" };
}

// ── Load & parse GOLD M5 CSV ──────────────────────────────────────────────────
let m5Cache: CandleRaw[] | null = null;

function loadM5(): CandleRaw[] {
  if (m5Cache) return m5Cache;

  const csvPath = path.join(__dirname, "../data/GOLDM5.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("[pattern-matcher] GOLDM5.csv not found at", csvPath);
    return [];
  }

  console.log("[pattern-matcher] Loading GOLDM5.csv...");
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split("\n").filter((l) => l.trim());
  const out: CandleRaw[] = [];

  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length < 6) continue;
    const timeStr = parts[0].trim();
    const open = parseFloat(parts[1]);
    const high = parseFloat(parts[2]);
    const low = parseFloat(parts[3]);
    const close = parseFloat(parts[4]);
    const volume = parseFloat(parts[5]);
    if (isNaN(open)) continue;

    const time = parseTime(timeStr);
    const sess = getSessionForTime(time);

    out.push({ time, open, high, low, close, volume, sessionName: sess.name, sessionColor: sess.color, sessionHex: sess.hex });
  }

  console.log(`[pattern-matcher] Loaded ${out.length} M5 candles`);
  m5Cache = out;
  return out;
}

// ── Aggregate M5 → M15 ────────────────────────────────────────────────────────
function aggregateToM15(m5: CandleRaw[]): Candle[] {
  // Each M15 bucket = a 15-minute window starting at :00 :15 :30 :45
  const buckets = new Map<number, CandleRaw[]>();

  for (const c of m5) {
    const d = new Date(c.time * 1000);
    const m15min = Math.floor(d.getUTCMinutes() / 15) * 15;
    const m15Ts  = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                            d.getUTCHours(), m15min, 0) / 1000;
    if (!buckets.has(m15Ts)) buckets.set(m15Ts, []);
    buckets.get(m15Ts)!.push(c);
  }

  const result: Candle[] = [];
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const ts of sortedKeys) {
    const bars = buckets.get(ts)!;
    const sess = bars[0];
    result.push({
      time: ts,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low:  Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
      sessionName: sess.sessionName,
      sessionColor: sess.sessionColor,
      sessionHex: sess.sessionHex,
      isAsiaSession: sess.sessionName === "SydneyAsia" || sess.sessionName === "Asia",
    });
  }

  return result;
}

// ── Aggregate M5 → H1 ─────────────────────────────────────────────────────────
function aggregateToH1(m5: CandleRaw[]): Candle[] {
  const buckets = new Map<number, CandleRaw[]>();

  for (const c of m5) {
    const d = new Date(c.time * 1000);
    const hourTs =
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0) / 1000;
    if (!buckets.has(hourTs)) buckets.set(hourTs, []);
    buckets.get(hourTs)!.push(c);
  }

  const result: Candle[] = [];
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const ts of sortedKeys) {
    const bars = buckets.get(ts)!;
    const sess = bars[0];
    result.push({
      time: ts,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
      sessionName: sess.sessionName,
      sessionColor: sess.sessionColor,
      sessionHex: sess.sessionHex,
      isAsiaSession: sess.sessionName === "SydneyAsia" || sess.sessionName === "Asia",
    });
  }

  return result;
}

// ── Group H1 candles into trading days (SydneyAsia day: 21:00 → 19:10 next) ──
function groupByTradingDay(h1: Candle[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let currentGroup: Candle[] = [];
  let currentKey = "";

  function getDayKey(c: Candle): string {
    const d = new Date(c.time * 1000);
    const h = d.getUTCHours();
    // END-date convention (matches CSV): session 21:00 UTC prev-night → 08:00 UTC morning
    // Label = the morning date (next calendar day after the 21:00 anchor)
    if (h >= 21) {
      // Evening candle → belongs to NEXT calendar day
      return new Date(c.time * 1000 + 86400 * 1000).toISOString().slice(0, 10);
    } else {
      // Early-morning candle (00:00–20:59) → already on the correct calendar day
      return d.toISOString().slice(0, 10);
    }
  }

  for (const candle of h1) {
    const key = getDayKey(candle);
    if (key !== currentKey) {
      if (currentGroup.length > 0) {
        groups.push(buildDayGroup(currentKey, currentGroup));
      }
      currentKey = key;
      currentGroup = [];
    }
    currentGroup.push(candle);
  }

  if (currentGroup.length > 0 && currentKey) {
    groups.push(buildDayGroup(currentKey, currentGroup));
  }

  return groups;
}

function buildDayGroup(dayKey: string, candles: Candle[]): DayGroup {
  const sessionBoxes: SessionBox[] = [];

  for (const sess of SESSION_DEFS) {
    const beg = timeToMinutes(sess.begin);
    const end = timeToMinutes(sess.end);
    const sessCandles = candles.filter((c) => {
      const d = new Date(c.time * 1000);
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (beg < end) return m >= beg && m < end;
      return m >= beg || m < end;
    });

    if (sessCandles.length > 0) {
      sessionBoxes.push({
        name: sess.name,
        startTime: sessCandles[0].time,
        endTime: sessCandles[sessCandles.length - 1].time + 3600,
        high: Math.max(...sessCandles.map((c) => c.high)),
        low: Math.min(...sessCandles.map((c) => c.low)),
        color: sess.color,
        hex: sess.hex,
      });
    }
  }

  return { dayKey, candles, sessionBoxes };
}

// ── Swing point detection ─────────────────────────────────────────────────────
interface SwingPoint {
  time: number;
  price: number;
  type: 1 | -1;
}

function isSwingHigh(candles: Candle[], idx: number, lookback: number): boolean {
  if (idx < lookback || idx >= candles.length - lookback) return false;
  const h = candles[idx].high;
  for (let i = 1; i <= lookback; i++) {
    if (candles[idx - i].high >= h) return false;
    if (candles[idx + i].high >= h) return false;
  }
  return true;
}

function isSwingLow(candles: Candle[], idx: number, lookback: number): boolean {
  if (idx < lookback || idx >= candles.length - lookback) return false;
  const l = candles[idx].low;
  for (let i = 1; i <= lookback; i++) {
    if (candles[idx - i].low <= l) return false;
    if (candles[idx + i].low <= l) return false;
  }
  return true;
}

function filterAlternating(swings: SwingPoint[]): SwingPoint[] {
  if (swings.length === 0) return [];
  const result: SwingPoint[] = [swings[0]];
  let lastType = swings[0].type;
  for (let i = 1; i < swings.length; i++) {
    const sw = swings[i];
    if (sw.type !== lastType) {
      result.push(sw);
      lastType = sw.type;
    } else {
      const last = result[result.length - 1];
      if (sw.type === 1 && sw.price > last.price) result[result.length - 1] = sw;
      else if (sw.type === -1 && sw.price < last.price) result[result.length - 1] = sw;
    }
  }
  return result;
}

function findWavesFromBar(
  candles: Candle[],
  startIdx: number,
  startPrice: number,
  startTime: number,
  asiaRange: number,
  swingLookback: number = SWING_LOOKBACK
): { percents: number[]; waves: WavePoint[] } {
  const swings: SwingPoint[] = [{ time: startTime, price: startPrice, type: 0 as any }];

  for (let i = startIdx + 1; i < candles.length && swings.length < 20; i++) {
    if (isSwingHigh(candles, i, swingLookback))
      swings.push({ time: candles[i].time, price: candles[i].high, type: 1 });
    if (isSwingLow(candles, i, swingLookback))
      swings.push({ time: candles[i].time, price: candles[i].low, type: -1 });
  }

  if (swings.length < 2) return { percents: [], waves: [] };

  const filtered = filterAlternating(swings);
  const percents: number[] = [];
  const waves: WavePoint[] = [];

  for (let w = 0; w < Math.min(8, filtered.length - 1); w++) {
    const waveSize = Math.abs(filtered[w + 1].price - filtered[w].price);
    const pct = (waveSize / asiaRange) * 100;
    percents.push(+pct.toFixed(1));
    waves.push({
      time: filtered[w + 1].time,
      price: filtered[w + 1].price,
      wavePercent: +pct.toFixed(1),
      label: `W${w + 1}`,
    });
  }

  return { percents, waves };
}

function analyzeSession(group: DayGroup, swingLookback: number = SWING_LOOKBACK): SessionAnalysis | null {
  const candles = group.candles;

  // SydneyAsia session (21:00–08:00 UTC) — matches MQL5 AsiaWave indicator v2 data
  const asiaCandles = candles.filter((c) => {
    const h = new Date(c.time * 1000).getUTCHours();
    return h >= 21 || h < 8;
  });
  if (asiaCandles.length === 0) return null;

  const asiaHigh = Math.max(...asiaCandles.map((c) => c.high));
  const asiaLow  = Math.min(...asiaCandles.map((c) => c.low));
  const asiaRange = asiaHigh - asiaLow;
  if (asiaRange <= 0) return null;

  let asiaHighTime = asiaCandles[0].time;
  let asiaLowTime  = asiaCandles[0].time;
  for (const c of asiaCandles) {
    if (c.high >= asiaHigh) asiaHighTime = c.time;
    if (c.low  <= asiaLow)  asiaLowTime  = c.time;
  }

  const asiaHighIdx = candles.findIndex((c) => c.time === asiaHighTime);
  const asiaLowIdx = candles.findIndex((c) => c.time === asiaLowTime);

  const peakResult   = findWavesFromBar(candles, asiaLowIdx,  asiaLow,  asiaLowTime,  asiaRange, swingLookback);
  const bottomResult = findWavesFromBar(candles, asiaHighIdx, asiaHigh, asiaHighTime, asiaRange, swingLookback);

  return {
    date: group.dayKey,
    dateTimestamp: candles[0].time,
    asiaHigh: +asiaHigh.toFixed(2),
    asiaLow: +asiaLow.toFixed(2),
    asiaRange: +asiaRange.toFixed(2),
    asiaHighTime,
    asiaLowTime,
    peakWaves: peakResult.waves,
    bottomWaves: bottomResult.waves,
    peakWavePercents: peakResult.percents,
    bottomWavePercents: bottomResult.percents,
  };
}

// ── Advanced wave comparison: DTW + Pearson + Direction ──────────────────────
//
// ХУУЧИН аргын асуудал:
//   today[0] vs hist[0], today[1] vs hist[1] → хатуу индекс alignment
//   Хурдны зөрүүтэй ч адилхан хэлбэрийн pattern алддаг
//
// ШИНЭ 3 арга:
//   1. DTW   (55%) — elastic alignment, магнитуд + хэлбэр
//   2. Pearson (30%) — магнитудаас үл хамаарах хэлбэр
//   3. Direction (15%) — wave acceleration fingerprint

/** DTW: Dynamic Time Warping — уян харимхай alignment (0–100) */
function dtwSimilarity(a: number[], b: number[]): number {
  const n = a.length, m = b.length;
  if (n === 0 || m === 0) return 0;
  // n,m max 8 тул матриц жижиг
  const dtw: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const avg  = (Math.abs(a[i - 1]) + Math.abs(b[j - 1])) / 2;
      const cost = avg > 0 ? (Math.abs(a[i - 1] - b[j - 1]) / avg) * 100 : 0;
      dtw[i][j]  = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }
  const pathLen = n + m - 1;
  return Math.max(0, 100 - dtw[n][m] / pathLen);
}

/** Pearson correlation → 0–100 score (магнитуд ялгааг үл хамааран хэлбэр таних) */
function pearsonScore(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len < 2) return 50;
  const ax = a.slice(0, len), bx = b.slice(0, len);
  const mA = ax.reduce((s, v) => s + v, 0) / len;
  const mB = bx.reduce((s, v) => s + v, 0) / len;
  let num = 0, ssA = 0, ssB = 0;
  for (let i = 0; i < len; i++) {
    const dA = ax[i] - mA, dB = bx[i] - mB;
    num += dA * dB; ssA += dA * dA; ssB += dB * dB;
  }
  const denom = Math.sqrt(ssA * ssB);
  if (denom === 0) return 50;
  // r: -1..1 → 0..100
  return Math.max(0, ((num / denom + 1) / 2) * 100);
}

/** Direction acceleration fingerprint — wave бүр өсч байна уу буурч байна уу? (0–100) */
function directionScore(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len < 2) return 50;
  let matches = 0;
  for (let i = 1; i < len; i++) {
    const aUp = a[i] >= a[i - 1];
    const bUp = b[i] >= b[i - 1];
    if (aUp === bUp) matches++;
  }
  return (matches / (len - 1)) * 100;
}

/**
 * compareWaveSequences — хуучин API-г хадгалж, дотор логикийг 3 аргаар сольсон.
 * Ижил signature тул call site өөрчлөх шаардлагагүй.
 *   DTW 55% + Pearson 30% + Direction 15%
 */
function compareWaveSequences(recent: number[], historical: number[], n: number): number {
  const rs = recent.length - n;
  const hs = historical.length - n;
  if (rs < 0 || hs < 0) return 0;
  const a = recent.slice(rs);       // сүүлийн n wave
  const b = historical.slice(hs);
  if (a.length < 2 || b.length < 2) return 0;

  const dtw  = dtwSimilarity(a, b);    // уян харимхай shape+магнитуд
  const pear = pearsonScore(a, b);     // магнитудаас үл хамаарах хэлбэр
  const dir  = directionScore(a, b);   // acceleration fingerprint

  return +(dtw * 0.55 + pear * 0.30 + dir * 0.15).toFixed(1);
}

function buildProjection(
  histSession: SessionAnalysis,
  histCandles: Candle[],
  todaySession: SessionAnalysis,
  todayCandles: Candle[],
  _compareWaves: number,
  swingLookback: number = SWING_LOOKBACK,
  includeAllWaves: boolean = false   // true = notification: бүх waves буцаана (past ч гэсэн)
): WavePoint[] {
  if (histCandles.length === 0) return [];
  // Note: todayCandles not used in projection math — only todaySession metadata (asiaHigh/Range/HighTime)

  const nowTime = Math.floor(Date.now() / 1000);

  // Anchor: histAsiaHighTime → todayAsiaHighTime (same as overlay for seamless continuity)
  const timeOffset = todaySession.asiaHighTime - histSession.asiaHighTime;

  // Scale: anchored at asiaHigh, proportional to asiaRange
  const scaleRatio = histSession.asiaRange > 0
    ? todaySession.asiaRange / histSession.asiaRange
    : 1;
  const tHigh = todaySession.asiaHigh;
  const hHigh = histSession.asiaHigh;
  const scalePrice = (p: number) => +(tHigh + (p - hHigh) * scaleRatio).toFixed(2);

  // ── Build zigzag swing points from asiaHigh onwards only ─────────────────────
  // Bottom waves start from asiaHigh — only use candles from that point.
  const rawSwings: { time: number; price: number; type: 1 | -1 }[] = [];
  for (let i = 0; i < histCandles.length; i++) {
    if (histCandles[i].time < histSession.asiaHighTime) continue; // skip pre-asiaHigh
    if (isSwingHigh(histCandles, i, swingLookback))
      rawSwings.push({ time: histCandles[i].time, price: histCandles[i].high, type:  1 });
    if (isSwingLow(histCandles, i, swingLookback))
      rawSwings.push({ time: histCandles[i].time, price: histCandles[i].low,  type: -1 });
  }
  // Add asiaHigh itself as the starting high anchor
  rawSwings.unshift({ time: histSession.asiaHighTime, price: histSession.asiaHigh, type: 1 });
  rawSwings.sort((a, b) => a.time - b.time);
  // Enforce strict alternation (High → Low → High …)
  const zigzag: { time: number; price: number; type: 1 | -1 }[] = [];
  for (const sw of rawSwings) {
    if (zigzag.length === 0) { zigzag.push(sw); continue; }
    const last = zigzag[zigzag.length - 1];
    if (sw.type === last.type) {
      // Keep the more extreme value
      if ((sw.type === 1 && sw.price > last.price) || (sw.type === -1 && sw.price < last.price))
        zigzag[zigzag.length - 1] = sw;
    } else {
      zigzag.push(sw);
    }
  }

  // ── Split into past bridge + future projection ─────────────────────────────
  //  includeAllWaves = true: notification context — бүх waves хэрэгтэй (past ч гэсэн).
  //    Эхний zigzag цэг = anchor (label=""), үлдсэн бүгд labeled waves болно.
  //  includeAllWaves = false (default): chart context — зөвхөн future waves.
  let bridge: { time: number; price: number } | null = null;
  const futurePoints: { time: number; price: number; idx: number }[] = [];

  if (includeAllWaves) {
    // Use all zigzag points; first = anchor (bridge), rest = labeled waves
    zigzag.forEach((sw, i) => {
      const alignedTime = sw.time + timeOffset;
      const price       = scalePrice(sw.price);
      if (i === 0) {
        bridge = { time: alignedTime, price };
      } else {
        futurePoints.push({ time: alignedTime, price, idx: futurePoints.length });
      }
    });
  } else {
    for (const sw of zigzag) {
      const alignedTime = sw.time + timeOffset;
      const price       = scalePrice(sw.price);
      if (alignedTime <= nowTime) {
        bridge = { time: alignedTime, price };
      } else {
        futurePoints.push({ time: alignedTime, price, idx: futurePoints.length });
      }
    }
  }

  if (futurePoints.length === 0) return [];

  const combined = bridge
    ? [{ time: bridge.time, price: bridge.price, idx: -1 }, ...futurePoints]
    : futurePoints;

  const asiaRange = todaySession.asiaRange; // prices already scaled to today's range
  return combined.map((p, i) => {
    if (i === 0) {
      // Bridge point — no label, just connects overlay→projection
      return { time: p.time, price: p.price, wavePercent: 0, label: "" };
    }
    const prev = combined[i - 1];
    const priceDiff = Math.abs(p.price - prev.price);
    const pct   = asiaRange > 0 ? Math.round(priceDiff / asiaRange * 100) : 0;
    const isUp  = p.price > prev.price;
    return {
      time:        p.time,
      price:       p.price,
      wavePercent: pct,
      label:       `W${i} ${isUp ? "+" : "-"}${pct}%`,
    };
  });
}

// Skip weekend: advance t to next trading time (Gold: Sun 22:00–Fri 22:00 UTC)
function skipWeekend(t: number): number {
  const d = new Date(t * 1000);
  const day  = d.getUTCDay();   // 0=Sun … 6=Sat
  const hour = d.getUTCHours();
  if (day === 6) {
    // Saturday → skip to Sunday 22:00
    const midnight = t - (t % 86400);
    return midnight + 86400 + 22 * 3600;
  }
  if (day === 0 && hour < 22) {
    // Sunday before 22:00 → skip to Sunday 22:00
    const midnight = t - (t % 86400);
    return midnight + 22 * 3600;
  }
  return t;
}

// Build zigzag projection from historical waves 7-8 scaled to today's Asia Range.
// Projects forward from the last known price, skipping weekends.
function buildWaveProjection(
  activeHistWaves: WavePoint[], // full wave list from best-match historical session
  matchCount: number,           // how many waves were used for matching (e.g. 6)
  currentPrice: number,
  lastTime: number,
  todayAsiaRange: number,
): WavePoint[] {
  const futureWaves = activeHistWaves.slice(matchCount);
  if (futureWaves.length === 0) return [];

  const result: WavePoint[] = [
    { time: lastTime, price: +currentPrice.toFixed(2), wavePercent: 0, label: "" },
  ];
  let prevPrice    = currentPrice;
  let prevHistPrice = matchCount > 0
    ? activeHistWaves[matchCount - 1].price
    : (activeHistWaves[0]?.price ?? currentPrice);
  let curTime = lastTime;

  for (let i = 0; i < futureWaves.length; i++) {
    const hw      = futureWaves[i];
    const prevHw  = i === 0 ? activeHistWaves[matchCount - 1] : futureWaves[i - 1];
    const direction  = hw.price >= prevHistPrice ? 1 : -1;
    const scaledMove = (hw.wavePercent / 100) * todayAsiaRange;
    const endPrice   = +(prevPrice + direction * scaledMove).toFixed(2);

    // Historical wave duration (clamped: 1h–12h)
    const dur   = Math.min(Math.max(hw.time - prevHw.time, 3600), 43200);
    const steps = Math.ceil(dur / 300); // one point per M5 bar
    const priceStep = (endPrice - prevPrice) / steps;

    for (let s = 1; s <= steps; s++) {
      curTime = skipWeekend(curTime + 300);
      const isLast = s === steps;
      result.push({
        time:        curTime,
        price:       isLast ? endPrice : +(prevPrice + priceStep * s).toFixed(2),
        wavePercent: isLast ? hw.wavePercent : 0,
        label:       isLast
          ? `W${matchCount + i + 1} ${direction > 0 ? "+" : "-"}${hw.wavePercent.toFixed(0)}%`
          : "",
      });
    }
    prevPrice     = endPrice;
    prevHistPrice = hw.price;
  }
  return result;
}

// Align historical candles to today's timeline for overlay
// Anchors at asiaHigh time (where bottom waves start) for maximum visual alignment.
// Only shows candles from asiaHigh time onwards so the wave path matches today's candles.
function buildAlignedOverlay(
  histCandles: Candle[],
  histSession: SessionAnalysis,
  todayCandles: Candle[],
  todaySession: SessionAnalysis
): { time: number; price: number }[] {
  if (histCandles.length === 0 || todayCandles.length === 0) return [];

  const nowTime = Math.floor(Date.now() / 1000);

  // Anchor: histAsiaHighTime → todayAsiaHighTime (bottom waves start from asiaHigh)
  const timeOffset = todaySession.asiaHighTime - histSession.asiaHighTime;

  // Scale: anchored at asiaHigh, proportional to asiaRange
  const scaleRatio = histSession.asiaRange > 0
    ? todaySession.asiaRange / histSession.asiaRange
    : 1;
  const tHigh = todaySession.asiaHigh;
  const hHigh = histSession.asiaHigh;

  // Anchor point: asiaHigh itself (line starts exactly at today's asiaHigh level)
  const anchorPt = { time: todaySession.asiaHighTime, price: tHigh };

  const postHighCandles = histCandles
    .filter((c) => c.time >= histSession.asiaHighTime) // only from asiaHigh onwards
    .map((c) => ({
      time:  c.time + timeOffset,
      // Normalize to histAsiaHigh, scale by ratio, shift to todayAsiaHigh
      price: +(tHigh + (c.close - hHigh) * scaleRatio).toFixed(2),
    }))
    .filter((p) => p.time <= nowTime);

  return [anchorPt, ...postHighCandles];
}

// ── Cached computed data ──────────────────────────────────────────────────────
let dataCache: {
  h1: Candle[];
  groups: DayGroup[];
  sessions: SessionAnalysis[];
} | null = null;

let dataCacheM5: {
  groups: DayGroup[];
  sessions: SessionAnalysis[];
} | null = null;

let dataCacheM15: {
  groups: DayGroup[];
  sessions: SessionAnalysis[];
} | null = null;

function getData() {
  if (dataCache) return dataCache;

  const m5 = loadM5();
  const h1 = aggregateToH1(m5);
  const groups = groupByTradingDay(h1);
  const sessions: SessionAnalysis[] = [];

  for (const g of groups) {
    const s = analyzeSession(g);
    if (s) sessions.push(s);
  }

  // Newest day first
  groups.reverse();
  sessions.reverse();

  console.log(`[pattern-matcher] ${groups.length} trading days, ${sessions.length} sessions analyzed`);
  dataCache = { h1, groups, sessions };
  return dataCache;
}

// M5-based pattern matching cache
function getDataM5() {
  if (dataCacheM5) return dataCacheM5;

  // loadM5() returns CandleRaw (no isAsiaSession) → add the field
  const m5raw = loadM5();
  const m5: Candle[] = m5raw.map((c) => ({
    ...c,
    isAsiaSession: c.sessionName === "SydneyAsia" || c.sessionName === "Asia",
  }));

  const groups = groupByTradingDay(m5);   // Group raw M5 bars by trading day
  const sessions: SessionAnalysis[] = [];

  for (const g of groups) {
    const s = analyzeSession(g, SWING_LOOKBACK_M5);
    if (s) sessions.push(s);
  }

  // Newest day first
  groups.reverse();
  sessions.reverse();

  console.log(`[pattern-matcher] M5 cache: ${groups.length} trading days, ${sessions.length} sessions`);
  dataCacheM5 = { groups, sessions };
  return dataCacheM5;
}

// M15-based pattern matching cache
function getDataM15() {
  if (dataCacheM15) return dataCacheM15;

  const m5raw = loadM5();
  const m15: Candle[] = aggregateToM15(m5raw);

  const groups = groupByTradingDay(m15);
  const sessions: SessionAnalysis[] = [];

  for (const g of groups) {
    const s = analyzeSession(g, SWING_LOOKBACK_M15);
    if (s) sessions.push(s);
  }

  groups.reverse();
  sessions.reverse();

  console.log(`[pattern-matcher] M15 cache: ${groups.length} trading days, ${sessions.length} sessions`);
  dataCacheM15 = { groups, sessions };
  return dataCacheM15;
}

// Merge today's CSV M5 candles + live H1 bars (appended at end, mixed resolution)
function mergeTodayM5Candles(csvM5Today: Candle[]): Candle[] {
  if (!liveH1Cache || liveH1Cache.bars.length === 0) return csvM5Today;
  const lastCsvTime = csvM5Today.length > 0 ? csvM5Today[csvM5Today.length - 1].time : 0;
  const liveExtra = liveH1Cache.bars
    .filter((b) => b.time > lastCsvTime)
    .map((b) => ({ ...b, isAsiaSession: b.sessionName === "SydneyAsia" || b.sessionName === "Asia" }));
  return [...csvM5Today, ...liveExtra];
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /ohlcv?bars=500
// Returns H1 candles (most recent N) with session info
router.get("/ohlcv", (req, res): void => {
  const bars = parseInt(req.query["bars"] as string) || 400;
  const { h1 } = getData();
  const slice = h1.slice(-bars);
  res.json(slice);
});

// GET /ohlcv-m5?bars=864
// Returns raw M5 candles (most recent N) for fine-grained chart
router.get("/ohlcv-m5", (req, res): void => {
  const bars = Math.min(parseInt(req.query["bars"] as string) || 864, 8640);
  const m5 = loadM5();
  const slice = m5.slice(-bars).map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    sessionName: c.sessionName,
    sessionColor: c.sessionColor,
    sessionHex: c.sessionHex,
    isAsiaSession: c.sessionName === "Asia" || c.sessionName === "SydneyAsia",
  }));
  res.json(slice);
});

// GET /ohlcv-m15?bars=288
// Returns M15 candles (aggregated from M5) for fine-grained chart
router.get("/ohlcv-m15", (req, res): void => {
  const bars = Math.min(parseInt(req.query["bars"] as string) || 288, 2880);
  const m5   = loadM5();
  const m15  = aggregateToM15(m5);
  const slice = m15.slice(-bars).map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low:  c.low,
    close: c.close,
    volume: c.volume,
    sessionName: c.sessionName,
    sessionColor: c.sessionColor,
    sessionHex: c.sessionHex,
    isAsiaSession: c.sessionName === "Asia" || c.sessionName === "SydneyAsia",
  }));
  res.json(slice);
});

// GET /sessions?days=5
// Returns session boxes per trading day
router.get("/sessions", (req, res): void => {
  const days = parseInt(req.query["days"] as string) || 5;
  const { groups } = getData();
  const result = groups.slice(0, days).map((g) => ({
    dayKey: g.dayKey,
    sessionBoxes: g.sessionBoxes,
  }));
  res.json(result);
});

// ── Merge CSV today-candles with live H1 bars (fills the gap after last CSV bar) ──
function mergeTodayCandles(csvCandles: Candle[]): Candle[] {
  if (!liveH1Cache || liveH1Cache.bars.length === 0) return csvCandles;
  const lastCsvTime = csvCandles.length > 0 ? csvCandles[csvCandles.length - 1].time : 0;
  const liveCandles: Candle[] = liveH1Cache.bars
    .filter((b) => b.time > lastCsvTime)
    .map((b) => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: 0,
      sessionName: b.sessionName ?? "live",
      sessionColor: b.sessionHex ?? "#d97706",
      sessionHex: b.sessionHex ?? "#d97706",
      isAsiaSession: false,
    }));
  return [...csvCandles, ...liveCandles];
}

// ── Return the Unix timestamp of the most recent SydneyAsia session start (21:00 UTC) ──
function currentSessionStart(): number {
  const now  = new Date();
  const utcH = now.getUTCHours();
  // The day boundary for our sessions is 21:00 UTC.
  // If it's before 21:00 UTC, the live session started yesterday at 21:00.
  const base = utcH >= 21
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 21, 0, 0))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 21, 0, 0));
  return Math.floor(base.getTime() / 1000);
}

// Day key for the live session that starts at sessStart (21:00 UTC prev-evening)
function liveDayKey(sessStartTs: number): string {
  // Convention: label = the morning date (calendar day AFTER the 21:00 anchor)
  return new Date((sessStartTs + 86400) * 1000).toISOString().slice(0, 10);
}

// GET /matches?days=365&minWaves=3&tolerance=20&tf=m5
// Pattern matching using real GOLD data
router.get("/matches", async (req, res): Promise<void> => {
  // Ensure live H1 cache is fresh before computing overlay/projection
  if (!liveH1Cache || Date.now() - liveH1Cache.fetchedAt > LIVE_H1_TTL_MS) {
    await fetchLiveH1Bars(72);
  }

  const days      = parseInt(req.query["days"]      as string) || 365;
  const minWaves  = parseInt(req.query["minWaves"]  as string) || 6;
  const tolerance = parseFloat(req.query["tolerance"] as string) || 20.0;
  const tf        = (req.query["tf"] as string ?? "m5").toLowerCase();  // "m5" | "m15" | "h1"

  const useM15 = tf === "m15";
  const useM5  = !useM15 && tf !== "h1";

  // ── Pick historical data source ────────────────────────────────────────────
  const { groups, sessions } = useM15 ? getDataM15() : useM5 ? getDataM5() : getData();
  const swingLookback = useM15 ? SWING_LOOKBACK_M15 : useM5 ? SWING_LOOKBACK_M5 : SWING_LOOKBACK;

  if (sessions.length < 2) {
    res.json({ today: null, matches: [], currentCandles: [], bestMatch: null, tf });
    return;
  }

  // ── Build "today" from LIVE H1 bars for the current session ──────────────
  // This is the CURRENT LIVE session (e.g. March 25 21:00 → now March 26 09:xx).
  // We do NOT fall back to the last completed CSV session because that would create
  // a 35-hour merged session that misaligns the projection entirely.
  const sessStart  = currentSessionStart();
  const liveToday: Candle[] = (liveH1Cache?.bars ?? [])
    .filter((b) => b.time >= sessStart)
    .map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0,
      sessionName: b.sessionName ?? "live",
      sessionColor: b.sessionColor ?? "#d97706",
      sessionHex:   b.sessionHex  ?? "#d97706",
      isAsiaSession: b.sessionName === "SydneyAsia" || b.sessionName === "Asia",
    }));

  // If we have at least 3 live H1 bars, match against those; otherwise fall
  // back to the last completed session so the page still shows something.
  const useLive     = liveToday.length >= 3;
  const dayKey      = useLive ? liveDayKey(sessStart) : sessions[0].date;
  const todayCandles: Candle[] = useLive
    ? liveToday
    : (useM5 ? mergeTodayM5Candles(groups[0]?.candles ?? []) : mergeTodayCandles(groups[0]?.candles ?? []));

  const mergedGroup = buildDayGroup(dayKey, todayCandles);

  // ── Build "today" wave pattern ─────────────────────────────────────────────
  // Live H1 bars often have too few post-Asia bars for swing detection (lookback=2
  // requires the bar to be the local extreme among ±2 neighbors, but 06:00 asiaLow
  // leaves only 4 bars → no swings found). Fix: always prefer M5 CSV data for
  // wave-percent computation (M5 has 130+ bars/session, reliable swing detection),
  // then fall back to the raw live session only if M5 has nothing.
  const m5ForWaves   = getDataM5();
  const todayDateKey = liveDayKey(sessStart);
  const m5Today      = m5ForWaves.sessions.find((s) => s.date === todayDateKey)
                    ?? m5ForWaves.sessions[0];

  const liveSession = analyzeSession(mergedGroup, swingLookback);

  // Prefer M5 waves (better resolution), fall back to live H1, then last CSV session
  const todaySession: SessionAnalysis = (() => {
    if (m5Today && (m5Today.peakWavePercents.length > 0 || m5Today.bottomWavePercents.length > 0)) {
      // Use M5 wave percents but keep live session metadata (date, asiaRange, etc.)
      return {
        ...(liveSession ?? m5Today),
        peakWavePercents:   m5Today.peakWavePercents,
        bottomWavePercents: m5Today.bottomWavePercents,
        peakWaves:          m5Today.peakWaves,
        bottomWaves:        m5Today.bottomWaves,
      };
    }
    return liveSession ?? sessions[0];
  })();

  const comparePeak   = Math.min(minWaves, todaySession.peakWavePercents.length);
  const compareBottom = Math.min(minWaves, todaySession.bottomWavePercents.length);
  // If a path has fewer waves than minWaves, its score is unreliable → skip it
  const todayPeakOK   = todaySession.peakWavePercents.length   >= minWaves;
  const todayBottomOK = todaySession.bottomWavePercents.length >= minWaves;

  // ── Score all historical days ───────────────────────────────────────────────
  // Direction: 'down' = asiaHigh formed BEFORE asiaLow (price fell during Asia)
  //            'up'   = asiaLow formed BEFORE asiaHigh (price rose during Asia)
  // Only compare sessions with the SAME direction — opposite-direction sessions
  // will have visually mirrored charts and produce misleading matches.
  const todayDirection = todaySession.asiaHighTime <= todaySession.asiaLowTime ? "down" : "up";

  const histLimit = Math.min(days, sessions.length - 1);
  // Today: seasonal month for bias matching
  const todayMonth = new Date().getMonth() + 1; // 1-12

  const allMatches: {
    session: SessionAnalysis;
    candles: Candle[];
    peakScore: number;
    bottomScore: number;
    rangeScore: number;
    ratioScore: number;
    seasonalScore: number;
    combined: number;
  }[] = [];

  for (let i = 1; i <= histLimit; i++) {
    const hist = sessions[i];
    const histCandles = groups[i]?.candles ?? [];

    // ── Direction filter ────────────────────────────────────────────────────
    const histDirection = hist.asiaHighTime <= hist.asiaLowTime ? "down" : "up";
    if (histDirection !== todayDirection) continue; // skip opposite-direction sessions

    // ── Sub-score helper: DTW + Pearson + Direction for a wave pair ──────────
    const calcSubScores = (todayW: number[], histW: number[], n: number) => {
      const rs = todayW.length - n, hs = histW.length - n;
      if (rs < 0 || hs < 0 || n < 2) return { total: 0, dtw: 0, pearson: 0, dir: 0 };
      const a = todayW.slice(rs), b = histW.slice(hs);
      if (a.length < 2 || b.length < 2) return { total: 0, dtw: 0, pearson: 0, dir: 0 };
      const dtw    = +dtwSimilarity(a, b).toFixed(1);
      const pearson = +pearsonScore(a, b).toFixed(1);
      const dir    = +directionScore(a, b).toFixed(1);
      return { total: +(dtw * 0.55 + pearson * 0.30 + dir * 0.15).toFixed(1), dtw, pearson, dir };
    };

    let peakScore = 0, peakDtw = 0, peakPearson = 0, peakDir = 0;
    if (comparePeak >= 2 && hist.peakWavePercents.length >= comparePeak) {
      const s = calcSubScores(todaySession.peakWavePercents, hist.peakWavePercents, comparePeak);
      peakScore = s.total; peakDtw = s.dtw; peakPearson = s.pearson; peakDir = s.dir;
    }
    let bottomScore = 0, btmDtw = 0, btmPearson = 0, btmDir = 0;
    if (compareBottom >= 2 && hist.bottomWavePercents.length >= compareBottom) {
      const s = calcSubScores(todaySession.bottomWavePercents, hist.bottomWavePercents, compareBottom);
      bottomScore = s.total; btmDtw = s.dtw; btmPearson = s.pearson; btmDir = s.dir;
    }

    // Use only paths that have sufficient today waves; avoid inflating scores
    let waveScore: number;
    if (todayPeakOK && todayBottomOK) {
      waveScore = (peakScore + bottomScore) / 2;
    } else if (todayPeakOK) {
      waveScore = peakScore;
    } else if (todayBottomOK) {
      waveScore = bottomScore;
    } else {
      waveScore = (peakScore + bottomScore) / 2; // both sparse, best effort
    }

    // Range similarity (scale match)
    const rangeScore = 100 * (1 - Math.abs(todaySession.asiaRange - hist.asiaRange)
      / Math.max(todaySession.asiaRange, hist.asiaRange, 1));

    // D: Wave ratio score — how similarly waves expand/contract
    const activeToday = todayBottomOK ? todaySession.bottomWavePercents : todaySession.peakWavePercents;
    const activeHist  = todayBottomOK ? hist.bottomWavePercents : hist.peakWavePercents;
    const ratioScore  = calcRatioScore(activeToday, activeHist);

    // A: Seasonal score — same month = 100, adjacent = 60, else = 30
    const histMonth = new Date(hist.date + "T00:00:00Z").getMonth() + 1;
    const monthDiff = Math.abs(histMonth - todayMonth);
    const seasonalScore = monthDiff === 0 ? 100 : (monthDiff === 1 || monthDiff === 11) ? 60 : 30;

    // Combined: wave 60% · range 20% · ratio 12% · seasonal 8%
    const combined = +(waveScore * 0.60 + rangeScore * 0.20 + ratioScore * 0.12 + seasonalScore * 0.08).toFixed(1);

    allMatches.push({
      session: hist,
      candles: histCandles,
      peakScore:     +peakScore.toFixed(1),
      bottomScore:   +bottomScore.toFixed(1),
      rangeScore:    +rangeScore.toFixed(1),
      ratioScore:    +ratioScore.toFixed(1),
      seasonalScore: +seasonalScore.toFixed(1),
      combined,
      // DTW sub-scores for breakdown display
      dtwPeak:     peakDtw,   pearsonPeak:  peakPearson,  dirPeak:  peakDir,
      dtwBtm:      btmDtw,    pearsonBtm:   btmPearson,   dirBtm:   btmDir,
    });
  }

  allMatches.sort((a, b) => b.combined - a.combined);

  // H1 data is always needed for mini side-charts (historicalCandles) and H1 overlay
  const h1Data   = getData();
  const h1Groups = h1Data.groups;

  // For M5/M15: build today's session candles at M5/M15 resolution for overlay alignment.
  // groups[0] is newest day (current partial session) — filter bars from session start.
  let overlayTodayCandles: Candle[] = todayCandles; // H1 live bars (default)
  let overlayTodaySession: SessionAnalysis = todaySession;
  if (useM5 || useM15) {
    const subMinuteTodayCandles = groups[0]?.candles.filter((c) => c.time >= sessStart) ?? [];
    if (subMinuteTodayCandles.length >= 4) {
      const todayGroup = buildDayGroup(dayKey, subMinuteTodayCandles);
      const todaySess  = analyzeSession(todayGroup, swingLookback);
      if (todaySess) {
        overlayTodayCandles = subMinuteTodayCandles;
        overlayTodaySession = todaySess;
      }
    }
  }

  // Last known M5 bar → anchor for wave projection (groups[0] = newest session)
  const lastM5Bar = useM5 ? (groups[0]?.candles.at(-1) ?? null) : null;
  const projCurrentPrice = lastM5Bar?.close ?? todaySession.asiaHigh;
  const projLastTime     = lastM5Bar?.time  ?? Math.floor(Date.now() / 1000);
  // Active wave path: bottom if today has ≥ minWaves bottom waves, else peak
  const projUseBottom = todayBottomOK;

  const matchResults: (PatternMatch & { alignedOverlay: { time: number; price: number }[] })[] =
    allMatches.slice(0, days).map((m) => {
      // Historical H1 candles for side mini-charts (always H1 resolution)
      const h1Group       = h1Groups.find((g) => g.dayKey === m.session.date);
      const h1HistCandles = h1Group?.candles ?? m.candles.filter((_, idx) => idx % 12 === 0);

      // Overlay/projection: use M5/M15 candles when in sub-minute mode, else H1
      const overlayHistCandles = (useM5 || useM15) ? m.candles : h1HistCandles;
      const overlayHistSession = (useM5 || useM15) ? m.session
        : (h1Data.sessions.find((s) => s.date === m.session.date) ?? m.session);

      // B: ML max extension lookup — find matching ML row by date
      const mlRow = mlDataset.find(r => r.date === m.session.date);
      const mlMaxUpExt   = mlRow?.max_up_ext_pct   ?? null;
      const mlMaxDownExt = mlRow?.max_down_ext_pct ?? null;
      const mlOutcome    = mlRow?.outcome           ?? null;
      const mlFirstBreak = mlRow?.first_break       ?? null;

      return {
        date: m.session.date,
        dateTimestamp: m.session.dateTimestamp,
        score: m.combined,
        peakScore:     m.peakScore,
        bottomScore:   m.bottomScore,
        rangeScore:    m.rangeScore,
        ratioScore:    m.ratioScore,
        seasonalScore: m.seasonalScore,
        // DTW/Pearson/Direction sub-scores (wave breakdown panel)
        dtwPeak:    m.dtwPeak,    pearsonPeak: m.pearsonPeak, dirPeak: m.dirPeak,
        dtwBtm:     m.dtwBtm,     pearsonBtm:  m.pearsonBtm,  dirBtm:  m.dirBtm,
        asiaRange: m.session.asiaRange,
        asiaHigh:  m.session.asiaHigh,
        asiaLow:   m.session.asiaLow,
        // B: ML outcome/extension from matched historical session
        mlOutcome,
        mlFirstBreak,
        mlMaxUpExt,
        mlMaxDownExt,
        historicalCandles: h1HistCandles,
        alignedOverlay:   buildAlignedOverlay(overlayHistCandles, overlayHistSession, overlayTodayCandles, overlayTodaySession),
        projectionPoints: buildWaveProjection(
          projUseBottom ? m.session.bottomWaves : m.session.peakWaves,
          projUseBottom ? compareBottom : comparePeak,
          projCurrentPrice,
          projLastTime,
          overlayTodaySession.asiaRange,
        ),
      };
    });

  const bestMatch = matchResults[0] ?? null;

  // Today's wave points for chart markers
  const todayWaveMarkers = [
    ...todaySession.peakWaves.map((w) => ({ ...w, type: "peak" as const })),
    ...todaySession.bottomWaves.map((w) => ({ ...w, type: "bottom" as const })),
  ].sort((a, b) => a.time - b.time);

  const matchMode = todayPeakOK && todayBottomOK
    ? 'peak+bottom'
    : todayPeakOK ? 'peak-only'
    : todayBottomOK ? 'bottom-only'
    : 'sparse';

  // ── HIGH PROBABILITY PATTERN check ─────────────────────────────────────────
  // Match today's quantized waves against the ML-derived pattern database
  const activeWaveType = todayBottomOK ? "BOTTOM" : "PEAK";
  const activeWaves = todayBottomOK
    ? todaySession.bottomWavePercents
    : todaySession.peakWavePercents;
  const highProbPatternMatch = checkHighProbPattern(activeWaves, activeWaveType as "PEAK" | "BOTTOM");

  // Best match score exceeds the HIGH PROBABILITY threshold
  const bestScore = matchResults[0]?.score ?? 0;
  const isHighProbScore = bestScore >= HIGH_PROB_SCORE_THRESHOLD;

  const highProbAlert = highProbPatternMatch.matched || isHighProbScore
    ? {
        active: true,
        reason: highProbPatternMatch.matched
          ? `ML ${highProbPatternMatch.patternName} — ${highProbPatternMatch.signal} (Edge: ${highProbPatternMatch.edge}%, ${highProbPatternMatch.count}x)`
          : `Best score ${bestScore}% ≥ ${HIGH_PROB_SCORE_THRESHOLD}% threshold`,
        patternMatch: highProbPatternMatch.matched ? highProbPatternMatch : null,
        scoreTriggered: isHighProbScore,
        bestScore,
      }
    : { active: false, reason: "", patternMatch: null, scoreTriggered: false, bestScore };

  // ── ML Prediction ───────────────────────────────────────────────────────────
  const qBottomWaves = todaySession.bottomWavePercents.slice(0,4).map(quantizeToFib);
  const qPeakWaves   = todaySession.peakWavePercents.slice(0,4).map(quantizeToFib);
  const rangePips    = todaySession.asiaRange * 10;
  const mlPrediction = computeMLPrediction(
    todayDirection,
    qBottomWaves,
    qPeakWaves,
    rangePips,
    todaySession.asiaRange,
    todaySession.asiaHigh,
    todaySession.asiaLow,
  );

  // Asia session completion: asiaLowTime-аас 30+ мин өнгөрсөн бол complete
  const nowSecApi = Math.floor(Date.now() / 1000);
  const asiaCompleteApi = todaySession.asiaLowTime > 0 && nowSecApi > todaySession.asiaLowTime + 30 * 60;

  // C: Seasonal bias for current month
  const currentMonth = new Date().getMonth() + 1;
  const seasonalBias = MONTHLY_BIAS[currentMonth] ?? null;

  // B: ML-based extension targets from top-3 matched sessions
  // Only use sessions that have valid positive extension data
  const top3WithML = matchResults.slice(0, 3).filter(m => m.mlMaxUpExt != null);
  // Filter: positive upExt = historical session DID go up; positive downExt = DID go down
  const withPosUp   = top3WithML.filter(m => (m.mlMaxUpExt   ?? 0) > 0);
  const withPosDown = top3WithML.filter(m => (m.mlMaxDownExt ?? 0) > 0);
  let mlExtensionTarget: {
    avgUpExt: number; avgDownExt: number;
    t1Up: number; t2Up: number; t3Up: number;
    t1Down: number; t2Down: number; t3Down: number;
    upSessions: number; downSessions: number;
  } | null = null;
  if (top3WithML.length > 0) {
    // Use only positive extensions; fallback to overall average if no positive found
    const upArr   = withPosUp.length   > 0 ? withPosUp   : top3WithML;
    const downArr = withPosDown.length > 0 ? withPosDown : top3WithML;
    const avgUp   = Math.max(0, upArr.reduce((s, m)   => s + Math.abs(m.mlMaxUpExt   ?? 0), 0) / upArr.length);
    const avgDown = Math.max(0, downArr.reduce((s, m) => s + Math.abs(m.mlMaxDownExt ?? 0), 0) / downArr.length);
    const range   = todaySession.asiaRange;
    const base    = todaySession.asiaHigh; // UP targets anchor at asiaHigh
    const baseDn  = todaySession.asiaLow;  // DOWN targets anchor at asiaLow
    mlExtensionTarget = {
      avgUpExt:    +avgUp.toFixed(1),
      avgDownExt:  +avgDown.toFixed(1),
      upSessions:  withPosUp.length,
      downSessions: withPosDown.length,
      // T1=33% / T2=67% / T3=100% of average extension × range
      t1Up:   +(base   + range * (avgUp   / 100) * 0.33).toFixed(2),
      t2Up:   +(base   + range * (avgUp   / 100) * 0.67).toFixed(2),
      t3Up:   +(base   + range * (avgUp   / 100) * 1.00).toFixed(2),
      t1Down: +(baseDn - range * (avgDown / 100) * 0.33).toFixed(2),
      t2Down: +(baseDn - range * (avgDown / 100) * 0.67).toFixed(2),
      t3Down: +(baseDn - range * (avgDown / 100) * 1.00).toFixed(2),
    };
  }

  res.json({
    today: todaySession,
    todayWaveMarkers,
    matches: matchResults,
    bestMatch,
    currentCandles: todayCandles,
    sessionDefs: SESSION_DEFS,
    tf,
    matchMode,
    todayDirection,
    todayPeakWaves: todaySession.peakWavePercents.length,
    todayBottomWaves: todaySession.bottomWavePercents.length,
    highProbAlert,
    mlPrediction,
    qBottomWaves,
    qPeakWaves,
    asiaComplete: asiaCompleteApi,
    seasonalBias,         // C: monthly seasonal bias
    mlExtensionTarget,    // B: ML-derived T1/T2/T3 extension targets
  });
});

// ── Live Gold Price (Twelve Data primary, metalpriceapi fallback) ─────────────
interface LivePriceCache {
  price: number;
  timestamp: number;
  isoDate: string;
  change?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  open?: number;
  isMarketOpen?: boolean;
  source: string;
}
let livePriceCache: LivePriceCache | null = null;
let livePriceFetchedAt = 0;
const LIVE_PRICE_TTL_MS = 60 * 1000; // re-fetch every 1 minute (Twelve Data is real-time)

// Shared live price fetch helper (used by route + notification)
async function fetchLivePrice(): Promise<LivePriceCache | null> {
  const tdKey = process.env.TWELVE_DATA_API_KEY;
  const now   = Date.now();
  if (livePriceCache && now - livePriceFetchedAt < LIVE_PRICE_TTL_MS) return livePriceCache;
  if (tdKey) {
    try {
      const resp = await fetch(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${tdKey}`);
      const d = (await resp.json()) as any;
      if (d.close && !d.code) {
        livePriceCache = {
          price: +parseFloat(d.close).toFixed(2), timestamp: d.last_quote_at,
          isoDate: new Date(d.last_quote_at * 1000).toISOString(),
          change: +parseFloat(d.change).toFixed(2),
          changePercent: +parseFloat(d.percent_change).toFixed(3),
          high: +parseFloat(d.high).toFixed(2), low: +parseFloat(d.low).toFixed(2),
          open: +parseFloat(d.open).toFixed(2), isMarketOpen: d.is_market_open,
          source: "twelvedata",
        };
        livePriceFetchedAt = now;
        return livePriceCache;
      }
    } catch (_) {}
  }
  return livePriceCache; // return stale cache if fetch fails
}

router.get("/live-price", async (req, res) => {
  const tdKey  = process.env.TWELVE_DATA_API_KEY;
  const mpKey  = process.env.METAL_PRICE_API_KEY;
  const now    = Date.now();
  const force  = req.query.force === "1";

  // Return cache if still fresh
  if (!force && livePriceCache && now - livePriceFetchedAt < LIVE_PRICE_TTL_MS) {
    return res.json({ ...livePriceCache, cached: true });
  }

  // ── 1. Try Twelve Data (real-time) ────────────────────────────────────────
  if (tdKey) {
    try {
      const resp = await fetch(
        `https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${tdKey}`
      );
      const d = (await resp.json()) as any;
      if (d.close && !d.code) {
        livePriceCache = {
          price:         +parseFloat(d.close).toFixed(2),
          timestamp:     d.last_quote_at,
          isoDate:       new Date(d.last_quote_at * 1000).toISOString(),
          change:        +parseFloat(d.change).toFixed(2),
          changePercent: +parseFloat(d.percent_change).toFixed(3),
          high:          +parseFloat(d.high).toFixed(2),
          low:           +parseFloat(d.low).toFixed(2),
          open:          +parseFloat(d.open).toFixed(2),
          isMarketOpen:  d.is_market_open,
          source:        "twelvedata",
        };
        livePriceFetchedAt = now;
        return res.json({ ...livePriceCache, cached: false });
      }
      console.warn("[live-price] Twelve Data error:", d.code, d.message);
    } catch (e) {
      console.warn("[live-price] Twelve Data fetch failed:", e);
    }
  }

  // ── 2. Fallback: metalpriceapi.com (24h delayed) ─────────────────────────
  if (mpKey) {
    try {
      const resp = await fetch(
        `https://api.metalpriceapi.com/v1/latest?api_key=${mpKey}&base=USD&currencies=XAU`
      );
      const d = (await resp.json()) as any;
      if (d.success) {
        const xauPerUsd: number = d.rates?.XAU;
        livePriceCache = {
          price:     xauPerUsd ? +(1 / xauPerUsd).toFixed(2) : 0,
          timestamp: d.timestamp,
          isoDate:   new Date(d.timestamp * 1000).toISOString(),
          source:    "metalpriceapi (24h delayed)",
        };
        livePriceFetchedAt = now;
        return res.json({ ...livePriceCache, cached: false });
      }
    } catch (e) {
      console.warn("[live-price] metalpriceapi fetch failed:", e);
    }
  }

  // Return stale cache if all fetches fail
  if (livePriceCache) return res.json({ ...livePriceCache, cached: true, stale: true });
  return res.status(503).json({ error: "No price source configured" });
});

// ── Telegram Notification ─────────────────────────────────────────────────────
interface TelegramNotifState {
  lastBestMatchDate: string | null;
  lastNotifiedAt: number;
  lastHighProbKey: string | null;   // e.g. "BOTTOM:BUY:2026-03-26"
  lastBestScore: number;            // last notified best score (to detect big jumps)
  lastMessageText: string | null;   // last full message text sent to Telegram
}
const telegramState: TelegramNotifState = {
  lastBestMatchDate: null,
  lastNotifiedAt: 0,
  lastHighProbKey: null,
  lastBestScore: 0,
  lastMessageText: null,
};

async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const d = (await r.json()) as any;
    if (!d.ok) return { ok: false, error: d.description ?? "Telegram API error" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function sendTelegramPhoto(imageBase64: string, caption: string): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" };
  try {
    const imageBuffer = Buffer.from(imageBase64, "base64");
    // Build multipart/form-data manually using FormData
    const { FormData, Blob } = await import("node:buffer").catch(() => ({ FormData: null, Blob: null }));
    // Use global fetch with FormData (Node 18+)
    const form = new (globalThis as any).FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    // Append image as a Blob
    const blob = new (globalThis as any).Blob([imageBuffer], { type: "image/jpeg" });
    form.append("photo", blob, "chart.jpg");
    // Telegram caption limit = 1024 chars
    const captionTrunc = caption.length > 1024 ? caption.slice(0, 1021) + "…" : caption;
    form.set("caption", captionTrunc);
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const d = (await r.json()) as any;
    if (!d.ok) return { ok: false, error: d.description ?? "Telegram sendPhoto error" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

function buildMatchBlock(match: PatternMatch, rank: number, currentPrice?: number): string[] {
  const rankLabel = rank === 1 ? "🥇 #1 Best match" : "🥈 #2 Match";
  const emoji = match.score >= 80 ? "🟢" : match.score >= 65 ? "🟡" : "🟠";
  const lines: string[] = [
    ``,
    `🔍 <b>${rankLabel}: ${match.date}</b>`,
    `   ${emoji} Score: <b>${match.score.toFixed(1)}%</b>   Peak: ${match.peakScore.toFixed(0)}%  Bottom: ${match.bottomScore.toFixed(0)}%`,
    `   Asia Range: $${match.asiaRange.toFixed(2)}`,
  ];
  if (match.projectionPoints?.length) {
    const realPts = match.projectionPoints.filter((p) => p.label && p.label !== "");
    const last = realPts.length > 0 ? realPts[realPts.length - 1] : match.projectionPoints[match.projectionPoints.length - 1];

    let moveStr = "";
    if (currentPrice && currentPrice > 0) {
      const diff   = last.price - currentPrice;
      const pct    = (diff / currentPrice) * 100;
      const arrow  = diff >= 0 ? "📈" : "📉";
      const sign   = diff >= 0 ? "+" : "";
      moveStr = `  ${arrow} <b>${sign}$${Math.abs(diff).toFixed(2)} (${sign}${pct.toFixed(2)}%)</b>`;
    }

    lines.push(`   🎯 Target: <b>$${last.price.toFixed(2)}</b>${moveStr}  <i>(${last.label})</i>`);

    // Also show the projection path high/low (best-case range along the way)
    const allProjPrices = match.projectionPoints.map((p) => p.price);
    const projHigh = Math.max(...allProjPrices);
    const projLow  = Math.min(...allProjPrices);
    if (currentPrice && currentPrice > 0) {
      const highDiff = projHigh - currentPrice;
      const lowDiff  = projLow  - currentPrice;
      const highSign = highDiff >= 0 ? "+" : "";
      const lowSign  = lowDiff  >= 0 ? "+" : "";
      lines.push(`   📊 Path range: $${projLow.toFixed(2)} (${lowSign}$${Math.abs(lowDiff).toFixed(0)}) ~ $${projHigh.toFixed(2)} (${highSign}$${Math.abs(highDiff).toFixed(0)})`);
    }
  }
  return lines;
}

function buildNotifText(
  matches: PatternMatch[],
  today: SessionAnalysis | null,
  price: LivePriceCache | null,
  _trigger: string,
  highProbAlert?: { active: boolean; reason: string; patternMatch: any; scoreTriggered: boolean; bestScore: number },
  mlPrediction?: ReturnType<typeof computeMLPrediction>
): string {
  const dateStr   = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const priceStr  = price ? `$${price.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "N/A";
  const changePct = price?.changePercent !== undefined
    ? ` (${price.changePercent >= 0 ? "+" : ""}${price.changePercent.toFixed(2)}%)`
    : "";
  const fmt = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lines: string[] = [`🌊 <b>AsiaWave Signal</b>  ·  ${dateStr}`];

  // ── No match yet ──────────────────────────────────────────────────────────
  if (!today || matches.length === 0) {
    lines.push(`💰 GOLD: <b>${priceStr}${changePct}</b>`);
    lines.push(`<i>No pattern match yet</i>`);
    return lines.join("\n");
  }

  const bestMatch = matches[0];

  // ── projectionPoints → direction (history match-ийн бодит явцаар) ────────
  //    anchor (label="") → W1: UP → BUY, DOWN → SELL
  const pts      = (bestMatch.projectionPoints ?? []).filter(p => p.price > 0);
  const realPts  = pts.filter(p => p.label && p.label !== "");
  const anchorPt = pts.find(p => !p.label || p.label === "") ?? null;
  const w1Pt0    = realPts[0] ?? null;
  const histDir  = anchorPt && w1Pt0
    ? (w1Pt0.price > anchorPt.price ? "UP" : "DOWN")
    : null;

  // ── Asia session completion check ─────────────────────────────────────────
  //  BOTTOM/PEAK pattern-ийн сигнал нь Asia session дууссаны ДАРААГИЙН session-д хамаарна.
  //  Asia session: 01:00-09:00 UTC. asiaLowTime өнгөрсөн бол complete гэж үзнэ.
  const nowSec = Math.floor(Date.now() / 1000);
  const asiaComplete = today.asiaLowTime > 0 && nowSec > today.asiaLowTime + 30 * 60;
  // (asiaLow-оос 30+ минут өнгөрсөн бол session complete гэж тооцно)

  // ── Direction priority: history match → score fallback ────────────────────
  //  HIGH PROB pattern нь session-ийн forecast (next session direction) —
  //  isBull-ийг override ХИЙХГҮЙ. Direction = history match эсвэл score.
  //  (HIGH PROB нь зөвхөн мессежийн header хэсэгт contextual info болгон харуулна)
  const isBull = histDir !== null
    ? histDir === "UP"
    : (bestMatch.bottomScore ?? 0) > (bestMatch.peakScore ?? 0);

  const dirSource = histDir !== null ? "history match" : "score";

  const dirLabel  = isBull ? "BUY" : "SELL";
  const dirIcon   = isBull ? "🟢" : "🔴";
  const waveScore = isBull ? bestMatch.bottomScore?.toFixed(1) : bestMatch.peakScore?.toFixed(1);

  // ── Entry: wave бүтцээс тодорхойлно ──────────────────────────────────────
  //
  //  BUY:
  //    Эхний "-" wave = уналтын цэг → LIMIT BUY (унтал хүлээ, тэнд орно)
  //    "-" wave байхгүй бол anchor = MARKET BUY (одоо орно)
  //
  //  SELL:
  //    anchor > today.asiaHigh → ICT sweep болсон → MARKET SELL (одоо anchor дээр орно)
  //    sweep байхгүй бол эхний "+" wave = bounce цэг → LIMIT SELL (bounce хүлээ)
  //
  const minBuf = +(today.asiaRange * 0.08).toFixed(2);

  let entry: number;
  let entryLabel: string;
  let orderType: string;
  let entryWaveIdx: number = -1;   // wave map дотор entry мөрийн индекс

  if (isBull) {
    // BUY: эхний уналт ("-") = дипийн level = LIMIT BUY entry
    const dipIdx = realPts.findIndex(p => p.label.includes("-"));
    if (dipIdx >= 0) {
      entry      = realPts[dipIdx].price;
      entryLabel = `${realPts[dipIdx].label} уналт — LIMIT BUY`;
      orderType  = "⏳ LIMIT BUY";
      entryWaveIdx = dipIdx;
    } else {
      // Бүх waves дээш явсан → одоо орно (anchor)
      entry      = anchorPt?.price ?? today.asiaLow;
      entryLabel = `anchor — MARKET BUY`;
      orderType  = "⚡ MARKET BUY";
    }
  } else {
    // SELL: ICT sweep байвал anchor = MARKET SELL, үгүй бол bounce = LIMIT SELL
    const anchorPrice  = anchorPt?.price ?? today.asiaHigh;
    const sweepAbove   = anchorPrice - today.asiaHigh;
    if (sweepAbove > 0) {
      // anchor нь asiaHigh-аас дээш → ICT sweep болсон → MARKET SELL
      entry      = anchorPrice;
      entryLabel = `↑ ICT sweep +$${sweepAbove.toFixed(2)} — MARKET SELL`;
      orderType  = "⚡ MARKET SELL";
    } else {
      // Sweep байхгүй → эхний bounce ("+") = LIMIT SELL entry
      const bounceIdx = realPts.findIndex(p => p.label.includes("+"));
      if (bounceIdx >= 0) {
        entry      = realPts[bounceIdx].price;
        entryLabel = `${realPts[bounceIdx].label} bounce — LIMIT SELL`;
        orderType  = "⏳ LIMIT SELL";
        entryWaveIdx = bounceIdx;
      } else {
        entry      = anchorPrice;
        entryLabel = `anchor — MARKET SELL`;
        orderType  = "⚡ MARKET SELL";
      }
    }
  }

  // ── Stop: entry-аас buffer-тай тал руу ───────────────────────────────────
  //    SELL ICT sweep: stop = entry + sweepDepth (тэгш тал)
  //    BUY/SELL бусад: stop = entry ± (asiaRange × 8% minimum)
  const sweepAboveForStop = anchorPt ? Math.max(0, anchorPt.price - today.asiaHigh) : 0;
  const stopBuf = isBull
    ? minBuf
    : Math.max(sweepAboveForStop, minBuf);
  const stop = +(isBull ? entry - stopBuf : entry + stopBuf).toFixed(2);
  const risk = Math.abs(entry - stop);

  // ── HIGH PROBABILITY PATTERN block ────────────────────────────────────────
  //  BOTTOM pattern = Asia session-д DOWN swing-үүд бүрэлдсэн → ДАРААГИЙН session-д direction
  //  PEAK   pattern = Asia session-д UP   swing-үүд бүрэлдсэн → ДАРААГИЙН session-д direction
  //  Энэ бол ОДООГИЙН session-ийн орох signal биш — ДАРААГИЙН session-ийн forecast!
  if (highProbAlert?.active && highProbAlert.patternMatch?.matched) {
    const hp  = highProbAlert.patternMatch;
    const pl  = mlPrediction?.enabled ? mlPrediction.patternLookup : null;
    const hpIcon = hp.dominant === "BULL" ? "🟢" : "🔴";
    const isBottom = hp.patternName?.startsWith("BOTTOM");
    // Quantized wave info — хэдэн wave ашиглагдсан
    const usedWaves = hp.quantizedWaves ?? [];
    const waveStr = usedWaves.length > 0 ? ` [${usedWaves.join("-")}]` : "";

    lines.push(``);
    lines.push(`⚡ <b>HIGH PROB PATTERN</b>  ·  ${hp.patternName}${waveStr}`);
    lines.push(`   ${hpIcon} ${hp.signal}  │  Bull <b>${hp.bullPct}%</b>  Bear <b>${hp.bearPct}%</b>  Edge <b>${hp.edge}%</b>  n=${hp.count}`);
    // Pattern тайлбар: BOTTOM → Asia session low waves бүрэлдэж байна → дараагийн session
    if (isBottom) {
      lines.push(`   📌 <i>BOTTOM wave pattern = Asia session бага цэг бүрэлдэж байна</i>`);
      lines.push(`   <i>${asiaComplete ? "✅ Asia session дууссан → ДАРААГИЙН session-ийн forecast" : "⏳ Asia session явцдаа — signal дараагийн session-д"}</i>`);
    } else {
      lines.push(`   📌 <i>PEAK wave pattern = Asia session өндөр цэг бүрэлдэж байна</i>`);
      lines.push(`   <i>${asiaComplete ? "✅ Asia session дууссан → ДАРААГИЙН session-ийн forecast" : "⏳ Asia session явцдаа — signal дараагийн session-д"}</i>`);
    }
    if (pl) {
      lines.push(`   🎯 ML target UP: <b>${fmt(pl.targetUpPrice)}</b>  │  DOWN: <b>${fmt(pl.targetDownPrice)}</b>`);
    }
  }

  // ── C: Seasonal bias line ─────────────────────────────────────────────────
  const tgMonth   = new Date().getMonth() + 1;
  const tgSeasonal = MONTHLY_BIAS[tgMonth];
  if (tgSeasonal) {
    const isBearMo = tgSeasonal.bearPct > tgSeasonal.bullPct;
    const diff = Math.abs(tgSeasonal.bearPct - tgSeasonal.bullPct);
    const strength = diff >= 20 ? "ХҮЧТЭЙ " : "";
    const icon = isBearMo ? "🔴" : "🟢";
    lines.push(`📅 <i>${tgSeasonal.label} сар: ${icon} ${strength}${isBearMo ? "BEAR" : "BULL"} ${Math.max(tgSeasonal.bullPct, tgSeasonal.bearPct)}%  (n=${tgSeasonal.n}, 400 session)</i>`);
  }

  // ── Direction + price header ───────────────────────────────────────────────
  lines.push(``);
  lines.push(`${dirIcon} <b>${dirLabel}</b>  ·  GOLD ${priceStr}${changePct}`);
  lines.push(`<i>Match: ${bestMatch.date}  score ${bestMatch.score.toFixed(1)}%  (wave ${waveScore}%)  ·  dir: ${dirSource}</i>`);

  // ── Entry + Stop header ───────────────────────────────────────────────────
  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`<b>${orderType}</b>`);
  lines.push(`<pre>Entry  ${fmt(entry).padEnd(12)}← ${entryLabel}
Stop   ${fmt(stop).padEnd(12)}← Risk $${risk.toFixed(2)}</pre>`);

  // ── Wave Map: W1-Wn ───────────────────────────────────────────────────────
  //  Entry wave-ийн өмнөх waves = "→ entry" (entry level-рүү явна)
  //  Entry wave = "← ENTRY" гэж тэмдэглэнэ
  //  Entry wave-ийн дараах waves:
  //    BUY:  "+" = T1/T2/T3 (TP), "-" = Add (re-entry)
  //    SELL: "-" = T1/T2/T3 (TP), "+" = Add (re-entry)
  if (realPts.length > 0) {
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`📊 <b>Wave Map</b>  ·  match ${bestMatch.date}`);

    let tpIdx = 1;
    const waveRows: string[] = [];
    realPts.forEach((pt, idx) => {
      if (idx < entryWaveIdx) {
        // Entry-ийн өмнөх wave: entry level рүү явах зам
        waveRows.push(`${pt.label.padEnd(10)}${fmt(pt.price).padEnd(13)}→ entry level`);
      } else if (idx === entryWaveIdx) {
        // Entry цэг
        waveRows.push(`${pt.label.padEnd(10)}${fmt(pt.price).padEnd(13)}← ENTRY ${isBull ? "BUY" : "SELL"}`);
      } else {
        // Entry дараах waves: TP эсвэл Add
        const isUp     = pt.label.includes("+");
        const isTarget = isBull ? isUp : !isUp;   // BUY:+ → TP, SELL:- → TP
        const rr       = risk > 0 ? (Math.abs(pt.price - entry) / risk).toFixed(1) : "—";
        const role     = isTarget ? `T${tpIdx++}` : "Add";
        const roleStr  = isTarget ? `← ${role}  RR 1:${rr}` : `← ${role}`;
        waveRows.push(`${pt.label.padEnd(10)}${fmt(pt.price).padEnd(13)}${roleStr}`);
      }
    });

    lines.push(`<pre>${waveRows.join("\n")}</pre>`);
  }

  // ── Asia session info ──────────────────────────────────────────────────────
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🌏 Asia ${today.date}  H ${fmt(today.asiaHigh)} · L ${fmt(today.asiaLow)}`);

  return lines.join("\n");
}

// POST /notify-telegram — manual or auto trigger (with optional chart screenshot)
router.post("/notify-telegram", async (req, res) => {
  const { trigger = "Manual alert", imageBase64 } = req.body as { trigger?: string; imageBase64?: string };
  const result = await sendTelegramNotification(trigger, imageBase64 ?? null);
  return res.json(result);
});

// GET /wave-snapshot — lightweight endpoint: today's wave counts only (no heavy scoring)
// Frontend polls this every 30s; when counts change → trigger full /matches refetch
router.get("/wave-snapshot", (req, res) => {
  const tf   = ((req.query.tf as string) ?? "M5").toUpperCase();
  const useM5  = tf === "M5";
  const useM15 = tf === "M15";
  const { sessions } = useM5 ? getDataM5() : useM15 ? getDataM15() : getData();
  if (!sessions.length) {
    return res.json({ bottomWaves: 0, peakWaves: 0, date: null, asiaRange: 0 });
  }
  const today = sessions[0];
  return res.json({
    bottomWaves: today.bottomWavePercents?.length ?? 0,
    peakWaves:   today.peakWavePercents?.length   ?? 0,
    date:        today.date ?? null,
    asiaRange:   +(today.asiaRange ?? 0).toFixed(2),
    asiaHigh:    today.asiaHigh,
    asiaLow:     today.asiaLow,
  });
});

// GET /telegram-status — returns last notified state
router.get("/telegram-status", (_req, res) => {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  res.json({
    configured: !!(token && chatId),
    lastBestMatchDate: telegramState.lastBestMatchDate,
    lastBestScore: telegramState.lastBestScore,
    lastHighProbKey: telegramState.lastHighProbKey,
    lastNotifiedAt: telegramState.lastNotifiedAt,
    lastNotifiedAgo: telegramState.lastNotifiedAt
      ? `${Math.round((Date.now() - telegramState.lastNotifiedAt) / 60000)}m ago`
      : "never",
    lastMessageText: telegramState.lastMessageText ?? null,
  });
});

// ── Internal helper — build fresh match + send ────────────────────────────────
async function sendTelegramNotification(trigger: string, imageBase64: string | null = null): Promise<{ ok: boolean; error?: string; matchDate?: string }> {
  try {
    const matchData = getBestMatchData();
    // Live price авах — cache байхгүй бол Twelve Data-аас шинэчилнэ
    let priceData = livePriceCache;
    if (!priceData) {
      try {
        const freshPrice = await fetchLivePrice();
        if (freshPrice) priceData = freshPrice;
      } catch (_) { /* ignore — price remains null */ }
    }

    // Build HIGH PROBABILITY alert for Telegram
    let highProbAlert: { active: boolean; reason: string; patternMatch: any; scoreTriggered: boolean; bestScore: number } | undefined;
    if (matchData.today) {
      const useBottom = matchData.today.bottomWavePercents.length >= 3;
      const tgWaves = useBottom
        ? matchData.today.bottomWavePercents
        : matchData.today.peakWavePercents;
      const tgWaveType: "PEAK" | "BOTTOM" = useBottom ? "BOTTOM" : "PEAK";
      const hpPatternMatch = checkHighProbPattern(tgWaves, tgWaveType);
      const bestScore = matchData.top2[0]?.score ?? 0;
      const isHighProbScore = bestScore >= HIGH_PROB_SCORE_THRESHOLD;
      if (hpPatternMatch.matched || isHighProbScore) {
        highProbAlert = {
          active: true,
          reason: hpPatternMatch.matched
            ? `ML ${hpPatternMatch.patternName} — ${hpPatternMatch.signal} (Edge: ${hpPatternMatch.edge}%, ${hpPatternMatch.count}x)`
            : `Best score ${bestScore}% ≥ ${HIGH_PROB_SCORE_THRESHOLD}% threshold`,
          patternMatch: hpPatternMatch.matched ? hpPatternMatch : null,
          scoreTriggered: isHighProbScore,
          bestScore,
        };
      }
    }

    // Build ML prediction for Telegram
    let tgMlPrediction: ReturnType<typeof computeMLPrediction> | undefined;
    if (matchData.today) {
      const qBot = matchData.today.bottomWavePercents.slice(0, 4).map(quantizeToFib);
      const qPeak = matchData.today.peakWavePercents.slice(0, 4).map(quantizeToFib);
      const todayDir: "up" | "down" = matchData.today.asiaHighTime !== undefined && matchData.today.asiaLowTime !== undefined
        ? (matchData.today.asiaHighTime <= matchData.today.asiaLowTime ? "down" : "up")
        : "down";
      const rPips = matchData.today.asiaRange * 10;
      tgMlPrediction = computeMLPrediction(
        todayDir, qBot, qPeak, rPips,
        matchData.today.asiaRange,
        matchData.today.asiaHigh,
        matchData.today.asiaLow,
      );
    }

    const text = buildNotifText(matchData.top2, matchData.today, priceData, trigger, highProbAlert, tgMlPrediction);

    let tgResult: { ok: boolean; error?: string };
    if (imageBase64) {
      // Send chart screenshot as photo with caption
      tgResult = await sendTelegramPhoto(imageBase64, text);
      // If photo send fails, fall back to text message
      if (!tgResult.ok) {
        console.warn("[telegram] sendPhoto failed, falling back to text:", tgResult.error);
        tgResult = await sendTelegramMessage(text);
      }
    } else {
      tgResult = await sendTelegramMessage(text);
    }

    if (tgResult.ok) {
      telegramState.lastNotifiedAt = Date.now();
      telegramState.lastBestMatchDate = matchData.top2[0]?.date ?? null;
      telegramState.lastBestScore    = matchData.top2[0]?.score ?? 0;
      telegramState.lastMessageText  = text;
      console.log(`[telegram] ✅ Sent OK — trigger="${trigger}" match=${matchData.top2[0]?.date ?? "none"}`);
    } else {
      console.warn(`[telegram] ❌ Send failed — ${tgResult.error}`);
    }
    return { ...tgResult, matchDate: matchData.top2[0]?.date ?? undefined, text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── getBestMatchData — uses M5 cached data, returns top-2 matches ─────────────
function getBestMatchData(): { top2: PatternMatch[]; today: SessionAnalysis | null } {
  try {
    const { groups, sessions } = getDataM5();
    if (sessions.length < 2) return { top2: [], today: null };

    const todaySession  = sessions[0];
    const minW          = 3;
    const comparePeak   = Math.min(minW, todaySession.peakWavePercents.length);
    const compareBottom = Math.min(minW, todaySession.bottomWavePercents.length);
    const todayPeakOK   = todaySession.peakWavePercents.length   >= minW;
    const todayBottomOK = todaySession.bottomWavePercents.length >= minW;

    const todayDirection = todaySession.asiaHighTime <= todaySession.asiaLowTime ? "down" : "up";

    const histLimit = Math.min(365, sessions.length - 1);
    const scored: { match: PatternMatch; score: number }[] = [];

    // H1 data for overlay/projection
    const h1Data = getData();

    for (let i = 1; i <= histLimit; i++) {
      const hist      = sessions[i];

      // Direction filter: skip sessions with opposite High/Low sequence
      const histDirection = hist.asiaHighTime <= hist.asiaLowTime ? "down" : "up";
      if (histDirection !== todayDirection) continue;

      const h1Group   = h1Data.groups.find((g) => g.dayKey === hist.date);
      const h1Session = h1Data.sessions.find((s) => s.date === hist.date) ?? hist;
      const h1Candles = h1Group?.candles ?? [];

      let peakScore = 0;
      if (comparePeak >= 2 && hist.peakWavePercents.length >= comparePeak) {
        peakScore = compareWaveSequences(todaySession.peakWavePercents, hist.peakWavePercents, comparePeak);
      }
      let bottomScore = 0;
      if (compareBottom >= 2 && hist.bottomWavePercents.length >= compareBottom) {
        bottomScore = compareWaveSequences(todaySession.bottomWavePercents, hist.bottomWavePercents, compareBottom);
      }
      let waveScore: number;
      if (todayPeakOK && todayBottomOK) {
        waveScore = (peakScore + bottomScore) / 2;
      } else if (todayPeakOK) {
        waveScore = peakScore;
      } else if (todayBottomOK) {
        waveScore = bottomScore;
      } else {
        waveScore = (peakScore + bottomScore) / 2;
      }
      const rangeScore = 100 * (1 - Math.abs(todaySession.asiaRange - hist.asiaRange)
        / Math.max(todaySession.asiaRange, hist.asiaRange));
      const combined = +(waveScore * 0.6 + rangeScore * 0.4).toFixed(1);

      const todayH1Candles = (liveH1Cache?.bars ?? [])
        .filter((b) => b.time >= currentSessionStart())
        .map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0,
          sessionName: "live", sessionColor: "#d97706", sessionHex: "#d97706", isAsiaSession: false }));

      scored.push({
        score: combined,
        match: {
          date: hist.date,
          dateTimestamp: hist.dateTimestamp,
          score: combined,
          peakScore: +peakScore.toFixed(1),
          bottomScore: +bottomScore.toFixed(1),
          asiaRange: hist.asiaRange,
          historicalCandles: h1Candles,
          projectionPoints: buildProjection(h1Session, h1Candles, todaySession, todayH1Candles, comparePeak, SWING_LOOKBACK, true),
          alignedOverlay:   buildAlignedOverlay(h1Candles, h1Session, todayH1Candles, todaySession),
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return { top2: scored.slice(0, 2).map((s) => s.match), today: todaySession };
  } catch (e) {
    console.warn("[telegram] getBestMatchData error:", e);
    return { top2: [], today: null };
  }
}

// ── Background polling — only fires when best match date changes ──────────────
const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function pollBestMatch() {
  try {
    const { top2 } = getBestMatchData();
    const best    = top2[0] ?? null;
    const newDate = best?.date ?? null;
    const newScore = best?.score ?? 0;

    if (newDate && newDate !== telegramState.lastBestMatchDate) {
      console.log(`[telegram] 🔄 Match changed: ${telegramState.lastBestMatchDate ?? "none"} → ${newDate} (${newScore.toFixed(1)}%)`);
      await sendTelegramNotification(`Match changed → ${newDate}`, null);
    } else {
      console.log(`[telegram] Poll: no change. match=${newDate ?? "none"} score=${newScore.toFixed(1)}%`);
    }
  } catch (e) {
    console.warn("[telegram] Poll error:", e);
  } finally {
    setTimeout(pollBestMatch, POLL_INTERVAL_MS);
  }
}
// Start polling after 30s to let server warm up
setTimeout(pollBestMatch, 30_000);

// ── Live H1 bars from Twelve Data (fills gap after last CSV bar) ─────────────
interface LiveH1Cache { bars: any[]; fetchedAt: number }
let liveH1Cache: LiveH1Cache | null = null;
const LIVE_H1_TTL_MS = 5 * 60 * 1000; // cache 5 minutes

/** Fetch live H1 bars from Twelve Data and update liveH1Cache.
 *  Returns the bars array on success, or null on failure. */
async function fetchLiveH1Bars(outputsize = 72): Promise<any[] | null> {
  const tdKey = process.env.TWELVE_DATA_API_KEY;
  if (!tdKey) return null;
  try {
    const resp = await fetch(
      `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1h&outputsize=${Math.min(outputsize, 200)}&timezone=UTC&apikey=${tdKey}`
    );
    const d = (await resp.json()) as any;
    if (d.status !== "ok") return null;
    const bars = (d.values as any[])
      .map((v) => {
        const ts = Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000);
        return {
          time:   ts,
          open:   +parseFloat(v.open).toFixed(2),
          high:   +parseFloat(v.high).toFixed(2),
          low:    +parseFloat(v.low).toFixed(2),
          close:  +parseFloat(v.close).toFixed(2),
          volume: 0,
          sessionName: "live",
          sessionHex:  "#d97706",
          isAsiaSession: false,
          source: "twelvedata",
        };
      })
      .sort((a, b) => a.time - b.time);
    liveH1Cache = { bars, fetchedAt: Date.now() };
    return bars;
  } catch {
    return null;
  }
}

router.get("/live-h1", async (req, res) => {
  const tdKey = process.env.TWELVE_DATA_API_KEY;
  if (!tdKey) return res.status(503).json({ error: "TWELVE_DATA_API_KEY not configured" });

  const now  = Date.now();
  const force = req.query.force === "1";
  const outputsize = Number(req.query.outputsize ?? 72);

  if (!force && liveH1Cache && now - liveH1Cache.fetchedAt < LIVE_H1_TTL_MS) {
    return res.json({ bars: liveH1Cache.bars, cached: true });
  }

  const bars = await fetchLiveH1Bars(outputsize);
  if (bars) return res.json({ bars, cached: false, count: bars.length });
  if (liveH1Cache) return res.json({ bars: liveH1Cache.bars, cached: true, stale: true });
  return res.status(502).json({ error: "Twelve Data unavailable" });
});

// ── CSV auto-refresh — fetch new M5 bars from Twelve Data and append to CSV ──
const CSV_PATH = path.join(__dirname, "../data/GOLDM5.csv");
const CSV_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/** Parse a CSV datetime string "YYYY.MM.DD HH:MM" → Unix seconds (UTC) */
function parseCsvDatetime(dt: string): number {
  const [datePart, timePart] = dt.trim().split(" ");
  const [y, mo, d] = datePart.split(".");
  const [h, m]     = timePart.split(":");
  return Math.floor(Date.UTC(+y, +mo - 1, +d, +h, +m, 0) / 1000);
}

/** Format Unix seconds → "YYYY.MM.DD HH:MM" for CSV */
function fmtCsvDatetime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth()+1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

async function refreshM5Csv(): Promise<{ added: number; lastTs: string; error?: string }> {
  const tdKey = process.env.TWELVE_DATA_API_KEY;
  if (!tdKey) return { added: 0, lastTs: "", error: "TWELVE_DATA_API_KEY not set" };

  try {
    // 1. Find last timestamp in existing CSV
    const text   = fs.readFileSync(CSV_PATH, "utf8");
    const lines  = text.trim().split("\n").filter((l) => l.trim());
    const lastLine   = lines[lines.length - 1];
    const lastCsvTs  = parseCsvDatetime(lastLine.split(",")[0]);
    const lastCsvDt  = fmtCsvDatetime(lastCsvTs);

    const nowTs = Math.floor(Date.now() / 1000);
    const gapMinutes = Math.floor((nowTs - lastCsvTs) / 60);
    if (gapMinutes < 10) {
      console.log(`[csv-refresh] CSV is up to date (last bar: ${lastCsvDt}, gap: ${gapMinutes}min)`);
      return { added: 0, lastTs: lastCsvDt };
    }

    console.log(`[csv-refresh] Gap: ${gapMinutes} minutes since ${lastCsvDt}. Fetching from Twelve Data…`);

    // 2. Fetch M5 bars — request enough to cover the gap (max 5000)
    const needed   = Math.min(Math.ceil(gapMinutes / 5) + 10, 5000);
    const url      = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=${needed}&timezone=UTC&apikey=${tdKey}`;
    const resp     = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const rawText  = await resp.text();

    // Guard: some rate-limit / auth errors return HTML pages
    if (!rawText.trimStart().startsWith("{")) {
      const preview = rawText.slice(0, 120).replace(/\s+/g, " ");
      console.warn(`[csv-refresh] Non-JSON response from Twelve Data (HTTP ${resp.status}): ${preview}`);
      return { added: 0, lastTs: lastCsvDt, error: `HTTP ${resp.status} — non-JSON body` };
    }

    const data = JSON.parse(rawText) as any;

    if (data.status === "error" || !Array.isArray(data.values)) {
      console.warn("[csv-refresh] Twelve Data error:", data.message ?? data.code);
      return { added: 0, lastTs: lastCsvDt, error: data.message ?? "Twelve Data API error" };
    }

    // 3. Filter only bars newer than last CSV bar (values are newest-first)
    const newBars = data.values
      .filter((v: any) => {
        const ts = parseCsvDatetime(v.datetime.replace(/-/g, ".").slice(0, 16));
        return ts > lastCsvTs;
      })
      .reverse(); // oldest first

    if (newBars.length === 0) {
      console.log(`[csv-refresh] No new bars after ${lastCsvDt}`);
      return { added: 0, lastTs: lastCsvDt };
    }

    // 4. Build CSV rows and append
    const newLines = newBars.map((v: any) => {
      const dt  = v.datetime.replace(/-/g, ".").slice(0, 16).replace(/T/, " ");
      const vol = v.volume ?? 0;
      return `${dt},${(+v.open).toFixed(5)},${(+v.high).toFixed(5)},${(+v.low).toFixed(5)},${(+v.close).toFixed(5)},${vol},0`;
    });

    const appendText = "\n" + newLines.join("\n");
    fs.appendFileSync(CSV_PATH, appendText, "utf8");

    const newLastDt = fmtCsvDatetime(parseCsvDatetime(newBars[newBars.length - 1].datetime.replace(/-/g, ".").slice(0, 16)));
    console.log(`[csv-refresh] Appended ${newBars.length} new M5 bars. CSV now ends at ${newLastDt}`);

    // 5. Invalidate all caches so next request reloads from disk
    m5Cache      = null;
    dataCache    = null;
    dataCacheM5  = null;
    dataCacheM15 = null;

    return { added: newBars.length, lastTs: newLastDt };
  } catch (e: any) {
    console.error("[csv-refresh] Error:", e.message);
    return { added: 0, lastTs: "", error: e.message };
  }
}

// GET /refresh-csv — manually trigger CSV refresh
router.get("/refresh-csv", async (req, res) => {
  const result = await refreshM5Csv();
  return res.json(result);
});

// Schedule CSV refresh every 6 hours (after 60s warmup)
setTimeout(async () => {
  await refreshM5Csv();
  setInterval(refreshM5Csv, CSV_REFRESH_INTERVAL_MS);
}, 60_000);


// ── POST /login — password gate ──────────────────────────────────────────────
const sessions = new Set<string>();

router.post("/login", (req, res) => {
  const { password } = req.body as { password?: string };
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return res.status(500).json({ ok: false, error: "DASHBOARD_PASSWORD env var not set" });
  }
  if (password === expected) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.add(token);
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ ok: false, error: "Нууц үг буруу байна" });
});

router.post("/validate-token", (req, res) => {
  const { token } = req.body as { token?: string };
  return res.json({ ok: token ? sessions.has(token) : false });
});

export default router;
