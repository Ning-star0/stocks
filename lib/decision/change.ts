export type DecisionSnapshot = {
  action?: string | null;
  strategyDirection?: string | null;
  riskLevel?: string | null;
  confidence?: number | null;
};

export type DecisionChangeStatus = "first" | "continued" | "changed";

export type DecisionChange = {
  status: DecisionChangeStatus;
  summary: string;
  actionChange: string | null;
  strategyChange: string | null;
  riskChange: string | null;
  confidenceChange: string | null;
  reasons: string[];
};

export function buildDecisionChange(previous: DecisionSnapshot | null | undefined, current: DecisionSnapshot): DecisionChange {
  if (!previous) {
    return {
      status: "first",
      summary: "首次记录：暂无上一轮结论可对比",
      actionChange: null,
      strategyChange: null,
      riskChange: null,
      confidenceChange: null,
      reasons: ["首次进入决策历史，后续会自动对比变化。"]
    };
  }

  const actionChange = previous.action && current.action && previous.action !== current.action
    ? `${actionLabel(previous.action)} → ${actionLabel(current.action)}`
    : null;
  const strategyChange = previous.strategyDirection && current.strategyDirection && previous.strategyDirection !== current.strategyDirection
    ? `${trendLabel(previous.strategyDirection)} → ${trendLabel(current.strategyDirection)}`
    : null;
  const riskChange = previous.riskLevel && current.riskLevel && previous.riskLevel !== current.riskLevel
    ? `${riskLabel(previous.riskLevel)} → ${riskLabel(current.riskLevel)}`
    : null;
  const confidenceChange = confidenceDelta(previous.confidence, current.confidence);

  const reasons = [
    actionChange ? `当前动作发生变化：${actionChange}` : null,
    strategyChange ? `策略方向发生变化：${strategyChange}` : null,
    riskChange ? `风险等级发生变化：${riskChange}` : null,
    confidenceChange ? `置信度变化：${confidenceChange}` : null
  ].filter((item): item is string => Boolean(item));

  if (!reasons.length) {
    return {
      status: "continued",
      summary: `结论延续：${actionLabel(current.action || "watch")}，方向为${trendLabel(current.strategyDirection || "watch")}`,
      actionChange: null,
      strategyChange: null,
      riskChange: null,
      confidenceChange: null,
      reasons: ["当前动作、策略方向和风险等级与上一轮保持一致。"]
    };
  }

  return {
    status: "changed",
    summary: actionChange
      ? `结论变化：${actionChange}`
      : strategyChange
        ? `方向变化：${strategyChange}`
        : riskChange
          ? `风险变化：${riskChange}`
          : `置信度变化：${confidenceChange}`,
    actionChange,
    strategyChange,
    riskChange,
    confidenceChange,
    reasons
  };
}

export function actionLabel(value: string) {
  const map: Record<string, string> = {
    watch: "继续观察",
    wait_pullback: "等待回调",
    hold: "持有/增持观察",
    reduce: "减仓",
    avoid: "回避"
  };
  return map[value] ?? value;
}

export function trendLabel(value: string) {
  const map: Record<string, string> = {
    bullish: "偏多",
    bearish: "偏空",
    neutral: "中性",
    watch: "观察"
  };
  return map[value] ?? value;
}

export function riskLabel(value?: string | null) {
  const map: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    低: "低",
    中: "中",
    高: "高"
  };
  return value ? map[value] ?? value : "--";
}

function confidenceDelta(previous?: number | null, current?: number | null) {
  if (previous === null || previous === undefined || current === null || current === undefined) return null;
  const delta = Math.round((current - previous) * 100);
  if (Math.abs(delta) < 3) return null;
  const direction = delta > 0 ? "上升" : "下降";
  return `${formatConfidence(previous)} → ${formatConfidence(current)}，${direction} ${Math.abs(delta)} 个百分点`;
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}
