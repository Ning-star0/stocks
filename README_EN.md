# Stock AI Monitor

[中文](./README.md) | English

A stock monitoring and AI-assisted analysis system built with Next.js 15 App Router. Features watchlist management, price caching, technical indicators, alert rules, news aggregation, AI structured analysis, and a background job queue.

This project is for research and analysis purposes only. It does not include real trading or order execution.

Actual executions can be recorded for portfolio reconciliation and strategy review. The trading review tracks realized P&L, win rate, profit factor, payoff ratio, drawdown, and fee drag; weak realized performance reduces new-position risk without lowering entry-quality thresholds.

Buy plans are revalidated at the trigger price using round-trip fees, break-even movement, and net risk/reward. Plans are removed when fee drag exceeds 2% or net risk/reward falls below 1.25.

Portfolio risk is budgeted from current equity, open-position stops, market regime, and realized performance. Buy quantities are reduced in whole lots until fee-adjusted stop risk fits both per-trade and portfolio limits; missing stops, exhausted capacity, or an already-breached stop prevent additional risk.

The strategy lab runs no-lookahead daily backtests: signals are generated after the close and executed at the next session open. The first 65% of history selects a preset and the final 35% is reserved for out-of-sample validation. Cross-symbol validation and per-symbol health gates account for net return, drawdown, profit factor, round-trip fees, minimum fees, and board lots. Missing or expired gates are refreshed before strategy generation. Capital-matched gates remain active for 24 hours in the actual AI decision pipeline: paused symbols cannot create new buy orders and reduced-size symbols are capped at half budget.

The rolling gate audit uses 60-trading-day folds. Each fold can only use earlier data to control the next fold's position scale, then compares gated and ungated net performance.

The server can generate ChatGPT research packages containing OHLCV candles, indicators, relevant news, DeepSeek probability scenarios, positions, strategy performance, and historical backtests. Each package is archived as Markdown and JSON for manual upload to a dedicated ChatGPT thread without requiring a ChatGPT API key.

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard: watchlist, cached quotes, AI summaries, high-impact news, alerts |
| `/watchlist` | Watchlist management |
| `/focus` | Portfolio AI decisions, candidate ranking, conditional trade plans, and execution feedback |
| `/trades` | Trading review center with execution entry, portfolio snapshot, risk budget, P&L curve, and performance metrics |
| `/research` | ChatGPT research package selection, DeepSeek scenario preview, and server archive downloads |
| `/strategy-lab` | Out-of-sample validation, rolling gate audit, cross-symbol summary, and entry health gates for up to eight symbols |
| `/stocks/[symbol]` | Stock detail: charts, indicators, news, AI analysis |
| `/news` | Industry news and daily market briefs |
| `/alerts` | Price / RSI / volume alert rules |
| `/settings` | AI config: API endpoint, key, model name |
| `/memory` | Trading memory: record trading style & preferences for AI context |
| `/login` | Admin login |

## Tech Stack

- **Frontend**: Next.js 15 App Router, TypeScript, Tailwind CSS
- **UI**: shadcn/ui-style components
- **Charts**: Recharts
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL
- **ORM**: Prisma
- **AI**: OpenAI API-compatible client (DeepSeek by default)
- **Stock Data**: `StockDataProvider` interface, `MockStockDataProvider` by default
- **News Data**: `NewsProvider` interface, `MockNewsProvider` by default

## Low-Resource Server Design

Designed for single-instance VPS with 1-2 vCPUs and 1-2 GB RAM:

- No Redis required
- No Kafka / RabbitMQ / BullMQ required
- No Docker multi-container required
- PostgreSQL tables serve as a lightweight job queue
- Worker concurrency fixed at 1
- Dashboard reads cache & DB only — never triggers AI
- Stock detail page does not auto-trigger AI on first load
- All slow tasks processed asynchronously via `AnalysisJob`

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `STOCK_DATA_PROVIDER` | Stock data source | `mock` |
| `NEWS_PROVIDER` | News data source | `mock` |
| `OPENAI_API_KEY` | AI API key | - |
| `OPENAI_BASE_URL` | AI API base URL | `https://api.deepseek.com` |
| `OPENAI_MODEL` | AI model name | `deepseek-v4-pro` |
| `ADMIN_EMAIL` | Admin email | `admin@stocks.local` |
| `ADMIN_PASSWORD_HASH_B64` | Password hash (Base64url) | Required |
| `AUTH_SECRET` | Session encryption key | Required |
| `TAVILY_API_KEY` | Web search provider (optional) | - |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage data (optional) | - |
| `FINNHUB_API_KEY` | Finnhub news (optional) | - |
| `TIANAPI_KEY` | TianAPI financial news (optional) | - |

