import { getAiConfig } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/currentUser";
import { AppError } from "@/lib/errors";
import { addMemoryEntries, appendMemory, getMemoryContent } from "@/lib/memory";
import { prisma } from "@/lib/prisma";
import { serializeWatchlistItem } from "@/lib/serializers";

const MEMORY_TAG = /\[MEMORY:([\s\S]*?)\]/g;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const message = String(body.message ?? "").trim();
    if (!message) throw new AppError("BAD_REQUEST", "请输入问题。");

    const explicitMemories = extractExplicitMemories(message);
    let explicitMemorySaved = false;
    if (explicitMemories.length) {
      try {
        await addMemoryEntries(user.id, explicitMemories, "manual");
        explicitMemorySaved = true;
      } catch {
        explicitMemorySaved = false;
      }
    }

    const config = await getAiConfig();
    if (!config.apiKey) throw new AppError("DATA_PROVIDER_ERROR", "API key 未配置，请在设置页面填写。");
    if (!config.baseUrl.startsWith("https://") && !config.baseUrl.startsWith("http://")) {
      throw new AppError("DATA_PROVIDER_ERROR", "API 地址配置异常，请在设置页面检查。");
    }

    const context = await buildChatContext(user.id);
    const systemPrompt = `你是一个谨慎的股票投资顾问，正在帮助用户分析他的投资组合。你可以看到用户的持仓、最近的AI分析结果和相关新闻。请基于这些上下文回答问题。不能给出确定性买卖指令，不能保证收益。使用简体中文回复。

你有权写入用户的交易记忆。当你在对话中了解到用户的重要信息（如交易习惯、风险偏好、持仓策略等），可以在回复末尾用 [MEMORY:记录内容] 的格式写入。记忆会持久化，供未来的对话参考。每条记忆应简洁、具体、客观，不要写重复信息。
如果用户本轮明确要求“记住”某个信息，系统会先主动保存这条记忆；你只需要自然确认，不要重复输出同一条 [MEMORY:...]。

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
          stream: true,
          thinking: { type: "disabled" }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        let errPayload: { error?: { message?: string } } = { error: undefined };
        try { errPayload = JSON.parse(text); } catch { /* not JSON */ }
        throw new AppError("DATA_PROVIDER_ERROR", `AI 请求失败：${errPayload.error?.message || text.slice(0, 300) || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new AppError("DATA_PROVIDER_ERROR", "无法读取 AI 响应流。");

      const decoder = new TextDecoder();
      // 收集完整回复文本，流结束后从里面提取 [MEMORY:...] 标签
      let fullContent = "";

      // 把 DeepSeek 的 SSE 流转发成浏览器可读的流
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split("\n");

              for (const line of lines) {
                // DeepSeek SSE 格式：每行 "data: {...json}"，空行分隔
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue; // 流结束信号

                try {
                  const parsed = JSON.parse(data) as {
                    choices?: Array<{ delta?: { content?: string } }>;
                  };
                  const content = parsed.choices?.[0]?.delta?.content ?? "";
                  if (content) {
                    fullContent += content;
                    controller.enqueue(new TextEncoder().encode(content));
                  }
                } catch {
                  // skip unparseable lines
                }
              }
            }
            controller.close();

            // 流结束了，看看 AI 有没有要写进记忆的内容
            const memories: string[] = [];
            let match: RegExpExecArray | null;
            MEMORY_TAG.lastIndex = 0;
            while ((match = MEMORY_TAG.exec(fullContent)) !== null) {
              const mem = match[1].trim();
              if (mem) memories.push(mem);
            }
            if (memories.length) {
              await appendMemory(user.id, memories.join("\n\n"));
            }
          } catch {
            controller.close();
          }
        }
      });

      // 用 text/plain 而不是 text/event-stream，前端更简单
      // 直接 ReadableStream 推文本块，不需要 EventSource
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "X-Memory-Updated": explicitMemorySaved ? "true" : "false"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: codeToStatus(error.code) });
    }
    return Response.json({ error: { code: "DATA_PROVIDER_ERROR", message: "AI 服务异常" } }, { status: 502 });
  }
}

async function buildChatContext(userId: string) {
  const [watchlistItems, latestAnalyses, recentNews, memory] = await Promise.all([
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
    }),
    getMemoryContent(userId)
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
    ...(news.length ? news : ["暂无新闻"]),
    "",
    "=== 交易记忆（用户的交易习惯和偏好） ===",
    memory || "暂无记录"
  ].join("\n");
}

function codeToStatus(code: string) {
  switch (code) {
    case "BAD_REQUEST": return 400;
    case "RATE_LIMIT": return 429;
    default: return 502;
  }
}

function extractExplicitMemories(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const memories: string[] = [];

  const name = extractName(normalized);
  if (name) {
    memories.push(`用户的名字是 ${name}。`);
  }

  const preferredName = matchShortValue(normalized, /(?:^|[，。,.!！?？\s])以后(?:请|都)?(?:叫我|称呼我为)([^，。,.!！?？\s]{1,24})/);
  if (preferredName && preferredName !== name) {
    memories.push(`用户希望被称呼为 ${preferredName}。`);
  }

  const rememberMatch = normalized.match(/^(?:请|麻烦|帮我|你)?\s*记(?:住|得)(?:一下)?[:：,，]?\s*(.+)$/);
  const remembered = cleanMemoryCandidate(rememberMatch?.[1] ?? "");
  if (remembered && !name && !containsQuestionLikeText(remembered)) {
    memories.push(remembered);
  }

  return [...new Set(memories)].slice(0, 5);
}

function extractName(value: string) {
  return matchShortValue(value, /(?:^|[，。,.!！?？\s])我(?:的)?(?:名字)?叫([^，。,.!！?？\s]{1,24})/);
}

function matchShortValue(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  if (!match?.[1]) return "";
  const cleaned = match[1].replace(/^(是|做|叫)/, "").replace(/(谢谢|请记住|记住|以后).*$/, "").trim();
  if (!cleaned || containsQuestionLikeText(cleaned)) return "";
  return cleaned.slice(0, 24);
}

function cleanMemoryCandidate(value: string) {
  const cleaned = value
    .replace(/^[，。,.!！?？\s]+/, "")
    .replace(/[，。,.!！?？\s]+$/, "")
    .trim();
  if (!cleaned || cleaned.length > 200) return "";
  return cleaned;
}

function containsQuestionLikeText(value: string) {
  return /[?？]|什么|怎么|为何|为什么|哪里|是否/.test(value);
}
