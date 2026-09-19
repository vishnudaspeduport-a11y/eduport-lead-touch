# Eduport · Lead Touch & Conversion Analytics

Replaces the Tableau workbook **"Lead Touch Combined"** with a drillable web app: every KPI goes down to the individual lead, its touch timeline, ICs, payments and calls.

```
sql/     Postgres: roles, Salesforce replica DDL, normalisation functions, views, materialized views, indexes, data-quality views, reconciliation
sync/    Salesforce -> Postgres incremental replication (Node, REST API, SystemModstamp watermarks) + MV refresh
api/     Cloudflare Worker (Hono + postgres.js over Hyperdrive) - /api/* + serves the built frontend, Cron Trigger for MV refresh
web/     React + Vite + TypeScript + Tailwind + Recharts + TanStack Query/Table
```

> **Read this first (state on 2026-09-19).** The Salesforce objects (`Lead_Master__c`, `Lead_Touch__c`,
> `Interested_Course__c`, `Task`) are **not in Postgres yet** - the production DB only has the app tables
> `home_customuser` / `home_payment`. Everything in `sql/` assumes a `salesforce.*` replica schema that
> `sync/` fills. Run the sync (step 3 below) before anything else will return rows. The field names,
> types and value distributions in this repo were verified directly against Salesforce (SOQL) and
> against Postgres (`home_*`), so the DDL matches what will land.

---

## 1. Architecture

```
Salesforce ──(sync/ every 15-30 min, REST queryAll, SystemModstamp)──▶ salesforce.* tables ─┐
                                                                                            ├─▶ analytics.v_* views ─▶ analytics.mv_* (refreshed by sync + Cron) ─▶ Worker /api ─▶ React
public.home_customuser / home_payment (app DB) ─────────────────────────────────────────────┘
```

* **Authority order**: `Lead_Master__c` is the grain for anything per lead. `Lead_Touch__c` is only joined for touch/attribution questions. Leads are never counted from touches.
* **All aggregation in Postgres.** The Worker only ships aggregates, plus paginated rows in the explorer / export (capped).
* **One filter parser** (`api/src/filters.ts`): zod-validated, dimension allowlist, every value a bound parameter.
* **Read-only role** (`lt_app_ro`) for the Worker; `default_transaction_read_only=on`, 20 s statement timeout.
* **Auth**: Cloudflare Access in front of the Worker; the Worker verifies the Access JWT (JWKS) on every `/api/*` call. Admin e-mails see raw phone/e-mail; viewers get masked values. No PII leaves the API except in the explorer / lead drawer / CSV export.

## 1b. Hosting decision: Supabase (database) + Cloudflare (Worker + frontend) + GitHub (code + scheduled sync)

```
GitHub Actions (sync.yml, every 30 min) ──▶ Supabase Postgres  ◀── Hyperdrive ◀── Cloudflare Worker (API + React) ◀── Cloudflare Access (login)
   reads Salesforce (REST) and the                salesforce.* / app.* / analytics.*
   production Postgres (home_customuser, home_payment)
GitHub Actions (deploy.yml, on push to main) ──▶ wrangler deploy
```

Do these once, in this order. Every step is either a UI click or a paste; nothing needs a local Postgres.

**A. Supabase - create the analytics database**
1. Dashboard -> your org -> **New project**. Name `eduport-lead-touch`, region **Mumbai (ap-south-1)** (closest to your users and to the production DB), generate a strong DB password and keep it.
   Plan: the replica of all 1.4M leads plus MVs needs more than the free tier's 500 MB - use **Pro** (8 GB), or keep the free tier and leave `LEAD_SINCE=2025-04-01` (leads from FY 2025-26 onward, roughly a quarter of the data).
2. **SQL Editor -> New query**. Paste and run, in order: `sql/001_schema_roles.sql` (change the two `CHANGE_ME_*` passwords first), `002`, `003`, `004`, `006`, then `005`. Each file is one paste; they are all safe in the editor (no psql meta-commands).
3. **Project Settings -> Database -> Connection string -> Session pooler** (port 5432, IPv4). Copy it twice and replace the user:
   * owner string for the sync: `postgres://lt_analytics_owner.PROJECT_REF:<owner pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`
   * read-only string for Hyperdrive: same with `lt_app_ro.PROJECT_REF:<ro pw>`
