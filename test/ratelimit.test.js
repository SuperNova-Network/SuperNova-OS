import assert from "node:assert/strict";
import test from "node:test";
import { createLimiter } from "../src/ratelimit.js";
import { detectTrustProxy } from "../config.js";

test("peek never counts, refund gives a hit back", () => {
  const limiter = createLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal(limiter.peek("a"), 0);
  limiter.hit("a");
  limiter.hit("a");
  assert.ok(limiter.peek("a") > 0, "used up");
  limiter.refund("a");
  assert.equal(limiter.peek("a"), 0, "one back");
  assert.equal(limiter.hit("a"), 0);
  assert.ok(limiter.hit("a") > 0);
});

test("a proxy host is trusted on its own, unless told not to", () => {
  assert.equal(detectTrustProxy({}), false);
  assert.equal(detectTrustProxy({ FLY_APP_NAME: "x" }), 1);
  assert.equal(detectTrustProxy({ DYNO: "web.1" }), 1);
  assert.equal(detectTrustProxy({ FLY_APP_NAME: "x", TRUST_PROXY: "0" }), false);
  assert.equal(detectTrustProxy({ TRUST_PROXY: "2" }), 2);
  assert.equal(detectTrustProxy({ TRUST_PROXY: "true" }), true);
  assert.equal(detectTrustProxy({ TRUST_PROXY: "10.0.0.0/8" }), "10.0.0.0/8");
});
