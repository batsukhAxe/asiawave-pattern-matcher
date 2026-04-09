---
name: trading-analysis
description: XAUUSD арилжааны шинжилгээ хийх, график дүн шинжилгээ, техникийн indicator нэмэх, ICT концепц, session analysis, candlestick зураглал. AsiaWave Pattern Matcher төсөлд шинэ шинжилгээний хэсэг нэмэхэд уншина уу.
---

# Trading Analysis — График шинжилгээ гарын авлага

## Хэрэглэх үед
- Dashboard-д шинэ technical indicator нэмэх
- ICT / Smart Money шинжилгээ оруулах
- Session (Asia/London/NY) дүн шинжилгээ харуулах
- Support/Resistance, Supply/Demand zone зурах
- Candlestick pattern тодорхойлох
- Backtesting үр дүн дүрслэх

---

## 1. Арилжааны Session Цагийн Хүснэгт (UTC)

| Session | Эхлэх | Дуусах | XAUUSD идэвхтэй байдал |
|---|---|---|---|
| **Asia**   | 21:00 | 07:55 (маргааш) | Range тогтоох, low volatility |
| **London** | 07:00 | 16:00 | Breakout, sweeps, high volume |
| **NY**     | 13:00 | 22:00 | Trending, reversals, ICT setups |
| **Overlap**| 13:00 | 16:00 | Хамгийн өндөр volatile |

**AsiaWave нийцэл**: Asia session H/L нь бусад session-уудын татах цэг болдог.

---

## 2. ICT (Inner Circle Trader) Концепцууд

### Liquidity Sweep
```
Asia High/Low-г давж → Stop loss авч → Буцаж орох
Pattern: Asia High дээр зогсоол байна → London sweep хийнэ → SELL
```

### Fair Value Gap (FVG)
```
3 свеч дараалалд: [candle1.high < candle3.low] = Bullish FVG
                  [candle1.low > candle3.high] = Bearish FVG
Мэдэгдэл: Gap рүү буцаж орох = High Prob Entry
```

### Order Block
```
Bullish OB: Сүүлчийн bearish свеч price UP шилжихийн өмнө
Bearish OB: Сүүлчийн bullish свеч price DOWN шилжихийн өмнө
OB range: [OB.low, OB.high] → support/resistance zone
```

### Break of Structure (BOS) / Change of Character (CHoCH)
```
BOS:   Trend continuation — шинэ HH (higher high) эсвэл LL
CHoCH: Trend reversal    — HH дараа LL (эсвэл LL дараа HH)
```

---

## 3. Техникийн Indicator-уудын Тооцоо

### EMA (Exponential Moving Average)
```typescript
function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}
// Хэрэглэлт: EMA20, EMA50, EMA200 — trend filter
```

### RSI (Relative Strength Index)
```typescript
function rsi(closes: number[], period = 14): number[] {
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  // Wilder smoothing
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;
  const result: number[] = [];
  for (let i = period; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  }
  return result;
}
// XAUUSD: RSI < 30 = oversold (BUY zone), RSI > 70 = overbought (SELL zone)
```

### ATR (Average True Range) — Volatility
```typescript
function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const trs = highs.map((h, i) => {
    if (i === 0) return h - lows[i];
    return Math.max(h - lows[i], Math.abs(h - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
  });
  // Wilder smoothing
  let avg = trs.slice(0, period).reduce((a, b) => a + b) / period;
  const result: number[] = [avg];
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
    result.push(avg);
  }
  return result;
}
// ATR × 1.5 = realistic stop loss
// XAUUSD нормал ATR: $8–25/bar (H1), $2–8/bar (M5)
```

### VWAP (Volume Weighted Average Price)
```typescript
// Session дотор тооцно (Asia session эхлэхэд reset)
function vwap(candles: {high:number,low:number,close:number,volume:number}[]): number[] {
  let cumTPV = 0, cumVol = 0;
  return candles.map(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * (c.volume || 1);
    cumVol += (c.volume || 1);
    return cumTPV / cumVol;
  });
}
```

---

## 4. Recharts Dashboard-д Indicator Нэмэх Загвар

### dashboard.tsx-д нэмэх хэлбэр
```tsx
// 1. chartData useMemo дотор indicator тооцоолно
const chartData = useMemo(() => {
  // ... existing code ...
  
  // EMA тооцоо
  const closes = baseCandles.map(c => c.close);
  const ema20vals = ema(closes, 20);
  
  baseCandles.forEach((c, i) => {
    const entry = map.get(c.time)!;
    entry.ema20 = ema20vals[i];
  });
  
  return Array.from(map.values()).sort(...).map((d, i) => ({...d, idx: i}));
}, [...]);

// 2. ComposedChart дотор Line нэмнэ
<Line
  dataKey="ema20"
  stroke="#3b82f6"
  strokeWidth={1.5}
  dot={false}
  isAnimationActive={false}
  connectNulls
  name="EMA20"
/>
```

### Session Box (ReferenceArea) зурах
```tsx
// sessionAreas useMemo дотор
{sessionAreas.map((area) => (
  <ReferenceArea
    key={area.key}
    x1={area.x1}  // idx утга
    x2={area.x2}  // idx утга
    fill={area.color}
    fillOpacity={area.opacity ?? 0.08}
    label={{ value: area.label, position: "insideTopLeft", fontSize: 10 }}
  />
))}
```

### Horizontal Reference Line (AsiaH/L, FVG, OB)
```tsx
<ReferenceLine
  y={todaySession?.asiaHigh}
  stroke="#10b981"
  strokeDasharray="4 3"
  strokeWidth={1}
  label={{ value: "Asia H", position: "right", fontSize: 10, fill: "#10b981" }}
/>
```

