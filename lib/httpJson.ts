import { AppError } from "@/lib/errors";

type ReadProviderJsonOptions<T> = {
  fallbackOnHttpError?: T;
};

export async function readProviderJsonResponse<T>(
  response: Response,
  source: string,
  options: ReadProviderJsonOptions<T> = {}
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok && "fallbackOnHttpError" in options) return options.fallbackOnHttpError as T;
    throw new AppError("DATA_PROVIDER_ERROR", `${source} 返回空响应。`, { status: response.status });
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    if (!response.ok && "fallbackOnHttpError" in options) return options.fallbackOnHttpError as T;
    throw new AppError("DATA_PROVIDER_ERROR", `${source} 返回的不是有效 JSON。`, {
      status: response.status,
      body: summarizeBody(text)
    });
  }
}

function summarizeBody(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
