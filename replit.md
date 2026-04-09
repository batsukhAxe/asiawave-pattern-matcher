# Workspace

## User Preferences
- **Language**: Always respond in **Mongolian (Монгол)**

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/pattern-matcher` (`@workspace/pattern-matcher`)

AsiaWave Pattern Matcher trading dashboard. Uses real XAUUSD M5 data from `artifacts/api-server/data/GOLDM5.csv`.

**Features:**
- H1 candlestick chart with 7 marketsess session color bands
- Asia (SydneyAsia) session High/Low dashed reference lines (green/red)
- Wave pattern analysis: peak waves (from Asia Low) and bottom waves (from Asia High)
- Historical pattern matching: compares today's wave % sequence against all historical days (60-day window)
- Best match aligned overlay (amber dashed line) on main chart
- Projection points (P1–P10, purple dotted) based on best match's continuation
- **Historical Matching Days mini-charts**: horizontal scrollable row of mini H1 candlestick cards for each matching day (click to set as active overlay)
- **Live gold price card** (KPI): price, Δchange, Δ%, daily H/L, OPEN/CLOSED badge — sourced from Twelve Data API (real-time), fallback to metalpriceapi.com (24h delayed)
- **Live H1 bars**: Twelve Data time_series fills the gap after GOLDM5.csv cutoff; amber-tinted candles on main chart; "Live (Twelve Data)" badge in legend
- **Header ticker**: XAU/USD live price + change% + source label

**Date convention (END-date, matches CSV):** session starting Sunday 21:00 UTC → Monday 08:00 UTC is labeled "Monday". `getDayKey()` adds 1 calendar day for candles at UTC hour ≥ 21.

**API backend:** `artifacts/api-server/src/routes/pattern-matcher.ts` — parses GOLDM5.csv, aggregates M5→H1, groups by trading day (21:00 UTC anchor), computes session boxes, wave analysis, pattern scoring.
- `GET /api/pattern-matcher/live-price` — real-time XAU/USD price, change, changePercent, high, low, isMarketOpen, source
- `GET /api/pattern-matcher/live-h1?outputsize=N` — recent H1 OHLCV bars from Twelve Data (5-min cache)

**Strategy Improvements (4 new features):**
- **A: Monthly Seasonal Bias** — `MONTHLY_BIAS` const (Jan-Dec) from 400-session ML stats. Apr=BEAR 60%, Sep=BULL 74%. Added to scoring (8% weight) and shown in dashboard badge + Telegram.
- **B: ML Max Extension Targets** — top-3 matched sessions' `max_up_ext_pct`/`max_down_ext_pct` averaged → T1/T2/T3 price levels. Panel shown in dashboard. Anchored at asiaHigh (UP) / asiaLow (DOWN).
- **C: Seasonal badge** — dashboard shows `📅 Apr сар: ХҮЧТЭЙ BEAR 60%` colored panel. Telegram line added.
- **D: Wave Ratio Scoring** — `calcRatioScore(today, hist)` compares bw_ratio_1_2 / bw_ratio_2_3. Weight 12%.
- **Score formula**: `wave×0.60 + range×0.20 + ratio×0.12 + seasonal×0.08` (was: wave×0.70 + range×0.30)
- **BOTTOM pattern direction**: No longer overrides `isBull`; shown as "next session forecast" with session completion context.
- Each match result now includes: `mlOutcome`, `mlFirstBreak`, `mlMaxUpExt`, `mlMaxDownExt`, `ratioScore`, `seasonalScore`.
- API response includes: `seasonalBias`, `mlExtensionTarget` (with T1/T2/T3 for both directions).

**HIGH PROBABILITY PATTERN System (ML-derived, upgraded 2026-04):**
- ХУУЧИН: 35-39 hardcoded Fibonacci-quantized patterns, exact/adjacent match
- ШИНЭ: 400 ML session бүгдийг DTW+Pearson+Direction ашиглан динамикаар хайна
- `checkHighProbPattern(waves, waveType)`: TOP_N=12 most-similar ML sessions → similarity-weighted BULL%/BEAR%
- HIGH PROB threshold: weighted directional bias >= 62% (among top-12 sessions)
- Similarity scoring: DTW×0.55 + Pearson×0.30 + Direction×0.15 (min_similarity=55%)
- Returns: signal, dominant, bullPct, bearPct, edge, count, matchScore, topMatchDates, insidePct
- UI: glowing border banner (green=BUY, red=SELL) with Bull%, Bear%, Edge%, Count, avgSim
- Telegram: `🔥🔥🔥 HIGH PROBABILITY PATTERN DETECTED!` block at top of notification
- Telegram notification includes `🤖 ML Prediction` block with verdict, range, pattern, targets

**ML Prediction System (`computeMLPrediction`):**
- Loads `AsiaWave_ML.json` (400 rows) at startup, pre-computes `bfibKey`/`pfibKey` for fast lookup
- 6-layer prediction: rangeClass, directionBias, patternLookup, extensionTargets, waveCharacter, combinedScore
- `patternLookup`: finds matching Fibonacci pattern rows → bull%, bear%, firstBreak%, close_vs_sess%, avgUpExt%, avgDownExt%
- `targetUpPrice` = asiaHigh + (avgUpExt% × asiaRange); `targetDownPrice` = asiaLow - (avgDownExt% × asiaRange)
- `combined`: bullScore = dirBull×0.5 + patBull×0.3 + declBonus×0.2; verdict = BULLISH/BEARISH/NEUTRAL
- Exposed in API `/matches` as `mlPrediction`, `qBottomWaves`, `qPeakWaves`
- UI: ML Prediction Card with bar chart, 3-column grid, extension targets, breakout stats
- Telegram: `🤖 ML Prediction (400 sessions)` block appended to every notification

**Secrets:** `TWELVE_DATA_API_KEY` (800 req/day free tier, real-time).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
