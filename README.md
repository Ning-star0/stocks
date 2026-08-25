# Stock AI Monitor

[English](./README_EN.md) | 中文

自托管的股票监控与 AI 辅助分析系统。基于 Next.js 15，为个人投资者提供专业级别的 AI 投资顾问、实时行情、技术分析和新闻聚合。

> 仅用于研究和辅助分析，不包含真实交易下单功能。

项目的长期边界、证据标准、硬门控和实施顺序，以 [AI 投资研究系统北极星](./docs/AI_INVESTMENT_SYSTEM_NORTH_STAR.md) 为准。该文档同时是后续 AI 编码任务必须遵守的设计约束。

## 核心特性

- **AI 投资顾问** — 结合持仓、技术指标、新闻和交易记忆，给出持仓建议（持有/减仓/止损）和入场建议（点位/时机/仓位）
- **证据优先决策** — 每次分析携带版本化证据包、最近 60 根结构化 K 线、确定性市场特征和数据质量报告；缺关键披露、财务、时效或新闻验证时，只能输出“证据不足”，不得形成买入计划
- **交易复盘闭环** — 记录实际成交并自动重算持仓、已实现盈亏、胜率、利润因子、盈亏比、最大回撤和手续费率；绩效恶化时自动收缩新单风险
- **净收益硬校验** — 买入计划按触发价计算双边手续费、盈亏平衡涨幅和净风险收益比；手续费占比超过 2% 或净风险收益比低于 1.25 的计划自动取消
- **不伪造风险边界** — 用户未设置且 AI 未从证据给出有效支撑/压力时，服务端不会再用固定百分比补造止损止盈；缺止损、目标位或无法计算扣费后净风险收益比时直接取消买入计划
- **组合风险预算** — 每次个股分析与组合决策都按总资产、可用现金、现有持仓止损、市场状态和历史绩效计算单笔与组合风险上限；买单按扣费止损风险逐手缩减，缺少止损、额度不足或已有持仓跌破止损时停止新增风险
- **策略历史回测** — 使用收盘信号、下一交易日开盘成交的无未来数据回测；前 65% 数据选择参数、后 35% 做样本外验证，并计入最低手续费、整手约束、回撤和基准超额
- **策略健康门控** — 汇总跨标的样本外收益，并按近期净收益、最大回撤和利润因子给出允许开仓、半仓观察或暂停新开仓；策略生成前自动补齐过期结果，同本金门控在 24 小时内进入实际 AI 决策硬校验
- **滚动门控审计** — 按 60 个交易日滚动验证，每段仅用此前数据控制下一段仓位，对比启用/不启用门控的净收益和手续费
- **ChatGPT 研究包** — 在服务器汇总 K 线 OHLCV、技术指标、相关新闻、DeepSeek 概率场景、持仓、策略绩效和历史回测，生成可直接上传到 ChatGPT 线程的 Markdown / JSON 归档
- **流式 AI 对话** — 实时流式问答，支持 Markdown 渲染；AI 在对话中了解你，自动写入交易记忆，越用越懂你
- **交易记忆系统** — AI 可自动记录你的交易风格、偏好和习惯，所有分析都参考这份长期记忆
- **AI 设置面板** — 网页端直接切换 API 地址、模型、密钥，无需 SSH 改 `.env`
- **新闻智能分析** — 自动抓取、去重、打分，高影响新闻进入 AI 分析队列；支持 Tavily 联网搜索补充
- **分析前新闻屏障** — 手动与定时股票分析会按标的刷新新闻，并等待高影响及相关中影响新闻精读；超时、来源失败或本地兜底会进入数据质量报告并阻断新增买入
- **A 股公司证据** — `a_share` 数据源会在每次手动/定时分析前从巨潮资讯刷新正式财务指标、利润表、现金流量表和最近 180 天法定公告；关键公告 PDF 经官方域名白名单、文件大小和 PDF 文件头校验后提取原文与哈希，财务累计值由程序转换为独立季度，估值由当前报价与 TTM EPS/每股净资产确定性计算
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
| `DISCLOSURE_MAX_PDF_PER_REFRESH` | 每只股票每轮最多提取的关键公告 PDF 数；超出部分保持未闭合并阻断新买入 | `6` |
| `DISCLOSURE_MAX_PDF_BYTES` | 单份公告 PDF 最大字节数 | `16777216` |
| `DISCLOSURE_PDF_TIMEOUT_MS` | 单份公告 PDF 下载超时 | `25000` |
| `TAVILY_API_KEY` | 联网搜索（可选） | - |
| `TAVILY_PROJECT_ID` | Tavily 用量归因项目 ID | `stocks` |
| `NEWS_DAILY_CALL_LIMIT` | 天行成功请求日硬上限；`0` 表示不设本地上限 | `100` |
| `WEB_SEARCH_MONTHLY_CALL_LIMIT` | Tavily 月硬上限；`0` 表示不设本地上限 | `1000` |
| `NEWS_CRITICAL_QUOTA_RESERVE_PCT` | 为手动关键风险核验保留的额度比例 | `20` |
| `NEWS_MAX_TIANAPI_CALLS_PER_REFRESH` | 单只股票单次刷新最多新增的天行请求 | `2` |
| `NEWS_MAX_TAVILY_CALLS_PER_REFRESH` | 单只股票单次刷新最多新增的 Tavily 请求 | `1` |
| `NEWS_CRITICAL_CACHE_TTL_SECONDS` | 公司重大风险候选缓存秒数 | `3600` |
| `NEWS_TOPIC_CACHE_TTL_SECONDS` | 交易时段普通行业新闻缓存秒数 | `14400` |
| `NEWS_OFF_HOURS_CACHE_TTL_SECONDS` | 非交易时段普通主题缓存秒数 | `21600` |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage（可选） | - |
| `FINNHUB_API_KEY` | Finnhub（可选） | - |
| `TIANAPI_KEY` | 天行财经（可选） | - |

