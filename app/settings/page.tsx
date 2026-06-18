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
import { readJsonResponse } from "@/lib/clientApi";

type AiSettingsResponse = {
  apiKeyMasked?: string | null;
  baseUrl?: string;
  model?: string;
  flagshipModel?: string;
  provider?: string;
  standardModel?: string;
  costCurrency?: string;
  flagshipInputPricePerMillion?: number;
  flagshipOutputPricePerMillion?: number;
  standardInputPricePerMillion?: number;
  standardOutputPricePerMillion?: number;
  focusStockAnalysisConcurrency?: number;
};

type NotificationSettingsResponse = {
  enabled?: boolean;
  provider?: string;
  hasWebhook?: boolean;
  corpId?: string;
  agentId?: string;
  toUser?: string;
  hasAppSecret?: boolean;
};

export default function SettingsPage() {
  // 密钥输入框始终为空，不存掩码值——之前把 "sk-abc***xyz" 写进 DB 的 bug 就出在这
  const [apiKey, setApiKey] = useState("");
  // 单独记一下是否已有密钥，用来切换输入框的提示文案
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-pro");
  const [aiProvider, setAiProvider] = useState("deepseek");
  const [standardModel, setStandardModel] = useState("deepseek-v4-flash");
  const [costCurrency, setCostCurrency] = useState("CNY");
  const [flagshipInputPrice, setFlagshipInputPrice] = useState("0");
  const [flagshipOutputPrice, setFlagshipOutputPrice] = useState("0");
  const [standardInputPrice, setStandardInputPrice] = useState("0");
  const [standardOutputPrice, setStandardOutputPrice] = useState("0");
  const [focusConcurrency, setFocusConcurrency] = useState("5");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushProvider, setPushProvider] = useState("wecom");
  const [pushWebhook, setPushWebhook] = useState("");
  const [pushHasWebhook, setPushHasWebhook] = useState(false);
  const [pushCorpId, setPushCorpId] = useState("");
  const [pushAgentId, setPushAgentId] = useState("");
  const [pushAppSecret, setPushAppSecret] = useState("");
  const [pushHasAppSecret, setPushHasAppSecret] = useState(false);
  const [pushToUser, setPushToUser] = useState("");
  const [pushSaving, setPushSaving] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const isWecomAppProvider = pushProvider === "wecom_app";
  const pushReady = pushEnabled && (isWecomAppProvider ? Boolean(pushCorpId && pushAgentId && pushHasAppSecret && pushToUser) : pushHasWebhook);
  const pushCredentialLabel = pushProvider === "pushdeer" ? "PushDeer PushKey" : "Webhook / SendKey";
  const pushCredentialPlaceholder = pushProvider === "pushdeer"
    ? pushHasWebhook ? "已配置，留空则不修改" : "粘贴 PushDeer PushKey"
    : pushHasWebhook ? "已配置，留空则不修改" : "粘贴企业微信 Webhook、Server 酱 SendKey 或 QQ Webhook";
  const pushCredentialHelp = pushProvider === "pushdeer"
    ? "PushDeer 会推送到你 App 里已注册的设备。建议不要把 PushKey 放进代码或公开聊天记录。"
    : "QQ 官方机器人通常需要审核和签名服务；这里先支持 QQ/第三方 Bot 的 HTTP Webhook。";

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((response) => readJsonResponse<AiSettingsResponse>(response))
      .then((data) => {
        if (data.baseUrl) setBaseUrl(data.baseUrl);
        const nextFlagshipModel = data.flagshipModel || data.model;
        if (nextFlagshipModel) setModel(nextFlagshipModel);
        if (data.provider) setAiProvider(data.provider);
        if (data.standardModel) setStandardModel(data.standardModel);
        if (data.costCurrency) setCostCurrency(data.costCurrency);
        if (data.flagshipInputPricePerMillion !== undefined) setFlagshipInputPrice(String(data.flagshipInputPricePerMillion));
        if (data.flagshipOutputPricePerMillion !== undefined) setFlagshipOutputPrice(String(data.flagshipOutputPricePerMillion));
        if (data.standardInputPricePerMillion !== undefined) setStandardInputPrice(String(data.standardInputPricePerMillion));
        if (data.standardOutputPricePerMillion !== undefined) setStandardOutputPrice(String(data.standardOutputPricePerMillion));
        if (data.focusStockAnalysisConcurrency !== undefined) setFocusConcurrency(String(data.focusStockAnalysisConcurrency));
        setHasExistingKey(!!data.apiKeyMasked);
      })
      .catch(() => {});
    fetch("/api/settings/notifications")
      .then((response) => readJsonResponse<NotificationSettingsResponse>(response))
      .then((data) => {
        setPushEnabled(Boolean(data.enabled));
        if (data.provider) setPushProvider(data.provider);
        setPushHasWebhook(Boolean(data.hasWebhook));
        if (data.corpId) setPushCorpId(data.corpId);
        if (data.agentId) setPushAgentId(data.agentId);
        if (data.toUser) setPushToUser(data.toUser);
        setPushHasAppSecret(Boolean(data.hasAppSecret));
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
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          baseUrl,
          provider: aiProvider,
          flagshipModel: model,
          standardModel,
          costCurrency,
          flagshipInputPricePerMillion: flagshipInputPrice,
          flagshipOutputPricePerMillion: flagshipOutputPrice,
          standardInputPricePerMillion: standardInputPrice,
          standardOutputPricePerMillion: standardOutputPrice,
          focusStockAnalysisConcurrency: focusConcurrency
        })
      });
      await readJsonResponse(res);
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
      const data = await readJsonResponse<{ model: string; baseUrl: string; latencyMs: number }>(res);
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
          webhookUrl: pushWebhook || undefined,
          corpId: pushCorpId || undefined,
          agentId: pushAgentId || undefined,
          appSecret: pushAppSecret || undefined,
          toUser: pushToUser || undefined
        })
      });
      const data = await readJsonResponse<NotificationSettingsResponse>(res);
      setPushHasWebhook(Boolean(data.hasWebhook));
      setPushHasAppSecret(Boolean(data.hasAppSecret));
      setPushWebhook("");
      setPushAppSecret("");
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
      await readJsonResponse(res);
      setPushMessage("测试推送已发送");
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "测试推送失败");
    } finally {
      setPushTesting(false);
    }
  }

  return (
    <PageContainer className="max-w-[90rem]">
      <SectionHeader title="设置" />

      <SettingsStatusGrid
        aiProvider={aiProvider}
        hasExistingKey={hasExistingKey}
        model={model}
        standardModel={standardModel}
        focusConcurrency={focusConcurrency}
        pushEnabled={pushEnabled}
        pushProvider={pushProvider}
        pushReady={pushReady}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <QuickLink href="/api-docs" icon={<Code2 className="h-4 w-4" />} title="接口与健康检查" text="查看 API、连接状态与运行成本。" />
        <QuickLink href="/memory" icon={<BookOpen className="h-4 w-4" />} title="记忆管理" text="维护手动记忆和自动沉淀的偏好。" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)] xl:items-start">
      <div className="space-y-4">
      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-background/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>外观与账号</CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">账号会话</span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="mr-auto min-w-0">
            <div className="text-sm font-medium">主题：跟随系统</div>
          </div>
          <ThemeToggle />
          <LogoutButton />
        </CardContent>
      </Card>

      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-background/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI 接口配置
            </CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{aiProvider}</span>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{hasExistingKey ? "密钥已配置" : "未配置密钥"}</span>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">并发 {focusConcurrency}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <span className="block text-sm font-medium mb-1">API 地址</span>
            <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" />
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium mb-1">API 密钥</span>
            <Input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasExistingKey ? "已配置，留空则不修改" : "请输入密钥"} autoComplete="off" />
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium mb-1">厂商</span>
            <Select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="qwen">通义千问</option>
              <option value="zhipu">智谱</option>
              <option value="moonshot">Moonshot</option>
              <option value="openai-compatible">OpenAI 兼容接口</option>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <span className="block text-sm font-medium mb-1">旗舰模型</span>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-pro" />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-medium mb-1">普通模型</span>
              <Input value={standardModel} onChange={(e) => setStandardModel(e.target.value)} placeholder="deepseek-v4-flash" />
            </div>
          </div>

          <div className="glow-card space-y-3 rounded-xl border border-border bg-muted/15 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">Token 费用估算</div>
              <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">每 100 万 token</span>
            </div>
            <div className="grid gap-3 md:grid-cols-[120px_repeat(4,minmax(0,1fr))]">
              <div className="space-y-2">
                <span className="block text-xs font-medium text-muted-foreground">币种</span>
                <Input value={costCurrency} onChange={(e) => setCostCurrency(e.target.value)} placeholder="CNY" />
              </div>
              <PriceInput label="旗舰输入" value={flagshipInputPrice} onChange={setFlagshipInputPrice} />
              <PriceInput label="旗舰输出" value={flagshipOutputPrice} onChange={setFlagshipOutputPrice} />
              <PriceInput label="普通输入" value={standardInputPrice} onChange={setStandardInputPrice} />
              <PriceInput label="普通输出" value={standardOutputPrice} onChange={setStandardOutputPrice} />
            </div>
          </div>

          <div className="glow-card space-y-3 rounded-xl border border-border bg-muted/15 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">自动分析并发</div>
              <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">今日 AI 策略观察</span>
            </div>
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
              <div className="space-y-2">
                <span className="block text-sm font-medium">股票并发数</span>
                <Select value={focusConcurrency} onChange={(event) => setFocusConcurrency(event.target.value)}>
                  <option value="1">1 只，最稳</option>
                  <option value="2">2 只，低负载</option>
                  <option value="3">3 只，稳定</option>
                  <option value="4">4 只，较快</option>
                  <option value="5">5 只，默认最快</option>
                </Select>
              </div>
              <div className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs leading-5 text-muted-foreground">服务器资源小或接口超时时建议 3；接口稳定可调到 5。后台任务并发仍单独限制。</div>
            </div>
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

          {testResult ? <div className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm">{testResult}</div> : null}
          {error ? <div className="glow-card rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div> : null}
        </CardContent>
      </Card>

      </div>

      <div className="space-y-4 xl:sticky xl:top-20">
      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-background/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              策略推送
            </CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{pushEnabled ? "已启用" : "未启用"}</span>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{pushProvider}</span>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{pushReady ? "可测试" : "待配置"}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <label className="glow-card glow-click-card flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/20 p-3">
            <span>
              <span className="block text-sm font-medium">启用实时推送</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">仅在 AI 决策形成策略观察计划时推送。</span>
            </span>
            <input type="checkbox" checked={pushEnabled} onChange={(event) => setPushEnabled(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
          </label>

          <div className="grid gap-3">
            <div className="space-y-2">
              <span className="block text-sm font-medium">推送通道</span>
              <Select value={pushProvider} onChange={(event) => setPushProvider(event.target.value)}>
                <option value="wecom">企业微信机器人</option>
                <option value="wecom_app">企业微信应用消息</option>
                <option value="server_chan">Server 酱微信</option>
                <option value="pushdeer">PushDeer</option>
                <option value="qq_webhook">QQ Webhook</option>
                <option value="generic_webhook">通用 Webhook</option>
              </Select>
            </div>
            {isWecomAppProvider ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <span className="block text-sm font-medium">企业 ID（CorpID）</span>
                  <Input value={pushCorpId} onChange={(event) => setPushCorpId(event.target.value)} placeholder="wwxxxxxxxxxxxxxxxx" autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <span className="block text-sm font-medium">应用 AgentId</span>
                  <Input value={pushAgentId} onChange={(event) => setPushAgentId(event.target.value)} placeholder="1000002" autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <span className="block text-sm font-medium">应用 Secret</span>
                  <Input type="password" value={pushAppSecret} onChange={(event) => setPushAppSecret(event.target.value)} placeholder={pushHasAppSecret ? "已配置，留空则不修改" : "自建应用 Secret"} autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <span className="block text-sm font-medium">接收人 UserID</span>
                  <Input value={pushToUser} onChange={(event) => setPushToUser(event.target.value)} placeholder="zhangsan 或 zhangsan|lisi" autoComplete="off" />
                </div>
                <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                  这是企业微信自建应用消息，会发到企业微信 App 的“应用通知”。接收人必须在应用可见范围内，UserID 不是手机号或微信昵称。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="block text-sm font-medium">{pushCredentialLabel}</span>
                <Input type="password" value={pushWebhook} onChange={(event) => setPushWebhook(event.target.value)} placeholder={pushCredentialPlaceholder} autoComplete="off" />
                <p className="text-xs leading-5 text-muted-foreground">{pushCredentialHelp}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={savePushConfig} disabled={pushSaving}>
              {pushSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存推送配置
            </Button>
            <Button variant="outline" onClick={testPush} disabled={pushTesting || !pushReady}>
              {pushTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              测试推送
            </Button>
          </div>

          {pushMessage ? <div className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm">{pushMessage}</div> : null}
        </CardContent>
      </Card>
      </div>
      </div>
    </PageContainer>
  );
}

function SettingsStatusGrid({
  aiProvider,
  hasExistingKey,
  model,
  standardModel,
  focusConcurrency,
  pushEnabled,
  pushProvider,
  pushReady
}: {
  aiProvider: string;
  hasExistingKey: boolean;
  model: string;
  standardModel: string;
  focusConcurrency: string;
  pushEnabled: boolean;
  pushProvider: string;
  pushReady: boolean;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
      <SettingsStatusItem label="AI 厂商" value={aiProvider || "--"} hint={hasExistingKey ? "密钥已配置" : "密钥待配置"} />
      <SettingsStatusItem label="旗舰模型" value={model || "--"} hint="深度分析" />
      <SettingsStatusItem label="普通模型" value={standardModel || "--"} hint="常规任务" />
      <SettingsStatusItem label="分析并发" value={`${focusConcurrency || "0"} 只`} hint="今日策略观察" />
      <SettingsStatusItem label="推送" value={pushEnabled ? "已启用" : "未启用"} hint={`${pushProvider} · ${pushReady ? "可测试" : "待配置"}`} />
    </div>
  );
}

function SettingsStatusItem({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function QuickLink({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="group glow-card glow-click-card rounded-xl border border-border/70 bg-card/85 p-4 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-primary/30 hover:shadow-md">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary transition-transform duration-150 group-hover:-translate-y-px">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </Link>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" />
    </div>
  );
}
