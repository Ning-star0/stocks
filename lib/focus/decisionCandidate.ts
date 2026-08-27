import type { Candidate, DecisionBlocker, DecisionBlockerCategory } from "@/lib/focus/decisionTypes";
import type { QuantSignal } from "@/lib/quant/strategy";

export function candidateSupportsBuy(candidate: Candidate) {
  return assessCandidateBuy(candidate).supported;
}
export function assessCandidateBuy(candidate: Candidate) {
  const details: DecisionBlocker[] = [];
  const block = (code: string, category: DecisionBlockerCategory, message: string) => {
    if (!details.some((item) => item.code === code && item.message === message)) details.push({ code, category, message });
  };
  if (!candidate.price || candidate.price <= 0) block("quote_unavailable", "data", "行情价格不可用");
  if (!candidateHasFreshQuote(candidate)) block("quote_not_fresh", "data", "行情不是最新状态");

  const analysis = candidate.latestAnalysis;
  if (!analysis) {
    block("analysis_missing", "analysis", "缺少最新结构化单股分析");
  } else {
    if (analysis.isFallback) block("analysis_fallback", "data", "单股分析使用了 fallback，不能作为买入证据");
    if (analysis.decisionStatus !== "conditional_entry") {
      block(
        "analysis_status_not_entry",
        analysis.decisionStatus === "insufficient_data" ? "data" : "analysis",
        `单股结构化状态为${decisionStatusLabel(analysis.decisionStatus)}，不是条件入场`
      );
    }
    if (!analysis.dataQuality) {
      block("data_quality_missing", "data", "缺少结构化证据质量报告");
    } else if (analysis.dataQuality.status === "insufficient" || analysis.dataQuality.status === "conflicted") {
      block("data_quality_blocks_entry", "data", `证据质量为 ${analysis.dataQuality.status}，禁止新增仓位`);
      analysis.dataQuality.entryBlockers.slice(0, 3).forEach((message, index) =>
        block(`evidence_gate_${index}`, "data", message)
      );
    }

    const entry = analysis.tradePlan?.entry;
    if (!entry) {
      block("structured_entry_plan_missing", "analysis", "缺少服务端重算的结构化入场计划");
    } else {
      if (entry.status !== "conditional" || (entry.action !== "buy" && entry.action !== "add")) {
        block("structured_entry_plan_blocked", "analysis", "结构化入场计划尚不可执行");
      }
      if (entry.expectedValueStatus !== "positive" || entry.expectedValue === null || entry.expectedValue === undefined || entry.expectedValue <= 0) {
        block(
          entry.expectedValueStatus === "not_calibrated" ? "expected_value_not_calibrated" : "expected_value_not_positive",
          "calibration",
          entry.expectedValueStatus === "not_calibrated"
            ? "尚未完成独立样本外概率校准，扣费后期望值未知"
            : "扣费后统计期望值尚未证明为正"
        );
      }
      if (entry.calibratedWinProbability === null || entry.calibratedWinProbability === undefined || (entry.validationSampleSize ?? 0) <= 0) {
        block("calibration_evidence_missing", "calibration", "缺少可追溯的校准概率或验证样本量");
      }
      if (!entry.calibrationVersion) {
        block("calibration_version_missing", "calibration", "缺少可追溯的概率校准版本");
      }
      if (!validEntryLevels(entry.triggerPrice, entry.stopLossPrice, entry.takeProfitPrice)) {
        block("invalid_entry_levels", "execution", "触发价、止损价或目标价不完整/顺序无效");
      }
      if ((entry.shares ?? 0) < 100 || (entry.shares ?? 0) % 100 !== 0) {
        block("invalid_entry_lot", "execution", "结构化入场股数不满足 100 股/份整数手");
      }
      if ((entry.netRiskRewardRatio ?? 0) < 1.25) {
        block("net_risk_reward_too_low", "execution", "扣费后净风险收益比低于 1.25");
      }
      if ((entry.netMaxLossAmount ?? 0) <= 0 || (entry.totalCost ?? 0) <= 0) {
        block("entry_economics_incomplete", "execution", "总成本或扣费最大风险未完成确定性测算");
      }
    }
  }

  const signal = candidate.quantSignal;
  if (!signal) block("quant_signal_missing", "quant", "缺少量化信号");
  if (signal) {
    if (signal.action !== "buy" && signal.action !== "add") block("quant_action_not_buy", "quant", `量化动作仍为${actionLabel(signal.action)}`);
    if (signal.buyScore < signal.adjustedBuyThreshold) block("buy_score_below_threshold", "quant", `买入分还差 ${formatScoreGap(signal.adjustedBuyThreshold - signal.buyScore)} 分`);
    if (signal.sellScore >= signal.adjustedReduceThreshold) block("sell_risk_triggered", "risk", "卖出风险分已达到减仓阈值");
    if (signal.riskScore >= 68) block("risk_score_too_high", "risk", `风险分 ${signal.riskScore} 过高`);
    if (signal.riskRewardRatio !== null && signal.riskRewardRatio < 1.25) block("gross_risk_reward_too_low", "execution", `风险收益比 ${signal.riskRewardRatio} 低于 1.25`);
    if (signal.volumeRatio !== null && signal.volumeRatio < 0.75) block("volume_ratio_too_low", "market", `量比 ${signal.volumeRatio} 低于 0.75`);
  }
  if (tradeFeedbackBlocksBuy(candidate)) block("trade_feedback_cooldown", "risk", "近期交易反馈仍在冷静期");
  if (candidate.strategyHealth?.entryPermission === "pause") block("strategy_health_paused", "risk", "足量样本显示策略严重失效，健康门控暂停");

  const strongQuantConfirmation = Boolean(signal &&
    signal.buyScore >= signal.adjustedBuyThreshold + 6 &&
    signal.riskScore < 55 &&
    (signal.riskRewardRatio === null || signal.riskRewardRatio >= 1.6) &&
    (signal.volumeRatio === null || signal.volumeRatio >= 0.9));
  return {
    supported: details.length === 0,
    blockers: details.map((item) => item.message),
    blockerDetails: details,
    strongQuantConfirmation
  };
}

