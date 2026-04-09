import { useState, useEffect, useMemo, useRef } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useGetOhlcv,
  useGetSessions,
  useGetPatternMatches,
} from "@workspace/api-client-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Customized,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Sun, Moon, Activity, Layers, Target, BarChart2, TrendingUp, TrendingDown, Send, CheckCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";

// ── Session colours (marketsess) ─────────────────────────────────────────────
const SESSION_COLORS: Record<string, { bg: string; label: string; border: string }> = {
  SydneyAsia:  { bg: "rgba(45,138,80,0.15)",  border: "#2d8a50", label: "Sydney/Asia" },
  Asia:        { bg: "rgba(45,90,180,0.18)",   border: "#2d5ab4", label: "Asia" },
  AsiaEuro:    { bg: "rgba(160,60,110,0.15)",  border: "#a03c6e", label: "Asia/Euro" },
  Euro:        { bg: "rgba(60,100,160,0.15)",  border: "#3c64a0", label: "Euro" },
  EuroUSA:     { bg: "rgba(130,170,60,0.15)",  border: "#82aa3c", label: "Euro/USA" },
  EuroUsaNasQ: { bg: "rgba(200,110,40,0.15)",  border: "#c86e28", label: "EUR/USA/Nas" },
  UsaNasQ:     { bg: "rgba(110,50,180,0.15)",  border: "#6e32b4", label: "USA/Nas" },
};

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ title, value, icon: Icon, loading, accent }: {
  title: string; value: React.ReactNode; icon: any; loading: boolean; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{title}</p>
          {loading ? <Skeleton className="h-6 w-20 mt-1" /> : (
            <div className={`text-lg font-bold leading-tight ${accent ?? ""}`}>{value}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Custom Candlestick ────────────────────────────────────────────────────────
const Candlestick = (props: any) => {
  const { x, y, width, height, payload } = props;
  const c = payload?.candleData;
  if (!c || c.high === c.low) return null;
  const bull   = c.close >= c.open;
  const isLive = !!c.isLive;
  // Live bars from Twelve Data: amber tint; CSV bars: green/red
  const col = isLive
    ? (bull ? "#f59e0b" : "#fb923c")
    : (bull ? "#22c55e" : "#ef4444");
  const openY  = y + ((c.high - c.open)  / (c.high - c.low)) * height;
  const closeY = y + ((c.high - c.close) / (c.high - c.low)) * height;
  const bodyY  = Math.min(openY, closeY);
  const bodyH  = Math.max(Math.abs(openY - closeY), 1.5);
  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={col} strokeWidth={1} />
      <rect x={x + 1} y={bodyY} width={Math.max(width - 2, 2)} height={bodyH} fill={col} rx={1}
            stroke={isLive ? "#f59e0b" : "none"} strokeWidth={isLive ? 0.5 : 0} />
    </g>
  );
};

// ── Custom YAxis tick — live price orange box highlight ───────────────────────
function makePriceTick(livePrice: number | undefined) {
  return function PriceTick(props: any) {
    const { x, y, payload } = props;
    const val: number = payload?.value ?? 0;
    const isLive = livePrice !== undefined && Math.abs(val - livePrice) < 0.5;
    if (isLive) {
      const label = val.toFixed(2);
      const w = label.length * 6.5 + 8;
      return (
        <g>
          <rect x={x - 2} y={y - 9} width={w} height={17} rx={2} fill="#f59e0b" />
          <text x={x + w / 2 - 2} y={y + 4} textAnchor="middle" fontSize={10} fontFamily="monospace" fontWeight="bold" fill="#111">
            {label}
          </text>
        </g>
      );
    }
    return (
      <text x={x + 4} y={y + 4} textAnchor="start" fontSize={10} fontFamily="monospace" fill="#888">
        {val.toFixed(2)}
      </text>
    );
  };
}

// ── Wave Dot (custom recharts dot) ────────────────────────────────────────────
const WaveDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload?.waveType) return null;
  const isPeak = payload.waveType === "peak";
  const color = isPeak ? "#f59e0b" : "#3b82f6";
  const label = payload.waveLabel ?? "";
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill={color} stroke="#111" strokeWidth={1.5} />
      <text x={cx} y={isPeak ? cy - 10 : cy + 14} fill={color} fontSize={9} fontWeight="bold" textAnchor="middle">{label}</text>
    </g>
  );
};

