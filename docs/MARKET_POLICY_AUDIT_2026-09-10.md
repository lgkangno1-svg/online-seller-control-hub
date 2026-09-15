# SellerHub Marketplace API Policy Audit

Last reviewed: **2026-09-10 (KST)**

This document records the official marketplace API rules that SellerHub depends on, the code guardrails currently implemented, and the items that must remain fail-closed until verified with an approved seller account. Marketplace policies can change without a SellerHub release, so production activation must always use a live protected API verification first.

## Global operating rules

1. Marketplace secrets stay server-side and encrypted at rest. They are never returned to the browser after storage.
2. A saved credential is **not** treated as a working connection. SellerHub must call a protected marketplace API and receive a successful response.
3. Destructive/write commands require the user's one-time approval after previewing product, target marketplaces and before/after values.
4. `DRY_RUN=true` remains the default. Real controls require an explicit `LIVE_MARKETS` allowlist.
5. Product creation has a second independent gate: `PRODUCT_REGISTRATION_ENABLED=true` plus an explicit UI confirmation.
6. Product-create POST requests are not blindly retried after an ambiguous timeout. Most marketplace create APIs do not expose a SellerHub-controlled idempotency key; an automatic retry could create duplicates. SellerHub's own registration ledger blocks duplicate client requests, but an unknown remote result still requires reconciliation.
7. Set-state operations such as price/stock/status can retry only on transient conditions (429/502/503/504/timeouts), and adapters verify state again after the write.
8. Current rate limiters/token caches are process-local. **Beta deployment must run as a single application replica.** Before horizontal scaling, replace them with a shared Redis/distributed limiter and token cache.

---

## NAVER SmartStore / Commerce API

Official sources:
- https://apicenter.commerce.naver.com/docs/commerce-api/current
- https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EC%9B%90%EC%83%81%ED%92%88-%EC%A0%95%EB%B3%B4-%EA%B5%AC%EC%A1%B0%EC%B2%B4
- https://apicenter.commerce.naver.com/docs/commerce-api/current/bulk-update-origin-product-product
- https://apicenter.commerce.naver.com/docs/commerce-api/current/update-options-product

Verified rules:
- Current docs were at version 2.88.0 on 2026-09-07.
- Seller access uses OAuth2 Client Credentials and SELLER identity for seller APIs.
- New product creation uses v2 product API.
- New product registration status must be `SALE` when explicitly supplied.
- Root stock `0` saves the product as out of stock.
- Sale status changes support `SALE`, `OUTOFSTOCK`, `SUSPENSION` and a `stockQuantity` field.
- Absolute price change can use bulk update with `productBulkUpdateType=SALE_PRICE`, `productSalePriceChangerType=TO`, `productSalePriceChangerUnitType=WON`.
- Current option field names include `optionSimple`, `optionCustom`, `optionCombinations`, `optionStandards` and `useStockManagement`.
- Option stock/price has a dedicated `/option-stock` API; root stock must not be substituted for option stock without option-level mapping.
- Representative product images must use URLs obtained through the Commerce API image upload flow.

SellerHub safeguards:
- OAuth token is cached until shortly before expiry; 401 invalidates it.
- Product API calls are throttled below the documented product API limit and transient failures use bounded retries.
- Option-managed products are detected using the current option schema. Root stock writes are blocked for these products until option-level live integration is verified.
- Price/stock limits are validated before the API call.

Remaining fail-closed item:
- Option-level inventory control is intentionally disabled until real-account testing confirms option IDs and update behavior for the user's product types.

---

## Coupang Open API

Official sources:
- https://developers.coupang.com/ko/notices/optimization-and-adjustment-of-open-api-rate-limiteffective-march-17th2026
- https://developers.coupang.com/ko/notices/open-api-update-brand-unique-id-mpn-or-gtin-and-category-based-required-purchase
- https://developers.coupang.com/ko/notices/open-api-update-auto-pricing-support-may-22nd-2026

