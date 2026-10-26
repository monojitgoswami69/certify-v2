# HANDOVER — Certify v2 (2026-10-26)

For the next agent/session picking this up. Everything below is current as of commit `90e6252` on `main` (local; NOT pushed).

## 0. Iron rules (from AGENTS.md + user instruction)

- **NEVER `git push` without the user's explicit approval in that conversation.** Remote is `personal` (`git push personal main`). Local commits are fine and encouraged.
- Before proposing a push, run the gauntlet: `npm run lint`, `npm test`, `npm run build`, and `node scripts/e2e-smoke.mjs <port>` against a locally booted production server (`PORT=3005 npm run start`).
- This is a modified Next.js 16 — read `node_modules/next/dist/docs/` before Next-specific work. Classic `dynamic='force-dynamic'` is GONE; use `await connection()` from `next/server` in server page components. Middleware is `src/proxy.ts`.
- UI rules in AGENTS.md: no cards/pills; editorial layouts with hairline rules.
- Push-approval commits waiting: `38cba19` (docs), `3651a56`, `5af7a6a`, `831a0b7`, `aaf6af6`, `90e6252`.

## 1. Session state — where we stopped

Everything through the admin console is **implemented, typechecked, built, and e2e-verified**. The only thing interrupted mid-flight was the **browser UX pass of the Admin console** (`/admin`):

- Overview tab: ✅ screenshot-verified (tiles + per-account aggregate table render correctly).
- Access management tab: **NOT yet screenshotted** — the click on the "Access management" tab button failed once (tab id rotated between REPL calls; the button exists in the DOM per earlier snapshot). Just re-open `http://localhost:3005/admin`, click the tab (coordinate click via `elementFromPoint` pattern if Playwright locator times out — this IAB build has an actionability quirk), verify the allowlist table + grant form, screenshot.
- Known quirk encountered: page appeared stuck on a spinner once because the browser held a **revoked** session token (a logout e2e had bumped `sessions_valid_after`). Re-minting the token fixed it. If `/admin` shows a spinner forever, check `/api/auth/verify` with the browser cookie first.

## 2. What this session shipped (all local commits)

| Commit | Feature |
|---|---|
| `3651a56` | Verify page: certificate preview (left column) + PDF/JPG/PNG re-download + Issued By row; public `/api/verify/[id]/asset` render-spec endpoint (template + ONLY printable fields; revoked→404) |
| `5af7a6a` | Designer: static text boxes (`kind:'static'`), image elements (logos/signatures, `layoutConfig.images`) across all 4 render paths (editor canvas, main-thread engine, worker pool, verify preview); starter gallery — 8 SVG templates in `public/starter-templates/` + `StarterGalleryModal` (client-side SVG→PNG rasterize + seeded boxes) |
| `831a0b7` | Verify page share actions (LinkedIn add-to-profile, X, copy link — brand glyphs inlined, lucide dropped brand icons); opt-in scan analytics (`events.track_scans`, aggregate `scan_count`/`last_scanned_at` only, no IPs); validity windows (`events.valid_through`, `expired` flag + amber banner, details kept); `PATCH /api/events/[id]`; dashboard event-view settings strip |
| `aaf6af6` | Spot-check mode (`SpotCheckButton`); CSV drafter modal (`CsvDrafterModal`, Excel-like grid→File via `setCsvData`); single-recipient add in console (`AddRecipientForm`) AND dashboard event view (registers + optional instant email rendering from saved template) |
| `90e6252` | Template version history (`template_versions`, last 10 snapshots per save, restore via `POST /api/templates/[id]/versions`; duplicate button in library modal); draft workspaces (`workspace_drafts` table, `PUT/GET/DELETE /api/workspace-draft`, debounced 2.5s autosave in EditorClient + recovery banner incl. best-effort template restore); **Admin console**: `/admin` route, allowlist platform access (`platform_access` table; only admin-added emails can sign in — gate lives in `src/app/api/auth/google/route.ts`), roles user/admin/super_admin (ADMIN_EMAIL bootstraps super_admin; admins add users, only super_admin adds admins), aggregate-only analytics (`/api/admin/overview`, `/api/admin/accounts` — counts and dates ONLY, zero recipient PII) |

