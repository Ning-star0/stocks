import { deleteCache } from "@/lib/cache";

export function dashboardCacheKey(userId: string) {
  return `dashboard:${userId}`;
}

export async function invalidateDashboardCache(userId: string) {
  await deleteCache(dashboardCacheKey(userId));
}
