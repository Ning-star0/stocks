import type { DecisionInput } from "@/lib/focus/decisionTypes";
import { TRADING_FEE_RULE } from "@/lib/focus/trading";

export const FOCUS_DECISION_SYSTEM_PROMPT =
  "你是一个谨慎的股票组合策略观察助手。你必须基于给定候选股票、最新单股分析、价格、持仓状态和手续费规则，生成今日策略观察、候选排序、条件触发型买入计划和卖出/减仓计划。策略框架参考成熟量化系统的做法：先用趋势过滤确认大方向，再用 RSI/MACD/均线/关键价位确认动量和风险，最后用止损、止盈、仓位和手续费约束控制执行。不能保证收益，不能编造数据，不能把观察计划写成确定性指令。输出必须是严格 JSON，所有自然语言字段使用简体中文。";

export function buildDecisionPrompt(input: DecisionInput) {
  return `请基于今日关注股票生成“今日 AI 策略观察”。返回严格 JSON，不要 Markdown。

账户资金：
- 投入本金：${input.capital} 元
- 已持仓占用成本（按持仓成本价 + 估算买入手续费）：${input.investedCost} 元
- 当前可用现金：${input.availableCash} 元
- 当前持仓市值：${input.currentMarketValue} 元
- 持仓浮盈浮亏：${input.unrealizedPnl} 元
- 已实现盈亏：${input.realizedPnl} 元
- 当前总资产估算（现金 + 持仓市值）：${input.totalAssets} 元

交易手续费规则：
${JSON.stringify(TRADING_FEE_RULE, null, 2)}

本次决策数据截止：
${JSON.stringify(input.dataScope, null, 2)}

市场/行业动态上下文：
${JSON.stringify(input.marketContext, null, 2)}

决策要求：
1. 必须明确 recommendedAction，只能是 buy、sell、mixed 或 wait。buy 表示只有买入/增持计划；sell 表示只有卖出/减仓计划；mixed 表示同时有买入和卖出/减仓计划；wait 表示今日只观察。
2. 每个候选都有 isHolding、holdingPrice、holdingShares。isHolding=true 表示用户已经持仓，买入只能代表“增持/加仓”，卖出只能代表“减仓/止盈/止损/离场”；isHolding=false 不能生成 sellOrders。
3. 未持仓股票必须主要依据 entryAdvice 判断。若 entryAdvice 是“条件入场、小仓试探、分批观察、触发后建仓”，且价格、风险和手续费性价比合理，可以生成 buy；若 entryAdvice 明确等待、不建议入场、回避、观望，则不能买。
4. 已持仓股票必须主要依据 holdAdvice 判断。若 holdAdvice 出现“减仓、止损、离场、回避、跌破止损、趋势转弱、止盈、分批兑现”，必须在 sellOrders 中给出减仓或卖出计划；若 holdAdvice 明确“继续持有、逢低加仓、增持”，才允许保留或生成增持计划。
5. 先判断“市场/行业动态上下文”，再判断单股/ETF。marketContext 是系统根据今日候选、新闻情绪、行业线索和走势生成的动态策略环境：risk_on 可以降低买入阈值并允许小仓试探；risk_off 必须提高买入阈值、降低减仓阈值、控制仓位；sectorBias=overheated 时不能追高，只能等待回调或突破确认。
6. 使用“市场/行业上下文 + 趋势过滤 + 动量确认 + 风险边界 + 风险收益比 + 仓位控制”的策略框架：趋势偏多且 RSI 未明显过热、MACD/均线未恶化、价格靠近支撑或入场区间、riskRewardRatio 不差时，才考虑小仓买入；趋势转弱、跌破支撑/止损、RSI 过热后放量回落、MACD 死叉、riskRewardRatio 偏低或达到目标压力位时，优先考虑减仓/止盈/止损。
7. 每个候选都带有 quantSignal，这是本地量化规则结合市场/行业上下文计算出的硬约束和仓位建议。quantSignal.action=buy/add 才能进入 orders；quantSignal.action=sell/reduce 才能进入 sellOrders；quantSignal.action=avoid/watch/hold 通常只排序观察，除非单股分析给出更强且合理的相反证据。
8. quantSignal 中的 buyScore、sellScore、riskScore、riskRewardRatio、stopDistancePct、takeProfitDistancePct、holdingReturnPct、adjustedBuyThreshold、adjustedReduceThreshold、adjustedSellThreshold、marketRegime、sectorBias、newPositionProtection、suggestedBuyCapitalPct、suggestedSellRatioPct、suggestedSellShares、exitPlan 必须进入 reasoning。不要只写“等待”，必须说明分数、动态阈值或触发条件。
9. newPositionProtection=true 表示新建仓保护期内。除非已经触发硬止损、严重利空或卖出分达到强制卖出级别，否则不要直接卖出刚买入的仓位，只能写继续观察、移动止损或不加仓。
10. quoteTime 必须是当日或最新可交易数据，status 不能是 stale/unavailable/error。行情不新鲜、报价失败或 K 线截止早于其他候选时，不能进入 orders 或 sellOrders，只能写入 ranking 的风险原因。
11. orders 只放买入/增持计划，最多 2 笔；orders.action 只能用 buy 或 add，未持仓新买入用 buy，已持仓增持用 add。sellOrders 只放卖出/减仓计划，最多 3 笔。每笔必须写清 symbol、amount、shares、reason、riskControl、invalidIf。
12. 每笔 orders 必须尽量返回 planType、triggerPrice、stopLossPrice、takeProfitPrice、maxLossAmount、riskRewardRatio、priority、entryCondition、executionWindow、positionImpact。planType 只能是 pullback、breakout、support、trend_follow、add_on_strength、risk_rebalance；triggerPrice 是实际触发观察价；stopLossPrice 是交易失效/止损价；takeProfitPrice 是首个止盈或压力目标；maxLossAmount 是按 shares * max(0, triggerPrice - stopLossPrice) 估算的单笔最大价格风险，不含手续费；priority 1 最高、5 最低；entryCondition 写明什么价格/量能/指标组合才执行；executionWindow 写明适合盘中、收盘确认、次日观察或分批执行；positionImpact 写明买入后预计现金、仓位或单笔风险变化。
13. 每笔 sellOrders 必须尽量返回 triggerPrice、stopLossPrice、takeProfitPrice、sellRatioPct、priority、exitCondition、executionWindow、positionImpact。sellRatioPct 必须与 shares / holdingShares 大致一致；触发止损/风控时 priority 应为 1-2，普通止盈减仓可为 2-4；exitCondition 写明什么价格/指标恶化或止盈条件触发卖出；positionImpact 写明卖出后剩余持仓、回收现金、风险释放或止盈/止损目的。
14. amount 是计划成交金额，不含手续费；买入 shares 必须按 100 股/份整数手计算，买入总成本（amount + 手续费）不能超过“当前可用现金”，不能把已持仓占用成本再次当成现金使用。卖出 shares 也必须按 100 股/份整数手计算，不能返回 1-99 股/份的卖出计划；卖出 shares 不能超过 holdingShares，优先参考 quantSignal.suggestedSellShares。如果持仓不足 100 股/份，不允许生成 sellOrders，只能写移动止盈/继续观察；如果只持有 100 股/份但触发减仓，sellOrders 实际就是卖出 100 股/份。
15. 手续费按 max(amount, 10000) * 0.0005 计算。不足 10000 元的交易也要按 10000 元计费，即最低手续费 5 元；如果因为金额太小导致手续费占比不划算，应建议等待或合并交易。
16. 不要机械保守。如果候选趋势偏多、置信度不低、价格接近入场区间且风险控制清晰，可以给出小仓条件触发型计划；如果持仓风险已触发，不能只写观察，必须在 sellOrders 写明卖出/减仓数量、比例和触发依据。
17. 不要机械平均分配资金，要按 quantSignal.buyScore、quantSignal.sellScore、趋势、置信度、风险、持仓状态、已有持仓计划、浮盈亏、riskRewardRatio、marketRegime、sectorBias 和手续费性价比排序。
18. ranking 必须覆盖所有候选，并在 reason 里体现“市场/行业上下文 + 量化信号 + 已持仓/未持仓 + 持仓建议/入场建议/退出建议 + 卖出或减仓比例”。
19. JSON 示例中的枚举字段只能返回一个合法值，例如 recommendedAction 只能返回 "buy"、"sell"、"mixed" 或 "wait" 其中之一，orders.action 只能返回 "buy" 或 "add"，sellOrders.action 只能返回 "sell" 或 "reduce"，不能返回说明文字。

候选股票：
${JSON.stringify(input.candidates, null, 2)}

请只返回这个 JSON 结构：
{
  "summary": "",
  "recommendedAction": "wait",
  "totalBudgetToUse": 0,
  "cashReserve": 0,
  "orders": [
    {
      "symbol": "",
      "action": "buy",
      "amount": 0,
      "shares": 0,
      "planType": "pullback",
      "triggerPrice": 0,
      "stopLossPrice": 0,
      "takeProfitPrice": 0,
      "maxLossAmount": 0,
      "riskRewardRatio": 0,
      "priority": 1,
      "entryCondition": "",
      "executionWindow": "",
      "positionImpact": "",
      "reason": "",
      "riskControl": "",
      "invalidIf": ""
    }
  ],
  "sellOrders": [
    {
      "symbol": "",
      "action": "reduce",
      "amount": 0,
      "shares": 0,
      "triggerPrice": 0,
      "stopLossPrice": 0,
      "takeProfitPrice": 0,
      "sellRatioPct": 0,
      "priority": 1,
      "exitCondition": "",
      "executionWindow": "",
      "positionImpact": "",
      "reason": "",
      "riskControl": "",
      "invalidIf": ""
    }
  ],
  "ranking": [
    { "symbol": "", "rank": 1, "view": "优先/观察/回避", "reason": "" }
  ],
  "disclaimer": "本内容由 AI 生成，仅供研究参考，不构成投资建议。"
}`;
}
