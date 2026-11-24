# Certify v2 handover

Use the access, Gmail, and canvas notes below when testing a release.

## 0. Iron rules (from AGENTS.md + user instruction)

- **NEVER `git push` without the user's explicit approval in that conversation.** Remote is `personal` (`git push personal main`). Local commits are fine and encouraged.
- Before proposing a push, run the gauntlet: `npm run lint`, `npm test`, `npm run build`, and `node scripts/e2e-smoke.mjs <port>` against a locally booted production server (`PORT=3005 npm run start`).
- This is a modified Next.js 16 — read `node_modules/next/dist/docs/` before Next-specific work. Classic `dynamic='force-dynamic'` is GONE; use `await connection()` from `next/server` in server page components. Middleware is `src/proxy.ts`.
- **Every new server-rendered page MUST use the `connection()` wrapper pattern** (see `src/app/*/page.tsx` + `*Client.tsx` split) — a bare client-component page prerenders statically and the nonce CSP blocks its inline scripts → silent white-screen. This bit /login and /admin; the e2e suite now sweeps all 7 pages for it.
- UI rules in AGENTS.md: no cards/pills; editorial layouts with hairline rules.

## 1. Earlier release fixes

The browser release pass for commit `00a1f1f` covered the Admin Overview and Access tabs, including access grants and revocations. It found three bugs.
1. `/admin` prerendered statically → nonce CSP blocked its scripts (fixed via `connection()` wrapper + e2e nonce sweep for all 7 pages).
2. **Session poisoning**: a stale legacy bearer token in localStorage masked a valid cookie (header took unconditional precedence) and the 401→logout loop bumped `sessions_valid_after`, killing fresh cookie sessions. `getSessionFromRequest` now falls through to the cookie when the bearer fails.
3. `/api/admin/accounts` returned snake_case SQL keys; mapped to the camelCase client contract.

Migrations applied to the live Neon DB: `0003_event_features`, `0004_template_versions`, `0005_drafts_and_access` (idempotent npm scripts; intentionally NOT in the drizzle journal — the project uses push + these scripts by design; `db:stamp` history explains).

## 2. Deferred delivery changes

Email batches run in the open Studio tab and dispatch through the authenticated Gmail send endpoint. Closing the tab stops the remaining queue. A durable server queue, domain-based sending, and organization-level access are deferred.

## 3. Architecture quick-map (things that will bite you if unknown)

