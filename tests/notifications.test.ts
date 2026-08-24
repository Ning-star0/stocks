import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFocusDecisionMessage,
  notifyFocusDecision,
  type DecisionOrder,
  type FocusDecisionNotificationInput
} from "@/lib/notifications/send";

test("scheduled decisions without executable orders stay silent", async () => {
  const input = {
    userId: "test-user",
    source: "scheduled",
    nearMisses: [{ symbol: "515880.SH", score: 81, threshold: 82 }]
  } as FocusDecisionNotificationInput & { nearMisses: Array<{ symbol: string; score: number; threshold: number }> };

  assert.deepEqual(await notifyFocusDecision(input), { skipped: true, reason: "no_orders" });
});

test("trade push only lists what to buy and sell, quantities, and estimated amounts", () => {
  const buys: DecisionOrder[] = [{
    symbol: "515880.SH",
    name: "通信ETF",
    action: "buy",
    shares: 100,
    amount: 126.5,
    estimatedFee: 5
  }];
  const sells: DecisionOrder[] = [{
    symbol: "159937.SZ",
    name: "黄金ETF",
    action: "sell",
    shares: 200,
    netProceeds: 978.4
  }];

  const message = buildFocusDecisionMessage({
    userId: "test-user",
    source: "scheduled",
    generatedAt: "2026-08-11T06:30:00.000Z",
    summary: "这段详细分析不应出现在简化手机推送中。"
  }, buys, sells);

  assert.equal(message.title, "交易建议：买入 + 卖出");
  assert.match(message.markdown, /卖出 黄金ETF\(159937\.SZ\)：200 股\/份，预计收回 ¥978\.4/);
  assert.match(message.markdown, /买入 通信ETF\(515880\.SH\)：100 股\/份，预计使用 ¥131\.5/);
  assert.doesNotMatch(message.markdown, /详细分析|手续费|现金|接近触发|反馈/);
});
