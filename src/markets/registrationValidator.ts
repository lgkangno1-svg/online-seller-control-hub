import { z } from "zod";
import type { Market } from "../core/types.js";

export type RegistrationIssue = {
  level: "error" | "warning";
  path: string;
  message: string;
};

export type RegistrationValidation = {
  market: Market;
  ok: boolean;
  errors: RegistrationIssue[];
  warnings: RegistrationIssue[];
};

const TOSS_PRODUCT_NAME = /^[0-9a-zA-Z가-힣 ()\-·\[\]\/&+,~.*_#]{1,100}$/;
const TOSS_BRAND_NAME = /^[0-9a-zA-Z가-힣 *()\-_+\/.,]{1,50}$/;
const TOSS_FORBIDDEN_BRANDS = new Set(["없음", "중국", "기타", "OEM", "협력사"]);
const COUPANG_UID_NAMES = new Set(["Global Trade Item Number", "Manufacturer Part Number"]);
const COUPANG_LEGACY_UID_NAMES = new Set(["GTIN", "Variation MPN"]);
const COUPANG_SEARCH_TAG = /^[\p{L}\p{N}\s!@#$%^&*\-+;:'.]+$/u;
const KAKAO_PRODUCT_NAME = /^[0-9a-zA-Z가-힣 .(),\[\]+\-&\/_'"%*~!=|˚]+$/;

export function validateRegistrationPayload(market: Market, payload: unknown): RegistrationValidation {
  const root = z.record(z.unknown()).safeParse(payload);
  if (!root.success) {
    const issue = { level: "error" as const, path: "$", message: "상품 등록 요청은 JSON 객체여야 합니다." };
    return { market, ok: false, errors: [issue], warnings: [] };
  }

  const issues: RegistrationIssue[] = [];
  const value = root.data;
  switch (market) {
    case "naver": validateNaver(value, issues); break;
    case "coupang": validateCoupang(value, issues); break;
    case "toss": validateToss(value, issues); break;
    case "kakao": validateKakao(value, issues); break;
    case "gmarket": validateGmarket(value, issues); break;
    case "lotteon":
      if (Object.keys(value).length === 0) error(issues, "$", "롯데ON 상품 등록 요청이 비어 있습니다.");
      warn(issues, "$", "롯데ON은 판매자별 OpenAPI 상품 스펙과 등록 경로가 확인된 배포 환경에서만 실제 등록을 허용합니다. API Key는 발급일 기준 1년 유효하며 등록 서버 IP가 일치해야 합니다.");
      break;
  }

  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  return { market, ok: errors.length === 0, errors, warnings };
}

function validateNaver(value: Record<string, unknown>, issues: RegistrationIssue[]) {
  const origin = requireObject(value, "originProduct", issues, "네이버 원상품(originProduct)이 필요합니다.");
  requireObject(value, "smartstoreChannelProduct", issues, "스마트스토어 채널상품(smartstoreChannelProduct)이 필요합니다.");
  if (!origin) return;

  requireText(origin, "leafCategoryId", "originProduct.leafCategoryId", issues, "최하위 카테고리 ID를 선택해 주세요.");
  requireText(origin, "name", "originProduct.name", issues, "상품명을 입력해 주세요.");
  requireText(origin, "detailContent", "originProduct.detailContent", issues, "상품 상세설명을 입력해 주세요.");
  requirePositiveNumber(origin, "salePrice", "originProduct.salePrice", issues, "판매가는 1원 이상이어야 합니다.");
  requireNonNegativeInteger(origin, "stockQuantity", "originProduct.stockQuantity", issues, "재고는 0 이상의 정수여야 합니다.");
  const salePrice = Number(origin.salePrice);
  if (Number(origin.stockQuantity) > 99_999_999) error(issues, "originProduct.stockQuantity", "네이버 재고는 최대 99,999,999개입니다.");
  if (salePrice > 999_999_990) error(issues, "originProduct.salePrice", "네이버 판매가는 최대 999,999,990원입니다.");

  const images = objectAt(origin.images);
  const representative = images ? objectAt(images.representativeImage) : null;
  if (!representative || !textAt(representative.url)) {
    error(issues, "originProduct.images.representativeImage.url", "대표이미지 URL이 필요합니다. 네이버 이미지 업로드 API에서 받은 URL을 사용해야 합니다.");
  }
  const optionalImages = images && Array.isArray(images.optionalImages) ? images.optionalImages : [];
  if (optionalImages.length > 9) error(issues, "originProduct.images.optionalImages", "네이버 추가이미지는 최대 9개까지 등록할 수 있습니다.");

  const status = textAt(origin.statusType);
  if (!status) warn(issues, "originProduct.statusType", "판매상태(statusType)를 명시하는 것을 권장합니다.");
  else if (status !== "SALE") error(issues, "originProduct.statusType", "네이버 신규 상품 등록 시 statusType은 SALE만 사용할 수 있습니다.");

  validateNaverImmediateDiscount(origin, salePrice, issues);
  validateNaverOptions(origin, salePrice, issues);
}

function validateNaverImmediateDiscount(origin: Record<string, unknown>, salePrice: number, issues: RegistrationIssue[]) {
  const customerBenefit = objectAt(origin.customerBenefit);
  const immediate = customerBenefit ? objectAt(customerBenefit.immediateDiscountPolicy) : null;
  const method = immediate ? objectAt(immediate.discountMethod) : null;
  if (!method) return;

  const unitType = textAt(method.unitType);
  const value = Number(method.value);
  if (unitType !== "PERCENT" && unitType !== "WON") {
    error(issues, "originProduct.customerBenefit.immediateDiscountPolicy.discountMethod.unitType", "네이버 즉시할인은 PERCENT 또는 WON만 사용할 수 있습니다.");
  }
  if (!Number.isFinite(value) || value < 1 || value > 10_000_000) {
    error(issues, "originProduct.customerBenefit.immediateDiscountPolicy.discountMethod.value", "네이버 즉시할인 값은 1 이상 10,000,000 이하이어야 합니다.");
    return;
  }
  if (unitType === "PERCENT" && value >= 100) {
    error(issues, "originProduct.customerBenefit.immediateDiscountPolicy.discountMethod.value", "SellerHub 안전 정책상 정률 즉시할인은 최종 판매가가 0원이 되지 않도록 99% 이하로 제한합니다.");
  }
  if (unitType === "WON" && Number.isFinite(salePrice) && value >= salePrice) {
    error(issues, "originProduct.customerBenefit.immediateDiscountPolicy.discountMethod.value", "정액 즉시할인은 판매가보다 작아야 합니다.");
  }
}

function validateNaverOptions(origin: Record<string, unknown>, salePrice: number, issues: RegistrationIssue[]) {
  const optionInfo = objectAt(origin.optionInfo);
  if (!optionInfo) return;
  const combinations = Array.isArray(optionInfo.optionCombinations) ? optionInfo.optionCombinations : [];
  if (combinations.length === 0) return;

  const range = naverOptionPriceRange(salePrice);
  let hasZeroPrice = false;
  combinations.forEach((combination, index) => {
    const row = objectAt(combination);
    if (!row) return error(issues, `originProduct.optionInfo.optionCombinations.${index}`, "네이버 옵션 조합은 객체 형식이어야 합니다.");
    const price = Number(row.price);
    if (!Number.isInteger(price)) {
      error(issues, `originProduct.optionInfo.optionCombinations.${index}.price`, "네이버 옵션가는 정수로 입력해야 합니다.");
    } else {
      if (price === 0) hasZeroPrice = true;
      if (price < range.min || price > range.max) {
        error(
          issues,
          `originProduct.optionInfo.optionCombinations.${index}.price`,
          `판매가 ${formatNumber(salePrice)}원 기준 옵션가는 ${formatSigned(range.min)}원 ~ ${formatSigned(range.max)}원 범위여야 합니다.`
        );
      }
    }
    requireNonNegativeInteger(row, "stockQuantity", `originProduct.optionInfo.optionCombinations.${index}.stockQuantity`, issues, "네이버 옵션 재고는 0 이상의 정수여야 합니다.");
    if (Number(row.stockQuantity) > 99_999_999) {
      error(issues, `originProduct.optionInfo.optionCombinations.${index}.stockQuantity`, "네이버 옵션 재고는 최대 99,999,999개입니다.");
    }
  });
  if (!hasZeroPrice) {
    error(issues, "originProduct.optionInfo.optionCombinations", "네이버 옵션 조합에는 추가금 0원인 옵션이 최소 1개 있어야 합니다.");
  }
}

function naverOptionPriceRange(salePrice: number): { min: number; max: number } {
  if (!Number.isFinite(salePrice) || salePrice <= 0) return { min: 0, max: 0 };
  if (salePrice < 2_000) return { min: 0, max: Math.floor(salePrice) };
  if (salePrice < 10_000) return { min: -Math.floor(salePrice * 0.5), max: Math.floor(salePrice) };
  return { min: -Math.floor(salePrice * 0.5), max: Math.floor(salePrice * 0.5) };
}

function validateCoupang(value: Record<string, unknown>, issues: RegistrationIssue[]) {
  requireText(value, "sellerProductName", "sellerProductName", issues, "쿠팡 등록상품명을 입력해 주세요.");
  const sellerProductName = textAt(value.sellerProductName);
  if (sellerProductName && sellerProductName.length > 100) error(issues, "sellerProductName", "쿠팡 등록상품명은 최대 100자입니다.");
  const displayProductName = textAt(value.displayProductName);
  if (displayProductName && displayProductName.length > 100) error(issues, "displayProductName", "쿠팡 노출상품명은 최대 100자입니다.");
  requireText(value, "saleStartedAt", "saleStartedAt", issues, "판매 시작일시가 필요합니다.");
  requireText(value, "saleEndedAt", "saleEndedAt", issues, "판매 종료일시가 필요합니다.");
  requireText(value, "vendorUserId", "vendorUserId", issues, "쿠팡 WING 실사용자 ID가 필요합니다.");
  requireText(value, "deliveryMethod", "deliveryMethod", issues, "배송방법(deliveryMethod)을 선택해 주세요. 신선식품은 COLD_FRESH 정책을 확인하세요.");
  requireText(value, "deliveryCompanyCode", "deliveryCompanyCode", issues, "택배사 코드를 선택해 주세요.");
  requireText(value, "deliveryChargeType", "deliveryChargeType", issues, "배송비 종류를 선택해 주세요.");
  requireNonNegativeNumber(value, "deliveryCharge", "deliveryCharge", issues, "기본 배송비를 입력해 주세요.");
  requireNonNegativeNumber(value, "freeShipOverAmount", "freeShipOverAmount", issues, "무료배송 조건 금액을 입력해 주세요. 무료배송이면 0입니다.");
  requireNonNegativeNumber(value, "deliveryChargeOnReturn", "deliveryChargeOnReturn", issues, "초도 반품배송비를 입력해 주세요.");
  requireText(value, "remoteAreaDeliverable", "remoteAreaDeliverable", issues, "도서산간 배송 여부를 선택해 주세요.");
  requireText(value, "unionDeliveryType", "unionDeliveryType", issues, "묶음배송 여부를 선택해 주세요.");
  requireValue(value, "outboundShippingPlaceCode", "outboundShippingPlaceCode", issues, "출고지 코드를 선택해 주세요.");
  requireValue(value, "returnCenterCode", "returnCenterCode", issues, "반품지 코드를 선택해 주세요.");
  requireText(value, "returnChargeName", "returnChargeName", issues, "반품지명을 입력해 주세요.");
  requireText(value, "companyContactNumber", "companyContactNumber", issues, "반품지 연락처가 필요합니다.");
  requireText(value, "returnZipCode", "returnZipCode", issues, "반품지 우편번호가 필요합니다.");
  requireText(value, "returnAddress", "returnAddress", issues, "반품지 주소가 필요합니다.");
  requireText(value, "returnAddressDetail", "returnAddressDetail", issues, "반품지 상세주소가 필요합니다.");
  requireNonNegativeNumber(value, "returnCharge", "returnCharge", issues, "반품배송비가 필요합니다.");
  if (!value.displayCategoryCode) warn(issues, "displayCategoryCode", "쿠팡 카테고리 메타의 필수 구매옵션 검증을 위해 displayCategoryCode를 명시하는 것을 권장합니다.");
  if (textAt(value.deliveryMethod) === "SEQUENCIAL") warn(issues, "deliveryMethod", "신선식품이라면 쿠팡 정책상 일반배송(SEQUENCIAL)이 아닌 COLD_FRESH 사용 여부를 확인하세요.");

  validateCoupangSearchTags(value, issues);

  const brand = textAt(value.brand);
  const brandId = value.brandId;
  const hasBrandId = brandId !== undefined && brandId !== null && brandId !== "";
  if (brand && !hasBrandId) {
    error(issues, "brandId", "브랜드 상품은 쿠팡 Brand Search/등록 브랜드 API에서 표준 brandId를 확인해 입력해 주세요. 2026-07-31 이후 강화된 브랜드 정책 대응 항목입니다.");
  } else if (!brand && !hasBrandId) {
    warn(issues, "brandId", "브랜드가 있는 상품이라면 표준 brandId를 반드시 확인해 입력하세요. 상품명에 브랜드가 있는데 brand/brandId가 비어 있으면 심사 반려될 수 있습니다.");
  }

  const items = Array.isArray(value.items) ? value.items : [];
  if (items.length === 0) {
    error(issues, "items", "쿠팡 상품은 최소 1개의 옵션(items)이 필요합니다.");
    return;
  }
  if (items.length > 200) error(issues, "items", "쿠팡 옵션은 최대 200개까지 등록할 수 있습니다.");
  items.forEach((item, index) => {
    const row = objectAt(item);
    if (!row) return error(issues, `items.${index}`, "옵션은 객체 형식이어야 합니다.");
    requireText(row, "itemName", `items.${index}.itemName`, issues, "옵션명을 입력해 주세요.");
    requirePositiveNumber(row, "salePrice", `items.${index}.salePrice`, issues, "옵션 판매가는 1원 이상이어야 합니다.");
    requireNonNegativeInteger(row, "maximumBuyCount", `items.${index}.maximumBuyCount`, issues, "판매가능 재고를 입력해 주세요.");
    if (Number(row.maximumBuyCount) > 99_999) error(issues, `items.${index}.maximumBuyCount`, "쿠팡 옵션 판매가능 재고는 최대 99,999개입니다.");
    requireNonNegativeInteger(row, "maximumBuyForPerson", `items.${index}.maximumBuyForPerson`, issues, "1인 최대 구매수량을 입력해 주세요. 제한없음은 0입니다.");
    requirePositiveInteger(row, "maximumBuyForPersonPeriod", `items.${index}.maximumBuyForPersonPeriod`, issues, "최대 구매수량 기간을 1 이상의 정수로 입력해 주세요.");
    requireNonNegativeInteger(row, "outboundShippingTimeDay", `items.${index}.outboundShippingTimeDay`, issues, "출고 소요일을 입력해 주세요.");
    requirePositiveNumber(row, "unitCount", `items.${index}.unitCount`, issues, "단위수량(unitCount)을 입력해 주세요. 단일 구성은 1입니다.");
    requireText(row, "adultOnly", `items.${index}.adultOnly`, issues, "성인상품 여부(adultOnly)가 필요합니다.");
    requireText(row, "taxType", `items.${index}.taxType`, issues, "과세여부(taxType)가 필요합니다.");
    requireText(row, "parallelImported", `items.${index}.parallelImported`, issues, "병행수입여부(parallelImported)가 필요합니다.");
    requireText(row, "overseasPurchased", `items.${index}.overseasPurchased`, issues, "해외구매대행여부(overseasPurchased)가 필요합니다.");

    const autoPricing = objectAt(row.autoPricingInfo);
    if (autoPricing) {
      if (typeof autoPricing.active !== "boolean") error(issues, `items.${index}.autoPricingInfo.active`, "자동가격 active는 Boolean 값이어야 합니다.");
      requirePositiveNumber(autoPricing, "minSalePrice", `items.${index}.autoPricingInfo.minSalePrice`, issues, "자동가격 최저가(minSalePrice)가 필요합니다.");
      if (Number(autoPricing.minSalePrice) >= Number(row.salePrice)) error(issues, `items.${index}.autoPricingInfo.minSalePrice`, "자동가격 최저가는 판매가보다 작아야 합니다.");
    }

    const attributes = Array.isArray(row.attributes) ? row.attributes : [];
    if (attributes.length === 0) {
      error(issues, `items.${index}.attributes`, "쿠팡 카테고리의 필수 구매옵션/속성을 attributes에 최소 1개 이상 입력해 주세요.");
    }
    let hasUid = false;
    let hasLegacyUid = false;
    attributes.forEach((attribute, attributeIndex) => {
      const data = objectAt(attribute);
      if (!data) return error(issues, `items.${index}.attributes.${attributeIndex}`, "속성은 객체 형식이어야 합니다.");
      requireText(data, "attributeTypeName", `items.${index}.attributes.${attributeIndex}.attributeTypeName`, issues, "속성명을 입력해 주세요.");
      requireText(data, "attributeValueName", `items.${index}.attributes.${attributeIndex}.attributeValueName`, issues, "속성값을 입력해 주세요.");
      const attributeName = textAt(data.attributeTypeName);
      if (attributeName && COUPANG_UID_NAMES.has(attributeName)) hasUid = true;
      if (attributeName && COUPANG_LEGACY_UID_NAMES.has(attributeName)) hasLegacyUid = true;
    });
    if (hasLegacyUid) warn(issues, `items.${index}.attributes`, "기존 GTIN/Variation MPN 속성명은 향후 지원 중단 예정입니다. Global Trade Item Number / Manufacturer Part Number 명칭으로 전환하세요.");
    if (!hasUid && !hasLegacyUid && hasBrandId) {
      warn(issues, `items.${index}.attributes`, "Brand Search 결과 isUIDRequired=true인 브랜드라면 Global Trade Item Number 또는 Manufacturer Part Number가 필수입니다. 등록 직전 브랜드 정책을 재조회하세요.");
    }

    const images = Array.isArray(row.images) ? row.images : [];
    if (images.length === 0) error(issues, `items.${index}.images`, "쿠팡 옵션별 상품 이미지가 필요합니다.");
    else if (!images.some((image) => objectAt(image)?.imageType === "REPRESENTATION")) error(issues, `items.${index}.images`, "대표이미지(imageType=REPRESENTATION)가 최소 1개 필요합니다.");
    const detailImageCount = images.filter((image) => objectAt(image)?.imageType === "DETAIL").length;
    if (detailImageCount > 9) error(issues, `items.${index}.images`, "쿠팡 DETAIL 이미지는 최대 9개까지 등록할 수 있습니다.");

    const contentDetails = Array.isArray(row.contentDetails) ? row.contentDetails : [];
    if (contentDetails.length === 0) error(issues, `items.${index}.contentDetails`, "상세컨텐츠(contentDetails)가 필요합니다.");

    const notices = Array.isArray(row.notices) ? row.notices : [];
    if (notices.length === 0) warn(issues, `items.${index}.notices`, "카테고리 메타가 요구하는 상품고시정보(notices)를 최신 카테고리 메타와 정확히 맞춰 주세요.");
  });
}

function validateCoupangSearchTags(value: Record<string, unknown>, issues: RegistrationIssue[]) {
  if (value.searchTags === undefined) return;
  if (!Array.isArray(value.searchTags)) {
    error(issues, "searchTags", "쿠팡 검색어(searchTags)는 문자열 배열이어야 합니다.");
    return;
  }
  if (value.searchTags.length > 20) error(issues, "searchTags", "쿠팡 검색어는 최대 20개까지 입력할 수 있습니다.");
  value.searchTags.forEach((tag, index) => {
    if (typeof tag !== "string" || !tag.trim()) {
      error(issues, `searchTags.${index}`, "쿠팡 검색어는 빈 문자열일 수 없습니다.");
      return;
    }
    const normalized = tag.trim();
    if (normalized.length > 20) error(issues, `searchTags.${index}`, "쿠팡 검색어 1개는 최대 20자입니다.");
    if (!COUPANG_SEARCH_TAG.test(normalized)) {
      error(issues, `searchTags.${index}`, "쿠팡 검색어에는 !@#$%^&*-+;:'. 외의 특수문자를 사용할 수 없습니다.");
    }
  });
}

function validateToss(value: Record<string, unknown>, issues: RegistrationIssue[]) {
  const name = textAt(value.name);
  if (!name) error(issues, "name", "토스쇼핑 상품명을 입력해 주세요.");
  else if (!TOSS_PRODUCT_NAME.test(name)) error(issues, "name", "토스쇼핑 상품명은 1~100자이며 허용된 한글/영문/숫자/기호만 사용할 수 있습니다.");

  const brandName = textAt(value.brandName);
  if (brandName) {
    if (!TOSS_BRAND_NAME.test(brandName)) error(issues, "brandName", "토스쇼핑 브랜드명은 1~50자이며 허용 문자만 사용할 수 있습니다.");
    if (TOSS_FORBIDDEN_BRANDS.has(brandName)) error(issues, "brandName", `토스쇼핑 브랜드명에는 '${brandName}'을 사용할 수 없습니다.`);
  }

  requirePositiveNumber(value, "categoryId", "categoryId", issues, "최하위 카테고리를 선택해 주세요.");
  if (typeof value.isTaxFree !== "boolean") error(issues, "isTaxFree", "면세 여부(isTaxFree)를 선택해 주세요.");
  requireObject(value, "exposure", issues, "상품 노출 정보(exposure)가 필요합니다.");
  requireObject(value, "deliveryPolicy", issues, "배송 정책(deliveryPolicy)이 필요합니다.");
  requireObject(value, "exchangeReturnPolicy", issues, "교환/반품 정책(exchangeReturnPolicy)이 필요합니다.");
  requireObject(value, "notice", issues, "상품정보제공고시(notice)가 필요합니다.");

  const stocks = Array.isArray(value.stocks) ? value.stocks : [];
  if (stocks.length === 0) error(issues, "stocks", "토스쇼핑은 최소 1개의 옵션 판매정보(stocks)가 필요합니다.");
  if (stocks.length > 300) error(issues, "stocks", "토스쇼핑 옵션 판매정보는 최대 300개입니다.");
  let mainPriceCount = 0;
  stocks.forEach((stock, index) => {
    const row = objectAt(stock);
    if (!row) return error(issues, `stocks.${index}`, "옵션 판매정보는 객체여야 합니다.");
    requireNonNegativeInteger(row, "remainingCount", `stocks.${index}.remainingCount`, issues, "옵션 재고 remainingCount가 필요합니다.");
    requirePositiveNumber(row, "originPrice", `stocks.${index}.originPrice`, issues, "옵션 정상가 originPrice가 필요합니다.");
    requirePositiveNumber(row, "salePrice", `stocks.${index}.salePrice`, issues, "옵션 판매가 salePrice가 필요합니다.");
    if (typeof row.isHide !== "boolean") error(issues, `stocks.${index}.isHide`, "옵션 숨김 여부 isHide가 필요합니다.");
    if (typeof row.isSoldOut !== "boolean") error(issues, `stocks.${index}.isSoldOut`, "옵션 품절 여부 isSoldOut이 필요합니다.");
    if (typeof row.isMainPrice !== "boolean") error(issues, `stocks.${index}.isMainPrice`, "대표가격 여부 isMainPrice가 필요합니다.");
    if (row.isMainPrice === true) mainPriceCount++;
    const code = textAt(row.managementCode);
    if (code && code.length > 100) error(issues, `stocks.${index}.managementCode`, "옵션 관리코드는 최대 100자입니다.");
  });
  if (stocks.length > 0 && mainPriceCount === 0) error(issues, "stocks", "stocks 중 최소 1개는 isMainPrice=true여야 합니다.");

  const images = Array.isArray(value.images) ? value.images : [];
  if (images.length === 0) {
    error(issues, "images", "상품 이미지가 필요합니다.");
  } else {
    const types = new Set(images.map((image) => objectAt(image)?.type).filter((type): type is string => typeof type === "string"));
    if (!types.has("THUMBNAIL")) error(issues, "images", "THUMBNAIL 이미지가 최소 1개 필요합니다.");
    if (!types.has("DESCRIPTION") && !types.has("DESCRIPTION_HTML")) error(issues, "images", "DESCRIPTION 또는 DESCRIPTION_HTML 이미지가 필요합니다.");
  }
  const managementCode = textAt(value.managementCode);
  if (managementCode && managementCode.length > 100) error(issues, "managementCode", "토스쇼핑 상품 관리코드는 최대 100자입니다.");
  if (!managementCode) warn(issues, "managementCode", "Master SKU를 managementCode에 넣으면 상품 추적이 쉬워집니다.");
  warn(issues, "categoryId", "토스쇼핑 카테고리 제약사항은 수시 변경될 수 있으므로 등록 직전 최하위 카테고리 정책을 API로 다시 조회해야 합니다.");
}

function validateKakao(value: Record<string, unknown>, issues: RegistrationIssue[]) {
  requireText(value, "categoryId", "categoryId", issues, "카카오 최하위 카테고리 ID가 필요합니다.");
  const name = textAt(value.name);
  if (!name) error(issues, "name", "상품명을 입력해 주세요.");
  else {
    if (name.length > 70) error(issues, "name", "카카오 톡스토어 상품명은 최대 70자입니다.");
    if (!KAKAO_PRODUCT_NAME.test(name)) error(issues, "name", "카카오 톡스토어 상품명에 허용되지 않은 특수문자가 포함되어 있습니다.");
  }
  requireText(value, "productDetailDescription", "productDetailDescription", issues, "상품 상세설명이 필요합니다.");
  requireText(value, "taxType", "taxType", issues, "부가세 타입(taxType)이 필요합니다.");
  requirePositiveNumber(value, "salePrice", "salePrice", issues, "판매가는 10원 이상이어야 합니다.");
  const salePrice = Number(value.salePrice);
  if (Number.isFinite(salePrice)) {
    if (!Number.isInteger(salePrice) || salePrice < 10 || salePrice >= 100_000_000) error(issues, "salePrice", "카카오 판매가는 10원 이상 1억원 미만의 정수여야 합니다.");
    else if (salePrice % 10 !== 0) error(issues, "salePrice", "카카오 판매가는 10원 단위로 입력해야 합니다.");
  }
  if (typeof value.useSalePeriod !== "boolean") error(issues, "useSalePeriod", "판매기간 적용 여부(useSalePeriod)가 필요합니다.");
  requireText(value, "productCondition", "productCondition", issues, "상품 상태(productCondition)가 필요합니다.");
  if (typeof value.plusFriendSubscriberExclusive !== "boolean") error(issues, "plusFriendSubscriberExclusive", "톡채널 친구 전용 여부는 필수 Boolean 값입니다.");
  requireText(value, "displayStatus", "displayStatus", issues, "전시상태(displayStatus)가 필요합니다.");
  if (typeof value.shoppingHowDisplayable !== "boolean") error(issues, "shoppingHowDisplayable", "쇼핑하우 노출 여부는 필수 Boolean 값입니다.");
  requireObject(value, "productOriginAreaInfo", issues, "원산지 정보(productOriginAreaInfo)가 필요합니다.");
  requireObject(value, "productImage", issues, "상품 이미지 정보(productImage)가 필요합니다.");
  requireObject(value, "announcementInfo", issues, "상품정보고시(announcementInfo)가 필요합니다.");
  requireObject(value, "discount", issues, "즉시할인 정보(discount)가 필요합니다.");
  requireObject(value, "delivery", issues, "배송정보(delivery)가 필요합니다.");
  const option = requireObject(value, "option", issues, "옵션정보(option)가 필요합니다. 옵션이 없어도 type=NONE으로 전송해야 합니다.");

  for (const key of ["brand", "manufacturer"] as const) {
    const text = textAt(value[key]);
    if (text && text.length > 50) error(issues, key, `${key === "brand" ? "브랜드" : "제조사"}명은 최대 50자입니다.`);
  }
  const storeCode = textAt(value.storeManagementCode);
  if (storeCode && storeCode.length > 30) error(issues, "storeManagementCode", "카카오 판매자 상품 코드는 최대 30자입니다.");
  const gift = textAt(value.gift);
  if (gift && gift.length > 50) error(issues, "gift", "카카오 사은품 정보는 최대 50자입니다.");

  const optionType = option ? textAt(option.type)?.toUpperCase() : null;
  if (option && !optionType) error(issues, "option.type", "카카오 옵션 type은 필수입니다. 옵션이 없으면 NONE을 사용하세요.");
  const combinationManaged = optionType === "COMBINATION" || Boolean(option && Array.isArray(option.combinations) && option.combinations.length > 0);
  if (combinationManaged) {
    if (value.stockQuantity !== undefined) {
      error(issues, "stockQuantity", "카카오 조합형 옵션 상품은 본상품 stockQuantity를 보내면 오류가 납니다. 조합별 option.combinations[].stockQuantity만 입력하세요.");
    }
    const combinations = option && Array.isArray(option.combinations) ? option.combinations : [];
    if (combinations.length === 0) error(issues, "option.combinations", "조합형 옵션에는 combinations가 필수입니다.");
    if (!option || !Array.isArray(option.combinationAttributes) || option.combinationAttributes.length === 0) {
      error(issues, "option.combinationAttributes", "조합형 옵션에는 combinationAttributes가 필수입니다.");
    }
    let zeroPriceOption = false;
    combinations.forEach((combination, index) => {
      const row = objectAt(combination);
      if (!row) return error(issues, `option.combinations.${index}`, "조합 옵션은 객체 형식이어야 합니다.");
      requireNonNegativeNumber(row, "price", `option.combinations.${index}.price`, issues, "조합 옵션가는 0원 이상이어야 합니다.");
      const optionPrice = Number(row.price);
      if (optionPrice === 0) zeroPriceOption = true;
      requireNonNegativeInteger(row, "stockQuantity", `option.combinations.${index}.stockQuantity`, issues, "조합 옵션 재고는 0 이상의 정수여야 합니다.");
      if (Number(row.stockQuantity) > 9_999) error(issues, `option.combinations.${index}.stockQuantity`, "카카오 조합 옵션 재고는 최대 9,999개입니다.");
      if (typeof row.usable !== "boolean") error(issues, `option.combinations.${index}.usable`, "조합 옵션 usable 값은 필수 Boolean입니다.");
    });
    if (combinations.length > 0 && !zeroPriceOption) error(issues, "option.combinations", "카카오 조합형 옵션은 옵션가 0원인 조합이 최소 1개 있어야 합니다.");
  } else {
    requireNonNegativeInteger(value, "stockQuantity", "stockQuantity", issues, "조합형 옵션이 아닌 상품은 본상품 stockQuantity가 필수입니다.");
    if (Number(value.stockQuantity) >= 100_000_000) error(issues, "stockQuantity", "카카오 본상품 재고는 1억개 미만이어야 합니다.");
  }

  warn(issues, "categoryId", "카카오 톡스토어 카테고리는 개편될 수 있으므로 고정 ID를 장기 저장하지 말고 등록 직전 최신 최하위 카테고리를 조회하세요.");
  if (value.categorySupplements === undefined) warn(issues, "categorySupplements", "선택한 카테고리가 부가정보를 요구하는 경우 categorySupplements가 필수입니다. 최신 카테고리 정책을 확인하세요.");
}

function validateGmarket(value: Record<string, unknown>, issues: RegistrationIssue[]) {
  requireObject(value, "itemBasicInfo", issues, "G마켓 기본 상품정보가 필요합니다.");
  requireObject(value, "itemSiteInfo", issues, "G마켓 사이트 상품정보가 필요합니다.");
  if (value.isSell !== undefined) {
    error(issues, "isSell", "ESM 상품 신규 등록 요청에서는 isSell을 설정할 수 없습니다. 판매상태는 등록 완료 후 판매상태 변경 API로 관리하세요.");
  }
  warn(issues, "$", "G마켓은 ESM 카테고리/배송/옵션 정책에 따라 추가 필수값이 달라집니다. Product API 2.0의 최신 카테고리·옵션 정책으로 최종 검증해야 합니다.");
  warn(issues, "$", "G마켓 상품 등록 직후에는 약 3분간 판매상태·가격·재고 변경 API가 반영되지 않을 수 있습니다.");
}

function objectAt(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textAt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireObject(parent: Record<string, unknown>, key: string, issues: RegistrationIssue[], message: string) {
  const value = objectAt(parent[key]);
  if (!value) error(issues, key, message);
  return value;
}

function requireText(parent: Record<string, unknown>, key: string, path: string, issues: RegistrationIssue[], message: string) {
  if (!textAt(parent[key])) error(issues, path, message);
}

function requireValue(parent: Record<string, unknown>, key: string, path: string, issues: RegistrationIssue[], message: string) {
  const value = parent[key];
  if (value === undefined || value === null || value === "") error(issues, path, message);
}

function requirePositiveNumber(parent: Record<string, unknown>, key: string, path: string, issues: RegistrationIssue[], message: string) {
  const value = Number(parent[key]);
  if (!Number.isFinite(value) || value <= 0) error(issues, path, message);
}

function requirePositiveInteger(parent: Record<string, unknown>, key: string, path: string, issues: RegistrationIssue[], message: string) {
  const value = Number(parent[key]);
  if (!Number.isInteger(value) || value <= 0) error(issues, path, message);
}

function requireNonNegativeNumber(parent: Record<string, unknown>, key: string, path: string, issues: RegistrationIssue[], message: string) {
  const value = Number(parent[key]);
  if (!Number.isFinite(value) || value < 0) error(issues, path, message);
}

function requireNonNegativeInteger(parent: Record<string, unknown>, key: string, path: string, issues: RegistrationIssue[], message: string) {
  const value = Number(parent[key]);
  if (!Number.isInteger(value) || value < 0) error(issues, path, message);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString("ko-KR") : "0";
}

function formatSigned(value: number): string {
  const integer = Math.trunc(value);
  return `${integer > 0 ? "+" : ""}${integer.toLocaleString("ko-KR")}`;
}

function error(issues: RegistrationIssue[], path: string, message: string) {
  issues.push({ level: "error", path, message });
}

function warn(issues: RegistrationIssue[], path: string, message: string) {
  issues.push({ level: "warning", path, message });
}
