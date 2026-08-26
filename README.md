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
- **A 股公司证据** — `a_share` 数据源会在每次手动/定时分析前从巨潮资讯刷新正式财务指标、利润表、现金流量表、最近 180 天法定公告和近 6 年定期报告；公告按巨潮真实 30 条上限完整分页。关键公告 PDF 经官方域名白名单、文件大小和 PDF 文件头校验后提取原文与哈希，财务累计值和经归母利润交叉核对的扣非利润由程序转换为独立季度与 TTM。当前 PE(TTM)/PB 由现价与财务数据确定性计算；历史分位使用东方财富、失败时腾讯的 5 年未复权日线，并让财务值在正式报告披露后的下一交易日起生效，记录样本、窗口、来源和价格哈希
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
| 部署 | standalone 模式 + systemd，适合单机 VPS |

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
| `DISCLOSURE_MIN_FUNDAMENTAL_PDF_PER_REFRESH` | 上述 PDF 预算中至少保留给法定定期报告的数量，用于逐轮补齐扣非利润历史 | `3` |
| `DISCLOSURE_MAX_PDF_BYTES` | 单份公告 PDF 最大字节数 | `16777216` |
| `DISCLOSURE_PDF_TIMEOUT_MS` | 单份公告 PDF 下载超时 | `25000` |
| `DISCLOSURE_OCR_ENABLED` | 嵌入文本不足时是否启用扫描件 OCR；关闭后原文保持未闭合 | `true` |
| `DISCLOSURE_OCR_MAX_PAGES` | 单份公告最多允许 OCR 的页数；超限时禁止部分提取冒充全文 | `24` |
| `DISCLOSURE_OCR_RENDER_WIDTH` | OCR 单页渲染宽度，程序限制在 1000–2400 像素 | `1800` |
| `DISCLOSURE_OCR_MAX_RENDERED_BYTES` | 单份公告 OCR 渲染图像累计字节上限 | `67108864` |
| `DISCLOSURE_OCR_MAX_TOTAL_PIXELS` | 单份公告 OCR 渲染累计像素上限 | `120000000` |
| `DISCLOSURE_OCR_PAGE_TIMEOUT_MS` | 单页 Tesseract 识别超时 | `15000` |
| `DISCLOSURE_OCR_TOTAL_TIMEOUT_MS` | 单份公告 OCR 总时限 | `90000` |
| `DISCLOSURE_TESSERACT_BIN` | Tesseract 可执行文件名或绝对路径 | `tesseract` |
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

服务器使用 systemd 托管 Web 与 worker。扫描公告全文识别依赖 Tesseract 简体中文与英文语言包；Ubuntu/Debian 首次部署先安装依赖，并确认 `chi_sim`、`eng` 均可用：

```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-chi-sim
tesseract --list-langs
```

然后安装并启用仓库对应的 `stocks-web.service`、`stocks-worker.service`，随后构建：

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

`update.sh` 仅在确认工作目录为 `/opt/stocks` 后清理 `.next`；拉取代码前会检查 Tesseract 及 `chi_sim`、`eng` 语言包，缺失时停止部署，避免扫描公告静默不可读。健康检查失败时会输出两个服务的最近日志并以失败状态退出。

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

AI 分析缓存统一使用 `ai_analysis:v16:{userId}:{symbol}:{contextHash}`，按用户隔离。上下文哈希忽略单纯的快照生成时间，但包含财务期、财务内容与派生现金流质量指标、扣非利润法定报告 ID/原文哈希/解析器版本、历史估值价格序列哈希与算法版本、同行行业/样本/分位/跨源核对/证据哈希、公告原文哈希与提取回执、新闻精读内容、事件时间线/预期回执/价格反应、近期 K 线、行情修订、组合风险预算、资金和交易记忆；任何实质证据变化都会失效。历史已完成任务不会阻止失败兜底后的再次分析，强制刷新也不会被旧任务吞掉。

页面中的“目标情景净收益”只表示价格到达止盈目标时的扣费结果，不等于统计期望值。当前单笔 AI 条件计划尚未建立独立的样本外概率校准，因此输出会显示 `expectedValueStatus=not_calibrated`、校准胜率为空和期望值为空，并硬性阻止新增仓位；现有规则策略回测只用于风险收缩，不会被冒充为本单胜率。AI 的置信度、趋势文字和自由文本建议不参与仓位大小或最终买卖状态，持仓卖出动作只由用户配置的止损/目标与确定性价格条件触发。

