import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBulkProductValidation, validateBulkProducts } from "../src/catalog/bulkProductValidation.js";

test("reports valid rows and readiness warnings", () => {
  const input = [{ masterSku: "SKU-1", name: "Apple gift set", price: 25000, stock: 10 }];
  assert.equal(validateBulkProducts(input)[0]?.valid, true);
  assert.deepEqual(summarizeBulkProductValidation(input), { total: 1, valid: 1, invalid: 0, warnings: 2 });
});

test("rejects duplicate master sku", () => {
  const row = { masterSku: "SKU-1", name: "Apple gift set", price: 25000, stock: 10 };
  assert.equal(validateBulkProducts([row, row])[1]?.valid, false);
});
