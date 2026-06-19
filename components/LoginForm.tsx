"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { readJsonResponse } from "@/lib/clientApi";

export function LoginForm({ defaultEmail }: { defaultEmail: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password")
        })
      });
      await readJsonResponse(response);

      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";
      window.location.assign(safeNextPath(next));
    } catch {
      setError("登录请求失败，请检查服务是否正常运行。");
      setLoading(false);
    }
  }

  return (
    <Card className="performance-card w-full overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-background/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            登录
          </CardTitle>
          <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">管理员账号</span>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor="email">
              <Mail className="h-4 w-4" />
              账号邮箱
            </label>
            <Input id="email" name="email" type="email" defaultValue={defaultEmail} autoComplete="username" required />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor="password">
              <LockKeyhole className="h-4 w-4" />
              密码
            </label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={12} />
          </div>
          {error ? <div className="glow-card rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
          <Button className="w-full justify-center" type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? "登录中" : "进入系统"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function safeNextPath(next: string) {
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}
