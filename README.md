# Stock AI Monitor

[English](./README_EN.md) | 中文

自托管的股票监控与 AI 辅助分析系统。基于 Next.js 15，为个人投资者提供专业级别的 AI 投资顾问、实时行情、技术分析和新闻聚合。

> 仅用于研究和辅助分析，不包含真实交易下单功能。

## 核心特性

- **AI 投资顾问** — 结合持仓、技术指标、新闻和交易记忆，给出持仓建议（持有/减仓/止损）和入场建议（点位/时机/仓位）
- **交易复盘闭环** — 记录实际成交并自动重算持仓、已实现盈亏、胜率、利润因子、盈亏比、最大回撤和手续费率；绩效恶化时自动收缩新单风险
- **净收益硬校验** — 买入计划按触发价计算双边手续费、盈亏平衡涨幅和净风险收益比；手续费占比超过 2% 或净风险收益比低于 1.25 的计划自动取消
- **组合风险预算** — 按总资产、现有持仓止损、市场状态和历史绩效计算单笔与组合风险上限；买单按扣费止损风险逐手缩减，缺少止损、额度不足或已有持仓跌破止损时停止新增风险
- **策略历史回测** — 使用收盘信号、下一交易日开盘成交的无未来数据回测；前 65% 数据选择参数、后 35% 做样本外验证，并计入最低手续费、整手约束、回撤和基准超额
- **策略健康门控** — 汇总跨标的样本外收益，并按近期净收益、最大回撤和利润因子给出允许开仓、半仓观察或暂停新开仓；策略生成前自动补齐过期结果，同本金门控在 24 小时内进入实际 AI 决策硬校验
- **滚动门控审计** — 按 60 个交易日滚动验证，每段仅用此前数据控制下一段仓位，对比启用/不启用门控的净收益和手续费
- **ChatGPT 研究包** — 在服务器汇总 K 线 OHLCV、技术指标、相关新闻、DeepSeek 概率场景、持仓、策略绩效和历史回测，生成可直接上传到 ChatGPT 线程的 Markdown / JSON 归档
- **流式 AI 对话** — 实时流式问答，支持 Markdown 渲染；AI 在对话中了解你，自动写入交易记忆，越用越懂你
- **交易记忆系统** — AI 可自动记录你的交易风格、偏好和习惯，所有分析都参考这份长期记忆
- **AI 设置面板** — 网页端直接切换 API 地址、模型、密钥，无需 SSH 改 `.env`
- **新闻智能分析** — 自动抓取、去重、打分，高影响新闻进入 AI 分析队列；支持 Tavily 联网搜索补充
- **技术指标** — RSI、MACD、SMA/EMA、布林带，配合 Recharts 交互图表
- **提醒规则** — 价格突破、RSI 超买超卖、成交量异动，触发后立即标记
- **轻量任务队列** — PostgreSQL 表即任务队列，无需 Redis/Kafka/BullMQ
- **低配友好** — 为 1 核 1GB 单机 VPS 设计，worker 并发固定为 1，所有慢任务异步处理
- **多样数据源** — 支持 Alpha Vantage、Finnhub、天行数据，也可自定义接入

## 页面

| 路由 | 功能 |
|---|---|
| `/` | 看板：自选股、报价、AI 摘要、高影响新闻、提醒 |
| `/watchlist` | 自选股管理 |
| `/focus` | AI 组合决策：候选排序、条件买卖计划、仓位与交易反馈 |
| `/trades` | 交易中心：成交补录、资产快照、组合风险预算、收益曲线与策略绩效复盘 |
| `/strategy-lab` | 策略回测：训练/样本外分离、滚动门控审计、跨标的验证和标的健康门控（最多 8 个标的） |
| `/research` | ChatGPT 研究包：选择标的和数据窗口、生成 DeepSeek 概率场景并下载服务器归档 |
| `/stocks/[symbol]` | 股票详情：K 线图、技术指标、新闻、AI 投资建议 |
| `/news` | 行业新闻与每日市场简报 |
| `/alerts` | 价格 / RSI / 成交量提醒规则 |
| `/settings` | AI 配置：API 地址、模型、密钥（在线修改即时生效） |
| `/memory` | 交易记忆：AI 自动记录你的交易风格，可随时编辑 |
| `/login` | 管理员登录 |

## 快速开始

```bash
git clone https://github.com/Ning-star0/stocks.git
cd stocks
cp .env.example .env   # 编辑 .env，填写 DATABASE_URL 和密码哈希
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run auth:hash -- "你的强密码"
npm run dev
```

浏览器打开 http://localhost:3000

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 15 App Router + TypeScript |
| UI | Tailwind CSS + 本地 shadcn/ui 组件 |
| 图表 | Recharts |
| 数据库 | PostgreSQL + Prisma ORM |
| AI | OpenAI 兼容 API（默认 DeepSeek v4 Pro） |
| 认证 | 单管理员 Session，scrypt 密码哈希，HttpOnly Cookie |
| 股票数据 | `StockDataProvider` 接口（mock / Alpha Vantage / 自定义） |
| 新闻数据 | `NewsProvider` 接口（mock / Finnhub / 天行数据 / 自定义） |
| 部署 | standalone 模式 + pm2，适合单机 VPS |

