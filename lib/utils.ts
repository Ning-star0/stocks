import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value?: number | string | null, currency = process.env.NEXT_PUBLIC_PRICE_CURRENCY || "CNY") {
  const number = toNumber(value);
  if (number === null) return "--";

  const safeCurrency = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: number > 100 ? 2 : 4
    }).format(number);
  } catch {
    const prefix = safeCurrency === "USD" ? "$" : safeCurrency === "HKD" ? "HK$" : "¥";
    return `${prefix}${formatNumber(number)}`;
  }
}

export function isIndexSymbol(symbol?: string | null) {
  if (!symbol) return false;
  const normalized = symbol.trim().toUpperCase();
  return ["000001.SH", "399001.SZ", "000688.SH", "000300.SH", "000905.SH", "399006.SZ"].includes(normalized);
}

export function formatPriceValue(value?: number | string | null, input?: { currency?: string | null; symbol?: string | null; unit?: string | null }) {
  const number = toNumber(value);
  if (number === null) return "--";

  if (input?.unit === "point" || isIndexSymbol(input?.symbol)) {
    return `${formatNumber(number)}点`;
  }
  return formatCurrency(number, input?.currency ?? undefined);
}

function normalizeCurrency(currency?: string | null) {
  const next = (currency || process.env.NEXT_PUBLIC_PRICE_CURRENCY || "CNY").trim().toUpperCase();
  if (next === "USD" || next === "CNY" || next === "HKD") return next;
  return "CNY";
}

export function formatNumber(value?: number | string | null) {
  const number = toNumber(value);
  if (number === null) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number);
}

export function formatPercent(value?: number | string | null) {
  const number = toNumber(value);
  if (number === null) return "--";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}
