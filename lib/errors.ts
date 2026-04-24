import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type AppErrorCode =
  | "BAD_REQUEST"
  | "RATE_LIMIT"
  | "UNAUTHORIZED"
  | "SYMBOL_NOT_FOUND"
  | "AI_INVALID_JSON"
  | "INSUFFICIENT_DATA"
  | "DATA_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

const statusByCode: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  RATE_LIMIT: 429,
  UNAUTHORIZED: 401,
  SYMBOL_NOT_FOUND: 404,
  AI_INVALID_JSON: 502,
  INSUFFICIENT_DATA: 422,
  DATA_PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500
};

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "请求参数无效。",
          details: error.flatten()
        }
      },
      { status: 400 }
    );
  }

  if (isAppError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      },
      { status: statusByCode[error.code] }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "服务器发生未知错误。"
      }
    },
    { status: 500 }
  );
}

export function parseProviderError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const message = error instanceof Error ? error.message : "股票数据源请求失败。";
  const lower = message.toLowerCase();

  if (lower.includes("rate") || lower.includes("frequency") || lower.includes("limit")) {
    return new AppError("RATE_LIMIT", "股票数据源触发限流，请稍后重试。", { providerMessage: message });
  }

  if (lower.includes("symbol") && (lower.includes("not found") || lower.includes("invalid") || lower.includes("no quote"))) {
    return new AppError("SYMBOL_NOT_FOUND", "未找到该股票代码。", { providerMessage: message });
  }

  return new AppError("DATA_PROVIDER_ERROR", "股票数据源请求失败。", { providerMessage: message });
}
