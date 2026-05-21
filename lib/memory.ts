import { prisma } from "@/lib/prisma";

export type MemorySource = "manual" | "auto";

export type MemoryEntry = {
  id: string;
  text: string;
  source: MemorySource;
};

// 返回记忆内容和更新时间，DB 挂了返回空串，不抛异常
export async function getMemory(userId: string): Promise<{ content: string; updatedAt: string | null }> {
  try {
    const memory = await prisma.userMemory.findUnique({ where: { userId } });
    return {
      content: memory?.content ?? "",
      updatedAt: memory?.updatedAt?.toISOString() ?? null
    };
  } catch {
    return { content: "", updatedAt: null };
  }
}

// 只取记忆文本，不需要更新时间时用这个
export async function getMemoryContent(userId: string): Promise<string> {
  const memory = await getMemory(userId);
  return memory.content;
}

export async function getMemoryState(userId: string): Promise<{ content: string; updatedAt: string | null; entries: MemoryEntry[] }> {
  const memory = await getMemory(userId);
  return {
    ...memory,
    entries: parseMemoryEntries(memory.content)
  };
}

export async function updateMemory(userId: string, content: string): Promise<void> {
  await prisma.userMemory.upsert({
    where: { userId },
    update: { content },
    create: { userId, content }
  });
}

export async function addMemoryEntries(userId: string, additions: string | string[], source: MemorySource): Promise<MemoryEntry[]> {
  const current = await getMemoryContent(userId);
  const existing = parseMemoryEntries(current);
  const next = [...existing];
  const seen = new Set(existing.map((entry) => normalizeMemoryText(entry.text)));

  for (const text of normalizeAdditions(additions)) {
    const key = normalizeMemoryText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({ id: memoryId(source, text), source, text });
  }

  await updateMemory(userId, formatMemoryEntries(next));
  return next;
}

export async function deleteMemoryEntry(userId: string, id: string): Promise<MemoryEntry[]> {
  const current = await getMemoryContent(userId);
  const entries = parseMemoryEntries(current).filter((entry) => entry.id !== id);
  await updateMemory(userId, formatMemoryEntries(entries));
  return entries;
}

// AI 对话结束后追加自动记忆，自动去重并规范为条目列表
export async function appendMemory(userId: string, addition: string): Promise<void> {
  await addMemoryEntries(userId, addition, "auto");
}

export function parseMemoryEntries(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  let currentSource: MemorySource = "manual";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,3}\s*自动记忆/.test(line)) {
      currentSource = "auto";
      continue;
    }
    if (/^#{1,3}\s*(手动记忆|交易记忆|用户记忆)/.test(line)) {
      currentSource = "manual";
      continue;
    }

    const tagged = line.match(/^[-*]\s*\[(manual|auto|手动|自动)\]\s*(.+)$/i);
    const plainBullet = line.match(/^[-*]\s+(.+)$/);
    const text = cleanMemoryText(tagged?.[2] ?? plainBullet?.[1] ?? line);
    if (!text) continue;
    const source = normalizeSource(tagged?.[1]) ?? currentSource;
    entries.push({ id: memoryId(source, text), source, text });
  }

  return dedupeEntries(entries);
}

function formatMemoryEntries(entries: MemoryEntry[]) {
  const manual = entries.filter((entry) => entry.source === "manual");
  const auto = entries.filter((entry) => entry.source === "auto");
  const sections: string[] = [];

  if (manual.length) {
    sections.push("## 手动记忆", ...manual.map((entry) => `- [manual] ${entry.text}`));
  }
  if (auto.length) {
    sections.push("## 自动记忆", ...auto.map((entry) => `- [auto] ${entry.text}`));
  }

  return sections.join("\n");
}

function normalizeAdditions(additions: string | string[]) {
  const values = Array.isArray(additions) ? additions : additions.split(/\n{2,}|\r?\n/);
  return values.map(cleanMemoryText).filter(Boolean);
}

function cleanMemoryText(value: string) {
  const text = value
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^\[(manual|auto|手动|自动)\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

function dedupeEntries(entries: MemoryEntry[]) {
  const seen = new Set<string>();
  const output: MemoryEntry[] = [];
  for (const entry of entries) {
    const key = normalizeMemoryText(entry.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function normalizeMemoryText(value: string) {
  return value.toLowerCase().replace(/[，。,.；;：:\s]/g, "");
}

function normalizeSource(value?: string): MemorySource | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "auto" || normalized === "自动") return "auto";
  if (normalized === "manual" || normalized === "手动") return "manual";
  return null;
}

function memoryId(source: MemorySource, text: string) {
  let hash = 0;
  const value = `${source}:${normalizeMemoryText(text)}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${source}-${hash.toString(36)}`;
}
