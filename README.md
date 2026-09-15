# Online Seller Control Hub

개인사업자/소규모 셀러가 네이버 스마트스토어, 쿠팡, G마켓, 롯데ON, 토스쇼핑, 카카오 톡스토어/톡딜을 한 웹앱에서 연결하고 제어하기 위한 멀티마켓 운영 시스템입니다.

## 현재 베타 범위

웹앱에서 다음 흐름을 지원합니다.

`베타 로그인 → Master SKU 생성 → 마켓 API Key 암호화 저장 → 실제 API 연결확인 → 카테고리/주소 등 참조값 조회 → 상품등록 → 외부 상품 ID 자동매핑 → 가격/재고/품절 자연어 명령 → 실행 전 승인`

Telegram + Codex 제어도 같은 Master SKU/마켓 Adapter 구조를 사용합니다. 자연어 명령은 즉시 실행하지 않고 대상 상품과 변경 내용을 보여준 뒤 승인된 요청만 수행합니다.

## 마켓별 현재 상태

| 마켓 | API Key 저장 | 실제 연결확인 | 상품등록 Gateway | 참조데이터 | 가격/재고/상태 LIVE Adapter |
|---|---:|---:|---:|---:|---:|
| 네이버 | ✅ | ✅ 판매자 계정 조회 | ✅ v2 | ✅ 카테고리/주소/고시/속성 | ✅ 일반재고/가격/판매상태 · 옵션재고는 검증 전 차단 |
| 쿠팡 | ✅ | ✅ 상품목록 조회 | ✅ | ✅ 카테고리/출고지/반품지/메타 | ✅ vendorItem 단위 |
| G마켓 | ✅ | ✅ ESM 상품조회 | ✅ | 공식 세부 스펙 추가검증 후 | ✅ 본품 가격/재고/판매상태 |
| 롯데ON | ✅ | ✅ identity 조회 | 검증된 등록 path 설정 시 | 공식 세부 스펙 추가검증 후 | ⛔ 정확한 write 스펙 실계정 검증 전 차단 |
| 토스쇼핑 | ✅ | ✅ OAuth + 상품 API | ✅ v2 | ✅ 카테고리/배송/반품/고시 | ✅ product + item 단위 |
| 카카오 | ✅ | ✅ 판매자 API | ✅ 승인 계정 | ✅ 카테고리/주소 | ⛔ 승인 판매자 write 스펙 실계정 검증 전 차단 |

> “Gateway ✅”는 해당 마켓의 공식 Request Body를 서버에서 실제 API로 전달하고 응답/비즈니스 오류를 검사한다는 뜻입니다. 마켓별 필수 카테고리·배송·고시·옵션 값은 판매 상품과 계정 정책에 따라 달라서, 베타 UI는 기본 입력 + 공식 참조데이터 + 고급 JSON 편집을 함께 제공합니다.

## 안전장치

- 마켓 Secret은 브라우저/localStorage/Git에 보관하지 않고 서버 AES-256-GCM 암호화 저장
- tenant별 자격증명/상품 격리
- Secret은 저장 후 다시 브라우저에 반환하지 않음
- API Key 저장과 실제 연결 성공을 별도 상태로 구분
- 상품등록은 `PRODUCT_REGISTRATION_ENABLED=false`가 기본
- 실제 등록 직전 연결 상태 재검증
- 동일 SKU의 동일 마켓 중복 등록 차단
- idempotency ledger로 브라우저/네트워크 재시도 중복 생성 차단
- 원격 상품 생성 POST의 결과가 불명확한 timeout은 자동 재호출하지 않음
- 상품 ID와 가격/재고 제어 ID를 분리 저장
- 자연어 쓰기 명령은 승인 토큰 없이는 실행 불가
- `DRY_RUN=true`가 기본이며 LIVE 제어 마켓은 `LIVE_MARKETS`로 별도 허용
- 등록/가격/재고 실행 결과 감사로그 저장
- 네이버/쿠팡/토스 API 호출한도에 맞춘 속도제한과 제한적 transient retry
- 네이버/토스 OAuth Access Token 캐시 및 만료/401 처리

