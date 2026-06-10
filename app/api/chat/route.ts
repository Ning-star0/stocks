import { getAiConfig, selectAiModel } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/currentUser";
import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import { addMemoryEntries, appendMemory, getMemoryContent } from "@/lib/memory";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { serializeWatchlistItem } from "@/lib/serializers";

const MEMORY_TAG = /\[MEMORY:([\s\S]*?)\]/g;
const MEMORY_EXTRACTION_TIMEOUT_MS = 10_000;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await readRequestJson<{ message?: unknown }>(request);
    const message = String(body.message ?? "").trim();
    if (!message) throw new AppError("BAD_REQUEST", "请输入问题。");

    let memoryUpdated = false;
    const explicitMemories = extractExplicitMemories(message);
    if (explicitMemories.length) {
      try {
        await addMemoryEntries(user.id, explicitMemories, "manual");
        memoryUpdated = true;
      } catch {
        memoryUpdated = false;
      }
    }

    const config = await getAiConfig();
    if (!config.apiKey) throw new AppError("DATA_PROVIDER_ERROR", "API key 未配置，请在设置页面填写。");
    if (!config.baseUrl.startsWith("https://") && !config.baseUrl.startsWith("http://")) {
      throw new AppError("DATA_PROVIDER_ERROR", "API 地址配置异常，请在设置页面检查。");
    }

    const autoMemories = await extractAutoMemories({
      message,
      existingMemory: await getMemoryContent(user.id),
      config
    });
    if (autoMemories.length) {
      try {
        await addMemoryEntries(user.id, autoMemories, "auto");
        memoryUpdated = true;
      } catch {
        // 记忆写入失败不应该阻断聊天。
      }
    }

    const context = await buildChatContext(user.id);
    const systemPrompt = `你是一个谨慎的股票投资顾问，正在帮助用户分析他的投资组合。你可以看到用户的持仓、最近的AI分析结果和相关新闻。请基于这些上下文回答问题。不能给出确定性买卖指令，不能保证收益。使用简体中文回复。

服务器会自动维护用户记忆。你只需要自然回答，不要输出 [MEMORY:...]、工具调用文本或任何隐藏标记。
如果用户本轮明确要求“记住”某个信息，系统已经在回复前尝试保存；你可以自然确认。

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
          model: selectAiModel(config, "flagship"),
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
          "X-Memory-Updated": memoryUpdated ? "true" : "false"
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

async function extractAutoMemories(input: {
  message: string;
  existingMemory: string;
  config: Awaited<ReturnType<typeof getAiConfig>>;
}) {
  const deterministic = extractDeterministicAutoMemories(input.message);
  const aiMemories = shouldRunAiMemoryExtraction(input.message) ? await extractAutoMemoriesWithAi(input) : [];
  return dedupeMemoryTexts([...deterministic, ...aiMemories]).slice(0, 5);
}

function shouldRunAiMemoryExtraction(message: string) {
  return /我|我的|本人|以后|记住|记得|偏好|习惯|风险|喜欢|不喜欢|最多|不要|别|称呼|叫我/.test(message);
}

function extractDeterministicAutoMemories(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || containsQuestionLikeText(normalized)) return [];

  const memories: string[] = [];
  const patterns: Array<{ pattern: RegExp; format: (value: string) => string }> = [
    { pattern: /(?:^|[，。,.!！\s])我(?:的)?风险偏好(?:是|偏向|属于)?([^，。,.!！?？]{2,60})/, format: (value) => `用户的风险偏好是${value}。` },
    { pattern: /(?:^|[，。,.!！\s])我(?:比较|更|很)?(?:喜欢|偏好|倾向于)([^，。,.!！?？]{2,80})/, format: (value) => `用户偏好${value}。` },
    { pattern: /(?:^|[，。,.!！\s])我(?:不喜欢|不想|不愿意|尽量不)([^，。,.!！?？]{2,80})/, format: (value) => `用户不喜欢${value}。` },
    { pattern: /(?:^|[，。,.!！\s])我(?:通常|一般|习惯于|经常)([^，。,.!！?？]{2,80})/, format: (value) => `用户通常${value}。` },
    { pattern: /(?:^|[，。,.!！\s])我(?:单只股票|单个标的|单票)(?:最多|最大|不要超过)([^，。,.!！?？]{2,80})/, format: (value) => `用户单只股票最多${value}。` }
  ];

  for (const item of patterns) {
    const value = cleanMemoryCandidate(matchShortValue(normalized, item.pattern));
    if (value) memories.push(item.format(value));
  }
  return dedupeMemoryTexts(memories);
}

async function extractAutoMemoriesWithAi(input: {
  message: string;
  existingMemory: string;
  config: Awaited<ReturnType<typeof getAiConfig>>;
}) {
  if (input.message.length < 8) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEMORY_EXTRACTION_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: selectAiModel(input.config, "standard"),
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是记忆抽取器。只从用户消息中抽取未来长期有用、稳定、客观的用户记忆，例如称呼、风险偏好、交易规则、行业偏好、资金约束。不要抽取临时问题、当日行情、一次性请求、AI 对股票的判断或投资结论。返回严格 JSON。"
          },
          {
            role: "user",
            content: JSON.stringify({
              userMessage: input.message,
              existingMemory: input.existingMemory,
              outputSchema: { memories: ["简洁中文记忆，每条不超过 80 字"] }
            })
          }
        ],
        stream: false,
        thinking: { type: "disabled" }
      }),
      signal: controller.signal
    });

    if (!response.ok) return [];
    const json = await readProviderJsonResponse<{ choices?: Array<{ message?: { content?: string } }> }>(response, "AI 记忆抽取");
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) return [];
    return dedupeMemoryTexts(parsed.memories.map((item) => cleanMemoryCandidate(String(item))).filter(Boolean));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
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
      `持仓数量: ${serialized.holdingShares ?? "未设置"}`,
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
  return matchShortValue(value, /(?:^|[，。,.!！?？\s])我(?:的)?(?:名字|姓名)?(?:叫|是)([^，。,.!！?？\s]{1,24})/);
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

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    return {};
  }
}

function dedupeMemoryTexts(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = cleanMemoryCandidate(value);
    const key = cleaned.toLowerCase().replace(/[，。,.；;：:\s]/g, "");
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}
