import { DailyMarketBriefPanel } from "@/components/DailyMarketBriefPanel";
import { SectorNewsPanel } from "@/components/SectorNewsPanel";
import { PageContainer, SectionHeader } from "@/components/ui/layout";

export default function NewsPage() {
  return (
    <PageContainer>
      <SectionHeader title="新闻与行业情报" />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <SectorNewsPanel />
        <DailyMarketBriefPanel />
      </div>
    </PageContainer>
  );
}
