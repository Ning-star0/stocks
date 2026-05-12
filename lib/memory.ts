import { prisma } from "@/lib/prisma";

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

export async function appendMemory(userId: string, addition: string): Promise<void> {
  const current = await getMemoryContent(userId);
  const separator = current ? "\n\n" : "";
  await updateMemory(userId, `${current}${separator}${addition}`);
}
