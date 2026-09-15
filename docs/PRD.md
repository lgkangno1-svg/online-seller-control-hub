# Online Seller Control Hub PRD

**Version:** 1.0  
**Date:** 2026-09-10  
**User:** 1인 개인사업자 온라인 셀러  
**Channels:** 네이버 스마트스토어, 쿠팡, G마켓, 롯데ON, 토스쇼핑, 카카오 톡스토어/톡딜

## 1. Product goal

상품을 중앙에서 한 번만 관리하고, 각 오픈마켓의 상품번호를 Master SKU에 연결하여 상품등록·수정·가격·재고·품절·판매중지·주문·송장·취소·반품을 통합 제어한다.

최종 UX는 Telegram 자연어 명령이다.

예:

- `홍옥 5kg 전 마켓 품절시켜줘`
- `쿠팡 빼고 홍옥 5kg 재고 20개로 바꿔줘`
- `애플망고 3.6kg 전체 39900원으로 바꿔줘`
- `토스에서만 머스크멜론 판매중지해줘`

모든 쓰기 명령은 즉시 실행하지 않는다. 상품·대상 마켓·현재 값·변경 값을 Telegram으로 다시 보여주고 사용자가 **[실행]** 버튼을 눌렀을 때만 실제 API를 호출한다.

## 2. Core principles

1. 상품의 기준 식별자는 `masterSku`다.
2. 각 마켓의 외부 상품 ID/옵션 ID를 Master SKU에 매핑한다.
3. AI/Codex는 자연어를 제한된 구조화 명령으로 바꾸는 역할만 한다.
4. Codex가 마켓 API Key, 임의 SQL, 임의 shell, 임의 HTTP 호출을 수행하지 못하게 한다.
5. 실제 변경은 허용된 Market Adapter만 수행한다.
6. 모든 쓰기 작업은 Telegram 1회 승인 필수다.
7. 상품 식별이 모호하거나 여러 상품이 일치하면 실행 금지다.
8. 부분 실패는 성공한 마켓과 실패한 마켓을 분리 보고한다.
9. 모든 실행은 Audit Log에 before/after 상태와 결과를 남긴다.
10. 실제 Adapter가 완성되기 전까지 `DRY_RUN=true`를 기본으로 유지하고 false일 때 fail-closed 한다.

## 3. Market API feasibility matrix

표기: ✅ 공식 API로 구현 가능, ✅* 실제 계정 키 발급 후 세부 endpoint 최종 검증 필요, ⚠️ 별도 승인/계약 필요.

| 채널 | 상품등록 | 상품수정 | 가격 | 재고 | 품절/판매중지 | 주문 | 송장/발송 | 취소 | 반품/교환 | 자체연동 판단 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 네이버 스마트스토어 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 매우 적합 |
| 쿠팡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 매우 적합 |
| G마켓/ESM | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 적합 |
| 롯데ON | ✅* | ✅* | ✅* | ✅* | ✅* | ✅ | ✅ | ✅ | ✅ | 적합, 키 발급 후 세부 검증 |
| 토스쇼핑 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 매우 적합 |
| 카카오 톡스토어/톡딜 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | 기능은 충분, API 승인 필요 |

### 3.1 네이버 스마트스토어

Commerce API 기준으로 상품 등록/수정/삭제, 옵션 재고·가격, 판매상태, 주문 조회, 발주확인, 발송, 취소, 반품, 교환을 구현할 수 있다.

공식 문서:
- https://apicenter.commerce.naver.com/docs/commerce-api/current

### 3.2 쿠팡

Open API로 상품 생성/수정/삭제, 옵션별 가격·재고·판매중지·재개, 주문/발주서, 상품준비중, 송장/배송, 취소, 반품, 교환 처리가 가능하다. 승인완료 상품의 가격·재고·상태는 옵션 단위 API를 우선 사용한다.

공식 문서:
- https://developers.coupang.com/ko
- https://developers.coupang.com/ko/api

### 3.3 G마켓/ESM

ESM Trading API로 상품등록/수정/조회, 가격, 본품재고, 판매상태, 주문, 배송, 취소, 반품, 교환 관련 기능을 구현할 수 있다. `goodsNo`와 사이트별 상품번호를 함께 저장한다.

공식 문서:
- https://etapi.gmarket.com/20
- https://etapi.gmarket.com/21

### 3.4 롯데ON

롯데ON API센터는 상품, 주문/배송, 교환, 반품, CS, 정산, 물류 OpenAPI를 제공한다. 상품 가격·재고·판매상태의 정확한 endpoint는 실제 판매자 인증키 발급 후 API센터 스펙을 기준으로 확정한다.

공식 문서:
- https://api.lotteon.com/apiGuide

### 3.5 토스쇼핑

자체개발 Access Key/Secret Key 방식이 있고 상품등록/수정/삭제, 옵션 가격, 재고, 노출, 주문, 배송/송장, 취소, 반품, 교환 API가 제공된다. 재고 0은 품절 상태로 활용한다.

