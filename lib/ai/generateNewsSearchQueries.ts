import { createHash } from "node:crypto";

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";
import { getCache, setCache } from "@/lib/cache";

export type GenerateNewsSearchQueriesInput = {
  symbol: string;
  name?: string | null;
  sectorKeywords?: string[];
};

export type NewsSearchPlan = {
  assetType: string;
  primarySector: string;
  relatedDomains: string[];
  macroDrivers: string[];
  searchQueries: string[];
  excludedTerms: string[];
  fromAi: boolean;
};

export async function generateNewsSearchPlan(input: GenerateNewsSearchQueriesInput): Promise<NewsSearchPlan> {
  const fallback = fallbackPlan(input);
  if (!normalizeApiKey(process.env.OPENAI_API_KEY)) return fallback;

  const cacheKey = `news_search_plan:v1:${hash(
    JSON.stringify({
      symbol: input.symbol.toUpperCase(),
      name: input.name ?? "",
      sectorKeywords: input.sectorKeywords ?? []
    })
  )}`;
  const cached = await getCache<NewsSearchPlan>(cacheKey);
  if (cached) return cached;

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined
    });
    const request: ChatCompletionCreateParamsNonStreaming = {
      model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是一个谨慎的金融新闻搜索策略分析器。你不会编造新闻，只负责判断某个股票、ETF、指数或行业主题真正受哪些产业和宏观因素驱动，并生成适合联网搜索真实新闻的关键词。输出必须是严格 JSON，所有字段使用简体中文。"
        },
        {
          role: "user",
          content: `请先判断下面标的是什么类型、主要行业和真正影响它涨跌的驱动因素，然后生成用于联网搜索相关新闻的搜索策略。

标的代码：${input.symbol}
标的名称：${input.name ?? "未知"}
已有行业/主题关键词：${JSON.stringify(input.sectorKeywords ?? [])}

要求：
1. 不要只搜索股票代码、股票名称、ETF 净值、涨跌幅、成交额、上涨百分比这类无价值行情新闻。
2. 如果是 ETF、行业指数、主题基金，要优先搜索能影响整个板块的订单、招标、采购、政策、资本开支、供需、价格、监管、海外冲突等。
3. 如果是黄金、贵金属或金矿股，不能只搜“黄金”，还要覆盖美元指数、实际利率、美联储降息、央行购金、地缘冲突、战争、原油、通胀、关税、避险情绪、矿山成本和产量。
4. 如果是军工或国防，要覆盖地缘冲突、战争、军费、装备采购、出口管制、制裁、军贸订单。
5. 如果是油气、煤炭或能源，要覆盖 OPEC、原油库存、中东冲突、制裁、天然气、油价、供给扰动。
6. 如果是出口制造、消费电子或汽车，要覆盖关税、汇率、海外需求、供应链、政策补贴、订单和库存。
7. 如果是银行、保险或券商，要覆盖利率、地产信用风险、不良率、息差、监管政策、资本市场活跃度。
8. 如果是电网、电力设备或通信，要覆盖国家电网、南方电网、特高压、配电网改造、招标采购、算力网络、运营商资本开支。
9. searchQueries 要具体，最好 6-10 条，每条 4-10 个词，能直接用于 Tavily 或财经新闻 API 搜索。

只返回严格 JSON：
{
  "assetType": "股票 | ETF | 指数 | 商品资源股 | 金融 | 其他",
  "primarySector": "",
  "relatedDomains": [],
  "macroDrivers": [],
  "searchQueries": [],
  "excludedTerms": []
}`
        }
      ]
    };

    const completion = await createChatCompletion(client, request);
    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = parseJson(text);
    const plan = normalizePlan(parsed, fallback);
    await setCache(cacheKey, plan, numberEnv("NEWS_SEARCH_PLAN_TTL_SECONDS", 24 * 60 * 60));
    return plan;
  } catch {
    return fallback;
  }
}

export async function generateNewsSearchQueries(input: GenerateNewsSearchQueriesInput): Promise<string[]> {
  const plan = await generateNewsSearchPlan(input);
  return plan.searchQueries;
}

