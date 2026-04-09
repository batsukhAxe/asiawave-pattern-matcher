---
name: asiawave-pattern-matcher
description: AsiaWave Pattern Matcher trading dashboard бүтэц, логик, файлуудыг бүрэн тодорхойлно. XAUUSD M5/H1 дата, Asia session H/L, wave pattern match, BUY/SELL signal, Telegram notification, ML prediction тооцоо бүгдийг хамарна. Энэ төслийн ямар ч өөрчлөлт хийхэд уншина уу. Шинэ шинжилгээний хэсэг нэмэхэд trading-analysis skill-г уншина уу.
---

# AsiaWave Pattern Matcher — Бүрэн гарын авлага

## Хэрэглэгчийн тохиргоо
- **Хэл**: Монгол хэлээр хариулна
- **Нууц үг**: `DASHBOARD_PASSWORD=687549Replit` (PasswordGate component)
- **Telegram bot**: `@signalaxe_bot`, `TELEGRAM_CHAT_ID=-1003798239030`
- **API key**: `TWELVE_DATA_API_KEY` (800 req/day free tier)

---

## Файлын бүтэц

```
artifacts/
  api-server/
    src/routes/pattern-matcher.ts   ← Бүх логик (2000+ мөр)
    data/GOLDM5.csv                 ← M5 XAUUSD түүхэн дата
    data/AsiaWave_ML.json           ← 400 мөр ML prediction дата
  pattern-matcher/
    src/pages/dashboard.tsx         ← Үндсэн UI + Telegram auto-send
    src/components/PasswordGate.tsx ← Нэвтрэх нууц үг
```

---

## Asia Session тодорхойлолт

| Параметр | Утга |
|---|---|
| Эхлэх цаг | GMT 21:00 (өмнөх өдөр) |
| Дуусах цаг | GMT 07:55 (ойролцоогоор) |
| Өдрийн шошго | END-date буюу дуусах өдрийн нэр |

**Чухал**: UTC 21:00-оос эхэлсэн session нь маргаашийн огноогоор шошгологддог.
`getDayKey()` функц: `hour >= 21` бол `date + 1 calendar day`.

**Жишээ**: Даваа 2026-03-30-ний session = 2026-03-29 21:00 UTC → 2026-03-30 08:00 UTC

---

## Wave Analysis

### Peak Waves (asiaLow-аас тооцно)
Asia Low-с эхлэн дээш/доош хэлбэлзлийн swing % тооцно.

### Bottom Waves (asiaHigh-аас тооцно)
Asia High-с эхлэн доош/дээш хэлбэлзлийн swing % тооцно.

### Swing Parameters
```typescript
SWING_LOOKBACK     = 2  // H1: 2-bar lookback (~2h)
SWING_LOOKBACK_M5  = 8  // M5: 8-bar lookback (~40min)
SWING_LOOKBACK_M15 = 3  // M15: 3-bar lookback (~45min)
```

### Fibonacci Quantization
Wave % утгуудыг хамгийн ойрхон Fibonacci түвшинд дугуйлна:
```
FIB_LEVELS = [0, 11, 12, 23, 38, 50, 61, 78, 88, 100]
```

---

## Pattern Matching Score

```typescript
// Final combined score (unchanged)
combined = waveScore×0.60 + rangeScore×0.20 + ratioScore×0.12 + seasonalScore×0.08

// waveScore = avg(peakScore, bottomScore) — computed by compareWaveSequences()
```

### Wave Similarity — 3 аргын нэгдэл (compareWaveSequences)

```typescript
// Хуучин: element-by-element хатуу alignment (|r-h|/avg × 100)
// ШИНЭ (2026-04): DTW + Pearson + Direction — 3 аргын нэгдэл

peakScore  = DTW×0.55 + Pearson×0.30 + Direction×0.15
bottomScore = DTW×0.55 + Pearson×0.30 + Direction×0.15

// Sub-scores response-д дагалдана:
// dtwPeak, pearsonPeak, dirPeak — peak wave sub-scores
// dtwBtm,  pearsonBtm,  dirBtm  — bottom wave sub-scores
```

**DTW (55%)** — Dynamic Time Warping: хурдны зөрүүтэй ч адилхан хэлбэрийн pattern-г таних. O(n²) ч max 8 wave тул хурдан.

**Pearson (30%)** — Correlation score: магнитуд ялгааг үл хамааран хэлбэрийн ижил төстэйг тоолно. [38,23,61] vs [40,25,65] → Pearson≈100%.

**Direction (15%)** — Acceleration fingerprint: wave бүр өсч байна уу буурч байна уу. Declining vs Expanding pattern.

**Match window**: 365 хоног (configurable)
**Top 5 matches**: score-оор эрэмбэлж top 5-ийг харуулна

