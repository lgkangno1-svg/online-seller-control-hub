# Cloudflare 배포/도메인 연결 가이드

이 문서는 SellerHub 웹앱 기능 개발이 끝난 뒤 사용자 소유 도메인을 Cloudflare로 연결할 때 적용합니다. 도메인 연결은 현재 기능 개발의 선행조건이 아닙니다.

## 권장 구조

```text
사용자 브라우저
    ↓ HTTPS
Cloudflare DNS / Proxy 또는 Cloudflare Tunnel
    ↓
SellerHub origin (Docker, port 8787)
    ├─ React web
    └─ /api/*
          ↓ outbound HTTPS
          ├─ Naver
          ├─ Coupang
          ├─ Gmarket
          ├─ LotteON
          ├─ Toss
          └─ Kakao
```

프런트와 API는 동일 origin에서 제공하므로 별도 CORS 설정을 만들 필요가 없습니다.

## 매우 중요한 점: Cloudflare IP와 마켓 API 허용 IP는 다름

Cloudflare Proxy/Tunnel은 **사용자가 SellerHub로 들어오는 inbound 경로**를 보호합니다. 쿠팡 등에서 API 호출 IP를 등록하라고 할 때 필요한 것은 Cloudflare IP가 아니라 **SellerHub 서버가 마켓 API로 나갈 때 사용하는 실제 고정 outbound/egress IP**입니다.

따라서 배포 서버는 가능하면 고정 egress IP를 사용하고 그 값을 `PUBLIC_EGRESS_IP`에 설정합니다. 웹의 마켓 연동 화면에서도 이 값을 사용자에게 보여줍니다.

## Cloudflare 연결 전 서버 요구조건

- Docker 이미지가 CI에서 성공적으로 빌드될 것
- `/api/health`가 정상 응답할 것
- `/app/data` 영속 볼륨이 연결될 것
- `MARKET_CREDENTIALS_KEY`는 배포 Secret Manager에서 주입할 것
- `.env`, API key, Telegram token, Codex key를 이미지에 포함하지 않을 것
- 실제 쓰기 전 `LIVE_MARKETS`를 마켓별로 명시할 것
- 실제 상품 등록 전 `PRODUCT_REGISTRATION_ENABLED=true`를 별도로 켤 것
- 운영 전 HTTPS만 허용할 것

## 추후 Cloudflare 설정

1. 원하는 서브도메인을 정합니다. 예: `seller.example.com`.
2. Origin 서버를 공개 IP + Cloudflare Proxy로 노출하거나 Cloudflare Tunnel을 생성합니다.
3. Cloudflare에 DNS 레코드/Tunnel hostname을 연결합니다.
4. SSL/TLS는 `Full (strict)`를 사용합니다.
5. Origin 직접 노출 방식이면 방화벽에서 Cloudflare 프록시 경유 트래픽만 허용하는 방식을 권장합니다.
6. 로그인/마켓 API 설정 페이지는 캐시하지 않습니다. `/api/*`도 캐시 금지입니다.
7. 필요하면 Cloudflare Rate Limiting/WAF 규칙을 로그인·API 엔드포인트에 추가합니다.

## 현재 앱과의 호환성

SellerHub는 same-origin 상대경로(`/api/...`)를 사용하므로 도메인이 바뀌어도 일반적으로 프런트 코드를 수정할 필요가 없습니다. `VITE_API_BASE_URL`은 프런트와 API를 분리 배포할 때만 필요합니다.

## 운영 전 체크

- Cloudflare 도메인을 붙이는 것만으로 마켓 API의 고정 egress IP 요구조건이 해결되지는 않습니다.
- API Secret은 Cloudflare DNS/환경 변수에 기록하지 않습니다.
- 데이터 볼륨 백업 정책을 설정합니다.
- 베타가 끝나기 전에는 결제 기능과 플랜 강제 제한을 활성화하지 않습니다.
