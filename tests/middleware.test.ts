import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { middleware } from "../middleware";

test("health endpoint stays public for deployment probes", () => {
  const response = middleware(new NextRequest("https://stocks.example/api/health"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("other API endpoints still require authentication", async () => {
  const response = middleware(new NextRequest("https://stocks.example/api/stocks"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHORIZED", message: "请先登录。" }
  });
});

test("authenticated API requests still pass through", () => {
  const request = new NextRequest("https://stocks.example/api/stocks", {
    headers: { cookie: "stock_ai_session=valid-session-placeholder" }
  });
  const response = middleware(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});
