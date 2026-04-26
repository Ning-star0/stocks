import type { Alert, WatchlistItem } from "@prisma/client";

import { toNumber } from "@/lib/utils";

export function serializeWatchlistItem(item: WatchlistItem) {
  return {
    ...item,
    holdingPrice: toNumber(item.holdingPrice),
    targetPrice: toNumber(item.targetPrice),
    stopLoss: toNumber(item.stopLoss),
    positionOpenedAt: item.positionOpenedAt ? item.positionOpenedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString()
  };
}

export function serializeAlert(alert: Alert) {
  return {
    ...alert,
    threshold: toNumber(alert.threshold)
  };
}
