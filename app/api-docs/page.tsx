import type { ReactNode } from "react";
import { Activity, Bot, Clock3, Crosshair, Database, ListChecks, Newspaper, Server, ShieldCheck, Sparkles } from "lucide-react";

import { ApiHealthPanel } from "@/components/ApiHealthPanel";
import { ApiUsagePanel } from "@/components/ApiUsagePanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, SectionHeader } from "@/components/ui/layout";

type Endpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  auth?: "公开" | "登录";
  body?: string;
  notes?: string;
  cost?: "只读" | "写库" | "入队" | "AI";
};

const apiGroups: Array<{ title: string; icon: ReactNode; description: string; endpoints: Endpoint[] }> = [
  {
    title: "认证与会话",
    icon: <ShieldCheck className="h-4 w-4" />,
    description: "登录态基于 HttpOnly Cookie。除登录和健康检查外，业务接口默认需要登录。",
    endpoints: [
      { method: "POST", path: "/api/auth/login", description: "管理员登录，写入 session cookie。", auth: "公开", body: "{ email, password }", cost: "写库" },
      { method: "POST", path: "/api/auth/logout", description: "退出登录并清除 session cookie。", auth: "登录", cost: "写库" },
      { method: "GET", path: "/api/auth/session", description: "读取当前登录用户。", auth: "登录", cost: "只读" }
    ]
  },
  {
    title: "看板与批量读取",
    icon: <Database className="h-4 w-4" />,
    description: "适合页面首屏聚合，不主动触发 AI 分析。",
    endpoints: [
      { method: "GET", path: "/api/dashboard", description: "自选股、行情缓存、最新分析、新闻和提醒聚合。", cost: "只读" },
      { method: "POST", path: "/api/quotes/batch", description: "批量读取报价，最多 50 个 symbol。", body: "{ symbols: string[] }", cost: "只读" },
      { method: "POST", path: "/api/analysis/latest/batch", description: "批量读取最近一次 AI 分析。", body: "{ symbols: string[] }", cost: "只读" },
      { method: "POST", path: "/api/news/batch", description: "批量读取缓存新闻。", body: "{ symbols?: string[], sectors?: string[] }", cost: "只读" }
    ]
  },
  {
    title: "自选股与持仓",
    icon: <ListChecks className="h-4 w-4" />,
    description: "管理标的、持仓价、目标价、止损、周期和风险等级。",
    endpoints: [
      { method: "GET", path: "/api/watchlist", description: "读取当前用户自选股和行情。", cost: "只读" },
      { method: "POST", path: "/api/watchlist/items", description: "添加自选股，重复 symbol 会复用或更新。", body: "{ symbol, note?, holdingPrice?, holdingShares?, targetPrice?, stopLoss? }", cost: "写库" },
      { method: "PATCH", path: "/api/watchlist/items/[id]", description: "编辑备注、持仓、目标价、止损价、周期、风险等级。", cost: "写库" },
      { method: "DELETE", path: "/api/watchlist/items/[id]", description: "删除自选股。", cost: "写库" },
      { method: "GET", path: "/api/trades", description: "读取资金流水，支持 limit=all 查看全部历史。", notes: "?limit=all", cost: "只读" },
      { method: "POST", path: "/api/trades", description: "补录买入或卖出，并按流水重算持仓、现金和已实现盈亏。", body: "{ symbol, side, price, shares, executedAt?, note? }", cost: "写库" },
      { method: "DELETE", path: "/api/trades?id=[executionId]", description: "删除一条资金流水并重算持仓。", cost: "写库" }
    ]
  },
  {
    title: "股票行情与 AI 分析",
    icon: <Activity className="h-4 w-4" />,
    description: "行情读取、K 线、指标和单股 AI 分析任务。",
    endpoints: [
      { method: "GET", path: "/api/stocks/[symbol]/quote", description: "读取当前报价。", cost: "只读" },
      { method: "GET", path: "/api/stocks/[symbol]/history", description: "读取历史 K 线，支持 range 和 interval。", notes: "?range=1y&interval=1d", cost: "只读" },
      { method: "GET", path: "/api/research-export", description: "列出或下载 ChatGPT 研究包。", notes: "?file=归档文件名", cost: "只读" },
      { method: "POST", path: "/api/research-export", description: "生成 ChatGPT Markdown / JSON 研究包。", body: "{ symbols, range, interval, newsDays, includeForecast }", cost: "AI" },
      { method: "GET", path: "/api/strategy-backtest", description: "读取策略回测可选标的和默认参数。", cost: "只读" },
      { method: "POST", path: "/api/strategy-backtest", description: "运行日线策略回测。", body: "{ symbols, range, initialCapital }", cost: "只读" },
      { method: "GET", path: "/api/stocks/[symbol]/indicators", description: "读取技术指标。", cost: "只读" },
      { method: "GET", path: "/api/stocks/[symbol]/analysis/latest", description: "读取最近一次 AI 分析。", cost: "只读" },
      { method: "POST", path: "/api/stocks/[symbol]/analyze", description: "创建或复用股票分析任务。", body: "{ forceRefresh?: boolean }", cost: "入队" }
    ]
  },
  {
    title: "新闻与行业情报",
    icon: <Newspaper className="h-4 w-4" />,
    description: "新闻抓取、AI 精读和行业关注项。",
    endpoints: [
      { method: "GET", path: "/api/news", description: "按 symbol、关键词、重要性查询新闻。", notes: "?symbol=561380.SH&includeLow=1", cost: "只读" },
      { method: "POST", path: "/api/news/fetch", description: "抓取相关新闻并按重要性入库，高重要新闻会入队精读。", cost: "入队" },
      { method: "POST", path: "/api/news/[id]/analyze", description: "为单条新闻创建 AI 精读任务。", cost: "入队" },
      { method: "GET", path: "/api/sectors/watch", description: "读取行业关注项。", cost: "只读" },
      { method: "POST", path: "/api/sectors/watch", description: "新增行业关注项和关键词。", body: "{ sectorName, keywords }", cost: "写库" }
    ]
  },
  {
    title: "关注板块与策略观察",
    icon: <Crosshair className="h-4 w-4" />,
    description: "今日关注、定时分析、定时策略观察和手动刷新。",
    endpoints: [
      { method: "GET", path: "/api/focus", description: "读取今日关注配置。", cost: "只读" },
      { method: "PUT", path: "/api/focus", description: "保存关注股票、总本金、新闻抓取时间、AI 分析时间。", cost: "写库" },
      { method: "GET", path: "/api/focus/decision", description: "读取最近一次已保存的策略观察。", cost: "只读" },
      { method: "POST", path: "/api/focus/decision", description: "手动强制生成并保存策略观察。", cost: "AI" }
    ]
  },
  {
    title: "提醒、任务与简报",
    icon: <Clock3 className="h-4 w-4" />,
    description: "价格提醒、后台任务状态和每日市场简报。",
    endpoints: [
      { method: "GET", path: "/api/alerts", description: "读取提醒规则并评估触发状态。", cost: "只读" },
      { method: "POST", path: "/api/alerts", description: "创建提醒规则。", body: "{ symbol, field, operator, threshold }", cost: "写库" },
      { method: "GET", path: "/api/jobs/[id]", description: "查询后台任务状态。", cost: "只读" },
      { method: "GET", path: "/api/briefs/daily", description: "读取今日市场简报。", cost: "只读" },
      { method: "POST", path: "/api/briefs/daily/generate", description: "生成或刷新每日市场简报。", cost: "AI" }
    ]
  },
  {
    title: "AI 设置、聊天与记忆",
    icon: <Bot className="h-4 w-4" />,
    description: "AI 连接测试、流式聊天和长期记忆管理。",
    endpoints: [
      { method: "GET", path: "/api/settings/ai", description: "读取 AI baseUrl、模型和脱敏密钥状态。", cost: "只读" },
      { method: "PUT", path: "/api/settings/ai", description: "保存 AI 地址、模型和密钥。", cost: "写库" },
      { method: "POST", path: "/api/settings/ai", description: "真实调用 AI 接口做连接测试。", cost: "AI" },
      { method: "POST", path: "/api/chat", description: "流式 AI 投资助手，对明确记忆指令会写入记忆。", body: "{ message }", cost: "AI" },
      { method: "GET", path: "/api/memory", description: "读取手动记忆和自动记忆。", cost: "只读" },
      { method: "POST", path: "/api/memory", description: "新增手动记忆。", body: "{ text }", cost: "写库" },
      { method: "PUT", path: "/api/memory", description: "替换记忆原文。", cost: "写库" },
      { method: "DELETE", path: "/api/memory?id=[entryId]", description: "删除单条记忆。", cost: "写库" }
    ]
  },
  {
    title: "系统",
    icon: <Server className="h-4 w-4" />,
    description: "服务健康、数据库、关键配置和后台 worker 状态。",
    endpoints: [
      { method: "GET", path: "/api/health", description: "健康检查，不返回任何密钥。", auth: "公开", cost: "只读" },
      { method: "GET", path: "/api/usage", description: "读取 AI、行情、新闻和联网检索的本地用量统计与剩余额度。", cost: "只读" }
    ]
  }
];