See `.env.example` for the full list. Without `OPENAI_API_KEY`, the system returns deterministic local fallback analysis for debugging.

## Authentication

Single-admin login. Passwords are never stored in plaintext — only scrypt hashes.

Generate a password hash:

```bash
npm run auth:hash -- "your-strong-password-at-least-16-chars"
```

The command outputs `ADMIN_PASSWORD_HASH_B64` and `AUTH_SECRET`. Add them to `.env`:

```env
ADMIN_EMAIL="admin@stocks.local"
ADMIN_PASSWORD_HASH=""
ADMIN_PASSWORD_HASH_B64="output-base64url-hash"
AUTH_SECRET="output-secret"
AUTH_SESSION_DAYS=7
```

> **Note**: Use `ADMIN_PASSWORD_HASH_B64`. The scrypt hash contains `$` characters — writing `ADMIN_PASSWORD_HASH="scrypt$..."` directly may cause shell expansion and login failures.

Open `/login` to sign in. Sessions use HttpOnly cookies, inaccessible to client-side JavaScript.

## Local Development

```bash
# Install dependencies
npm install

# Ensure PostgreSQL is running and DATABASE_URL in .env is correct

# Generate Prisma Client and create database tables
npx prisma generate
npx prisma migrate dev --name init

# Generate admin password hash
npm run auth:hash -- "your-password"

# Start dev server
npm run dev
```

Open http://localhost:3000

## Production Deployment

Build and start:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

# Copy static assets (required for standalone mode)
cp -r .next/static .next/standalone/.next/static
cp .env .next/standalone/.env

# Start web server
pm2 start npm --name "stocks" -- run start

# Start background worker
pm2 start npm --name "worker" -- run worker
pm2 save
```

## One-Click Update Script

```bash
#!/bin/bash
set -e
cd /opt/stocks

