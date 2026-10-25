<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Git & Deployment Workflow (Strict Rule)

## 1. Pushes Require Explicit Approval
- **NEVER run `git push` without the user's explicit approval in the current conversation.** `main` is the release branch — a push can reach production, and new feature work may break it.
- Local commits are allowed (and encouraged) with clear conventional messages (`fix:`, `feat(scope):`, `refactor:`) so the tree stays reviewable; the **push** is the gated action.
- The push remote is `personal` (there is no `origin`): `git push personal main`.
- Before proposing a push, run the verification gauntlet and report results: `npm run lint`, `npm test`, `npm run build`, and `node scripts/e2e-smoke.mjs <port>` against a locally booted production server when the change touches APIs or the database.
- If the user asks to "commit and push" explicitly, that counts as approval for that change only — it does not carry over to future work.

# UI Design & Layout Rules

## 1. Avoid Carded Container Mess & Redundant Pills (Strict Rule)
- **NEVER use cards, boxes, bordered container rectangles, or pill badges unless strictly mandatory** (e.g. an actual modal dialog or a data table).
- Do NOT wrap page content inside artificial floating cards or boxes on top of a gray background (avoid the "card on canvas" and "box inside a card inside a box" anti-pattern).
- **NEVER add redundant pill badges or chips** (e.g. rounded-full status pills above headlines that restate what the headline and visual indicators already communicate).
- Design with **open, breathable, modern editorial layouts**:
  - Use modern typography, generous whitespace, and strong hierarchy.
  - Structure information using subtle hairline rules (`border-b border-stone-200/60`, `divide-y`) or clean column/grid alignments rather than enclosing content in rounded rectangles, gray boxes, or badge pills.
  - Avoid nested pills, gray inset background rectangles, and unnecessary borders.
