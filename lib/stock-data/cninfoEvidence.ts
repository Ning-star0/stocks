import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import type {
  CompanyEvidenceOptions,
  DisclosureEvidence,
  DisclosureEvidenceItem,
  FinancialPeriodEvidence,
  FundamentalEvidence
} from "@/lib/stock-data/types";

const CNINFO_ORIGIN = "https://www.cninfo.com.cn";
const CNINFO_DATA_ORIGIN = `${CNINFO_ORIGIN}/data20`;
const REQUEST_TIMEOUT_MS = 15_000;
const DISCLOSURE_WINDOW_DAYS = 180;
// 巨潮当前公告接口单页实际上限为 30；请求更大仍只返回 30，必须按真实上限翻页。
const DISCLOSURE_PAGE_SIZE = 30;
const DISCLOSURE_MAX_PAGES = 4;
const PERIODIC_REPORT_LOOKBACK_YEARS = 6;
const PERIODIC_REPORT_CATEGORIES = "category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh";

type CninfoEnvelope = {
  code?: number;
  data?: {
    resultMsg?: string;
    records?: unknown[];
  };
};

type CninfoFinancialRecord = {
  year?: Array<Record<string, unknown>>;
  middle?: Array<Record<string, unknown>>;
  one?: Array<Record<string, unknown>>;
  three?: Array<Record<string, unknown>>;
};

type CninfoStockEntry = {
  code?: string;
  orgId?: string;
  zwjc?: string;
};

type CninfoAnnouncement = {
  secCode?: string;
  secName?: string;
  announcementId?: string;
  announcementTitle?: string;
  announcementTime?: number;
  adjunctUrl?: string;
};

let stockDirectoryCache: { expiresAt: number; byCode: Map<string, CninfoStockEntry> } | null = null;

export async function fetchCninfoFundamentals(input: {
  code: string;
  symbol: string;
  options?: CompanyEvidenceOptions;
}): Promise<FundamentalEvidence> {
  const fetchedAt = new Date().toISOString();
  const sourceUrl = `${CNINFO_ORIGIN}/new/disclosure/stock?stockCode=${encodeURIComponent(input.code)}&type=info`;
  try {
    const company = await getCninfoJson(`${CNINFO_DATA_ORIGIN}/companyOverview/getCompanyInfo?scode=${encodeURIComponent(input.code)}`, input.options);
    const companyRecord = firstRecord(company);
    const sign = finiteNumber(companyRecord.F002N);
    if (sign === null) throw new AppError("DATA_PROVIDER_ERROR", `巨潮未返回 ${input.symbol} 的财务查询标识。`);

    const query = `scode=${encodeURIComponent(input.code)}&sign=${encodeURIComponent(String(sign))}`;
    const [main, income, cashFlow] = await Promise.all([
      getCninfoJson(`${CNINFO_DATA_ORIGIN}/financialData/getMainIndicators?${query}`, input.options),
      getCninfoJson(`${CNINFO_DATA_ORIGIN}/financialData/getIncomeStatement?${query}`, input.options),
      getCninfoJson(`${CNINFO_DATA_ORIGIN}/financialData/getCashFlowStatement?${query}`, input.options)
    ]);

    return buildCninfoFundamentalEvidence({
      symbol: input.symbol,
      fetchedAt,
      sourceUrl,
      price: input.options?.price ?? null,
      priceAsOf: input.options?.priceAsOf ?? null,
      mainRecord: firstFinancialRecord(main),
      incomeRecord: firstFinancialRecord(income),
      cashFlowRecord: firstFinancialRecord(cashFlow)
    });
  } catch (error) {
    const reason = errorMessage(error);
    return unavailableFundamentals(fetchedAt, sourceUrl, reason);
  }
}

