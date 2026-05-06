import type { ReactNode } from "react";
import { Activity, KeyRound, Server, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const apiGroups = [
  {
    title: "认证",
    endpoints: [
      ["POST", "/api/auth/login", "管理员登录，写入 HttpOnly session cookie"],
      ["POST", "/api/auth/logout", "退出登录，清除 session cookie"],
      ["GET", "/api/auth/session", "查看当前登录状态"]
    ]
  },
  {
    title: "看板与批量接口",
    endpoints: [
      ["GET", "/api/dashboard", "看板聚合数据，只读缓存和数据库，不触发 AI"],
      ["POST", "/api/quotes/batch", "批量读取报价，最多 50 个 symbol"],
      ["POST", "/api/analysis/latest/batch", "批量读取最近 AI 分析，不触发 AI"],
      ["POST", "/api/news/batch", "批量读取缓存新闻，不触发 AI"]
    ]
  },
  {
    title: "自选股",
    endpoints: [
      ["GET", "/api/watchlist", "读取当前用户自选股"],
      ["POST", "/api/watchlist/items", "添加自选股"],
      ["DELETE", "/api/watchlist/items/[id]", "删除自选股"]
    ]
  },
  {
    title: "股票行情与分析",
    endpoints: [
      ["GET", "/api/stocks/[symbol]/quote", "获取当前报价"],
      ["GET", "/api/stocks/[symbol]/history", "获取历史 K 线"],
      ["GET", "/api/stocks/[symbol]/indicators", "获取技术指标"],
      ["GET", "/api/stocks/[symbol]/analysis/latest", "获取最近一次 AI 分析"],
      ["POST", "/api/stocks/[symbol]/analyze", "创建或复用股票分析任务"]
    ]
  },
  {
    title: "新闻与行业",
    endpoints: [
      ["GET", "/api/news", "按股票、行业、关键词查询新闻"],
      ["POST", "/api/news/fetch", "抓取自选股和行业相关新闻"],
      ["POST", "/api/news/[id]/analyze", "创建单条新闻 AI 分析任务"],
      ["GET", "/api/sectors/watch", "读取行业关注项"],
      ["POST", "/api/sectors/watch", "新增行业关注项"]
    ]
  },
  {
    title: "提醒、任务与简报",
    endpoints: [
      ["GET", "/api/alerts", "获取提醒规则并评估触发状态"],
      ["POST", "/api/alerts", "创建提醒规则"],
      ["GET", "/api/jobs/[id]", "查询后台任务状态"],
      ["GET", "/api/briefs/daily", "读取今日市场简报"],
      ["POST", "/api/briefs/daily/generate", "生成每日市场简报"]
    ]
  },
  {
    title: "系统",
    endpoints: [["GET", "/api/health", "查看服务、数据库和关键配置状态，不显示密钥"]]
  }
];

const missingApis = [
  "PATCH /api/watchlist/items/[id]：编辑备注、持仓成本、目标价、止损价、周期和风险等级",
  "PATCH /api/alerts/[id]：修改提醒阈值或启停规则",
  "DELETE /api/alerts/[id]：删除提醒规则",
  "GET /api/jobs：查看任务列表和失败任务"
];

export default function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-primary">
          <Server className="h-5 w-5" />
          <span className="text-sm">接口中心</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">API 与系统状态</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">这里列出当前网站已实现的服务端接口。所有业务接口默认需要登录；页面不会展示任何 API key。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard icon={<ShieldCheck className="h-4 w-4" />} title="认证模式" value="Env 管理员账号 + HttpOnly Cookie" />
        <StatusCard icon={<KeyRound className="h-4 w-4" />} title="AI 模型" value={process.env.OPENAI_MODEL || "deepseek-v4-pro"} />
        <StatusCard icon={<Activity className="h-4 w-4" />} title="任务队列" value="PostgreSQL 轻量队列，并发 1" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {apiGroups.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>当前已实现接口</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.endpoints.map(([method, path, description]) => (
                <div key={`${method}-${path}`} className="rounded-md border bg-secondary/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{method}</Badge>
                    <code className="text-sm text-foreground">{path}</code>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{description}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>后续建议补充</CardTitle>
          <CardDescription>这些不是当前 MVP 必须项，但会提升后台管理体验。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {missingApis.map((item) => (
            <div key={item} className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="mt-1 text-sm font-medium">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
