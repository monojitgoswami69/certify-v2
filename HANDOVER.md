# HANDOVER — Certify v2 (updated 2026-10-27, commit `00a1f1f`)

For the next agent/session picking this up. Everything below is current as of commit `00a1f1f` on `main` (local; NOT pushed).

## 0. Iron rules (from AGENTS.md + user instruction)

- **NEVER `git push` without the user's explicit approval in that conversation.** Remote is `personal` (`git push personal main`). Local commits are fine and encouraged.
- Before proposing a push, run the gauntlet: `npm run lint`, `npm test`, `npm run build`, and `node scripts/e2e-smoke.mjs <port>` against a locally booted production server (`PORT=3005 npm run start`).
- This is a modified Next.js 16 — read `node_modules/next/dist/docs/` before Next-specific work. Classic `dynamic='force-dynamic'` is GONE; use `await connection()` from `next/server` in server page components. Middleware is `src/proxy.ts`.
- **Every new server-rendered page MUST use the `connection()` wrapper pattern** (see `src/app/*/page.tsx` + `*Client.tsx` split) — a bare client-component page prerenders statically and the nonce CSP blocks its inline scripts → silent white-screen. This bit /login and /admin; the e2e suite now sweeps all 7 pages for it.
- UI rules in AGENTS.md: no cards/pills; editorial layouts with hairline rules.
- Unpushed commits: `3651a56`, `5af7a6a`, `831a0b7`, `aaf6af6`, `90e6252`, `00a1f1f`, `2d0fb9d`.

## 1. Current state (all verified)

Everything from the user's feature wishlist is **implemented, typechecked, built, and e2e-verified (52/52)**, and the Admin console browser pass is **complete** (Overview + Access tabs render; allowlist grant/revoke exercised through the UI). Three bugs were found and fixed by that pass (commit `00a1f1f`):
1. `/admin` prerendered statically → nonce CSP blocked its scripts (fixed via `connection()` wrapper + e2e nonce sweep for all 7 pages).
2. **Session poisoning**: a stale legacy bearer token in localStorage masked a valid cookie (header took unconditional precedence) and the 401→logout loop bumped `sessions_valid_after`, killing fresh cookie sessions. `getSessionFromRequest` now falls through to the cookie when the bearer fails.
3. `/api/admin/accounts` returned snake_case SQL keys; mapped to the camelCase client contract.

Migrations applied to the live Neon DB: `0003_event_features`, `0004_template_versions`, `0005_drafts_and_access` (idempotent npm scripts; intentionally NOT in the drizzle journal — the project uses push + these scripts by design; `db:stamp` history explains).

Demo data left in the dev DB for user review: account `verify-demo@certify.test` (**super_admin** in `platform_access`), template "Sample Data", event "AI & Society Hackathon 2026" with 2 certificates. `/tmp/certify-demo-token.txt` holds a 1-day session token (re-mint pattern: sign `{userId, email, role:'user', name}` with JWT_SECRET, HS256). Offer cleanup when the user is done.

## 2. Remaining work (user-approved backlog)

1. **Email queue (server-side sending)** — user approved; architecture agreed: `email_jobs` + `email_job_items` tables, short tick invocations (relay-race model), browser becomes a tracking screen; on Vercel use **Inngest/QStash** as the tick source (Hobby cron is once/day), on a VPS an in-process `setInterval` worker. **Open decision the user must make before building**: server-side PDF rendering (new native dep) vs **client pre-render + upload with the job (recommended v1)**.
2. **Delivery provider choice** (SMTP/SendGrid/SES alongside Gmail) — user asked for the integration plan first; answer given (user brings credentials, stored server-side like `google_credentials`, MIME already built, per-provider pace, SPF/DKIM warning in UI). Awaiting go-ahead.
3. Deferred by choice: Playwright suite, zustand slice refactor, object storage for template images, admin TOTP 2FA, PII retention policy, dashboard virtualization/server-side CSV export.

## 3. Architecture quick-map (things that will bite you if unknown)