4. Sanity check in the SQL editor: `SELECT * FROM analytics.class_group_selftest() WHERE NOT ok;` must return 0 rows.

**B. GitHub - push the code and add secrets**
1. Create an empty repo under your account (for example `vishnudaspeduport-a11y/eduport-lead-touch`), then from this folder:
   ```bash
   git init -b main && git add -A && git commit -m "Lead Touch analytics: SQL, sync, Worker API, React app" && git remote add origin https://github.com/vishnudaspeduport-a11y/eduport-lead-touch.git && git push -u origin main
   ```
2. Repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**, add:
   `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL` (`https://login.salesforce.com`), `DATABASE_URL` (owner string from A3), `SOURCE_DATABASE_URL` (production Postgres, the read-only `eduport_ro` user is enough), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (`ee558dc2a8ca2f421731d9b046ae5731`).
3. **Actions -> sync -> Run workflow**, tick **full**. This is the initial load (Salesforce objects, then the two app tables, then `refresh_all()`); expect 30-90 minutes. Afterwards it runs every 30 minutes on its own.
4. Salesforce side (needed for step B3): Setup -> App Manager -> **New Connected App** -> enable OAuth, scope `api`, tick **Enable Client Credentials Flow**, save, then **Manage -> Edit Policies -> Client Credentials Flow -> Run As** = an integration user with read access to `Lead_Master__c`, `Lead_Touch__c`, `Interested_Course__c`, `Task`, `User`, `Course__c`. Consumer key/secret = `SF_CLIENT_ID` / `SF_CLIENT_SECRET`.

**C. Cloudflare - Hyperdrive, Access, deploy**
1. Dashboard -> **Workers & Pages -> Hyperdrive -> Create**: name `eduport-lead-touch-ro`, paste the read-only Supabase Session-pooler string from A3. Copy the Hyperdrive **ID** into `api/wrangler.toml` (`[[hyperdrive]] id`).
2. **Zero Trust -> Access -> Applications -> Add -> Self-hosted**: name `Lead Touch`, domain = the Worker's URL (`eduport-lead-touch.<your-subdomain>.workers.dev`, or a custom domain later). Policy *Allow*: **Emails ending in** `@eduport.ai`. Identity: One-time PIN (and Google if you like). After saving, open the application's **Overview** and copy the **Application Audience (AUD) tag** into `api/wrangler.toml` -> `ACCESS_AUD`; put `https://<your-team>.cloudflareaccess.com` into `ACCESS_TEAM_DOMAIN`.
3. API token for GitHub: **My Profile -> API Tokens -> Create Token -> "Edit Cloudflare Workers"** template, add the permission **Account -> Hyperdrive -> Read**. Store as `CLOUDFLARE_API_TOKEN` (B2).
4. Commit the two `wrangler.toml` edits and push. `deploy.yml` builds the React app and deploys the Worker with the static assets. First deploy: check **Workers & Pages -> eduport-lead-touch -> Settings -> Triggers** shows the cron `15 */2 * * *`, and open the URL; Access will ask for your e-mail PIN.
5. Verify: `https://<worker-url>/api/health` returns `{"ok":true}`; the header chip shows "Data as of" with a timestamp; the Overview KPIs are non-zero.

**D. Sign-off**: run `sql/900_reconciliation.sql` with psql against the owner string (`psql "$DATABASE_URL" -f sql/900_reconciliation.sql`) and compare with the Tableau workbook.

## 2. Environment variables & secrets

| Where | Name | Purpose |
|---|---|---|
| DB (you run psql) | `ADMIN_DATABASE_URL` | superuser / owner for `sql/001` (roles + schemas) |
| DB | `OWNER_DATABASE_URL` | `lt_analytics_owner` for `sql/002-006`, `sync/` |
| DB | `RO_DATABASE_URL` | `lt_app_ro` for reconciliation / EXPLAIN |
| `sync/.env` | `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET` | Salesforce connected app (client-credentials flow) |
| `sync/.env` | `DATABASE_URL` | = `OWNER_DATABASE_URL` |
| `sync/.env` | `TASK_SINCE`, `REFRESH_AFTER_SYNC`, `SYNC_OBJECTS` | optional |
| Cloudflare | Hyperdrive config | holds the `lt_app_ro` connection string (never in the repo) |
| `api/wrangler.toml [vars]` | `AUTH_MODE`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAIN`, `APP_VERSION`, `EXPORT_ROW_CAP` | non-secret config |
| `api/.dev.vars` | `AUTH_MODE=dev`, `DEV_USER_EMAIL`, `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | local dev only |

