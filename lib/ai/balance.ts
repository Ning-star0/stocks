import { getAiConfig } from "@/lib/ai/config";
import { readProviderJsonResponse } from "@/lib/httpJson";

export type DeepSeekBalanceInfo = {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
};

export type DeepSeekBalanceResult = {
  provider: "deepseek";
  available: boolean;
  balanceInfos: DeepSeekBalanceInfo[];
  checkedAt: string;
  error?: string;
};

type DeepSeekBalancePayload = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
  error?: {
    message?: string;
  };
};

export async function getDeepSeekBalance(): Promise<DeepSeekBalanceResult | null> {
  const config = await getAiConfig();
  if (!config.baseUrl.includes("deepseek.com")) return null;
  if (!config.apiKey) {
    return {
      provider: "deepseek",
      available: false,
      balanceInfos: [],
      checkedAt: new Date().toISOString(),
      error: "DeepSeek API key 未配置。"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${config.baseUrl}/user/balance`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await readProviderJsonResponse<DeepSeekBalancePayload>(response, "DeepSeek 余额查询", { fallbackOnHttpError: {} });
    if (!response.ok) {
      return {
        provider: "deepseek",
        available: false,
        balanceInfos: [],
        checkedAt: new Date().toISOString(),
        error: payload.error?.message ?? `DeepSeek 余额查询失败：HTTP ${response.status}`
      };
    }
    return {
      provider: "deepseek",
      available: Boolean(payload.is_available),
      balanceInfos: (payload.balance_infos ?? []).map((item) => ({
        currency: item.currency ?? "--",
        totalBalance: item.total_balance ?? "0",
        grantedBalance: item.granted_balance ?? "0",
        toppedUpBalance: item.topped_up_balance ?? "0"
      })),
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      provider: "deepseek",
      available: false,
      balanceInfos: [],
      checkedAt: new Date().toISOString(),
      error: error instanceof Error && error.name === "AbortError" ? "DeepSeek 余额查询超时。" : "DeepSeek 余额查询失败。"
    };
  } finally {
    clearTimeout(timeout);
  }
}