Migrations applied to the live Neon DB this session: `drizzle/0003_event_features.sql`, `0004_template_versions.sql`, `0005_drafts_and_access.sql` (all idempotent; npm scripts `db:event-features`, `db:template-versions`, `db:drafts-access`). Note: migrations 0003–0005 are NOT in the drizzle journal — the project uses push + these idempotent scripts by design (see `db:stamp` baseline history in earlier commits).

## 3. Verification state at handover

- `npx tsc --noEmit` clean · `npx vitest run` **44/44** · `npm run build` 0 errors · full e2e (`node scripts/e2e-smoke.mjs 3005` against booted prod server) **ALL CHECKS PASSED** including: registration race/idempotency, cookie+CSRF matrix, asset endpoint (filtering/revoked 404), event settings (trackScans increments 1→2, expiry flag on→off), admin (403 as user → 200 as super_admin → grant/revoke allowlist → 403 after removal).
- A production server may still be running on port 3005 — kill via `lsof -nP -iTCP:3005 -sTCP:LISTEN -t` before rebuilding/booting.
- Demo data deliberately left in the dev DB for user review: account `verify-demo@certify.test` (elevated to **super_admin** in `platform_access`), template "Sample Data", event "AI & Society Hackathon 2026" with 2 certificates. Verify URLs recorded in `/tmp/verify-demo-urls.txt` (older tokens in `/tmp/certify-demo-token.txt` may be stale — re-mint per the script pattern in git history if needed). Offer to clean up when the user is done reviewing.

## 4. Remaining work (user-approved backlog, not yet started)

1. **Finish the admin console browser pass** (§1) — then everything this session is done.
2. **Email queue (server-side sending)** — user approved building it after explanation. Architecture agreed: job+items tables, short tick invocations (relay-race model), browser becomes a tracking screen. On Vercel use **Inngest or QStash** as the tick source (Vercel Hobby cron is once/day only; Fluid Compute caps ~60s); on a VPS an in-process `setInterval` worker suffices. Open design decision the user must make: server-side PDF rendering (new native dep) vs **client pre-render + upload with the job (recommended v1)**.
3. **Delivery provider choice** (SMTP/SendGrid/SES alongside Gmail) — user asked how integration works, answer given (user brings credentials, stored server-side like `google_credentials`, MIME already built; SPF/DKIM warning needed in UI). Awaiting go-ahead.
4. Deferred by choice: Playwright suite, zustand slice refactor (regression-risky without it), object storage for template images, admin TOTP 2FA, PII retention policy, dashboard virtualization/server-side CSV export.

## 5. Architecture quick-map (things that will bite you if unknown)

- **Auth**: HttpOnly `certify_session` cookie (7d / browser-session) + legacy Bearer fallback; **every mutating route requires `X-Certify-Request: 1`** header (CSRF guard in `src/lib/server-auth.ts`). Logout bumps `users.sessions_valid_after` (revokes all tokens). `src/lib/env.ts` is the zod-validated env contract — no raw `process.env` server-side.
- **Registration**: `src/lib/registration-service.ts` — unique `(user_id, record_fingerprint)` + `ON CONFLICT DO NOTHING`; identity = event+email+name, deterministic; legacy email-only fingerprints adopted+migrated on reuse; ambiguous email-less duplicate names → 400. Events are real rows (`events` table, `certificates.event_id` backfilled); every batch writes `registration_batches` audit row.
- **CSP**: nonce per request in `src/proxy.ts` (no `unsafe-inline` scripts); all app pages are `connection()`-wrapped server components + `*Client.tsx` split (see `src/app/*/page.tsx` pattern).
- **Render paths** (keep all 4 in sync when touching layout rendering): `canvas-renderer.ts` (editor), `certificate-engine.ts` (main thread), `certificate-worker.ts` (pool), `CertificatePreview.tsx` (verify page). TextBox uses **w/h** (a `width/height` seed bug was fixed — don't regress it).
- **Rate limits**: IP-based via trusted XFF tail (`TRUSTED_PROXY_COUNT`, default 1) + per-user buckets on register/templates/send.
- **Logging**: `src/lib/logger.ts` JSON lines with `x-request-id` from proxy.
- e2e mints its own JWT from `.env` values — never prints secrets.

## 6. Suggested next-session opening moves

1. Read AGENTS.md + this file. 2. `git log --oneline -8` to orient. 3. Finish §1 (admin Access-tab screenshot). 4. Ask the user for the email-queue render-side decision (§4.2) and start the queue. 5. Remember: no pushes without approval.