Passwords for the two roles are set in `sql/001_schema_roles.sql` (`CHANGE_ME_*`) - change them before running, or `ALTER ROLE ... PASSWORD` afterwards.

## 3. Setup, step by step

### 3.1 Database (once)

```bash
# roles + schemas + Salesforce replica tables (as superuser)
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_schema_roles.sql

# functions, views, MVs (empty until the sync has run), data-quality views (as lt_analytics_owner)
psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_functions.sql -f sql/003_views.sql -f sql/004_matviews.sql -f sql/006_data_quality.sql

# indexes (CONCURRENTLY - autocommit, not inside a transaction)
psql "$OWNER_DATABASE_URL" -f sql/005_indexes.sql
```

`sql/004` ends with `SELECT * FROM analytics.refresh_all();` - on an empty replica that just creates empty MVs, which is fine.

Check the class mapping: `SELECT * FROM analytics.class_group_selftest() WHERE NOT ok;` must return 0 rows (it was verified against Postgres 16 on 2026-09-19 - all 28 cases pass).

### 3.2 Salesforce connected app

Setup → App Manager → New Connected App → enable OAuth, scopes `api` + `refresh_token`, **enable Client Credentials Flow** and pick a run-as integration user with read access to `Lead_Master__c`, `Lead_Touch__c`, `Interested_Course__c`, `Task`, `User`, `Course__c`. Copy consumer key/secret into `sync/.env`.

### 3.3 First replication + refresh

```bash
cd sync && cp .env.example .env   # fill it in
npm install
npm run sync:full                  # ~1.4M leads, 81k touches, ICs, Tasks since TASK_SINCE, Users, Courses; then refresh_all()
```

Expect the full load to take a while (REST pages of 2 000; roughly 700 pages for leads). Subsequent runs are incremental:

```bash
npm run sync            # cron this every 15-30 minutes (systemd timer / GitHub Actions / any box with Node 20+)
npm run refresh         # only refresh the MVs
```

Cron example (every 20 min):
```
*/20 * * * * cd /opt/eduport-lead-touch/sync && /usr/bin/npm run sync >> /var/log/lead-touch-sync.log 2>&1
```

### 3.4 Hyperdrive + Worker

```bash
cd api && npm install
npx wrangler login
npx wrangler hyperdrive create eduport-lead-touch-ro \
  --connection-string "postgres://lt_app_ro:PASSWORD@HOST:5432/DBNAME?sslmode=require"
# paste the returned id into wrangler.toml [[hyperdrive]] id
```

If Postgres is behind a firewall, allow Cloudflare's egress IPs or use a Cloudflare Tunnel (`hyperdrive create ... --access-client-id/--access-client-secret`).

### 3.5 Cloudflare Access (login)