const principles = [
  "所有业务接口默认需要登录，依赖 HttpOnly Cookie，不需要在前端手动传 token。",
  "写库、入队、AI 类型接口可能改变数据或消耗额度；只读接口不会主动触发 AI。",
  "页面只展示脱敏状态，不展示 API key、密码、session 内容。",
  "股票分析、新闻精读、策略观察均通过后台队列或显式按钮触发，避免打开页面就消耗 AI。"
];

export default function ApiDocsPage() {
  const endpoints = apiGroups.flatMap((group) => group.endpoints);
  const endpointCount = endpoints.length;
  const aiCount = endpoints.filter((endpoint) => endpoint.cost === "AI").length;
  const writeCount = endpoints.filter((endpoint) => endpoint.cost === "写库").length;
  const publicCount = endpoints.filter((endpoint) => endpoint.auth === "公开").length;

  return (
    <PageContainer className="max-w-[90rem]">
      <SectionHeader title="API 与系统状态" />

      <div className="grid gap-2 md:grid-cols-4">
        <Metric label="接口总数" value={endpointCount} />
        <Metric label="AI 消耗" value={aiCount} tone="danger" />
        <Metric label="写库接口" value={writeCount} tone="warning" />
        <Metric label="公开接口" value={publicCount} tone="success" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)] xl:items-start">
        <div className="space-y-4 xl:sticky xl:top-20">
          <ApiHealthPanel />
          <ApiUsagePanel />

          <Card className="performance-card overflow-hidden">
            <CardHeader className="border-b border-border/60 bg-background/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  调用规则
                </CardTitle>
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">安全边界</span>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 p-4">
              {principles.map((item, index) => (
                <div key={item} className="glow-card grid gap-2 rounded-lg border border-border bg-muted/15 px-3 py-2 text-sm leading-6 text-muted-foreground sm:grid-cols-[1.5rem_minmax(0,1fr)]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                  <span>{item}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="performance-card overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 bg-background/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>接口目录</CardTitle>
              <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{apiGroups.length} 个模块</span>
            </div>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{endpointCount} 个接口</span>
          </CardHeader>
          <CardContent className="grid gap-3 p-3 sm:p-4">
            {apiGroups.map((group) => (
              <ApiGroupSection key={group.title} group={group} />
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function ApiGroupSection({ group }: { group: { title: string; icon: ReactNode; description: string; endpoints: Endpoint[] } }) {
  return (
    <section className="glow-card rounded-xl border border-border bg-background/35 p-3">
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">{group.icon}</div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <div className="mt-1 text-xs text-muted-foreground">{group.endpoints.length} 个接口</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{group.description}</p>
        </div>
        <div className="grid gap-2">
          {group.endpoints.map((endpoint) => (
            <EndpointRow key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  return (
    <div className="glow-card rounded-lg border border-border/80 bg-card/65 px-3 py-2">
      <div className="grid gap-2 xl:grid-cols-[minmax(190px,0.82fr)_minmax(0,1fr)_auto] xl:items-start">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={methodVariant(endpoint.method)}>{endpoint.method}</Badge>
          <code className="min-w-0 break-all text-xs text-foreground sm:text-sm">{endpoint.path}</code>
        </div>
        <p className="min-w-0 text-sm leading-6 text-muted-foreground">{endpoint.description}</p>
        <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
          <Badge variant={endpoint.auth === "公开" ? "outline" : "secondary"}>{endpoint.auth ?? "登录"}</Badge>
          {endpoint.cost ? <Badge variant={costVariant(endpoint.cost)}>{endpoint.cost}</Badge> : null}
        </div>
      </div>
      {endpoint.body || endpoint.notes ? (
        <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
          {endpoint.body ? (
            <div className="rounded border border-border bg-muted/20 px-2 py-1.5">
              <span className="text-muted-foreground">Body </span>
              <code>{endpoint.body}</code>
            </div>
          ) : null}
          {endpoint.notes ? (
            <div className="rounded border border-border bg-muted/20 px-2 py-1.5">
              <span className="text-muted-foreground">参数 </span>
              <code>{endpoint.notes}</code>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "success" | "warning" | "danger" | "neutral" }) {
  const toneClass = {
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
    neutral: "text-foreground"
  }[tone];

  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function methodVariant(method: Endpoint["method"]) {
  if (method === "GET") return "secondary";
  if (method === "DELETE") return "danger";
  if (method === "PATCH" || method === "PUT") return "warning";
  return "default";
}

function costVariant(cost: NonNullable<Endpoint["cost"]>) {
  if (cost === "AI") return "danger";
  if (cost === "入队") return "warning";
  if (cost === "写库") return "default";
  return "secondary";
}