---

## BUY / SELL Direction Logic — Тэргүүлэх дараалал

```
1. HIGH PROB pattern илэрсэн → dominant (BULL/BEAR) давамгайлна  ← хамгийн хүчтэй
2. History match direction (anchorPt → W1 чиглэл)               ← дунд
3. Fallback: bottomScore > peakScore → BUY                       ← сул
```

**Жишээ зөрчил**: HIGH PROB → STRONG BUY, history match → SELL
→ **BUY** өгнө (HIGH PROB давамгайлна), мессеж дотор `dir: HIGH PROB` харагдана.

**Эх сурвалж**: `projectionPoints`-ийн anchor → W1 чиглэл (historical match-ийн бодит явц)

```typescript
// projectionPoints дээр үндэслэсэн direction тооцоо
const pts      = bestMatch.projectionPoints.filter(p => p.price > 0);
const anchorPt = pts.find(p => !p.label || p.label === ""); // эхлэлийн үнэ
const w1Pt     = pts.find(p => p.label && p.label !== "");  // W1 (эхний swing)

// W1 > anchor → historical match ДЭЭШ явсан → BUY
// W1 < anchor → historical match ДООШ явсан → SELL
histDir = w1Pt.price > anchorPt.price ? "UP" : "DOWN";
isBull  = histDir === "UP";

// projectionPoints байхгүй үед fallback:
isBull = (bestMatch.bottomScore ?? 0) > (bestMatch.peakScore ?? 0);
```

**Жишээ**:
- anchor=$4,596.52, W1=$4,561.64 (label="W1 -26%") → DOWN → **SELL**
  - (bottomScore=84.8 > peakScore=75.3 хэдий ч SELL өгнө — historical match ДООШ явсан)
- anchor=$4,419.71, W1=$4,465.87 (label="W1 +47%") → UP → **BUY**

---

## Trade Setup тооцоо — Wave бүтцээс (CRITICAL)

**Entry нь wave label-ийн дагуу, order type тодорхой харагдана.**

```typescript
// ── BUY entry ─────────────────────────────────────────────────────────────
// Эхний "-" wave = уналтын level → "⏳ LIMIT BUY" (унтал хүлээ, тэнд орно)
// "-" wave байхгүй → anchor = "⚡ MARKET BUY" (одоо орно)
const dipIdx = realPts.findIndex(p => p.label.includes("-"));
entry = dipIdx >= 0 ? realPts[dipIdx].price : anchorPt.price;
orderType = dipIdx >= 0 ? "⏳ LIMIT BUY" : "⚡ MARKET BUY";

// ── SELL entry ─────────────────────────────────────────────────────────────
// anchor > asiaHigh → ICT sweep → "⚡ MARKET SELL" (одоо орно)
// sweep байхгүй → эхний "+" wave = bounce → "⏳ LIMIT SELL" (bounce хүлээ)
sweepAbove = anchor.price - today.asiaHigh;
if (sweepAbove > 0) { entry = anchor.price; orderType = "⚡ MARKET SELL"; }
else { bounceIdx = realPts.findIndex("+"); entry = realPts[bounceIdx] || anchor; }

// ── Stop ───────────────────────────────────────────────────────────────────
stopBuf = isBull ? asiaRange*0.08 : max(sweepAbove, asiaRange*0.08)
stop = entry ∓ stopBuf

// ── Wave Map дотор entry тэмдэглэх ────────────────────────────────────────
// entryWaveIdx-ийн өмнөх waves: "→ entry level" (energy leads to entry)
// entryWaveIdx-ийн wave:        "← ENTRY BUY/SELL"
// entryWaveIdx-ийн дараах waves:
//   BUY:  "+" = T1/T2/T3 (TP),  "-" = Add
//   SELL: "-" = T1/T2/T3 (TP),  "+" = Add
risk = |entry - stop|
rr   = |Wn.price - entry| / risk
```

**buildWaveProjection()** (2026-04 шинэ, production):
```typescript
buildWaveProjection(
  activeHistWaves: WavePoint[],  // match-ийн bottomWaves эсвэл peakWaves
  matchCount: number,            // compareBottom | comparePeak
  currentPrice: number,          // сүүлийн M5 bar-ийн close
  lastTime: number,              // сүүлийн M5 bar-ийн timestamp (Unix)
  todayAsiaRange: number,        // overlayTodaySession.asiaRange
): WavePoint[]
```
- W1–W6: matching-д ашигласан waves → **алгасна** (проекцлогдохгүй)
- W7–W8: matched эгнээний дараах 2 wave → today range-д масштаблан проекцлоно
- `skipWeekend()` хэрэглэн Weekend-г алгасна (Gold closes Sat, reopens Sun 22:00 UTC)
- currentPrice-аас M5 interval-р W7 target хүртэл interpolation хийнэ
- anchor цэг (label="") + дунд interpolated points + labeled terminal W7/W8 цэгүүд

