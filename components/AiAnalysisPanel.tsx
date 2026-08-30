import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { StrategyBadge, trendToStrategy } from "@/components/StrategyBadge";
import { TrendBadge } from "@/components/TrendBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DecisionChange } from "@/lib/decision/change";
import type { FundamentalCashFlowQualityStatus } from "@/lib/analysis/fundamentalCoverage";
import { getPrimaryAdvice, type PositionContext } from "@/lib/positionAdvice";
import type { AiAnalysisResult, NewsEvidenceCoverageSummary } from "@/lib/types";
import { formatPriceValue, toNumber } from "@/lib/utils";

export function AiAnalysisPanel({
  analysis,
  createdAt,
  fromCache,
  currency,
  symbol,
  unit,
  position,
  decisionChange
}: {
  analysis?: AiAnalysisResult | null;
  createdAt?: string | Date | null;
  fromCache?: boolean;
  currency?: string;
  symbol?: string;
  unit?: string;
  position?: PositionContext | null;
  decisionChange?: DecisionChange | null;
}) {
  if (!analysis) {
    return (
      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-background/20 p-4">
          <CardTitle>AI 策略观察</CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm text-muted-foreground">暂无 AI 分析，可点击重新分析。</CardContent>
      </Card>
    );
  }

  const dataScope = analysis.dataScope;
  const confidence = toNumber(analysis.confidence) ?? 0;
  const support = Array.isArray(analysis.keyLevels?.support) ? analysis.keyLevels.support : [];
  const resistance = Array.isArray(analysis.keyLevels?.resistance) ? analysis.keyLevels.resistance : [];
  const riskFactors = Array.isArray(analysis.riskFactors) ? analysis.riskFactors : [];
  const possibleActions = Array.isArray(analysis.possibleActions) ? analysis.possibleActions : [];
  const newsReferences = Array.isArray(analysis.newsReferences) ? analysis.newsReferences : [];
  const webSearchResults = Array.isArray(analysis.webSearchResults) ? analysis.webSearchResults : [];
  const primaryAdvice = getPrimaryAdvice(analysis, position);
  const dataQuality = analysis.dataQuality;

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 bg-background/20 p-4">
        <div className="min-w-0">
          <CardTitle>AI 策略观察</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-muted-foreground">生成：{formatTime(createdAt)}</span>
            <Badge variant="secondary">置信度 {formatConfidence(confidence)}</Badge>
            {fromCache ? <Badge variant="secondary">缓存结果</Badge> : null}
            {analysis.isFallback ? <Badge variant="danger">本地兜底</Badge> : null}
            {analysis.decisionStatus ? <Badge variant={decisionStatusVariant(analysis.decisionStatus)}>{decisionStatusLabel(analysis.decisionStatus)}</Badge> : null}
          </div>
        </div>
        <TrendBadge trend={analysis.trend} />
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {analysis.isFallback && analysis.fallbackReason ? (
          <div className="glow-card rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
            {analysis.fallbackReason}
          </div>
        ) : null}

        {decisionChange ? <DecisionChangeCard change={decisionChange} /> : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="glow-card rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StrategyBadge tone={trendToStrategy(analysis.trend).tone}>策略方向：{trendToStrategy(analysis.trend).label}</StrategyBadge>
              {analysis.decisionStatus ? <StrategyBadge tone={decisionStatusTone(analysis.decisionStatus)}>决策状态：{decisionStatusLabel(analysis.decisionStatus)}</StrategyBadge> : null}
              <StrategyBadge tone={actionTone(primaryAdvice.action)}>当前动作：{primaryAdvice.action || "继续观察"}</StrategyBadge>
              <Badge variant="secondary">风险等级：{riskLevelText(riskFactors)}</Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{strategyHeadline(analysis, primaryAdvice.action)}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{analysis.summary || primaryAdvice.reason || "暂无摘要。"}</p>
          </div>
          <div className="glow-card grid gap-2 rounded-xl border border-border bg-muted/15 p-3 text-sm">
            <ScopeLine label="置信度" value={formatConfidence(confidence)} />
            <ScopeLine label="适合状态" value={primaryAdvice.isHolding ? "持仓跟踪" : "未持仓观察"} />
            <ScopeLine label="当前动作" value={primaryAdvice.action || "继续观察"} />
            <ScopeLine label="截至" value={formatTime(analysis.analysisAsOf)} />
          </div>
        </div>

        {dataQuality || analysis.supportingEvidence?.length || analysis.opposingEvidence?.length || analysis.missingEvidence?.length ? (
          <EvidenceQualityPanel analysis={analysis} />
        ) : null}

        {analysis.holdAdvice || analysis.entryAdvice ? (
          <PrimaryAdviceCard analysis={analysis} primaryAdvice={primaryAdvice} />
        ) : (
          <Block title="可能操作计划">
            <div className="space-y-2">
              {possibleActions.length ? (
                possibleActions.map((item, index) => (
                  <div key={`${item.action}-${index}`} className="glow-card rounded-xl border border-border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">{formatAction(item.action)}</div>
                      {item.timing ? <Badge variant="secondary">{item.timing}</Badge> : null}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.reason}</div>
                    <ActionGrid item={item} currency={currency} symbol={symbol} unit={unit} />
                    <div className="glow-card mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      失效条件：{item.invalidIf}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">暂无操作计划。</div>
              )}
            </div>
          </Block>
        )}

        {analysis.tradePlan ? (
          <TradePlanCard tradePlan={analysis.tradePlan} currency={currency} symbol={symbol} unit={unit} />
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <LevelList title="支撑位" values={support} currency={currency} symbol={symbol} unit={unit} />
          <LevelList title="压力位" values={resistance} currency={currency} symbol={symbol} unit={unit} />
        </div>

        <Block title="风险因素">
          <List values={riskFactors} />
        </Block>

        {analysis.newsSummary ? (
          <Block title="新闻摘要">
            <p className="text-sm leading-6">{analysis.newsSummary}</p>
            <ReferenceList items={newsReferences} />
          </Block>
        ) : null}

        <CollapsiblePanel title="分析依据与数据来源">
          <div className="space-y-4">
            {dataScope ? (
              <div className="glow-card grid gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground md:grid-cols-2">
                <ScopeLine label="报价时间" value={formatTime(dataScope.quoteTime)} />
                <ScopeLine label="历史数据" value={`${dataScope.historyRange ?? "--"} / ${dataScope.historyInterval ?? "--"}，${dataScope.historyCandles ?? 0} 根 K 线`} />
                <ScopeLine label="历史范围" value={`${formatDate(dataScope.historyFrom)} 至 ${formatDate(dataScope.historyTo)}`} />
                <ScopeLine label="新闻范围" value={dataScope.newsWindow ?? "--"} />
                <ScopeLine label="新闻数量" value={`${dataScope.newsCount ?? 0} 条传入 AI`} />
                <ScopeLine label="联网检索" value={dataScope.webSearchStatus ?? "--"} />
                <ScopeLine label="宽基环境" value={`${dataScope.marketRegimeBenchmarkSymbol ?? "000300.SH"} · ${dataScope.marketRegime ?? "unknown"} · ${dataScope.marketRegimeStatus ?? "unavailable"}`} />
                <ScopeLine label="宽基截止" value={formatTime(dataScope.marketRegimeAsOf)} />
                <ScopeLine label="证据版本" value={analysis.evidenceSchemaVersion ?? "旧版分析"} />
                <ScopeLine label="决策模式" value={decisionModeLabel(analysis.decisionMode)} />
                <ScopeLine label="数据质量" value={dataQuality ? dataQualityStatusLabel(dataQuality.status) : "旧版未记录"} />
              </div>
            ) : null}
            {dataScope?.marketRegimeSourceUrl ? <a href={dataScope.marketRegimeSourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">查看沪深 300 市场环境原始日线来源</a> : null}
            {analysis.webSearchSummary ? <p className="text-sm leading-6 text-muted-foreground">{analysis.webSearchSummary}</p> : null}
            <SearchResultList items={webSearchResults} />
          </div>
        </CollapsiblePanel>

        <p className="border-t pt-4 text-xs text-muted-foreground">{analysis.disclaimer || "本内容由 AI 生成，仅供研究参考，不构成投资建议。"}</p>
      </CardContent>
    </Card>
  );
}

function EvidenceQualityPanel({ analysis }: { analysis: AiAnalysisResult }) {
  const quality = analysis.dataQuality;
  const newsCoverage = quality?.newsCoverage;
  const newsTimeline = analysis.dataScope?.newsTimeline;
  const supporting = analysis.supportingEvidence ?? [];
  const opposing = analysis.opposingEvidence ?? [];
  const missing = analysis.missingEvidence ?? [];
  const blockers = quality?.entryBlockers ?? [];
  const fundamentalCoverage = analysis.dataScope?.fundamentalCoverage;
  const adjustedNetIncomeStatus = fundamentalCoverage?.adjustedNetIncomeStatus
    ?? (fundamentalCoverage?.adjustedNetIncomeAvailable ? "complete" : "unavailable");
  const adjustedNetIncomeSources = fundamentalCoverage?.adjustedNetIncomeSources ?? [];
  const historicalValuationStatus = fundamentalCoverage?.historicalValuationStatus
    ?? (fundamentalCoverage?.historicalValuationAvailable ? "available" : "unavailable");
  const historicalValuationReportSources = fundamentalCoverage?.historicalValuationReportSources ?? [];
  const peerValuationStatus = fundamentalCoverage?.peerValuationStatus
    ?? (fundamentalCoverage?.peerValuationAvailable ? "available" : "unavailable");
  const peerValuationComparables = fundamentalCoverage?.peerValuationComparables ?? [];

  return (
    <Block title="证据覆盖与反方检查">
      <div className="flex flex-wrap gap-2">
        {quality ? <Badge variant={dataQualityVariant(quality.status)}>数据质量：{dataQualityStatusLabel(quality.status)}</Badge> : null}
        {quality?.instrumentType ? <Badge variant="secondary">标的类型：{instrumentTypeLabel(quality.instrumentType)}</Badge> : null}
        {quality ? <Badge variant={quality.quoteFresh ? "success" : "danger"}>报价{quality.quoteFresh ? "新鲜" : "过期"}</Badge> : null}
        {quality ? <Badge variant={quality.klineFresh ? "success" : "danger"}>K 线{quality.klineFresh ? "新鲜" : "过期"}</Badge> : null}
        {quality ? <Badge variant={quality.newsRefreshCompleted ? "success" : "warning"}>新闻{quality.newsRefreshCompleted ? "已刷新" : "待刷新"}</Badge> : null}
        {quality?.newsQuotaStatus ? (
          <Badge variant={quality.newsQuotaStatus === "available" ? "success" : quality.newsQuotaStatus === "quota_low" ? "warning" : "danger"}>
            新闻额度{quality.newsQuotaStatus === "available" ? "充足" : quality.newsQuotaStatus === "quota_low" ? "偏低" : "已耗尽"}
          </Badge>
        ) : null}
        {quality ? <Badge variant={quality.criticalNewsAnalyzed ? "success" : "danger"}>关键新闻{quality.criticalNewsAnalyzed ? "已精读" : "未闭合"}</Badge> : null}
        {quality?.instrumentType === "a_share_stock" ? <Badge variant={quality.disclosuresFresh && quality.criticalDisclosuresRead ? "success" : "danger"}>公司公告{quality.disclosuresFresh ? (quality.criticalDisclosuresRead ? "已核对" : "待读原文") : "已过期"}</Badge> : null}
        {quality?.instrumentType === "a_share_stock" ? <Badge variant={quality.fundamentalsFresh ? (quality.fundamentalsComplete ? "success" : "warning") : "danger"}>公司基本面{quality.fundamentalsFresh ? (quality.fundamentalsComplete ? "完整" : "部分") : "不可用"}</Badge> : null}
        {quality?.instrumentType === "etf" ? <Badge variant={quality.instrumentEvidenceComplete ? "success" : "danger"}>ETF 产品证据{quality.instrumentEvidenceComplete ? "完整" : "未闭合"}</Badge> : null}
        {quality ? <Badge variant={quality.portfolioRiskEvaluated ? "success" : "danger"}>组合风险{quality.portfolioRiskEvaluated ? "已核算" : "未核算"}</Badge> : null}
      </div>
      {quality?.etfEvidence ? <EtfEvidencePanel evidence={quality.etfEvidence} /> : null}
      {newsCoverage ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <ScopeLine label="抓取 / 保存" value={`${newsCoverage.fetchedCount} / ${newsCoverage.savedCount}`} />
          <ScopeLine label="相关 / 精读" value={`${newsCoverage.relevantCount} / ${newsCoverage.verifiedAnalyzedCount}`} />
          <ScopeLine label="高 / 中影响" value={`${newsCoverage.highCount} / ${newsCoverage.mediumCount}`} />
          <ScopeLine label="待补 / 失败" value={`${newsCoverage.pendingRelevantCount} / ${newsCoverage.failedAnalysisCount + newsCoverage.fallbackAnalysisCount}`} />
          <ScopeLine label="天行 / Tavily" value={`${newsCoverage.tianapiCalls ?? 0} / ${newsCoverage.tavilyCalls ?? 0}`} />
          <ScopeLine label="缓存命中" value={`${newsCoverage.cacheHitCount ?? 0}`} />
          <ScopeLine label="共享行业查询" value={newsCoverage.sharedTopicKey ? (newsCoverage.sharedTopicReused ? "已复用" : "本批首次请求") : "未启用，已退回单股查询"} />
          <ScopeLine label="行业分类" value={formatIndustryClassification(newsCoverage.industryClassification)} />
          <ScopeLine label="额度跳过" value={`${newsCoverage.skippedQueryCount ?? 0}`} />
          <ScopeLine label="新闻来源" value={(newsCoverage.sourceProviders ?? []).join(" / ") || "未记录"} />
          <ScopeLine label="事件 / 重复转载" value={`${newsCoverage.eventClusterCount ?? 0} / ${newsCoverage.duplicateArticleCount ?? 0}`} />
          <ScopeLine label="未来时间异常新闻" value={`${newsCoverage.futureDatedArticleCount ?? 0}`} />
          <ScopeLine label="显式预期 / 推断 / 未知" value={`${newsCoverage.explicitExpectationCount ?? 0} / ${newsCoverage.inferredExpectationCount ?? 0} / ${newsCoverage.unavailableExpectationCount ?? 0}`} />
          <ScopeLine label="已有价格反应" value={`${newsCoverage.priceReactionAvailableCount ?? 0}`} />
        </div>
      ) : null}
      {newsTimeline?.events.length ? (
        <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-xs font-medium text-foreground">新闻事件、预期差与价格反应</div>
            <Badge variant={newsTimeline.status === "complete" ? "success" : "warning"}>{newsTimeline.status === "complete" ? "已闭合" : "部分闭合"}</Badge>
            <span className="text-[11px] text-muted-foreground">{newsTimeline.windowDescription}</span>
          </div>
          <div className="mt-3 space-y-3">
            {newsTimeline.events.map((event) => (
              <div key={event.eventId} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {event.canonicalSource.url ? (
                    <a className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline" href={event.canonicalSource.url} target="_blank" rel="noreferrer">{event.title}</a>
                  ) : <span className="font-medium text-foreground">{event.title}</span>}
                  <Badge variant={event.novelty === "reprint_cluster" ? "warning" : "secondary"}>{event.novelty === "reprint_cluster" ? `${event.articleCount} 篇转载聚类` : "单篇事件"}</Badge>
                  <Badge variant={event.expectation.status === "explicit" ? "success" : event.expectation.status === "inferred" ? "warning" : "danger"}>
                    {event.expectation.status === "explicit" ? "显式预期差" : event.expectation.status === "inferred" ? "推断预期" : "预期未知"}
                  </Badge>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <ScopeLine label="窗口内首次" value={formatTime(event.firstSeenAt)} />
                  <ScopeLine label="规范来源" value={`${event.canonicalSource.name ?? "未知"} · ${newsSourceTierLabel(event.canonicalSource.tier)}`} />
                  <ScopeLine label="1 / 3 / 5 日反应" value={`${formatSignedPct(event.priceReaction.close1dPct)} / ${formatSignedPct(event.priceReaction.close3dPct)} / ${formatSignedPct(event.priceReaction.close5dPct)}`} />
                  <ScopeLine label="首个完整日量比" value={event.priceReaction.volumeRatio20 === null ? "--" : `${event.priceReaction.volumeRatio20.toFixed(2)}x`} />
                </div>
                {event.expectation.baseline || event.expectation.actual ? (
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <ScopeLine label="事前基线" value={event.expectation.baseline ?? "未提供"} />
                    <ScopeLine label="实际事实" value={event.expectation.actual ?? "未提供"} />
                    <ScopeLine label="预期提炼来源" value={event.eventContextSource ? `${event.eventContextSource.name ?? "未知来源"} · ${formatTime(event.eventContextSource.publishedAt)}` : "未记录"} />
                    <ScopeLine label="影响期限" value={newsHorizonLabel(event.expectedImpactHorizon)} />
                  </div>
                ) : null}
                {event.priceReaction.missingReason ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">价格反应未闭合：{event.priceReaction.missingReason}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {analysis.dataScope ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <ScopeLine label="财务状态" value={analysis.dataScope.fundamentalsStatus ?? "旧版未记录"} />
          <ScopeLine label="财务期" value={analysis.dataScope.fundamentalsReportPeriod ?? "--"} />
          <ScopeLine label="公告状态" value={analysis.dataScope.disclosureStatus ?? "旧版未记录"} />
          <ScopeLine label="关键公告原文" value={`${analysis.dataScope.disclosureExtractedCount ?? 0} / ${analysis.dataScope.disclosureCriticalCount ?? 0}`} />
          <ScopeLine label="组合风险状态" value={analysis.dataScope.portfolioRiskStatus ?? "未核算"} />
          <ScopeLine label="剩余风险额度" value={analysis.dataScope.portfolioAvailableRiskAmount === null || analysis.dataScope.portfolioAvailableRiskAmount === undefined ? "--" : `¥${analysis.dataScope.portfolioAvailableRiskAmount.toFixed(2)}`} />
        </div>
      ) : null}
      {fundamentalCoverage ? (
        <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-xs font-medium text-foreground">基本面覆盖与现金流质量</div>
            <Badge variant={adjustedNetIncomeStatus === "complete" ? "success" : adjustedNetIncomeStatus === "partial" ? "warning" : "danger"}>扣非净利润{adjustedNetIncomeStatusLabel(adjustedNetIncomeStatus)}</Badge>
            <Badge variant={historicalValuationStatus === "available" ? "success" : historicalValuationStatus === "partial" ? "warning" : "danger"}>历史估值{historicalValuationStatusLabel(historicalValuationStatus)}</Badge>
            <Badge variant={fundamentalCoverage.peerValuationAvailable ? "success" : peerValuationStatus === "partial" ? "warning" : "danger"}>同行估值{peerValuationStatusLabel(peerValuationStatus, fundamentalCoverage.peerValuationFresh)}</Badge>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <ScopeLine label="财务样本" value={`${fundamentalCoverage.annualPeriodCount} / 5 年，${fundamentalCoverage.standaloneQuarterCount} / 8 单季`} />
            <ScopeLine label="现金质量口径" value={cashFlowQualityLabel(fundamentalCoverage.cashFlowQualityStatus)} />
            <ScopeLine label="自由现金流 TTM" value={formatCny10k(fundamentalCoverage.freeCashFlowTtmCny10k)} />
            <ScopeLine label="经营现金流 / 归母净利" value={formatMultiple(fundamentalCoverage.operatingCashFlowToParentNetIncomeTtm)} />
            <ScopeLine label="自由现金流 / 归母净利" value={formatMultiple(fundamentalCoverage.freeCashFlowToParentNetIncomeTtm)} />
            <ScopeLine label="自由现金流率 TTM" value={formatMetricPercent(fundamentalCoverage.freeCashFlowMarginTtmPct)} />
            <ScopeLine label="扣非净利润 TTM" value={formatCny10k(fundamentalCoverage.adjustedNetIncomeTtmCny10k)} />
            <ScopeLine label="扣非利润样本" value={`${fundamentalCoverage.adjustedAnnualPeriodCount ?? 0} / 5 年，${fundamentalCoverage.adjustedStandaloneQuarterCount ?? 0} / 8 单季`} />
            <ScopeLine label="PE(TTM) / PB" value={`${formatMetricNumber(fundamentalCoverage.peTtm)} / ${formatMetricNumber(fundamentalCoverage.pb)}`} />
            <ScopeLine label="历史估值分位" value={formatMetricPercent(fundamentalCoverage.historicalPercentile)} />
            <ScopeLine label="PE / PB 历史分位" value={`${formatMetricPercent(fundamentalCoverage.historicalPePercentile)} / ${formatMetricPercent(fundamentalCoverage.historicalPbPercentile)}`} />
            <ScopeLine label="PE / PB 样本" value={`${fundamentalCoverage.historicalPeSampleSize ?? 0} / ${fundamentalCoverage.historicalPbSampleSize ?? 0} 个交易日`} />
            <ScopeLine label="估值窗口" value={fundamentalCoverage.historicalValuationWindowStart && fundamentalCoverage.historicalValuationWindowEnd ? `${fundamentalCoverage.historicalValuationWindowStart} — ${fundamentalCoverage.historicalValuationWindowEnd}` : "--"} />
            <ScopeLine label="估值价格口径" value={fundamentalCoverage.historicalValuationPriceProvider ? `${fundamentalCoverage.historicalValuationPriceProvider} · 未复权` : "--"} />
            <ScopeLine label="估值价格新鲜度" value={fundamentalCoverage.historicalValuationPriceSeriesFresh ? "合格" : "不合格 / 未记录"} />
            <ScopeLine label="同行行业口径" value={fundamentalCoverage.peerValuationIndustry ?? "--"} />
            <ScopeLine label="同行目标 PE / PB" value={`${formatMetricNumber(fundamentalCoverage.peerPeTtm)} / ${formatMetricNumber(fundamentalCoverage.peerPbMrq)}`} />
            <ScopeLine label="同行样本 PE / PB 中值" value={`${formatMetricNumber(fundamentalCoverage.peerPeTtmMedian)} / ${formatMetricNumber(fundamentalCoverage.peerPbMrqMedian)}`} />
            <ScopeLine label="PE / PB 同行分位" value={`${formatMetricPercent(fundamentalCoverage.peerPeTtmPercentile)} / ${formatMetricPercent(fundamentalCoverage.peerPbMrqPercentile)}`} />
            <ScopeLine label="PE / PB 相对样本中值" value={`${formatMetricPercent(fundamentalCoverage.peerPeTtmPremiumDiscountPct)} / ${formatMetricPercent(fundamentalCoverage.peerPbMrqPremiumDiscountPct)}`} />
            <ScopeLine label="同行样本 / 新鲜度" value={`${fundamentalCoverage.peerValuationSampleSize ?? 0} 家 / ${fundamentalCoverage.peerValuationFresh ? "合格" : "过期或未记录"}`} />
          </div>
          {fundamentalCoverage.missingFields.length ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">明确缺失：{fundamentalCoverage.missingFields.map(fundamentalFieldLabel).join("、")}</p>
          ) : null}
          {fundamentalCoverage.historicalValuationMissingReason ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">历史估值未闭合：{fundamentalCoverage.historicalValuationMissingReason}</p>
          ) : null}
          {fundamentalCoverage.peerValuationMissingReason ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">同行估值未闭合：{fundamentalCoverage.peerValuationMissingReason}</p>
          ) : null}
          {adjustedNetIncomeSources.length ? (
            <ul className="mt-3 space-y-1 border-t border-border/70 pt-2 text-xs leading-5">
              {adjustedNetIncomeSources.slice(0, 8).map((source) => (
                <li key={`${source.periodEnd}-${source.contentHash}`} className="flex flex-wrap items-center gap-2">
                  <a className="text-primary underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.periodEnd} · {source.title}</a>
                  <span className="text-muted-foreground">原文哈希 {source.contentHash.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {fundamentalCoverage.historicalValuationPriceSourceUrl || historicalValuationReportSources.length ? (
            <div className="mt-3 border-t border-border/70 pt-2 text-xs leading-5">
              <div className="font-medium text-foreground">历史估值可追溯来源</div>
              <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                {fundamentalCoverage.historicalValuationPriceSourceUrl ? (
                  <a className="text-primary underline-offset-2 hover:underline" href={fundamentalCoverage.historicalValuationPriceSourceUrl} target="_blank" rel="noreferrer">未复权价格序列</a>
                ) : null}
                {fundamentalCoverage.historicalValuationPriceSeriesHash ? <span>价格哈希 {fundamentalCoverage.historicalValuationPriceSeriesHash.slice(0, 10)}</span> : null}
              </div>
              {historicalValuationReportSources.length ? (
                <ul className="mt-1 space-y-1">
                  {historicalValuationReportSources.slice(-8).reverse().map((source) => (
                    <li key={`${source.periodEnd}-${source.publishedAt}`} className="flex flex-wrap items-center gap-2">
                      <a className="text-primary underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.periodEnd} · {source.title}</a>
                      <span className="text-muted-foreground">披露后 {source.effectiveFrom} 起生效</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {fundamentalCoverage.peerValuationSourceUrl || fundamentalCoverage.peerValuationClassificationSourceUrl || peerValuationComparables.length ? (
            <div className="mt-3 border-t border-border/70 pt-2 text-xs leading-5">
              <div className="font-medium text-foreground">同行估值可追溯来源</div>
              <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                {fundamentalCoverage.peerValuationSourceUrl ? (
                  <a className="text-primary underline-offset-2 hover:underline" href={fundamentalCoverage.peerValuationSourceUrl} target="_blank" rel="noreferrer">同行 PE(TTM) / PB(MRQ)</a>
                ) : null}
                {fundamentalCoverage.peerValuationClassificationSourceUrl ? (
                  <a className="text-primary underline-offset-2 hover:underline" href={fundamentalCoverage.peerValuationClassificationSourceUrl} target="_blank" rel="noreferrer">EM2016 行业分类</a>
                ) : null}
                {fundamentalCoverage.peerValuationAsOf ? <span>抓取于 {formatTime(fundamentalCoverage.peerValuationAsOf)}</span> : null}
                {fundamentalCoverage.peerValuationContentHash ? <span>证据哈希 {fundamentalCoverage.peerValuationContentHash.slice(0, 10)}</span> : null}
              </div>
              {peerValuationComparables.length ? (
                <ul className="mt-1 space-y-1">
                  {peerValuationComparables.map((peer) => (
                    <li key={peer.symbol} className="text-muted-foreground">
                      {peer.name}（{peer.symbol}）：PE(TTM) {formatMetricNumber(peer.peTtm)} / PB(MRQ) {formatMetricNumber(peer.pbMrq)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-muted-foreground">同行排序由数据提供方定义；分位和溢折价只描述该样本，不能单独推出买入结论。</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {analysis.dataScope?.disclosureSources?.length ? (
        <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-2">
          <div className="text-xs font-medium text-foreground">法定公告原文</div>
          <ul className="mt-2 space-y-1 text-xs leading-5">
            {analysis.dataScope.disclosureSources.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <a className="text-primary underline-offset-2 hover:underline" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                <Badge variant={item.contentStatus === "metadata_only" ? "danger" : item.extractionMethod === "ocr" || item.extractionMethod === "hybrid_ocr" ? "warning" : "success"}>
                  {disclosureExtractionLabel(item.contentStatus, item.extractionMethod)}
                </Badge>
                {item.totalPages ? <span className="text-muted-foreground">全文 {item.totalPages} 页{item.ocrPages ? `，OCR ${item.ocrPages} 页` : ""}</span> : null}
                {item.extractionFailure ? <span className="text-red-600 dark:text-red-300">{item.extractionFailure}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.dataScope?.newsRefreshFailures?.length ? (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {analysis.dataScope.newsRefreshFailures.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : null}
      {analysis.dataScope?.companyEvidenceFailures?.length ? (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {analysis.dataScope.companyEvidenceFailures.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : null}
      {analysis.dataScope?.portfolioRiskFailure ? (
        <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-5 text-muted-foreground">组合风险预算失败：{analysis.dataScope.portfolioRiskFailure}</p>
      ) : null}
      {analysis.dataScope?.marketRegimeFailure ? (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-muted-foreground">宽基市场环境：{analysis.dataScope.marketRegimeFailure}</p>
      ) : null}
      {blockers.length ? (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
          <div className="text-sm font-semibold text-red-700 dark:text-red-300">新增买入已被服务端硬门控拦截</div>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
            {blockers.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <EvidenceColumn title="支持证据" values={supporting} empty="暂无已确认支持证据" />
        <EvidenceColumn title="反对证据" values={opposing} empty="暂无已确认反对证据" />
        <EvidenceColumn title="缺失证据" values={missing} empty="未报告缺失证据" />
      </div>
    </Block>
  );
}

function formatIndustryClassification(evidence: NewsEvidenceCoverageSummary["industryClassification"]) {
  if (!evidence) return "旧分析未记录";
  if (evidence.status === "verified") return `${evidence.industryName ?? "未知"} · 东方财富 EM2016 · 有效至 ${formatTime(evidence.validUntil)}`;
  const label = evidence.status === "stale" ? "已过期" : evidence.status === "conflicted" ? "冲突" : "缺失";
  return `${label} · ${evidence.missingReason ?? "已退回单股主题查询"}`;
}

function instrumentTypeLabel(value: NonNullable<AiAnalysisResult["dataQuality"]>["instrumentType"]) {
  if (value === "a_share_stock") return "A 股公司";
  if (value === "etf") return "ETF";
  if (value === "index") return "指数";
  return "未知";
}

function EvidenceColumn({ title, values, empty }: { title: string; values: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="text-xs font-medium text-foreground">{title}</div>
      {values.length ? (
        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
          {values.slice(0, 6).map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}
        </ul>
      ) : <div className="mt-2 text-xs text-muted-foreground">{empty}</div>}
    </div>
  );
}

function TradePlanCard({
  tradePlan,
  currency,
  symbol,
  unit
}: {
  tradePlan: NonNullable<AiAnalysisResult["tradePlan"]>;
  currency?: string;
  symbol?: string;
  unit?: string;
}) {
  return (
    <Block title="交易测算">
      <div className="grid gap-3 lg:grid-cols-2">
        <TradePlanLegCard
          title={tradePlan.entry.action === "add" ? "增持测算" : "买入测算"}
          leg={tradePlan.entry}
          mode="entry"
          currency={currency}
          symbol={symbol}
          unit={unit}
        />
        <TradePlanLegCard
          title="卖出 / 减仓测算"
          leg={tradePlan.exit}
          mode="exit"
          currency={currency}
          symbol={symbol}
          unit={unit}
        />
      </div>
      <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {tradePlan.feeRule.description}
      </div>
    </Block>
  );
}

function TradePlanLegCard({
  title,
  leg,
  mode,
  currency,
  symbol,
  unit
}: {
  title: string;
  leg: NonNullable<AiAnalysisResult["tradePlan"]>["entry"];
  mode: "entry" | "exit";
  currency?: string;
  symbol?: string;
  unit?: string;
}) {
  const rows: Array<[string, string | null | undefined]> = [
    ["触发价", formatNullablePrice(leg.triggerPrice, currency, symbol, unit)],
    ["止损价", formatNullablePrice(leg.stopLossPrice, currency, symbol, unit)],
    ["止盈价", formatNullablePrice(leg.takeProfitPrice, currency, symbol, unit)],
    ["数量", leg.shares ? `${leg.shares} 股/份` : null],
    [mode === "entry" ? "成交金额" : "计划市值", formatAmount(leg.amount)],
    ["手续费", formatAmount(leg.estimatedFee)]
  ];

  if (mode === "entry") {
    rows.push(["总成本", formatAmount(leg.totalCost)]);
    rows.push(["毛风险收益比", leg.riskRewardRatio ? `${leg.riskRewardRatio.toFixed(2)} : 1` : null]);
    rows.push(["净风险收益比", leg.netRiskRewardRatio ? `${leg.netRiskRewardRatio.toFixed(2)} : 1` : null]);
    rows.push(["预计双边手续费", formatAmount(leg.roundTripFees)]);
    rows.push(["手续费占比", formatPrecisePercent(leg.feeDragPct)]);
    rows.push(["盈亏平衡价", formatNullablePrice(leg.breakEvenPrice, currency, symbol, unit)]);
    rows.push(["盈亏平衡涨幅", formatPrecisePercent(leg.breakEvenMovePct)]);
    rows.push(["目标毛收益", formatAmount(leg.grossExpectedProfit)]);
    rows.push(["目标情景净收益", formatAmount(leg.netExpectedProfit)]);
    rows.push(["期望值校准", leg.expectedValueStatus === "positive" ? "已校准为正" : leg.expectedValueStatus === "non_positive" ? "已校准但非正" : "尚未校准"]);
    rows.push(["最大价格风险", formatAmount(leg.maxLossAmount)]);
    rows.push(["扣费最大风险", formatAmount(leg.netMaxLossAmount)]);
  } else {
    rows.push(["净回收", formatAmount(leg.netProceeds)]);
    rows.push(["卖出比例", leg.sellRatioPct ? `${leg.sellRatioPct.toFixed(0)}%` : null]);
    rows.push(["估算盈亏", formatAmount(leg.estimatedPnl)]);
  }

  return (
    <div className="glow-card rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        <Badge variant={tradePlanStatusVariant(leg.status)}>{tradePlanStatusLabel(leg.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/70 bg-background/45 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="mt-1 text-sm font-medium tabular-nums">{value}</div>
            </div>
          ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{leg.reason}</p>
      {leg.constraints.length ? (
        <div className="mt-3 space-y-1">
          {leg.constraints.slice(0, 6).map((item) => (
            <div key={item} className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300">
              {item}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DecisionChangeCard({ change }: { change: DecisionChange }) {
  const variant = change.status === "changed" ? "warning" : change.status === "first" ? "secondary" : "success";
  const title = change.status === "changed" ? "结论发生变化" : change.status === "first" ? "首次记录" : "结论延续";
  return (
    <div className="glow-card rounded-xl border border-border bg-background/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        <Badge variant={variant}>{change.status === "changed" ? "需复核" : "稳定"}</Badge>
      </div>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{change.summary}</div>
      {change.reasons.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {change.reasons.slice(0, 4).map((reason) => (
            <span key={reason} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {reason}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function tradePlanStatusLabel(status: NonNullable<AiAnalysisResult["tradePlan"]>["entry"]["status"]) {
  if (status === "conditional") return "条件触发";
  if (status === "blocked") return "暂不可做";
  if (status === "not_applicable") return "不适用";
  return "观察";
}

function tradePlanStatusVariant(status: NonNullable<AiAnalysisResult["tradePlan"]>["entry"]["status"]) {
  if (status === "conditional") return "success";
  if (status === "blocked") return "danger";
  return "secondary";
}

function formatNullablePrice(value: number | null | undefined, currency?: string, symbol?: string, unit?: string) {
  return typeof value === "number" && Number.isFinite(value) ? formatPriceValue(value, { currency, symbol, unit }) : null;
}

function formatAmount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPrecisePercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(2)}%`;
}

function PrimaryAdviceCard({
  analysis,
  primaryAdvice
}: {
  analysis: AiAnalysisResult;
  primaryAdvice: ReturnType<typeof getPrimaryAdvice>;
}) {
  const secondary = primaryAdvice.isHolding ? analysis.entryAdvice : analysis.holdAdvice;
  return (
    <div className="space-y-3">
      <div className="glow-card rounded-xl border border-primary/25 bg-background/45 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
          <span>{primaryAdvice.isHolding ? "持仓策略" : "交易情景"}</span>
          <Badge variant="secondary">{primaryAdvice.isHolding ? "持仓跟踪" : "未持仓观察"}</Badge>
        </div>
        {primaryAdvice.action ? (
          <div className="mb-3">
            <StrategyBadge tone={actionTone(primaryAdvice.action)}>{primaryAdvice.action}</StrategyBadge>
          </div>
        ) : null}
        <div className="mb-3 text-sm leading-6 text-muted-foreground">{primaryAdvice.reason}</div>
        {primaryAdvice.isHolding ? (
          <HoldAdviceDetails advice={analysis.holdAdvice ?? null} />
        ) : (
          <EntryAdviceDetails advice={analysis.entryAdvice ?? null} />
        )}
      </div>
      {secondary ? (
        <details className="glow-card rounded-xl border border-border bg-muted/15 p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">查看另一种交易情景</summary>
          <div className="mt-3 text-sm leading-6 text-muted-foreground">{secondary.reason}</div>
        </details>
      ) : null}
    </div>
  );
}

function HoldAdviceDetails({ advice }: { advice: AiAnalysisResult["holdAdvice"] }) {
  if (!advice) return null;
  return (
    <>
      <div className="space-y-2 text-sm">
        {advice.stopLoss ? <AdviceRow label="止损计划" value={advice.stopLoss} /> : null}
        {advice.takeProfit ? <AdviceRow label="止盈计划" value={advice.takeProfit} /> : null}
        {advice.positionManagement ? <AdviceRow label="仓位管理" value={advice.positionManagement} /> : null}
        {advice.keyMonitorPoints ? <AdviceRow label="关注重点" value={advice.keyMonitorPoints} /> : null}
      </div>
      {advice.invalidIf ? (
        <div className="glow-card mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          失效条件：{advice.invalidIf}
        </div>
      ) : null}
    </>
  );
}

function EntryAdviceDetails({ advice }: { advice: AiAnalysisResult["entryAdvice"] }) {
  if (!advice) return null;
  return (
    <>
      <div className="space-y-2 text-sm">
        {advice.entryZone ? <AdviceRow label="入场区间" value={advice.entryZone} /> : null}
        {advice.timing ? <AdviceRow label="时间窗口" value={advice.timing} /> : null}
        {advice.triggerCondition ? <AdviceRow label="触发条件" value={advice.triggerCondition} /> : null}
        {advice.firstPositionSize ? <AdviceRow label="首次仓位" value={advice.firstPositionSize} /> : null}
        {advice.stopLoss ? <AdviceRow label="止损计划" value={advice.stopLoss} /> : null}
        {advice.takeProfit ? <AdviceRow label="止盈目标" value={advice.takeProfit} /> : null}
      </div>
      {advice.invalidIf ? (
        <div className="glow-card mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          失效条件：{advice.invalidIf}
        </div>
      ) : null}
    </>
  );
}

function EtfEvidencePanel({ evidence }: { evidence: NonNullable<NonNullable<AiAnalysisResult["dataQuality"]>["etfEvidence"]> }) {
  const liquidity = evidence.liquidity;
  return (
    <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-1 text-xs font-medium text-foreground">ETF 专属证据链</div>
        <Badge variant={etfEvidenceVariant(evidence.productIdentity.status)}>产品身份{etfEvidenceStatusLabel(evidence.productIdentity.status)}</Badge>
        <Badge variant={etfEvidenceVariant(liquidity.status)}>流动性代理{etfEvidenceStatusLabel(liquidity.status)}</Badge>
        <Badge variant="danger">跟踪质量缺失</Badge>
        <Badge variant="danger">折溢价缺失</Badge>
        <Badge variant="danger">管理人公告缺失</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <ScopeLine label="基金名称" value={evidence.productIdentity.name ?? "未确认"} />
        <ScopeLine label="交易所" value={evidence.productIdentity.exchange ?? "未确认"} />
        <ScopeLine label="流动性样本" value={`${liquidity.sampleTradingDays} 个完成交易日`} />
        <ScopeLine label="20 日平均成交量" value={liquidity.averageDailyVolume20 === null ? "--" : liquidity.averageDailyVolume20.toLocaleString("zh-CN")} />
        <ScopeLine label="20 日成交额代理" value={liquidity.averageDailyValueProxy20 === null ? "--" : liquidity.averageDailyValueProxy20.toLocaleString("zh-CN")} />
        <ScopeLine label="最新量比" value={liquidity.latestVolumeRatio20 === null ? "--" : `${liquidity.latestVolumeRatio20.toFixed(2)}x`} />
        <ScopeLine label="未来 K 线排除" value={`${liquidity.futureCandleExcludedCount} 根`} />
        <ScopeLine label="证据截止" value={liquidity.asOf ? formatTime(liquidity.asOf) : "--"} />
      </div>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">成交额代理 = 收盘价 × 提供方原始成交量，仅用于同源比较，不等同于已核验人民币成交额，也不能替代盘口价差、IOPV 或申赎状态。</p>
      <div className="mt-2 text-xs text-muted-foreground">仍缺：{evidence.missingFields.join("、")}</div>
    </div>
  );
}

function etfEvidenceVariant(status: "available" | "partial" | "unavailable") {
  return status === "available" ? "success" as const : status === "partial" ? "warning" as const : "danger" as const;
}

function etfEvidenceStatusLabel(status: "available" | "partial" | "unavailable") {
  return status === "available" ? "可用" : status === "partial" ? "部分" : "缺失";
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-background/35 p-3">
      <div className="mb-2 text-xs uppercase text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}

function ScopeLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-foreground">{value || "--"}</span>
    </div>
  );
}

function LevelList({ title, values, currency, symbol, unit }: { title: string; values: number[]; currency?: string; symbol?: string; unit?: string }) {
  return (
    <div className="glow-card rounded-xl border border-border p-3">
      <div className="mb-2 text-xs uppercase text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-2">
        {values.length ? (
          values.map((value) => (
            <span key={value} className="rounded bg-secondary px-2 py-1 text-sm tabular-nums">
              {formatPriceValue(value, { currency, symbol, unit })}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </div>
    </div>
  );
}

function AdviceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="glow-card grid gap-1 rounded-xl border border-border bg-background/40 px-3 py-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium sm:text-right">{value}</span>
    </div>
  );
}

function ActionGrid({
  item,
  currency,
  symbol,
  unit
}: {
  item: AiAnalysisResult["possibleActions"][number];
  currency?: string;
  symbol?: string;
  unit?: string;
}) {
  const rows = [
    ["触发条件", item.triggerCondition],
    ["参考区间", formatActionValue(item.entryZone, currency, symbol, unit)],
    ["止损计划", formatActionValue(item.stopLossPlan, currency, symbol, unit)],
    ["止盈计划", formatActionValue(item.takeProfitPlan, currency, symbol, unit)],
    ["仓位建议", item.positionSizing],
    ["复盘重点", item.followUpCheck]
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (!rows.length) return null;

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="glow-card rounded-lg border border-border bg-background/40 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="mt-1 text-sm leading-5 text-foreground">{value}</div>
        </div>
      ))}
    </div>
  );
}

function ReferenceList({
  items
}: {
  items: Array<{ title: string; source?: string | null; publishedAt?: string | null; url?: string | null; sentiment?: string | null; impactLevel?: string | null }>;
}) {
  if (!items.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {items.slice(0, 5).map((item) => (
        <NewsLink key={`${item.title}-${item.url ?? ""}`} item={item} />
      ))}
    </div>
  );
}

function formatActionValue(value?: string, currency?: string, symbol?: string, unit?: string) {
  if (!value) return "";
  void currency;
  void symbol;
  void unit;
  return value;
}

function SearchResultList({
  items
}: {
  items: Array<{ title: string; source?: string | null; publishedAt?: string | null; url?: string | null; summary?: string | null }>;
}) {
  if (!items.length) return <div className="text-sm text-muted-foreground">暂无联网检索结果。</div>;

  return (
    <div className="mt-3 space-y-2">
      {items.slice(0, 6).map((item) => (
        <NewsLink key={`${item.title}-${item.url ?? ""}`} item={item} summary={item.summary} />
      ))}
    </div>
  );
}

function NewsLink({
  item,
  summary
}: {
  item: { title: string; source?: string | null; publishedAt?: string | null; url?: string | null; sentiment?: string | null; impactLevel?: string | null };
  summary?: string | null;
}) {
  const meta = `${item.source ?? "未知来源"}${item.publishedAt ? ` · ${formatTime(item.publishedAt)}` : ""}${item.impactLevel ? ` · ${item.impactLevel}` : ""}`;

  return (
    <div className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2">
      {item.url ? (
        <a className="flex flex-col gap-1 hover:text-primary" href={item.url} target="_blank" rel="noreferrer">
          <span className="flex items-center gap-1 font-medium text-foreground">
            {item.title}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </span>
          <span className="text-xs text-muted-foreground">{meta}</span>
          {summary ? <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span> : null}
        </a>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{item.title}</span>
          <span className="text-xs text-muted-foreground">{meta}</span>
          {summary ? <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span> : null}
        </div>
      )}
    </div>
  );
}

function List({ values }: { values: string[] }) {
  return (
    <div className="space-y-2">
      {values.length ? (
        values.map((value, index) => (
          <div key={`${value}-${index}`} className="glow-card rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm">
            {value}
          </div>
        ))
      ) : (
        <div className="text-sm text-muted-foreground">--</div>
      )}
    </div>
  );
}

function formatConfidence(value: number) {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(0)}%`;
}

function formatSignedPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function newsSourceTierLabel(value: "primary_official" | "secondary_media" | "unknown") {
  if (value === "primary_official") return "一级/官方";
  if (value === "secondary_media") return "权威媒体";
  return "来源等级未确认";
}

function newsHorizonLabel(value: "days" | "quarters" | "long_term" | "unclear") {
  if (value === "days") return "数日";
  if (value === "quarters") return "数季";
  if (value === "long_term") return "长期";
  return "未确认";
}

function formatAction(action: string) {
  const map: Record<string, string> = {
    hold: "持有观察",
    watch: "观察",
    reduce: "降低仓位",
    consider_entry: "考虑入场",
    avoid: "回避"
  };
  return map[action] ?? action;
}

function actionTone(action?: string): "watch" | "wait" | "avoid" | "bullish" | "neutral" {
  const text = action ?? "";
  if (/回避|止损|减仓|离场|不建议/.test(text)) return "avoid";
  if (/等待|回调|观察|观望/.test(text)) return "wait";
  if (/入场|建仓|试探|加仓|增持/.test(text)) return "bullish";
  return "watch";
}

function formatCny10k(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 亿元`;
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万元`;
}

function formatMultiple(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} 倍` : "--";
}

function formatMetricPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "--";
}

function formatMetricNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";
}

function cashFlowQualityLabel(status: FundamentalCashFlowQualityStatus) {
  if (status === "available") return "完整可比";
  if (status === "partial") return "部分可比";
  if (status === "not_meaningful") return "归母净利非正，比例无意义";
  return "不可用";
}

function adjustedNetIncomeStatusLabel(status: "complete" | "partial" | "unavailable") {
  if (status === "complete") return "已覆盖";
  if (status === "partial") return "部分覆盖";
  return "缺失";
}

function historicalValuationStatusLabel(status: "available" | "partial" | "unavailable") {
  if (status === "available") return "已覆盖";
  if (status === "partial") return "样本不足";
  return "缺失";
}

function peerValuationStatusLabel(
  status: "available" | "partial" | "unavailable" | "conflicted",
  fresh: boolean
) {
  if (status === "available") return fresh ? "已覆盖" : "已过期";
  if (status === "conflicted") return "跨源冲突";
  if (status === "partial") return "样本不足";
  return "缺失";
}

function disclosureExtractionLabel(
  status: "metadata_only" | "extracted" | "analyzed",
  method?: "embedded_text" | "ocr" | "hybrid_ocr" | null
) {
  if (status === "metadata_only") return "原文未闭合";
  if (method === "ocr") return "OCR 全文";
  if (method === "hybrid_ocr") return "文本 + OCR 全文";
  return "文本全文";
}

function fundamentalFieldLabel(field: string) {
  const labels: Record<string, string> = {
    fundamentalSource: "法定财务来源",
    fiveAnnualPeriods: "5 年年度数据",
    eightStandaloneQuarters: "8 个独立季度",
    annualRevenue: "年度营收",
    annualParentNetIncome: "年度归母净利润",
    annualOperatingCashFlow: "年度经营现金流",
    freeCashFlow: "自由现金流",
    epsTtm: "每股收益 TTM",
    peTtm: "PE(TTM)",
    pb: "PB",
    adjustedNetIncome: "扣非净利润",
    adjustedNetIncomeTtm: "扣非净利润 TTM",
    fiveAnnualAdjustedNetIncomePeriods: "5 年扣非净利润",
    eightStandaloneAdjustedNetIncomeQuarters: "8 个独立季度扣非净利润",
    valuationHistoricalPercentile: "历史估值分位",
    peerValuation: "同行估值"
  };
  return labels[field] ?? field;
}

function decisionStatusLabel(status: NonNullable<AiAnalysisResult["decisionStatus"]>) {
  const labels: Record<NonNullable<AiAnalysisResult["decisionStatus"]>, string> = {
    insufficient_data: "证据不足",
    rejected: "暂不考虑",
    research_candidate: "继续研究",
    setup_wait: "等待条件",
    conditional_entry: "条件入场",
    manage_position: "持仓管理",
    exit_risk: "退出风险"
  };
  return labels[status];
}

function decisionStatusVariant(
  status: NonNullable<AiAnalysisResult["decisionStatus"]>
): "success" | "warning" | "danger" | "secondary" {
  if (status === "conditional_entry") return "success";
  if (status === "rejected" || status === "exit_risk") return "danger";
  if (status === "insufficient_data" || status === "setup_wait") return "warning";
  return "secondary";
}

function decisionStatusTone(
  status: NonNullable<AiAnalysisResult["decisionStatus"]>
): "watch" | "wait" | "avoid" | "bullish" | "neutral" {
  if (status === "conditional_entry") return "bullish";
  if (status === "rejected" || status === "exit_risk") return "avoid";
  if (status === "insufficient_data" || status === "setup_wait") return "wait";
  if (status === "manage_position") return "watch";
  return "neutral";
}

function decisionModeLabel(mode?: AiAnalysisResult["decisionMode"]) {
  if (mode === "position_management") return "持仓管理";
  if (mode === "long_term") return "长期研究";
  if (mode === "swing_trade") return "波段研究";
  return "旧版未记录";
}

function dataQualityStatusLabel(status: NonNullable<AiAnalysisResult["dataQuality"]>["status"]) {
  const labels: Record<NonNullable<AiAnalysisResult["dataQuality"]>["status"], string> = {
    complete: "完整",
    partial: "部分缺失",
    insufficient: "不足",
    conflicted: "存在冲突"
  };
  return labels[status];
}

function dataQualityVariant(
  status: NonNullable<AiAnalysisResult["dataQuality"]>["status"]
): "success" | "warning" | "danger" {
  if (status === "complete") return "success";
  if (status === "partial") return "warning";
  return "danger";
}

function strategyHeadline(analysis: AiAnalysisResult, action?: string) {
  if (analysis.decisionStatus === "insufficient_data") return "证据不足，暂不形成买入计划";
  if (analysis.decisionStatus === "rejected") return "当前不满足研究或买入标准";
  if (analysis.decisionStatus === "research_candidate") return "具备研究价值，尚未形成入场计划";
  if (analysis.decisionStatus === "setup_wait") return "方向可跟踪，等待明确触发条件";
  if (analysis.decisionStatus === "conditional_entry") return "条件入场，仅按风险计划执行";
  if (analysis.decisionStatus === "manage_position") return "进入持仓管理，重点跟踪失效条件";
  if (analysis.decisionStatus === "exit_risk") return "退出风险升高，优先执行保护动作";

  const trend = trendToStrategy(analysis.trend).label;
  if (/等待|回调|观察|观望/.test(action ?? "")) return `${trend}，但不宜追高`;
  if (/回避|止损|减仓|离场|不建议/.test(action ?? "")) return `${trend}，优先控制风险`;
  if (/入场|建仓|试探|加仓|增持/.test(action ?? "")) return `${trend}，等待触发条件`;
  return `${trend}，保持策略观察`;
}

function riskLevelText(values: string[]) {
  const text = values.join(" ");
  if (/高|重大|过热|止损|下跌|风险/.test(text)) return "高";
  if (values.length) return "中";
  return "低";
}

function formatTime(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN");
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN");
}
