# PHASE 7 — Handoff: Caesar is LIVE in production; next = UI/polish + fix the gaps

**Date:** 2026-06-23
**Status:** ✅ **Caesar Terminal is deployed and serving end-to-end.** Frontend at **https://app.trycaesar.xyz** (SPA, TLS), API at **https://api.trycaesar.xyz** (GraphQL + WS), data in Railway Postgres. The full stack is wired and verified by request: the live API returns markets and the browser SPA is built against the live API. Phase 7 is **UI fixes, bug polish, and closing the deployment gaps** (partial data, www/apex, cleanups). This was written to hand off to a fresh session with clean eyes.

---

## TL;DR

- **Live URLs:** `https://app.trycaesar.xyz` (frontend) · `https://api.trycaesar.xyz` (API, incl. `wss://…/graphql` subscriptions).
- **The box this repo sits on IS the production VPS** (`161.97.166.69`, `root@vmi3328433`). nginx here serves the SPA from `/var/www/caesar` and 6 other unrelated sites (watchzer0, fratvzn, miroshark, playjumbo, fratelli-n8n, catchall — **don't touch them**).
- **API + Postgres run on Railway** (project service `caesar-trade` + a `Postgres` service). The API is a persistent Node+WS server (graphql-ws needs that — not serverless).
- **Trading is gated OFF** (`CAESAR_ENABLE_MAINNET_TRADING` / `VITE_ENABLE_MAINNET_TRADING` both false). The deposit-wallet/type-3 trade path is built + proven (Phase 5/6) but dormant in prod.
- **Known gaps (Phase 7 work):** only **573 of ~4,700 markets** loaded (ingester crashes mid-pull, **no Kalshi yet**); `www`/apex domains unfinished; a temporary `/health/db` route to remove; API still on the public DB URL (egress). Plus whatever UI bugs you find.

---

## Production topology (how it's wired)

```
Browser ──► https://app.trycaesar.xyz         (nginx on THIS VPS, static SPA, /var/www/caesar)
              │  apollo client (baked at build): VITE_GRAPHQL_HTTP_URL=https://api.trycaesar.xyz/graphql
              │  WS auto-derived → wss://api.trycaesar.xyz/graphql
              ▼
           https://api.trycaesar.xyz           (Railway service "caesar-trade", apps/api)
              │  Node + Fastify + graphql-yoga + graphql-ws, binds 0.0.0.0:$PORT (8080)
              │  CORS_ORIGIN=https://app.trycaesar.xyz  (credentials + privy-id-token)
              ▼
           Railway Postgres (service "Postgres", PG 18.4)   573 markets
```

- **No API reverse-proxy on the VPS** — the SPA calls Railway directly (CORS is set server-side). nginx here only serves static files + TLS.
- **CORS verified:** preflight from `https://app.trycaesar.xyz` returns the right `access-control-allow-origin/credentials/headers`.

---

## How to ship a UI change (you'll do this a lot in Phase 7)

The frontend is a **static build** served by nginx. There is **no dev-server in prod** — edit, build, copy:

```bash
cd /root/caesar
# 1. edit apps/web/src/...
# 2. rebuild (API URL must be overridden; Privy id + gates come from root .env via envDir)
VITE_GRAPHQL_HTTP_URL=https://api.trycaesar.xyz/graphql pnpm --filter @caesar/web build
# 3. publish
rm -rf /var/www/caesar/* && cp -r apps/web/dist/* /var/www/caesar/ && chmod -R a+rX /var/www/caesar
# (no nginx reload needed — static files; hard-refresh the browser, assets are content-hashed)
```

**Local iteration (faster feedback than build-per-change):** run the stack locally and use Vite HMR — see [[caesar-dev-servers]]. API at `:4000`, web at `:3010`, Vite proxies `/graphql`. You can point local web at the *live* API by setting `VITE_GRAPHQL_HTTP_URL=https://api.trycaesar.xyz/graphql` in the dev env, or run a local API against the live DB (DATABASE_URL = Railway Postgres `DATABASE_PUBLIC_URL`).

- nginx site: `/etc/nginx/sites-available/caesar` (symlinked in sites-enabled). TLS cert `/etc/letsencrypt/live/app.trycaesar.xyz/` (certbot webroot `/var/www/certbot`, auto-renew on). After any nginx edit: `nginx -t && systemctl reload nginx`.

---

## How to ship an API change

The API runs on **Railway**, currently building branch **`chore/railway-deploy`** (see Git state below). Push to that branch → Railway redeploys.

```bash
# edit apps/api/src/... then:
pnpm --filter api typecheck     # only the pre-existing @types/ws server.ts noise is expected
git add -A && git commit -m "..." && git push   # on the deployed branch
```

- Start command (in `railway.json`): `pnpm --filter @caesar/api start` → `node --import tsx src/server.ts` (no compile; all `@caesar/*` packages export `./src/*.ts`).
- **Railway env vars** (dashboard → caesar-trade → Variables): `DATABASE_URL`, `CORS_ORIGIN=https://app.trycaesar.xyz`, `PRIVY_APP_ID/_SECRET`, `POLYGON_RPC_HTTP=https://polygon.drpc.org`, `POLYMARKET_API_KEY/_SECRET/_PASSPHRASE`, `CAESAR_CREDS_ENC_KEY`, `CAESAR_ENABLE_MAINNET_TRADING=false`, `NODE_ENV=production`, `PORT=8080`.
- ⚠️ **Railway gotcha that cost an hour:** variable changes only take effect on a *real* redeploy; a half-applied change keeps serving the **old container**. If a var change "isn't working," confirm the latest deployment is Active AND newer than the change. `GET /health/db` (temp diagnostic) returns the raw DB error + redacted host — use it to verify connectivity instead of guessing at the masked GraphQL `INTERNAL_SERVER_ERROR`.

---

## Git / branch state (read carefully)

- `origin/main` tip = `c206aa0` (Merge PR #3). Has the deploy config (`railway.json`, start scripts, prod bind + CORS).
- **`chore/railway-deploy` is one commit AHEAD of main** = `b30e0d8` "add /health/db diagnostic". **Railway builds this branch** (that's why `/health/db` is live). `main` does NOT have the diagnostic.
- PRs #1, #2, #3 all merged. No open PRs.
- **Recommended cleanup:** remove the `/health/db` route, commit, and **consolidate onto `main` + point Railway at `main`** so the deployed branch isn't a one-off. (Or just keep deploying `chore/railway-deploy` — but then keep merging main into it.)
- Working tree has untracked screenshots/cruft (`*.png`, `..env.swp`, `apps/api/_watch-deploy.mjs`) — safe to `git clean`/ignore; none are part of the app.

---

## Open items for Phase 7 (prioritized)

1. **Markets are incomplete — fix the ingester.** Only **573/~4,700** Polymarket markets, **0 Kalshi**. `apps/ingest` (`pnpm --filter @caesar/ingest ingest:once`, needs `DATABASE_URL`) crashes partway through the Polymarket pull — twice, at ~573 — likely a network-timeout / unhandled-rejection robustness bug in `apps/ingest/src/{polymarket,http,run}.ts` (a TCP error surfaced in one run). Make the HTTP layer resilient (retries/timeouts/continue-on-error), then run it to completion; confirm Kalshi loads too (public-data-only, see [[kalshi-auth-skipped]]). Biggest user-visible win. Then set up **ongoing ingestion** (a Railway service/cron running `ingest`, not one-shot) for freshness.
2. **UI fixes & polish (the main ask).** Open `https://app.trycaesar.xyz` with fresh eyes — markets browser, market detail (orderbook/chart/trades/holders), trader pages, portfolio. Hunt layout/empty-state/loading/responsive bugs. The order ticket + positions/open-orders panels exist (Phase 6) but render read-only/hidden while trading is gated off.
3. **Verify Privy login in the live browser.** Confirm `https://app.trycaesar.xyz` is in Privy's allowed origins (app id `cmqp5sqdc00420ckz6neh4nn5`); if login fails silently, that's the usual cause. See [[privy-config]].
4. **Finish the domains.** `www.trycaesar.xyz` currently gets a TLS rejection (nginx `caesar` site is `app`-only) — add a `www → app` redirect (expand cert to include `www`). Bare `trycaesar.xyz` redirect times out (Namecheap URL-redirect record / a leftover apex A record) — DNS-side.
5. **Pre-launch cleanups.** Remove the `/health/db` diagnostic route (it leaks the DB error/host unauthenticated). Switch the API `DATABASE_URL` from the **public** proxy (egress fees) to **internal** `postgres://postgres:<pw>@postgres.railway.internal:5432/railway`. The `Postgres` service's own `DATABASE_URL` is still the corrupted localhost default — harmless now (API uses an explicit URL) but worth resetting.
6. **Trading productionization (later).** Phase 6 built the type-3 order ticket on the market page + positions/open-orders panel. Going live = supervised run with the gates flipped ON and the geoblock check (server-side `polymarketOpenOrders` read may need the browser-fetch fallback noted in `apps/api/src/clob.ts`).

---

## Reference

| Thing | Value |
|---|---|
| Frontend | `https://app.trycaesar.xyz` — nginx, `/var/www/caesar`, site `/etc/nginx/sites-available/caesar` |
| API | `https://api.trycaesar.xyz` — Railway `caesar-trade` (default `caesar-trade-production.up.railway.app`) |
| DB | Railway `Postgres` service (PG 18.4). Public URL = its `DATABASE_PUBLIC_URL` var (egress); internal = `postgres.railway.internal:5432`. **Get the password from the Railway dashboard — not stored in git.** |
| VPS | `161.97.166.69`, `root@vmi3328433` (THIS box). Other sites here are unrelated — leave them. |
| Repo | `/root/caesar` (this box). Deployed API branch: `chore/railway-deploy`. main: `c206aa0`. |
| Local dev env | `/root/caesar/.env` (has `VITE_PRIVY_APP_ID`, gates, Polymarket builder creds, `CAESAR_CREDS_ENC_KEY`, etc.). Not committed. |
| Build (web) | `VITE_GRAPHQL_HTTP_URL=https://api.trycaesar.xyz/graphql pnpm --filter @caesar/web build` → `apps/web/dist` |
| Migrate DB | `DATABASE_URL=<railway> pnpm --filter @caesar/db db:migrate` (already applied) |
| Ingest | `DATABASE_URL=<railway> pnpm --filter @caesar/ingest ingest:once` (crashes ~573 — needs fix) |

**Memory files (auto-loaded):** [[production-deployment]] (deploy topology + gotchas — start here), [[project-stage]], [[caesar-dev-servers]], [[privy-config]], [[deposit-wallet-required]] (trade architecture), [[kalshi-auth-skipped]], [[clob-geoblock-architecture]]. Prior handoffs: `docs/PHASE6-HANDOFF.md` (trade UX productionization), PHASE5/3.

---

## Suggested first moves for the fresh session

1. Open `https://app.trycaesar.xyz` in a browser; click around; list the UI bugs you see.
2. Confirm Privy login works (or fix the allowed-origin).
3. Fix the **ingester** so the markets browser is full (573 → ~4,700 + Kalshi) — most of the "app feels empty/broken" impressions trace back to thin data.
4. Then iterate on UI/polish with the edit→build→copy loop above.
