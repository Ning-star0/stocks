import { DailyMarketBriefPanel } from "@/components/DailyMarketBriefPanel";
import { SectorNewsPanel } from "@/components/SectorNewsPanel";

export default function NewsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">新闻与行业情报</h1>
        <p className="mt-1 text-sm text-muted-foreground">新闻与 AI 分析仅用于研究参考，不构成投资建议。</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <SectorNewsPanel />
        <DailyMarketBriefPanel />
      </div>
    </div>
  );
}
