export const TRADE_LEDGER_PREVIEW_LIMIT = 10;

export const TRADE_CASH_CHANGE_DESCRIPTION = "现金变化 = 买入 -（成交额 + 手续费），卖出 +（成交额 - 手续费）";

export function displaySymbolBase(symbol: string) {
  return String(symbol ?? "").trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/i, "");
}

export function resolveStockDisplayName(input: { name?: string | null; symbol: string; fallback?: string }) {
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const name = String(input.name ?? "").trim();
  if (name && name.toUpperCase() !== symbol) return name;
  return input.fallback ?? "名称待同步";
}

export function formatMoney(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

export function formatSignedMoney(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

export function formatPrice(value?: number | null) {
  return value !== null && value !== undefined && Number.isFinite(value) ? String(value) : "--";
}

export function formatShares(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatPercent(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(0)}%`;
}

export function formatRatio(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)} : 1`;
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatFullDateTime(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDate(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
}

export function tradeSideLabel(value?: string | null) {
  return value === "buy" ? "买入" : "卖出";
}
