# Stock AI Monitor

[English](./README_EN.md) | 中文

基于 Next.js 15 App Router 的股票监控与 AI 辅助分析系统。支持自选股管理、行情缓存、技术指标、提醒规则、新闻聚合、AI 结构化分析和后台任务队列。

本项目仅用于研究和辅助分析，不包含真实交易下单功能。

## 页面

| 路由 | 功能 |
|---|---|
| `/` | 看板：自选股、缓存报价、AI 摘要、高影响新闻、提醒 |
| `/watchlist` | 自选股管理 |
| `/stocks/[symbol]` | 股票详情：图表、指标、新闻、AI 分析 |
| `/news` | 行业新闻与每日市场简报 |
| `/alerts` | 价格/RSI/成交量提醒规则 |
| `/settings` | AI 配置：API 地址、密钥、模型名称 |
| `/memory` | 交易记忆：记录交易风格和偏好，AI 分析时自动参考 |
| `/login` | 管理员登录 |

## 技术栈

- **前端**：Next.js 15 App Router、TypeScript、Tailwind CSS
- **UI**：shadcn/ui 风格组件
- **图表**：Recharts
- **后端**：Next.js API Routes
- **数据库**：PostgreSQL
- **ORM**：Prisma
- **AI**：OpenAI API 兼容客户端（默认 DeepSeek）
- **股票数据**：`StockDataProvider` 接口，默认 `MockStockDataProvider`
- **新闻数据**：`NewsProvider` 接口，默认 `MockNewsProvider`

## 低配服务器说明

针对 1 核 1GB 到 2 核 2GB 的单机 VPS 设计：

- 不需要 Redis
- 不需要 Kafka / RabbitMQ / BullMQ
- 不需要 Docker 多容器
- 使用 PostgreSQL 表作为轻量任务队列
- worker 并发固定为 1
- Dashboard 只读缓存和数据库，不触发 AI
- 股票详情页首次打开不自动触发 AI
- 所有慢任务通过 `AnalysisJob` 异步处理

## 环境变量

复制 `.env.example` 为 `.env`，核心变量：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | 必填 |
| `STOCK_DATA_PROVIDER` | 股票数据源 | `mock` |
| `NEWS_PROVIDER` | 新闻数据源 | `mock` |
| `OPENAI_API_KEY` | AI API 密钥 | - |
| `OPENAI_BASE_URL` | AI API 地址 | `https://api.deepseek.com` |
| `OPENAI_MODEL` | AI 模型 | `deepseek-v4-pro` |
| `ADMIN_EMAIL` | 管理员邮箱 | `admin@stocks.local` |
| `ADMIN_PASSWORD_HASH_B64` | 密码哈希（Base64url） | 必填 |
| `AUTH_SECRET` | Session 加密密钥 | 必填 |
| `TAVILY_API_KEY` | 联网搜索（可选） | - |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage 数据（可选） | - |
| `FINNHUB_API_KEY` | Finnhub 新闻（可选） | - |
| `TIANAPI_KEY` | 天行财经新闻（可选） | - |

完整变量列表和说明见 `.env.example`。没有 `OPENAI_API_KEY` 时，系统返回本地兜底分析，方便调试页面和流程。

## 登录账号

系统使用单管理员登录。密码不保存明文，只保存 scrypt 哈希。

生成密码哈希：

```bash
npm run auth:hash -- "你的强密码，至少16位"
```

命令会输出 `ADMIN_PASSWORD_HASH_B64` 和 `AUTH_SECRET`，填入 `.env`：

```env
ADMIN_EMAIL="admin@stocks.local"
ADMIN_PASSWORD_HASH=""
ADMIN_PASSWORD_HASH_B64="输出的base64url哈希"
AUTH_SECRET="输出的密钥"
AUTH_SESSION_DAYS=7
```

> **注意**：请使用 `ADMIN_PASSWORD_HASH_B64`。scrypt 哈希包含 `$` 符号，直接写 `ADMIN_PASSWORD_HASH="scrypt$..."` 可能被 shell 展开导致登录失败。

