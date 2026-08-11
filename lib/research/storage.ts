import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatGptResearchBundle, ResearchExportFile, ResearchSymbolData } from "@/lib/research/types";

const MAX_ARCHIVED_PACKAGES = 20;

export async function saveResearchBundle(bundle: ChatGptResearchBundle) {
  const directory = researchExportDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const timestamp = bundle.generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const baseName = `stocks-chatgpt-${timestamp}`;
  const markdownName = `${baseName}.md`;
  const jsonName = `${baseName}.json`;
  const markdown = formatResearchMarkdown(bundle);
  const json = JSON.stringify(bundle, null, 2);
  await Promise.all([
    writeFile(path.join(directory, markdownName), markdown, { encoding: "utf8", mode: 0o600 }),
    writeFile(path.join(directory, jsonName), json, { encoding: "utf8", mode: 0o600 }),
    writeFile(path.join(directory, "latest.md"), markdown, { encoding: "utf8", mode: 0o600 }),
    writeFile(path.join(directory, "latest.json"), json, { encoding: "utf8", mode: 0o600 })
  ]);
  await cleanupOldExports(directory);
  return listResearchExports([markdownName, jsonName]);
}

export async function listResearchExports(onlyNames?: string[]): Promise<ResearchExportFile[]> {
  const directory = researchExportDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const names = onlyNames ?? await readdir(directory);
  const files = await Promise.all(
    names
      .filter(isDownloadableResearchFile)
      .filter((name) => !name.startsWith("latest."))
      .map(async (name) => {
        const details = await stat(path.join(directory, name));
        return {
          name,
          format: name.endsWith(".md") ? "markdown" as const : "json" as const,
          size: details.size,
          createdAt: details.mtime.toISOString(),
          downloadUrl: `/api/research-export?file=${encodeURIComponent(name)}`
        };
      })
  );
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readResearchExport(name: string) {
  if (!isDownloadableResearchFile(name) || path.basename(name) !== name) throw new Error("研究包文件名无效。");
  const filePath = path.join(researchExportDirectory(), name);
  const [content, details] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    content,
    size: details.size,
    contentType: name.endsWith(".md") ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8"
  };
}

export function researchExportDirectory() {
  const configured = process.env.CHATGPT_EXPORT_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") return "/opt/stocks/exports/chatgpt";
  return path.join(process.cwd(), "exports", "chatgpt");
}

export function formatResearchMarkdown(bundle: ChatGptResearchBundle) {
  const lines = [
    `# ${bundle.title}`,
    "",
    `- 生成时间：${bundle.generatedAt}`,
    `- K 线范围：${bundle.range} / ${bundle.interval}`,
    `- 新闻窗口：近 ${bundle.newsDays} 天`,
    `- 标的：${bundle.requestedSymbols.join("、")}`,
    "",
    "## 给 ChatGPT 的任务",
    "",
    bundle.chatgptTask,
    "",
    "## 账户与策略状态",
    "",
    jsonBlock({ portfolio: bundle.portfolio, performance: bundle.performance, riskBudget: bundle.riskBudget, latestDecision: bundle.latestDecision }),
    ""
  ];

  if (bundle.forecast) {
    lines.push("## DeepSeek 概率场景", "", jsonBlock(bundle.forecast), "");
  }
  if (bundle.strategyBacktests.length) {
    lines.push("## 策略历史回测", "", "以下结果使用收盘信号、下一交易日开盘成交，并计入双边手续费与整手约束。策略只由前段训练数据选择，后段数据用于样本外验证。", "", jsonBlock({ portfolio: bundle.strategyBacktestPortfolio, symbols: bundle.strategyBacktests }), "");
    if (bundle.strategyBacktestPortfolio?.rollingGate) {
      lines.push("### 滚动门控审计", "", "每个滚动区间只使用此前数据决定下一段按全仓、半仓或暂停执行；ungated 为不启用门控，gated 为启用门控。", "", jsonBlock(bundle.strategyBacktestPortfolio.rollingGate), "");
    }
  }
  for (const item of bundle.symbols) lines.push(...formatSymbol(item));
  lines.push("## 风险声明", "", bundle.disclaimer, "");
  return lines.join("\n");
}

function formatSymbol(item: ResearchSymbolData) {
  const lines = [
    `## ${item.name ? `${item.name} ` : ""}${item.symbol}`,
    "",
    "### 当前状态",
    "",
    jsonBlock({
      quote: item.quote,
      position: item.position,
      indicators: item.indicators,
      historySummary: item.historySummary,
      historyError: item.historyError,
      latestAnalysis: item.latestAnalysis,
      executions: item.executions
    }),
    "",
    `### K 线 OHLCV（${item.candles.length} 根）`,
    "",
    "```csv",
    "timestamp,open,high,low,close,volume,change_pct,amplitude_pct",
    ...item.candles.map((candle) => [
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.changePct ?? "",
      candle.amplitudePct ?? ""
    ].join(",")),
    "```",
    "",
    `### 相关新闻（${item.news.length} 条）`,
    ""
  ];
  if (!item.news.length) lines.push("当前窗口没有匹配新闻。", "");
  for (const [index, news] of item.news.entries()) {
    lines.push(
      `#### ${index + 1}. ${escapeMarkdown(news.title)}`,
      "",
      `- 时间：${news.publishedAt}`,
      `- 来源：${news.source ?? "未知"}`,
      `- 情绪 / 重要性：${news.sentiment ?? "未知"} / ${news.importance ?? "未知"}`,
      `- 链接：${news.url ?? "无"}`,
      `- 摘要：${news.summary ?? "无"}`,
      `- 原文片段：${news.rawContent ?? "无"}`,
      `- AI 解读：${news.analysis ? JSON.stringify(news.analysis) : "无"}`,
      ""
    );
  }
  return lines;
}

function jsonBlock(value: unknown) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function escapeMarkdown(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/#/g, "\\#");
}

function isDownloadableResearchFile(name: string) {
  return /^stocks-chatgpt-\d{8}T\d{6}Z\.(md|json)$/.test(name);
}

async function cleanupOldExports(directory: string) {
  const files = (await readdir(directory))
    .filter(isDownloadableResearchFile)
    .sort()
    .reverse();
  const packages = [...new Set(files.map((name) => name.replace(/\.(md|json)$/, "")))];
  const stale = new Set(packages.slice(MAX_ARCHIVED_PACKAGES));
  await Promise.all(files.filter((name) => stale.has(name.replace(/\.(md|json)$/, ""))).map((name) => unlink(path.join(directory, name)).catch(() => undefined)));
}
