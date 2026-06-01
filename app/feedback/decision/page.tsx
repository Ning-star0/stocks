import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/layout";
import { Textarea } from "@/components/ui/textarea";
import { feedbackActionLabel, normalizeFeedbackAction, verifyDecisionFeedbackToken } from "@/lib/decisionFeedback";
import { prisma } from "@/lib/prisma";

type SearchParams = {
  decisionId?: string;
  token?: string;
  action?: string;
  saved?: string;
};

export default async function DecisionFeedbackPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const query = (await searchParams) ?? {};
  const decisionId = String(query.decisionId ?? "");
  const token = String(query.token ?? "");
  const action = normalizeFeedbackAction(query.action);
  const saved = query.saved === "1";
  const decision = decisionId
    ? await prisma.focusDecision.findUnique({
        where: { id: decisionId },
        include: { feedback: true }
      })
    : null;

  if (!decision || !verifyDecisionFeedbackToken({ userId: decision.userId, decisionId: decision.id, token })) {
    return (
      <PageContainer className="max-w-2xl">
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>反馈链接无效</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">这条反馈链接不存在、已失效，或签名不正确。请从最新推送重新进入。</p>
            <Button asChild variant="outline">
              <Link href="/focus">返回今日工作台</Link>
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const currentAction = normalizeFeedbackAction(decision.feedback?.feedbackAction ?? action);
  const json = asRecord(decision.decisionJson);
  const summary = String(json.summary ?? "暂无摘要。");
  const orders = [...normalizeOrders(json.orders, "买入/增持"), ...normalizeOrders(json.sellOrders, "卖出/减仓")].slice(0, 4);

  return (
    <PageContainer className="max-w-2xl">
      <Card className="soft-card">
        <CardHeader>
          <CardTitle>反馈你的最终决策</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">记录你是否采纳了这次 AI 策略观察，后续可以用来复盘“系统建议”和“真实操作”的差异。</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {saved ? (
            <div className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
              已保存反馈：{feedbackActionLabel(currentAction)}
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-background/35 p-4">
            <div className="text-xs text-muted-foreground">AI 策略观察摘要</div>
            <p className="mt-2 text-sm leading-6">{summary}</p>
            {orders.length ? (
              <div className="mt-4 space-y-2">
                {orders.map((order) => (
                  <div key={`${order.type}-${order.symbol}`} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                    <span className="font-medium">{order.type}</span>
                    <span className="ml-2">{order.name || order.symbol}</span>
                    <span className="ml-2 tabular-nums text-muted-foreground">{formatMoney(order.amount)} / {order.shares || 0} 股份</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <form method="post" action="/api/decision-feedback" className="space-y-4">
            <input type="hidden" name="decisionId" value={decision.id} />
            <input type="hidden" name="token" value={token} />
            <div className="grid gap-2 sm:grid-cols-2">
              <FeedbackOption value="bought" label="已买入/增持" current={currentAction} />
              <FeedbackOption value="sold" label="已卖出/减仓" current={currentAction} />
              <FeedbackOption value="watched" label="继续观察" current={currentAction} />
              <FeedbackOption value="skipped" label="未采纳/暂不操作" current={currentAction} />
              <FeedbackOption value="other" label="其他决策" current={currentAction} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="block text-sm font-medium">实际成交价，可选</span>
                <Input name="executedPrice" inputMode="decimal" placeholder="例如 2.16" defaultValue={decimalToString(decision.feedback?.executedPrice)} />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium">实际数量，可选</span>
                <Input name="executedShares" inputMode="decimal" placeholder="例如 200" defaultValue={decimalToString(decision.feedback?.executedShares)} />
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium">备注，可选</span>
              <Textarea name="note" placeholder="例如：价格没到，没有买；或实际买入 200 份。" defaultValue={decision.feedback?.note ?? ""} />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit">保存反馈</Button>
              <Button asChild variant="outline">
                <Link href="/focus">回到今日工作台</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function FeedbackOption({ value, label, current }: { value: string; label: string; current: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background/40 px-3 py-2 text-sm transition-colors hover:border-primary/30">
      <input type="radio" name="feedbackAction" value={value} defaultChecked={current === value} className="h-4 w-4 accent-primary" />
      {label}
    </label>
  );
}

function normalizeOrders(value: unknown, type: string) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((order) => ({
    type,
    symbol: String(order.symbol ?? ""),
    name: typeof order.name === "string" ? order.name : "",
    amount: Number(order.amount ?? 0),
    shares: Number(order.shares ?? 0)
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function decimalToString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function formatMoney(value?: number | null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `¥${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}
