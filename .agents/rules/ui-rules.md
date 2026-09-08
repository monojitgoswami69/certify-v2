# UI Design & Layout Rules

## 1. Avoid Carded Container Mess & Redundant Pills (Strict Rule)
- **NEVER use cards, boxes, bordered container rectangles, or pill badges unless strictly mandatory** (e.g. an actual modal dialog or a data table).
- Do NOT wrap page content inside artificial floating cards or boxes on top of a gray background (avoid the "card on canvas" and "box inside a card inside a box" anti-pattern).
- **NEVER add redundant pill badges or chips** (e.g. rounded-full status pills above headlines that restate what the headline and visual indicators already communicate).
- Design with **open, breathable, modern editorial layouts**:
  - Use modern typography, generous whitespace, and strong hierarchy.
  - Structure information using subtle hairline rules (`border-b border-stone-200/60`, `divide-y`) or clean column/grid alignments rather than enclosing content in rounded rectangles, gray boxes, or badge pills.
  - Avoid nested pills, gray inset background rectangles, and unnecessary borders.