export async function fetchCninfoDisclosures(input: {
  code: string;
  symbol: string;
  exchange: "SH" | "SZ" | "BJ";
  options?: CompanyEvidenceOptions;
}): Promise<DisclosureEvidence> {
  const checkedAt = new Date();
  const queryUrl = `${CNINFO_ORIGIN}/new/hisAnnouncement/query`;
  const windowTo = shanghaiDateKey(checkedAt);
  const windowFromDate = new Date(checkedAt.getTime() - DISCLOSURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowFrom = shanghaiDateKey(windowFromDate);

  try {
    if (input.exchange === "BJ") {
      return uncheckedDisclosures(queryUrl, `北交所公告查询参数尚未完成固定样本验证，未将 ${input.symbol} 标记为已核对。`);
    }
    const directory = await getCninfoStockDirectory(input.options);
    const stock = directory.get(input.code);
    if (!stock?.orgId) throw new AppError("DATA_PROVIDER_ERROR", `巨潮证券列表未找到 ${input.symbol} 的机构标识。`);

    const params = new URLSearchParams({
      pageNum: "1",
      pageSize: String(DISCLOSURE_PAGE_SIZE),
      column: input.exchange === "SH" ? "sse" : "szse",
      tabName: "fulltext",
      plate: input.exchange === "SH" ? "sh" : "sz",
      stock: `${input.code},${stock.orgId}`,
      searchkey: "",
      secid: "",
      category: "",
      trade: "",
      seDate: `${windowFrom}~${windowTo}`,
      sortName: "time",
      sortType: "desc",
      isHLtitle: "true"
    });
    const periodicWindowFrom = `${Number(windowTo.slice(0, 4)) - PERIODIC_REPORT_LOOKBACK_YEARS}-01-01`;
    const periodicParams = new URLSearchParams(params);
    periodicParams.set("category", PERIODIC_REPORT_CATEGORIES);
    periodicParams.set("seDate", `${periodicWindowFrom}~${windowTo}`);
    // 巨潮对突发并发较敏感；公告分页串行拉取，避免把完整性增强变成额外限流风险。
    const recentPageSet = await fetchCninfoAnnouncementPages(queryUrl, params, input.options);
    const periodicPageSet = await fetchCninfoAnnouncementPages(queryUrl, periodicParams, input.options);
    const recentItems = recentPageSet.rows
      .map((row) => normalizeDisclosure(row, input.symbol))
      .filter((item): item is DisclosureEvidenceItem => Boolean(item));
    const periodicItems = periodicPageSet.rows
      .map((row) => normalizeDisclosure(row, input.symbol))
      .filter((item): item is DisclosureEvidenceItem => Boolean(item))
      .filter(isFundamentalPeriodicReport)
      .map((item) => ({ ...item, isCritical: false, isFundamentalSource: true }));
    const byId = new Map<string, DisclosureEvidenceItem>();
    for (const item of [...periodicItems, ...recentItems]) {
      const previous = byId.get(item.id);
      byId.set(item.id, {
        ...previous,
        ...item,
        isCritical: Boolean(previous?.isCritical || item.isCritical),
        isFundamentalSource: Boolean(previous?.isFundamentalSource || item.isFundamentalSource)
      });
    }
    const items = [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const latestPublishedAt = items.map((item) => item.publishedAt).sort().at(-1) ?? null;
    const truncated = recentPageSet.truncated || periodicPageSet.truncated;
    const failures = truncated ? ["巨潮公告分页超过安全上限，当前公告证据不完整。"] : [];

    return {
      schemaVersion: "disclosure-evidence-v2",
      status: truncated ? "partial" : "checked",
      provider: "CNINFO",
      queryUrl,
      checkedAt: checkedAt.toISOString(),
      windowFrom: periodicWindowFrom,
      windowTo,
      latestPublishedAt,
      totalCount: Math.max(recentPageSet.totalCount, items.length),
      criticalUnreadCount: items.filter((item) => item.isCritical && item.contentStatus !== "analyzed").length,
      items,
      failures
    };
  } catch (error) {
    return {
      ...uncheckedDisclosures(queryUrl, errorMessage(error)),
      checkedAt: checkedAt.toISOString(),
      windowFrom,
      windowTo
    };
  }
}

export function buildCninfoFundamentalEvidence(input: {
  symbol: string;
  fetchedAt: string;
  sourceUrl: string;
  price: number | null;
  priceAsOf: string | null;
  mainRecord: CninfoFinancialRecord;
  incomeRecord: CninfoFinancialRecord;
  cashFlowRecord: CninfoFinancialRecord;
}): FundamentalEvidence {
  const indicators = collectIndicatorPeriods(input.mainRecord);
  const cumulative = collectCumulativeFinancials(input.incomeRecord, input.cashFlowRecord);
  const annualPeriods = buildAnnualPeriods(cumulative, indicators).slice(0, 5);
  const quarterlyPeriods = buildStandaloneQuarters(cumulative, indicators).slice(0, 8);
  const latestIndicator = [...indicators.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0] ?? null;
  const reportPeriod = [annualPeriods[0]?.periodEnd, quarterlyPeriods[0]?.periodEnd, latestIndicator?.periodEnd]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const epsTtm = calculateEpsTtm(indicators, reportPeriod);
  const revenueTtm = calculateFinancialTtm(cumulative, reportPeriod, "revenue");
  const parentNetIncomeTtm = calculateFinancialTtm(cumulative, reportPeriod, "parentNetIncome");
  const operatingCashFlowTtm = calculateFinancialTtm(cumulative, reportPeriod, "operatingCashFlow");
  const capitalExpenditureTtm = calculateFinancialTtm(cumulative, reportPeriod, "capitalExpenditure");
  const freeCashFlowTtm = calculateFinancialTtm(cumulative, reportPeriod, "freeCashFlow");
  const operatingCashFlowToParentNetIncomeTtm = ratioToPositiveDenominator(operatingCashFlowTtm, parentNetIncomeTtm);
  const freeCashFlowToParentNetIncomeTtm = ratioToPositiveDenominator(freeCashFlowTtm, parentNetIncomeTtm);
  const freeCashFlowMarginTtmPct = ratioToPositiveDenominator(freeCashFlowTtm, revenueTtm, 100);
  const latestBookValue = latestIndicator?.bookValuePerShare ?? null;
  const peTtm = positiveRatio(input.price, epsTtm);
  const pb = positiveRatio(input.price, latestBookValue);
  const latestAnnual = annualPeriods[0] ?? null;
  const latestQuarter = quarterlyPeriods[0] ?? null;
  const missingFields = uniqueStrings([
    ...(annualPeriods.length < 5 ? ["fiveAnnualPeriods"] : []),
    ...(quarterlyPeriods.length < 8 ? ["eightStandaloneQuarters"] : []),
    ...(latestAnnual?.revenue === null ? ["annualRevenue"] : []),
    ...(latestAnnual?.parentNetIncome === null ? ["annualParentNetIncome"] : []),
    ...(latestAnnual?.operatingCashFlow === null ? ["annualOperatingCashFlow"] : []),
    ...(freeCashFlowTtm === null ? ["freeCashFlow"] : []),
    ...(epsTtm === null ? ["epsTtm"] : []),
    ...(peTtm === null ? ["peTtm"] : []),
    ...(pb === null ? ["pb"] : []),
    "adjustedNetIncome",
    "valuationHistoricalPercentile",
    "peerValuation"
  ]);
  const coreAvailable = Boolean(reportPeriod && annualPeriods.length && quarterlyPeriods.length);
  const status = !coreAvailable ? "unavailable" : missingFields.length ? "partial" : "available";

  return {
    schemaVersion: "fundamental-evidence-v2",
    status,
    provider: "CNINFO",
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt,
    reportPeriod,
    annualPeriods,
    quarterlyPeriods,
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: input.priceAsOf,
      price: input.price,
      epsTtm,
      peTtm,
      bookValuePerShare: latestBookValue,
      pb,
      historicalPercentile: null,
      historicalEvidence: null
    },
    metrics: {
      latestAnnualRevenueCny10k: latestAnnual?.revenue ?? null,
      latestAnnualParentNetIncomeCny10k: latestAnnual?.parentNetIncome ?? null,
      latestAnnualOperatingCashFlowCny10k: latestAnnual?.operatingCashFlow ?? null,
      latestAnnualCapitalExpenditureCny10k: latestAnnual?.capitalExpenditure ?? null,
      latestAnnualFreeCashFlowCny10k: latestAnnual?.freeCashFlow ?? null,
      revenueTtmCny10k: revenueTtm,
      parentNetIncomeTtmCny10k: parentNetIncomeTtm,
      operatingCashFlowTtmCny10k: operatingCashFlowTtm,
      capitalExpenditureTtmCny10k: capitalExpenditureTtm,
      freeCashFlowTtmCny10k: freeCashFlowTtm,
      operatingCashFlowToParentNetIncomeTtm,
      freeCashFlowToParentNetIncomeTtm,
      freeCashFlowMarginTtmPct,
      latestQuarterRevenueCny10k: latestQuarter?.revenue ?? null,
      latestQuarterParentNetIncomeCny10k: latestQuarter?.parentNetIncome ?? null,
      latestRoePct: latestIndicator?.roePct ?? null,
      latestDebtToAssetsPct: latestIndicator?.debtToAssetsPct ?? null,
      peTtm,
      pb
    },
    missingFields,
    conflictingFields: [],
    failures: [],
    missingReason: missingFields.length ? `尚缺：${missingFields.join("、")}` : null
  };
}

function collectIndicatorPeriods(record: CninfoFinancialRecord) {
  const output = new Map<string, FinancialPeriodEvidence>();
  for (const rows of [record.one, record.middle, record.three, record.year]) {
    for (const row of rows ?? []) {
      const periodEnd = text(row.ENDDATE);
      if (!periodEnd) continue;
      output.set(periodEnd, {
        periodEnd,
        periodType: periodEnd.endsWith("12-31") ? "annual" : "quarter",
        currency: "CNY",
        unit: "CNY_10K",
        revenue: null,
        parentNetIncome: null,
        adjustedParentNetIncome: null,
        operatingCashFlow: null,
        capitalExpenditure: null,
        freeCashFlow: null,
        eps: finiteNumber(row.F004N),
        bookValuePerShare: finiteNumber(row.F008N),
        roePct: finiteNumber(row.F067N),
        debtToAssetsPct: finiteNumber(row.F041N),
        grossMarginPct: finiteNumber(row.F078N),
        netMarginPct: finiteNumber(row.F017N),
        revenueGrowthPct: finiteNumber(row.F052N),
        netIncomeGrowthPct: finiteNumber(row.F053N)
      });
    }
  }
  return output;
}

type CumulativeValues = {
  periodEnd: string;
  revenue: number | null;
  parentNetIncome: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  freeCashFlow: number | null;
};

function collectCumulativeFinancials(income: CninfoFinancialRecord, cashFlow: CninfoFinancialRecord) {
  const output = new Map<string, CumulativeValues>();
  const bucketConfig = [
    ["one", "03-31"],
    ["middle", "06-30"],
    ["three", "09-30"],
    ["year", "12-31"]
  ] as const;
  for (const [bucket, suffix] of bucketConfig) {
    const incomeRows = income[bucket] ?? [];
    const cashRows = cashFlow[bucket] ?? [];
    const revenueRow = findMetricRow(incomeRows, ["营业收入", "营业总收入"]);
    const netIncomeRow = findMetricRow(incomeRows, ["归属母公司净利润", "归属于母公司所有者的净利润", "归属于上市公司股东的净利润"]);
    const cashRow = findMetricRow(cashRows, ["经营活动产生的现金流量净额"]);
    const capitalExpenditureRow = findMetricRow(cashRows, ["购建固定资产、无形资产和其他长期资产支付的现金"]);
    const years = uniqueStrings([
      ...metricYears(revenueRow),
      ...metricYears(netIncomeRow),
      ...metricYears(cashRow),
      ...metricYears(capitalExpenditureRow)
    ]);
    for (const year of years) {
      const periodEnd = `${year}-${suffix}`;
      const operatingCashFlow = finiteNumber(cashRow?.[year]);
      const capitalExpenditure = finiteNumber(capitalExpenditureRow?.[year]);
      output.set(periodEnd, {
        periodEnd,
        revenue: finiteNumber(revenueRow?.[year]),
        parentNetIncome: finiteNumber(netIncomeRow?.[year]),
        operatingCashFlow,
        capitalExpenditure,
        freeCashFlow: subtractNullable(operatingCashFlow, capitalExpenditure)
      });
    }
  }
  return output;
}

function buildAnnualPeriods(cumulative: Map<string, CumulativeValues>, indicators: Map<string, FinancialPeriodEvidence>) {
  return [...cumulative.values()]
    .filter((item) => item.periodEnd.endsWith("12-31"))
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .map((item) => mergePeriod(item, indicators.get(item.periodEnd), "annual"));
}

function buildStandaloneQuarters(cumulative: Map<string, CumulativeValues>, indicators: Map<string, FinancialPeriodEvidence>) {
  const output: FinancialPeriodEvidence[] = [];
  const years = uniqueStrings([...cumulative.keys()].map((date) => date.slice(0, 4))).sort().reverse();
  for (const year of years) {
    const q1 = cumulative.get(`${year}-03-31`);
    const h1 = cumulative.get(`${year}-06-30`);
    const q3 = cumulative.get(`${year}-09-30`);
    const fy = cumulative.get(`${year}-12-31`);
    if (q1) output.push(mergeStandalonePeriod(q1, undefined, indicators, "quarter"));
    if (h1 && q1) output.push(mergeStandalonePeriod(h1, q1, indicators, "quarter"));
    if (q3 && h1) output.push(mergeStandalonePeriod(q3, h1, indicators, "quarter"));
    if (fy && q3) output.push(mergeStandalonePeriod(fy, q3, indicators, "quarter"));
  }
  return output.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

function mergeStandalonePeriod(
  current: CumulativeValues,
  previous: CumulativeValues | undefined,
  indicators: Map<string, FinancialPeriodEvidence>,
  periodType: "quarter"
) {
  const currentIndicator = indicators.get(current.periodEnd);
  const previousIndicator = previous ? indicators.get(previous.periodEnd) : undefined;
  return {
    ...mergePeriod(subtractCumulative(current, previous), currentIndicator, periodType),
    // 巨潮的一季报、半年报、三季报和年报 EPS 均为年初至报告期末累计值；
    // 独立季度口径必须做差，不能把累计 EPS 伪装成单季 EPS。
    eps: previous
      ? subtractNullable(currentIndicator?.eps ?? null, previousIndicator?.eps)
      : currentIndicator?.eps ?? null
  } satisfies FinancialPeriodEvidence;
}

function mergePeriod(values: CumulativeValues, indicator: FinancialPeriodEvidence | undefined, periodType: "quarter" | "annual") {
  return {
    ...(indicator ?? emptyFinancialPeriod(values.periodEnd, periodType)),
    periodType,
    revenue: values.revenue,
    parentNetIncome: values.parentNetIncome,
    operatingCashFlow: values.operatingCashFlow,
    capitalExpenditure: values.capitalExpenditure,
    freeCashFlow: values.freeCashFlow
  } satisfies FinancialPeriodEvidence;
}

function subtractCumulative(current: CumulativeValues, previous: CumulativeValues | undefined): CumulativeValues {
  if (!previous) return current;
  return {
    periodEnd: current.periodEnd,
    revenue: subtractNullable(current.revenue, previous?.revenue),
    parentNetIncome: subtractNullable(current.parentNetIncome, previous?.parentNetIncome),
    operatingCashFlow: subtractNullable(current.operatingCashFlow, previous.operatingCashFlow),
    capitalExpenditure: subtractNullable(current.capitalExpenditure, previous.capitalExpenditure),
    freeCashFlow: subtractNullable(current.freeCashFlow, previous.freeCashFlow)
  };
}

function calculateEpsTtm(indicators: Map<string, FinancialPeriodEvidence>, latestPeriod: string | null) {
  if (!latestPeriod) return null;
  const latest = indicators.get(latestPeriod)?.eps ?? null;
  if (latest === null) return null;
  if (latestPeriod.endsWith("12-31")) return round(latest);
  const year = Number(latestPeriod.slice(0, 4));
  const suffix = latestPeriod.slice(4);
  const previousAnnual = indicators.get(`${year - 1}-12-31`)?.eps ?? null;
  const previousComparable = indicators.get(`${year - 1}${suffix}`)?.eps ?? null;
  if (previousAnnual === null || previousComparable === null) return null;
  return round(latest + previousAnnual - previousComparable);
}

function calculateFinancialTtm(
  cumulative: Map<string, CumulativeValues>,
  latestPeriod: string | null,
  field: Exclude<keyof CumulativeValues, "periodEnd">
) {
  if (!latestPeriod) return null;
  const latest = cumulative.get(latestPeriod)?.[field] ?? null;
  if (latest === null) return null;
  if (latestPeriod.endsWith("12-31")) return round(latest);
  const year = Number(latestPeriod.slice(0, 4));
  const suffix = latestPeriod.slice(4);
  const previousAnnual = cumulative.get(`${year - 1}-12-31`)?.[field] ?? null;
  const previousComparable = cumulative.get(`${year - 1}${suffix}`)?.[field] ?? null;
  if (previousAnnual === null || previousComparable === null) return null;
  return round(latest + previousAnnual - previousComparable);
}

function normalizeDisclosure(row: CninfoAnnouncement, symbol: string): DisclosureEvidenceItem | null {
  const id = text(row.announcementId);
  const title = stripHtml(text(row.announcementTitle));
  const publishedAt = typeof row.announcementTime === "number" ? new Date(row.announcementTime).toISOString() : null;
  if (!id || !title || !publishedAt) return null;
  const category = classifyCninfoDisclosureTitle(title);
  return {
    id,
    symbol,
    companyName: text(row.secName),
    title,
    publishedAt,
    category,
    source: "CNINFO",
    sourceUrl: row.adjunctUrl ? `${CNINFO_ORIGIN.replace("www.", "static.")}/${row.adjunctUrl.replace(/^\/+/, "")}` : CNINFO_ORIGIN,
    contentStatus: "metadata_only",
    contentHash: null,
    contentExcerpt: null,
    extractedCharacters: 0,
    extractionFailure: null,
    isCritical: isCriticalCninfoDisclosure(category, title),
    isFundamentalSource: false,
    adjustedNetIncomeFact: null
  };
}

export function classifyCninfoDisclosureTitle(title: string): DisclosureEvidenceItem["category"] {
  if (/年度报告|半年度报告|季度报告/.test(title)) return "periodic_report";
  if (/业绩预告|业绩快报|盈利预测|业绩说明/.test(title)) return "earnings";
  if (/问询|监管|处罚|处分|立案|警示函/.test(title)) return "regulatory";
  if (/诉讼|仲裁/.test(title)) return "litigation";
  if (/回购|增持|减持|质押|解禁|分红|利润分配|股本|重组|并购/.test(title)) return "capital_action";
  if (/合同|订单|中标|投资|收购|出售/.test(title)) return "major_contract";
  if (/风险提示|异常波动|停牌|复牌|退市/.test(title)) return "risk_notice";
  return "other";
}

export function isCriticalCninfoDisclosure(category: DisclosureEvidenceItem["category"], title: string) {
  if (category === "other") return false;
  // 业绩说明会的召开通知不包含经营事实；定期报告摘要与完整报告重复，保留完整报告为关键原文。
  if (/业绩说明会/.test(title)) return false;
  if (category === "periodic_report" && /摘要/.test(title)) return false;
  return true;
}

async function getCninfoStockDirectory(options?: CompanyEvidenceOptions) {
  if (stockDirectoryCache && stockDirectoryCache.expiresAt > Date.now() && !options?.forceRefresh) return stockDirectoryCache.byCode;
  const payload = await getCninfoJson(`${CNINFO_ORIGIN}/new/data/szse_stock.json`, options) as { stockList?: CninfoStockEntry[] };
  const byCode = new Map<string, CninfoStockEntry>();
  for (const row of payload.stockList ?? []) {
    if (row.code) byCode.set(row.code, row);
  }
  if (!byCode.size) throw new AppError("DATA_PROVIDER_ERROR", "巨潮证券列表为空。");
  stockDirectoryCache = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, byCode };
  return byCode;
}

async function getCninfoJson(url: string, options?: CompanyEvidenceOptions) {
  const response = await fetch(url, requestInit("GET", options));
  if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `巨潮请求失败：HTTP ${response.status}`);
  return readProviderJsonResponse<unknown>(response, "巨潮资讯");
}

