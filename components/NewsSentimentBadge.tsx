import { Badge } from "@/components/ui/badge";

export function NewsSentimentBadge({ sentiment }: { sentiment?: string | null }) {
  const variant = sentiment === "positive" ? "success" : sentiment === "negative" ? "danger" : "warning";
  const label = sentiment === "positive" ? "正面" : sentiment === "negative" ? "负面" : "中性";
  return <Badge variant={variant}>{label}</Badge>;
}