공식 문서:
- https://shopping-docs.toss.im/dev/api-2/product
- https://shopping-docs.toss.im/dev/api-2/order
- https://shopping-docs.toss.im/dev/api-2/delivery
- https://shopping-docs.toss.im/dev/api-2/claim

### 3.6 카카오 톡스토어/톡딜

상품, 판매상태, 재고, 가격/할인, 주문, 배송, 취소, 반품, 교환 기능은 존재한다. 단 API 사용은 모든 판매자에게 자동 개방되지 않으며 카카오 검토/계약/권한 부여 절차를 거쳐야 한다. 승인 전에는 Adapter를 disabled 상태로 개발한다.

공식 문서:
- https://shopping-developers.kakao.com/hc/ko/categories/4406596840975-API-Docs

## 4. Primary user flows

### 4.1 전체 품절

사용자: `홍옥 사과 5kg 전체 마켓 품절시켜줘`

시스템:

1. Codex가 `SET_OUT_OF_STOCK`으로 구조화
2. Product Resolver가 상품명/별칭/SKU에서 Master SKU 검색
3. 정확히 한 상품일 때만 진행
4. 6개 마켓 현재 가격/재고/판매상태 조회
5. Telegram Preview 전송
6. 사용자 [실행] 클릭
7. 1회용 Approval Token 검증
8. Market Adapter 실행
9. 각 마켓 결과 재조회
10. 성공/실패 결과와 Audit Log 저장

### 4.2 특정 마켓 제외

`쿠팡 빼고 홍옥 5kg 품절`

Codex 출력의 markets는 `naver, gmarket, lotteon, toss, kakao`로 제한한다.

### 4.3 가격 변경

`애플망고 3.6kg 전부 39900원으로 바꿔줘`

Preview에는 각 마켓별 `현재가격 → 39,900원`을 표시한다. 승인 전에는 변경하지 않는다.

### 4.4 재고 변경/재입고

`홍옥 5kg 재고 100개로 다시 열어줘`

중앙재고를 100으로 변경하고, 마켓 정책상 별도 판매재개가 필요한 경우 Adapter가 해당 추가 동작을 수행한다.

## 5. System architecture

```text
Telegram
  ↓
Telegram Bot Gateway
  ↓
Codex Command Interpreter
  ↓ strict JSON schema + Zod validation
Product Resolver
  ↓
Preflight / Snapshot Engine
  ↓
Approval Store
  ↓ Telegram [실행] / [취소]
Control Service
  ├─ Naver Adapter
  ├─ Coupang Adapter
  ├─ Gmarket Adapter
  ├─ LotteON Adapter
  ├─ Toss Adapter
  └─ Kakao Adapter
  ↓
Audit Log / Database
```

## 6. Codex contract

Codex는 아래 필드만 반환한다.

```json
{
  "action": "SET_OUT_OF_STOCK | SET_STOCK | SET_PRICE | STOP_SALES | RESUME_SALES",
  "productQuery": "사용자가 말한 상품명/SKU",
  "markets": ["naver", "coupang", "gmarket", "lotteon", "toss", "kakao"],
  "value": 39900,
  "rationale": "short explanation"
}
```

제한:

- 직접 API 호출 금지
- 쉘 실행 금지
- DB write 금지
- 네트워크 비활성화
- sandbox read-only
- 상품명 임의 생성 금지
- 파싱 불가능하면 유효하지 않은 결과를 반환하여 validation fail 처리

## 7. Approval security

모든 write command는 Approval Token을 생성한다.

필수 속성:

- approvalId
- telegramUserId
- action
- masterSku
- markets
- beforeState
- intendedAfterState
- createdAt
- expiresAt
- consumedAt

규칙:

- Telegram owner user ID와 일치해야 함
- 1회만 사용
- 기본 TTL 10분
- 승인 후 payload 변경 금지
- 만료/재사용/다른 사용자 클릭 시 실행 금지
- 향후 action hash를 추가해 preview와 실제 payload의 동일성을 검증

## 8. Master product data model

```text
Product
- id
- masterSku unique
- name
- aliases[]
- status
- basePrice
- centralStock
- createdAt
- updatedAt

MarketListing
- id
- productId
- market
- externalProductId
- externalOptionId nullable
- sellerSku nullable
- currentPrice nullable
- currentStock nullable
- saleStatus
- lastSyncedAt

Approval
- id
- telegramUserId
- commandJson
- beforeStateJson
- expiresAt
- consumedAt

AuditEvent
- id
- actor
- masterSku
- commandJson
- resultJson
- createdAt
```

초기 v0.1은 JSON 카탈로그와 JSONL audit으로 시작하고, 실제 API 연동 단계에서 PostgreSQL로 이전한다.

## 9. Common Market Adapter interface

```ts
interface MarketAdapter {
  market: Market;
  getState(product): Promise<MarketState>;
  execute(product, command): Promise<MarketExecutionResult>;
}
```

