FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY web/package*.json ./web/
RUN npm install --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000 \
  && npm --prefix web install --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000

COPY . .
# CI runs the full backend tests and typechecks before deployment. Keep the
# production image build focused on compiling the shipped frontend so a
# constrained MiniPC does not re-run the complete test suite inside BuildKit.
RUN npm run web:build \
  && mkdir -p /app/data \
  && chown -R node:node /app

ENV NODE_ENV=production \
    WEB_ENABLED=true \
    WEB_HOST=0.0.0.0 \
    WEB_PORT=8787 \
    WEB_DIST_PATH=./web/dist \
    PRODUCT_CATALOG_PATH=./data/products.json \
    MARKET_CREDENTIALS_PATH=./data/market-credentials.enc.json \
    REGISTRATION_LEDGER_PATH=./data/registration-ledger.json \
    BILLING_STORE_PATH=./data/billing.json \
    AUDIT_LOG_PATH=./data/audit.jsonl \
    FEEDBACK_LOG_PATH=./data/feedback.jsonl \
    TELEGRAM_ENABLED=false \
    DRY_RUN=true \
    PRODUCT_REGISTRATION_ENABLED=false

VOLUME ["/app/data"]
EXPOSE 8787
USER node

CMD ["npm", "start"]
