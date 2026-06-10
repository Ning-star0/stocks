export async function readJsonResponse<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`接口返回了非 JSON 响应（HTTP ${response.status}）：${summarizeNonJson(text)}`);
  }

  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口 JSON 解析失败（HTTP ${response.status}）：${summarizeNonJson(text)}`);
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(payload) ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

function apiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

function summarizeNonJson(text: string) {
  const summary = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return summary ? summary.slice(0, 180) : "空响应";
}
