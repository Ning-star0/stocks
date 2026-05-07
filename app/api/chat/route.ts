import { NextResponse } from "next/server";

import { getAiConfig } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/currentUser";
import { AppError, apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeWatchlistItem } from "@/lib/serializers";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const message = String(body.message ?? "").trim();
    if (!message) throw new AppError("BAD_REQUEST", "请输入问题。");

    const config = await getAiConfig();
    if (!config.apiKey) throw new AppError("DATA_PROVIDER_ERROR", "API key 未配置，请在设置页面填写。");
    if (!config.baseUrl.startsWith("https://") && !config.baseUrl.startsWith("http://")) {
      throw new AppError("DATA_PROVIDER_ERROR", "API 地址配置异常，请在设置页面检查。");
    }

    const context = await buildChatContext(user.id);
    const systemPrompt = `你是一个谨慎的股票投资顾问，正在帮助用户分析他的投资组合。你可以看到用户的持仓、最近的AI分析结果和相关新闻。请基于这些上下文回答问题。不能给出确定性买卖指令，不能保证收益。使用简体中文回复。

当前时间：${new Date().toLocaleString("zh-CN")}

${context}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.5,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          thinking: { type: "disabled" }
        }),
        signal: controller.signal
      });

      const text = await response.text();

      if (!response.ok) {
        let errPayload: { error?: { message?: string } } = { error: undefined };
        try { errPayload = JSON.parse(text); } catch { /* not JSON */ }
        const errMsg = errPayload.error?.message || text.slice(0, 300) || response.statusText;
        throw new AppError("DATA_PROVIDER_ERROR", `AI 请求失败：${errMsg}`);
      }

      const payload = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = payload.choices?.[0]?.message?.content ?? "";

      return NextResponse.json({ reply });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return apiError(error);
  }
}

async function buildChatContext(userId: string) {
  const [watchlistItems, latestAnalyses, recentNews] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId } },
      take: 30
    }),
    prisma.aiAnalysis.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.newsItem.findMany({
      orderBy: { publishedAt: "desc" },
      take: 10
    })
  ]);

  const items = watchlistItems.map((item) => {
    const serialized = serializeWatchlistItem(item);
    return [
      `${item.symbol}${item.note ? ` (${item.note})` : ""}`,
      `持仓价: ${serialized.holdingPrice ?? "未设置"}`,
      `目标价: ${serialized.targetPrice ?? "未设置"}`,
      `止损价: ${serialized.stopLoss ?? "未设置"}`,
      `时间周期: ${serialized.timeHorizon ?? "未设置"}`,
      `风险等级: ${serialized.riskLevel ?? "未设置"}`
    ].join(" | ");
  });

  const analyses = latestAnalyses.map((a) => {
    const output = a.outputJson as { summary?: string; trend?: string; confidence?: number } | null;
    return `${a.symbol}: 趋势${output?.trend ?? "未知"}, 置信度${output?.confidence ?? 0}, ${output?.summary ?? ""}`;
  });

  const news = recentNews.map((n) => `${n.title} (${n.source ?? "未知来源"})`);

  return [
    "=== 用户持仓 ===",
    ...(items.length ? items : ["暂无持仓"]),
    "",
    "=== 最新AI分析摘要 ===",
    ...(analyses.length ? analyses : ["暂无分析"]),
    "",
    "=== 近期新闻 ===",
    ...(news.length ? news : ["暂无新闻"])
  ].join("\n");
}