Verified rules:
- Baseline Open API rate policy was reduced from 10 rps to **5 rps** in March 2026 for affected APIs.
- Product policy now includes standardized `brandId`, new unique identifier attribute names (`Global Trade Item Number`, `Manufacturer Part Number`) and category-based required purchase-option attributes.
- Old `GTIN` / `Variation MPN` names are currently supported but announced for future deprecation.
- Auto-pricing fields were added. `minSalePrice` must be lower than sale price when automatic pricing is enabled.
- Vendor item price/stock/sales controls operate at `vendorItemId` level.
- A newly created seller product may not yet provide a control-ready `vendorItemId`; product creation success must not be treated as immediate price/stock readiness.

SellerHub safeguards:
- HMAC signing and required marketplace headers are used.
- Calls are serial-throttled below 5 rps with bounded retry for transient failures.
- Price update deliberately does **not** set `forceSalePriceUpdate=true`, preserving Coupang's price-change typo guard.
- Registration preflight validates category attributes and warns/blocks around brand/UID policy requirements.
- `sellerProductId` and `vendorItemId` are stored separately.

Remaining fail-closed item:
- After a successful product create, SellerHub must discover/map approved `vendorItemId` values before enabling item-level controls.

---

## Gmarket / ESM Trading API

Official sources:
- https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C
- https://etapi.gmarket.com/21

Verified rules:
- ESM master/seller API use requires appropriate API authorization. JWT uses HMAC SHA-256 and ESM seller identity values.
- Gmarket and Auction values are carried together in sell-status operations.
- Sell-status update is available only after normal product registration processing, documented as approximately **3 minutes**.
- Base stock in the sell-status API cannot be represented as zero in the same way as SellerHub's common model; sale stop is used for the zero-stock fallback.
- A product held in sale-stop state for **one month may be deleted** by marketplace policy.
- Price changes require 10 KRW units, and stopped product update behavior is restricted.

SellerHub safeguards:
- Reads the current combined Gmarket/Auction state and preserves Auction values when changing only Gmarket.
- Converts common stock=0 to Gmarket sale-stop instead of sending an invalid zero base-stock value.
- Blocks price mutation while the Gmarket listing is stopped.
- Every zero-stock/sale-stop result contains a long-stop deletion warning.
- New registration preflight blocks `isSell` in a create payload and warns about the post-registration processing interval.

Remaining operational requirement:
- For long-lived out-of-stock products, the product should be reviewed/replenished/relisted before the one-month stop window rather than assuming a permanent safe out-of-stock state.

---

## LotteON OpenAPI

Official sources:
- https://api.lotteon.com/apiGuide/
- https://api.lotteon.com/

Verified rules:
- OpenAPI is available after seller onboarding and supports product through delivery-related operations.
- Seller center OpenAPI setup registers server IP or selects a seller-tool provider.
- API key validity is **1 year** and keys must be reissued/rotated.
- Maximum documented traffic is **10,000 calls per minute per API key**.
- Requests validate registered source IP.
- Authentication uses `Authorization: Bearer {key}` with documented locale/timezone headers.

SellerHub safeguards:
- Credential verification calls the protected identity endpoint with the documented headers.
- UI displays server egress IP and key-expiry policy.
- Product creation and LIVE mutation stay fail-closed unless the exact current seller OpenAPI path/schema is explicitly configured and verified; SellerHub does not guess a write path.

Remaining fail-closed item:
- Product-write/control adapter needs an approved seller account's current product specification / endpoint verification before production enablement.

---

## Toss Shopping

Official sources:
- https://shopping-docs.toss.im/dev/api-intro
- https://shopping-docs.toss.im/dev/api-1/token
- https://shopping-docs.toss.im/dev/api-1/register-product