// ── Zigzag Projection — MQL5-style colored wave segments (Customized SVG) ─────
const ZigzagProjection = (props: any) => {
  const { xAxisMap, yAxisMap, projPoints, timeToIdx } = props;
  if (!projPoints?.length) return null;
  const xScale = Object.values(xAxisMap as Record<string, any>)[0]?.scale;
  const yScale = Object.values(yAxisMap as Record<string, any>)[0]?.scale;
  if (!xScale || !yScale) return null;

  // time → idx helper (use the passed Map, fall back to time if not found)
  const tIdx = (t: number): number => timeToIdx?.get(t) ?? t;

  const elems: JSX.Element[] = [];

  for (let i = 1; i < projPoints.length; i++) {
    const p1 = projPoints[i - 1];
    const p2 = projPoints[i];
    const x1 = xScale(tIdx(p1.time)), y1 = yScale(p1.price);
    const x2 = xScale(tIdx(p2.time)), y2 = yScale(p2.price);
    if ([x1, y1, x2, y2].some((v) => v == null || isNaN(v))) continue;

    const isUp  = p2.price > p1.price;
    const color = isUp ? "#22c55e" : "#ef4444";
    const lbl   = p2.label as string;

    // Segment line
    elems.push(
      <line key={`sl-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={2.5} strokeDasharray="8 4" strokeLinecap="round" />
    );
    // Turn dot
    elems.push(
      <circle key={`sd-${i}`} cx={x2} cy={y2} r={5}
        fill={color} stroke="#111" strokeWidth={1.5} />
    );
    // Label badge (above UP turns, below DOWN turns)
    if (lbl) {
      const yOff = isUp ? -14 : 18;
      const lblW = lbl.length * 5.8 + 8;
      elems.push(
        <g key={`sl2-${i}`}>
          <rect x={x2 - lblW / 2} y={y2 + yOff - 11} width={lblW} height={14} rx={3}
            fill={isUp ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}
            stroke={color} strokeWidth={0.5} />
          <text x={x2} y={y2 + yOff} fill={color}
            fontSize={9} fontWeight="bold" textAnchor="middle">{lbl}</text>
        </g>
      );
    }
  }

  // Bridge dot (connection point from overlay)
  const p0 = projPoints[0];
  if (p0) {
    const x0 = xScale(tIdx(p0.time)), y0 = yScale(p0.price);
    if (x0 != null && y0 != null && !isNaN(x0) && !isNaN(y0)) {
      elems.push(
        <circle key="bridge-dot" cx={x0} cy={y0} r={4}
          fill="#f59e0b" stroke="#111" strokeWidth={1.5} />
      );
    }
  }

  return <g className="zigzag-projection">{elems}</g>;
};

// ── Mini Candlestick (for historical day cards) ───────────────────────────────
const MiniCandle = (props: any) => {
  const { x, y, width, height, payload } = props;
  const c = payload?.candleData;
  if (!c || c.high === c.low) return null;
  const bull = c.close >= c.open;
  const col = bull ? "#22c55e" : "#ef4444";
  const openY  = y + ((c.high - c.open)  / (c.high - c.low)) * height;
  const closeY = y + ((c.high - c.close) / (c.high - c.low)) * height;
  const bodyY  = Math.min(openY, closeY);
  const bodyH  = Math.max(Math.abs(openY - closeY), 1);
  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={col} strokeWidth={0.8} />
      <rect x={x + 0.5} y={bodyY} width={Math.max(width - 1, 1)} height={bodyH} fill={col} rx={0.3} />
    </g>
  );
};

// ── Historical Day Mini-Chart Card ────────────────────────────────────────────
function HistoricalDayCard({ match, rank, isSelected, onClick }: {
  match: any; rank: number; isSelected: boolean; onClick: () => void;
}) {
  const candles: any[] = match.historicalCandles ?? [];
  const ah = match.asiaHigh;
  const al = match.asiaLow;

  const miniData = useMemo(() => candles.map((c: any) => ({
    time: c.time,
    range: [c.low, c.high],
    candleData: c,
    asiaHighLine: ah,
    asiaLowLine: al,
  })), [candles, ah, al]);

  const prices = candles.flatMap((c: any) => [c.low, c.high]);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 1;
  const pad  = (maxP - minP) * 0.05;

  const scoreColor = match.score > 80 ? "text-green-400" : match.score > 65 ? "text-amber-400" : "text-muted-foreground";

  return (
    <div
      onClick={onClick}
      className={`shrink-0 w-52 rounded-lg border cursor-pointer transition-all hover:border-amber-400/50 ${
        isSelected ? "border-amber-500/60 bg-amber-500/5 shadow-md" : "border-border bg-card hover:bg-muted/20"
      }`}
    >
      {/* Header */}
      <div className="px-2.5 pt-2 pb-0.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] bg-muted rounded px-1 font-mono text-muted-foreground">#{rank}</span>
          <span className="text-[11px] font-semibold">{match.date}</span>
        </div>
        <span className={`text-[11px] font-bold ${scoreColor}`}>{match.score.toFixed(1)}%</span>
      </div>

      {/* Mini Chart */}
      <div style={{ height: 100 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={miniData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
            <YAxis domain={[minP - pad, maxP + pad]} hide />
            <XAxis dataKey="time" hide />
            <Bar dataKey="range" shape={<MiniCandle />} isAnimationActive={false} />
            <Line dataKey="asiaHighLine" stroke="#4ade80" strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false} legendType="none" />
            <Line dataKey="asiaLowLine"  stroke="#f87171" strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Footer stats */}
      <div className="px-2.5 pb-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Range: <span className="text-amber-400 font-mono font-bold">${match.asiaRange?.toFixed(0)}</span>
          {(match as any).rangeScore !== undefined && (
            <span className={`ml-1 ${(match as any).rangeScore > 80 ? 'text-green-400' : (match as any).rangeScore > 60 ? 'text-amber-400' : 'text-red-400'}`}>
              ({((match as any).rangeScore).toFixed(0)}%)
            </span>
          )}
        </span>
        <span>
          <span className="text-blue-400">{match.peakScore?.toFixed(0)}↑</span>
          {" / "}
          <span className="text-purple-400">{match.bottomScore?.toFixed(0)}↓</span>
        </span>
      </div>
      {/* ML outcome + ratio/seasonal row */}
      <div className="px-2.5 pb-1 flex justify-between items-center text-[9px]">
        {(match as any).mlOutcome ? (
          <span className={`px-1.5 py-0.5 rounded font-semibold ${
            (match as any).mlOutcome === 'BULLISH'  ? 'bg-emerald-900/60 text-emerald-400' :
            (match as any).mlOutcome === 'BEARISH'  ? 'bg-red-900/60 text-red-400' :
                                                      'bg-muted text-muted-foreground'
          }`}>
            {(match as any).mlOutcome === 'BULLISH' ? '▲' : (match as any).mlOutcome === 'BEARISH' ? '▼' : '—'} {(match as any).mlOutcome}
          </span>
        ) : <span />}
        <span className="text-muted-foreground/70">
          R:{(match as any).ratioScore?.toFixed(0) ?? '--'} S:{(match as any).seasonalScore?.toFixed(0) ?? '--'}
        </span>
      </div>

      {/* Entry signal + T1 row */}
      {(() => {
        const outcome = (match as any).mlOutcome as string | undefined;
        const ah: number = match.asiaHigh;
        const al: number = match.asiaLow;
        if (!outcome || outcome === 'INSIDE' || !ah || !al) return null;
        const isBullish = outcome === 'BULLISH';
        const entryPrice = isBullish ? al : ah;
        const t1Price    = isBullish ? ah : al;
        const entryLabel = isBullish ? '▲ BUY' : '▼ SELL';
        const entryColor = isBullish ? 'text-emerald-400' : 'text-red-400';
        const t1Color    = isBullish ? 'text-emerald-300' : 'text-red-300';
        return (
          <div className="mx-2.5 mb-2 rounded border border-border/40 bg-muted/20 px-2 py-1">
            <div className="flex justify-between items-center text-[9px]">
              <span className={`font-bold ${entryColor}`}>{entryLabel} @ <span className="font-mono">${entryPrice.toFixed(2)}</span></span>
              <span className={`font-mono font-semibold ${t1Color}`}>T1 ${t1Price.toFixed(2)}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const qc = useQueryClient();
  const [isDark, setIsDark] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [displayDays, setDisplayDays] = useState(3);
  const [timeframe, setTimeframe] = useState<"H1" | "M5" | "M15">("H1");
  const [zoomDomain, setZoomDomain] = useState<{ left: number; right: number } | null>(null);
  const [tgSending, setTgSending] = useState(false);
  const [tgResult, setTgResult] = useState<{ ok: boolean; error?: string; matchDate?: string } | null>(null);
  const [tgStatus, setTgStatus] = useState<{
    configured: boolean;
    lastBestMatchDate: string | null;
    lastNotifiedAt: number;
    lastNotifiedAgo: string;
    lastMessageText: string | null;
  } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  async function captureChartImage(): Promise<string | null> {
    const card = chartRef.current;
    if (!card) return null;
    const svgEl = card.querySelector("svg");
    if (!svgEl) return null;

    return new Promise((resolve) => {
      try {
        const svgRect = svgEl.getBoundingClientRect();
        const W = Math.round(svgRect.width)  || 900;
        const H = Math.round(svgRect.height) || 460;
        const HEADER_H = 42;
        const SCALE    = 2;

        // Build title / overlay text from current state (closure)
        const titleText   = `XAUUSD · H1 · ${displayDays} Days`;
        const overlayText = activeMatch
          ? `Overlay: ${activeMatch.date} (${(activeMatch as any).score?.toFixed(1) ?? "?"}%)`
          : null;

        // Clone & prepare SVG so it renders standalone
        const clone = svgEl.cloneNode(true) as SVGElement;
        clone.setAttribute("width",  String(W));
        clone.setAttribute("height", String(H));
        clone.setAttribute("xmlns",  "http://www.w3.org/2000/svg");
        clone.querySelectorAll("text").forEach((t) => {
          if (!t.getAttribute("fill")) t.setAttribute("fill", "#888");
        });

        const xml    = new XMLSerializer().serializeToString(clone);
        const svgB64 = btoa(unescape(encodeURIComponent(xml)));
        const svgUrl = `data:image/svg+xml;base64,${svgB64}`;

        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width  = W * SCALE;
          canvas.height = (HEADER_H + H) * SCALE;
          const ctx = canvas.getContext("2d")!;
          ctx.scale(SCALE, SCALE);

          // ── Header bar ─────────────────────────────────────────
          ctx.fillStyle = "#161b22";
          ctx.fillRect(0, 0, W, HEADER_H);
          // subtle bottom border
          ctx.fillStyle = "#2d333b";
          ctx.fillRect(0, HEADER_H - 1, W, 1);

          // Title
          ctx.font      = "bold 13px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText(titleText, 14, 27);

          // Overlay badge (amber pill)
          if (overlayText) {
            const titleW = ctx.measureText(titleText).width;
            const badgeX = 14 + titleW + 10;
            ctx.font      = "bold 11px ui-sans-serif, system-ui, sans-serif";
            const badgeW  = ctx.measureText(overlayText).width + 16;
            // pill background
            ctx.fillStyle = "rgba(245,158,11,0.18)";
            ctx.beginPath();
            ctx.rect(badgeX, 14, badgeW, 18);
            ctx.fill();
            // pill border
            ctx.strokeStyle = "rgba(245,158,11,0.45)";
            ctx.lineWidth   = 0.8;
            ctx.stroke();
            // text
            ctx.fillStyle = "#f59e0b";
            ctx.fillText(overlayText, badgeX + 8, 27);
          }

          // ── Chart area ─────────────────────────────────────────
          ctx.fillStyle = "#0f1117";
          ctx.fillRect(0, HEADER_H, W, H);
          ctx.drawImage(img, 0, HEADER_H, W, H);

          // ── Watermark ──────────────────────────────────────────
          ctx.font      = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          const wmText  = "AsiaWave Pattern Matcher · XAUUSD H1";
          const wmW     = ctx.measureText(wmText).width;
          ctx.fillText(wmText, W - wmW - 10, HEADER_H + H - 8);

          resolve(canvas.toDataURL("image/jpeg", 0.90).split(",")[1]);
        };
        img.onerror = (e) => { console.warn("SVG→img failed:", e); resolve(null); };
        img.src = svgUrl;
      } catch (e) {
        console.warn("captureChartImage error:", e);
        resolve(null);
      }
    });
  }

  async function sendToTelegram() {
    setTgSending(true);
    setTgResult(null);
    try {
      const imageBase64 = await captureChartImage();
      const r = await fetch("/api/pattern-matcher/notify-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "Manual chart snapshot", imageBase64 }),
      });
      const d = await r.json();
      setTgResult(d);
    } catch (e: any) {
      setTgResult({ ok: false, error: e.message });
    } finally {
      setTgSending(false);
      setTimeout(() => setTgResult(null), 6000);
    }
  }

  // ── Auto-notify with chart image when best match changes ────────────────────
  const lastAutoNotifRef = useRef<string | null>(null);
  const autoNotifInitRef = useRef(false);

  // Init: read backend's lastBestMatchDate BEFORE enabling auto-notify
  // Set autoNotifInitRef=true only AFTER the fetch resolves so matchesData
  // useEffect doesn't fire a false notification on page load.
  useEffect(() => {
    if (autoNotifInitRef.current) return;
    fetch("/api/pattern-matcher/telegram-status")
      .then((r) => r.json())
      .then((d) => {
        lastAutoNotifRef.current = d.lastBestMatchDate ?? null;
      })
      .catch(() => {
        lastAutoNotifRef.current = null;
      })
      .finally(() => {
        autoNotifInitRef.current = true; // enable watching AFTER we know the baseline
      });
  }, []);

  // Poll telegram-status every 60s to keep lastMessageText fresh
  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/pattern-matcher/telegram-status")
        .then((r) => r.json())
        .then((d) => setTgStatus(d))
        .catch(() => {});
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const bars = displayDays * 24;

  const { data: ohlcvData, isLoading: loadOhlcv } = useGetOhlcv({ bars });
  const { data: sessionsData, isLoading: loadSess } = useGetSessions({ days: displayDays + 2 });
  const { data: matchesData, isLoading: loadMatches, isFetching: fetchMatches, refetch: refetchMatches } = useGetPatternMatches(
    { days: 365, minWaves: 3, tolerance: 20, tf: "m5" },
    { query: { refetchInterval: 5 * 60 * 1000, staleTime: 4 * 60 * 1000 } },
  );

  // ── Wave-snapshot light polling (30s) — triggers heavy refetch on wave change ──
  // /wave-snapshot is a fast endpoint (no pattern scoring) — returns only wave counts.
  // When bottomWaves or peakWaves changes → new wave formed → refetch /matches immediately.
  const waveSnapshotRef = useRef<{ bottom: number; peak: number } | null>(null);
  const { data: waveSnap } = useQuery({
    queryKey: ["wave-snapshot"],
    queryFn: async () => {
      const r = await fetch("/api/pattern-matcher/wave-snapshot?tf=M5");
      return await r.json() as { bottomWaves: number; peakWaves: number; date: string | null };
    },
    refetchInterval: 30 * 1000,   // 30 секунд тутам — хөнгөн дуудлага
    staleTime:        25 * 1000,
  });
  useEffect(() => {
    if (!waveSnap) return;
    const prev = waveSnapshotRef.current;
    const cur  = { bottom: waveSnap.bottomWaves, peak: waveSnap.peakWaves };
    if (prev && (prev.bottom !== cur.bottom || prev.peak !== cur.peak)) {
      // Шинэ wave бүрэлдсэн → best match өөрчлөгдсөн байж болно → тэр даруй шалга
      console.log(`[wave-watch] Wave changed ▼${prev.bottom}→${cur.bottom} ▲${prev.peak}→${cur.peak} — refetching matches…`);
      refetchMatches();
    }
    waveSnapshotRef.current = cur;
  }, [waveSnap?.bottomWaves, waveSnap?.peakWaves]);

  // Watch matchesData — when best match date changes, auto-capture + send with image
  useEffect(() => {
    if (!matchesData) return;
    const newDate = (matchesData as any)?.bestMatch?.date ?? null;
    if (!newDate) return;
    if (!autoNotifInitRef.current) return;
    if (newDate === lastAutoNotifRef.current) return;

    const prevDate = lastAutoNotifRef.current;
    lastAutoNotifRef.current = newDate;

    const bm = (matchesData as any).bestMatch;
    const trigger = `Best match changed → ${newDate} (${bm?.score?.toFixed(1) ?? "?"}%)`;
    console.log(`[auto-tg] ${prevDate} → ${newDate}, sending photo…`);

    setTimeout(async () => {
      const imageBase64 = await captureChartImage();
      try {
        await fetch("/api/pattern-matcher/notify-telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger, imageBase64 }),
        });
        console.log(`[auto-tg] Sent for ${newDate} (${imageBase64 ? "with image" : "text only"})`);
      } catch (e) {
        console.warn("[auto-tg] Send failed:", e);
      }
    }, 3000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(matchesData as any)?.bestMatch?.date]);

  // Live gold price — Twelve Data (real-time) with metalpriceapi.com fallback
  const { data: livePrice } = useQuery<{
    price: number; isoDate: string; source: string;
    change?: number; changePercent?: number;
    high?: number; low?: number; open?: number;
    isMarketOpen?: boolean;
  } | null>({
    queryKey: ["live-price"],
    queryFn: async () => {
      const r = await fetch("/api/pattern-matcher/live-price");
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 60 * 1000,      // refetch every 1 min
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  // Live H1 bars from Twelve Data — fills gap after last GOLDM5.csv bar
  const { data: liveH1Data } = useQuery<{ bars: any[]; cached?: boolean } | null>({
    queryKey: ["live-h1"],
    queryFn: async () => {
      const r = await fetch("/api/pattern-matcher/live-h1?outputsize=72");
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // When live H1 data refreshes, immediately refetch matches so overlay/projection updates
  const liveH1Count = liveH1Data?.bars?.length ?? 0;
  useEffect(() => {
    if (liveH1Count === 0) return;
    qc.invalidateQueries({ queryKey: ["/api/pattern-matcher/matches"] });
  }, [liveH1Count, qc]);

  // M5 candle data (fetched only when M5 timeframe selected)
  const m5RequestBars = displayDays * 24 * 12; // 12 M5 bars per hour
  const { data: m5Data, isLoading: loadM5 } = useQuery<any[] | null>({
    queryKey: ["ohlcv-m5", m5RequestBars],
    queryFn: async () => {
      const r = await fetch(`/api/pattern-matcher/ohlcv-m5?bars=${m5RequestBars}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: timeframe === "M5",
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // M15 candle data (fetched only when M15 timeframe selected) — 4 bars per hour
  const m15RequestBars = displayDays * 24 * 4;
  const { data: m15Data, isLoading: loadM15 } = useQuery<any[] | null>({
    queryKey: ["ohlcv-m15", m15RequestBars],
    queryFn: async () => {
      const r = await fetch(`/api/pattern-matcher/ohlcv-m15?bars=${m15RequestBars}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: timeframe === "M15",
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Reset zoom when timeframe or displayDays changes
  useEffect(() => { setZoomDomain(null); }, [timeframe, displayDays]);

  const isSubMinute = timeframe === "M5" || timeframe === "M15";
  const loading = (timeframe === "M5" ? loadM5 : timeframe === "M15" ? loadM15 : loadOhlcv) || loadSess || loadMatches;

  const todaySession = matchesData?.today as any;
  const bestMatch    = matchesData?.bestMatch as any;
  const waveMarkers  = (matchesData as any)?.todayWaveMarkers ?? [];
  const similarCount = matchesData?.matches?.filter((m: any) => m.score > 70).length ?? 0;

  const activeMatch = useMemo(() => {
    if (!matchesData?.matches) return bestMatch;
    if (!selectedDate) return bestMatch;
    return (matchesData.matches as any[]).find((m) => m.date === selectedDate) ?? bestMatch;
  }, [matchesData, selectedDate, bestMatch]);


  // ── Build chart data map ──────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const baseCandles: any[] =
      timeframe === "M5"  ? (m5Data  ?? []) :
      timeframe === "M15" ? (m15Data ?? []) :
      (ohlcvData ?? []);
    if (!baseCandles.length) return [];
    const map = new Map<number, any>();

    // 1a. Current OHLCV candles (M5/M15 or H1 from CSV)
    const ah = todaySession?.asiaHigh;
    const al = todaySession?.asiaLow;
    let lastCsvTime = 0;
    baseCandles.forEach((c: any) => {
      map.set(c.time, {
        time: c.time,
        range: [c.low, c.high],
        candleData: c,
        ...(ah !== undefined ? { asiaHighLine: ah } : {}),
        ...(al !== undefined ? { asiaLowLine: al } : {}),
      });
      if (c.time > lastCsvTime) lastCsvTime = c.time;
    });

    // 1b. Live H1 bars — only on H1 timeframe
    const windowStart = Date.now() / 1000 - displayDays * 86400;
    if (timeframe === "H1" && liveH1Data?.bars?.length) {
      liveH1Data.bars.forEach((c: any) => {
        if (c.time <= lastCsvTime) return;
        if (c.time < windowStart) return;
        map.set(c.time, {
          time: c.time,
          range: [c.low, c.high],
          candleData: { ...c, isLive: true },
          ...(ah !== undefined ? { asiaHighLine: ah } : {}),
          ...(al !== undefined ? { asiaLowLine: al } : {}),
        });
      });
    }

    // 2. Today's wave markers (on current timeline)
    waveMarkers.forEach((w: any) => {
      if (map.has(w.time)) {
        const entry = map.get(w.time)!;
        entry.wavePrice = w.price;
        entry.waveType  = w.type;
        entry.waveLabel = w.label;
      }
    });

    // 3. Aligned historical overlay (M5/M15/H1 — backend returns correct resolution)
    if (activeMatch?.alignedOverlay) {
      (activeMatch.alignedOverlay as { time: number; price: number }[]).forEach((pt) => {
        if (!map.has(pt.time)) map.set(pt.time, { time: pt.time });
        map.get(pt.time)!.histClose = pt.price;
      });
    }

    // 4. Projection points (M5/M15/H1 — backend returns correct resolution)
    if (activeMatch?.projectionPoints) {
      (activeMatch.projectionPoints as any[]).forEach((p) => {
        if (!map.has(p.time)) map.set(p.time, { time: p.time });
        const e = map.get(p.time)!;
        e.projPrice = p.price;
        e.projLabel = p.label;
      });
    }

    return Array.from(map.values())
      .sort((a, b) => a.time - b.time)
      .map((d, i) => ({ ...d, idx: i }));
  }, [ohlcvData, m5Data, m15Data, timeframe, waveMarkers, activeMatch, todaySession, liveH1Data, displayDays]);

  // ── Time ↔ Index maps (weekend gap-ийг арилгах) ──────────────────────────
  const { timeToIdx, idxToTime } = useMemo(() => {
    const timeToIdx = new Map<number, number>();
    const idxToTime = new Map<number, number>();
    chartData.forEach((d) => {
      timeToIdx.set(d.time, d.idx);
      idxToTime.set(d.idx, d.time);
    });
    return { timeToIdx, idxToTime };
  }, [chartData]);

  // Helper: timestamp → nearest idx
  const nearestIdx = (t: number): number => {
    if (timeToIdx.has(t)) return timeToIdx.get(t)!;
    let best = 0, bestDiff = Infinity;
    chartData.forEach((d) => {
      const diff = Math.abs(d.time - t);
      if (diff < bestDiff) { best = d.idx; bestDiff = diff; }
    });
    return best;
  };

  // ── Auto-zoom: show from previous session start → overlay/projection end ──
  useEffect(() => {
    if (!chartData.length) return;
    const currentCandles = (matchesData as any)?.currentCandles as any[] | undefined;
    const proj = activeMatch ? ((activeMatch as any)?.projectionPoints as any[] | undefined) : undefined;
    const overlay = activeMatch ? ((activeMatch as any)?.alignedOverlay as any[] | undefined) : undefined;
    const todayStart = currentCandles?.[0]?.time as number | undefined;
    // Left: 26 hours before today's Asia session start (covers previous full session)
    const leftTime = todayStart
      ? todayStart - 26 * 3600
      : Math.floor(Date.now() / 1000) - 2 * 86400;
    const leftIdx = Math.max(0, nearestIdx(leftTime));
    // Right: end of projection, or end of overlay, or 25h after session start
    const projEnd = proj?.length ? proj[proj.length - 1].time : 0;
    const overlayEnd = overlay?.length ? overlay[overlay.length - 1].time : 0;
    const rightTime = Math.max(projEnd, overlayEnd) > 0
      ? Math.max(projEnd, overlayEnd) + 3600
      : (todayStart ?? Math.floor(Date.now() / 1000)) + 25 * 3600;
    const rightIdx = Math.min(chartData.length - 1, nearestIdx(rightTime));
    setZoomDomain({ left: leftIdx, right: rightIdx });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch, timeframe, chartData]);

  // ── Scroll-wheel zoom (must be after chartData) ───────────────────────────
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!chartData.length) return;
      const dataMin = 0;
      const dataMax = chartData.length - 1;
      const curLeft  = zoomDomain?.left  ?? dataMin;
      const curRight = zoomDomain?.right ?? dataMax;
      const range = curRight - curLeft;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      const newRange = Math.max(8, Math.round(range * factor));
      const mid = (curLeft + curRight) / 2;
      let newLeft  = Math.max(dataMin, Math.round(mid - newRange / 2));
      let newRight = Math.min(dataMax, Math.round(mid + newRange / 2));
      if (newRight - newLeft < 8) {
        if (newLeft === dataMin) newRight = Math.min(dataMax, dataMin + 8);
        else newLeft = Math.max(dataMin, dataMax - 8);
      }
      setZoomDomain({ left: newLeft, right: newRight });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, zoomDomain]);

  // ── Visible idx range (no weekend gap) ───────────────────────────────────
  const xDomain = useMemo((): [number, number] => {
    if (!chartData.length) return [0, 0];
    // Validate zoom: if stored values exceed max idx, they are old timestamps → ignore
    const maxIdx = chartData.length - 1;
    if (zoomDomain && zoomDomain.left <= maxIdx && zoomDomain.right <= maxIdx) {
      return [zoomDomain.left, zoomDomain.right];
    }
    const windowStartTime = Math.floor(Date.now() / 1000) - displayDays * 86400;
    let leftIdx = 0;
    for (let i = 0; i < chartData.length; i++) {
      if (chartData[i].time >= windowStartTime) { leftIdx = chartData[i].idx; break; }
    }
    const rightEdge = chartData[chartData.length - 1].idx;
    return [leftIdx, rightEdge];
  }, [chartData, displayDays, zoomDomain]);

  // Filtered data for the chart (category scale — no domain prop needed)
  const visibleChartData = useMemo(
    () => chartData.filter((d) => d.idx >= xDomain[0] && d.idx <= xDomain[1]),
    [chartData, xDomain]
  );

  // ── Session reference areas (idx-based, clamped to visible window) ────────
  const sessionAreas = useMemo(() => {
    if (!sessionsData || !chartData.length) return [];
    const tMin = chartData[0].time;
    const tMax = chartData[chartData.length - 1].time;
    const [visLeft, visRight] = xDomain;
    const areas: { name: string; x1: number; x2: number; bg: string }[] = [];

    const localNearestIdx = (t: number): number => {
      let lo = 0, hi = chartData.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (chartData[mid].time < t) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && Math.abs(chartData[lo - 1].time - t) < Math.abs(chartData[lo].time - t)) lo--;
      return chartData[lo].idx;
    };

    for (const day of sessionsData as any[]) {
      for (const box of day.sessionBoxes) {
        if (box.endTime < tMin || box.startTime > tMax) continue;
        const cfg = SESSION_COLORS[box.name as string];
        if (!cfg) continue;
        const x1 = Math.max(visLeft, localNearestIdx(box.startTime));
        const x2 = Math.min(visRight, localNearestIdx(box.endTime));
        if (x1 < x2) areas.push({ name: box.name, x1, x2, bg: cfg.bg });
      }
    }
    return areas;
  }, [sessionsData, chartData, xDomain]);

  // ── Y-axis domain ─────────────────────────────────────────────────────────
  const [yMin, yMax] = useMemo(() => {
    const baseCandles: any[] =
      timeframe === "M5"  ? (m5Data  ?? []) :
      timeframe === "M15" ? (m15Data ?? []) :
      (ohlcvData ?? []);
    if (!baseCandles.length) return [2700, 4700];
    const allPrices: number[] = [];
    baseCandles.forEach((c: any) => allPrices.push(c.low, c.high));
    if (!allPrices.length) return [2700, 4700];
    const lo = Math.min(...allPrices);
    const hi = Math.max(...allPrices);
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [ohlcvData, m5Data, m15Data, timeframe]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 flex flex-col gap-4">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight">AsiaWave Pattern Matcher</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">XAUUSD · M5→H1 · Marketsess sessions · Real data</p>
            {livePrice && (
              <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${livePrice.isMarketOpen ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
                <span className="text-xs font-bold text-amber-400">
                  XAU/USD ${livePrice.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
                {livePrice.changePercent !== undefined && (
                  <span className={`text-[10px] font-semibold ${livePrice.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {livePrice.changePercent >= 0 ? "+" : ""}{livePrice.changePercent.toFixed(2)}%
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  · {livePrice.source === "twelvedata" ? "live" : "24h delayed"}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-card border border-border rounded-md px-1 py-0.5">
            {[2, 3, 5, 7].map((d) => (
              <button
                key={d}
                onClick={() => setDisplayDays(d)}
                className={`px-2.5 py-1 text-xs rounded transition-all ${displayDays === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {d}D
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => qc.invalidateQueries()} disabled={loading || fetchMatches}>
            <RefreshCw className={`w-4 h-4 ${fetchMatches ? "animate-spin" : ""}`} />
          </Button>
          {/* Telegram send button */}
          <div className="relative flex flex-col items-end">
            <Button
              variant="outline"
              size="sm"
              className={`gap-1.5 text-xs transition-all ${
                tgResult?.ok ? "border-green-500/50 text-green-400" :
                tgResult?.ok === false ? "border-red-500/50 text-red-400" :
                "border-blue-500/40 text-blue-400 hover:border-blue-500 hover:text-blue-300"
              }`}
              onClick={sendToTelegram}
              disabled={tgSending}
              title="Send current best match to Telegram"
            >
              {tgSending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : tgResult?.ok ? (
                <CheckCircle className="w-3.5 h-3.5" />
              ) : tgResult?.ok === false ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>
                {tgSending ? "Sending…" : tgResult?.ok ? "Sent!" : tgResult?.ok === false ? "Failed" : "Telegram"}
              </span>
            </Button>
            {tgResult?.ok === false && tgResult.error && (
              <div className="absolute top-full mt-1 right-0 z-50 bg-red-900/90 border border-red-500/50 text-red-200 text-[10px] rounded px-2 py-1 whitespace-nowrap max-w-xs">
                {tgResult.error}
              </div>
            )}
            {tgResult?.ok && tgResult.matchDate && (
              <div className="absolute top-full mt-1 right-0 z-50 bg-green-900/90 border border-green-500/50 text-green-200 text-[10px] rounded px-2 py-1 whitespace-nowrap">
                Sent! Best match: {tgResult.matchDate}
              </div>
            )}
          </div>
          <Button variant="outline" size="icon" onClick={() => setIsDark(!isDark)}>
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Live gold price card — Twelve Data */}
        <Card className={`border-amber-500/30 ${livePrice?.isMarketOpen ? "shadow-amber-500/10 shadow-sm" : ""}`}>
          <CardContent className="p-3">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${livePrice?.isMarketOpen ? "bg-green-400 animate-pulse" : "bg-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">XAU/USD</span>
                {livePrice?.isMarketOpen !== undefined && (
                  <span className={`text-[9px] px-1 rounded font-medium ${livePrice.isMarketOpen ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {livePrice.isMarketOpen ? "OPEN" : "CLOSED"}
                  </span>
                )}
              </div>
              {livePrice?.changePercent !== undefined && (
                <span className={`text-[11px] font-bold ${livePrice.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {livePrice.changePercent >= 0 ? "+" : ""}{livePrice.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
            {!livePrice ? (
              <Skeleton className="h-7 w-28 mb-1" />
            ) : (
              <>
                <div className="text-xl font-bold text-amber-400 leading-tight">
                  ${livePrice.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
                {livePrice.change !== undefined && (
                  <div className={`text-[10px] font-medium ${livePrice.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {livePrice.change >= 0 ? "▲" : "▼"} ${Math.abs(livePrice.change).toFixed(2)}
                  </div>
                )}
                {livePrice.high !== undefined && (
                  <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>H: <span className="text-green-400">${livePrice.high.toLocaleString()}</span></span>
                    <span>L: <span className="text-red-400">${livePrice.low?.toLocaleString()}</span></span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <KPICard title="Days Analyzed" value={matchesData?.matches?.length ?? 0} icon={Activity} loading={loadMatches} />
        <KPICard
          title="Best Match Score"
          value={bestMatch ? `${(bestMatch as any).score.toFixed(1)}%` : "N/A"}
          icon={Target}
          loading={loadMatches}
          accent={(bestMatch as any)?.score > 80 ? "text-green-400" : "text-amber-400"}
        />
        <KPICard title="Similar Patterns (>70%)" value={similarCount} icon={Layers} loading={loadMatches} />
        <KPICard
          title="Asia Session Range"
          value={todaySession ? `$${todaySession.asiaRange.toFixed(2)}` : "N/A"}
          icon={BarChart2}
          loading={loadMatches}
        />
      </div>

      {/* ── Main Layout ── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 flex-1">

        {/* Chart + Analysis column */}
        <div className="xl:col-span-3 flex flex-col gap-4">

          {/* Session Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-xs text-muted-foreground">
            {Object.entries(SESSION_COLORS).map(([name, { bg, label, border }]) => (
              <span key={name} className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: border + "99" }} />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1 ml-2">
              <span className="inline-block w-5 border-t-2 border-amber-400" />
              Таарсан хэв
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-5 border-t-2 border-dashed border-amber-400" />
              Үргэлжлэл
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-amber-400" />
              Wave Peak
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-blue-400" />
              Wave Low
            </span>
            {liveH1Data?.bars?.length && (
              <span className="flex items-center gap-1 ml-1 bg-amber-500/10 border border-amber-500/30 rounded px-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400">Live (Twelve Data)</span>
              </span>
            )}
          </div>

          {/* Main Chart */}
          <Card ref={chartRef} className="flex flex-col">
            <CardHeader className="py-2.5 border-b border-border/50 flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold">XAUUSD · {timeframe} · {displayDays}D</CardTitle>
                {activeMatch && (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                    Overlay: {activeMatch.date} ({(activeMatch as any).score?.toFixed(1)}%)
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Timeframe selector */}
                <div className="flex items-center rounded border border-border overflow-hidden text-xs">
                  {(["M5", "M15", "H1"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-2 py-0.5 transition-colors ${
                        timeframe === tf
                          ? "bg-amber-500 text-black font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                {/* Zoom reset */}
                {zoomDomain && (
                  <button
                    onClick={() => setZoomDomain(null)}
                    className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    title="Reset zoom"
                  >
                    ↺ Reset
                  </button>
                )}
                {selectedDate && (
                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedDate(null)}>
                    × Clear
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0" style={{ height: 460 }} ref={chartContainerRef}>
              {loading ? (
                <Skeleton className="w-full h-full rounded-b-lg" />
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={visibleChartData} margin={{ top: 16, right: 14, left: 2, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#222" : "#eee"} vertical={false} />

                    <XAxis
                      dataKey="idx"
                      tickFormatter={(v) => {
                        const t = idxToTime.get(Number(v));
                        return t ? format(new Date(t * 1000), "MM/dd HH:mm") : "";
                      }}
                      stroke={isDark ? "#444" : "#bbb"}
                      tick={{ fill: isDark ? "#666" : "#888", fontSize: 10 }}
                      minTickGap={70}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      orientation="right"
                      domain={[yMin, yMax]}
                      stroke={isDark ? "#333" : "#bbb"}
                      tick={makePriceTick(livePrice?.price)}
                      tickFormatter={(v) => v.toFixed(2)}
                      width={72}
                    />

                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? "#111827" : "#fff",
                        borderColor: isDark ? "#374151" : "#e5e7eb",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(idx) => {
                        const t = idxToTime.get(Math.round(idx));
                        return t ? format(new Date(t * 1000), "yyyy-MM-dd HH:mm") : String(idx);
                      }}
                      formatter={(val: any, name: string) => {
                        if (name === "range") return [null, null];
                        if (name === "wavePrice") return [null, null];
                        if (typeof val === "number") return [`$${val.toFixed(2)}`, name];
                        return [null, null];
                      }}
                    />

                    {/* Session background bands */}
                    {sessionAreas.map((a, i) => (
                      <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill={a.bg} fillOpacity={1} stroke="none" />
                    ))}

                    {/* Live price horizontal dashed line — orange */}
                    {livePrice?.price && (
                      <ReferenceLine
                        y={livePrice.price}
                        stroke="#f59e0b"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        strokeOpacity={0.7}
                      />
                    )}

                    {/* Candlesticks */}
                    <Bar dataKey="range" shape={<Candlestick />} isAnimationActive={false} name="range" />

                    {/* Asia High / Low — drawn as plain Lines so they're definitely visible */}
                    <Line dataKey="asiaHighLine" type="monotone" stroke="#4ade80" strokeWidth={2} strokeDasharray="8 4" dot={false} isAnimationActive={false} name="Asia H" legendType="none" />
                    <Line dataKey="asiaLowLine"  type="monotone" stroke="#f87171" strokeWidth={2} strokeDasharray="8 4" dot={false} isAnimationActive={false} name="Asia L" legendType="none" />

                    {/* Wave markers as invisible line with custom dots */}
                    <Line
                      dataKey="wavePrice"
                      type="linear"
                      stroke="transparent"
                      dot={<WaveDot />}
                      activeDot={false}
                      isAnimationActive={false}
                      name="wavePrice"
                    />

                    {/* Past overlay — matched historical movement (solid amber) */}
                    <Line
                      dataKey="histClose"
                      type="monotone"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="none"
                      dot={false}
                      isAnimationActive={false}
                      name="Таарсан хэв"
                    />

                    {/* Future projection — MQL5-style zigzag via Customized SVG */}
                    <Customized
                      component={(p: any) => (
                        <ZigzagProjection
                          {...p}
                          projPoints={(activeMatch as any)?.projectionPoints}
                          timeToIdx={timeToIdx}
                        />
                      )}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  Loading GOLD data…
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── HIGH PROBABILITY PATTERN Alert Banner ── */}
          {(matchesData as any)?.highProbAlert?.active && (
            <div className={`rounded-xl border-2 p-4 ${
              (matchesData as any).highProbAlert.patternMatch?.dominant === 'BEAR'
                ? 'border-red-500 bg-red-950/40'
                : 'border-emerald-500 bg-emerald-950/40'
            }`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-2xl">🔥</span>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold text-base tracking-wide ${
                    (matchesData as any).highProbAlert.patternMatch?.dominant === 'BEAR'
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }`}>
                    HIGH PROBABILITY PATTERN DETECTED
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {(matchesData as any).highProbAlert.reason}
                  </div>
                  {/* Session context — next session forecast warning */}
                  {(matchesData as any).highProbAlert.patternMatch && (() => {
                    const pm = (matchesData as any).highProbAlert.patternMatch;
                    const isBottom = pm.patternName?.startsWith('BOTTOM');
                    const asiaComplete = (matchesData as any).asiaComplete;
                    return (
                      <>
                        <div className={`mt-2 text-xs rounded px-2 py-1 inline-flex items-center gap-1 ${
                          asiaComplete
                            ? 'bg-blue-900/50 text-blue-300'
                            : 'bg-yellow-900/50 text-yellow-300'
                        }`}>
                          {asiaComplete ? '✅' : '⏳'}
                          <span>
                            {isBottom
                              ? (asiaComplete
                                  ? 'Asia session дууссан — ДАРААГИЙН session-д BUY forecast'
                                  : 'Asia session явцдаа — Bottom wave бүрэлдэж байна. ОДОО орохгүй, session дууссаны дараа орно.')
                              : (asiaComplete
                                  ? 'Asia session дууссан — ДАРААГИЙН session-д forecast'
                                  : 'Asia session явцдаа — Peak wave бүрэлдэж байна. Session дууссаны дараа орно.')
                            }
                          </span>
                        </div>
                        <div className="flex gap-4 mt-2 flex-wrap text-xs">
                          <span className={`font-semibold px-2 py-0.5 rounded ${
                            pm.dominant === 'BEAR' ? 'bg-red-900 text-red-300' : 'bg-emerald-900 text-emerald-300'
                          }`}>
                            {pm.signal}
                          </span>
                          <span className="text-muted-foreground">Edge: <b className="text-foreground">{pm.edge}%</b></span>
                          <span className="text-muted-foreground">Bull: <b className="text-green-400">{pm.bullPct}%</b></span>
                          <span className="text-muted-foreground">Bear: <b className="text-red-400">{pm.bearPct}%</b></span>
                          <span className="text-muted-foreground">Count: <b className="text-foreground">{pm.count}x</b></span>
                          <span className="text-muted-foreground">ML Score: <b className="text-foreground">{pm.mlScore}</b></span>
                        </div>
                      </>
                    );
                  })()}
                </div>
                {(matchesData as any).highProbAlert.patternMatch?.quantizedWaves?.length > 0 && (
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground mb-1">Quantized Waves</div>
                    <div className="font-mono text-sm font-bold text-foreground">
                      {(matchesData as any).highProbAlert.patternMatch.quantizedWaves.join('-')}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {(matchesData as any).highProbAlert.patternMatch.patternLabel}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── C: Seasonal Bias Badge ──────────────────────────────── */}
          {(matchesData as any)?.seasonalBias && (() => {
            const sb = (matchesData as any).seasonalBias;
            const isBearMonth = sb.bearPct > sb.bullPct;
            const isStrong = Math.abs(sb.bearPct - sb.bullPct) >= 20;
            return (
              <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
                isBearMonth
                  ? isStrong ? 'border-red-700 bg-red-950/30' : 'border-red-800/50 bg-red-950/20'
                  : isStrong ? 'border-emerald-700 bg-emerald-950/30' : 'border-emerald-800/50 bg-emerald-950/20'
              }`}>
                <span className="text-xl">📅</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-bold ${isBearMonth ? 'text-red-400' : 'text-emerald-400'}`}>
                    {sb.label} сарын seasonal bias{isStrong ? (isBearMonth ? ' — ХҮЧТЭЙ BEAR' : ' — ХҮЧТЭЙ BULL') : ''}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    400 session-ийн статистик: Bull <b className="text-green-400">{sb.bullPct}%</b>  Bear <b className="text-red-400">{sb.bearPct}%</b>  n={sb.n}
                  </div>
                </div>
                <div className={`text-2xl font-black ${isBearMonth ? 'text-red-500' : 'text-emerald-500'}`}>
                  {isBearMonth ? '▼' : '▲'} {Math.max(sb.bullPct, sb.bearPct)}%
                </div>
              </div>
            );
          })()}

          {/* ── B: ML Extension Targets (T1/T2/T3) ─────────────────── */}
          {(matchesData as any)?.mlExtensionTarget && (() => {
            const ext = (matchesData as any).mlExtensionTarget;
            const fmt = (v: number) => v?.toFixed(2);
            const isBull = (matchesData as any)?.todayDirection !== 'down';
            return (
              <div className="rounded-xl border border-sky-800/60 bg-sky-950/20 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">🎯</span>
                  <span className="text-xs font-bold text-sky-400">ML Extension Targets</span>
                  <span className="text-[10px] text-muted-foreground ml-1">
                    (Top 3 match-ийн жинхэнэ история extension дундаж)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* UP targets */}
                  <div>
                    <div className="text-[10px] text-emerald-400 mb-1 font-semibold">
                      ▲ BUY ext avg: {ext.avgUpExt}% ({ext.upSessions}/3 session)
                    </div>
                    <div className="space-y-0.5 font-mono text-xs">
                      <div className="flex justify-between">
                        <span className={`text-[10px] ${isBull ? 'text-emerald-300 font-bold' : 'text-muted-foreground'}`}>T1</span>
                        <span className={isBull ? 'text-emerald-300 font-bold' : 'text-muted-foreground'}>{fmt(ext.t1Up)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={`text-[10px] ${isBull ? 'text-emerald-400 font-bold' : 'text-muted-foreground'}`}>T2</span>
                        <span className={isBull ? 'text-emerald-400 font-bold' : 'text-muted-foreground'}>{fmt(ext.t2Up)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={`text-[10px] ${isBull ? 'text-emerald-500 font-bold' : 'text-muted-foreground'}`}>T3</span>
                        <span className={isBull ? 'text-emerald-500 font-bold' : 'text-muted-foreground'}>{fmt(ext.t3Up)}</span>
                      </div>
                    </div>
                  </div>
                  {/* DOWN targets */}
                  <div>
                    <div className="text-[10px] text-red-400 mb-1 font-semibold">
                      ▼ SELL ext avg: {ext.avgDownExt}% ({ext.downSessions}/3 session)
                    </div>
                    <div className="space-y-0.5 font-mono text-xs">
                      <div className="flex justify-between">
                        <span className={`text-[10px] ${!isBull ? 'text-red-300 font-bold' : 'text-muted-foreground'}`}>T1</span>
                        <span className={!isBull ? 'text-red-300 font-bold' : 'text-muted-foreground'}>{fmt(ext.t1Down)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={`text-[10px] ${!isBull ? 'text-red-400 font-bold' : 'text-muted-foreground'}`}>T2</span>
                        <span className={!isBull ? 'text-red-400 font-bold' : 'text-muted-foreground'}>{fmt(ext.t2Down)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={`text-[10px] ${!isBull ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>T3</span>
                        <span className={!isBull ? 'text-red-500 font-bold' : 'text-muted-foreground'}>{fmt(ext.t3Down)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── ML Prediction Panel ─────────────────────────────────── */}
          {(matchesData as any)?.mlPrediction?.enabled && (() => {
            const ml = (matchesData as any).mlPrediction;
            const pl = ml.patternLookup;
            const verdict = ml.combined.verdict; // BULLISH | BEARISH | NEUTRAL
            const conf = ml.combined.confidence;  // HIGH | MEDIUM | LOW
            const verdictColor = verdict === 'BULLISH' ? 'text-emerald-400' : verdict === 'BEARISH' ? 'text-red-400' : 'text-yellow-400';
            const verdictBg    = verdict === 'BULLISH' ? 'bg-emerald-950/30 border-emerald-800' : verdict === 'BEARISH' ? 'bg-red-950/30 border-red-800' : 'bg-yellow-950/30 border-yellow-800';
            const confColor    = conf === 'HIGH' ? 'text-emerald-400' : conf === 'MEDIUM' ? 'text-yellow-400' : 'text-muted-foreground';
            const rangeColor   = ml.rangeClass === 'SMALL' ? 'text-sky-400' : ml.rangeClass === 'MEDIUM' ? 'text-emerald-400' : ml.rangeClass === 'LARGE' ? 'text-yellow-400' : 'text-red-400';
            return (
              <Card className={`border ${verdictBg}`}>
                <CardHeader className="py-3 border-b border-border/50">
                  <CardTitle className="text-sm flex items-center gap-2">
                    🤖 ML Prediction <span className="text-xs text-muted-foreground">(400 historical days)</span>
                    <span className={`ml-auto text-base font-bold ${verdictColor}`}>{verdict}</span>
                    <span className={`text-xs font-medium ${confColor}`}>[{conf}]</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">

                  {/* Combined score bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-emerald-400 font-medium">BULL {ml.combined.bullScore}%</span>
                      <span className="text-muted-foreground">Combined Score</span>
                      <span className="text-red-400 font-medium">BEAR {ml.combined.bearScore}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${ml.combined.bullScore}%` }} />
                    </div>
                  </div>

                  {/* 3-column info grid */}
                  <div className="grid grid-cols-3 gap-2 text-xs">

                    {/* Direction Bias */}
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="text-muted-foreground mb-1">Direction Bias</div>
                      <div className="font-bold text-emerald-400">{ml.directionBias.bullPct}%</div>
                      <div className="text-red-400">{ml.directionBias.bearPct}%</div>
                      <div className="text-muted-foreground text-[10px] mt-0.5">n={ml.directionBias.n}</div>
                    </div>

                    {/* Pattern Match */}
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="text-muted-foreground mb-1">Pattern Match</div>
                      {pl ? (
                        <>
                          <div className="font-mono text-[10px] text-foreground mb-0.5">{pl.fibKey}</div>
                          <div className="text-emerald-400 font-bold">{pl.bullPct}%</div>
                          <div className="text-muted-foreground text-[10px]">n={pl.n}</div>
                        </>
                      ) : (
                        <div className="text-muted-foreground text-[10px]">No match</div>
                      )}
                    </div>

                    {/* Range */}
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="text-muted-foreground mb-1">Range</div>
                      <div className={`font-bold ${rangeColor}`}>{ml.rangeClass}</div>
                      <div className="text-foreground text-[10px]">{((matchesData as any)?.today?.asiaRange ?? 0) * 10 | 0} pips</div>
                      <div className="text-muted-foreground text-[10px]">med=293p</div>
                    </div>
                  </div>

                  {/* Extension Targets */}
                  {pl && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-emerald-950/30 border border-emerald-900 rounded-lg p-2">
                        <div className="text-muted-foreground text-[10px] mb-1">⬆ Up Extension Target</div>
                        <div className="font-bold text-emerald-400 text-sm">${pl.targetUpPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                        <div className="text-muted-foreground text-[10px]">+{pl.avgUpExt}% of range ({pl.brokeHighPct}% break)</div>
                      </div>
                      <div className="bg-red-950/30 border border-red-900 rounded-lg p-2">
                        <div className="text-muted-foreground text-[10px] mb-1">⬇ Down Extension Target</div>
                        <div className="font-bold text-red-400 text-sm">${pl.targetDownPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                        <div className="text-muted-foreground text-[10px]">-{pl.avgDownExt}% of range ({pl.brokeLowPct}% break)</div>
                      </div>
                    </div>
                  )}

                  {/* Breakout & Close stats */}
                  {pl && (
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
                      <div className="bg-muted/20 rounded p-1">
                        <div className="text-muted-foreground">First Break</div>
                        <div className="text-emerald-400">H {pl.firstBreakHigh}%</div>
                        <div className="text-red-400">L {pl.firstBreakLow}%</div>
                      </div>
                      <div className="bg-muted/20 rounded p-1">
                        <div className="text-muted-foreground">Close vs Sess</div>
                        <div className="text-emerald-400">↑ {pl.closeAbovePct}%</div>
                        <div className="text-red-400">↓ {pl.closeBelowPct}%</div>
                      </div>
                      <div className="bg-muted/20 rounded p-1">
                        <div className="text-muted-foreground">Wave Char</div>
                        <div className="text-foreground">R12: {ml.waveCharacter.bottomRatio12 ?? '—'}</div>
                        <div className={(ml.waveCharacter.bottomDeclining ? 'text-yellow-400' : 'text-muted-foreground')}>
                          {ml.waveCharacter.bottomDeclining ? '↓ Decl' : '→ Flat'}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Wave Analysis Panel */}
          {todaySession && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Today's Asia Analysis */}
              <Card>
                <CardHeader className="py-3 border-b border-border/50">
                  <CardTitle className="text-sm">Today's Asia Session Analysis</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  <div className="flex gap-6 flex-wrap items-end">
                    <div>
                      <p className="text-xs text-muted-foreground">Session Range</p>
                      <p className="text-2xl font-bold text-amber-400">${todaySession.asiaRange.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">High</p>
                      <p className="font-semibold text-green-400">${todaySession.asiaHigh.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Low</p>
                      <p className="font-semibold text-red-400">${todaySession.asiaLow.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Direction</p>
                      {(matchesData as any)?.todayDirection === 'down' ? (
                        <span className="text-xs bg-red-900/40 text-red-300 border border-red-500/40 rounded px-2 py-1 font-semibold">↓ HIGH→LOW (унасан)</span>
                      ) : (
                        <span className="text-xs bg-green-900/40 text-green-300 border border-green-500/40 rounded px-2 py-1 font-semibold">↑ LOW→HIGH (өссөн)</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                      <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-amber-400" /> Peak Waves (from Asia Low)</span>
                      {(matchesData as any)?.matchMode === 'bottom-only' && (
                        <span className="text-[10px] bg-slate-700/60 text-slate-400 border border-slate-600/40 rounded px-1.5 py-0.5">
                          score-д ороогүй ({(matchesData as any)?.todayPeakWaves ?? 0} wave)
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {todaySession.peakWavePercents?.map((pct: number, i: number) => (
                        <div key={i} className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${(matchesData as any)?.matchMode === 'bottom-only' ? 'bg-slate-700/40 border border-slate-600/40 text-slate-400' : 'bg-amber-500/20 border border-amber-500/40 text-amber-400'}`}>
                            {pct.toFixed(0)}%
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-1">W{i + 1}</span>
                        </div>
                      ))}
                      {(!todaySession.peakWavePercents?.length) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                      <span className="flex items-center gap-1"><TrendingDown className="w-3 h-3 text-blue-400" /> Bottom Waves (from Asia High)</span>
                      {(matchesData as any)?.matchMode === 'bottom-only' && (
                        <span className="text-[10px] bg-blue-900/40 text-blue-300 border border-blue-500/40 rounded px-1.5 py-0.5">
                          ✓ score тооцсон ({(matchesData as any)?.todayBottomWaves ?? 0} wave)
                        </span>
                      )}
                      {(matchesData as any)?.matchMode === 'peak+bottom' && (
                        <span className="text-[10px] bg-green-900/40 text-green-300 border border-green-500/40 rounded px-1.5 py-0.5">
                          ✓ peak+bottom хоёулаа
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {todaySession.bottomWavePercents?.map((pct: number, i: number) => (
                        <div key={i} className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs font-bold text-blue-400">
                            {pct.toFixed(0)}%
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-1">W{i + 1}</span>
                        </div>
                      ))}
                      {(!todaySession.bottomWavePercents?.length) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Best Match Detail */}
              {activeMatch && (
                <Card className="border-amber-500/30">
                  <CardHeader className="py-3 border-b border-border/50">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>Best Match: {(activeMatch as any).date}</span>
                      <Badge className={`text-xs ${(activeMatch as any).score > 80 ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"}`}>
                        {(activeMatch as any).score?.toFixed(1)}%
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Asia Range</p>
                        <p className="font-semibold">${(activeMatch as any).asiaRange?.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Peak Score</p>
                        <p className="font-semibold text-blue-400">{(activeMatch as any).peakScore?.toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Bottom Score</p>
                        <p className="font-semibold text-purple-400">{(activeMatch as any).bottomScore?.toFixed(0)}%</p>
                      </div>
                    </div>

                    {/* Score bars */}
                    <div className="space-y-2">
                      {[
                        { label: "Peak Wave Match",   val: (activeMatch as any).peakScore,   color: "bg-blue-500" },
                        { label: "Bottom Wave Match", val: (activeMatch as any).bottomScore, color: "bg-purple-500" },
                        { label: "Range Similarity",  val: (activeMatch as any).rangeScore,  color: "bg-amber-500" },
                      ].map(({ label, val, color }) => (
                        <div key={label}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono">{val?.toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(0, val ?? 0)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* DTW/Pearson/Direction sub-score breakdown */}
                    {((activeMatch as any).dtwPeak || (activeMatch as any).dtwBtm) ? (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Wave Scoring Breakdown (DTW+Pearson+Dir)</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {[
                            { label: "DTW ↑ Peak",    val: (activeMatch as any).dtwPeak,     color: "text-blue-300" },
                            { label: "DTW ↓ Bottom",  val: (activeMatch as any).dtwBtm,      color: "text-purple-300" },
                            { label: "Pearson ↑",     val: (activeMatch as any).pearsonPeak, color: "text-blue-300" },
                            { label: "Pearson ↓",     val: (activeMatch as any).pearsonBtm,  color: "text-purple-300" },
                            { label: "Direction ↑",   val: (activeMatch as any).dirPeak,     color: "text-blue-300" },
                            { label: "Direction ↓",   val: (activeMatch as any).dirBtm,      color: "text-purple-300" },
                          ].map(({ label, val, color }) => val != null ? (
                            <div key={label} className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">{label}</span>
                              <span className={`font-mono font-semibold ${color}`}>{(val as number).toFixed(0)}%</span>
                            </div>
                          ) : null)}
                        </div>
                      </div>
                    ) : null}

                    {(activeMatch as any).projectionPoints?.filter((p: any) => p.label).length > 0 && (
                      <div className="pt-1">
                        <p className="text-xs text-muted-foreground mb-1">⚡ Zigzag Проекц</p>
                        <div className="flex gap-2 flex-wrap">
                          {(activeMatch as any).projectionPoints
                            .filter((p: any) => p.label)
                            .map((p: any, i: number) => {
                              const isUp = (p.label as string).includes("+");
                              return (
                                <div key={p.label || i} className={`border rounded px-2 py-1 text-center ${isUp ? "bg-green-500/10 border-green-500/40" : "bg-red-500/10 border-red-500/40"}`}>
                                  <p className={`text-[10px] font-bold ${isUp ? "text-green-400" : "text-red-400"}`}>{isUp ? "▲" : "▼"} {p.label}</p>
                                  <p className="text-xs font-bold">${p.price.toFixed(0)}</p>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ── Historical Mini Charts ── */}
          {!loadMatches && (matchesData?.matches?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="py-3 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-amber-400" />
                  Matching Historical Days
                  <span className="text-xs font-normal text-muted-foreground">(click to overlay on main chart)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                  {(matchesData!.matches as any[]).slice(0, 5).map((match, i) => (
                    <HistoricalDayCard
                      key={match.date}
                      match={match}
                      rank={i + 1}
                      isSelected={selectedDate === match.date || (!selectedDate && i === 0)}
                      onClick={() => setSelectedDate(
                        selectedDate === match.date && i !== 0 ? null : match.date
                      )}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right Column: Matches + Trade Signal ── */}
        <div className="flex flex-col gap-4 min-h-0">

        {/* ── Matches Panel ── */}
        <Card className="flex flex-col overflow-hidden border-t-4 border-t-amber-500">
          <CardHeader className="py-3 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-sm">
              <span>Historical Matches</span>
              {bestMatch && (
                <p className="text-xs font-normal text-amber-400 mt-0.5">
                  Best: {(bestMatch as any).date} ({(bestMatch as any).score?.toFixed(1)}%)
                </p>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            {loadMatches ? (
              <div className="p-3 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : matchesData?.matches?.length ? (
              <ScrollArea className="h-[calc(100vh-260px)] min-h-[360px]">
                <div className="p-2 space-y-1.5">
                  {(matchesData.matches as any[]).slice(0, 5).map((match, i) => {
                    const isBest = i === 0;
                    const isSelected = selectedDate === match.date || (!selectedDate && isBest);
                    return (
                      <button
                        key={match.date}
                        onClick={() => setSelectedDate(isSelected ? null : match.date)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          isSelected
                            ? "bg-amber-500/10 border-amber-500/40 shadow-sm"
                            : "bg-card border-border hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex justify-between mb-1.5">
                          <span className="text-xs font-semibold">{match.date}</span>
                          <span className={`text-xs font-bold ${
                            match.score > 80 ? "text-green-400" :
                            match.score > 65 ? "text-amber-400" :
                            "text-muted-foreground"
                          }`}>
                            {match.score.toFixed(1)}%
                          </span>
                        </div>
                        <div className="space-y-1">
                          {[
                            { label: "Peak", val: match.peakScore, color: "bg-blue-500" },
                            { label: "Btm",  val: match.bottomScore, color: "bg-purple-500" },
                          ].map(({ label, val, color }) => (
                            <div key={label} className="flex items-center gap-1.5">
                              <span className="text-[10px] w-6 text-muted-foreground">{label}</span>
                              <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                                <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(0, val)}%` }} />
                              </div>
                              <span className="text-[10px] w-7 text-right font-mono">{val.toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                        {/* Direction + Entry + T1 */}
                        {(() => {
                          const outcome = match.mlOutcome as string | undefined;
                          const ah: number = match.asiaHigh;
                          const al: number = match.asiaLow;
                          if (!outcome || outcome === 'INSIDE' || !ah || !al) return null;
                          const bull = outcome === 'BULLISH';
                          const entryPrice = bull ? al : ah;
                          const t1Price    = bull ? ah : al;
                          return (
                            <div className={`mt-1.5 rounded px-2 py-1 flex items-center justify-between border ${
                              bull ? 'border-emerald-500/30 bg-emerald-950/30' : 'border-red-500/30 bg-red-950/30'
                            }`}>
                              <span className={`text-[10px] font-bold ${bull ? 'text-emerald-400' : 'text-red-400'}`}>
                                {bull ? '▲ BUY' : '▼ SELL'} <span className="font-mono">${entryPrice.toFixed(2)}</span>
                              </span>
                              <span className={`text-[10px] font-mono font-semibold ${bull ? 'text-emerald-300' : 'text-red-300'}`}>
                                T1 ${t1Price.toFixed(2)}
                              </span>
                            </div>
                          );
                        })()}
                        {isBest && (
                          <p className="text-[10px] text-amber-400 font-semibold mt-1.5 tracking-wider uppercase">⭐ Best Match</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No matches found</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Trade Signal Panel ── */}
        {!loadMatches && matchesData && (matchesData.matches as any[]).length > 0 && (() => {
          const ms = (matchesData.matches as any[]).slice(0, 5);
          const bullCount = ms.filter((m: any) => m.mlOutcome === 'BULLISH').length;
          const bearCount = ms.filter((m: any) => m.mlOutcome === 'BEARISH').length;
          const total = ms.length;
          const majority = bearCount > bullCount ? 'BEAR' : bullCount > bearCount ? 'BULL' : 'TIE';

          const mlVerdict = (matchesData as any).mlPrediction?.combined?.verdict as string | undefined;
          const seasonal  = (matchesData as any).seasonalBias as any;
          const hpa       = (matchesData as any).highProbAlert as any;
          const td        = (matchesData as any).today as any;

          // ── Шийдвэр: majority vote (match majority + ML + seasonal + HIGH PROB) ──
          let bullVotes = 0, bearVotes = 0;
          if (majority === 'BULL') bullVotes++; else if (majority === 'BEAR') bearVotes++;
          if (mlVerdict === 'BULLISH') bullVotes++; else if (mlVerdict === 'BEARISH') bearVotes++;
          if ((seasonal?.bearPct ?? 0) >= 55) bearVotes++; else if ((seasonal?.bullPct ?? 0) >= 55) bullVotes++;
          if (hpa?.patternMatch?.dominant === 'BULLISH') bullVotes++; else if (hpa?.patternMatch?.dominant === 'BEARISH') bearVotes++;

          const isBull = bullVotes > bearVotes;
          const isBear = bearVotes > bullVotes;

          const asiaHigh: number = td?.asiaHigh ?? 0;
          const asiaLow:  number = td?.asiaLow  ?? 0;
          const asiaRange: number = td?.asiaRange ?? 0;

          // ── W1-ийн хэмжээгээр Target тооцоолол ──
          // BEARISH → bottomWaves W1, BULLISH → peakWaves W1
          const w1Raw = isBull
            ? td?.peakWaves?.[0]
            : td?.bottomWaves?.[0];
          const w1Pct:   number = w1Raw?.wavePercent ?? 0;   // % of asiaRange
          const w1Price: number = w1Raw?.price ?? 0;
          const w1Pips:  number = (w1Pct / 100) * asiaRange; // pip хэмжээ

          // Entry + T1
          const entryPrice  = isBull ? asiaLow  : asiaHigh;
          const t1Price     = isBull
            ? asiaHigh + w1Pips   // BUY:  asiaHigh + W1 pips
            : asiaLow  - w1Pips;  // SELL: asiaLow  − W1 pips
          const entryType   = isBull ? 'LIMIT BUY' : isBear ? 'LIMIT SELL' : 'WAIT';
          const signalLabel = isBull ? '▲ BUY'     : isBear ? '▼ SELL'     : '— WAIT';

          return (
            <Card className={`border-t-4 ${isBull ? 'border-t-emerald-500' : isBear ? 'border-t-red-500' : 'border-t-amber-500'}`}>
              <CardHeader className="py-2.5 border-b border-border/50 bg-muted/10">
                <CardTitle className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                  🎯 Арилжааны шийдвэр
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">

                {/* Match vote bar */}
                <div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>History ({total})</span>
                    <span className={bearCount > bullCount ? 'text-red-400' : 'text-emerald-400'}>
                      {bearCount > bullCount ? `▼ ${bearCount}/${total} BEAR` : `▲ ${bullCount}/${total} BULL`}
                    </span>
                  </div>
                  <div className="flex gap-0.5 h-2 rounded overflow-hidden">
                    {ms.map((m: any, i: number) => (
                      <div key={i} title={`${m.date}: ${m.mlOutcome}`} className={`flex-1 ${
                        m.mlOutcome === 'BULLISH' ? 'bg-emerald-500' :
                        m.mlOutcome === 'BEARISH' ? 'bg-red-500' : 'bg-muted'
                      }`} />
                    ))}
                  </div>
                </div>

                {/* W1 тооцоолол */}
                {w1Pips > 0 && (
                  <div className="rounded bg-muted/30 border border-border/40 px-2 py-1.5 text-[10px]">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-muted-foreground font-semibold tracking-wide uppercase">
                        W1 Хэмжээ
                      </span>
                      <span className={`font-mono font-bold text-[11px] ${isBear ? 'text-red-400' : 'text-emerald-400'}`}>
                        {w1Pips.toFixed(2)} pips
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground/70">W1 %</span>
                        <span className="font-mono text-foreground">{w1Pct.toFixed(1)}% of Asia Range</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground/70">W1 үнэ</span>
                        <span className="font-mono text-foreground">${w1Price.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground/70">Asia Range</span>
                        <span className="font-mono text-foreground">{asiaRange.toFixed(2)} pts</span>
                      </div>
                      {/* W1 visual bar */}
                      <div className="mt-1 h-1.5 bg-muted rounded overflow-hidden">
                        <div
                          className={`h-full rounded ${isBear ? 'bg-red-500/70' : 'bg-emerald-500/70'}`}
                          style={{ width: `${Math.min(w1Pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Signal factors */}
                <div className="grid grid-cols-2 gap-1 text-[9px]">
                  <div className={`rounded px-1.5 py-0.5 flex items-center gap-1 ${
                    mlVerdict === 'BULLISH' ? 'bg-emerald-950/50 text-emerald-400' :
                    mlVerdict === 'BEARISH' ? 'bg-red-950/50 text-red-400' : 'bg-muted text-muted-foreground'
                  }`}>
                    <span>🤖</span><span className="font-semibold">{mlVerdict ?? '—'}</span>
                  </div>
                  <div className={`rounded px-1.5 py-0.5 flex items-center gap-1 ${
                    (seasonal?.bearPct ?? 0) >= 55 ? 'bg-red-950/50 text-red-400' :
                    (seasonal?.bullPct ?? 0) >= 55 ? 'bg-emerald-950/50 text-emerald-400' : 'bg-muted text-muted-foreground'
                  }`}>
                    <span>📅</span>
                    <span className="font-semibold">
                      {(seasonal?.bearPct ?? 0) >= 55 ? `BEAR ${seasonal.bearPct}%` :
                       (seasonal?.bullPct ?? 0) >= 55 ? `BULL ${seasonal.bullPct}%` : 'NEUTRAL'}
                    </span>
                  </div>
                  {hpa?.patternMatch?.matched && (
                    <div className={`col-span-2 rounded px-1.5 py-0.5 flex items-center gap-1 ${
                      hpa.patternMatch.dominant === 'BULLISH' ? 'bg-emerald-950/50 text-emerald-400' : 'bg-red-950/50 text-red-400'
                    }`}>
                      <span>🔥</span>
                      <span className="font-semibold">
                        HIGH PROB {hpa.patternMatch.dominant === 'BEARISH' ? hpa.patternMatch.bearPct : hpa.patternMatch.bullPct}%
                      </span>
                      <span className="ml-auto text-muted-foreground/70">({hpa.patternMatch.count}sess)</span>
                    </div>
                  )}
                </div>

                {/* Final signal box */}
                <div className={`rounded-lg border p-3 ${
                  isBull ? 'border-emerald-500/60 bg-emerald-950/40' :
                  isBear ? 'border-red-500/60 bg-red-950/40' :
                           'border-amber-500/50 bg-amber-950/20'
                }`}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className={`text-lg font-black ${isBull ? 'text-emerald-400' : isBear ? 'text-red-400' : 'text-amber-400'}`}>
                      {signalLabel}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                      isBull ? 'bg-emerald-900 text-emerald-300' :
                      isBear ? 'bg-red-900 text-red-300' : 'bg-muted text-muted-foreground'
                    }`}>{entryType}</span>
                  </div>
                  {entryPrice > 0 && (
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Орох үнэ</span>
                        <span className={`font-mono font-bold text-sm ${isBull ? 'text-emerald-300' : 'text-red-300'}`}>
                          ${entryPrice.toFixed(2)}
                        </span>
                      </div>
                      <div className="border-t border-border/30 pt-1.5 flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Target 1
                          {w1Pips > 0 && (
                            <span className="text-muted-foreground/50 ml-1 text-[9px]">
                              (W1 {w1Pct.toFixed(1)}% = {w1Pips.toFixed(1)} pip)
                            </span>
                          )}
                        </span>
                        <span className="font-mono font-bold text-sm text-amber-400">
                          ${t1Price.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground/70">
                        <span>Зай</span>
                        <span className="font-mono">{Math.abs(t1Price - entryPrice).toFixed(2)} pts</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Vote tally */}
                <div className="flex justify-center gap-3 text-[9px] text-muted-foreground pt-0.5">
                  <span>🟢 {bullVotes}</span><span className="text-border">|</span><span>🔴 {bearVotes}</span>
                  <span className="text-border">|</span>
                  <span className={isBull ? 'text-emerald-400 font-bold' : isBear ? 'text-red-400 font-bold' : 'text-amber-400 font-bold'}>
                    {isBull ? 'BULL WIN' : isBear ? 'BEAR WIN' : 'TIE'}
                  </span>
                </div>

              </CardContent>
            </Card>
          );
        })()}

        {/* ── Last Telegram Message Panel ── */}
        {tgStatus?.lastMessageText && (() => {
          const raw = tgStatus.lastMessageText;
          // HTML → JSX: parse <b>, <i>, <pre>, <code> tags into styled spans
          const renderTgHtml = (html: string) => {
            // Split into segments preserving tags
            const parts: React.ReactNode[] = [];
            let remaining = html;
            let key = 0;
            const tagRe = /(<b>.*?<\/b>|<i>.*?<\/i>|<pre>[\s\S]*?<\/pre>|<code>.*?<\/code>)/;
            while (remaining.length > 0) {
              const match = remaining.match(tagRe);
              if (!match || match.index === undefined) {
                // plain text — newlines → <br>
                remaining.split("\n").forEach((line, li) => {
                  if (li > 0) parts.push(<br key={key++} />);
                  if (line) parts.push(<span key={key++}>{line}</span>);
                });
                break;
              }
              // text before tag
              const before = remaining.slice(0, match.index);
              before.split("\n").forEach((line, li) => {
                if (li > 0) parts.push(<br key={key++} />);
                if (line) parts.push(<span key={key++}>{line}</span>);
              });
              // the tag itself
              const tag = match[0];
              if (tag.startsWith("<b>")) {
                parts.push(<strong key={key++} className="font-bold text-foreground">{tag.slice(3, -4)}</strong>);
              } else if (tag.startsWith("<i>")) {
                parts.push(<em key={key++} className="italic text-muted-foreground">{tag.slice(3, -4)}</em>);
              } else if (tag.startsWith("<pre>")) {
                const inner = tag.slice(5, -6);
                parts.push(
                  <pre key={key++} className="font-mono text-[9px] bg-muted/40 rounded p-1.5 mt-1 mb-1 overflow-x-auto whitespace-pre leading-tight">
                    {inner}
                  </pre>
                );
              } else if (tag.startsWith("<code>")) {
                parts.push(<code key={key++} className="font-mono bg-muted/40 px-0.5 rounded text-[9px]">{tag.slice(6, -7)}</code>);
              }
              remaining = remaining.slice(match.index + tag.length);
            }
            return parts;
          };

          const ago = tgStatus.lastNotifiedAgo ?? "—";

          return (
            <Card className="border-t-4 border-t-blue-500/70">
              <CardHeader className="py-2 border-b border-border/50 bg-muted/10">
                <CardTitle className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
                  <span>✈️ Сүүлийн Telegram мессеж</span>
                  <span className="ml-auto text-[9px] font-normal text-muted-foreground/60">{ago}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="text-[10px] leading-relaxed max-h-96 overflow-y-auto pr-1 space-y-0.5 text-foreground/90">
                  {renderTgHtml(raw)}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        </div>{/* end right column */}
      </div>
    </div>
  );
}
