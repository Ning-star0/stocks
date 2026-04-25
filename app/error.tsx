"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>页面加载出错</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>前端遇到了一条运行时异常。通常是缓存的旧脚本、接口返回异常数据，或部署时静态资源没有同步造成的。</p>
          {error?.message ? <pre className="overflow-auto rounded-md bg-muted p-3 text-xs text-foreground">{error.message}</pre> : null}
          <div className="flex gap-2">
            <Button onClick={reset}>重试</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
