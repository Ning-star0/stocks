# 股票 AI 监控 MVP

这是一个基于 Next.js App Router 的股票监控与 AI 辅助分析 MVP。系统支持自选股、行情缓存、技术指标、提醒规则、新闻聚合、AI 结构化分析和轻量后台任务队列。

本项目只用于研究和辅助分析，不包含真实交易下单功能。

## 技术栈

- 前端：Next.js App Router、TypeScript、Tailwind CSS
- UI：本地 shadcn/ui 风格组件
- 图表：Recharts
- 后端：Next.js API Routes
- 数据库：PostgreSQL
- ORM：Prisma
- AI：OpenAI API 兼容客户端
- 股票数据：`StockDataProvider`，默认 `MockStockDataProvider`
- 新闻数据：`NewsProvider`，默认 `MockNewsProvider`

## 低配服务器说明

默认设计适合 2 核 CPU、2GB 内存的单机部署：

- 默认不需要 Redis
- 默认不需要 Kafka、RabbitMQ、BullMQ
- 默认不需要 Docker 多容器
- 使用 PostgreSQL 表作为轻量任务队列
- worker 并发固定为 1
- Dashboard 只读缓存和数据库，不触发 AI
- 股票详情页首次打开不自动触发 AI
- 所有慢任务通过 `AnalysisJob` 异步处理

如果服务器内存很小，推荐直接在系统上安装 Node.js、PostgreSQL，再用 `npm run build && npm run start` 启动。Docker 只作为本地开发可选方案，不是必须。

## 环境变量

复制 `.env.example` 为 `.env`：

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stocks_ai?schema=public"
STOCK_DATA_PROVIDER="mock"
NEWS_PROVIDER="mock"
TIANAPI_KEY=""
ALPHA_VANTAGE_API_KEY=""
FINNHUB_API_KEY=""
OPENAI_API_KEY=""
OPENAI_BASE_URL="https://api.deepseek.com"
OPENAI_MODEL="deepseek-v4-flash"

ADMIN_EMAIL="admin@stocks.local"
ADMIN_PASSWORD_HASH=""
ADMIN_PASSWORD_HASH_B64=""
AUTH_SECRET=""
AUTH_SESSION_DAYS=7

MAX_CONCURRENT_JOBS=1
MAX_EXTERNAL_API_CONCURRENT=2
MAX_BATCH_SYMBOLS=50
IN_MEMORY_CACHE_MAX_KEYS=500
IN_MEMORY_CACHE_MAX_MB=64

QUOTE_CACHE_TTL_SECONDS=30
NEWS_CACHE_TTL_SECONDS=900
AI_ANALYSIS_CACHE_TTL_SECONDS=21600
LATEST_ANALYSIS_CACHE_TTL_SECONDS=300

ENABLE_AUTO_ANALYSIS=false
ENABLE_BACKGROUND_WORKER=true
JOB_POLL_INTERVAL_MS=5000
JOB_TIMEOUT_SECONDS=120

