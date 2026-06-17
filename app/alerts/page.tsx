import { AlertRuleForm } from "@/components/AlertRuleForm";
import { PageContainer, SectionHeader } from "@/components/ui/layout";

export default function AlertsPage() {
  return (
    <PageContainer>
      <SectionHeader title="提醒规则" />
      <AlertRuleForm />
    </PageContainer>
  );
}
