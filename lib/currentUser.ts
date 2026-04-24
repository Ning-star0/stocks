import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getCurrentUser() {
  const session = await requireSession();
  const existing = await prisma.user.findUnique({ where: { email: session.email } });
  if (existing) return existing;

  try {
    return await createUserWithDefaultWatchlist(session.email);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const user = await prisma.user.findUnique({ where: { email: session.email } });
      if (user) return user;
    }
    throw error;
  }
}

function createUserWithDefaultWatchlist(email: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      watchlists: {
        create: {
          name: "\u9ed8\u8ba4\u81ea\u9009\u80a1",
          items: {
            create: [
              { symbol: "600519.SH", market: "CN", timeHorizon: "swing_trade", riskLevel: "medium", note: "\u767d\u9152\u9f99\u5934\u89c2\u5bdf\u6837\u672c" },
              { symbol: "000001.SZ", market: "CN", timeHorizon: "long_term", riskLevel: "medium", note: "\u94f6\u884c\u677f\u5757\u89c2\u5bdf" },
              { symbol: "300750.SZ", market: "CN", timeHorizon: "swing_trade", riskLevel: "high", note: "\u65b0\u80fd\u6e90\u4e0e\u4f30\u503c\u98ce\u9669\u89c2\u5bdf" }
            ]
          }
        }
      }
    }
  });
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function getDefaultWatchlist(userId: string) {
  const existing = await prisma.watchlist.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  return prisma.watchlist.create({
    data: {
      userId,
      name: "\u9ed8\u8ba4\u81ea\u9009\u80a1"
    }
  });
}
