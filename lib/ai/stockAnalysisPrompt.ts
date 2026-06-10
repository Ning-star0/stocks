import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";

export const STOCK_ANALYSIS_SYSTEM_PROMPT =
  "你是一个谨慎但不过度保守的股票策略观察助手。你只能基于用户提供的数据给出条件触发型交易情景，不能声称能预测市场，不能保证收益，不能给出确定性买卖指令。你的核心任务是为用户回答两个问题：1）如果已持仓，现在该怎么办？2）如果尚未持仓，当前是否已经满足小仓试探/分批入场条件，还是必须等待回调？你需要从趋势、动量、成交量、风险、关键价位、用户持仓、相关新闻和宏观/行业风险角度综合判断。若趋势、价位、量能和风险控制同时支持，不要机械写“等待回调”，应给出“条件入场/小仓试探/分批观察”的具体触发条件、价格区间和仓位；若短线超买、价格远离支撑或风险回报不佳，才写等待或回避。无论新闻原文是英文、繁体中文或其他语言，所有自然语言分析字段必须使用简体中文。输出必须是严格 JSON，不要输出 Markdown，不要编造新闻链接。";

export function buildUserPrompt(input: AnalyzeStockInput) {
  const positionStatus = describePositionStatus(input.userContext);
  return `请分析以下股票数据，并给出投资建议。返回必须能被 JSON.parse 解析的严格 JSON 对象。

重要要求：
1. summary 是简短摘要（80字内），概括当前局面的核心矛盾：机会是什么，风险是什么。
2. 不能给出确定性买卖指令，不能承诺收益，必须使用「若...则考虑.../观察.../等待...」的表述方式。
3. 新闻链接只能来自 recentNews，不允许编造 URL。
4. recentNews 只包含已经由新闻 AI 精读过的摘要；没有出现在 recentNews 的原始新闻不要作为结论依据。
5. 如果 recentNews 为空，请明确说明“暂无已精读相关新闻”，不要编造新闻主线。
6. newsSummary 必须综合 recentNews 的共同主线，控制在 120 字以内，不要逐条复述。
7. 对 ETF、行业主题和指数基金，要优先分析行业催化：政策、采购、招标、中标、订单、投资、产业链景气度。不要把”ETF 涨跌、净值变化、成交额”当成核心催化。
8. catalystEvents、sectorRisks、macroRisks 必须结合新闻和技术指标一起判断；如果新闻只是候选结果，要说明不确定性。
9. 所有自然语言分析字段必须使用简体中文。新闻标题、来源和 URL 可以保留原文。
10. holdAdvice 和 entryAdvice 是本报告的核心。holdAdvice 回答”如果已持仓，现在该怎么办”；entryAdvice 回答”如果尚未持仓，应该在什么点位、什么时机考虑入场”。每个字段都必须具体、可执行，不能写空话。必须使用”若...则考虑...”的谨慎语气。
11. 如果用户提供了交易手续费规则，entryAdvice.firstPositionSize 必须结合手续费和最小计费金额，不要建议过小金额的交易；A 股/ETF 买入数量按 100 股/份取整。
12. possibleActions 保留作为补充计划，沿用原有格式，至少 2 个场景。
13. 系统会根据用户持仓信息自动展示主建议：若“系统自动持仓判断”为已持仓，holdAdvice 必须作为主建议，重点说明持有、减仓或增持条件；若为未持仓，entryAdvice 必须作为主建议，重点说明是否买入、买多少和等待条件。
14. 输出只能使用英文双引号，不能使用中文弯引号；数组元素之间必须有逗号；不要输出注释、Markdown 或额外说明。
15. JSON 示例中的枚举字段只能返回一个合法值，例如 trend 只能返回 "bullish"、"neutral" 或 "bearish" 其中之一，不能返回 "bullish | neutral | bearish" 这种说明文字。
16. 不要因为“谨慎语气”就默认等待。若价格靠近支撑、趋势偏多、MACD/均线/成交量没有明显恶化且风险收益比合理，entryAdvice.action 应表达为“条件入场观察”或“小仓试探条件”，并写清触发条件。只有价格明显追高、短线超买、跌破关键支撑、新闻/基本面不确定性很高时，才使用“等待回调”或“回避”。

股票代码：
${input.symbol}

分析生成时间：
${input.analysisAsOf ?? new Date().toISOString()}

数据覆盖范围：
${JSON.stringify(input.dataScope ?? {}, null, 2)}

当前报价：
${JSON.stringify(input.quote, null, 2)}

技术指标：
${JSON.stringify(input.indicators, null, 2)}

历史价格摘要：
${JSON.stringify(input.historySummary, null, 2)}

用户持仓和风险上下文：
${JSON.stringify(input.userContext, null, 2)}

系统自动持仓判断：
${positionStatus}

用户的交易记忆（交易习惯、偏好、历史总结等）：
${input.userMemory || "暂无记录"}

用户的可用本金：
${input.userCapital ? `${input.userCapital} 元。请基于总本金计算 entryAdvice.firstPositionSize 为具体股数或百分比（如"约100股，占总本金8%"），不要写"轻仓"这种模糊表述。` : "用户未填写。仓位建议用百分比表述，不要写模糊词。"}

交易手续费规则：
${input.tradingFeeRule ? JSON.stringify(input.tradingFeeRule, null, 2) : "未提供。"}



已精读相关新闻摘要：
${JSON.stringify(input.recentNews ?? [], null, 2)}

联网检索补充结果：
${JSON.stringify(input.webSearchResults ?? [], null, 2)}

请只返回以下 JSON 结构，不要 Markdown，不要解释：
${JSON.stringify(ANALYSIS_RESPONSE_TEMPLATE, null, 2)}`;
}

