"use client";

import { useEffect, useState } from "react";
import { Brain, Check, Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-pro");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then((data) => {
        if (data.baseUrl) setBaseUrl(data.baseUrl);
        if (data.model) setModel(data.model);
        // apiKey is masked, only show if user types new one
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
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setTestResult(data.aiModel ? `当前模型: ${data.aiModel}` : "服务正常");
    } catch {
      setTestResult("连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">AI 设置</h1>

      <Card>
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
            <Input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="留空则不修改" autoComplete="off" />
            <p className="text-xs text-muted-foreground">输入新密钥替换，留空则保持现有密钥</p>
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
    </div>
  );
}
