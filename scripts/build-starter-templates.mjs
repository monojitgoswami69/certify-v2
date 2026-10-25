#!/usr/bin/env node
/**
 * Generates the starter template gallery: public/starter-templates/*.svg
 * plus manifest.json. Run manually (node scripts/build-starter-templates.mjs)
 * after editing designs; output is committed.
 *
 * SVGs are baked static artwork (title, borders, signature lines) rendered to
 * PNG client-side when picked; dynamic fields (Name/Course/Date) are overlaid
 * boxes seeded from the manifest.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'starter-templates');
mkdirSync(outDir, { recursive: true });

const W = 2000;
const H = 1414;

function cornerFlourish(color, flipX, flipY) {
  // Simple mirrored curl placed at each corner by the frame function.
  const t = flipX ? `translate(${W} 0) scale(-1 1)` : '';
  const ty = flipY ? `translate(0 ${H}) scale(1 -1)` : '';
  return `<g transform="${t} ${ty}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round">
    <path d="M 130 96 C 90 96 96 136 96 136 C 96 136 60 130 60 170" />
    <circle cx="96" cy="136" r="7" fill="${color}" stroke="none" />
  </g>`;
}

function frame({ rules, accent, bg, flourishes = true, bandTop = null, grid = false, petals = false }) {
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
  if (bandTop) {
    parts.push(`<rect width="${W}" height="${bandTop.h}" fill="${bandTop.fill}"/>`);
    if (bandTop.accentLine) {
      parts.push(`<rect y="${bandTop.h}" width="${W}" height="10" fill="${bandTop.accentLine}"/>`);
    }
  }
  for (const r of rules) {
    parts.push(`<rect x="${r.inset}" y="${r.inset}" width="${W - r.inset * 2}" height="${H - r.inset * 2}" fill="none" stroke="${r.color}" stroke-width="${r.width}"${r.radius ? ` rx="${r.radius}"` : ''}/>`);
  }
  if (grid) {
    for (let i = 1; i < 6; i++) {
      parts.push(`<line x1="${120 + i * 24}" y1="120" x2="${108 + i * 24}" y2="152" stroke="${accent}" stroke-width="2" opacity="0.5"/>`);
      parts.push(`<line x1="${W - 120 - i * 24}" y1="120" x2="${W - 108 - i * 24}" y2="152" stroke="${accent}" stroke-width="2" opacity="0.5"/>`);
    }
  }
  if (petals) {
    for (const [cx, cy, rot] of [[150, 150, 0], [W - 150, 150, 90], [W - 150, H - 150, 180], [150, H - 150, 270]]) {
      parts.push(`<g transform="translate(${cx} ${cy}) rotate(${rot})" fill="${accent}" opacity="0.85">
        <ellipse cx="0" cy="-34" rx="20" ry="34"/>
        <ellipse cx="30" cy="18" rx="20" ry="34" transform="rotate(72)"/>
        <ellipse cx="-30" cy="18" rx="20" ry="34" transform="rotate(144)"/>
      </g>`);
    }
  }
  if (flourishes) {
    parts.push(cornerFlourish(accent, false, false));
    parts.push(cornerFlourish(accent, true, false));
    parts.push(cornerFlourish(accent, true, true));
    parts.push(cornerFlourish(accent, false, true));
  }
  return parts.join('\n  ');
}

function serifTitle(color, sub) {
  return `
  <text x="${W / 2}" y="300" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="104" font-weight="bold" fill="${color}" letter-spacing="14">CERTIFICATE</text>
  <text x="${W / 2}" y="382" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="36" fill="${sub}" letter-spacing="16">OF ACHIEVEMENT</text>`;
}

function sansTitle(color, sub, titleText = 'CERTIFICATE') {
  return `
  <text x="${W / 2}" y="296" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="96" font-weight="700" fill="${color}" letter-spacing="22">${titleText}</text>
  <text x="${W / 2}" y="376" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="30" fill="${sub}" letter-spacing="18">OF ACHIEVEMENT</text>`;
}

const presentedTo = (color) =>
  `<text x="${W / 2}" y="560" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="32" fill="${color}">This certificate is proudly presented to</text>`;

const presentedToSans = (color) =>
  `<text x="${W / 2}" y="560" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="28" fill="${color}" letter-spacing="4">THIS CERTIFICATE IS PROUDLY PRESENTED TO</text>`;

const nameRule = (color) => `<line x1="420" y1="782" x2="${W - 420}" y2="782" stroke="${color}" stroke-width="3"/>`;

function signatures(color) {
  return `
  <line x1="330" y1="1190" x2="800" y2="1190" stroke="${color}" stroke-width="3"/>
  <text x="565" y="1238" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="26" fill="${color}">Authorized Signature</text>
  <line x1="${W - 800}" y1="1190" x2="${W - 330}" y2="1190" stroke="${color}" stroke-width="3"/>
  <text x="${W - 565}" y="1238" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="26" fill="${color}">Director</text>`;
}

const themes = [
  {
    id: 'classic-gold',
    name: 'Classic Gold',
    category: 'formal',
    accent: '#b8860b',
    svg: `  ${frame({ rules: [
      { inset: 60, color: '#b8860b', width: 6 },
      { inset: 84, color: '#d4af37', width: 2 },
    ], accent: '#b8860b', bg: '#fffdf5' })}
  ${serifTitle('#8a6d1d', '#a98a2f')}
  ${presentedTo('#7a6a45')}
  ${nameRule('#d8c58e')}
  ${signatures('#8a7a55')}`,
    boxes: {
      nameFont: 'Playfair Display', nameColor: '#3d3320',
      courseFont: 'Inter', courseColor: '#6b5d3f',
      dateFont: 'Inter', dateColor: '#8a7a55',
    },
  },
  {
    id: 'modern-slate',
    name: 'Modern Slate',
    category: 'professional',
    accent: '#334155',
    svg: `  ${frame({ rules: [
      { inset: 70, color: '#e2e8f0', width: 2, radius: 18 },
      { inset: 82, color: '#94a3b8', width: 4, radius: 12 },
    ], accent: '#334155', bg: '#ffffff', flourishes: false })}
  <rect x="0" y="0" width="${W}" height="26" fill="#334155"/>
  ${sansTitle('#0f172a', '#64748b')}
  ${presentedToSans('#94a3b8')}
  <line x1="700" y1="782" x2="${W - 700}" y2="782" stroke="#cbd5e1" stroke-width="3"/>
  <line x1="820" y1="1190" x2="${W - 820}" y2="1190" stroke="#94a3b8" stroke-width="3"/>
  <text x="${W / 2}" y="1238" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="24" fill="#64748b" letter-spacing="6">PROGRAM DIRECTOR</text>`,
    boxes: {
      nameFont: 'Plus Jakarta Sans', nameColor: '#0f172a',
      courseFont: 'Inter', courseColor: '#475569',
      dateFont: 'Inter', dateColor: '#64748b',
    },
  },
  {
    id: 'emerald-academic',
    name: 'Emerald Academic',
    category: 'academic',
    accent: '#047857',
    svg: `  ${frame({ rules: [
      { inset: 58, color: '#047857', width: 7 },
      { inset: 80, color: '#10b981', width: 2 },
    ], accent: '#047857', bg: '#f7fdf9', flourishes: false })}
  <g fill="none" stroke="#047857" stroke-width="5" stroke-linecap="round">
    <path d="M 150 200 C 110 260 120 330 170 380" />
    <path d="M 132 220 C 150 250 152 290 140 320" />
    <path d="M ${W - 150} 200 C ${W - 110} 260 ${W - 120} 330 ${W - 170} 380" />
    <path d="M ${W - 132} 220 C ${W - 150} 250 ${W - 152} 290 ${W - 140} 320" />
  </g>
  ${serifTitle('#065f46', '#059669')}
  ${presentedTo('#4b7c6b')}
  ${nameRule('#a7d7bf')}
  ${signatures('#4b7c6b')}`,
    boxes: {
      nameFont: 'Playfair Display', nameColor: '#064e3b',
      courseFont: 'Inter', courseColor: '#047857',
      dateFont: 'Inter', dateColor: '#4b7c6b',
    },
  },
  {
    id: 'royal-indigo',
    name: 'Royal Indigo',
    category: 'professional',
    accent: '#4f46e5',
    svg: `  ${frame({ rules: [
      { inset: 64, color: '#e0e7ff', width: 3, radius: 16 },
    ], accent: '#4f46e5', bg: '#ffffff', flourishes: false, bandTop: { h: 210, fill: '#4f46e5', accentLine: '#a5b4fc' } })}
  <text x="${W / 2}" y="150" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="88" font-weight="700" fill="#ffffff" letter-spacing="22">CERTIFICATE</text>
  <text x="${W / 2}" y="500" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="28" fill="#818cf8" letter-spacing="16">OF ACHIEVEMENT</text>
  ${presentedToSans('#94a3b8')}
  <line x1="700" y1="782" x2="${W - 700}" y2="782" stroke="#c7d2fe" stroke-width="3"/>
  <line x1="820" y1="1190" x2="${W - 820}" y2="1190" stroke="#a5b4fc" stroke-width="3"/>
  <text x="${W / 2}" y="1238" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="24" fill="#6366f1" letter-spacing="6">PROGRAM DIRECTOR</text>`,
    boxes: {
      nameFont: 'Plus Jakarta Sans', nameColor: '#1e1b4b',
      courseFont: 'Inter', courseColor: '#4338ca',
      dateFont: 'Inter', dateColor: '#6366f1',
    },
  },
  {
    id: 'dark-elegance',
    name: 'Dark Elegance',
    category: 'formal',
    accent: '#d4af37',
    svg: `  ${frame({ rules: [
      { inset: 60, color: '#d4af37', width: 5 },
      { inset: 82, color: '#8a6d1d', width: 2 },
    ], accent: '#d4af37', bg: '#1c1917' })}
  ${serifTitle('#e7c96b', '#b8985a')}
  <text x="${W / 2}" y="560" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="32" fill="#a8a29e">This certificate is proudly presented to</text>
  ${nameRule('#8a6d1d')}
  <line x1="330" y1="1190" x2="800" y2="1190" stroke="#78716c" stroke-width="3"/>
  <text x="565" y="1238" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="26" fill="#a8a29e">Authorized Signature</text>
  <line x1="${W - 800}" y1="1190" x2="${W - 330}" y2="1190" stroke="#78716c" stroke-width="3"/>
  <text x="${W - 565}" y="1238" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="26" fill="#a8a29e">Director</text>`,
    boxes: {
      nameFont: 'Playfair Display', nameColor: '#f5f0e1',
      courseFont: 'Inter', courseColor: '#d6c9a8',
      dateFont: 'Inter', dateColor: '#a8a29e',
    },
  },
  {
    id: 'warm-participation',
    name: 'Warm Participation',
    category: 'participation',
    accent: '#ea580c',
    svg: `  ${frame({ rules: [
      { inset: 66, color: '#fed7aa', width: 3, radius: 24 },
      { inset: 88, color: '#fb923c', width: 5, radius: 16 },
    ], accent: '#ea580c', bg: '#fffbf5', flourishes: false, petals: true })}
  <text x="${W / 2}" y="296" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="92" font-weight="800" fill="#c2410c" letter-spacing="10">CERTIFICATE</text>
  <text x="${W / 2}" y="372" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="30" fill="#ea580c" letter-spacing="14">OF PARTICIPATION</text>
  ${presentedTo('#9a6b4f')}
  ${nameRule('#fdba74')}
  <line x1="820" y1="1190" x2="${W - 820}" y2="1190" stroke="#fb923c" stroke-width="3"/>
  <text x="${W / 2}" y="1238" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="24" fill="#c2410c" letter-spacing="6">EVENT ORGANIZER</text>`,
    boxes: {
      nameFont: 'Quicksand', nameColor: '#7c2d12',
      courseFont: 'Quicksand', courseColor: '#c2410c',
      dateFont: 'Inter', dateColor: '#9a6b4f',
    },
  },
  {
    id: 'hackathon-bold',
    name: 'Hackathon Bold',
    category: 'tech',
    accent: '#10b981',
    svg: `  ${frame({ rules: [
      { inset: 60, color: '#1f2937', width: 8, radius: 10 },
    ], accent: '#10b981', bg: '#0b1220', flourishes: false, grid: true })}
  <text x="${W / 2}" y="296" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="96" font-weight="800" fill="#10b981" letter-spacing="16">CERTIFICATE</text>
  <text x="${W / 2}" y="374" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="30" fill="#34d399" letter-spacing="10">&lt; OF ACHIEVEMENT /&gt;</text>
  <text x="${W / 2}" y="560" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="28" fill="#6b7280">awarded_to :=</text>
  <line x1="640" y1="782" x2="${W - 640}" y2="782" stroke="#10b981" stroke-width="3"/>
  <line x1="820" y1="1190" x2="${W - 820}" y2="1190" stroke="#374151" stroke-width="3"/>
  <text x="${W / 2}" y="1238" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="24" fill="#9ca3af" letter-spacing="4">// EVENT ORGANIZERS</text>`,
    boxes: {
      nameFont: 'Saira', nameColor: '#ecfdf5',
      courseFont: 'Inter', courseColor: '#34d399',
      dateFont: 'Inter', dateColor: '#9ca3af',
    },
  },
  {
    id: 'floral-rose',
    name: 'Floral Rose',
    category: 'participation',
    accent: '#be185d',
    svg: `  ${frame({ rules: [
      { inset: 60, color: '#fbcfe8', width: 4 },
      { inset: 80, color: '#ec4899', width: 2 },
    ], accent: '#be185d', bg: '#fffafc', flourishes: false, petals: true })}
  <text x="${W / 2}" y="300" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="100" font-weight="bold" fill="#9d174d" letter-spacing="12">CERTIFICATE</text>
  <text x="${W / 2}" y="380" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="34" fill="#ec4899" letter-spacing="14">OF APPRECIATION</text>
  ${presentedTo('#b06a87')}
  ${nameRule('#f9a8d4')}
  ${signatures('#b06a87')}`,
    boxes: {
      nameFont: 'Playfair Display', nameColor: '#831843',
      courseFont: 'Inter', courseColor: '#be185d',
      dateFont: 'Inter', dateColor: '#b06a87',
    },
  },
];

const manifest = [];

for (const t of themes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${t.svg}
</svg>`;
  writeFileSync(join(outDir, `${t.id}.svg`), svg, 'utf8');

  manifest.push({
    id: t.id,
    name: t.name,
    category: t.category,
    file: `/starter-templates/${t.id}.svg`,
    accent: t.accent,
    // Dynamic field boxes seeded on selection (template coords 2000×1414).
    seed: {
      name: { x: 300, y: 660, w: 1400, h: 110, fontSize: 60, fontColor: t.boxes.nameColor, fontFamily: t.boxes.nameFont, hAlign: 'center', vAlign: 'bottom' },
      course: { x: 350, y: 830, w: 1300, h: 60, fontSize: 30, fontColor: t.boxes.courseColor, fontFamily: t.boxes.courseFont, hAlign: 'center', vAlign: 'bottom' },
      date: { x: 700, y: 960, w: 600, h: 50, fontSize: 26, fontColor: t.boxes.dateColor, fontFamily: t.boxes.dateFont, hAlign: 'center', vAlign: 'bottom' },
    },
    defaultFont: t.boxes.nameFont,
  });
  console.log(`built ${t.id}.svg`);
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n${manifest.length} starter templates + manifest written to ${outDir}`);
