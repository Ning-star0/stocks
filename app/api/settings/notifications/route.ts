import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { getNotificationConfig, maskWebhook, normalizeNotificationProvider, normalizeWebhookUrl, updateNotificationConfig } from "@/lib/notifications/config";
import { sendTestNotification } from "@/lib/notifications/send";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const config = await getNotificationConfig(user.id);
    return NextResponse.json({
      enabled: config.enabled,
      provider: config.provider,
      webhookMasked: maskWebhook(config.webhookUrl),
      hasWebhook: Boolean(config.webhookUrl)
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    const current = await getNotificationConfig(user.id);
    const body = await request.json().catch(() => ({}));
    const next = await updateNotificationConfig(user.id, {
      enabled: Boolean(body.enabled),
      provider: normalizeNotificationProvider(body.provider),
      webhookUrl: body.webhookUrl === undefined || body.webhookUrl === "" ? current.webhookUrl : normalizeWebhookUrl(body.webhookUrl)
    });
    return NextResponse.json({
      enabled: next.enabled,
      provider: next.provider,
      webhookMasked: maskWebhook(next.webhookUrl),
      hasWebhook: Boolean(next.webhookUrl)
    });
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