- **Auth**: HttpOnly `certify_session` cookie (7d / browser-session) + legacy Bearer fallback (invalid bearer falls through to cookie — do not regress); **every mutating route requires `X-Certify-Request: 1`** (CSRF guard in `src/lib/server-auth.ts`). Logout bumps `users.sessions_valid_after`. `src/lib/env.ts` is the zod env contract — no raw `process.env` server-side.
- **Platform access**: `platform_access` table (user/admin/super_admin); sign-in gate in `src/app/api/auth/google/route.ts`; admin guard in `src/app/api/admin/_guard.ts`; analytics are AGGREGATES ONLY (no recipient PII).
- **Registration**: `src/lib/registration-service.ts` — unique `(user_id, record_fingerprint)` + `ON CONFLICT DO NOTHING`; identity = event+email+name deterministic; legacy fingerprints adopted on reuse; ambiguous email-less duplicate names → 400. Events are real rows (`events`); every batch writes a `registration_batches` audit row.
- **CSP**: per-request nonce in `src/proxy.ts` (no `unsafe-inline` scripts); pages are `connection()`-wrapped server components + `*Client.tsx`.
- **Render paths** (keep all 4 in sync): `canvas-renderer.ts` (editor), `certificate-engine.ts` (main thread), `certificate-worker.ts` (pool), `CertificatePreview.tsx` (verify page). TextBox uses **w/h** (a width/height seed bug was fixed — don't regress). Static text = `kind:'static'` + `staticText`; decorative bitmaps = `layoutConfig.images`.
- **Rate limits**: trusted-XFF-tail IP limiter (`TRUSTED_PROXY_COUNT`, default 1) + per-user buckets on register/templates/save/send.
- **Logging**: `src/lib/logger.ts` JSON lines with `x-request-id` from proxy.
- e2e (`scripts/e2e-smoke.mjs <port>`) mints its own JWT from `.env` values — never prints secrets. Covers: registration race/idempotency, cookie+CSRF matrix, asset endpoint, event settings (trackScans/expiry), admin (403→200→grant/revoke→403), nonce sweep for all 7 pages.
- A production server may be left running on port 3005 — kill via `lsof -nP -iTCP:3005 -sTCP:LISTEN -t` before rebuilding.

## 4. Next-session opening moves

1. Read AGENTS.md + this file; `git log --oneline -10` to orient.
2. Ask the user the email-queue render-side decision (§2.1), then build the queue (migration → job tables → service → tick endpoint → UI polling).
3. Remember: no pushes without approval; the gauntlet before any push proposal.

## Gmail sender and access policy

- Set `ADMIN_EMAIL` to the sole super admin address and grant other accounts from **Admin → Access**. Existing access entries are retained, including entries grandfathered by the original 0005 migration. Review those entries before onboarding real users. The current 0005 migration no longer restores revoked accounts when rerun.
- Set `GMAIL_TOKEN_ENCRYPTION_KEY` to a unique 32-byte key encoded as 64 hex characters and share it across application instances through the secret manager. Keep `NEXT_PUBLIC_APP_URL` set to the exact public HTTPS origin, and register that origin in the Google OAuth client. The production Google project needs Gmail API access and a consent screen that permits the intended users to grant `gmail.send`.
- Before deploying, apply `npm run db:mail-policy` after the earlier migrations. This widens the Gmail token expiry column, removes credentials saved under the old sender policy, and adds quota fields. Each sender needs to authorize Gmail again in Studio with their sign-in email.
- Apply `npm run db:issued-designs` after the mail-policy migration. Issued events use an immutable design and a public field snapshot per recipient. Older verification links retain their status and metadata. The issuer can restore downloads by reviewing and confirming the original design from the event dashboard.
- Apply `npm run db:issuance-access` before deploying the issuance permission changes. Existing and new accounts, including the configured superadmin, start with issuance disabled. Grant issuance explicitly in Access management for each approved issuer.

- The super admin can adjust the rolling per-account limits under **Admin → Access**. Defaults are 55 sends per minute and 8 per second. Match per-account settings to your Gmail project and mailbox quotas. Gmail can also impose daily, concurrency, and project-wide limits. Certify pauses for its own rate limit and stops starting sends when Gmail reports a quota limit.
- Delivery still runs from the open Studio tab. If a Gmail request timed out, check Gmail Sent before retrying. Confirm the live OAuth consent, reconnect, and test delivery in staging before deploying to production.
