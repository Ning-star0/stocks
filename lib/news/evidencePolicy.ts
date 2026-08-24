export type NewsEvidenceAnalysisState = "verified" | "fallback" | "missing" | "failed";

export type NewsEvidenceCandidate = {
  id: string;
  importance: "high" | "medium";
  publishedAt: string;
  analysisState: NewsEvidenceAnalysisState;
};

export type NewsEvidenceAnalysisPlan = {
  selectedIds: string[];
  deferredCriticalIds: string[];
  deferredMediumIds: string[];
};

export type NewsEvidenceCoverage = {
  relevantCount: number;
  highCount: number;
  mediumCount: number;
  verifiedAnalyzedCount: number;
  fallbackAnalysisCount: number;
  failedAnalysisCount: number;
  pendingCriticalCount: number;
  pendingRelevantCount: number;
};

export function planNewsEvidenceAnalysis(
  candidates: NewsEvidenceCandidate[],
  limits: { maxCritical: number; maxMedium: number }
): NewsEvidenceAnalysisPlan {
  const pending = candidates
    .filter((item) => item.analysisState !== "verified")
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const critical = pending.filter((item) => item.importance === "high");
  const medium = pending.filter((item) => item.importance === "medium");
  const selectedCritical = critical.slice(0, normalizeLimit(limits.maxCritical));
  const selectedMedium = medium.slice(0, normalizeLimit(limits.maxMedium));

  return {
    selectedIds: [...selectedCritical, ...selectedMedium].map((item) => item.id),
    deferredCriticalIds: critical.slice(selectedCritical.length).map((item) => item.id),
    deferredMediumIds: medium.slice(selectedMedium.length).map((item) => item.id)
  };
}

export function assessNewsEvidenceCoverage(candidates: NewsEvidenceCandidate[]): NewsEvidenceCoverage {
  const pendingCriticalCount = candidates.filter(
    (item) => item.importance === "high" && item.analysisState !== "verified"
  ).length;
  const pendingRelevantCount = candidates.filter((item) => item.analysisState !== "verified").length;

  return {
    relevantCount: candidates.length,
    highCount: candidates.filter((item) => item.importance === "high").length,
    mediumCount: candidates.filter((item) => item.importance === "medium").length,
    verifiedAnalyzedCount: candidates.filter((item) => item.analysisState === "verified").length,
    fallbackAnalysisCount: candidates.filter((item) => item.analysisState === "fallback").length,
    failedAnalysisCount: candidates.filter((item) => item.analysisState === "failed").length,
    pendingCriticalCount,
    pendingRelevantCount
  };
}

function normalizeLimit(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