## 环境变量

核心变量：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | 必填 |
| `OPENAI_API_KEY` | AI API 密钥 | - |
| `OPENAI_BASE_URL` | AI API 地址 | `https://api.deepseek.com` |
| `OPENAI_MODEL` | AI 模型 | `deepseek-v4-pro` |
| `ADMIN_EMAIL` | 管理员邮箱 | `admin@stocks.local` |
| `ADMIN_PASSWORD_HASH_B64` | 密码哈希（Base64url） | 必填 |
| `AUTH_SECRET` | Session 加密密钥 | 必填 |
| `STOCK_DATA_PROVIDER` | 股票数据源 | `mock` |
| `QUOTE_TRADE_GRACE_SECONDS` | 实时报价失败时，允许交易分析使用最近缓存的最大秒数 | `300` |
| `NEWS_PROVIDER` | 新闻数据源 | `mock` |
| `TAVILY_API_KEY` | 联网搜索（可选） | - |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage（可选） | - |
| `FINNHUB_API_KEY` | Finnhub（可选） | - |
| `TIANAPI_KEY` | 天行财经（可选） | - |

完整变量列表见 `.env.example`。不填 AI 密钥时系统返回本地兜底分析，方便调试。

### 生成管理员密码

```bash
npm run auth:hash -- "你的强密码，至少16位"
```

输出 `ADMIN_PASSWORD_HASH_B64` 和 `AUTH_SECRET`，填入 `.env`。

> scrypt 哈希含 `$` 符号，直接写 `ADMIN_PASSWORD_HASH` 可能被 shell 展开导致登录失败，请使用 `ADMIN_PASSWORD_HASH_B64`。

## 生产部署

构建并启动：

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
cp -r .next/static .next/standalone/.next/static
cp .env .next/standalone/.env

pm2 start npm --name "stocks" -- run start
pm2 start npm --name "worker" -- run worker
pm2 save
```

一键更新脚本：

```bash
#!/bin/bash
set -e
cd /opt/stocks
git pull origin main
rm -rf .next
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
cp -r .next/static .next/standalone/.next/static
cp .env .next/standalone/.env
pm2 delete stocks 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
pm2 start npm --name "stocks" -- run start
pm2 restart worker 2>/dev/null || pm2 start npm --name "worker" -- run worker
pm2 save
```

## 低配设计

不需要 Redis、Kafka、Docker 多容器。PostgreSQL 本身就是任务队列：

- worker 并发固定为 1，每 5 秒轮询
- Dashboard 只读缓存，不触发 AI
- 股票详情页首次打开不自动触发 AI
- 所有慢任务通过 `AnalysisJob` 异步处理
- 内存缓存上限 500 key / 64 MB

## AI 分析

`lib/ai/analyzeStock.ts` 综合以下数据生成投资建议：

- 当前报价 + 历史价格摘要
- RSI、MACD、SMA/EMA、布林带
- 用户持仓（成本、目标价、止损价、持仓周期、风险等级）
- 交易记忆（`/memory` 中的长期偏好）
- 最近 8 条相关新闻 + 行业新闻
- Tavily 联网搜索结果
- 宏观 / 行业风险

输出 `holdAdvice`（持仓建议）和 `entryAdvice`（入场建议），包含止损止盈、仓位管理、失效条件。JSON 输出经 Zod 校验，失败自动重试。

### AI 对话与记忆

聊天支持流式输出和 Markdown。AI 在对话中了解到你的交易习惯后，用 `[MEMORY: ...]` 格式自动写入记忆库，以后的分析和对话都会参考这些记忆。你可在 `/memory` 页面随时查看和编辑。

## 数据源扩展

### 股票数据

实现 `lib/stock-data/types.ts` 中的 `StockDataProvider`：

```ts
interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string): Promise<Candle[]>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}
```

在 `lib/stock-data/index.ts` 注册，API key 只放服务端环境变量。

### 新闻数据

实现 `lib/news/NewsProvider.ts` 中的 `NewsProvider`：

```ts
interface NewsProvider {
  searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]>;
  searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]>;
}
```

## 核心 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dashboard` | 看板数据 |
| GET/POST/DELETE | `/api/watchlist*` | 自选股 CRUD |
| GET/POST | `/api/stocks/[symbol]/*` | 报价、历史、指标、分析 |
| GET/POST | `/api/news*` | 新闻列表、抓取、AI 分析 |
| GET/POST | `/api/alerts` | 提醒规则 |
| GET/PUT | `/api/settings/ai` | AI 配置（在线修改） |
| GET/PUT | `/api/memory` | 交易记忆 |
| POST | `/api/chat` | AI 流式对话 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/jobs/[id]` | 任务状态 |

## 免责声明

本系统仅用于研究和辅助分析，不构成投资建议。AI 输出可能不完整或不准确，不能保证收益，不能替代独立判断。本项目不包含真实交易下单能力，也不应扩展为自动下单系统。
