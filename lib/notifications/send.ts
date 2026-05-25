import { getCache, setCache } from "@/lib/cache";
import { getNotificationConfig, type NotificationProvider } from "@/lib/notifications/config";

type DecisionOrder = {
  symbol?: string | null;
  name?: string | null;
  amount?: number | null;
  shares?: number | null;
  reason?: string | null;
  riskControl?: string | null;
  invalidIf?: string | null;
};

export type FocusDecisionNotificationInput = {
  userId: string;
  decisionId?: string | null;
  source?: string | null;
  summary?: string | null;
  generatedAt?: string | Date | null;
  orders?: DecisionOrder[];
  cashReserve?: number | null;
  totalBudgetToUse?: number | null;
  totalEstimatedFee?: number | null;
};

export async function notifyFocusDecision(input: FocusDecisionNotificationInput) {
  const orders = Array.isArray(input.orders) ? input.orders.filter((order) => Number(order.amount) > 0 || Number(order.shares) > 0) : [];
  if (!orders.length) return { skipped: true, reason: "no_orders" };

  const config = await getNotificationConfig(input.userId);
  if (!config.enabled || !isConfigSendable(config)) return { skipped: true, reason: "disabled" };

  const dedupeKey = input.decisionId ? `notify:focus_decision:${input.decisionId}` : "";
  if (dedupeKey && await getCache(dedupeKey)) return { skipped: true, reason: "deduped" };

  const message = buildFocusDecisionMessage(input, orders);
  await sendMessage(config, message);
  if (dedupeKey) await setCache(dedupeKey, { sentAt: new Date().toISOString() }, numberEnv("NOTIFICATION_DEDUPE_TTL_SECONDS", 12 * 60 * 60));
  return { skipped: false };
}

export async function sendTestNotification(input: { userId: string; title?: string }) {
  const config = await getNotificationConfig(input.userId);
  if (!config.enabled || !isConfigSendable(config)) throw new Error("推送未启用或配置不完整。");
  await sendMessage(config, {
    title: input.title ?? "股票 AI 监控测试",
    markdown: "股票 AI 监控推送测试成功。\n\n后续只有形成策略观察计划时才会推送。",
    text: "股票 AI 监控推送测试成功。"
  });
}

function buildFocusDecisionMessage(input: FocusDecisionNotificationInput, orders: DecisionOrder[]) {
  const title = "股票 AI 策略观察";
  const generatedAt = input.generatedAt ? new Date(input.generatedAt).toLocaleString("zh-CN") : new Date().toLocaleString("zh-CN");
  const lines = [
    `## ${title}`,
    "",
    `时间：${generatedAt}`,
    `来源：${input.source === "scheduled" ? "定时分析" : "手动分析"}`,
    "",
    `结论：形成观察买入计划`,
    input.summary ? `核心原因：${input.summary}` : "",
    "",
    ...orders.flatMap((order, index) => [
      `### ${index + 1}. ${order.name || order.symbol || "标的"} ${order.symbol ? `(${order.symbol})` : ""}`,
      `计划金额：${formatMoney(order.amount)}，数量：${Number(order.shares ?? 0)} 股/份`,
      order.reason ? `原因：${order.reason}` : "",
      order.riskControl ? `风控：${order.riskControl}` : "",
      order.invalidIf ? `失效：${order.invalidIf}` : "",
      ""
    ]),
    `预计使用：${formatMoney(input.totalBudgetToUse)}，手续费：${formatMoney(input.totalEstimatedFee)}，保留现金：${formatMoney(input.cashReserve)}`,
    "",
    "仅供研究和辅助分析，不构成投资建议。"
  ].filter(Boolean);

  return {
    title,
    markdown: lines.join("\n"),
    text: lines.map((line) => line.replace(/^#+\s*/, "")).join("\n")
  };
}

async function sendMessage(config: Awaited<ReturnType<typeof getNotificationConfig>>, message: { title: string; markdown: string; text: string }) {
  if (config.provider === "wecom_app") {
    return sendWecomAppMessage(config, message);
  }
  if (config.provider === "pushdeer") {
    return sendPushDeerMessage(config.webhookUrl, message);
  }

  const url = resolveWebhookUrl(config.provider, config.webhookUrl);
  const body = bodyForProvider(config.provider, message);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": config.provider === "server_chan" ? "application/x-www-form-urlencoded" : "application/json" },
    body
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`推送失败：HTTP ${response.status} ${text.slice(0, 160)}`);
}

async function sendPushDeerMessage(pushKey: string, message: { title: string; markdown: string; text: string }) {
  const params = new URLSearchParams();
  params.set("pushkey", pushKey);
  params.set("text", message.title);
  params.set("desp", message.markdown);
  params.set("type", "markdown");

  const response = await fetch("https://api2.pushdeer.com/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const text = await response.text().catch(() => "");
  let payload: { code?: number; error?: string; msg?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) as { code?: number; error?: string; msg?: string } : null;
  } catch {
    payload = null;
  }
  if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
    throw new Error(`PushDeer 推送失败：${payload?.error || payload?.msg || `HTTP ${response.status} ${text.slice(0, 120)}`}`);
  }
}