配置完成后打开 `/login` 登录。Session 使用 HttpOnly Cookie，前端 JavaScript 不可访问。

## 本地开发

```bash
# 安装依赖
npm install

# 准备 PostgreSQL，确保 .env 中 DATABASE_URL 正确

# 生成 Prisma Client 并创建数据库表
npx prisma generate
npx prisma migrate dev --name init

# 生成管理员密码哈希
npm run auth:hash -- "你的密码"

# 启动开发服务
npm run dev
```

浏览器打开 http://localhost:3000

## 生产部署

构建并启动：

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

# 复制静态文件（standalone 模式必需）
cp -r .next/static .next/standalone/.next/static
cp .env .next/standalone/.env

# 启动 Web 服务
pm2 start node --name "stocks" -- .next/standalone/server.js

# 启动后台 worker
pm2 start npm --name "worker" -- run worker
pm2 save
```

## 一键更新脚本

```bash
#!/bin/bash
set -e
cd /opt/stocks

echo "=== 拉取代码 ===" && git pull origin main
echo "=== 安装依赖 ===" && npm install
echo "=== 清理旧构建 ===" && rm -rf .next
echo "=== 生成 Prisma ===" && npx prisma generate
echo "=== 数据库迁移 ===" && npx prisma migrate deploy
echo "=== 构建 ===" && npm run build
echo "=== 复制静态文件 ===" && cp -r .next/static .next/standalone/.next/static
echo "=== 重启服务 ==="
pm2 delete stocks 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
cp .env .next/standalone/.env
pm2 start node --name "stocks" -- .next/standalone/server.js
pm2 restart worker 2>/dev/null || pm2 start npm --name "worker" -- run worker
pm2 save
echo "=== 完成 ===" && pm2 list
```

## 常用脚本

```bash
npm run dev                 # 开发服务
npm run build               # 生产构建
npm run start               # 启动生产服务
npm run lint                # 代码检查
npm run worker              # 后台任务 worker
npm run cleanup             # 清理过期缓存和历史数据
npm run refresh:quotes      # 刷新自选股报价
npm run refresh:news        # 抓取新闻
npm run jobs:update-prices  # 更新价格、指标并评估提醒
npm run prisma:studio       # Prisma Studio
npm run auth:hash           # 生成密码哈希
```

## 核心 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dashboard` | 看板数据 |
| GET | `/api/watchlist` | 自选股列表 |
| POST | `/api/watchlist/items` | 添加自选股 |
| DELETE | `/api/watchlist/items/[id]` | 删除自选股 |
| GET | `/api/stocks/[symbol]/quote` | 实时报价 |
| GET | `/api/stocks/[symbol]/history` | 历史数据 |
| GET | `/api/stocks/[symbol]/indicators` | 技术指标 |
| POST | `/api/stocks/[symbol]/analyze` | 触发 AI 分析 |
| GET | `/api/stocks/[symbol]/analysis/latest` | 最新分析结果 |
| POST | `/api/quotes/batch` | 批量报价 |
| POST | `/api/analysis/latest/batch` | 批量最新分析 |
| GET | `/api/news` | 新闻列表 |
| POST | `/api/news/fetch` | 抓取新闻 |
| POST | `/api/news/batch` | 批量新闻 |
| POST | `/api/news/[id]/analyze` | AI 分析单条新闻 |
| GET/PUT | `/api/memory` | 交易记忆读写 |
| POST | `/api/chat` | AI 对话 |
| GET/PUT | `/api/settings/ai` | AI 配置 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/session` | 当前会话 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/sectors/watch` | 行业关注 |
| POST | `/api/sectors/watch` | 添加行业关注 |
| GET | `/api/briefs/daily` | 每日简报 |
| POST | `/api/briefs/daily/generate` | 生成每日简报 |
| GET | `/api/jobs/[id]` | 任务状态查询 |
| GET/POST | `/api/alerts` | 提醒规则 |

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

## 缓存策略

