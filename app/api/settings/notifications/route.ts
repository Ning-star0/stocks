import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { getNotificationConfig, maskSecret, maskWebhook, normalizeNotificationProvider, normalizeText, normalizeWebhookUrl, updateNotificationConfig } from "@/lib/notifications/config";
import { sendTestNotification } from "@/lib/notifications/send";
import { readRequestJson } from "@/lib/serverApi";

type NotificationSettingsRequest = {
  enabled?: boolean;
  provider?: string | null;
  webhookUrl?: string | null;
  corpId?: string | null;
  agentId?: string | null;
  appSecret?: string | null;
  toUser?: string | null;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    const config = await getNotificationConfig(user.id);
    return NextResponse.json(toResponse(config));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    const current = await getNotificationConfig(user.id);
    const body = await readRequestJson<NotificationSettingsRequest>(request);
    await updateNotificationConfig(user.id, {
      enabled: Boolean(body.enabled),
      provider: normalizeNotificationProvider(body.provider),
      webhookUrl: body.webhookUrl === undefined || body.webhookUrl === "" ? current.webhookUrl : normalizeWebhookUrl(body.webhookUrl),
      corpId: body.corpId === undefined || body.corpId === "" ? current.corpId : normalizeText(body.corpId),
      agentId: body.agentId === undefined || body.agentId === "" ? current.agentId : normalizeText(body.agentId),
      appSecret: body.appSecret === undefined || body.appSecret === "" ? current.appSecret : normalizeText(body.appSecret),
      toUser: body.toUser === undefined || body.toUser === "" ? current.toUser : normalizeText(body.toUser)
    });
    const next = await getNotificationConfig(user.id);
    return NextResponse.json(toResponse(next));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    await sendTestNotification({ userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function toResponse(config: Awaited<ReturnType<typeof getNotificationConfig>>) {
  return {
    enabled: config.enabled,
    provider: config.provider,
    webhookMasked: maskWebhook(config.webhookUrl),
    hasWebhook: Boolean(config.webhookUrl),
    corpId: config.corpId,
    agentId: config.agentId,
    appSecretMasked: maskSecret(config.appSecret),
    hasAppSecret: Boolean(config.appSecret),
    toUser: config.toUser
  };
}