async function postCninfoJson(url: string, body: URLSearchParams, options?: CompanyEvidenceOptions) {
  const response = await fetch(url, {
    ...requestInit("POST", options),
    headers: { ...requestHeaders(), "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: body.toString()
  });
  if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `巨潮公告请求失败：HTTP ${response.status}`);
  return readProviderJsonResponse<unknown>(response, "巨潮公告");
}

function requestInit(method: "GET" | "POST", options?: CompanyEvidenceOptions): RequestInit {
  return {
    method,
    headers: requestHeaders(),
    cache: options?.forceRefresh ? "no-store" : "default",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };
}

function requestHeaders() {
  return {
    Referer: `${CNINFO_ORIGIN}/`,
    "User-Agent": "Mozilla/5.0 StockAI/1.0",
    Accept: "application/json, text/plain, */*"
  };
}

function firstRecord(payload: unknown) {
  const envelope = payload as CninfoEnvelope;
  const row = envelope.data?.records?.[0];
  if (envelope.code !== 200 || envelope.data?.resultMsg !== "success" || !isRecord(row)) {
    throw new AppError("DATA_PROVIDER_ERROR", "巨潮公司信息响应缺少有效记录。");
  }
  return row;
}

function firstFinancialRecord(payload: unknown): CninfoFinancialRecord {
  return firstRecord(payload) as CninfoFinancialRecord;
}