| 缓存 | Key | TTL |
|---|---|---|
| 报价 | `quote:{symbol}` | 30 秒 |
| 批量报价 | `quote_batch:{hash}` | - |
| 新闻 | `news:{symbol}:24h` | 900 秒 |
| AI 分析 | `ai_analysis:{symbol}:{inputHash}` | 21600 秒（6 小时） |
| 最新分析 | `latest_analysis:{symbol}` | 300 秒 |

AI 调用不会因页面刷新自动触发：

- Dashboard 不触发 AI
- 股票详情页首次打开不自动触发 AI
- 同一 `symbol + inputHash` 不重复创建分析任务
- 普通新闻不触发 AI 分析
- 高影响新闻进入后台队列，不阻塞页面
- 用户点击强制刷新时，创建高优先级 job，前端轮询状态

## AI 股票分析

`lib/ai/analyzeStock.ts` 使用 OpenAI 兼容 API，通过 Zod 校验 AI 输出的 JSON。校验失败自动重试一次，仍失败返回 `AI_INVALID_JSON`。

分析综合以下数据：

- 当前报价与历史价格摘要
- 技术指标（RSI、MACD、均线、布林带）
- 用户持仓和风险偏好
- 交易记忆（`/memory` 中的自定义规则）
- 最近相关新闻与行业新闻
- 宏观风险

AI 输出结构：

`trend` · `confidence` · `summary` · `keyLevels` · `riskFactors` · `possibleActions` · `newsSummary` · `newsSentiment` · `catalystEvents` · `macroRisks` · `sectorRisks` · `disclaimer`

## 新闻智能

模型：`NewsItem` → `NewsAnalysis`，支持 `SectorWatch`（行业关注）和 `DailyMarketBrief`（每日简报）。

新闻分析输出：`summary` · `sentiment` · `impactLevel` · `affectedSymbols` · `affectedSectors` · `riskNotes` · `whyItMatters` · `confidence`

处理规则：

- 按 URL 或标题 hash 去重
- 高影响新闻置顶，显示发布时间
- low 新闻默认隐藏或存档
- medium 新闻只展示，不默认做 AI 精读
- high 新闻进入 AI 分析队列
- 股票综合分析最多传入 8 条新闻（只传标题、来源、时间、摘要、情绪、影响级别，不传全文）
- 本地新闻源无命中时，通过 Tavily 联网搜索补充
- Tavily 第一轮未命中，由 AI 生成更细搜索词后重试

## 替换数据源

### 股票数据

实现 `lib/stock-data/types.ts` 中的 `StockDataProvider` 接口：

```ts
interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string): Promise<Candle[]>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}
```

可选值：`mock`（默认）、`alpha_vantage`。接入新数据源时在 `lib/stock-data/index.ts` 注册，API key 只放服务端环境变量。

### 新闻数据

实现 `lib/news/NewsProvider.ts` 中的 `NewsProvider` 接口：

```ts
interface NewsProvider {
  searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]>;
  searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]>;
}
```

可选值：`mock`（默认）、`finnhub`、`tianapi`。

使用联网搜索补充：

```env
TAVILY_API_KEY="your-tavily-key"
WEB_SEARCH_MAX_QUERIES=3
WEB_SEARCH_CACHE_TTL_SECONDS=1800
```

## 数据保留

`npm run cleanup` 自动清理：

- `PriceSnapshot`：保留 7 天
- `NewsItem`：保留 90 天
- `AiUsageLog`：保留 90 天
- 已完成/失败的任务：保留 30 天
- 过期 `CacheEntry`：立即删除

## 提醒规则

`lib/alerts/evaluateAlerts.ts` 支持三种规则：

- **price**：价格高于或低于阈值
- **rsi**：RSI 14 高于或低于阈值
- **volume**：成交量相对近期均量异常

触发后设置 `triggeredAt` 并在页面显示"已触发"。MVP 阶段不发送邮件/短信，不下单。

## 免责声明

本系统仅用于研究和辅助分析，不构成投资建议。AI 输出可能不完整或不准确，不能保证收益，不能替代独立判断。本项目不包含真实交易下单能力。
