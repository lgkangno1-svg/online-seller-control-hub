import assert from "node:assert/strict";import test from "node:test";import {planCatalogBulkEdits} from "../src/catalog/bulkEditPlan.js";
test("plans bounded edits with confirmation",()=>{const r=planCatalogBulkEdits([{masterSku:"A",market:"naver",price:12000},{masterSku:"B",market:"coupang",saleStatus:"paused"}]);assert.equal(r[0]?.requiresConfirmation,true);assert.equal(r[1]?.risk,"high");});
test("rejects duplicates",()=>assert.throws(()=>planCatalogBulkEdits([{masterSku:"A",market:"naver",stock:1},{masterSku:"A",market:"naver",price:2}]),/duplicate bulk edit/));
