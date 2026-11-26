# WeCertify v2 handover

Use the access, Gmail, and canvas notes below when testing a release.

## 0. Iron rules (from AGENTS.md + user instruction)

- **NEVER `git push` without the user's explicit approval in that conversation.** Remote is `personal` (`git push personal main`). Local commits are fine and encouraged.
- Before proposing a push, run the gauntlet: `npm run lint`, `npm test`, `npm run build`, and `node scripts/e2e-smoke.mjs <port>` against a locally booted production server (`PORT=3005 npm run start`).
- This is a modified Next.js 16 — read `node_modules/next/dist/docs/` before Next-specific work. Classic `dynamic='force-dynamic'` is GONE; use `await connection()` from `next/server` in server page components. Middleware is `src/proxy.ts`.
- Pages matched by the nonce policy in `src/proxy.ts` must render per request. Use `connection()` when a matched route has no other dynamic server work. The homepage and legal pages can be served statically.
- UI rules in AGENTS.md: no cards/pills; editorial layouts with hairline rules.

## 1. Earlier release fixes

The browser release pass for commit `00a1f1f` covered the Admin Overview and Access tabs, including access grants and revocations. It found three bugs.
1. `/admin` prerendered statically → nonce CSP blocked its scripts (fixed via `connection()` wrapper + e2e nonce sweep for all 7 pages).
2. **Session poisoning**: a stale legacy bearer token in localStorage masked a valid cookie (header took unconditional precedence) and the 401→logout loop bumped `sessions_valid_after`, killing fresh cookie sessions. `getSessionFromRequest` now falls through to the cookie when the bearer fails.
3. `/api/admin/accounts` returned snake_case SQL keys; mapped to the camelCase client contract.

Schema changes use Drizzle Kit. Edit `src/db/schema.ts`, run `npm run db:generate -- --name=<change>`, review the SQL, and commit the migration together with its metadata. Before deploying code that needs the change, set `DATABASE_URL` to the intended database and run `npm run db:migrate`. This same command provisions a fresh database. The baseline includes the original hardening and events migrations. The numbered files after it are applied in journal order.

## 2. Issuance review and delivery

Studio and the dashboard CSV importer review the roster before issuing. CSV record numbers include the header and blank records, and quoted multiline values stay in a single record. Empty records and exact duplicates appear in Removed. Similar names or addresses stay visible for review. The fit check uses the shared canvas text layout and previews display a marked sample QR before issuance.

Email batches run in the browser and closing the tab stops the remaining queue. Open the issued event and select **Email delivery** to resume pending or failed sends using the frozen design and saved email preferences. Gmail acceptance is recorded separately from delivery to the recipient. Review unknown outcomes in Gmail Sent before recording an acceptance or making the recipient eligible to send again.

## 3. Architecture quick-map (things that will bite you if unknown)