## 로컬 실행

Node.js 22.12+가 필요합니다.

```bash
cp .env.example .env
npm run install:all
npm run build
npm start
```

웹 기본 주소는 `http://localhost:8787`입니다.

### 암호화 키 생성

아래 값은 **배포 서버 Secret Manager에만** 저장하고 Git에 넣지 않습니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

출력값을 `.env` 또는 배포 환경의 `MARKET_CREDENTIALS_KEY`에 설정합니다.

## 베타 테스터 계정

`WEB_BETA_TOKENS`는 테스트 사용자별 tenant를 분리합니다.

```text
WEB_BETA_TOKENS={"tester1":{"token":"LONG_RANDOM_TOKEN","tenantId":"shop-a","plan":"beta","enabled":true}}
```

테스터에게는 로그인 토큰만 전달합니다. 마켓 API Secret은 테스터가 웹의 **마켓 연동** 화면에서 직접 입력하고 서버에 암호화 저장됩니다.

### 베타 배포 replica 제한

현재 API rate limiter와 OAuth token cache는 프로세스 메모리를 사용합니다. 따라서 베타는 **애플리케이션 컨테이너 1개(replica=1)** 로 운영합니다. 유료 SaaS에서 수평 확장하기 전에 Redis 같은 공유 rate-limit/token-cache 계층으로 교체합니다.

## 실제 상품등록 활성화

처음에는 다음 상태를 유지합니다.

```text
DRY_RUN=true
PRODUCT_REGISTRATION_ENABLED=false
LIVE_MARKETS=
```

1. 웹의 **마켓 연동**에서 API Key를 입력합니다.
2. **API 연결 확인**을 눌러 실제 판매자 API 읽기 호출이 성공하는지 확인합니다.
3. **상품 관리**에서 Master SKU를 만듭니다.
4. **상품 등록**에서 해당 SKU와 마켓을 선택하고 카테고리/주소/고시 참조값을 조회합니다.
5. 마켓의 필수 Request Body를 완성하고 **등록 전 검증**을 통과합니다.
6. 테스트 계정에서 실제 등록을 의도한 경우에만 서버의 `PRODUCT_REGISTRATION_ENABLED=true`를 켭니다.
7. 등록 성공 후 반환된 상품 ID는 Master SKU에 자동 저장됩니다.
8. 쿠팡 `vendorItemId`, 토스 옵션/Item ID처럼 상품 ID와 제어 ID가 다른 마켓은 **상품 관리 → 제어 ID**에 별도로 매핑한 뒤 가격/재고 명령을 활성화합니다.

롯데ON은 현재 계정에 제공되는 OpenAPI 문서의 정확한 상품생성 경로를 확인한 뒤 `LOTTEON_PRODUCT_REGISTER_PATH`에 지정해야 등록이 활성화됩니다. 확인하지 않은 경로를 코드에서 추정하지 않습니다.

## LIVE 가격/재고 제어

예를 들어 검증을 마친 마켓만 다음처럼 활성화합니다.

```text
DRY_RUN=false
LIVE_MARKETS=naver,coupang,gmarket,toss
```

검증되지 않은 마켓은 LIVE 목록에 넣지 않습니다. 목록에 없는 Adapter는 fail-closed로 명령을 거절합니다.

### 마켓별 운영 예외

