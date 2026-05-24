import { prisma } from "@/lib/prisma";

export type NotificationProvider = "wecom" | "server_chan" | "qq_webhook" | "generic_webhook";

export type NotificationConfigData = {
  enabled: boolean;
  provider: NotificationProvider;
  webhookUrl: string;
};

const PROVIDERS = new Set<NotificationProvider>(["wecom", "server_chan", "qq_webhook", "generic_webhook"]);

export async function getNotificationConfig(userId: string): Promise<NotificationConfigData> {
  const row = await prisma.notificationConfig.findUnique({ where: { userId } });
  return {
    enabled: row?.enabled ?? false,
    provider: normalizeNotificationProvider(row?.provider),
    webhookUrl: row?.webhookUrl ?? ""
  };
}

export async function updateNotificationConfig(userId: string, input: Partial<NotificationConfigData>) {
  const data = {
    enabled: Boolean(input.enabled),
    provider: normalizeNotificationProvider(input.provider),
    webhookUrl: normalizeWebhookUrl(input.webhookUrl)
  };

  return prisma.notificationConfig.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data }
  });
}

export function normalizeNotificationProvider(value?: string | null): NotificationProvider {
  const provider = String(value ?? "wecom").trim() as NotificationProvider;
  return PROVIDERS.has(provider) ? provider : "wecom";
}

export function normalizeWebhookUrl(value?: string | null) {
  return String(value ?? "").trim();
}

export function maskWebhook(value: string) {
  if (!value) return "";
  if (value.length <= 12) return "已配置";
  return `${value.slice(0, 8)}***${value.slice(-6)}`;
}