export function candidateSupportsSell(candidate?: Candidate | null) {
  if (!candidate || !candidate.isHolding || !candidate.price || candidate.price <= 0 || !candidate.holdingShares || candidate.holdingShares <= 0) return false;
  if (!candidateHasFreshQuote(candidate)) return false;
  if (quantAllowsSell(candidate)) return true;
  const analysis = candidate.latestAnalysis;
  const exit = analysis?.tradePlan?.exit;
  if (analysis?.isFallback || !exit) return false;
  if (analysis?.decisionStatus === "exit_risk" && exit.status === "conditional" && (exit.action === "sell" || exit.action === "reduce")) return true;
  return exit.status === "conditional" && (exit.action === "sell" || exit.action === "reduce");
}

export function quantView(candidate: Candidate) {
  const action = candidate.quantSignal?.action;
  if (action === "buy" || action === "add") return "优先";
  if (action === "sell" || action === "reduce") return "减仓/卖出";
  if (action === "avoid") return "回避";
  if (action === "hold") return "持有观察";
  return "观察";
}

export function quantReason(candidate: Candidate) {
  const signal = candidate.quantSignal;
  if (!signal) return candidate.latestAnalysis?.summary ?? "暂无量化信号。";
  const scores = `量化信号：${actionLabel(signal.action)}，买入分 ${signal.buyScore}/${signal.adjustedBuyThreshold}，卖出分 ${signal.sellScore}/${signal.adjustedReduceThreshold}，趋势分 ${signal.trendScore}，动量分 ${signal.momentumScore}，风险分 ${signal.riskScore}。`;
  const sizing = `仓位建议：买入资金 ${signal.suggestedBuyCapitalPct}%；卖出比例 ${signal.suggestedSellRatioPct}%${signal.suggestedSellShares ? `，约 ${signal.suggestedSellShares} 股/份` : ""}。`;
  const metrics = `风险收益比 ${signal.riskRewardRatio ?? "--"}，止损距离 ${formatPct(signal.stopDistancePct)}，止盈距离 ${formatPct(signal.takeProfitDistancePct)}。`;
  const context = `环境：${signal.marketRegime} / ${signal.sectorBias}${signal.newPositionProtection ? "，新仓保护中" : ""}。`;
  const entryPlan = signal.entryPlan ? `入场计划：${signal.entryPlan}` : "";
  const constraints = signal.tradeConstraints?.length ? `交易约束：${signal.tradeConstraints.slice(0, 2).join("；")}` : "";
  const feedback = candidate.tradeFeedback?.notes?.length ? `交易反馈：${candidate.tradeFeedback.notes.slice(0, 2).join("；")}。` : "";
  const strategyHealth = candidate.strategyHealth ? `样本外策略健康：${candidate.strategyHealth.strategyHealth}，新开仓权限 ${candidate.strategyHealth.entryPermission}；${candidate.strategyHealth.reason}` : "";
  const reason = signal.reasons.slice(0, 2).join("；");
  const risk = signal.risks[0] ? `主要风险：${signal.risks[0]}` : "";
  return [scores, sizing, metrics, context, entryPlan, constraints, feedback, strategyHealth, reason, risk, signal.exitPlan].filter(Boolean).join(" ");
}

