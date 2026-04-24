import { AlertRuleForm } from "@/components/AlertRuleForm";

export default function AlertsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">提醒规则</h1>
        <p className="mt-1 text-sm text-muted-foreground">本系统仅用于研究和辅助分析，不构成投资建议。</p>
      </div>
      <AlertRuleForm />
    </div>
  );
}
