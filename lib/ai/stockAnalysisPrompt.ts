import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";

export const STOCK_ANALYSIS_SYSTEM_PROMPT =
  "你是一个谨慎但不过度保守的股票研究与纪律执行助手。你只能基于用户提供的版本化证据包给出条件触发型研究情景，不能声称能预测市场，不能保证收益，不能给出确定性买卖指令。你的核心任务是为用户回答两个问题：1）如果已持仓，现在该怎么办？2）如果尚未持仓，证据是否足以支持条件入场，还是必须继续研究、等待或回避？你需要从持有周期、趋势、量价、波动、风险、关键价位、用户持仓、新闻预期差、公告、基本面和宏观/行业风险角度综合判断。数据质量、价格、指标、费用、股数和硬门控由服务端确定，不能擅自越过 dataQuality.entryBlockers。若证据和风险控制同时支持，不要机械写“等待回调”；若证据缺失、短线超买、价格远离支撑或风险回报不佳，应明确降级。无论新闻原文是英文、繁体中文或其他语言，所有自然语言分析字段必须使用简体中文。输出必须是严格 JSON，不要输出 Markdown，不要编造新闻链接。";

export function buildUserPrompt(input: AnalyzeStockInput) {
  const positionStatus = describePositionStatus(input.userContext);
  const modeInstructions = decisionModeInstructions(input.evidencePackage?.decisionMode);
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
11. 如果用户提供了交易手续费规则，entryAdvice.firstPositionSize 必须结合手续费和最小计费金额，不要建议过小金额的交易；A 股/ETF 买入数量按 100 股/份取整。买入和卖出都要把手续费作为交易成本考虑，不能只看毛收益。
12. possibleActions 保留作为补充计划，沿用原有格式，至少 2 个场景。
13. 系统会根据用户持仓信息自动展示主建议：若“系统自动持仓判断”为已持仓，holdAdvice 必须作为主建议，重点说明持有、减仓或增持条件；若为未持仓，entryAdvice 必须作为主建议，重点说明是否买入、买多少和等待条件。
14. 输出只能使用英文双引号，不能使用中文弯引号；数组元素之间必须有逗号；不要输出注释、Markdown 或额外说明。
15. JSON 示例中的枚举字段只能返回一个合法值，例如 trend 只能返回 "bullish"、"neutral" 或 "bearish" 其中之一，不能返回 "bullish | neutral | bearish" 这种说明文字。
16. 不要因为“谨慎语气”就默认等待。若价格靠近支撑、趋势偏多、MACD/均线/成交量没有明显恶化且风险收益比合理，entryAdvice.action 应表达为“条件入场观察”或“小仓试探条件”，并写清触发条件。只有价格明显追高、短线超买、跌破关键支撑、新闻/基本面不确定性很高时，才使用“等待回调”或“回避”。
17. entryAdvice 必须详细回答：买入触发价或区间、首次买入股数/仓位、买入后止损价、首个止盈/压力位、最大可承受亏损、风险收益比是否合格、什么情况下放弃买入。若因为手续费效率、现金不足、低于 100 股/份整手、风险收益比不足或行情不新鲜而不能买，要明确写在 reason 或 invalidIf。
18. holdAdvice 必须详细回答：继续持有、增持、减仓、止盈、止损分别在什么条件触发；如果建议卖出/减仓，要说明卖出是为了止损、止盈、盈利保护还是降低风险，并提醒卖出现金回收需要扣除同样万分之五且最低 5 元的手续费。
19. decisionStatus 必须使用结构化枚举。证据不足用 insufficient_data；硬风险否决用 rejected；值得继续研究用 research_candidate；逻辑成立但等待价格/事件用 setup_wait；只有证据充分且全部条件满足时才能提议 conditional_entry；已持仓用 manage_position；已触发退出风险用 exit_risk。服务端会根据硬门控覆盖你的候选状态。
20. supportingEvidence、opposingEvidence、missingEvidence 必须分别列出支持、反对和缺失证据。不得把同一事实重复放入多个数组，也不得把推测写成事实。
21. recentCandles 和 deterministicFeatures 是服务端计算的近期量价证据。需要结合最近 5/20/60 日收益、波动、ATR、量比、缺口和回撤解释走势，不能只复述 RSI/MACD，也不能自行计算或编造价位。
22. disclosures.items 中近期关键公告的 contentStatus=extracted 且 contentExcerpt 非空时，该片段来自法定公告 PDF 全文。contentExtraction.method=embedded_text 表示嵌入文本提取；ocr/hybrid_ocr 表示程序逐页渲染并用 Tesseract chi_sim+eng OCR 补齐需要识别的页面，只有 coverage=full_document 才允许 contentStatus=extracted。OCR 是可见的确定性 fallback，可能有识别误差：可引用片段中的直接事实，但不得把“未识别到某词”解释为事实不存在；关键数字仍必须依赖程序交叉核对。仅用于历史财务结构化事实的定期报告可能为控制上下文而不重复携带 contentExcerpt，此时必须使用 fundamentals.adjustedNetIncomeSources 和 adjustedNetIncomeFact 中已经过程序交叉核对的数值、URL 与原文哈希，不能自行重算。contentStatus=metadata_only、extractionFailure 或 criticalUnreadCount>0 表示相应关键原文证据未闭合，禁止据标题猜测正文。
23. tradePlan 中的目标情景净收益与风险收益比不是统计期望值。当前 expectedValueStatus=not_calibrated 时，必须明确写“本计划胜率和期望值尚未校准”，不得声称具有正期望，也不得借用另一套规则回测的胜率冒充本计划胜率。
24. fundamentals.valuation.historicalEvidence 是程序以未复权历史收盘价和正式报告披露日构造的历史估值分位；财务数字只在报告披露后的下一交易日起生效。只能解释程序给出的 PE/PB 分位、样本数和窗口，不能自行重算、把低分位直接等同于低风险，或在 status=partial/unavailable 时宣称估值便宜。fundamentals.valuation.peerEvidence 使用东方财富 EM2016 行业分类、同一提供方的 PE(TTM)/PB(MRQ) 和其行业可比排名，程序只纳入正倍数并与巨潮确定性当前估值交叉核对；只能解释程序给出的样本中值、分位、溢折价、样本数、来源和哈希。可比公司选择排序由提供方定义，低于同行不等于值得买；status 不是 available、证据超过 maximumAgeHours、样本不足或跨源冲突时必须保留为 missingEvidence/反方证据，禁止宣称同行估值已闭合。

本次决策模式专用约束：
${modeInstructions}

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

服务端组合风险预算（模型不得扩大额度）：
${JSON.stringify(input.portfolioRiskContext ?? null, null, 2)}

交易手续费规则：
${input.tradingFeeRule ? JSON.stringify(input.tradingFeeRule, null, 2) : "未提供。"}

版本化分析证据包（数据质量和硬门控不能由模型覆盖）：
${JSON.stringify(input.evidencePackage ?? {}, null, 2)}



已精读相关新闻摘要：
${JSON.stringify(input.recentNews ?? [], null, 2)}

联网检索补充结果：
${JSON.stringify(input.webSearchResults ?? [], null, 2)}

请只返回以下 JSON 结构，不要 Markdown，不要解释：
${JSON.stringify(ANALYSIS_RESPONSE_TEMPLATE, null, 2)}`;
}

export function decisionModeInstructions(mode: "long_term" | "swing_trade" | "position_management" | undefined) {
  if (mode === "long_term") {
    return "长期研究：先审查 5 年年度与 8 个独立季度的收入、归母净利润、经营现金流、自由现金流、ROE、负债和估值，再讨论技术位置。缺扣非利润、历史估值分位、同行估值或关键公告原文时，只能列为研究候选，不得形成条件买入。失效条件必须包含基本面条件。";
  }
  if (mode === "position_management") {
    return "持仓管理：主结论必须回答继续持有、减仓、止盈和止损条件，并结合持仓成本、股数、公告风险和当前价位。不得把未持仓的首次买入模板当作主建议；退出风险优先于新增仓位。";
  }
  return "波段研究：先用基本面和法定公告排除重大风险，再以近期 5/20/60 日量价、波动、支撑压力和事件催化判断条件入场。不能因为长期估值字段部分缺失而机械否决，但缺有效止损、目标位、公告原文或扣费后净风险收益比时不得买入。";
}

const ANALYSIS_RESPONSE_TEMPLATE = {
  evidenceSchemaVersion: "",
  decisionMode: "swing_trade",
  decisionStatus: "research_candidate",
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
  supportingEvidence: [],
  opposingEvidence: [],
  missingEvidence: [],
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