Zero Trust → Access → Applications → **Self-hosted** → domain = the Worker's custom domain (e.g. `leads.eduport.ai`).
Policy: *Allow* → Emails ending in `@eduport.ai` (add One-time PIN and/or Google as login methods).
Copy the **Application Audience (AUD) tag** into `wrangler.toml` → `ACCESS_AUD`, and your team domain (`https://<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. Put admin e-mails (unmasked PII) in `ADMIN_EMAILS`.

### 3.6 Deploy

```bash
cd web && npm install && npm run build     # -> web/dist
cd ../api && npx wrangler deploy           # uploads Worker + web/dist as static assets
npx wrangler deployments list
```

Then map the custom domain (Workers → Settings → Domains & Routes) and make sure the Access application covers it. The Cron Trigger (`15 */2 * * *`) is created automatically on deploy.

## 4. Local development against Postgres

```bash
# terminal 1 - API
cd api && cp .dev.vars.example .dev.vars   # AUTH_MODE=dev, local Postgres connection string
npm run dev                                 # http://127.0.0.1:8787/api/health

# terminal 2 - web (proxies /api to 8787)
cd web && npm run dev                       # http://localhost:5173
```

`AUTH_MODE=dev` trusts `DEV_USER_EMAIL`; never deploy with it. Useful checks:

```bash
curl -s "http://127.0.0.1:8787/api/kpis?from=2026-03-01&to=2026-08-31" | jq .data.current
curl -s "http://127.0.0.1:8787/api/breakdown?dim=touch_point&from=2026-03-01&to=2026-08-31" | jq '.data.rows[:5]'
```

## 5. API

All endpoints accept the shared filter params: `from`, `to` (YYYY-MM-DD, IST), `basis=created|touch|payment`, `compare=none|previous`,
`converted=1`, `dups=1`, `paid=paid|organic`, `paid_touch=…`, boolean flags `hot|supreme_hot|relogged|repeat|pre_existing=1|0`,
and comma-separated lists for every dimension key (`lead_source=Fb Ad,Website&touch_point=Meta Ad&owner=…`, `(null)` selects NULL).

| Endpoint | Returns |
|---|---|
| `GET /api/meta` | user/role, data-as-of, sync state, dimension catalogue, KPI definitions (+SQL) |
| `GET /api/filters?dim=&q=` | cascading options with counts (dim itself excluded from the filter) |
| `GET /api/kpis` | all KPI-row numbers for current (+previous) period incl. touch-bucket distribution |
| `GET /api/trend?grain=day\|week\|month` | leads / converted / touches / revenue per period (+previous), uses `mv_daily_lead_stats` when possible |
| `GET /api/breakdown?dim=&dim2=&limit=&sort=` | grouped metrics (lead grain or touch grain) + total, with previous-period values |
| `GET /api/attribution?dim=` | first / last / linear / position credit + revenue, diff vs last-touch, unattributed bucket |
| `GET /api/touch-curve?by=` | conversion by touch count, marginal lift, optimal touch count per group |
| `GET /api/touch-gaps`, `/api/touch-heatmap`, `/api/touch-transitions`, `/api/stale-leads?days=` | touch analysis |
| `GET /api/funnel` | stage distribution, IC funnel, discount leakage, IC-count curve, reasons, time-in-stage |
| `GET /api/cohorts?grain=` | cohort triangle (7/14/30/60/90), days-to-convert histogram, week-1 share |
| `GET /api/team` | per owner + per touch staff |
| `GET /api/movers` | biggest conversion-rate movers vs previous period |
| `GET /api/leads`, `/api/leads/:id`, `/api/leads/export.csv` | explorer (paginated, sorted, searchable, masked for viewers), drawer, streamed CSV (cap `EXPORT_ROW_CAP`) |
| `GET /api/data-quality`, `/api/data-quality/:check` | counts + rows for each check |
| `POST /api/admin/refresh` | admin-only manual `refresh_all()` |

Responses are `{ data, meta: { period, previous, basis, tookMs } }`; errors are `{ error: { code, message } }`.

## 6. Definitions (ported from the workbook) and deviations

* **Valid payment**: `payment_method = 0 AND deleted = false AND is_success AND payment_success AND home_customuser.is_deleted = false` → `analytics.v_valid_payment`.
* **Converted lead**: ≥ 1 valid payment matched on `analytics.phone_key()` (last 10 digits). `converted_at` = earliest valid `payment_date`.
* **Attributable touch**: `ist_date(Touch_Date__c) <= converted_at` (`mv_touch_base.is_pre_conversion`). Post-payment touches are shown in timelines but never credited.
* **Total leads** = `count(*)` from `mv_lead_base` in the window; **total touches** = `count(*)` from `mv_touch_base`.
* **Touches to convert** = `valid_touches` of converted leads (avg / median / p90 / buckets 0,1..5,6+).
* **First/last touch conversions** = converted leads with ≥ 1 attributable touch; the credit lands on that touch's touch point / source / medium / campaign.
* **Class group** = `analytics.class_group(Class__c)` - one function, fix it in `sql/002`.
* `Is_Deleted__c` / `IsDeleted` rows are excluded everywhere; duplicates excluded unless the toggle is on.

**Deliberate deviations / interpretations (flagged, see also `sql/900_reconciliation.sql`):**

1. `touch_date <= payment_date` is compared at **IST calendar-day** granularity (`payment_date` is a DATE). Same-day touches count as pre-conversion.
2. Class group adds **`Plus Two Completed`** (largest raw bucket, ~400k leads) and **`Unknown`** (NULL / "Not updated") instead of folding both into `Other`.
3. **Total touches** on the default basis = touches of leads *created* in the window. The touch-date basis (toggle) counts by `Touch_Date__c`. Reconciliation prints both.
4. Conversion **includes pre-existing customers** (payment before lead creation) exactly like the workbook; the UI flags them and offers a filter.
5. Paid/organic, response time, contact rate, cohorts, stale leads, movers, time-in-stage (approximation: stage history is not replicated) are **app additions** with no Tableau counterpart.
6. Time zone: all calendar dates are IST (`Asia/Kolkata`); Salesforce timestamps are UTC.

## 7. Reconciliation (2026-03-01 → 2026-08-31, no filters)

Run `psql "$RO_DATABASE_URL" -f sql/900_reconciliation.sql` after the first sync + refresh; every block prints the number and is the exact SQL the API uses.

Reference numbers gathered **directly from the sources on 2026-09-19** (SOQL against Salesforce, SQL against the production Postgres) so you can sanity-check the replica:

| Measure (Mar–Aug 2026) | Source | Value |
|---|---|---|
| Leads created, `Is_Deleted__c=false AND Is_Duplicate__c=false` | Salesforce | 250,233 |
| Leads created incl. duplicates | Salesforce | 256,594 (251,481 distinct phones) |
| Leads with Salesforce `Is_Converted__c = true` | Salesforce | 17,153 |
| Touches by `Touch_Date__c` in window, `IsDeleted=false` | Salesforce | 52,214 (first touch record: 2026-03-03) |
| Touches flagged `Is_Converted__c` (SF flag) | Salesforce | 375 |
| Touches with `Is_First_Touch__c AND Is_Converted__c` (SF flags) | Salesforce | 342 |
| Touches with `Is_Last_Touch__c AND Is_Converted__c` (SF flags) | Salesforce | 268 |
| Valid payments by `payment_date` in window | Postgres | 42,757 payments · 42,237 users · ₹14.40 Cr |

The payment-based converted count will differ from Salesforce's `Is_Converted__c` (17,153) - that gap is reported per lead in the Data-quality check "Is_Converted__c disagrees with payment definition".

## 8. Performance

* API reads only MVs. Expected default 30-day view: KPI query on ~40k rows via `mv_lead_base_created` index → well under 200 ms; attribution / curve scan ~10k touches. `sql/910_explain.sql` prints `EXPLAIN (ANALYZE, BUFFERS)` for the six heaviest statements - run it after the first refresh and paste the output into the sign-off.
* MV refresh (`analytics.refresh_all()`): the phone-key join between 1.4M leads and 754k users is the expensive part; both sides have expression indexes (`lead_master_phone_key`, `home_customuser_phone_key`). Refresh is `CONCURRENTLY` after the first run, so the API never blocks.
* The Worker's Cron Trigger also calls `refresh_all()` (read-write transaction with a 25 min statement timeout); prefer the sync-driven refresh and keep the cron as a safety net.

## 9. Adding a new chart

1. **SQL**: if the metric needs a new column, add it to the view in `sql/003_views.sql` (it flows into the MV automatically) and re-run 003 + 004.
2. **API**: add a route in `api/src/routes/` using `handle()` and `leadWhere()` / `touchWhere()` so it honours every global filter; add a `Definition` in `api/src/definitions.ts` if it becomes a KPI card.
3. **Types**: mirror the response in `web/src/lib/types.ts`.
4. **UI**: wrap the chart in `<ChartCard>` (gives you help "?", table toggle, PNG/CSV, empty/error/skeleton states) and use the primitives in `web/src/charts/index.tsx` (`HBars`, `VBars`, `Lines`, `Heatmap`, `QuadrantScatter`, `TrendChart`). For a plain "by dimension" bar chart, `<BreakdownCard dim="…" />` is enough - it already cross-filters.
5. Cross-filter by calling `toggleValue(dim, value)` from `useFilters()`; the dim must exist in `LEAD_DIMS` / `TOUCH_DIMS` (`api/src/filters.ts`) and `LIST_DIMS` (`web/src/lib/filters.ts`).

## 10. Security notes

* The browser never sees Postgres; credentials live only in Hyperdrive and `sync/.env`.
* Every `/api/*` request must carry a valid Cloudflare Access JWT for the configured audience; e-mail domain is re-checked in the Worker.
* PII masking is role-based server side; CSV export is masked for viewers too.
* Dimension names come from allowlists; `sql.unsafe` is used only for the fixed ORDER BY strings in `dq.ts` and the column list in the sync upsert - both from code constants.
