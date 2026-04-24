import { Badge } from "@/components/ui/badge";

export function RiskBadge({ risk }: { risk?: string | null }) {
  const variant = risk === "low" ? "success" : risk === "high" ? "danger" : "warning";
  const label = risk === "low" ? "低风险" : risk === "high" ? "高风险" : "中风险";
  return <Badge variant={variant}>{label}</Badge>;
}