function fallbackPlan(input: GenerateNewsSearchQueriesInput): NewsSearchPlan {
  const compact = input.symbol.replace(/\.(SH|SZ|BJ|HK)$/i, "");
  const name = input.name?.trim();
  const sectors = (input.sectorKeywords ?? []).filter(Boolean).slice(0, 8);
  const joined = `${compact} ${name ?? ""} ${sectors.join(" ")}`;
  const lead = name || sectors.find(Boolean) || compact;
  const excludedTerms = ["涨幅", "跌幅", "净值", "成交额", "换手率", "实时行情", "技术分析"];

  if (includesAny(joined, ["黄金", "贵金属", "金矿", "赤峰黄金", "山东黄金", "中金黄金", "紫金矿业", "银泰黄金"])) {
    return makePlan({
      assetType: "商品资源股",
      primarySector: "黄金贵金属",
      relatedDomains: ["黄金", "贵金属", "金矿", "央行购金", "矿山成本"],
      macroDrivers: ["美元指数", "实际利率", "美联储降息", "地缘冲突", "战争", "原油", "通胀", "关税", "避险情绪"],
      searchQueries: [
        "黄金 美元指数 实际利率 美联储 降息",
        "黄金 地缘冲突 战争 避险情绪",
        "央行购金 黄金储备 贵金属",
        "黄金 原油 通胀 中东冲突",
        "黄金 关税 贸易战 避险",
        "金矿 成本 产量 并购"
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["军工", "国防", "航天", "航空发动机", "导弹", "船舶", "兵器"])) {
    return makePlan({
      assetType: "股票",
      primarySector: "军工国防",
      relatedDomains: ["军工", "国防装备", "军贸", "航空航天"],
      macroDrivers: ["地缘冲突", "战争", "军费预算", "出口管制", "制裁"],
      searchQueries: [
        "军工 装备采购 军费预算",
        "地缘冲突 国防 军工订单",
        "军贸订单 航空航天 装备出口",
        "出口管制 制裁 国防产业链",
        `${lead} 军工 订单 合同`
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["原油", "油气", "石油", "天然气", "煤炭", "能源"])) {
    return makePlan({
      assetType: "商品资源股",
      primarySector: "能源油气",
      relatedDomains: ["油气", "石油", "天然气", "煤炭", "能源设备"],
      macroDrivers: ["OPEC", "原油库存", "中东冲突", "制裁", "油价", "供给扰动"],
      searchQueries: [
        "OPEC 原油 减产 油价",
        "原油库存 油价 能源股",
        "中东冲突 原油 供给扰动",
        "天然气 价格 供需 能源",
        `${lead} 油气 订单 产量 成本`
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["电网", "电力设备", "特高压", "输变电", "配电网", "智能电网"])) {
    return makePlan({
      assetType: includesAny(joined, ["ETF", "基金", "指数", "联接"]) ? "ETF" : "股票",
      primarySector: "电网电力设备",
      relatedDomains: ["国家电网", "南方电网", "特高压", "输变电", "配电网", "智能电网", "电力设备"],
      macroDrivers: ["电网投资", "新型电力系统", "新能源并网", "设备更新"],
      searchQueries: [
        "国家电网 招标 采购 电力设备",
        "南方电网 招标 采购 配电设备",
        "特高压 输变电 项目 中标 订单",
        "配电网 改造 投资 电力设备",
        "新型电力系统 电网投资 设备更新"
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["通信", "光模块", "5G", "6G", "算力网络", "数据中心"])) {
    return makePlan({
      assetType: includesAny(joined, ["ETF", "基金", "指数", "联接"]) ? "ETF" : "股票",
      primarySector: "通信算力",
      relatedDomains: ["通信设备", "光模块", "算力网络", "数据中心", "运营商资本开支", "AI基础设施"],
      macroDrivers: ["云厂商资本开支", "AI算力需求", "运营商招标", "出口管制"],
      searchQueries: [
        "通信设备 招标 采购 运营商",
        "光模块 算力网络 数据中心 订单",
        "云厂商 资本开支 AI算力 光模块",
        "5G 6G 通信设备 政策 投资",
        "出口管制 光模块 通信设备"
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["芯片", "半导体", "AI芯片", "晶圆", "集成电路"])) {
    return makePlan({
      assetType: includesAny(joined, ["ETF", "基金", "指数", "联接"]) ? "ETF" : "股票",
      primarySector: "半导体芯片",
      relatedDomains: ["半导体", "AI芯片", "晶圆", "封测", "设备材料", "国产替代"],
      macroDrivers: ["出口管制", "AI算力需求", "云厂商资本开支", "产业政策"],
      searchQueries: [
        "半导体 政策 订单 设备 材料",
        "AI芯片 算力 产业链 投资",
        "出口管制 半导体 国产替代",
        "晶圆 产能 价格 需求",
        `${lead} 半导体 订单 合同`
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["新能源", "电动车", "汽车", "动力电池", "锂电", "储能"])) {
    return makePlan({
      assetType: includesAny(joined, ["ETF", "基金", "指数", "联接"]) ? "ETF" : "股票",
      primarySector: "新能源车储能",
      relatedDomains: ["新能源汽车", "动力电池", "储能", "锂电材料", "充电桩"],
      macroDrivers: ["补贴政策", "销量", "海外关税", "锂价", "库存", "出口需求"],
      searchQueries: [
        "新能源汽车 销量 政策 补贴",
        "动力电池 订单 扩产 产业链",
        "储能 招标 采购 电池",
        "海外关税 新能源汽车 出口",
        "锂价 电池材料 供需"
      ],
      excludedTerms
    });
  }

  if (includesAny(joined, ["银行", "保险", "券商", "证券", "金融"])) {
    return makePlan({
      assetType: "金融",
      primarySector: "金融",
      relatedDomains: ["银行", "保险", "券商", "信贷", "资本市场"],
      macroDrivers: ["利率", "息差", "地产信用风险", "不良率", "监管政策", "股市成交额"],
      searchQueries: [
        "银行 息差 利率 信贷 政策",
        "地产信用风险 银行 不良率",
        "资本市场 成交额 券商业绩",
        "金融监管 政策 银行 保险",
        `${lead} 业绩 信贷 风险`
      ],
      excludedTerms
    });
  }

  return makePlan({
    assetType: includesAny(joined, ["ETF", "基金", "指数", "联接"]) ? "ETF" : "股票",
    primarySector: sectors[0] || cleanGenericName(name) || "未知行业",
    relatedDomains: uniqueText([...(sectors.length ? sectors : [cleanGenericName(name) || lead]), "产业链", "订单", "政策"]),
    macroDrivers: ["政策变化", "行业景气度", "供需变化", "监管风险"],
    searchQueries: [
      `${lead} 行业 政策 投资`,
      `${lead} 订单 合同 招标 采购`,
      `${lead} 产业链 景气度 业绩`,
      ...sectors.slice(0, 3).map((sector) => `${sector} 政策 订单 需求`)
    ],
    excludedTerms
  });
}

function makePlan(input: Omit<NewsSearchPlan, "fromAi">): NewsSearchPlan {
  return {
    assetType: input.assetType || "其他",
    primarySector: input.primarySector || "未知行业",
    relatedDomains: cleanTerms(input.relatedDomains).slice(0, 12),
    macroDrivers: cleanTerms(input.macroDrivers).slice(0, 12),
    searchQueries: cleanQueries(input.searchQueries).slice(0, numberEnv("NEWS_AI_SEARCH_QUERY_LIMIT", 10)),
    excludedTerms: cleanTerms(input.excludedTerms).slice(0, 12),
    fromAi: false
  };
}

function normalizePlan(value: Record<string, unknown>, fallback: NewsSearchPlan): NewsSearchPlan {
  return {
    assetType: cleanOne(value.assetType) || fallback.assetType,
    primarySector: cleanOne(value.primarySector) || fallback.primarySector,
    relatedDomains: cleanTerms([...unknownArray(value.relatedDomains), ...fallback.relatedDomains]).slice(0, 12),
    macroDrivers: cleanTerms([...unknownArray(value.macroDrivers), ...fallback.macroDrivers]).slice(0, 12),
    searchQueries: cleanQueries([...unknownArray(value.searchQueries), ...fallback.searchQueries]).slice(
      0,
      numberEnv("NEWS_AI_SEARCH_QUERY_LIMIT", 10)
    ),
    excludedTerms: cleanTerms([...unknownArray(value.excludedTerms), ...fallback.excludedTerms]).slice(0, 12),
    fromAi: true
  };
}

function cleanQueries(values: unknown[]) {
  return uniqueText(
    values
      .map((value) => String(value ?? "").replace(/[“”"]/g, "").replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 4 && !isLowValueSearchQuery(value))
  );
}

function cleanTerms(values: unknown[]) {
  return uniqueText(values.map((value) => String(value ?? "").replace(/[“”"]/g, "").trim()).filter((value) => value.length >= 2));
}

function cleanOne(value: unknown) {
  return String(value ?? "").replace(/[“”"]/g, "").trim();
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    return {};
  }
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function cleanGenericName(value?: string | null) {
  return value?.replace(/ETF|LOF|QDII|基金|指数|联接|增强/gi, "").trim() || "";
}

function isLowValueSearchQuery(value: string) {
  return ["涨幅", "跌幅", "净值", "成交额", "换手率", "实时行情", "上涨百分比", "下跌百分比"].some((term) =>
    value.includes(term)
  );
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeApiKey(value?: string) {
  const key = value?.trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("CHANGE_ME") || key.includes("你的")) return null;
  return key;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
