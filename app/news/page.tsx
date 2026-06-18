import { DailyMarketBriefPanel } from "@/components/DailyMarketBriefPanel";
import { SectorNewsPanel } from "@/components/SectorNewsPanel";
import { PageContainer, SectionHeader } from "@/components/ui/layout";

export default function NewsPage() {
  return (
    <PageContainer>
      <SectionHeader title="新闻与行业情报" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <SectorNewsPanel />
        <div className="lg:sticky lg:top-20">
          <DailyMarketBriefPanel />
        </div>
      </div>
    </PageContainer>
  );
}