각 Adapter는 중앙 명령을 해당 마켓의 의미로 변환한다. `품절`과 `판매중지`가 같은 개념이라고 가정하지 않는다.

예:

- G마켓: 일시 품절은 정책상 재고 0을 우선 검토
- 쿠팡: 옵션/vendorItem 단위 재고·가격·판매상태 API 사용
- 토스: 옵션 재고 0을 품절로 사용 가능
- 카카오: 승인 전 Adapter disabled

## 10. Reliability requirements

- API timeout 설정
- exponential backoff
- rate-limit 대응
- idempotency key 또는 내부 operation id
- 이미 목표 상태이면 no-op
- 전체 요청 중 일부 마켓 실패 시 전체 성공으로 표시하지 않음
- 실패 마켓만 재시도 가능
- before state를 저장하여 수동/자동 rollback 기반 제공
- 실행 후 실제 상태 재조회
- 인증 만료/권한 오류를 일반 API 오류와 구분

## 11. Telegram UX requirements

Preview 예시:

```text
⚠️ 실행 전 확인
상품: 홍옥 사과 5kg
SKU: APPLE-HONGOK-5KG
작업: 품절 처리

네이버   재고 42 → 0
쿠팡     재고 42 → 0
G마켓    재고 42 → 0
롯데ON   재고 42 → 0
토스     재고 42 → 0
카카오   재고 42 → 0

[✅ 실행] [❌ 취소]
```

실행 후:

```text
✅ 네이버 성공
✅ 쿠팡 성공
✅ G마켓 성공
✅ 롯데ON 성공
✅ 토스 성공
❌ 카카오 실패: API permission denied

[카카오만 재시도]
```

## 12. Scope phases

### Phase 0 — Control-plane skeleton

- TypeScript project
- Telegram bot
- Codex structured command parser
- Master SKU resolver
- approval token
- dry-run adapters
- audit log
- tests

### Phase 1 — First real adapters

1. 네이버
2. 쿠팡
3. 토스쇼핑

각 채널별로 먼저 `getState`, `SET_STOCK`, `SET_PRICE`, `SET_OUT_OF_STOCK`, `STOP_SALES`, `RESUME_SALES`을 완성한다.

### Phase 2 — Remaining adapters

4. G마켓
5. 롯데ON
6. 카카오 승인 후

### Phase 3 — Product publishing

- 상품 신규 등록
- 기본정보 수정
- 이미지/상세페이지 업로드
- 옵션/카테고리/고시정보 매핑

### Phase 4 — Order operations

- 주문 수집
- 발주/상품준비
- 송장/배송
- 취소
- 반품/교환

### Phase 5 — Central inventory automation

- 주문 발생 시 중앙재고 차감
- 전 채널 재고 동기화
- 재고 0 자동 품절
- 재입고 자동 판매재개
- oversell 방지용 safety stock

### Phase 6 — Pricing automation

- 원가
- 수수료
- 배송비
- 목표마진
- 마켓별 가격정책
- 최소마진 하한선
- 퍼센트 가격 변경

## 13. Non-goals for first production release

- 상품 자동 삭제
- AI가 승인 없이 실행
- AI에게 API Secret 노출
- 임의 브라우저 매크로를 핵심 운영 경로로 사용
- 승인 없는 대량 가격변경

상품 삭제는 복구가 어렵기 때문에 별도의 고위험 workflow로 추후 분리한다.

## 14. Acceptance criteria for v0.1

- Telegram owner 외 사용자는 거부된다.
- 자연어 명령이 지원 action + productQuery + markets + value로 변환된다.
- Codex는 read-only/network-disabled로 실행된다.
- 상품이 0개 또는 2개 이상 매칭되면 실행되지 않는다.
- write command마다 Telegram 승인 버튼이 생성된다.
- 승인 버튼은 1회만 사용할 수 있다.
- 취소하면 Adapter를 호출하지 않는다.
- DRY_RUN에서 6개 마켓 결과를 독립적으로 반환한다.
- Audit Log에 실행 이력이 남는다.
- `DRY_RUN=false`인데 실제 Adapter가 없으면 앱이 시작 단계에서 실패한다.

## 15. Definition of done for first usable production version

최소 네이버 + 쿠팡 + 토스쇼핑 3개 채널에서 실제 계정으로 다음 시나리오가 end-to-end 통과해야 한다.

1. Telegram에서 특정 SKU 품절 명령
2. 현재값 Preview
3. 사용자 승인
4. 3개 마켓 실제 재고 0/품절 처리
5. 재조회 검증
6. 성공/실패 결과 Telegram 회신
7. Audit DB 기록
8. 동일 SKU 가격변경
9. 재입고/판매재개
10. 일부 마켓 API 실패 후 실패 채널만 재시도

이후 G마켓·롯데ON·카카오를 같은 Adapter contract로 확장한다.
