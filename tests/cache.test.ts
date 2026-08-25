import assert from "node:assert/strict";
import test from "node:test";

import { coalesceInFlight } from "@/lib/cache";

test("concurrent cache misses share one upstream request", async () => {
  const key = `test:in-flight:${Date.now()}:${Math.random()}`;
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { value: 42 };
  };

  const [first, second] = await Promise.all([
    coalesceInFlight(key, loader),
    coalesceInFlight(key, loader)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first.value, { value: 42 });
  assert.deepEqual(second.value, { value: 42 });
  assert.deepEqual(new Set([first.source, second.source]), new Set(["fresh", "in_flight"]));
});