export function quantAllowsBuy(candidate?: Candidate | null) {
  if (!candidateHasFreshQuote(candidate)) return false;
  if (!candidate?.quantSignal) return false;
  const signal = candidate.quantSignal;
  return (
    (signal.action === "buy" || signal.action === "add") &&
    signal.buyScore >= signal.adjustedBuyThreshold &&
    signal.sellScore < signal.adjustedReduceThreshold &&
    signal.riskScore < 68 &&
    (signal.riskRewardRatio === null || signal.riskRewardRatio >= 1.25) &&
    (signal.volumeRatio === null || signal.volumeRatio >= 0.75)
  );
}

export function quantAllowsSell(candidate?: Candidate | null) {
  if (!candidateHasFreshQuote(candidate)) return false;
  if (!candidate?.quantSignal) return false;
  const signal = candidate.quantSignal;
  if (signal.newPositionProtection && signal.action !== "sell" && signal.sellScore < signal.adjustedSellThreshold) return false;
  return (
    signal.action === "sell" ||
    signal.action === "reduce" ||
    signal.sellScore >= signal.adjustedReduceThreshold ||
    (signal.suggestedSellRatioPct ?? 0) > 0 ||
    (signal.suggestedSellShares ?? 0) >= 100
  );
}

export function candidateHasFreshQuote(candidate?: Candidate | null) {
  if (!candidate?.price || candidate.price <= 0) return false;
  if (["stale", "unavailable", "error", "failed"].includes(candidate.status)) return false;
  if (!candidate.quoteTime) return false;
  return true;
}

function tradeFeedbackBlocksBuy(candidate: Candidate) {
  const feedback = candidate.tradeFeedback;
  const signal = candidate.quantSignal;
  if (!feedback || !signal) return false;
  if (isFuture(feedback.buyBlockedUntil)) return true;
  if (candidate.isHolding && isFuture(feedback.addBlockedUntil)) return true;
  return false;
}

function isFuture(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "--";
}

function validEntryLevels(trigger: number | null, stop: number | null, target: number | null) {
  return Boolean(trigger && stop && target && stop < trigger && trigger < target);
}

function decisionStatusLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    insufficient_data: "数据不足",
    rejected: "拒绝",
    research_candidate: "研究候选",
    setup_wait: "等待条件",
    conditional_entry: "条件入场",
    manage_position: "持仓管理",
    exit_risk: "退出风险"
  };
  return value ? labels[String(value)] ?? String(value) : "未提供";
}

function formatScoreGap(value: number) {
  return Number(value.toFixed(1)).toString();
}

function actionLabel(action: QuantSignal["action"]) {
  const map: Record<QuantSignal["action"], string> = {
    buy: "买入观察",
    add: "增持观察",
    hold: "持有观察",
    watch: "继续观察",
    reduce: "减仓观察",
    sell: "卖出观察",
    avoid: "回避"
  };
  return map[action];
}
