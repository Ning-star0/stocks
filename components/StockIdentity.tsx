import { displaySymbolBase, resolveStockDisplayName } from "@/lib/trading/display";
import { cn } from "@/lib/utils";

export function StockIdentity({
  symbol,
  name,
  prefix,
  compact = false,
  className
}: {
  symbol: string;
  name?: string | null;
  prefix?: string;
  compact?: boolean;
  className?: string;
}) {
  const displayName = resolveStockDisplayName({ symbol, name });
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("truncate font-medium text-foreground", compact ? "text-sm" : "text-base")} title={`${displayName} ${symbol}`}>
        {prefix ? `${prefix} · ` : ""}{displayName}
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
        {symbol}
        {displaySymbolBase(symbol) !== symbol.toUpperCase() ? <span className="ml-1 font-sans">({displaySymbolBase(symbol)})</span> : null}
      </div>
    </div>
  );
}