function findMetricRow(rows: Array<Record<string, unknown>>, labels: string[]) {
  return rows.find((row) => labels.includes(text(row.index)))
    ?? rows.find((row) => labels.some((label) => text(row.index).includes(label)))
    ?? null;
}

function metricYears(row: Record<string, unknown> | null) {
  return row ? Object.keys(row).filter((key) => /^\d{4}$/.test(key)) : [];
}

function emptyFinancialPeriod(periodEnd: string, periodType: "quarter" | "annual"): FinancialPeriodEvidence {
  return {
    periodEnd,
    periodType,
    currency: "CNY",
    unit: "CNY_10K",
    revenue: null,
    parentNetIncome: null,
    adjustedParentNetIncome: null,
    operatingCashFlow: null,
    capitalExpenditure: null,
    freeCashFlow: null,
    eps: null,
    bookValuePerShare: null,
    roePct: null,
    debtToAssetsPct: null,
    grossMarginPct: null,
    netMarginPct: null,
    revenueGrowthPct: null,
    netIncomeGrowthPct: null
  };
}

function unavailableFundamentals(fetchedAt: string, sourceUrl: string, reason: string): FundamentalEvidence {
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "unavailable",
    provider: "CNINFO",
    sourceUrl,
    fetchedAt,
    reportPeriod: null,
    annualPeriods: [],
    quarterlyPeriods: [],
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: null,
      price: null,
      epsTtm: null,
      peTtm: null,
      bookValuePerShare: null,
      pb: null,
      historicalPercentile: null,
      historicalEvidence: null
    },
    metrics: {},
    missingFields: ["fundamentalSource"],
    conflictingFields: [],
    failures: [reason],
    missingReason: reason
  };
}

