import { AlertRuleForm } from "@/components/AlertRuleForm";
import { PageContainer, SectionHeader } from "@/components/ui/layout";

export default function AlertsPage() {
  return (
    <PageContainer>
      <SectionHeader title="提醒规则" description="本系统仅用于研究和辅助分析，不构成投资建议。" />
      <AlertRuleForm />
    </PageContainer>
  );
}