- **Auth**: HttpOnly `certify_session` cookie (7d / browser-session) + legacy Bearer fallback (invalid bearer falls through to cookie — do not regress); **every mutating route requires `X-Certify-Request: 1`** (CSRF guard in `src/lib/server-auth.ts`). Logout bumps `users.sessions_valid_after`. `src/lib/env.ts` is the zod env contract — no raw `process.env` server-side.
- **Platform access**: `platform_access` table (user/admin/super_admin); sign-in gate in `src/app/api/auth/google/route.ts`; admin guard in `src/app/api/admin/_guard.ts`; analytics are AGGREGATES ONLY (no recipient PII).
- **Registration**: `src/lib/registration-service.ts` — unique `(user_id, record_fingerprint)` + `ON CONFLICT DO NOTHING`; identity = event+email+name deterministic; legacy fingerprints adopted on reuse; ambiguous email-less duplicate names → 400. Events are real rows (`events`); every batch writes a `registration_batches` audit row.
- **CSP**: sign-in, Studio, dashboard, admin, and verification use a per-request script nonce. The static homepage allows its first-party redirect script. The static legal pages allow Next.js inline scripts.
- **Render paths**: `canvas-renderer.ts` (editor), `certificate-engine.ts` (main thread), `certificate-worker.ts` (pool), `CertificatePreview.tsx` (verify page). TextBox uses **w/h** (a width/height seed bug was fixed — don't regress). Static text = `kind:'static'` + `staticText`; decorative bitmaps = `layoutConfig.images`.
- **Rate limits**: trusted-XFF-tail IP limiter (`TRUSTED_PROXY_COUNT`, default 1) + per-user buckets on register/templates/save/send.
- **Logging**: `src/lib/logger.ts` JSON lines with `x-request-id` from proxy.
- The end-to-end suite uses the local server’s test credentials and writes throwaway test records. Point both the server and suite at a disposable database and an isolated R2 bucket or fixture.
- A production server may be left running on port 3005 — kill via `lsof -nP -iTCP:3005 -sTCP:LISTEN -t` before rebuilding.

## Moving production to wecertify.tech

1. Add `wecertify.tech` to the existing production Vercel project. In Cloudflare DNS, use the project-specific records Vercel displays. Keep the old production domain attached while testing the new one.
2. Verify `wecertify.tech` in Google Search Console. In Google Auth Platform, add it under **Branding → Authorized domains**, and add `https://wecertify.tech` to the existing web client's **Authorized JavaScript origins**. WeCertify's Google flows use popups. The Gmail code exchange uses the origin of the calling page.
3. Set Vercel's production `NEXT_PUBLIC_APP_URL` to `https://wecertify.tech` and deploy the rebrand. Use **WeCertify** in Google Branding with `https://wecertify.tech/`, `https://wecertify.tech/privacy`, and `https://wecertify.tech/terms`. Google may require another brand review after these changes.
4. Test Google sign-in and Gmail connection on the new domain. Existing sessions are scoped to the old domain, so users sign in again when they switch. After testing, keep `certify-v2.mgbuilds.in` attached and redirect it to the new domain with the original path and query. Check an issued and a revoked certificate through the old links after enabling the redirect.

The public domain used to issue a new batch is saved with its immutable design and reused for exports, resends, and public downloads. Preview deployments fall back to the configured public origin. Older production batches use the previous domain when regenerating a QR code. The domain change requires no database migration.

## Gmail sender and access policy

- The R2 bucket’s CORS rule must allow the app origins to send both `Content-Type` and `If-None-Match` on uploads. The signed condition makes template objects create-only.
- Staged email attachments are encrypted in the browser. The send route deletes the stored ciphertext after processing. Set a 24-hour R2 lifecycle expiry for `mail-staging/v2/` to clean up abandoned uploads. Certificate artwork lives under `designs/` and must be retained.

- Set `ADMIN_EMAIL` to the sole super admin address and grant other accounts from **Admin → Access**. Existing access entries are retained, including entries grandfathered by the original 0005 migration. Review those entries before onboarding real users. The current 0005 migration no longer restores revoked accounts when rerun.
- Set `GMAIL_TOKEN_ENCRYPTION_KEY` to a unique 32-byte key encoded as 64 hex characters and share it across application instances through the secret manager. Keep `NEXT_PUBLIC_APP_URL` set to the exact public HTTPS origin, and register that origin in the Google OAuth client. The production Google project needs Gmail API access and a consent screen that permits the intended users to grant `gmail.send`.
- Existing and new accounts require an explicit issuance grant in Access management. Gmail grants from before sender verification require reconnection from Studio.
- Older issued certificates retain their verification IDs and start with unknown delivery history. New issuance records start pending. Have issuers reload Studio after deploying delivery tracking so their mail requests include certificate IDs.
- Backups created after the migration contain delivery status, attempt versions, provider IDs, and event mail preferences. Apply the migration before creating or restoring those backups. When restoring an older snapshot into an empty database, review any historical records in Gmail Sent. A restored in-flight request becomes Unknown after two minutes. Check Gmail Sent for activity after the most recent snapshot before resuming affected batches after a recovery.

- The super admin can adjust the rolling per-account limits under **Admin → Access**. Defaults are 55 sends per minute and 8 per second. Match per-account settings to your Gmail project and mailbox quotas. Gmail can also impose daily, concurrency, and project-wide limits. WeCertify pauses for its own rate limit and stops starting sends when Gmail reports a quota limit.
- Confirm the live OAuth consent, reconnection, and delivery in staging before deploying to production.

## Canvas rendering and regression checks

- Layouts save coordinates and font sizes in native template pixels. New text starts at 6% of the shorter template edge. Fit may enlarge small artwork and pointer targets, snapping, and drag thresholds use screen pixels. Saved font sizes are reused when opening a design.
- The canvas editor, the main-thread renderer, and the export worker share text fitting in `src/lib/certificate-text.ts`. Editor font loads invalidate cached measurements. The preview buffer has an eight-million-pixel budget and a 4,096-pixel edge limit. Exports use the template's native resolution.
- The export pool budgets workers by CPU and decoded image size. Each worker uses one drawing buffer for large artwork. If a worker stalls or crashes, outstanding rows fail with a reason so they can be retried. Email workers share in-flight render chunks and accounts are still rate-limited by the send endpoint.
- Run `npm test` for text fit, viewport allocation, and concurrent mail rendering regression coverage. Run `node scripts/e2e-smoke.mjs <port>` against a local production build configured with a disposable database. The suite writes test records and checks account isolation, immutable issued data, and the public field snapshot.
- For a browser release check, compare 400 × 300, 1,200 × 900, and 4,000 × 3,000 artwork at Fit. Resize a text area and undo and redo the change. Issue a batch with QR codes, inspect the PNG, JPEG, and PDF ZIP, and check a certificate link in a signed-out window. Confirm the Issued By label and public download. Use a simulated Gmail API when stress-testing email batches and a staging mailbox when verifying Google consent and delivery.
