import { prisma } from "@/lib/prisma";

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

export async function updateMemory(userId: string, content: string): Promise<void> {
  await prisma.userMemory.upsert({
    where: { userId },
    update: { content },
    create: { userId, content }
  });
}

// AI 对话结束后追加新记忆，和原有内容用空行隔开
export async function appendMemory(userId: string, addition: string): Promise<void> {
  const current = await getMemoryContent(userId);
  const separator = current ? "\n\n" : "";
  await updateMemory(userId, `${current}${separator}${addition}`);
}