符合完整证据、风险预算、止损和目标约束的计划会进入版本化 `shadow-forecast-v1` 观察，而不会转成真实买入。后台从分析后的下一完整交易日开盘开始，使用未复权日线并严格按当前检查时点截断，观察波段 20 个或长期 63 个交易日内止盈是否先于止损；同日同时触发按止损处理，价格出现无法解释的公司行动时样本作废，行情失败时保留为等待并记录失败原因。样本 cohort 使用确定性的标的价格环境 `risk_on/neutral/risk_off/unknown`，不使用 AI 趋势文字。校准只统计最新的同模型、同 schema 和同算法版本，禁止把旧模型样本混入；同时按预测时间固定使用最早 70%/最新 30% 的时间留出报告，不能看完结果再调整边界。策略实验室显示样本数、Brier Score、基准 Brier、ECE、概率分箱、时间留出结果、扣费后平均结果，以及等待完整 20/63 日后按相同股数和双边费用计算的同期买入持有基准与超额收益。即使达到最低 100 个已结算样本，当前版本仍为 `shadow_only`；标的自身价格环境不能代替宽基市场环境，在完成真正独立的冻结测试集、公司行动/现金分红和组合级基准前不会解锁买入。

当前阶段已为 A 股 `a_share` 数据源接入巨潮资讯财务趋势、5 年年度/8 个独立季度、资本开支、自由现金流、TTM 现金利润匹配指标、基础 PE(TTM)/PB 估值、历史 PE/PB 分位、法定公告目录及关键公告 PDF 原文提取，并按“用户 + 股票”保存刷新快照。公告优先提取嵌入文本；缺字页面逐页渲染并由 Tesseract `chi_sim+eng` 补齐，纯扫描件必须识别全部页面。只有全文件覆盖闭合才标记为 `extracted`，超页数、超时、渲染超限、语言包缺失或识别结果不足时继续保持 `metadata_only` 并阻断新增买入；页面会显示嵌入文本/OCR/混合提取方式、页数、失败原因和提取器版本。OCR 只是可审计的原文读取 fallback，关键财务数字仍由程序交叉核对。扣非归母净利润不猜测巨潮字段，而是从近 6 年中文法定定期报告“主要会计数据”表确定性解析；程序同时核验报告期、人民币单位和同表归母净利润，再转换为独立季度与 TTM。每轮 PDF 总预算中默认保留 3 份给尚未解析的定期报告，已提取原文会按公告 ID、URL、原文哈希和提取器版本复用，因此多轮刷新会继续向历史补齐而不重复下载。

历史估值使用最多 5 年未复权日线，避免把复权价格与历史每股财务值混用；财务期只能在对应正式报告披露后的下一交易日起进入样本，盘中未完成日线不进入分布。巨潮结构化财务序列若存在完整报告修订，只从当前可见的最后一版完整报告发布后开始使用，避免把修订值回填到更早日期。至少覆盖 365 个自然日、252 个有效交易日和 4 份已生效正式报告，且价格截止日距估值截止日不超过 7 天，才标记为 `available`。同行估值使用东方财富 EM2016 行业分类、PE(TTM) 与 PB(MRQ) 提供方可比排名，剔除非正倍数；目标公司倍数需与巨潮确定性口径差异不超过 15%，存在的 PE/PB 指标各需至少 5 家有效同行，缓存 1 小时、24 小时失效。页面显示历史估值及同行行业、样本中值、分位、溢折价、同行明细、来源、抓取时间和哈希；短样本、过期、上游失败、跨源冲突或报告日期无法匹配时保持 `partial/unavailable/conflicted` 并继续阻断长期买入。提供方同行排序是显式限制，低于同行不能单独推出买入结论；历史分位和同行估值都只服务当前研究，不能直接充当历史回测信号。

新闻证据刷新按“用户 + 股票”持久化，记录抓取数、保存数、相关数、可信精读数、fallback、失败、遗漏和截止时间。`NEWS_EVIDENCE_WAIT_TIMEOUT_MS` 控制单次等待上限，`NEWS_EVIDENCE_MAX_CRITICAL` 与 `NEWS_EVIDENCE_MAX_MEDIUM` 控制本轮最大精读数量；超过上限的新闻不会静默丢弃，而会明确显示为未闭合证据。

新闻精读额外保存版本化 `news-event-context-v1`：事件发生时间、首发/跟进/转载阶段、原始来源状态、显式/推断/未知的预期基线、实际事实、预期差方向、影响期限与证伪条件。`explicit` 必须同时给出事前基线、实际结果和能在当前原文中逐字核验的短摘录，否则程序自动降级为 `inferred`；旧精读缺少该回执时会逐步重新精读，不能继续冒充已闭合。主分析使用 `news-event-timeline-v1` 对当前 7 天窗口内标题做全簇一致的保守聚类：数字不同的标题禁止合并，窗口内首次抓到不宣称为全网首发，优先展示法定/官方来源。发布时间晚于分析截止的异常新闻会被排除、显式报告并阻断新增仓位。程序只使用分析截止时间之前的日线，并从新闻发布后的下一完整交易日计算 1/3/5 日收益和前 20 日量比；不足窗口保持空值。高影响事件没有原文明示的事前基线时，波段模式继续阻断条件入场；`inferred` 只能作为待核验假设，不能被解释成可交易预期差。

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
