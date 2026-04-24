import { Badge } from "@/components/ui/badge";
import type { Trend } from "@/lib/types";

export function TrendBadge({ trend }: { trend?: Trend | string | null }) {
  const normalized = trend ?? "neutral";
  const variant = normalized === "bullish" ? "success" : normalized === "bearish" ? "danger" : "warning";
  const label = normalized === "bullish" ? "偏多" : normalized === "bearish" ? "偏空" : "中性";
  return <Badge variant={variant}>{label}</Badge>;
}