Verified rules:
- Self-developed integration uses Access Key + Secret Key and registered source IP.
- All APIs use Bearer Access Tokens.
- Toss explicitly warns that requesting a new Access Token for every API call can result in API-use restriction.
- Documented limit is **30 rps for writes and 50 rps for reads per seller/API**.
- `TOO_MANY_REQUEST` can be returned.
- Response fields/error codes may be added or changed, so clients should remain forward-compatible with unknown fields.
- Product registration must use current leaf-category templates, notices, shipping and return policy data.

SellerHub safeguards:
- Tokens are cached until shortly before expiry and invalidated on 401.
- Separate read/write throttles stay below documented limits and retry bounded transient failures / `TOO_MANY_REQUEST`.
- Parsers tolerate additional unknown response fields.
- Product and product-item IDs are stored separately.
- Product registration validates name/brand patterns, options, stock/price, image roles, management codes and commerce policies before submit.

Scaling note:
- The current cache/limiter is correct for the one-container beta. Horizontal scaling requires shared state.

---

## Kakao Shopping / Talk Store / TalkDeal

Official sources:
- https://shopping-developers.kakao.com/hc/ko/articles/4578909656975-API-%EA%B3%B5%ED%86%B5-%EC%9D%B8%EC%A6%9D-%ED%97%A4%EB%8D%94-%EA%B5%AC%EC%84%B1
- https://shopping-developers.kakao.com/hc/ko/sections/4664373620495-%EA%B3%B5%EC%A7%80%EC%82%AC%ED%95%AD
- https://shopping-developers.kakao.com/hc/ko/articles/17339422818063--%ED%86%A1%EC%8A%A4%ED%86%A0%EC%96%B4-%EC%B6%94%EA%B0%80%EC%83%81%ED%92%88-%EA%B4%80%EB%A0%A8-%ED%95%84%EB%93%9C-%EC%A0%81%EC%9A%A9-%EC%95%88%EB%82%B4-26-9-9-%EC%98%88%EC%A0%95

Verified rules:
- Common authentication requires Admin App Key, seller app key and channel IDs.
- Talk Store channel ID is `101`.
- The integration-agent/seller connection must be completed before product/order APIs can be called.
- Additional-product fields became applicable to Talk Store product registration/update/query on **2026-09-09**.
- A Talk Store category restructure is scheduled for **2026-09-18**; static category mappings must not be assumed durable through that date.
- Claim APIs can have an ambiguous timeout outcome: some operations may report failure after a long request even though a later state read shows the operation completed.

SellerHub safeguards:
- Connection check refuses a Talk Store configuration that does not include channel `101`.
- Product registration validation includes current core ProductRequest requirements and option/stock conflict rules.
- UI explicitly warns users to refresh categories immediately before registration during the announced category transition.
- Kakao LIVE price/stock/status adapter stays disabled until the approved seller connection and exact current write specifications are tested.

Important future rule:
- Claim approval/cancel/refund writes must never be blindly retried after timeout; always query claim/order state first because the remote action may already have succeeded.

---

## Release gate before real seller accounts

The beta should not be considered production-ready until all of the following are true:

- [ ] Backend typecheck/tests pass.
- [ ] Web production build passes.
- [ ] Production Docker image builds.
- [ ] Marketplace credential encryption key comes from deployment secret storage.
- [ ] Fixed public egress IP is configured where required.
- [ ] `DRY_RUN=true` during first account connectivity tests.
- [ ] Each market passes a protected read API with the user's own approved account.
- [ ] Each real write adapter is tested on a disposable/test listing first.
- [ ] Product-create result is reconciled to actual marketplace IDs before subsequent controls.
- [ ] Gmarket long-stop deletion warning is operationally accepted.
- [ ] Kakao categories are rechecked after the 2026-09-18 category migration.
- [ ] LotteON exact write paths are verified before enabling product write controls.
- [ ] Multi-replica deployment is disabled until shared rate limiting/token caching is implemented.
