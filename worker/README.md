# WeCertify Background Mail Worker

Private Heroku `worker` process that dequeues background certificate mailing jobs from Neon Postgres, renders high-resolution PNG and PDF certificates from locked event designs using Skia (`@napi-rs/canvas`), exchanges ephemeral PKCE OAuth codes in memory, and sends directly through the issuer's Gmail account.

---

## 1. Local Development Setup

```bash
# 1. Install root & worker dependencies
npm ci
npm ci --prefix worker

# 2. Configure worker environment (never commit worker/.env)
cp worker/.env.example worker/.env

# 3. Apply database migrations from repo root
npm run db:migrate

# 4. Run checks & start worker locally
cd worker
npm run lint
npm run build
npm test
node --env-file=.env dist/worker/src/index.js
```

---

## 2. Environment Variables & Secrets Matrix

Keep **Heroku worker**, **Vercel**, and **Google OAuth** secrets strictly scoped:

| Variable | Vercel | Heroku Worker | Purpose |
|---|:---:|:---:|---|
| `DATABASE_URL` | **Required** | — | App role connection (`neondb_owner` or pooled app role). |
| `WORKER_DATABASE_URL` | — | **Required** | Dedicated least-privilege `certify_worker` role (`worker/sql/create-worker-role.sql`). |
| `JWT_SECRET` | **Required** | **Never** | Cookie session signing/verification on Vercel. |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | Optional | **Never** | Only used by the legacy browser `google_credentials` store. |
| `WORKER_HANDOFF_KEY` | **Required** | **Required** | Shared 64-hex AES-256-GCM key binding `(handoffId, userId, batchId, kind)` on PKCE handoffs. |
| `ENABLE_BACKGROUND_MAIL_WORKER` | **Required (`true`)** | — | Explicit rollout gate activating background delivery UI & `/api/mail-batches`. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` | **Required** | **Required** | Google OAuth Web Client ID. |
| `GOOGLE_CLIENT_SECRET` | Existing app OAuth configuration | **Required** | The worker exchanges the background OAuth code. |
| `NEXT_PUBLIC_APP_URL` | **Required** | Optional | Public HTTPS origin (`https://wecertify.tech`) fallback for QR links. |
| `R2_PUBLIC_BASE_URL` | Required for R2 art | Required for R2 art | Exact asset origin for public template downloads. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Required for uploads | Optional | Use bucket-scoped, read-only credentials on the worker if it needs signed reads. |

Generate `WORKER_HANDOFF_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Google Cloud OAuth Client Configuration
Under **Google Cloud Console → APIs & Services → Credentials → Web client**, add the callback route to **Authorized redirect URIs**:
- Production: `https://wecertify.tech/api/mail-batches/oauth/callback`
- Local development: `http://localhost:3000/api/mail-batches/oauth/callback`

---

## 3. Provisioning the Least-Privilege Database Role (`certify_worker`)

After applying the Drizzle migrations, run `worker/sql/create-worker-role.sql` as the database owner using the direct connection. Set the new role’s password interactively before enabling its login.

```text
\password certify_worker
ALTER ROLE certify_worker LOGIN;
```

The role can read the locked designs and the recipient fields needed for delivery across issuers. It can update queue state, mail status, and rate-limit counters. It has no grants on account or OAuth credential tables.

Construct `WORKER_DATABASE_URL` using the Neon **pooled** hostname (`-pooler`) with `?sslmode=require`.

---

## 4. Heroku Deployment ($7 Basic Dyno, 512 MB RAM)

The Heroku app builds from the repo root so the worker can share `src/lib/*` and `src/db/schema.ts`, and the root `Procfile` launches the private worker process. Heroku’s Node buildpack uses the root `heroku-postbuild` script to install, compile, and prune the worker.

```bash
# Example one-time setup
heroku create wecertify-mail-worker
heroku buildpacks:set heroku/nodejs

# Configure required worker secrets
heroku config:set \
  WORKER_DATABASE_URL="postgresql://certify_worker:...@ep-xxx-pooler.../neondb?sslmode=require" \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  WORKER_HANDOFF_KEY="..." \
  NEXT_PUBLIC_APP_URL="https://wecertify.tech" \
  R2_ACCOUNT_ID="..." R2_BUCKET="wecertify" R2_PUBLIC_BASE_URL="https://assets.wecertify.tech" \
  R2_ACCESS_KEY_ID="..." R2_SECRET_ACCESS_KEY="..."

# After deployment, explicitly start the worker process
heroku ps:scale worker=1:Basic
```

Configure `R2_PUBLIC_BASE_URL` for public artwork and supply R2 access keys only when private, signed reads are needed. Deploy the worker with one delivery slot initially. Apply the schema and provision the role before starting the worker. Enable the Vercel feature flag after a test batch succeeds in staging.

### Isolated integration tests

Use a disposable PostgreSQL database on loopback with the Drizzle migrations applied and a local Neon HTTP-compatible endpoint for the app-side queries. Set `WORKER_TEST_DATABASE_URL` and `WORKER_TEST_DATABASE_HTTP_URL` to those fixtures. For role verification, apply the role script and set `WORKER_TEST_ROLE_DATABASE_URL` to the local worker login. Run `npm --prefix worker test` from the repository root. Without explicit fixture variables, the suite runs only the unit tests. OAuth and Gmail are simulated inside the integration suite.

---

## 5. Operations Runbook

### A. Batch shows `paused_auth` ("Paused — Gmail re-authorization needed")
- **Cause**: Short-lived Google access token (~1h) expired during a large batch, a Heroku dyno restarted/cycled cleanly via `SIGTERM`, the OAuth handoff expired (>180s) before claiming, or the issuer picked the wrong Google account in consent.
- **Action**: Open **Dashboard → Event → Email delivery → Re-authorize Gmail to resume** (or Studio Email tab) and sign in with the issuing email address. Completed items are never re-sent.

### B. Items show `unknown` ("unconfirmed" — worker crash or Gmail 5xx/timeout)
- **Cause**: The worker lost its response from `gmail.googleapis.com` *after* submission started, or crashed while an item was in `sending` state. WeCertify refuses to auto-retry these to prevent duplicate certificates.
- **Action**: Check **Gmail Sent** for that recipient & subject, then open **Dashboard → Event → Email delivery → Review uncertain sends** and click **Found in Sent** (marks accepted) or **Allow send** (returns to pending).

### C. Memory warnings (`rssMb >= 420`) or Heroku `R14`
- **Action**: Start with `WORKER_SEND_CONCURRENCY=1` and measure Linux dyno memory before increasing it. Background rendering caps the original at 16 megapixels and decoded image overlays at 8 megapixels combined. If both attachments exceed 24 MiB, choose PDF only. Larger templates are still available through the regular send flow.

Local benchmarks use one delivery slot and a mock Gmail endpoint. Four sequential PDF sends from a textured 14.63 MiB, 4000×4000 JPEG peaked at 398 MiB of process RSS, compared with 554 MiB before the rendering and upload changes. A 16-recipient run peaked at 436 MiB, including a separate run with an 8-megapixel overlay. Measure representative templates on the Linux dyno before increasing throughput.

### D. Stalled worker (`status = 'running'` with dead dyno)
- Leases expire automatically after `WORKER_LEASE_SECONDS` (`90s`). As soon as a healthy worker dyno starts polling, `recoverAbandonedWork` safely resets `rendering` items to `queued`, marks any in-flight `sending` items `unknown`, and flips the batch to `paused_auth`.