echo "=== Pulling code ===" && git pull origin main
echo "=== Installing dependencies ===" && npm install
echo "=== Cleaning old build ===" && rm -rf .next
echo "=== Generating Prisma ===" && npx prisma generate
echo "=== Running migrations ===" && npx prisma migrate deploy
echo "=== Building ===" && npm run build
echo "=== Copying static files ===" && cp -r .next/static .next/standalone/.next/static
echo "=== Restarting services ==="
pm2 delete stocks 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
cp .env .next/standalone/.env
pm2 start npm --name "stocks" -- run start
pm2 restart worker 2>/dev/null || pm2 start npm --name "worker" -- run worker
pm2 save
echo "=== Done ===" && pm2 list
```

## Utility Scripts

```bash
npm run dev                 # Dev server
npm run build               # Production build
npm run start               # Start production server
npm run lint                # Lint check
npm run worker              # Background job worker
npm run cleanup             # Purge expired cache and history
npm run refresh:quotes      # Refresh watchlist quotes
npm run refresh:news        # Fetch news
npm run jobs:update-prices  # Update prices, indicators, evaluate alerts
npm run prisma:studio       # Prisma Studio
npm run auth:hash           # Generate password hash
```

## Core APIs

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard` | Dashboard data |
| GET | `/api/watchlist` | Watchlist |
| POST | `/api/watchlist/items` | Add item |
| DELETE | `/api/watchlist/items/[id]` | Remove item |
| GET | `/api/stocks/[symbol]/quote` | Real-time quote |
| GET | `/api/stocks/[symbol]/history` | Price history |
| GET | `/api/stocks/[symbol]/indicators` | Technical indicators |
| POST | `/api/stocks/[symbol]/analyze` | Trigger AI analysis |
| GET | `/api/stocks/[symbol]/analysis/latest` | Latest analysis |
| POST | `/api/quotes/batch` | Batch quotes |
| POST | `/api/analysis/latest/batch` | Batch latest analyses |
| GET | `/api/news` | News list |
| POST | `/api/news/fetch` | Fetch news |
| POST | `/api/news/batch` | Batch news |
| POST | `/api/news/[id]/analyze` | AI analysis of a news item |
| GET/PUT | `/api/memory` | Trading memory read/write |
| POST | `/api/chat` | AI chat |
| GET/PUT | `/api/settings/ai` | AI configuration |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/session` | Current session |
| GET | `/api/health` | Health check |
| GET | `/api/sectors/watch` | Sector watch |
| POST | `/api/sectors/watch` | Add sector watch |
| GET | `/api/briefs/daily` | Daily brief |
| POST | `/api/briefs/daily/generate` | Generate daily brief |
| GET | `/api/jobs/[id]` | Job status |
| GET/POST | `/api/alerts` | Alert rules |

Error response format:

```json
{
  "error": {
    "code": "RATE_LIMIT | SYMBOL_NOT_FOUND | AI_INVALID_JSON | INSUFFICIENT_DATA | DATA_PROVIDER_ERROR",
    "message": "Description",
    "details": {}
  }
}
```

## Caching Strategy

| Cache | Key | TTL |
|---|---|---|
| Quote | `quote:{symbol}` | 30 sec |
| Batch Quote | `quote_batch:{hash}` | - |
| News | `news:{symbol}:24h` | 900 sec |
| AI Analysis | `ai_analysis:{symbol}:{inputHash}` | 21600 sec (6 hrs) |
| Latest Analysis | `latest_analysis:{symbol}` | 300 sec |

AI calls are never triggered by page refreshes:

- Dashboard never triggers AI
- Stock detail page does not auto-trigger AI on first load
- Same `symbol + inputHash` won't create duplicate analysis jobs
- Regular news does not trigger AI analysis
- High-impact news enters background queue without blocking the page
- Manual refresh creates a high-priority job; frontend polls task status

## AI Stock Analysis

`lib/ai/analyzeStock.ts` uses the OpenAI-compatible API with Zod validation of AI JSON output. Validation failures retry once, then return `AI_INVALID_JSON`.

Analysis aggregates:

- Current quote and historical price summary
- Technical indicators (RSI, MACD, moving averages, Bollinger Bands)
- User holdings and risk preferences
- Trading memory (custom rules from `/memory`)
- Recent related and sector news
- Macro risks

Output structure:

`trend` · `confidence` · `summary` · `keyLevels` · `riskFactors` · `possibleActions` · `newsSummary` · `newsSentiment` · `catalystEvents` · `macroRisks` · `sectorRisks` · `disclaimer`

## News Intelligence

Models: `NewsItem` → `NewsAnalysis`, plus `SectorWatch` and `DailyMarketBrief`.

News analysis output: `summary` · `sentiment` · `impactLevel` · `affectedSymbols` · `affectedSectors` · `riskNotes` · `whyItMatters` · `confidence`

Processing rules:

- Deduplication by URL or title hash
- High-impact news pinned to top with timestamps
- Low-impact news hidden or archived by default
- Medium-impact news displayed but not sent for AI deep reading
- High-impact news enters AI analysis queue
- Stock analysis passes at most 8 news items (title, source, time, summary, sentiment, impact only — no full text)
- Falls back to Tavily web search when local news sources miss
- If Tavily's first pass misses, AI generates refined search queries for a second pass

## Custom Data Sources

### Stock Data

Implement the `StockDataProvider` interface from `lib/stock-data/types.ts`:

```ts
interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string): Promise<Candle[]>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}
```

Options: `mock` (default), `alpha_vantage`. Register new providers in `lib/stock-data/index.ts`. Keep API keys server-side only.

### News Data

Implement the `NewsProvider` interface from `lib/news/NewsProvider.ts`:

```ts
interface NewsProvider {
  searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]>;
  searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]>;
}
```

Options: `mock` (default), `finnhub`, `tianapi`.

Enable web search fallback:

```env
TAVILY_API_KEY="your-tavily-key"
WEB_SEARCH_MAX_QUERIES=3
WEB_SEARCH_CACHE_TTL_SECONDS=1800
```

## Data Retention

`npm run cleanup` automatically purges:

- `PriceSnapshot`: kept for 7 days
- `NewsItem`: kept for 90 days
- `AiUsageLog`: kept for 90 days
- Completed/failed jobs: kept for 30 days
- Expired `CacheEntry`: deleted immediately

## Alert Rules

`lib/alerts/evaluateAlerts.ts` supports three rule types:

- **price**: price above or below threshold
- **rsi**: RSI 14 above or below threshold
- **volume**: volume anomaly relative to recent average

Triggered alerts set `triggeredAt` and display "Triggered" on the page. MVP does not send emails, SMS, or place orders.

## Disclaimer

This system is for research and analysis purposes only and does not constitute investment advice. AI outputs may be incomplete or inaccurate, cannot guarantee returns, and should not replace independent judgment. This project does not include real trading execution capabilities.