const ANALYSIS_RESPONSE_TEMPLATE = {
  trend: "neutral",
  confidence: 0.5,
  analysisAsOf: "",
  dataScope: {
    quoteTime: "",
    historyRange: "",
    historyInterval: "",
    historyFrom: "",
    historyTo: "",
    historyCandles: 0,
    newsWindow: "",
    newsCount: 0,
    webSearchStatus: ""
  },
  summary: "",
  newsSummary: "",
  newsSentiment: "neutral",
  webSearchSummary: "",
  newsReferences: [
    {
      title: "",
      source: "",
      publishedAt: "",
      url: "",
      sentiment: "neutral",
      impactLevel: "medium"
    }
  ],
  webSearchResults: [],
  catalystEvents: [],
  macroRisks: [],
  sectorRisks: [],
  keyLevels: {
    support: [],
    resistance: []
  },
  riskFactors: [],
  holdAdvice: {
    action: "继续持有观察",
    reason: "为什么给出这个建议",
    stopLoss: "止损位和止损方式",
    takeProfit: "止盈位和止盈方式",
    positionManagement: "仓位管理建议",
    keyMonitorPoints: "需要持续关注的关键点",
    invalidIf: "什么情况下这个建议失效"
  },
  entryAdvice: {
    action: "等待回调",
    reason: "为什么给出这个入场建议",
    entryZone: "入场价格区间",
    timing: "入场时间窗口",
    triggerCondition: "触发入场的具体条件",
    firstPositionSize: "首次建仓仓位建议",
    stopLoss: "入场后止损位",
    takeProfit: "入场后止盈目标",
    invalidIf: "什么情况下放弃入场计划"
  },
  possibleActions: [
    {
      action: "watch",
      reason: "",
      timing: "",
      triggerCondition: "",
      entryZone: "",
      stopLossPlan: "",
      takeProfitPlan: "",
      positionSizing: "",
      followUpCheck: "",
      invalidIf: ""
    }
  ],
  disclaimer: "本内容由 AI 生成，仅供研究参考，不构成投资建议。"
};

function describePositionStatus(userContext: unknown) {
  if (!isRecord(userContext)) return "未持仓（用户未标记已购买）。";
  const explicitHolding = typeof userContext.isHolding === "boolean" ? userContext.isHolding : null;
  const holdingPrice = typeof userContext.holdingPrice === "number" ? userContext.holdingPrice : Number(userContext.holdingPrice);
  const holdingShares = typeof userContext.holdingShares === "number" ? userContext.holdingShares : Number(userContext.holdingShares);
  const openedAt = typeof userContext.positionOpenedAt === "string" ? userContext.positionOpenedAt : "";
  const priceText = Number.isFinite(holdingPrice) && holdingPrice > 0 ? holdingPrice : "未设置";
  const sharesText = Number.isFinite(holdingShares) && holdingShares > 0 ? `${holdingShares} 股/份` : "未设置";
  if (explicitHolding === false) return "未持仓（用户明确标记为未购买）。";
  if (explicitHolding === true) {
    return `已持仓（用户明确标记已购买；持仓价：${priceText}，持仓数量：${sharesText}，建仓日期：${openedAt || "未设置"}）。`;
  }
  if ((Number.isFinite(holdingPrice) && holdingPrice > 0) || openedAt) {
    return `已持仓（持仓价：${priceText}，持仓数量：${sharesText}，建仓日期：${openedAt || "未设置"}）。`;
  }
  return "未持仓（用户未标记已购买）。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
