# Architecture Decision Record — Background Certificate Mail Worker

## 1. Durable Queue in Neon Postgres vs Dedicated Broker (Redis/BullMQ/SQS)
- **Decision**: Use two normalized Postgres tables (`mail_batches` + `mail_batch_items`) on the existing Neon database with `FOR UPDATE SKIP LOCKED` atomic leases and 20s heartbeats.
- **Rationale**: Zero extra infrastructure cost or secret sprawl; transactional consistency with existing `certificates.mail_status`, `events.issued_design`, and `platform_access` rate-limit rows.
- **Tradeoff**: Polling interval (`2.5s` default) introduces sub-3s pickup latency, which is negligible for multi-minute bulk mailing batches and easily replaceable if scale later warrants Redis/SQS.

## 2. Per-Batch OAuth PKCE & Single-Use Ciphertext Handoff
- **Decision**: Vercel initiates OAuth 2.0 `authorization_code` + `S256` PKCE (`access_type=online`) bound to an HttpOnly HMAC cookie; Google returns `code` to Vercel's `/api/mail-batches/oauth/callback`; Vercel encrypts `(code, code_verifier)` with `WORKER_HANDOFF_KEY` into `mail_batch_oauth_handoffs` with a 180s expiry. The worker atomically consumes and nulls both ciphertext columns (`encrypted_code = NULL, encrypted_verifier = NULL`), exchanges the code, discards any `refresh_token`, verifies email + `gmail.send` scope, and keeps `access_token` **exclusively in closure RAM**.
- **Rationale**: Even a full Postgres backup or compromised read replica contains zero Gmail access or refresh tokens, and the single-use SQL update prevents code replay. Using Google's grant-wide `/revoke` is reserved strictly for explicit disconnect (`DELETE /api/auth/google/tokens`) rather than batch expiry/completion.
- **Tradeoff**: Batches running longer than ~60 minutes (or surviving dyno restarts) transition cleanly to `paused_auth` and require one click from the issuer to re-authorize and resume.

## 3. Rendering fidelity and memory

Canvas Studio, browser batch exports, and the delivery worker share one painter for logical coordinates, export scaling, shrink-to-fit text, colors, alignment, decorative images, and QR customization. Each runtime supplies its own Canvas 2D context. Matching the drawing instructions and fonts preserves the design. Different browser and native engines can still produce different glyph and antialiasing pixels.

The worker reuses one Skia drawing surface. A lossless PDF reads the existing premultiplied surface a row at a time and compresses the RGB data directly. A PDF soft mask preserves transparency, including partially transparent image overlays. The output keeps Studio's page geometry and PNG-size rule for choosing lossless or JPEG encoding. The worker checks attachment sizes before MIME assembly. It does not substitute a smaller image when a selected format exceeds the message limit.

### Alternatives evaluated

- Open edX fills an existing PDF with a separate personalized overlay and measures long names before choosing font size. The open-source Certificate Generator likewise uses PDF page images and vector text. Both avoid flattening a full certificate into pixels. WeCertify's direct PDF prototype saved memory with the JPEG fixture. The native Skia PDF trial rounded fractional page dimensions, and the simpler PDFKit prototype did not reproduce Studio's full image, text, and QR behavior. The worker keeps the shared painter for delivery. [Open edX certificate generation](https://github.com/openedx-unsupported/edx-certificates/blob/master/gen_cert.py) · [Certificate Generator](https://github.com/jere-mie/Certificate-Generator) · [Skia PDF backend](https://skia.org/docs/user/sample/pdf/)
- PDFBox documents scratch files to reduce peak memory and recommends releasing rendered images as processing progresses. The worker applies that pattern to mail. Nodemailer streams RFC 822 into an unlinked, private temporary file with an exact size limit. Gmail receives a stream with the measured content length. The process never builds a complete MIME buffer in memory, and the file is reclaimed when the descriptor closes, including on process exit. [PDFBox memory guidance](https://pdfbox.apache.org/3.0/faq.html#pdf-rendering) · [Nodemailer stream transport](https://nodemailer.com/transports/stream) · [Gmail media uploads](https://developers.google.com/workspace/gmail/api/guides/uploads#simple)
- Sharp and libvips can evaluate image regions on demand to save memory. They would still need to match the current resampling, alpha blending, and text edges for certificate output. The worker currently keeps the existing drawing backend. [libvips evaluation model](https://www.libvips.org/API/current/how-it-works.html)

## 4. Delivery state, concurrency, and crash recovery

A transaction checks the parent lease and atomically records the certificate and recipient as sending before Gmail can be called. A second transaction records both outcomes. Workers recover interrupted renders as queued work and move ambiguous submissions to manual reconciliation. A successful Gmail response means accepted by the provider. Inbox delivery is a separate outcome.

Begin with one delivery slot per dyno. All foreground and background sends share per-sender limits in Postgres. Retry explicit throttling within the attempt budget, honor Gmail's retry delay, and pause for fresh authorization after a restart or expired token.

## 5. Explicit Rollout Activation
- **Decision**: Gate both `/api/mail-batches` and the Studio/Dashboard UI (`BackgroundBatchPanel`) behind `ENABLE_BACKGROUND_MAIL_WORKER=true` + valid `WORKER_HANDOFF_KEY`, leaving existing browser batch dispatch intact during rollout.
