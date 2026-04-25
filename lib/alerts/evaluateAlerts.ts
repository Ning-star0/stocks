import type { Alert } from "@prisma/client";

import { calculateIndicators } from "@/lib/indicators";
import { prisma } from "@/lib/prisma";
import { serializeAlert } from "@/lib/serializers";
import { getQuote } from "@/lib/services/quoteService";
import { getStockDataProvider } from "@/lib/stock-data";

export type AlertEvaluation = {
  alert: ReturnType<typeof serializeAlert>;
  currentValue: number | null;
  triggered: boolean;
  reason?: string;
};

export async function evaluateAlert(alert: Alert): Promise<AlertEvaluation> {
  if (!alert.isActive || alert.triggeredAt) {
    return { alert: serializeAlert(alert), currentValue: null, triggered: Boolean(alert.triggeredAt), reason: "inactive_or_already_triggered" };
  }

  const provider = getStockDataProvider();
  const symbol = alert.symbol.toUpperCase();
  const quote = await getQuote(symbol, { allowStale: true });
  const historyNeeded = alert.alertType === "rsi" || alert.alertType === "volume";
  const history = historyNeeded ? await provider.getHistory(symbol, "3mo", "1d") : [];
  const currentValue = getAlertCurrentValue(alert, quote.price, quote.volume, history);

  if (currentValue === null) {
    return { alert: serializeAlert(alert), currentValue, triggered: false, reason: "value_unavailable" };
  }

  const threshold = Number(alert.threshold);
  const triggered = alert.operator === "gt" ? currentValue > threshold : currentValue < threshold;
  if (!triggered) return { alert: serializeAlert(alert), currentValue, triggered: false };

  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: { triggeredAt: new Date() }
  });

  return { alert: serializeAlert(updated), currentValue, triggered: true };
}

export async function evaluateAlertsForUser(userId: string) {
  const alerts = await prisma.alert.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });

  const results: AlertEvaluation[] = [];
  for (const alert of alerts) {
    try {
      results.push(await evaluateAlert(alert));
    } catch (error) {
      results.push({
        alert: serializeAlert(alert),
        currentValue: null,
        triggered: false,
        reason: error instanceof Error ? error.message : "evaluation_failed"
      });
    }
  }

  return results;
}

export async function evaluateAllActiveAlerts() {
  const alerts = await prisma.alert.findMany({
    where: { isActive: true, triggeredAt: null },
    orderBy: { createdAt: "asc" },
    take: numberEnv("MAX_ALERTS_PER_RUN", 100)
  });

  const results: AlertEvaluation[] = [];
  for (const alert of alerts) {
    try {
      results.push(await evaluateAlert(alert));
    } catch (error) {
      results.push({
        alert: serializeAlert(alert),
        currentValue: null,
        triggered: false,
        reason: error instanceof Error ? error.message : "evaluation_failed"
      });
    }
  }

  return results;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getAlertCurrentValue(
  alert: Alert,
  price: number | null,
  volume: number | null,
  history: Array<{ close: number; volume: number; timestamp: string; open: number; high: number; low: number; symbol: string }>
) {
  if (alert.alertType === "price") return price;

  if (alert.alertType === "rsi") {
    return calculateIndicators(alert.symbol, history).rsi14;
  }

  if (alert.alertType === "volume") {
    if (!history.length || volume === null) return null;
    const averageVolume = history.reduce((sum, candle) => sum + candle.volume, 0) / history.length;
    return averageVolume > 0 ? Number((volume / averageVolume).toFixed(4)) : null;
  }

  return null;
}
