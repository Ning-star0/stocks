"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bell, BookOpen, Brain, Check, Code2, Loader2, Server, Send } from "lucide-react";

import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";

export default function SettingsPage() {
  // 密钥输入框始终为空，不存掩码值——之前把 "sk-abc***xyz" 写进 DB 的 bug 就出在这
  const [apiKey, setApiKey] = useState("");
  // 单独记一下是否已有密钥，用来切换输入框的提示文案
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-pro");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushProvider, setPushProvider] = useState("wecom");
  const [pushWebhook, setPushWebhook] = useState("");
  const [pushHasWebhook, setPushHasWebhook] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then((data) => {
        if (data.baseUrl) setBaseUrl(data.baseUrl);
        if (data.model) setModel(data.model);
        setHasExistingKey(!!data.apiKeyMasked);
      })
      .catch(() => {});
    fetch("/api/settings/notifications")
      .then((r) => r.json())
      .then((data) => {
        setPushEnabled(Boolean(data.enabled));
        if (data.provider) setPushProvider(data.provider);
        setPushHasWebhook(Boolean(data.hasWebhook));
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // apiKey 为空时传 undefined，后端会保留原有密钥
        body: JSON.stringify({ apiKey: apiKey || undefined, baseUrl, model })
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "保存失败");
      setSaved(true);
      setApiKey("");
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey || undefined, baseUrl, model })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "连接测试失败");
      setTestResult(`连接成功：${data.model} | ${data.baseUrl} | ${data.latencyMs}ms`);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function savePushConfig() {
    setPushSaving(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: pushEnabled,
          provider: pushProvider,
          webhookUrl: pushWebhook || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "保存推送配置失败");
      setPushHasWebhook(Boolean(data.hasWebhook));
      setPushWebhook("");
      setPushMessage("推送配置已保存");
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "保存推送配置失败");
    } finally {
      setPushSaving(false);
    }
  }

  async function testPush() {
    setPushTesting(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/settings/notifications", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "测试推送失败");
      setPushMessage("测试推送已发送");
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "测试推送失败");
    } finally {
      setPushTesting(false);
    }
  }

  return (
    <PageContainer className="max-w-4xl">
      <SectionHeader title="设置" description="管理 AI 接口、主题、记忆与系统入口。后台类功能已收纳在这里，避免主导航过重。" />

      <div className="grid gap-3 sm:grid-cols-2">
        <QuickLink href="/api-docs" icon={<Code2 className="h-4 w-4" />} title="接口与健康检查" text="查看 API、连接状态与运行成本。" />
        <QuickLink href="/memory" icon={<BookOpen className="h-4 w-4" />} title="记忆管理" text="维护手动记忆和自动沉淀的偏好。" />
      </div>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle>外观与账号</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-0">
            <div className="text-sm font-medium">主题：跟随系统</div>
            <p className="mt-1 text-xs text-muted-foreground">可切换浅色、深色或跟随系统设置。</p>
          </div>
          <ThemeToggle />
          <LogoutButton />
        </CardContent>
      </Card>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI 接口配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <span className="block text-sm font-medium mb-1">API 地址</span>
            <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" />
            <p className="text-xs text-muted-foreground">DeepSeek、OpenAI 或其他兼容接口地址</p>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium mb-1">API 密钥</span>
            <Input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasExistingKey ? "已配置，留空则不修改" : "请输入密钥"} autoComplete="off" />
            <p className="text-xs text-muted-foreground">{hasExistingKey ? "密钥已配置。如需更换请输入新密钥，留空则保持现有密钥不变。" : "输入 API 密钥。"}</p>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium mb-1">模型名称</span>
            <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-pro" />
            <p className="text-xs text-muted-foreground">例如 deepseek-v4-pro, deepseek-v4-flash, gpt-4o</p>
          </div>

          <div className="flex gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saved ? "已保存" : "保存配置"}
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing}>
              <Server className="h-4 w-4" />
              {testing ? "测试中..." : "测试连接"}
            </Button>
          </div>

          {testResult ? <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">{testResult}</div> : null}
          {error ? <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div> : null}
        </CardContent>
      </Card>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            策略推送
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/20 p-3">
            <span>
              <span className="block text-sm font-medium">启用实时推送</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">只有 AI 决策形成策略观察计划时才推送；等待、回避、暂无计划不会推送。</span>
            </span>
            <input type="checkbox" checked={pushEnabled} onChange={(event) => setPushEnabled(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
          </label>

          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <span className="block text-sm font-medium">推送通道</span>
              <Select value={pushProvider} onChange={(event) => setPushProvider(event.target.value)}>
                <option value="wecom">企业微信机器人</option>
                <option value="server_chan">Server 酱微信</option>
                <option value="qq_webhook">QQ Webhook</option>
                <option value="generic_webhook">通用 Webhook</option>
              </Select>
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-medium">Webhook / SendKey</span>
              <Input type="password" value={pushWebhook} onChange={(event) => setPushWebhook(event.target.value)} placeholder={pushHasWebhook ? "已配置，留空则不修改" : "粘贴企业微信 Webhook、Server 酱 SendKey 或 QQ Webhook"} autoComplete="off" />
              <p className="text-xs leading-5 text-muted-foreground">QQ 官方机器人通常需要审核和签名服务；这里先支持 QQ/第三方 Bot 的 HTTP Webhook。</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={savePushConfig} disabled={pushSaving}>
              {pushSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存推送配置
            </Button>
            <Button variant="outline" onClick={testPush} disabled={pushTesting || !pushEnabled || !pushHasWebhook}>
              {pushTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              测试推送
            </Button>
          </div>

          {pushMessage ? <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">{pushMessage}</div> : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function QuickLink({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="group rounded-lg border border-border/70 bg-card/85 p-4 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-primary/30 hover:shadow-md">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary transition-transform duration-150 group-hover:-translate-y-px">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </Link>
  );
}