**8-Wave System** (2026-04 COMPLETED):
- `findWavesFromBar()`: max 8 waves (`Math.min(8, ...)`)
- `minWaves = 6`: matching-д 6 wave хэрэгтэй
- W1–W6 → **matching** (compareBottom / comparePeak)
- W7–W8 → **projection** (buildWaveProjection хэрэглэж проекцлоно)
- matchResults map дахь `projUseBottom` = `todayBottomOK ? bottomWaves : peakWaves`

**Жишээ мессеж (BUY, HIGH PROB override):**
```
⏳ LIMIT BUY
Entry  $4,557.98   ← W1 -47% уналт — LIMIT BUY
Stop   $4,547.27   ← Risk $10.71
━━━━━━━━━━━━━━━━━━━━━━━━━
W1 -47%   $4,557.98    ← ENTRY BUY
W2 +40%   $4,611.35    ← T1  RR 1:5.0
W3 -50%   $4,544.33    ← Add
```

**Жишээ мессеж (SELL, ICT sweep):**
```
⚡ MARKET SELL
Entry  $4,648.42   ← ↑ ICT sweep +$27.68 — MARKET SELL
Stop   $4,676.10   ← Risk $27.68
━━━━━━━━━━━━━━━━━━━━━━━━━
W1 -41%   $4,592.94    ← T1  RR 1:2.0
W2 +53%   $4,664.21    ← Add
```

### projectionPoints бүтэц
```typescript
interface WavePoint {
  time:        number   // Unix timestamp (секунд)
  price:       number   // Today-ийн масштабт проекцлогдсон үнэ
  wavePercent: number   // Swing % (±)
  label:       string   // "W1 +47%", "W2 -32%", ... (anchor = "")
}
```

**Чухал**: `projectionPoints`-ийн үнэ нь historical match-ийн хөдөлгөөнийг өнөөдрийн Asia range-д масштаблан проекцлосон байна. Тээлж T1/T2 тооцоолоход шууд ашиглаж болно.

---

## ML Prediction System

**Файл**: `artifacts/api-server/data/AsiaWave_ML.json` (400 мөр)

### 6 давхарга
1. **rangeClass**: SMALL / MEDIUM / LARGE / XLARGE (Asia range pip)
2. **directionBias**: `bullPct`, `bearPct`, `n` (range class дотрох чиглэл %)
3. **patternLookup**: Fibonacci pattern тааруулах (bfibKey/pfibKey)
4. **extensionTargets**: `avgUpExt%`, `avgDownExt%` → `targetUpPrice`, `targetDownPrice`
5. **waveCharacter**: `bottomRatio12`, `bottomDeclining`
6. **combinedScore**: `bullScore = dirBull×0.5 + patBull×0.3 + declBonus×0.2`

### Target үнэ тооцоо (ML)
```typescript
targetUpPrice   = asiaHigh + (avgUpExt% × asiaRange)
targetDownPrice = asiaLow  - (avgDownExt% × asiaRange)
```

### API response дотор
```
mlPrediction.enabled        // true бол хэрэглэнэ
mlPrediction.patternLookup  // pattern match үр дүн
mlPrediction.combined       // {verdict, confidence, bullScore, bearScore}
mlPrediction.rangeClass     // "SMALL" | "MEDIUM" | "LARGE" | "XLARGE"
mlPrediction.rangePips      // Asia range pip утга
```

---

## HIGH PROBABILITY Patterns

**Эх сурвалж**: `GOLD_AsiaWave_ML_v2.xlsx` — `⭐ High-Prob Patterns` sheet
- Edge ≥ 20%, Count ≥ 3 байдаг 39 pattern (23 PEAK + 16 BOTTOM)

### Match scoring
```
Exact match (diff=0)      → 1.0 pt
Adjacent fib (diff ≤ 15)  → 0.5 pt
matchPct = (pts / n) × 100
weighted = matchPct × (mlScore / 80)
DETECTED if matchPct ≥ 75%
```

### checkHighProbPattern() return
```typescript
{
  matched, signal, dominant, bullPct, bearPct, edge,
  count, mlScore, quantizedWaves, patternLabel
}
```

---

## Telegram Notification

### Хэзээ явуулах
**Зөвхөн**: Best match-ийн `date` өөрчлөгдсөн үед л явуулна.
Score jump, HIGH_PROB нөхцөлүүд **устгагдсан** (хэтэрхий олон мэдэгдэл).

### Poll interval
`pollBestMatch()` — сервер эхлэснээс 30 секундын дараа, дараа нь 5 минут тутамд.

