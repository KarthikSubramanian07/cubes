/**
 * Generates the social card and icon set into web/public:
 *   og.png (1200×630), apple-touch-icon.png (180), icon-192.png, icon-512.png,
 *   icon-maskable-512.png, favicon.ico (16 + 32).
 *
 * It composes SVG with the site's real fonts embedded as data URLs and rasterises it
 * in headless Chromium (Playwright is already a dev dependency), so the card uses the
 * exact same Newsreader / Caveat / JetBrains Mono as the site.
 *
 *   bun scripts/og.ts
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simulate } from "../src/pages/landing/heroSim";

const root = join(import.meta.dir, "..");
const pub = join(root, "public");
const font = (pkg: string, file: string) => readFileSync(join(root, "node_modules", pkg, "files", file)).toString("base64");

const FONTS = `
@font-face { font-family: "Newsreader"; font-style: normal; font-weight: 200 800; src: url(data:font/woff2;base64,${font("@fontsource-variable/newsreader", "newsreader-latin-opsz-normal.woff2")}) format("woff2"); }
@font-face { font-family: "Newsreader"; font-style: italic; font-weight: 200 800; src: url(data:font/woff2;base64,${font("@fontsource-variable/newsreader", "newsreader-latin-opsz-italic.woff2")}) format("woff2"); }
@font-face { font-family: "Caveat"; font-weight: 500; src: url(data:font/woff2;base64,${font("@fontsource/caveat", "caveat-latin-500-normal.woff2")}) format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 100 800; src: url(data:font/woff2;base64,${font("@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2")}) format("woff2"); }
`;

const SEATS = ["#e2683c", "#2fb0a1", "#e9b949", "#8a7cf5"];
const PAPER = "#f2eee5";
const INK = "#1e1c19";
const CLAY = "#c4502f";

function board(x: number, y: number, size: number): string {
  const n = 14;
  const sim = simulate({ size: n, seats: 4, seed: 11 });
  const placements = sim.placements.slice(0, 26);
  const pad = size * 0.045;
  const cell = (size - pad * 2) / n;
  const g = cell * 0.09;
  const cells = placements
    .flatMap((p) =>
      p.cells.map(
        ([cx, cy]) =>
          `<rect x="${(x + pad + cx * cell + g / 2).toFixed(1)}" y="${(y + pad + cy * cell + g / 2).toFixed(1)}" width="${(cell - g).toFixed(1)}" height="${(cell - g).toFixed(1)}" rx="${(cell * 0.16).toFixed(1)}" fill="${SEATS[p.seat]}"/>`,
      ),
    )
    .join("");
  const grid: string[] = [];
  for (let i = 0; i <= n; i++) {
    grid.push(`<line x1="${x + pad + i * cell}" y1="${y + pad}" x2="${x + pad + i * cell}" y2="${y + size - pad}"/>`);
    grid.push(`<line x1="${x + pad}" y1="${y + pad + i * cell}" x2="${x + size - pad}" y2="${y + pad + i * cell}"/>`);
  }
  const cores = sim.cores
    .map(
      ([cx, cy], s) =>
        `<rect x="${x + pad + cx * cell + 1.5}" y="${y + pad + cy * cell + 1.5}" width="${cell - 3}" height="${cell - 3}" rx="${cell * 0.2}" fill="#1c1916" stroke="${SEATS[s]}" stroke-width="2"/><circle cx="${x + pad + (cx + 0.5) * cell}" cy="${y + pad + (cy + 0.5) * cell}" r="${cell * 0.16}" fill="${SEATS[s]}"/>`,
    )
    .join("");
  return `
    <defs>
      <filter id="bloom" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="7"/></filter>
      <radialGradient id="slab" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#1e1b17"/><stop offset="1" stop-color="#0c0b09"/></radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="30" stdDeviation="28" flood-color="#3a2410" flood-opacity="0.28"/></filter>
    </defs>
    <g transform="rotate(3 ${x + size / 2} ${y + size / 2})">
      <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="26" fill="url(#slab)" filter="url(#shadow)"/>
      <g stroke="#2a2722" stroke-width="1">${grid.join("")}</g>
      <g filter="url(#bloom)" opacity="0.75">${cells}</g>
      <g>${cells}</g>
      ${cores}
    </g>`;
}

function og(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <style>${FONTS}</style>
  <rect width="1200" height="630" fill="${PAPER}"/>
  <g transform="translate(72 70)">
    <rect x="0" y="0" width="17" height="17" rx="3.2" fill="${CLAY}"/>
    <rect x="17" y="17" width="17" height="17" rx="3.2" fill="${INK}"/>
    <text x="50" y="30" font-family="Newsreader" font-size="40" font-weight="400" letter-spacing="-1.2" fill="${INK}">cubes</text>
  </g>
  <text x="74" y="200" font-family="Caveat" font-weight="500" font-size="34" fill="${CLAY}" transform="rotate(-4 74 200)">the entire game, in one sentence</text>
  <path d="M462 160 C 484 156, 502 170, 506 194 M496 186 L 507 197 L 514 184" fill="none" stroke="${CLAY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <text font-family="Newsreader" font-weight="300" font-size="96" letter-spacing="-3.4" fill="${INK}">
    <tspan x="68" y="300">Your light only</tspan>
    <tspan x="68" y="392">grows by its</tspan>
    <tspan x="68" y="484" font-style="italic" fill="${CLAY}">corners</tspan><tspan>.</tspan>
  </text>
  <path d="M70 506 C 140 499, 240 497, 372 501" fill="none" stroke="${CLAY}" stroke-width="3" stroke-linecap="round"/>
  <path d="M86 518 C 160 513, 250 512, 352 515" fill="none" stroke="${CLAY}" stroke-width="2.4" stroke-linecap="round"/>
  <text x="72" y="574" font-family="JetBrains Mono" font-weight="500" font-size="17" letter-spacing="3" fill="#6f6a61">A TERRITORY GAME · 2–4 PLAYERS · PLAYCUBES.PAGES.DEV</text>
  ${board(706, 116, 420)}
  <line x1="0" y1="626" x2="1200" y2="626" stroke="#c9c1b0" stroke-width="2" stroke-dasharray="6 6"/>
</svg>`;
}

function icon(size: number, maskable = false): string {
  const pad = maskable ? size * 0.2 : size * 0.16;
  const s = (size - pad * 2) / 2;
  const r = maskable ? 0 : size * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${INK}"/>
  <rect x="${pad}" y="${pad}" width="${s}" height="${s}" rx="${s * 0.16}" fill="#e2683c"/>
  <rect x="${pad + s}" y="${pad + s}" width="${s}" height="${s}" rx="${s * 0.16}" fill="${PAPER}"/>
</svg>`;
}

/** An ICO whose entries are PNGs (supported everywhere that matters). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o);
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(p.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg: string, w: number, h: number): Promise<Buffer> {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, omitBackground: true });
}

writeFileSync(join(pub, "og.png"), await render(og(), 1200, 630));
writeFileSync(join(pub, "apple-touch-icon.png"), await render(icon(180).replace(/rx="[\d.]+" fill="#1e1c19"/, 'fill="#1e1c19"'), 180, 180));
writeFileSync(join(pub, "icon-192.png"), await render(icon(192), 192, 192));
writeFileSync(join(pub, "icon-512.png"), await render(icon(512), 512, 512));
writeFileSync(join(pub, "icon-maskable-512.png"), await render(icon(512, true), 512, 512));
const ico16 = await render(icon(16), 16, 16);
const ico32 = await render(icon(32), 32, 32);
writeFileSync(join(pub, "favicon.ico"), ico([{ size: 16, data: ico16 }, { size: 32, data: ico32 }]));

await browser.close();
console.log("wrote og.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, favicon.ico");
