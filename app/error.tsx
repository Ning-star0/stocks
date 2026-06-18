"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/layout";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <PageContainer className="flex min-h-[60vh] max-w-2xl items-center">
      <Card className="performance-card w-full overflow-hidden">
        <CardHeader className="border-b border-border/70 bg-muted/10 p-4">
          <CardTitle className="flex items-center justify-between gap-3">
            <span>页面加载出错</span>
            <span className="rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">运行异常</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 text-sm text-muted-foreground">
          <p>前端遇到了一条运行时异常。通常是缓存的旧脚本、接口返回异常数据，或部署时静态资源没有同步造成的。</p>
          {error?.message ? <pre className="glow-card overflow-auto rounded-xl border border-border bg-muted/20 p-3 text-xs text-foreground">{error.message}</pre> : null}
          <div className="flex gap-2">
            <Button onClick={reset}>重试</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
