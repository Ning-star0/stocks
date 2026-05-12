"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Loader2, MessageCircle, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Message = { role: "user" | "assistant"; content: string };

// 把 AI 回复里的 [MEMORY:...] 标签过滤掉，不展示给用户
function cleanReply(text: string) {
  return text.replace(/\[MEMORY:[\s\S]*?\]/g, "").trim();
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryUpdated, setMemoryUpdated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setMemoryUpdated(false);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: controller.signal
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? "请求失败");
      }

      // 从 ReadableStream 逐块读取，拼到最新一条 AI 消息上
      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      // 保留未经过滤的原始文本，流结束后用来检查是否有 [MEMORY:...]
      const rawBuffer: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawBuffer.push(chunk);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated.at(-1);
          if (last && last.role === "assistant") {
            // 实时过滤 [MEMORY:...] 标签，用户看不到
            updated[updated.length - 1] = { ...last, content: cleanReply(last.content + chunk) };
          }
          return updated;
        });
      }

      // 流结束，用原始文本检查是否有记忆写入
      const raw = rawBuffer.join("");
      if (/\[MEMORY:[\s\S]*?\]/.test(raw)) {
        setTimeout(() => setMemoryUpdated(true), 500);
        setTimeout(() => setMemoryUpdated(false), 5000);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "请求失败");
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated.at(-1);
        if (last && last.role === "assistant" && !last.content) {
          updated.pop();
        }
        return updated;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          aria-label="AI 助手"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      ) : (
        <div className="fixed bottom-6 right-6 z-50 flex h-[560px] w-[420px] flex-col rounded-xl border border-border bg-card shadow-2xl max-sm:bottom-0 max-sm:right-0 max-sm:h-full max-sm:w-full max-sm:rounded-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="h-4 w-4" />
              AI 投资助手
              {memoryUpdated ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">已更新记忆</span> : null}
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                我是你的 AI 投资助手。我可以基于你的持仓、最新分析和新闻，回答你的投资问题。
                <div className="mt-3 space-y-1.5">
                  {["我的持仓风险集中在哪里？", "最近哪些新闻会影响我？", "帮我分析当前仓位是否合理"].map((q) => (
                    <button
                      key={q}
                      onClick={() => { if (!loading) { setInput(q); } }}
                      className="block w-full rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-muted/50"
                      disabled={loading}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60"
                  }`}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm prose-invert max-w-none break-words prose-headings:text-foreground prose-a:text-blue-400 prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-pre:bg-muted prose-pre:rounded-md prose-li:marker:text-muted-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content || (loading ? "..." : "未收到回复")}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))
            )}
            {loading ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  思考中...
                  <button onClick={stop} className="ml-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted">停止</button>
                </div>
              </div>
            ) : null}
            {error ? <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div> : null}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border px-4 py-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="输入你的问题..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                disabled={loading}
              />
              <Button size="icon" onClick={send} disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