QUOTE_RETENTION_DAYS=7
NEWS_RETENTION_DAYS=90
AI_LOG_RETENTION_DAYS=90
JOB_RETENTION_DAYS=30
```

本地开发可以不填真实 API key。没有 `OPENAI_API_KEY` 时，系统会返回确定性的本地兜底分析，方便调试页面和流程。

如果使用 DeepSeek Flash，把 `OPENAI_API_KEY` 设置为你的 DeepSeek API key，并保持：

```env
OPENAI_BASE_URL="https://api.deepseek.com"
OPENAI_MODEL="deepseek-v4-flash"
```

## 登录账号

网站默认启用单管理员登录。账号写在 `.env`，密码不保存明文，只保存 scrypt 哈希。

生成密码哈希：

```bash
npm run auth:hash -- "换成你的强密码，至少16位"
```

命令会输出：

```env
ADMIN_PASSWORD_HASH="scrypt$..."
AUTH_SECRET="..."
```

由于 Next.js 读取 `.env` 时会处理 `$` 符号，推荐把 `ADMIN_PASSWORD_HASH` 转成 base64url 后写入 `ADMIN_PASSWORD_HASH_B64`，避免哈希被展开。也可以手动把哈希里的 `$` 写成 `\$`。

`.env` 推荐配置：

```env
ADMIN_EMAIL="admin@stocks.local"
ADMIN_PASSWORD_HASH_B64="base64url后的哈希"
AUTH_SECRET="..."
AUTH_SESSION_DAYS=7
```

然后打开 `/login` 登录。业务 API 和页面默认都需要登录；session 使用 HttpOnly Cookie，不会暴露给前端 JavaScript。

## 本地启动

安装依赖：

```bash
npm install
```

准备 PostgreSQL，并确保 `.env` 里的 `DATABASE_URL` 可以连接。

生成 Prisma Client 并创建数据库表：

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

启动开发服务：

```bash
npm run dev
```

浏览器打开：

[http://localhost:3000](http://localhost:3000)

## 生产启动

低配服务器推荐方式：

```bash
npm install --omit=dev
npm run prisma:generate
npm run build
npm run start
```

另开一个终端启动后台 worker：

```bash
npm run worker
```

如果使用 systemd，建议把 Web 服务和 worker 分成两个服务管理。worker 每次只处理 1 个任务，默认每 5 秒轮询一次数据库。

## 常用脚本

```bash
npm run dev                 # 开发服务
npm run build               # 生产构建
npm run start               # 启动生产服务
npm run lint                # 代码检查
npm run prisma:studio       # 打开 Prisma Studio
npm run worker              # 启动后台任务 worker
npm run cleanup             # 清理过期缓存和历史数据
npm run refresh:quotes      # 刷新自选股报价
npm run refresh:news        # 抓取新闻
npm run jobs:update-prices  # 更新价格、指标并评估提醒
```

## 页面

- `/`：看板，显示自选股、缓存报价、最新 AI 摘要、高影响新闻和提醒
- `/watchlist`：自选股管理
- `/stocks/[symbol]`：股票详情、图表、指标、新闻和 AI 分析
- `/news`：行业新闻和每日市场简报
- `/alerts`：提醒规则

## 核心 API

- `GET /api/dashboard`
- `GET /api/watchlist`
- `POST /api/watchlist/items`
- `DELETE /api/watchlist/items/[id]`
- `GET /api/stocks/[symbol]/quote`
- `GET /api/stocks/[symbol]/history`
- `GET /api/stocks/[symbol]/indicators`
- `POST /api/stocks/[symbol]/analyze`
- `GET /api/stocks/[symbol]/analysis/latest`
- `POST /api/quotes/batch`
- `POST /api/analysis/latest/batch`
- `POST /api/news/batch`
- `GET /api/news`
- `POST /api/news/fetch`
- `POST /api/news/[id]/analyze`
- `GET /api/sectors/watch`
- `POST /api/sectors/watch`
- `GET /api/briefs/daily`
- `POST /api/briefs/daily/generate`
- `GET /api/jobs/[id]`
- `GET /api/alerts`
- `POST /api/alerts`

错误响应统一格式：

```json
{
  "error": {
    "code": "RATE_LIMIT | SYMBOL_NOT_FOUND | AI_INVALID_JSON | INSUFFICIENT_DATA | DATA_PROVIDER_ERROR",
    "message": "错误说明",
    "details": {}
  }
}
```

## 缓存与 AI 调用策略

缓存 key 约定：

- 报价：`quote:{symbol}`，默认 30 秒
- 批量报价：`quote_batch:{hash}`
- 新闻：`news:{symbol}:24h`，默认 900 秒
- AI 分析：`ai_analysis:{symbol}:{inputHash}`，默认 21600 秒
- 最新分析：`latest_analysis:{symbol}`，默认 300 秒

AI 调用不会因为页面刷新自动发生：

- Dashboard 不触发 AI
- 股票详情页首次打开不触发 AI
- 同一个 `symbol + inputHash` 不重复创建分析任务
- 普通新闻不触发 AI 分析
- 高影响新闻进入后台队列，不阻塞页面
- 用户点击强制刷新时，只创建高优先级 job，前端轮询任务状态

## 股票 AI 分析

`lib/ai/analyzeStock.ts` 使用 OpenAI 兼容 chat completions 客户端，并通过 Zod 校验 AI JSON 输出。非法 JSON 或 schema 校验失败会重试一次，仍失败则返回 `AI_INVALID_JSON`。

股票综合分析会结合：

- 当前报价
- 历史价格摘要
- 技术指标
- 用户持仓和风险偏好
- 最近相关新闻
- 行业新闻
- 宏观风险

AI 输出包含：

- `trend`
- `confidence`
- `summary`
- `keyLevels`
- `riskFactors`
- `possibleActions`
- `newsSummary`
- `newsSentiment`
- `catalystEvents`
- `macroRisks`
- `sectorRisks`
- `disclaimer`

## 新闻智能

新闻相关模型：

- `NewsItem`
- `NewsAnalysis`
- `SectorWatch`
- `DailyMarketBrief`

新闻分析输出：

- `summary`
- `sentiment`
- `impactLevel`
- `affectedSymbols`
- `affectedSectors`
- `riskNotes`
- `whyItMatters`
- `confidence`

新闻处理规则：

- 按 URL 或标题 hash 去重
- 高影响新闻置顶
- 显示发布时间，避免旧新闻被误认为新消息
- low 新闻默认隐藏或存档
- medium 新闻只展示，不默认做 AI 精读
- high 新闻才允许进入 AI 分析队列
- 股票综合分析最多传入 8 条新闻
- 综合分析只传标题、来源、发布时间、摘要、情绪和影响级别，不传完整正文

## 替换股票数据源

股票数据源接口在 `lib/stock-data/types.ts`：

```ts
interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string): Promise<Candle[]>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}
```

当前可选值：

```env
STOCK_DATA_PROVIDER="mock"
STOCK_DATA_PROVIDER="alpha_vantage"
```

使用 Alpha Vantage：

```env
ALPHA_VANTAGE_API_KEY="your-key"
```

接入 Polygon、Massive 或 WebSocket 行情时：

1. 在 `lib/stock-data/` 新增 provider 类。
2. 实现 `StockDataProvider`。
3. 把限流、代码不存在、数据源异常转换为 `AppError`。
4. 在 `lib/stock-data/index.ts` 注册。
5. API key 只放服务端环境变量，不传给前端。

## 替换新闻数据源

新闻数据源接口在 `lib/news/NewsProvider.ts`：

```ts
interface NewsProvider {
  searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]>;
  searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]>;
}
```

当前可选值：

```env
NEWS_PROVIDER="mock"
NEWS_PROVIDER="finnhub"
NEWS_PROVIDER="tianapi"
```

使用 Finnhub：

```env
FINNHUB_API_KEY="your-key"
```

使用天行数据财经新闻：

```env
NEWS_PROVIDER="tianapi"
TIANAPI_KEY="your-key"
```

天行财经新闻接口适合内部数据分析和 AI 摘要。若要把原始新闻标题、摘要、链接用于公开终端展示，请先确认接口授权范围。

新增新闻 provider 时：

1. 在 `lib/news/` 新增 provider 类。
2. 实现 `searchCompanyNews` 和 `searchTopicNews`。
3. 统一返回标题、来源、发布时间、URL、正文或摘要、相关股票和行业。
4. 在 `lib/news/index.ts` 注册。
5. API key 只放服务端环境变量。

## 数据保留策略

`npm run cleanup` 会按默认策略清理：

- `PriceSnapshot`：保留最近 7 天
- `NewsItem`：保留最近 90 天
- `AiUsageLog`：保留最近 90 天
- failed/completed/skipped jobs：保留最近 30 天
- 过期 `CacheEntry`：立即删除

## 提醒规则

提醒评估集中在 `lib/alerts/evaluateAlerts.ts`：

- `price`：价格高于或低于阈值
- `rsi`：RSI 14 高于或低于阈值
- `volume`：当前成交量相对近期均量异常

MVP 阶段只会设置 `triggeredAt` 并在页面显示“已触发”，不会发送邮件或短信，也不会下单。

## 免责声明

本系统仅用于研究和辅助分析，不构成投资建议。AI 输出可能不完整或不准确，不能保证收益，也不能替代独立判断。本项目不包含真实交易下单能力，也不应扩展为自动下单系统。
