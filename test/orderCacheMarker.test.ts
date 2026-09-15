import assert from "node:assert/strict";
import test from "node:test";
import { CACHED_ORDER_REFERENCE } from "../src/markets/orderCacheMarker.js";

test("cached order marker is explicit and non-empty", () => {
  assert.equal(CACHED_ORDER_REFERENCE, "__SELLERHUB_CACHED_ORDERS__");
});
