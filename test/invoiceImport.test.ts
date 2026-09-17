import assert from "node:assert/strict";
import test from "node:test";
import { planInvoiceImport, summarizeInvoiceImport } from "../src/orders/invoiceImport.js";

test("plans bounded invoice registration behind confirmation", () => {
  const input = [
    { market: "naver", externalOrderLineId: "n-1", carrierCode: "CJ", invoiceNumber: "1234567890" },
    { market: "coupang", externalOrderLineId: "c-1", carrierCode: "LOTTE", invoiceNumber: "A-123456" },
  ];
  const plan = planInvoiceImport(input);
  assert.equal(plan.length, 2);
  assert.equal(plan[0]?.requiresConfirmation, true);
  assert.equal(plan[0]?.operation, "register_invoice");
  assert.equal(summarizeInvoiceImport(input).confirmationRequired, 2);
});

test("blocks duplicate order lines and invoices", () => {
  assert.throws(() => planInvoiceImport([
    { market: "naver", externalOrderLineId: "n-1", carrierCode: "CJ", invoiceNumber: "1234567890" },
    { market: "naver", externalOrderLineId: "n-1", carrierCode: "CJ", invoiceNumber: "9999999999" },
  ]), /duplicate order line/);
  assert.throws(() => planInvoiceImport([
    { market: "naver", externalOrderLineId: "n-1", carrierCode: "CJ", invoiceNumber: "1234567890" },
    { market: "coupang", externalOrderLineId: "c-1", carrierCode: "CJ", invoiceNumber: "1234567890" },
  ]), /duplicate invoice/);
});
