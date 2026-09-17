import assert from "node:assert/strict";import test from "node:test";import {mapCatalogImportRows} from "../src/catalog/catalogImportMapping.js";
test("maps seller spreadsheet columns to canonical catalog fields",()=>{const [r]=mapCatalogImportRows([{SKU:"A",상품명:"Apple",판매가:1000,재고:3}],{SKU:"masterSku",상품명:"name",판매가:"price",재고:"stock"});assert.deepEqual(r?.product,{masterSku:"A",name:"Apple",price:1000,stock:3});});
test("requires core mappings",()=>assert.throws(()=>mapCatalogImportRows([],{SKU:"masterSku"}),/missing required mapping/));