async function sendWecomAppMessage(config: Awaited<ReturnType<typeof getNotificationConfig>>, message: { title: string; markdown: string; text: string }) {
  const token = await getWecomAccessToken(config);
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: config.toUser || "@all",
      msgtype: "markdown",
      agentid: Number(config.agentId),
      markdown: { content: message.markdown },
      safe: 0
    })
  });
  const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
  if (!response.ok || payload.errcode) {
    throw new Error(`企业微信应用推送失败：${payload.errmsg || `HTTP ${response.status}`}`);
  }
}

async function getWecomAccessToken(config: Awaited<ReturnType<typeof getNotificationConfig>>) {
  const cacheKey = `wecom_app_token:${config.corpId}:${config.agentId}`;
  const cached = await getCache<{ accessToken: string }>(cacheKey);
  if (cached?.accessToken) return cached.accessToken;

  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
  url.searchParams.set("corpid", config.corpId);
  url.searchParams.set("corpsecret", config.appSecret);
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (!response.ok || payload.errcode || !payload.access_token) {
    throw new Error(`企业微信 token 获取失败：${payload.errmsg || `HTTP ${response.status}`}`);
  }
  await setCache(cacheKey, { accessToken: payload.access_token }, Math.max(60, Math.min(payload.expires_in ?? 7200, 7000) - 120));
  return payload.access_token;
}

function resolveWebhookUrl(provider: NotificationProvider, value: string) {
  if (provider === "server_chan" && !/^https?:\/\//i.test(value)) {
    return `https://sctapi.ftqq.com/${encodeURIComponent(value)}.send`;
  }
  return value;
}

function bodyForProvider(provider: NotificationProvider, message: { title: string; markdown: string; text: string }) {
  if (provider === "wecom") {
    return JSON.stringify({ msgtype: "markdown", markdown: { content: message.markdown } });
  }
  if (provider === "server_chan") {
    const params = new URLSearchParams();
    params.set("title", message.title);
    params.set("desp", message.markdown);
    return params.toString();
  }
  if (provider === "qq_webhook") {
    return JSON.stringify({ title: message.title, content: message.text, markdown: message.markdown });
  }
  return JSON.stringify({ title: message.title, text: message.text, markdown: message.markdown });
}

function isConfigSendable(config: Awaited<ReturnType<typeof getNotificationConfig>>) {
  if (config.provider === "wecom_app") {
    return Boolean(config.corpId && config.agentId && config.appSecret && config.toUser);
  }
  return Boolean(config.webhookUrl);
}

function formatMoney(value?: number | null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `¥${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
