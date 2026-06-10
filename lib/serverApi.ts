import { AppError } from "@/lib/errors";

export async function readRequestJson<T = unknown>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new AppError("BAD_REQUEST", "请求体必须是有效的 JSON。");
  }
}

export async function readOptionalRequestJson<T = Record<string, never>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("BAD_REQUEST", "请求体必须是有效的 JSON。");
  }
}
