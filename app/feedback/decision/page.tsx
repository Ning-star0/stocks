import Link from "next/link";

import { DecisionFeedbackForm } from "@/app/feedback/decision/DecisionFeedbackForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/layout";
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
  const tradeOptions = [...normalizeOrders(json.orders, "买入/增持", "buy"), ...normalizeOrders(json.sellOrders, "卖出/减仓", "sell")];
  const orders = tradeOptions.slice(0, 4);
  const hasSyncedTradeFeedback = Boolean(decision.feedback?.positionSyncedAt && decision.feedback.tradeSymbol && decision.feedback.tradeSide);
  const shouldSyncCurrentAction = currentAction === "bought" || currentAction === "sold";
  const selectedTrade = hasSyncedTradeFeedback && decision.feedback?.tradeSymbol && decision.feedback.tradeSide
    ? `${decision.feedback.tradeSide}:${decision.feedback.tradeSymbol}`
    : shouldSyncCurrentAction
      ? defaultTradeKey(tradeOptions, currentAction)
      : "";
  const selectedOrder = tradeOptions.find((order) => `${order.side}:${order.symbol}` === selectedTrade) ?? tradeOptions[0] ?? null;
  const initialExecutedPrice = hasSyncedTradeFeedback
    ? decimalToString(decision.feedback?.executedPrice)
    : shouldSyncCurrentAction
      ? decimalToString(selectedOrder?.triggerPrice ?? selectedOrder?.price)
      : "";
  const initialExecutedShares = hasSyncedTradeFeedback
    ? decimalToString(decision.feedback?.executedShares)
    : shouldSyncCurrentAction
      ? decimalToString(selectedOrder?.shares)
      : "";

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
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>触发 {formatPrice(order.triggerPrice ?? order.price)}</span>
                      <span>止损 {formatPrice(order.stopLossPrice)}</span>
                      <span>止盈 {formatPrice(order.takeProfitPrice)}</span>
                      {order.priority ? <span>优先级 P{order.priority}</span> : null}
                      {order.sellRatioPct ? <span>卖出比例 {formatPercent(order.sellRatioPct)}</span> : null}
                    </div>
                    <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      {order.condition ? <p>{order.side === "buy" ? "触发条件" : "退出条件"}：{order.condition}</p> : null}
                      {order.executionWindow ? <p>执行窗口：{order.executionWindow}</p> : null}
                      {order.positionImpact ? <p>仓位影响：{order.positionImpact}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <DecisionFeedbackForm
            decisionId={decision.id}
            token={token}
            currentAction={currentAction}
            feedbackNote={decision.feedback?.note}
            tradeOptions={tradeOptions}
            initialTradeKey={selectedTrade}
            initialExecutedPrice={initialExecutedPrice}
            initialExecutedShares={initialExecutedShares}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function normalizeOrders(value: unknown, type: string, side: "buy" | "sell") {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((order) => ({
    type,
    side,
    symbol: String(order.symbol ?? ""),
    name: typeof order.name === "string" ? order.name : "",
    amount: Number(order.amount ?? 0),
    shares: Number(order.shares ?? 0),
    price: nullableNumber(order.estimatedPrice),
    triggerPrice: nullableNumber(order.triggerPrice),
    stopLossPrice: nullableNumber(order.stopLossPrice),
    takeProfitPrice: nullableNumber(order.takeProfitPrice),
    sellRatioPct: nullableNumber(order.sellRatioPct),
    priority: nullableNumber(order.priority),
    condition: stringValue(side === "buy" ? order.entryCondition : order.exitCondition),
    executionWindow: stringValue(order.executionWindow),
    positionImpact: stringValue(order.positionImpact)
  }));
}

function defaultTradeKey(orders: Array<{ side: "buy" | "sell"; symbol: string }>, action: string) {
  const side = action === "bought" ? "buy" : action === "sold" ? "sell" : null;
  if (!side) return "";
  const order = orders.find((item) => item.side === side);
  return order ? `${order.side}:${order.symbol}` : "";
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

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatPrice(value?: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "--" : String(value);
}

function formatPercent(value?: number | null) {
  return value === null || value === undefined || !Number.isFinite(value) ? "--" : `${value.toFixed(0)}%`;
}

function formatMoney(value?: number | null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `¥${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}