- **Auth**: HttpOnly `certify_session` cookie (7d / browser-session) + legacy Bearer fallback (invalid bearer falls through to cookie — do not regress); **every mutating route requires `X-Certify-Request: 1`** (CSRF guard in `src/lib/server-auth.ts`). Logout bumps `users.sessions_valid_after`. `src/lib/env.ts` is the zod env contract — no raw `process.env` server-side.
- **Platform access**: `platform_access` table (user/admin/super_admin); sign-in gate in `src/app/api/auth/google/route.ts`; admin guard in `src/app/api/admin/_guard.ts`; analytics are AGGREGATES ONLY (no recipient PII).
- **Registration**: `src/lib/registration-service.ts` — unique `(user_id, record_fingerprint)` + `ON CONFLICT DO NOTHING`; identity = event+email+name deterministic; legacy fingerprints adopted on reuse; ambiguous email-less duplicate names → 400. Events are real rows (`events`); every batch writes a `registration_batches` audit row.
- **CSP**: per-request nonce in `src/proxy.ts` (no `unsafe-inline` scripts); pages are `connection()`-wrapped server components + `*Client.tsx`.
- **Render paths**: `canvas-renderer.ts` (editor), `certificate-engine.ts` (main thread), `certificate-worker.ts` (pool), `CertificatePreview.tsx` (verify page). TextBox uses **w/h** (a width/height seed bug was fixed — don't regress). Static text = `kind:'static'` + `staticText`; decorative bitmaps = `layoutConfig.images`.
- **Rate limits**: trusted-XFF-tail IP limiter (`TRUSTED_PROXY_COUNT`, default 1) + per-user buckets on register/templates/save/send.
- **Logging**: `src/lib/logger.ts` JSON lines with `x-request-id` from proxy.
- e2e (`scripts/e2e-smoke.mjs <port>`) mints its own JWT from `.env` values — never prints secrets. Covers: registration race/idempotency, cookie+CSRF matrix, asset endpoint, event settings (trackScans/expiry), admin (403→200→grant/revoke→403), nonce sweep for all 7 pages.
- A production server may be left running on port 3005 — kill via `lsof -nP -iTCP:3005 -sTCP:LISTEN -t` before rebuilding.

## Gmail sender and access policy

- Set `ADMIN_EMAIL` to the sole super admin address and grant other accounts from **Admin → Access**. Existing access entries are retained, including entries grandfathered by the original 0005 migration. Review those entries before onboarding real users. The current 0005 migration no longer restores revoked accounts when rerun.
- Set `GMAIL_TOKEN_ENCRYPTION_KEY` to a unique 32-byte key encoded as 64 hex characters and share it across application instances through the secret manager. Keep `NEXT_PUBLIC_APP_URL` set to the exact public HTTPS origin, and register that origin in the Google OAuth client. The production Google project needs Gmail API access and a consent screen that permits the intended users to grant `gmail.send`.
- Before deploying, apply `npm run db:mail-policy` after the earlier migrations. This widens the Gmail token expiry column, removes credentials saved under the old sender policy, and adds quota fields. Each sender needs to authorize Gmail again in Studio with their sign-in email.
- Apply `npm run db:issued-designs` after the mail-policy migration. Issued events use an immutable design and a public field snapshot per recipient. Older verification links retain their status and metadata. The issuer can restore downloads by reviewing and confirming the original design from the event dashboard.
- Apply `npm run db:issuance-access` before deploying the issuance permission changes. Existing and new accounts, including the configured superadmin, start with issuance disabled. Grant issuance explicitly in Access management for each approved issuer.

- The super admin can adjust the rolling per-account limits under **Admin → Access**. Defaults are 55 sends per minute and 8 per second. Match per-account settings to your Gmail project and mailbox quotas. Gmail can also impose daily, concurrency, and project-wide limits. Certify pauses for its own rate limit and stops starting sends when Gmail reports a quota limit.
- Delivery still runs from the open Studio tab. If a Gmail request timed out, check Gmail Sent before retrying. Confirm the live OAuth consent, reconnect, and test delivery in staging before deploying to production.

## Canvas rendering and regression checks

- Layouts save coordinates and font sizes in native template pixels. New text starts at 6% of the shorter template edge. Fit may enlarge small artwork and pointer targets, snapping, and drag thresholds use screen pixels. Saved font sizes are reused when opening a design.
- The canvas editor, the main-thread renderer, and the export worker share text fitting in `src/lib/certificate-text.ts`. Editor font loads invalidate cached measurements. The preview buffer has an eight-million-pixel budget and a 4,096-pixel edge limit. Exports use the template's native resolution.
- The export pool budgets workers by CPU and decoded image size. Each worker uses one drawing buffer for large artwork. If a worker stalls or crashes, outstanding rows fail with a reason so they can be retried. Email workers share in-flight render chunks and accounts are still rate-limited by the send endpoint.
- Run `npm test` for text fit, viewport allocation, and concurrent mail rendering regression coverage. Run `node scripts/e2e-smoke.mjs <port>` against a local production build configured with a disposable database. The suite writes test records and checks account isolation, immutable issued data, and the public field snapshot.
- For a browser release check, compare 400 × 300, 1,200 × 900, and 4,000 × 3,000 artwork at Fit. Resize a text area and undo and redo the change. Issue a batch with QR codes, inspect the PNG, JPEG, and PDF ZIP, and check a certificate link in a signed-out window. Confirm the Issued By label and public download. Use a simulated Gmail API when stress-testing email batches and a staging mailbox when verifying Google consent and delivery.
