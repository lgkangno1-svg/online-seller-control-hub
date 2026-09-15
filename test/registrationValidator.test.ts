import assert from "node:assert/strict";
import test from "node:test";
import { validateRegistrationPayload } from "../src/markets/registrationValidator.js";

function validCoupangPayload() {
  return {
    displayCategoryCode: 56137,
    sellerProductName: "홍옥 사과 5kg",
    saleStartedAt: "2026-09-10T00:00:00",
    saleEndedAt: "2099-01-01T23:59:59",
    vendorUserId: "wing-user",
    deliveryMethod: "COLD_FRESH",
    deliveryCompanyCode: "CJGLS",
    deliveryChargeType: "FREE",
    deliveryCharge: 0,
    freeShipOverAmount: 0,
    deliveryChargeOnReturn: 3000,
    remoteAreaDeliverable: "Y",
    unionDeliveryType: "UNION_DELIVERY",
    outboundShippingPlaceCode: 74010,
    returnCenterCode: "1000",
    returnChargeName: "기본 반품지",
    companyContactNumber: "02-1234-5678",
    returnZipCode: "04500",
    returnAddress: "서울특별시 중구",
    returnAddressDetail: "1층",
    returnCharge: 3000,
    items: [{
      itemName: "5kg",
      salePrice: 39900,
      maximumBuyCount: 20,
      maximumBuyForPerson: 0,
      maximumBuyForPersonPeriod: 1,
      outboundShippingTimeDay: 1,
      unitCount: 1,
      adultOnly: "EVERYONE",
      taxType: "FREE",
      parallelImported: "NOT_PARALLEL_IMPORTED",
      overseasPurchased: "NOT_OVERSEAS_PURCHASED",
      attributes: [{ attributeTypeName: "중량", attributeValueName: "5kg" }],
      images: [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: "https://example.com/apple.jpg" }],
      contentDetails: [{ detailType: "TEXT", content: "홍옥 사과 상세정보" }]
    }]
  };
}

test("Naver preflight blocks missing core product fields", () => {
  const result = validateRegistrationPayload("naver", {
    originProduct: { name: "홍옥 사과 5kg", salePrice: 39900, stockQuantity: 10 },
    smartstoreChannelProduct: {}
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === "originProduct.leafCategoryId"));
  assert.ok(result.errors.some((issue) => issue.path === "originProduct.images.representativeImage.url"));
});

test("Coupang preflight accepts a policy-ready product skeleton", () => {
  const result = validateRegistrationPayload("coupang", validCoupangPayload());
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("Coupang preflight rejects an item without purchase option attributes", () => {
  const payload = validCoupangPayload();
  payload.items[0]!.attributes = [];
  const result = validateRegistrationPayload("coupang", payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === "items.0.attributes"));
});

test("Coupang preflight rejects inventory above official per-item maximum", () => {
  const payload = validCoupangPayload();
  payload.items[0]!.maximumBuyCount = 100_000;
  const result = validateRegistrationPayload("coupang", payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === "items.0.maximumBuyCount"));
});

test("Toss preflight requires image roles and commerce policies", () => {
  const result = validateRegistrationPayload("toss", {
    name: "홍옥 사과 5kg",
    categoryId: 123,
    stocks: [{}],
    images: [{ type: "THUMBNAIL", url: "https://example.com/a.jpg" }],
    exposure: {},
    isTaxFree: true,
    deliveryPolicy: {},
    exchangeReturnPolicy: {},
    notice: {}
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.message.includes("DESCRIPTION")));
});

test("Kakao preflight blocks missing tax and product-condition fields", () => {
  const result = validateRegistrationPayload("kakao", {
    categoryId: "100100",
    name: "홍옥 사과 5kg",
    productDetailDescription: "상세설명",
    salePrice: 39900,
    useSalePeriod: false
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === "taxType"));
  assert.ok(result.errors.some((issue) => issue.path === "productCondition"));
});
