"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>登录</CardTitle>
        <CardDescription>请输入 `.env` 中配置的管理员账号和密码。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="email">
              账号邮箱
            </label>
            <Input id="email" name="email" type="email" defaultValue={defaultEmail} autoComplete="username" required />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="password">
              密码
            </label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={12} />
          </div>
          {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "登录中..." : "登录"}
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
