import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value?: number | null, currency = process.env.NEXT_PUBLIC_PRICE_CURRENCY || "CNY") {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const safeCurrency = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: value > 100 ? 2 : 4
    }).format(value);
  } catch {
    const prefix = safeCurrency === "USD" ? "$" : safeCurrency === "HKD" ? "HK$" : "¥";
    return `${prefix}${formatNumber(value)}`;
  }
}

export function isIndexSymbol(symbol?: string | null) {
  if (!symbol) return false;
  const normalized = symbol.trim().toUpperCase();
  return ["000001.SH", "399001.SZ", "000688.SH", "000300.SH", "000905.SH", "399006.SZ"].includes(normalized);
}

export function formatPriceValue(value?: number | null, input?: { currency?: string | null; symbol?: string | null; unit?: string | null }) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (input?.unit === "point" || isIndexSymbol(input?.symbol)) {
    return `${formatNumber(value)}点`;
  }
  return formatCurrency(value, input?.currency ?? undefined);
}

function normalizeCurrency(currency?: string | null) {
  const next = (currency || process.env.NEXT_PUBLIC_PRICE_CURRENCY || "CNY").trim().toUpperCase();
  if (next === "USD" || next === "CNY" || next === "HKD") return next;
  return "CNY";
}

export function formatNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}
