import {
  CheckCircle2,
  CircleAlert,
  Code2,
  Database,
  Image as ImageIcon,
  PackagePlus,
  Percent,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  WandSparkles
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ApiCatalogProduct,
  ApiMarketConnectionCheck,
  ApiMarketConnections,
  ApiMarketReference,
  ApiMarketReferenceKind,
  ApiProductRegistrationResult,
  ApiRegistrationValidation
} from "../api";
import { markets, type MarketId } from "../data";
import {
  discountedPrice,
  formatWon,
  keywordPolicy,
  naverDiscountRange,
  naverOptionPriceRange,
  suggestKeywords,
  validateKeyword,
  type DiscountUnit
} from "../productUploadRules";

type Props = {
  products: ApiCatalogProduct[];
  connections: ApiMarketConnections | null;
  productRegistrationEnabled: boolean;
  onLoadConnections: () => Promise<void>;
  onVerify: (market: MarketId) => Promise<ApiMarketConnectionCheck>;
  onReference: (
    market: MarketId,
    kind: ApiMarketReferenceKind,
    params?: { categoryId?: string; keyword?: string }
  ) => Promise<ApiMarketReference>;
  onValidate: (market: MarketId, payload: Record<string, unknown>) => Promise<ApiRegistrationValidation>;
  onRegister: (
    market: MarketId,
    masterSku: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ) => Promise<ApiProductRegistrationResult>;
};

type Basics = {
  name: string;
  categoryId: string;
  price: string;
  stock: string;
  detailContent: string;
  representativeImage: string;
  brand: string;
  taxType: "" | "TAX" | "FREE";
};

type OptionDraft = {
  id: string;
  name: string;
  priceDelta: string;
  stock: string;
};

const marketNotes: Record<MarketId, string> = {
  naver: "스마트스토어 상품등록 화면처럼 공통정보를 먼저 입력하고, 네이버 전용 할인·옵션 제한을 바로 확인합니다.",
  coupang: "WING 상품등록 흐름처럼 상품명·카테고리·검색어·옵션을 먼저 입력하고, 배송/고시는 참조데이터와 사전검증으로 채웁니다.",
  gmarket: "공통 상품정보를 먼저 작성한 뒤 ESM 전용 필수항목을 고급설정에서 보완합니다.",
  lotteon: "공통 상품정보를 먼저 작성합니다. 실제 등록은 검증된 공식 경로가 설정된 환경에서만 허용됩니다.",
  toss: "공통 상품정보를 먼저 작성한 뒤 배송그룹·교환반품지·고시·stocks를 사전검증으로 보완합니다.",
  kakao: "공통 상품정보를 먼저 작성한 뒤 리프 카테고리·주소록·고시·원산지를 사전검증으로 보완합니다."
};

const starterPayloads: Record<MarketId, string> = {
  naver: "{\n  \"originProduct\": {\n    \"statusType\": \"SALE\",\n    \"saleType\": \"NEW\",\n    \"leafCategoryId\": \"\",\n    \"name\": \"\",\n    \"detailContent\": \"\",\n    \"images\": {\n      \"representativeImage\": { \"url\": \"\" },\n      \"optionalImages\": []\n    },\n    \"salePrice\": 0,\n    \"stockQuantity\": 0\n  },\n  \"smartstoreChannelProduct\": {}\n}",
  coupang: "{\n  \"displayCategoryCode\": 0,\n  \"sellerProductName\": \"\",\n  \"displayProductName\": \"\",\n  \"saleStartedAt\": \"\",\n  \"saleEndedAt\": \"2099-12-31T23:59:59\",\n  \"searchTags\": [],\n  \"items\": []\n}",
  gmarket: "{\n  \"itemBasicInfo\": {},\n  \"itemSiteInfo\": {}\n}",
  lotteon: "{\n  \"product\": {}\n}",
  toss: "{\n  \"name\": \"\",\n  \"categoryId\": \"\",\n  \"stocks\": []\n}",
  kakao: "{\n  \"categoryId\": \"\",\n  \"name\": \"\"\n}"
};

const referenceLabels: Array<[ApiMarketReferenceKind, string]> = [
  ["categories", "카테고리"],
  ["shipping", "출고/배송지"],
  ["returns", "반품지"],
  ["notices", "고시"],
  ["categoryMeta", "카테고리 메타"]
];

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function newOption(stock = ""): OptionDraft {
  return { id: crypto.randomUUID(), name: "", priceDelta: "0", stock };
}

function intOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function ProductRegistration({
  products,
  connections,
  productRegistrationEnabled,
  onLoadConnections,
  onVerify,
  onReference,
  onValidate,
  onRegister
}: Props) {
  const first = products[0] ?? null;
  const [selected, setSelected] = useState<MarketId>("naver");
  const [masterSku, setMasterSku] = useState(first?.masterSku ?? "");
  const [payloadText, setPayloadText] = useState(starterPayloads.naver);
  const [basics, setBasics] = useState<Basics>({
    name: first?.name ?? "",
    categoryId: "",
    price: "",
    stock: "",
    detailContent: "",
    representativeImage: "",
    brand: "",
    taxType: ""
  });
  const [keywords, setKeywords] = useState<string[]>(() => suggestKeywords(first?.name ?? "", first?.aliases ?? [], 10));
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountUnit, setDiscountUnit] = useState<DiscountUnit>("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [optionGroupName, setOptionGroupName] = useState("");
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [verification, setVerification] = useState<ApiMarketConnectionCheck | null>(null);
  const [validation, setValidation] = useState<ApiRegistrationValidation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiProductRegistrationResult | null>(null);
  const [reference, setReference] = useState<ApiMarketReference | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceKind, setReferenceKind] = useState<ApiMarketReferenceKind>("categories");
  const [referenceKeyword, setReferenceKeyword] = useState(first?.name ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const market = useMemo(() => markets.find((item) => item.id === selected)!, [selected]);
  const selectedProduct = useMemo(() => products.find((item) => item.masterSku === masterSku) ?? null, [products, masterSku]);
  const credentialConfigured = Boolean(connections?.connections.find((item) => item.market === selected)?.configured);
  const delegatedConfigured = Boolean(connections?.delegatedLinks?.find((item) => item.market === selected)?.linked);
  const configured = selected === "naver" ? credentialConfigured || delegatedConfigured : credentialConfigured;
  const alreadyMapped = Boolean(selectedProduct?.marketProductIds[selected]);
  const salePrice = intOrNull(basics.price);
  const stock = intOrNull(basics.stock);
  const keywordRules = keywordPolicy(selected);
  const optionRange = naverOptionPriceRange(Number.isFinite(salePrice) ? salePrice ?? 0 : 0);
  const discountRange = naverDiscountRange(Number.isFinite(salePrice) ? salePrice ?? 0 : 0, discountUnit);
  const discountNumber = intOrNull(discountValue);
  const expectedPrice = discountedPrice(salePrice ?? 0, discountUnit, Number.isFinite(discountNumber) ? discountNumber ?? 0 : 0);
  const suggestedKeywords = useMemo(
    () => suggestKeywords(basics.name, selectedProduct?.aliases ?? [], keywordRules.recommendedMax).filter((item) => !keywords.some((saved) => saved.toLowerCase() === item.toLowerCase())),
    [basics.name, selectedProduct, keywordRules.recommendedMax, keywords]
  );

  const resetRequestIdentity = () => setIdempotencyKey(newIdempotencyKey());
  const invalidatePayload = () => {
    setValidation(null);
    setConfirmed(false);
    setResult(null);
    resetRequestIdentity();
  };

  const changeBasic = <K extends keyof Basics>(key: K, value: Basics[K]) => {
    setBasics((current) => ({ ...current, [key]: value }));
    invalidatePayload();
  };

  const selectMarket = (next: MarketId) => {
    setSelected(next);
    setPayloadText(starterPayloads[next]);
    setVerification(null);
    setValidation(null);
    setConfirmed(false);
    setError(null);
    setResult(null);
    setReference(null);
    setReferenceKind("categories");
    setKeywordError(null);
    resetRequestIdentity();
  };

  const selectProduct = (sku: string) => {
    setMasterSku(sku);
    const product = products.find((item) => item.masterSku === sku);
    setBasics((current) => ({ ...current, name: product?.name ?? "" }));
    setReferenceKeyword(product?.name ?? "");
    setKeywords(suggestKeywords(product?.name ?? "", product?.aliases ?? [], keywordPolicy(selected).recommendedMax));
    setValidation(null);
    setConfirmed(false);
    setResult(null);
    setError(null);
    resetRequestIdentity();
  };

  const parsePayload = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(payloadText) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      const payload = parsed as Record<string, unknown>;
      if (Object.keys(payload).length === 0) throw new Error();
      return payload;
    } catch {
      setError("고급 요청 데이터 형식이 올바르지 않습니다. [고급 설정]의 JSON을 확인해 주세요.");
      return null;
    }
  };

  const verify = async () => {
    if (!configured) {
      setError(selected === "naver" ? "먼저 네이버 커머스솔루션 또는 운영자 테스트 연동을 완료해 주세요." : "먼저 마켓 연동 메뉴에서 API 정보를 저장해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setVerification(await onVerify(selected));
    } catch (cause) {
      setVerification(null);
      setError(cause instanceof Error ? cause.message : "연결 확인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    const payload = parsePayload();
    if (!payload) return;
    setBusy(true);
    setError(null);
    setValidation(null);
    try {
      setValidation(await onValidate(selected, payload));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "등록 전 검증에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const loadReference = async (kind: ApiMarketReferenceKind) => {
    if (!configured) {
      setError("먼저 마켓 연동을 완료해 주세요.");
      return;
    }
    setReferenceBusy(true);
    setError(null);
    setReferenceKind(kind);
    try {
      setReference(await onReference(selected, kind, {
        ...(basics.categoryId ? { categoryId: basics.categoryId } : {}),
        ...(referenceKeyword ? { keyword: referenceKeyword } : {})
      }));
    } catch (cause) {
      setReference(null);
      setError(cause instanceof Error ? cause.message : "참조데이터를 불러오지 못했습니다.");
    } finally {
      setReferenceBusy(false);
    }
  };

  const addKeyword = (raw: string) => {
    const value = raw.trim();
    const keywordProblem = validateKeyword(selected, value);
    if (keywordProblem) return setKeywordError(keywordProblem);
    if (keywords.some((item) => item.toLowerCase() === value.toLowerCase())) return setKeywordError("이미 추가한 검색어입니다.");
    if (keywordRules.hardMax !== null && keywords.length >= keywordRules.hardMax) return setKeywordError(`이 마켓은 검색어를 최대 ${keywordRules.hardMax}개까지 입력할 수 있습니다.`);
    setKeywords((current) => [...current, value]);
    setKeywordInput("");
    setKeywordError(null);
    invalidatePayload();
  };

  const fillSuggestedKeywords = () => {
    const next = [...keywords];
    for (const suggestion of suggestKeywords(basics.name, selectedProduct?.aliases ?? [], keywordRules.recommendedMax)) {
      if (validateKeyword(selected, suggestion)) continue;
      if (next.some((item) => item.toLowerCase() === suggestion.toLowerCase())) continue;
      if (keywordRules.hardMax !== null && next.length >= keywordRules.hardMax) break;
      next.push(suggestion);
    }
    setKeywords(next);
    setKeywordError(null);
    invalidatePayload();
  };

  const removeKeyword = (keyword: string) => {
    setKeywords((current) => current.filter((item) => item !== keyword));
    invalidatePayload();
  };

  const addOption = () => {
    setOptions((current) => [...current, newOption(basics.stock)]);
    invalidatePayload();
  };

  const updateOption = (id: string, patch: Partial<OptionDraft>) => {
    setOptions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    invalidatePayload();
  };

  const removeOption = (id: string) => {
    setOptions((current) => current.filter((item) => item.id !== id));
    invalidatePayload();
  };

  const checkGuidedForm = (): boolean => {
    if (salePrice !== null && (!Number.isInteger(salePrice) || salePrice < 0)) {
      setError("판매가는 0 이상의 정수로 입력해 주세요.");
      return false;
    }
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      setError("재고는 0 이상의 정수로 입력해 주세요.");
      return false;
    }
    if (selected === "naver" && salePrice !== null && salePrice > 999_999_990) {
      setError("네이버 판매가는 최대 999,999,990원입니다.");
      return false;
    }
    if (selected === "naver" && discountEnabled) {
      if (!salePrice || salePrice <= 0) {
        setError("할인을 설정하려면 먼저 판매가를 입력해 주세요.");
        return false;
      }
      if (discountNumber === null || !Number.isInteger(discountNumber) || discountNumber < discountRange.min || discountNumber > discountRange.max) {
        setError(`네이버 할인값은 ${discountRange.min.toLocaleString("ko-KR")} ~ ${discountRange.max.toLocaleString("ko-KR")} 범위로 입력해 주세요.`);
        return false;
      }
    }
    if ((selected === "naver" || selected === "coupang") && options.length > 0) {
      if (!optionGroupName.trim()) {
        setError("옵션을 사용하는 경우 옵션명(예: 색상, 용량, 중량)을 입력해 주세요.");
        return false;
      }
      for (const [index, option] of options.entries()) {
        if (!option.name.trim()) {
          setError(`${index + 1}번째 옵션값을 입력해 주세요.`);
          return false;
        }
        const delta = intOrNull(option.priceDelta);
        const optionStock = intOrNull(option.stock);
        if (delta === null || !Number.isInteger(delta)) {
          setError(`${option.name || index + 1} 옵션의 옵션가는 정수로 입력해 주세요.`);
          return false;
        }
        if (optionStock !== null && (!Number.isInteger(optionStock) || optionStock < 0)) {
          setError(`${option.name || index + 1} 옵션의 재고는 0 이상의 정수로 입력해 주세요.`);
          return false;
        }
        if (selected === "naver" && (delta < optionRange.min || delta > optionRange.max)) {
          setError(`${option.name || index + 1} 옵션가는 ${formatWon(optionRange.min)} ~ ${formatWon(optionRange.max)} 범위여야 합니다.`);
          return false;
        }
      }
      if (selected === "naver" && !options.some((item) => intOrNull(item.priceDelta) === 0)) {
        setError("네이버 옵션에는 추가금 0원인 옵션이 최소 1개 있어야 합니다.");
        return false;
      }
    }
    for (const keyword of keywords) {
      const problem = validateKeyword(selected, keyword);
      if (problem) {
        setError(`검색어 '${keyword}': ${problem}`);
        return false;
      }
    }
    return true;
  };

  const applyGuidedForm = () => {
    let payload = parsePayload();
    if (!payload || !checkGuidedForm()) return;

    if (selected === "naver") {
      const origin = objectValue(payload.originProduct);
      const images = objectValue(origin.images);
      const sellerCodeInfo = objectValue(origin.sellerCodeInfo);
      const seoInfo = objectValue(origin.seoInfo);
      const customerBenefit = objectValue(origin.customerBenefit);
      const immediateDiscountPolicy = objectValue(customerBenefit.immediateDiscountPolicy);
      const optionInfo = objectValue(origin.optionInfo);
      const nextOrigin: Record<string, unknown> = {
        ...origin,
        ...(basics.categoryId ? { leafCategoryId: basics.categoryId } : {}),
        ...(basics.name ? { name: basics.name } : {}),
        ...(basics.detailContent ? { detailContent: basics.detailContent } : {}),
        ...(salePrice !== null ? { salePrice } : {}),
        ...(stock !== null ? { stockQuantity: stock } : {}),
        ...(basics.representativeImage ? {
          images: {
            ...images,
            representativeImage: {
              ...objectValue(images.representativeImage),
              url: basics.representativeImage.trim()
            }
          }
        } : {}),
        sellerCodeInfo: {
          ...sellerCodeInfo,
          ...(masterSku ? { sellerManagementCode: masterSku } : {})
        },
        seoInfo: {
          ...seoInfo,
          sellerTags: keywords.map((text) => ({ code: 0, text }))
        }
      };

      if (discountEnabled && discountNumber !== null) {
        nextOrigin.customerBenefit = {
          ...customerBenefit,
          immediateDiscountPolicy: {
            ...immediateDiscountPolicy,
            discountMethod: { value: discountNumber, unitType: discountUnit }
          }
        };
      }
      if (options.length > 0) {
        nextOrigin.optionInfo = {
          ...optionInfo,
          optionCombinationGroupNames: {
            ...objectValue(optionInfo.optionCombinationGroupNames),
            optionGroupName1: optionGroupName.trim()
          },
          optionCombinations: options.map((option, index) => ({
            optionName1: option.name.trim(),
            price: intOrNull(option.priceDelta) ?? 0,
            stockQuantity: intOrNull(option.stock) ?? stock ?? 0,
            usable: true,
            sellerManagerCode: `${masterSku || "SKU"}-${index + 1}`
          })),
          useStockManagement: true
        };
      }
      payload.originProduct = nextOrigin;
    } else if (selected === "coupang") {
      const existingItems = Array.isArray(payload.items) ? payload.items : [];
      payload = {
        ...payload,
        ...(basics.categoryId ? { displayCategoryCode: Number(basics.categoryId) || basics.categoryId } : {}),
        ...(basics.name ? { sellerProductName: basics.name, displayProductName: basics.name, generalProductName: basics.name } : {}),
        ...(basics.brand ? { brand: basics.brand.trim() } : {}),
        searchTags: keywords.slice(0, 20)
      };
      if (options.length > 0) {
        payload.items = options.map((option, index) => {
          const current = objectValue(existingItems[index]);
          const delta = intOrNull(option.priceDelta) ?? 0;
          return {
            ...current,
            itemName: option.name.trim(),
            ...(salePrice !== null ? { salePrice: Math.max(1, salePrice + delta) } : {}),
            maximumBuyCount: intOrNull(option.stock) ?? stock ?? 0,
            maximumBuyForPerson: current.maximumBuyForPerson ?? 0,
            maximumBuyForPersonPeriod: current.maximumBuyForPersonPeriod ?? 1,
            outboundShippingTimeDay: current.outboundShippingTimeDay ?? 1,
            unitCount: current.unitCount ?? 1,
            adultOnly: current.adultOnly ?? "EVERYONE",
            ...(basics.taxType ? { taxType: basics.taxType } : {}),
            parallelImported: current.parallelImported ?? "NOT_PARALLEL_IMPORTED",
            overseasPurchased: current.overseasPurchased ?? "NOT_OVERSEAS_PURCHASED",
            ...(optionGroupName.trim() ? { attributes: [{ attributeTypeName: optionGroupName.trim(), attributeValueName: option.name.trim() }] } : {}),
            ...(basics.representativeImage ? { images: [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: basics.representativeImage.trim() }] } : {}),
            ...(basics.detailContent ? { contentDetails: [{ detailType: "TEXT", content: basics.detailContent }] } : {})
          };
        });
      }
    } else if (selected === "toss") {
      payload = {
        ...payload,
        ...(basics.name ? { name: basics.name } : {}),
        ...(basics.categoryId ? { categoryId: Number(basics.categoryId) || basics.categoryId } : {}),
        ...(masterSku ? { managementCode: masterSku } : {})
      };
    } else if (selected === "kakao") {
      payload = {
        ...payload,
        ...(basics.name ? { name: basics.name } : {}),
        ...(basics.categoryId ? { categoryId: basics.categoryId } : {}),
        ...(basics.detailContent ? { productDetailDescription: basics.detailContent } : {}),
        ...(salePrice !== null ? { salePrice } : {}),
        ...(stock !== null ? { stockQuantity: stock } : {}),
        ...(masterSku ? { storeManagedCode: masterSku } : {})
      };
    }

    setPayloadText(JSON.stringify(payload, null, 2));
    setError(null);
    setValidation(null);
    setConfirmed(false);
    setResult(null);
    resetRequestIdentity();
  };

  const register = async () => {
    if (!masterSku || !selectedProduct) return setError("먼저 SellerHub Master SKU를 선택해 주세요.");
    if (alreadyMapped) return setError(`${selectedProduct.name}은(는) 이미 ${market.name} 상품번호가 연결되어 있습니다.`);
    if (!verification?.ok) return setError("상품 등록 전에 API 연결 확인을 완료해 주세요.");
    if (!verification.registrationSupported) return setError("현재 이 마켓은 상품 등록 호출이 아직 활성화되지 않았습니다.");
    if (!validation?.ok) return setError("먼저 [등록 전 검증]을 통과해 주세요.");
    if (!confirmed) return setError("실제 마켓에 상품이 생성된다는 확인란을 체크해 주세요.");
    const payload = parsePayload();
    if (!payload) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const next = await onRegister(selected, masterSku, idempotencyKey, payload);
      setResult(next);
      if (next.ok) setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const marketSaved = (marketId: MarketId) => {
    const savedCredential = Boolean(connections?.connections.find((item) => item.market === marketId)?.configured);
    const savedDelegation = Boolean(connections?.delegatedLinks?.find((item) => item.market === marketId)?.linked);
    return marketId === "naver" ? savedCredential || savedDelegation : savedCredential;
  };

  return (
    <main className="manager-page registration-page seller-upload-page">
      <div className="manager-header upload-page-header">
        <div>
          <h1>상품 등록</h1>
          <p>네이버·쿠팡 판매자센터처럼 위에서 아래로 입력하면 SellerHub가 마켓별 요청 형식과 제한값을 맞춥니다.</p>
        </div>
        <button type="button" className="secondary-action" onClick={() => void onLoadConnections()}><PlugZap size={15} /> 연동 새로고침</button>
      </div>

      {!productRegistrationEnabled ? (
        <section className="registration-guard">
          <ShieldCheck size={19} />
          <div><strong>실제 상품 생성은 안전 잠금 상태입니다.</strong><p>폼 작성·마켓 데이터 조회·등록 전 검증은 모두 사용할 수 있습니다. 운영 스위치를 켜기 전에는 실제 상품이 생성되지 않습니다.</p></div>
        </section>
      ) : null}

      <div className="seller-upload-market-tabs" role="tablist" aria-label="등록 마켓 선택">
        {markets.map((item) => {
          const saved = marketSaved(item.id);
          return (
            <button key={item.id} type="button" role="tab" aria-selected={selected === item.id} className={selected === item.id ? "seller-upload-market-tab active" : "seller-upload-market-tab"} onClick={() => selectMarket(item.id)}>
              <span className={`connection-market-icon connection-${item.id}`}>{item.short}</span>
              <span><strong>{item.name}</strong><small>{saved ? item.id === "naver" && delegatedConfigured ? "위임연동 완료" : "연동 완료" : "미연동"}</small></span>
              {saved ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
            </button>
          );
        })}
      </div>

      <div className="seller-upload-layout">
        <div className="seller-upload-main">
          <section className="surface upload-market-summary">
            <div className="registration-title-row">
              <div><span className={`connection-market-icon connection-${selected}`}>{market.short}</span><div><h2>{market.name} 상품 등록</h2><p>{marketNotes[selected]}</p></div></div>
              <button type="button" className="secondary-action" disabled={busy || !configured} onClick={() => void verify()}><PlugZap size={15} /> {verification?.ok ? "연결 다시 확인" : "API 연결 확인"}</button>
            </div>
            {!configured ? <div className="connection-test-result fail"><CircleAlert size={17} /><div><strong>마켓 연동이 필요합니다.</strong><p>{selected === "naver" ? "네이버는 일반 이용자가 API 키를 입력하지 않고 커머스솔루션 위임연동을 사용합니다." : "[마켓 연동]에서 판매자 API 정보를 저장한 뒤 돌아오세요."}</p></div></div> : null}
            {verification ? <div className={verification.ok ? "connection-test-result ok" : "connection-test-result fail"}>{verification.ok ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}<div><strong>{verification.ok ? "판매자 계정 연결 정상" : "연결 실패"}</strong><p>{verification.message}</p></div></div> : null}
          </section>

          <UploadSection number="1" title="기본 정보" description="기준 상품과 마켓에 노출될 상품명을 입력합니다.">
            <div className="seller-form-rows">
              <label className="seller-form-row"><span className="seller-form-label">Master SKU <b>*</b></span><div className="seller-form-control"><select value={masterSku} onChange={(event) => selectProduct(event.target.value)}><option value="">상품 선택</option>{products.map((item) => <option key={item.masterSku} value={item.masterSku}>{item.name} · {item.masterSku}</option>)}</select><small>SellerHub에서 상품을 식별하는 기준 코드입니다.</small></div></label>
              <label className="seller-form-row"><span className="seller-form-label">상품명 <b>*</b></span><div className="seller-form-control"><input value={basics.name} maxLength={selected === "coupang" ? 100 : undefined} onChange={(event) => changeBasic("name", event.target.value)} placeholder="예: 홍옥 사과 5kg 선물세트" /><small>{selected === "coupang" ? `${basics.name.length}/100자 · 쿠팡 등록상품명 최대 100자` : "검색어와 카테고리 추천의 기준이 됩니다."}</small></div></label>
              <label className="seller-form-row"><span className="seller-form-label">카테고리 <b>*</b></span><div className="seller-form-control inline-control"><input value={basics.categoryId} onChange={(event) => changeBasic("categoryId", event.target.value)} placeholder={selected === "coupang" ? "displayCategoryCode" : "카테고리 ID"} /><button type="button" className="form-inline-button" disabled={!configured || referenceBusy} onClick={() => void loadReference("categories")}><Search size={14} /> 카테고리 찾기</button><small>상품명으로 후보를 확인한 후 최하위 카테고리를 선택하는 방식으로 고도화합니다.</small></div></label>
              {selected === "coupang" ? <label className="seller-form-row"><span className="seller-form-label">브랜드</span><div className="seller-form-control"><input value={basics.brand} onChange={(event) => changeBasic("brand", event.target.value)} placeholder="공식 브랜드명" /><small>브랜드 상품은 쿠팡 표준 brandId 검증이 추가로 필요합니다.</small></div></label> : null}
            </div>
          </UploadSection>

          <UploadSection number="2" title="판매가 · 할인 · 재고" description="마켓의 허용 범위를 입력 중 바로 계산합니다.">
            <div className="seller-form-rows">
              <label className="seller-form-row"><span className="seller-form-label">판매가 <b>*</b></span><div className="seller-form-control money-control"><div><input inputMode="numeric" value={basics.price} onChange={(event) => changeBasic("price", event.target.value.replace(/[^0-9]/g, ""))} placeholder="39900" /><span>원</span></div>{selected === "naver" ? <small>네이버 최대 판매가 999,999,990원</small> : <small>할인 전 기준 판매가를 입력하세요.</small>}</div></label>
              <label className="seller-form-row"><span className="seller-form-label">재고 <b>*</b></span><div className="seller-form-control money-control"><div><input inputMode="numeric" value={basics.stock} onChange={(event) => changeBasic("stock", event.target.value.replace(/[^0-9]/g, ""))} placeholder="50" /><span>개</span></div><small>옵션을 사용하면 옵션별 재고를 우선 적용합니다.</small></div></label>
              {selected === "naver" ? (
                <div className="seller-form-row seller-discount-row"><span className="seller-form-label">즉시 할인</span><div className="seller-form-control"><div className="discount-switch-line"><label className="toggle-control"><input type="checkbox" checked={discountEnabled} onChange={(event) => { setDiscountEnabled(event.target.checked); invalidatePayload(); }} /><span>할인 설정</span></label>{discountEnabled ? <strong className="expected-price">예상 할인가 {formatWon(expectedPrice)}</strong> : null}</div>{discountEnabled ? <div className="discount-input-line"><select value={discountUnit} onChange={(event) => { setDiscountUnit(event.target.value as DiscountUnit); invalidatePayload(); }}><option value="PERCENT">정률 (%)</option><option value="WON">정액 (원)</option></select><input inputMode="numeric" value={discountValue} onChange={(event) => { setDiscountValue(event.target.value.replace(/[^0-9]/g, "")); invalidatePayload(); }} placeholder={`${discountRange.min} ~ ${discountRange.max}`} /><span>{discountUnit === "PERCENT" ? "%" : "원"}</span></div> : null}<small>{discountEnabled ? discountRange.description : "판매가 입력 후 정률/정액 즉시할인을 설정할 수 있습니다."}</small></div></div>
              ) : null}
              {selected === "coupang" ? <label className="seller-form-row"><span className="seller-form-label">과세 여부</span><div className="seller-form-control"><select value={basics.taxType} onChange={(event) => changeBasic("taxType", event.target.value as Basics["taxType"])}><option value="">선택</option><option value="TAX">과세</option><option value="FREE">면세</option></select><small>상품 유형에 따라 정확히 선택해야 하며 SellerHub가 임의 추정하지 않습니다.</small></div></label> : null}
            </div>
          </UploadSection>

          {(selected === "naver" || selected === "coupang") ? (
            <UploadSection number="3" title="옵션" description="색상·용량·중량처럼 구매자가 선택할 옵션을 등록합니다.">
              <div className="option-toolbar"><label><span>옵션명</span><input value={optionGroupName} onChange={(event) => { setOptionGroupName(event.target.value); invalidatePayload(); }} placeholder="예: 중량" /></label><button type="button" className="secondary-action" onClick={addOption}><Plus size={14} /> 옵션 추가</button></div>
              {selected === "naver" ? <div className="option-range-guide"><strong>현재 허용 옵션가: {formatWon(optionRange.min)} ~ {formatWon(optionRange.max)}</strong><span>{optionRange.description} · 추가금 0원 옵션이 최소 1개 필요합니다.</span></div> : <div className="option-range-guide"><strong>쿠팡 옵션은 카테고리 메타 기준 속성명이 중요합니다.</strong><span>옵션명/값을 기본 attributes로 반영하고, 등록 전 메타검증에서 필수 속성을 추가 확인합니다.</span></div>}
              <div className="seller-option-table">
                <div className="seller-option-head"><span>옵션값</span><span>옵션가</span><span>재고</span><span /></div>
                {options.length === 0 ? <div className="seller-option-empty">옵션이 없는 단일상품이면 비워두세요. 옵션이 있으면 [옵션 추가]를 누릅니다.</div> : null}
                {options.map((option) => {
                  const delta = intOrNull(option.priceDelta);
                  const invalidNaver = selected === "naver" && delta !== null && (delta < optionRange.min || delta > optionRange.max);
                  return <div className={invalidNaver ? "seller-option-row invalid" : "seller-option-row"} key={option.id}><input value={option.name} onChange={(event) => updateOption(option.id, { name: event.target.value })} placeholder="예: 5kg" /><div className="compact-money"><input inputMode="numeric" value={option.priceDelta} onChange={(event) => updateOption(option.id, { priceDelta: event.target.value.replace(/[^0-9-]/g, "") })} /><span>원</span></div><input inputMode="numeric" value={option.stock} onChange={(event) => updateOption(option.id, { stock: event.target.value.replace(/[^0-9]/g, "") })} placeholder={basics.stock || "0"} /><button type="button" className="row-icon-button" onClick={() => removeOption(option.id)} aria-label="옵션 삭제"><Trash2 size={14} /></button></div>;
                })}
              </div>
            </UploadSection>
          ) : null}

          <UploadSection number={selected === "naver" || selected === "coupang" ? "4" : "3"} title="검색 설정" description="상품명과 별칭에서 연관검색어를 추천하고 마켓 제한을 자동 확인합니다.">
            <div className="keyword-recommendation-head"><div><Tag size={16} /><strong>사이트용 검색어</strong><span>{keywordRules.note}</span></div><button type="button" className="secondary-action" onClick={fillSuggestedKeywords}><WandSparkles size={14} /> 자동 추천 채우기</button></div>
            <div className="keyword-input-line"><input value={keywordInput} onChange={(event) => { setKeywordInput(event.target.value); setKeywordError(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addKeyword(keywordInput); } }} placeholder="검색어 입력 후 Enter" /><button type="button" className="form-inline-button" onClick={() => addKeyword(keywordInput)}>추가</button></div>
            {keywordError ? <p className="field-error">{keywordError}</p> : null}
            <div className="keyword-chip-list">{keywords.map((keyword) => <button type="button" key={keyword} className="keyword-chip" onClick={() => removeKeyword(keyword)} title="클릭해서 삭제"><span>{keyword}</span><b>×</b></button>)}</div>
            {suggestedKeywords.length ? <div className="suggested-keywords"><span>추천</span>{suggestedKeywords.slice(0, 8).map((keyword) => <button type="button" key={keyword} onClick={() => addKeyword(keyword)}>+ {keyword}</button>)}</div> : null}
          </UploadSection>

          <UploadSection number={selected === "naver" || selected === "coupang" ? "5" : "4"} title="이미지 · 상세설명" description="대표이미지와 상세 콘텐츠를 한 곳에서 관리합니다.">
            <div className="seller-form-rows">
              <label className="seller-form-row"><span className="seller-form-label"><ImageIcon size={15} /> 대표이미지 URL</span><div className="seller-form-control"><input value={basics.representativeImage} onChange={(event) => changeBasic("representativeImage", event.target.value)} placeholder="https://..." /><small>{selected === "naver" ? "네이버는 상품 이미지 업로드 API가 반환한 URL을 사용해야 합니다." : selected === "coupang" ? "쿠팡은 대표이미지 1:1, 최소 500×500px 기준을 확인하세요." : "마켓 정책에 맞는 HTTPS 이미지 주소를 입력하세요."}</small></div></label>
              <label className="seller-form-row seller-detail-row"><span className="seller-form-label">상세 설명</span><div className="seller-form-control"><textarea value={basics.detailContent} onChange={(event) => changeBasic("detailContent", event.target.value)} placeholder="상품 상세설명 또는 지원되는 HTML을 입력하세요." /><small>추후 이미지 업로드/상세페이지 가져오기 기능과 연결할 영역입니다.</small></div></label>
            </div>
          </UploadSection>

          <UploadSection number={selected === "naver" || selected === "coupang" ? "6" : "5"} title="배송 · 반품 · 고시" description="판매자 계정에 이미 등록된 값을 조회해 반복 입력을 줄입니다.">
            <div className="reference-toolbar seller-reference-toolbar"><div><Database size={16} /><strong>마켓 등록정보 불러오기</strong><span>상품명 또는 카테고리 기준으로 필요한 값을 조회합니다.</span></div><input value={referenceKeyword} onChange={(event) => setReferenceKeyword(event.target.value)} placeholder="검색어" /></div>
            <div className="reference-buttons">{referenceLabels.map(([kind, label]) => <button key={kind} type="button" className={referenceKind === kind ? "reference-button active" : "reference-button"} disabled={referenceBusy || !configured} onClick={() => void loadReference(kind)}>{referenceBusy && referenceKind === kind ? "조회 중" : label}</button>)}</div>
            {reference ? <details className="advanced-registration reference-result"><summary>{market.name} {referenceLabels.find(([kind]) => kind === reference.kind)?.[1] ?? reference.kind} 조회 결과</summary><pre className="reference-json">{JSON.stringify(reference.data, null, 2)}</pre></details> : null}
          </UploadSection>

          <section className="surface guided-apply-panel">
            <div><WandSparkles size={18} /><span><strong>입력 완료 후 한 번만 반영</strong><small>위 입력값을 {market.name} 공식 요청 구조로 변환합니다. 고급 JSON은 필요한 항목만 추가 수정하면 됩니다.</small></span></div>
            <button type="button" className="primary-action" onClick={applyGuidedForm}><WandSparkles size={15} /> 입력값을 등록요청에 반영</button>
          </section>

          <details className="surface advanced-registration advanced-json-panel">
            <summary><Code2 size={16} /> 고급 설정 · {market.name} Request JSON</summary>
            <p className="advanced-registration-note">배송/고시/인증처럼 아직 공통폼에서 표현하지 못한 마켓 전용값만 확인하면 됩니다. JSON을 몰라도 위 폼에서 대부분의 공통값을 채울 수 있습니다.</p>
            <div className="json-editor-heading"><div><Code2 size={16} /><strong>실제 등록 요청</strong></div><button type="button" onClick={() => { setPayloadText(starterPayloads[selected]); invalidatePayload(); }}>초기화</button></div>
            <textarea className="registration-json" spellCheck={false} value={payloadText} onChange={(event) => { setPayloadText(event.target.value); setError(null); invalidatePayload(); }} aria-label={`${market.name} 상품 등록 요청 JSON`} />
          </details>

          <section className="surface preflight-panel">
            <div className="preflight-row"><div><ShieldCheck size={15} /><span><strong>등록 전 검증</strong> · 실제 전송 전에 필수값과 마켓 제약을 검사합니다.</span></div><button type="button" className="secondary-action" disabled={busy || !configured} onClick={() => void validate()}>{busy ? "검증 중..." : "등록 전 검증"}</button></div>
            {validation ? <div className={validation.ok ? "preflight-result ok" : "preflight-result fail"}><strong>{validation.ok ? "사전검증 통과 · 등록 준비 완료" : `사전검증 실패 · ${validation.errors.length}개 수정 필요`}</strong>{validation.errors.map((issue) => <p key={`e-${issue.path}-${issue.message}`}><b>{issue.path}</b>{issue.message}</p>)}{validation.warnings.map((issue) => <p className="warning" key={`w-${issue.path}-${issue.message}`}><b>{issue.path}</b>{issue.message}</p>)}</div> : null}
            <details className="request-identity"><summary><RefreshCw size={14} /> 중복등록 방지</summary><code>{idempotencyKey}</code></details>
            <div className="registration-confirm"><input id="actual-create-confirm" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!validation?.ok || !productRegistrationEnabled} /><label htmlFor="actual-create-confirm"><strong>실제 상품 생성 확인</strong><span>사전검증을 통과한 요청만 {market.name}에 전송합니다. 성공한 상품번호는 Master SKU에 자동 연결됩니다.</span></label></div>
            {error ? <p className="manager-error" role="alert">{error}</p> : null}
            {result ? <div className={result.ok ? "registration-result ok" : "registration-result fail"} role="status">{result.ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<div><strong>{result.ok ? "상품 등록 요청 성공" : "상품 등록 실패"}</strong><p>{result.message}</p>{result.externalId ? <code>외부 상품번호: {result.externalId}</code> : null}{result.controlExternalId ? <code>제어 ID: {result.controlExternalId}</code> : null}</div></div> : null}
          </section>
        </div>

        <aside className="seller-upload-side surface">
          <h3>등록 준비상태</h3>
          <ProgressRow done={Boolean(masterSku)} label="기준 상품 선택" />
          <ProgressRow done={configured} label="마켓 연동" />
          <ProgressRow done={Boolean(verification?.ok)} label="API 연결 확인" />
          <ProgressRow done={Boolean(validation?.ok)} label="등록 전 검증" />
          <ProgressRow done={Boolean(result?.ok)} label="마켓 등록 완료" />
          <div className="upload-side-divider" />
          <strong className="side-market-name">{market.name}</strong>
          <p>{alreadyMapped ? `이미 상품번호 ${selectedProduct?.marketProductIds[selected]}가 연결되어 있습니다.` : "아직 이 Master SKU에 마켓 상품번호가 연결되지 않았습니다."}</p>
          <div className="side-keyword-count"><Tag size={14} /><span>검색어 {keywords.length}개</span></div>
          {selected === "naver" && salePrice ? <div className="side-price-preview"><Percent size={14} /><span>판매가 {formatWon(salePrice)}{discountEnabled ? ` → ${formatWon(expectedPrice)}` : ""}</span></div> : null}
        </aside>
      </div>

      <div className="seller-upload-sticky-bar">
        <div><strong>{market.name}</strong><span>{validation?.ok ? "검증 완료" : "등록 전 검증 필요"}</span></div>
        <button type="button" className="secondary-action" onClick={applyGuidedForm}><WandSparkles size={15} /> 입력값 반영</button>
        <button type="button" className="secondary-action" disabled={busy || !configured} onClick={() => void validate()}><ShieldCheck size={15} /> 사전검증</button>
        <button type="button" className="primary-action" disabled={busy || alreadyMapped || !masterSku || !configured || !productRegistrationEnabled || !verification?.ok || !verification.registrationSupported || !validation?.ok || !confirmed} onClick={() => void register()}><PackagePlus size={16} /> {busy ? "처리 중..." : `${market.name}에 등록`}</button>
      </div>
    </main>
  );
}

function UploadSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="surface seller-upload-section"><header><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></header><div className="seller-upload-section-body">{children}</div></section>;
}

function ProgressRow({ done, label }: { done: boolean; label: string }) {
  return <div className={done ? "upload-progress-row done" : "upload-progress-row"}>{done ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}<span>{label}</span></div>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
