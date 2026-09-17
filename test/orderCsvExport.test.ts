import assert from "node:assert/strict";
import test from "node:test";
import { exportOrdersCsv } from "../src/orders/orderCsvExport.js";

test("exports normalized orders without buyer PII and escapes CSV", () => {
 const csv=exportOrdersCsv([{market:"naver",externalOrderId:"o1",externalOrderLineId:"l1",masterSku:"SKU1",productName:'상품, "A"',quantity:2,unitPrice:1000,status:"confirmed",orderedAt:"2026-09-17T00:00:00+09:00",buyerName:"secret"}]);
 assert.match(csv,/market,externalOrderId/); assert.match(csv,/"상품, ""A"""/); assert.doesNotMatch(csv,/secret/);
});
