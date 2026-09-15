import assert from "node:assert/strict";
import test from "node:test";
import { validateRegistrationPayload } from "../src/markets/registrationValidator.js";

function naverPayload(overrides: Record<string, unknown> = {}) {
  return {
    originProduct: {
      statusType: "SALE",
      leafCategoryId: "50000000",
      name: "테스트 상품",
      detailContent: "상품 상세 설명",
      salePrice: 10_000,
      stockQuantity: 10,
      images: { representativeImage: { url: "https://example.com/main.jpg" }, optionalImages: [] },
      ...overrides
    },
    smartstoreChannelProduct: {}
  };
}

test("Naver option price range follows sale-price tiers and requires a zero-price option", () => {
  const invalid = validateRegistrationPayload("naver", naverPayload({
    optionInfo: {
      optionCombinationGroupNames: { optionGroupName1: "중량" },
      optionCombinations: [
        { optionName1: "5kg", price: 5_001, stockQuantity: 5, usable: true },
        { optionName1: "10kg", price: 6_000, stockQuantity: 5, usable: true }
      ],
      useStockManagement: true
    }
  }));

  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((issue) => issue.path === "originProduct.optionInfo.optionCombinations.0.price"));
  assert.ok(invalid.errors.some((issue) => issue.path === "originProduct.optionInfo.optionCombinations"));

  const valid = validateRegistrationPayload("naver", naverPayload({
    optionInfo: {
      optionCombinationGroupNames: { optionGroupName1: "중량" },
      optionCombinations: [
        { optionName1: "5kg", price: 0, stockQuantity: 5, usable: true },
        { optionName1: "10kg", price: 5_000, stockQuantity: 5, usable: true }
      ],
      useStockManagement: true
    }
  }));

  assert.equal(valid.errors.some((issue) => issue.path.startsWith("originProduct.optionInfo")), false);
});

test("Naver option price tiers allow only positive delta below 2,000 won", () => {
  const result = validateRegistrationPayload("naver", naverPayload({
    salePrice: 1_500,
    optionInfo: {
      optionCombinations: [
        { optionName1: "기본", price: 0, stockQuantity: 1 },
        { optionName1: "할인옵션", price: -1, stockQuantity: 1 }
      ]
    }
  }));

  assert.ok(result.errors.some((issue) => issue.path === "originProduct.optionInfo.optionCombinations.1.price"));
});

test("Naver immediate discount rejects zero-price outcomes and provider-out-of-range values", () => {
  const percent = validateRegistrationPayload("naver", naverPayload({
    customerBenefit: {
      immediateDiscountPolicy: { discountMethod: { value: 100, unitType: "PERCENT" } }
    }
  }));
  assert.ok(percent.errors.some((issue) => issue.path.endsWith("discountMethod.value")));

  const won = validateRegistrationPayload("naver", naverPayload({
    customerBenefit: {
      immediateDiscountPolicy: { discountMethod: { value: 10_000, unitType: "WON" } }
    }
  }));
  assert.ok(won.errors.some((issue) => issue.path.endsWith("discountMethod.value")));

  const providerMaximum = validateRegistrationPayload("naver", naverPayload({
    customerBenefit: {
      immediateDiscountPolicy: { discountMethod: { value: 10_000_001, unitType: "WON" } }
    }
  }));
  assert.ok(providerMaximum.errors.some((issue) => issue.path.endsWith("discountMethod.value")));
});

test("Coupang search tags enforce count, length and allowed special characters", () => {
  const tooMany = validateRegistrationPayload("coupang", {
    sellerProductName: "테스트 상품",
    searchTags: Array.from({ length: 21 }, (_, index) => `검색어${index}`),
    items: []
  });
  assert.ok(tooMany.errors.some((issue) => issue.path === "searchTags"));

  const badTags = validateRegistrationPayload("coupang", {
    sellerProductName: "테스트 상품",
    searchTags: ["가".repeat(21), "허용되지않음?"],
    items: []
  });
  assert.ok(badTags.errors.some((issue) => issue.path === "searchTags.0"));
  assert.ok(badTags.errors.some((issue) => issue.path === "searchTags.1"));

  const allowedTags = validateRegistrationPayload("coupang", {
    sellerProductName: "테스트 상품",
    searchTags: ["선물세트", "사과+배", "특가!"],
    items: []
  });
  assert.equal(allowedTags.errors.some((issue) => issue.path.startsWith("searchTags")), false);
});

test("Coupang listing names and detail image count use official upload limits", () => {
  const result = validateRegistrationPayload("coupang", {
    sellerProductName: "가".repeat(101),
    displayProductName: "나".repeat(101),
    searchTags: [],
    items: [{
      itemName: "기본",
      salePrice: 10_000,
      maximumBuyCount: 1,
      maximumBuyForPerson: 0,
      maximumBuyForPersonPeriod: 1,
      outboundShippingTimeDay: 1,
      unitCount: 1,
      adultOnly: "EVERYONE",
      taxType: "TAX",
      parallelImported: "NOT_PARALLEL_IMPORTED",
      overseasPurchased: "NOT_OVERSEAS_PURCHASED",
      attributes: [{ attributeTypeName: "구성", attributeValueName: "기본" }],
      images: [
        { imageType: "REPRESENTATION", vendorPath: "https://example.com/main.jpg" },
        ...Array.from({ length: 10 }, (_, index) => ({ imageType: "DETAIL", vendorPath: `https://example.com/${index}.jpg` }))
      ],
      contentDetails: [{ detailType: "TEXT", content: "상세" }]
    }]
  });

  assert.ok(result.errors.some((issue) => issue.path === "sellerProductName"));
  assert.ok(result.errors.some((issue) => issue.path === "displayProductName"));
  assert.ok(result.errors.some((issue) => issue.path === "items.0.images"));
});