完整变量列表见 `.env.example`。不填 AI 密钥时系统返回本地兜底分析，方便调试。

同一批次内已识别为相同行业的股票会共享一次主题新闻查询，再按股票名称、代码和行业关键词分别过滤。`POST /api/news/fetch` 只有在同时指定单只 `symbol` 时才接受 `forceCriticalRefresh: true`；该参数仅用于明确的重大风险核验，禁止批量穿透缓存。

### 生成管理员密码

```bash
npm run auth:hash -- "你的强密码，至少16位"
```

输出 `ADMIN_PASSWORD_HASH_B64` 和 `AUTH_SECRET`，填入 `.env`。

> scrypt 哈希含 `$` 符号，直接写 `ADMIN_PASSWORD_HASH` 可能被 shell 展开导致登录失败，请使用 `ADMIN_PASSWORD_HASH_B64`。

## 生产部署

服务器使用 systemd 托管 Web 与 worker。首次部署前先安装并启用仓库对应的 `stocks-web.service`、`stocks-worker.service`，随后构建：

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
cp .env .next/standalone/.env

sudo systemctl restart stocks-web.service stocks-worker.service
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

后续从 `/opt/stocks` 一键更新并执行迁移、构建、服务重启和健康检查：

```bash
cd /opt/stocks
sudo bash update.sh
```

`update.sh` 仅在确认工作目录为 `/opt/stocks` 后清理 `.next`；健康检查失败时会输出两个服务的最近日志并以失败状态退出。

部署后可在已配置且允许写入临时固定样本的数据库运行可选端到端验收；测试使用唯一邮箱和缓存键，并在结束时级联清理临时用户、分析、证据与用量记录：

```bash
RUN_DB_E2E_TESTS=true npx tsx --test tests/apiQuotaDb.test.ts tests/analysisPersistenceDb.test.ts
```

该验收覆盖并发额度锁、持久化缓存、用户级分析复用隔离、交易记忆导致的上下文失效，以及持久化证据不足继续阻断条件买入。

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
- 最近 60 根结构化 OHLCV K 线，以及由程序确定性计算的波动、回撤、量比、缺口和区间位置
- RSI、MACD、SMA/EMA、布林带
- 用户持仓（成本、目标价、止损价、持仓周期、风险等级）
- 交易记忆（`/memory` 中的长期偏好）
- 最近 8 条相关新闻 + 行业新闻
- Tavily 联网搜索结果
- 宏观 / 行业风险

分析输入统一封装为版本化 `AnalysisEvidencePackage`，并生成 `DataQualityReport`。输出除 `holdAdvice` 和 `entryAdvice` 外，还包含结构化 `decisionStatus`、支持证据、反对证据和缺失证据；首页与详情页优先展示这一状态，旧文本推断只作为历史数据兼容。JSON 输出经 Zod 校验，失败自动重试。

AI 分析缓存统一使用 `ai_analysis:v10:{userId}:{symbol}:{contextHash}`，按用户隔离。上下文哈希忽略单纯的快照生成时间，但包含财务期、财务内容与派生现金流质量指标、公告原文哈希、新闻精读内容、近期 K 线、行情修订、组合风险预算、资金和交易记忆；任何实质证据变化都会失效。历史已完成任务不会阻止失败兜底后的再次分析，强制刷新也不会被旧任务吞掉。

页面中的“目标情景净收益”只表示价格到达止盈目标时的扣费结果，不等于统计期望值。当前单笔 AI 条件计划尚未建立独立的样本外概率校准，因此输出会显示 `expectedValueStatus=not_calibrated`、校准胜率为空和期望值为空；现有规则策略回测只用于风险收缩，不会被冒充为本单胜率。

当前阶段已为 A 股 `a_share` 数据源接入巨潮资讯财务趋势、5 年年度/8 个独立季度、资本开支、自由现金流、TTM 现金利润匹配指标、基础 PE(TTM)/PB 估值、法定公告目录及关键公告 PDF 原文提取，并按“用户 + 股票”保存刷新快照。系统保存公告来源、原文哈希、提取字符数和风险相关原文片段，由最终股票分析统一阅读，并在页面明确显示财务样本数、自由现金流和缺失口径。历史估值分位、同行估值和扣非利润仍缺失；当前已核验的巨潮结构化字段没有提供可安全采用的扣非利润映射，因此系统必须继续标记缺失，禁止猜测字段或让模型补造。扫描版、超大、超时或超出单轮上限的公告也会保持未闭合。因此，存在关键公告仅有元数据、公司证据过期或来源失败时，系统会明确标记并阻断新的买入计划。其他股票数据提供器若未实现公司证据接口，也会进入同一硬门控。

新闻证据刷新按“用户 + 股票”持久化，记录抓取数、保存数、相关数、可信精读数、fallback、失败、遗漏和截止时间。`NEWS_EVIDENCE_WAIT_TIMEOUT_MS` 控制单次等待上限，`NEWS_EVIDENCE_MAX_CRITICAL` 与 `NEWS_EVIDENCE_MAX_MEDIUM` 控制本轮最大精读数量；超过上限的新闻不会静默丢弃，而会明确显示为未闭合证据。

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
  getFundamentals?(symbol: string, options?: CompanyEvidenceOptions): Promise<FundamentalEvidence>;
  getDisclosures?(symbol: string, options?: CompanyEvidenceOptions): Promise<DisclosureEvidence>;
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
