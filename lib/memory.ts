import { prisma } from "@/lib/prisma";

export async function getMemory(userId: string): Promise<string> {
  try {
    const memory = await prisma.userMemory.findUnique({ where: { userId } });
    return memory?.content ?? "";
  } catch {
    return "";
  }
}

export async function updateMemory(userId: string, content: string): Promise<void> {
  await prisma.userMemory.upsert({
    where: { userId },
    update: { content },
    create: { userId, content }
  });
}