- **네이버**: 옵션별 재고관리 상품은 현재 옵션 구조를 감지해 root 재고 변경을 차단합니다. 옵션 ID별 실계정 검증 후 전용 option-stock 흐름을 활성화합니다.
- **쿠팡**: 신규 생성 성공 후에도 `vendorItemId`가 즉시 준비되지 않을 수 있으므로 실제 제어 ID를 조회/매핑하기 전에는 가격·재고 제어하지 않습니다.
- **G마켓**: 상품 등록 직후 약 3분간 sell-status 변경이 제한될 수 있고, 판매중지를 1개월 유지하면 상품 삭제 가능성이 있으므로 장기 품절을 방치하지 않습니다.
- **롯데ON**: 인증키 유효기간 1년 및 서버 IP 정책을 확인합니다. write 경로는 검증된 스펙만 허용합니다.
- **토스쇼핑**: Access Token은 매 API 호출마다 새로 만들지 않습니다. 읽기/쓰기 API 한도를 SellerHub에서 자동 제한합니다.
- **카카오 톡스토어**: channel-ids=101 및 판매자 연결이 필요합니다. 2026-09-18 카테고리 개편 전후에는 등록 직전 카테고리를 다시 조회합니다.

## 자연어/Telegram 예시

- `홍옥 5kg 전 마켓 품절시켜줘`
- `쿠팡 빼고 홍옥 5kg 재고 20개로 바꿔줘`
- `애플망고 3.6kg 전체 39900원으로 바꿔줘`
- `토스에서만 머스크멜론 판매중지해줘`
- `홍옥 5kg 전부 판매재개`

Codex는 문장을 구조화할 뿐 마켓 Secret이나 직접 API 호출 권한을 갖지 않습니다. 실제 변경은 허용된 Market Adapter와 승인 절차를 통해서만 수행됩니다.

## 주요 환경변수

- `WEB_BETA_TOKENS`: 베타 사용자/tenant 토큰
- `MARKET_CREDENTIALS_KEY`: 마켓 자격증명 암호화 키
- `PUBLIC_EGRESS_IP`: 마켓 IP 허용목록에 등록할 서버 고정 출구 IP
- `PRODUCT_REGISTRATION_ENABLED`: 실제 상품 생성 잠금
- `REGISTRATION_LEDGER_PATH`: 중복 등록 방지 ledger
- `DRY_RUN`: 가격/재고/상태 변경 시뮬레이션
- `LIVE_MARKETS`: 실 API 제어가 허용된 마켓 목록
- `LOTTEON_PRODUCT_REGISTER_PATH`: 검증된 롯데ON 상품 생성 path
- `CODEX_API_KEY`: 자연어 명령 해석용
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_USER_ID`: Telegram 보조 제어용

## 디렉터리

```text
src/
  ai/             Codex 자연어 명령 파서
  bot/            Telegram 승인 UI
  catalog/        Master SKU + 상품 ID/제어 ID 매핑
  core/           승인/제어 도메인 로직
  markets/        연결검증, 참조데이터, 마켓 Adapter, 속도제한/토큰 캐시
  persistence/    암호화 자격증명, 등록 ledger, 감사/피드백 로그
  web/            HTTP API + 정적 웹 서버
web/src/           React 베타 웹앱
docs/PRD.md        전체 제품 요구사항
docs/MARKET_POLICY_AUDIT_2026-09-10.md  공식 정책 대조/운영 가드 기록
```

## 베타 배포 전 체크

- `npm run build` 통과
- 백엔드 타입체크/테스트 통과
- 프로덕션 Docker 이미지 빌드 통과
- 실제 Secret이 Git에 없는지 확인
- HTTPS 사용
- 고정 egress IP 사용
- 마켓별 IP allowlist 등록
- 테스터별 tenant/token 분리
- 컨테이너 replica=1 유지
- `PRODUCT_REGISTRATION_ENABLED=false`로 첫 배포
- 연결확인 성공 후 테스트 SKU 1개로 마켓별 생성 검증
- 생성 결과의 상품 ID/옵션 ID 확인
- 이후 검증된 마켓만 `LIVE_MARKETS`에 추가

상세 요구사항은 [`docs/PRD.md`](./docs/PRD.md), 최신 마켓 정책 검토와 안전장치는 [`docs/MARKET_POLICY_AUDIT_2026-09-10.md`](./docs/MARKET_POLICY_AUDIT_2026-09-10.md)를 참조하세요.