function uncheckedDisclosures(queryUrl: string, reason: string): DisclosureEvidence {
  return {
    schemaVersion: "disclosure-evidence-v2",
    status: "unchecked",
    provider: "CNINFO",
    queryUrl,
    checkedAt: null,
    windowFrom: null,
    windowTo: null,
    latestPublishedAt: null,
    totalCount: 0,
    criticalUnreadCount: 0,
    items: [],
    failures: [reason]
  };
}

async function fetchCninfoAnnouncementPages(
  url: string,
  baseParams: URLSearchParams,
  options?: CompanyEvidenceOptions
) {
  const rows: CninfoAnnouncement[] = [];
  let totalCount = 0;
  for (let page = 1; page <= DISCLOSURE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams(baseParams);
    params.set("pageNum", String(page));
    const payload = await postCninfoJson(url, params, options) as {
      totalAnnouncement?: number;
      announcements?: CninfoAnnouncement[];
    };
    const pageRows = Array.isArray(payload.announcements) ? payload.announcements : [];
    totalCount = Math.max(totalCount, Number(payload.totalAnnouncement) || 0);
    rows.push(...pageRows);
    if (!pageRows.length || rows.length >= totalCount || pageRows.length < DISCLOSURE_PAGE_SIZE) break;
  }
  return { rows, totalCount, truncated: totalCount > rows.length };
}

function isFundamentalPeriodicReport(item: DisclosureEvidenceItem) {
  return item.category === "periodic_report" && !/摘要|英文版|取消/.test(item.title);
}

function subtractNullable(current: number | null, previous: number | null | undefined) {
  if (current === null || previous === null || previous === undefined) return null;
  return round(current - previous);
}

function positiveRatio(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || numerator <= 0 || denominator <= 0) return null;
  return round(numerator / denominator);
}

function ratioToPositiveDenominator(numerator: number | null, denominator: number | null, multiplier = 1) {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round((numerator / denominator) * multiplier);
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function shanghaiDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