### Мессежийн формат
```
🌊 AsiaWave Signal · {date} UTC

[HIGH PROB байвал:]
⚡ HIGH PROB PATTERN · {type} {pattern}
   🟢/🔴 {signal}  │  Bull X%  Bear X%  Edge X%  n=N
   🎯 ML target UP: ${up}  │  DOWN: ${down}

🟢/🔴 BUY/SELL  ·  GOLD ${price} (+X%)
Match: {date}  score X%  (wave X%)

━━━━━━━━━━━━━━━━━━━━━━━━━
Entry  ${entry}     ← Asia Low/High breakout
Stop   ${stop}      (±buffer · 15% range)
━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Wave Map  ·  match {date}
W1 +50%   ${price}    ← T1  RR 1:X     (TP — BUY:+ swing, SELL:- swing)
W2 -41%   ${price}    ← Add            (Re-entry)
W3 +53%   ${price}    ← T2  RR 1:X
W4 -25%   ${price}    ← Add
W5 +36%   ${price}    ← T3  RR 1:X
━━━━━━━━━━━━━━━━━━━━━━━━━
🌏 Asia {date}  H ${asiaH} · L ${asiaL}
```

**Wave Map дүрэм:**
- BUY: `+` swing = T1/T2/T3 (TP), `-` swing = Add (re-entry)
- SELL: `-` swing = T1/T2/T3 (TP), `+` swing = Add (re-entry)

### Frontend auto-screenshot
`dashboard.tsx` дотор `useEffect` → `bestMatch.date` өөрчлөгдөхөд:
1. Chart-ийн screenshot авна (html2canvas)
2. `POST /api/pattern-matcher/notify-telegram` → `{imageBase64, trigger}`
3. Dashboard нээлттэй байхад зураг + мессеж хамт явна

### Server-side fallback
Dashboard нээлттэй биш үед poll → зураггүй мессеж явна.

---

## API Endpoints

| Endpoint | Тайлбар |
|---|---|
| `GET /api/pattern-matcher/matches` | Main data: matches, today, livePrice, mlPrediction |
| `GET /api/pattern-matcher/live-price` | Real-time XAU/USD price |
| `GET /api/pattern-matcher/live-h1?outputsize=N` | Twelve Data H1 bars (5min cache) |
| `POST /api/pattern-matcher/notify-telegram` | Telegram явуулах (body: {trigger, imageBase64?, forceNotify?}) |
| `POST /api/pattern-matcher/refresh-csv` | GOLDM5.csv шинэчлэх |

### /matches response бүтэц
```typescript
{
  matches: PatternMatch[]   // top 2 best matches
  today: SessionAnalysis    // өнөөдрийн session H/L/waves
  livePrice: LivePriceCache // Gold үнэ
  mlPrediction: {...}       // ML 6-layer result
  qBottomWaves: number[]    // Fibonacci-quantized bottom waves
  qPeakWaves: number[]      // Fibonacci-quantized peak waves
}
```

---

## Дата файлууд

### GOLDM5.csv
```
datetime,open,high,low,close,volume
2020-01-01 21:05:00,1520.10,1520.80,1519.50,1520.30,234
...
```
- M5 timeframe, UTC цаг
- API-аас шинэ bar нэмэхэд `m5Cache` + `dataCache` invalidate болно

### AsiaWave_ML.json
```json
[
  {
    "date": "2024-01-15",
    "asiaRange": 15.4,
    "asiaHigh": 2050.3,
    "asiaLow": 2034.9,
    "bfibKey": "23-38-23-23",
    "pfibKey": "38-23-23-23",
    "rangeClass": "MEDIUM",
    "bullPct": 62.5,
    "bearPct": 37.5,
    "avgUpExt": 45.2,
    "avgDownExt": 38.7,
    ...
  }
]
```

---

## TelegramState (сервер дотор хадгалагдана)
```typescript
{
  lastBestMatchDate: string | null   // Сүүлчийн мэдэгдэл явуулсан match огноо
  lastBestScore: number              // Тэр үеийн score
  lastHighProbKey: string | null     // (Ашиглагдахгүй болсон)
  lastNotifiedAt: number             // Unix ms
}
```

---

## Ерөнхий дүрмүүд

1. **Asia session** = GMT 21:00 → 08:00, END-date шошго
2. **BUY** = bottomScore > peakScore (Low эхлэж тогтоосон)
3. **SELL** = peakScore > bottomScore (High эхлэж тогтоосон)
4. **T1/T2** = projectionPoints-аас (match-ийн бодит явц), ML target биш
5. **Stop** = Asia range × 15%
6. **Telegram** = match DATE өөрчлөгдсөн үед л явна
7. **Мессеж** = зөвхөн Entry/Stop/T1/T2, бусад блок байхгүй
8. **Монгол хэлээр** хариулна