### Sub-chart (RSI panel)
```tsx
// Тусдаа chart container дотор
<ComposedChart data={visibleChartData} height={80}>
  <YAxis domain={[0, 100]} hide />
  <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="2 2" />
  <ReferenceLine y={30} stroke="#10b981" strokeDasharray="2 2" />
  <Line dataKey="rsi14" stroke="#a78bfa" strokeWidth={1} dot={false} />
</ComposedChart>
```

---

## 5. Support / Resistance Zone тодорхойлох

### Swing High/Low (existing SWING_LOOKBACK ашиглана)
```typescript
// pattern-matcher.ts дотор байгаа функц
function findSwings(candles, lookback): {highs: number[], lows: number[]} {
  // H[i] = swing high бол H[i] = max(H[i-lb..i+lb])
  // L[i] = swing low  бол L[i] = min(L[i-lb..i+lb])
}
```

### Key Levels (давтагдах swing-уудаас)
```typescript
// Price cluster: ойрхон swing-уудыг нэг level болгох
const CLUSTER_DIST = asiaRange * 0.3;  // Asia range-ийн 30%
// Сүүлийн 10 session-ийн swing high/low → cluster → key levels
```

---

## 6. Candlestick Pattern Илрүүлэлт

### Hammer / Shooting Star
```typescript
function isHammer(c: {open:number,high:number,low:number,close:number}): boolean {
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  return lowerWick > body * 2 && upperWick < body * 0.5;
}
```

### Engulfing
```typescript
function isBullEngulfing(prev: Candle, cur: Candle): boolean {
  return prev.close < prev.open &&           // bearish свеч
         cur.close > cur.open &&             // bullish свеч
         cur.open <= prev.close &&           // gap down эсвэл overlap
         cur.close >= prev.open;             // бүрэн хамрана
}
```

### Дашборд-д candlestick pattern marker нэмэх
```tsx
// chartData дотор
entry.patternType = isHammer(c) ? "hammer" :
                    isBullEngulfing(prev, c) ? "engulf_bull" : undefined;

// CustomDot эсвэл ScatterChart-аар харуулна
<Scatter
  data={visibleChartData.filter(d => d.patternType)}
  dataKey="patternPrice"
>
  <LabelList dataKey="patternType" position="top" fontSize={8} />
</Scatter>
```

---

## 7. Backtesting Хурдан Тооцоо

### Win Rate тооцоо (бэкэнд дотор)
```typescript
function backtest(signals: Signal[], sessions: SessionAnalysis[]): BacktestResult {
  let wins = 0, losses = 0, totalRR = 0;
  for (const sig of signals) {
    const session = sessions.find(s => s.date === sig.date);
    if (!session) continue;
    const reachedTP = /* price session дотор T1 хүрсэн эсэх */;
    const hitStop   = /* price stop хүрсэн эсэх */;
    if (reachedTP) { wins++; totalRR += sig.rr; }
    else if (hitStop) losses++;
  }
  return {
    winRate: wins / (wins + losses) * 100,
    avgRR: totalRR / wins,
    profitFactor: (wins * totalRR) / losses,
  };
}
```

---

## 8. Dashboard Visualization Зөвлөмж

| Шинжилгээ | Санал болгох харагдал | Өнгө |
|---|---|---|
| Asia High/Low | ReferenceLine дашдотиор | #10b981 / #ef4444 |
| EMA20/50 | Line connectNulls | #3b82f6 / #f59e0b |
| FVG zone | ReferenceArea fillOpacity=0.12 | #6366f1 / #ec4899 |
| Order Block | ReferenceArea fillOpacity=0.15 | #f97316 |
| RSI | Тусдаа 80px panel | #a78bfa |
| Projection | Line strokeDasharray="4 2" | #f59e0b |
| Swing H/L marker | ReferenceLine y= | #64748b |

### Responsive chart sizing
```tsx
// Main chart (svhеч)
<ResponsiveContainer width="100%" height={400}>

// RSI sub-panel
<ResponsiveContainer width="100%" height={80}>
```

---

## 9. XAUUSD-д Хамааралтай Тоон Хэмжигдэхүүн

| Параметр | Ердийн утга | Тайлбар |
|---|---|---|
| Asia Range | 8–30 pip ($) | $10–25 ерөнхий |
| Daily Range | 20–80 pip | ATR(14) H1 ≈ $15–40 |
| Spread | 0.2–0.5 pip | Raw spread |
| Pip value | $0.01/oz | Gold 1 pip = $0.01 |
| Lot $100K | $1/pip | Standard lot |

### Risk/Reward тооцоо
```
RR = |T1_price - entry| / |stop - entry|
Minimum recommended RR: 1:1.5
Optimal: 1:2.0+
```

---

## 10. Шинэ Шинжилгээ Нэмэх Алхам (AsiaWave төсөлд)

1. **Бэкэнд** (`pattern-matcher.ts`):
   - `SessionAnalysis` interface-д шинэ талбар нэм
   - `/matches` response-д шинэ дата нэм

2. **Фронтэнд** (`dashboard.tsx`):
   - `chartData` useMemo дотор тооцоо нэм
   - `ComposedChart` дотор шинэ `<Line>`, `<Area>`, `<ReferenceArea>` нэм
   - YAxis `domain` тохируулах

3. **Skill шинэчлэх**:
   - `asiawave-pattern-matcher` SKILL.md-д шинэ талбар бүртгэх
