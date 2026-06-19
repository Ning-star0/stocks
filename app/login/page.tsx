import type { ReactNode } from "react";
import { Activity, Database, LockKeyhole, Server } from "lucide-react";

import { LoginForm } from "@/components/LoginForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/layout";
import { getAdminEmail } from "@/lib/auth";

export default function LoginPage() {
  return (
    <PageContainer className="grid min-h-[72vh] max-w-[76rem] content-center gap-4 py-6 lg:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.12fr)] lg:items-center">
      <div className="space-y-4">
        <div className="space-y-2 border-b border-border/55 pb-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5" />
            安全入口
          </div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-[1.7rem]">股票 AI 监控</h1>
        </div>
        <LoginForm defaultEmail={getAdminEmail()} />
      </div>

      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-background/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>访问状态</CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">登录后可用</span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <LoginSignal icon={<Server className="h-4 w-4" />} label="服务" value="就绪" />
          <LoginSignal icon={<Database className="h-4 w-4" />} label="数据" value="隔离" />
          <LoginSignal icon={<Activity className="h-4 w-4" />} label="策略" value="待登录" />
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function LoginSignal({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-3 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}
