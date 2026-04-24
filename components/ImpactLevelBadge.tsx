import { Badge } from "@/components/ui/badge";

export function ImpactLevelBadge({ level }: { level?: string | null }) {
  const variant = level === "high" ? "danger" : level === "medium" ? "warning" : "secondary";
  const label = level === "high" ? "高影响" : level === "medium" ? "中影响" : "低影响";
  return <Badge variant={variant}>{label}</Badge>;
}
