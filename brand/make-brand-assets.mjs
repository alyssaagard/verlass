/**
 * Generates every logo, icon, and favicon from one font:
 * Cormorant Garamond Italic 500 (SIL Open Font License, see fonts/OFL.txt),
 * the same face Offizin and Cachet use, so the products read as one family.
 *
 * The mark is a ticket: a dark green rounded square with a notch on each side, a sage edge,
 * and the name's initial in italic. Offizin's mark is a printed page; this one is a ticket.
 *
 * Usage, from the repository root:
 *   npm install
 *   npm run brand
 *
 * Output (the file names use SLUG from scripts/site.config.mjs):
 *   docs/assets/brand/  <slug>-mark.svg, <slug>-logo.svg/.png, <slug>-logo-solid.png,
 *                       <slug>-wordmark.svg/.png, <slug>-wordmark-reverse.png, <slug>-social.png,
 *                       <slug>-banner-220x140.png (for a Google Workspace Marketplace listing)
 *   docs/assets/icons/  icon-16 ... icon-512.png (Outlook ribbon and mobile, Gmail, home screens)
 *   docs/favicon.ico, docs/favicon.svg, docs/apple-touch-icon.png
 *   docs/app/ui/mark.js  the mark as inline SVG for the app's header
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { NAME, SLUG } from "../scripts/site.config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_FILE = path.join(ROOT, "brand/fonts/CormorantGaramond-500-italic.woff");
const BRAND_DIR = path.join(ROOT, "docs/assets/brand");
const ICON_DIR = path.join(ROOT, "docs/assets/icons");
const SITE_DIR = path.join(ROOT, "docs");

export const COLORS = {
  body: "#2F4F40", // the ticket
  edge: "#8FB5A0", // sage edge, so the dark ticket reads on dark backgrounds too
  letter: "#F1F4F2", // the initial
  ink: "#18241D", // wordmark on light backgrounds
  night: "#141C18", // the dark page background
  wash: "#E4EAE6", // light green backgrounds
};

const font = opentype.parse(fs.readFileSync(FONT_FILE).buffer);

/** The wordmark as SVG paths on a baseline at y = 0, and its bounding box. */
function wordmarkPaths(size, color) {
  const glyphs = font.stringToGlyphs(NAME, { features: { liga: true } });
  const scale = size / font.unitsPerEm;
  let x = 0;
  let box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  const parts = [];
  glyphs.forEach((g) => {
    // A fresh lookup by index avoids an opentype.js quirk with glyphs returned by ligature substitution.
    const p = font.glyphs.get(g.index).getPath(0, 0, size);
    const b = p.getBoundingBox();
    box = { x1: Math.min(box.x1, b.x1 + x), y1: Math.min(box.y1, b.y1), x2: Math.max(box.x2, b.x2 + x), y2: Math.max(box.y2, b.y2) };
    parts.push(`<path transform="translate(${x.toFixed(2)} 0)" d="${p.toPathData(2)}" fill="${color}"/>`);
    x += g.advanceWidth * scale;
  });
  return { svg: parts.join(""), box };
}

/** The italic initial, centered in a square of side `boxSize`. `extra` thickens strokes for tiny icons. */
function monogram(boxSize, { height = 0.56, color = COLORS.letter, shiftX = 0, shiftY = 0, extra = 0 } = {}) {
  const p = font.getPath(NAME.charAt(0), 0, 0, 1000);
  const b = p.getBoundingBox();
  const s = (boxSize * height) / (b.y2 - b.y1);
  const tx = (boxSize - (b.x2 - b.x1) * s) / 2 - b.x1 * s + shiftX * boxSize;
  const ty = (boxSize - (b.y2 - b.y1) * s) / 2 - b.y1 * s + shiftY * boxSize;
  const stroke = extra ? ` stroke="${color}" stroke-width="${(extra / s).toFixed(1)}" stroke-linejoin="round"` : "";
  return `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)})" d="${p.toPathData(1)}" fill="${color}"${stroke}/>`;
}

/** A rounded square from `inset` to B - inset with a round notch cut into its left and right sides. */
function ticketPath(B, inset, radius, notch) {
  const a = inset;
  const z = B - inset;
  const mid = B / 2;
  // Where the notch circle (centered on the outer edge) crosses this path's side.
  const dy = Math.sqrt(Math.max(0, notch * notch - inset * inset));
  const f = (n) => n.toFixed(2);
  return (
    `M${f(a + radius)} ${f(a)} H${f(z - radius)} Q${f(z)} ${f(a)} ${f(z)} ${f(a + radius)} ` +
    `V${f(mid - dy)} A${f(notch)} ${f(notch)} 0 0 0 ${f(z)} ${f(mid + dy)} ` +
    `V${f(z - radius)} Q${f(z)} ${f(z)} ${f(z - radius)} ${f(z)} H${f(a + radius)} Q${f(a)} ${f(z)} ${f(a)} ${f(z - radius)} ` +
    `V${f(mid + dy)} A${f(notch)} ${f(notch)} 0 0 0 ${f(a)} ${f(mid - dy)} ` +
    `V${f(a + radius)} Q${f(a)} ${f(a)} ${f(a + radius)} ${f(a)} Z`
  );
}

/**
 * The mark. `pixels` is the final size, used to keep the edge at least one pixel wide and to
 * thicken the initial at small sizes.
 */
function markSvg(pixels = 512) {
  const B = 512;
  const edge = Math.max(18, (B / pixels) * 1.1);
  const notch = 58;
  const extraBySize = { 16: 26, 20: 22, 24: 18, 25: 18, 32: 12, 40: 9, 48: 7, 50: 7, 64: 5, 75: 4, 80: 4 };
  const extra = extraBySize[pixels] || 0;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${B} ${B}" width="${pixels}" height="${pixels}">` +
    `<title>${NAME}</title>` +
    `<path d="${ticketPath(B, 0, 84, notch)}" fill="${COLORS.edge}"/>` +
    `<path d="${ticketPath(B, edge, 84 - edge / 2, notch + edge)}" fill="${COLORS.body}"/>` +
    monogram(B, { height: 0.5, shiftX: 0.0, shiftY: 0.0, extra }) +
    `</svg>`
  );
}

const markInner = () => markSvg(512).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/<title>.*?<\/title>/, "");

function wordmarkSvg(color, pad = 0.18) {
  const size = 400;
  const { svg, box } = wordmarkPaths(size, color);
  const p = size * pad;
  const w = box.x2 - box.x1 + 2 * p;
  const h = box.y2 - box.y1 + 2 * p;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(box.x1 - p).toFixed(1)} ${(box.y1 - p).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" width="${Math.round(w)}" height="${Math.round(h)}"><title>${NAME}</title>${svg}</svg>`;
}

/** Primary logo: the mark above the wordmark, centered on a square. */
function logoSvg(background, wordColor) {
  const S = 1000;
  const markSize = 360;
  const { svg, box } = wordmarkPaths(250, wordColor);
  const wmX = (S - (box.x2 - box.x1)) / 2 - box.x1;
  const bg = background ? `<rect width="${S}" height="${S}" fill="${background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><title>${NAME}</title>${bg}` +
    `<g transform="translate(${(S - markSize) / 2} 170) scale(${markSize / 512})">${markInner()}</g>` +
    `<g transform="translate(${wmX.toFixed(1)} 790)">${svg}</g></svg>`
  );
}

/** 1280 x 640 social preview for GitHub and link previews, in the site's dark green. */
function socialSvg() {
  const W = 1280;
  const H = 640;
  const { svg, box } = wordmarkPaths(210, COLORS.letter);
  const markSize = 220;
  const gap = 60;
  const total = markSize + gap + (box.x2 - box.x1);
  const left = (W - total) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${COLORS.night}"/>` +
    `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="${COLORS.body}" stroke-width="2"/>` +
    `<g transform="translate(${left} ${(H - markSize) / 2}) scale(${markSize / 512})">${markInner()}</g>` +
    `<g transform="translate(${(left + markSize + gap - box.x1).toFixed(1)} ${H / 2 + 62})">${svg}</g>` +
    `</svg>`
  );
}

/** 220 x 140 card banner, the size the Google Workspace Marketplace listing asks for. */
function bannerSvg() {
  const W = 220;
  const H = 140;
  const { svg, box } = wordmarkPaths(46, COLORS.letter);
  const markSize = 52;
  const gap = 12;
  const total = markSize + gap + (box.x2 - box.x1);
  const left = (W - total) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${COLORS.night}"/>` +
    `<g transform="translate(${left} ${(H - markSize) / 2}) scale(${markSize / 512})">${markInner()}</g>` +
    `<g transform="translate(${(left + markSize + gap - box.x1).toFixed(1)} ${H / 2 + 14})">${svg}</g>` +
    `</svg>`
  );
}

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
}

/** A .ico file holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function main() {
  // Outlook ribbon (16, 32, 64, 80, 128), Outlook mobile (25, 32, 48 at one, two, and three
  // times), the Gmail add-on logo (128), and home screens (192 to 512).
  for (const size of [16, 20, 24, 25, 32, 40, 48, 50, 64, 75, 80, 96, 128, 144, 192, 256, 512]) {
    write(path.join(ICON_DIR, `icon-${size}.png`), png(markSvg(size), size));
  }
  write(path.join(BRAND_DIR, `${SLUG}-mark.svg`), markSvg(512));
  write(
    path.join(ROOT, "docs/app/ui/mark.js"),
    `/**\n * The ${NAME} mark as inline SVG. Generated by brand/make-brand-assets.mjs; do not edit by hand.\n *\n * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.\n */\nexport const MARK_SVG = ${JSON.stringify(markSvg(48).replace(/<title>.*?<\/title>/, ""))};\n`
  );
  write(path.join(SITE_DIR, "favicon.svg"), markSvg(32));
  write(path.join(SITE_DIR, "favicon.ico"), ico([16, 32, 48].map((size) => ({ size, data: png(markSvg(size), size) }))));

  // Phones show transparency as black, so the home screen icon sits on a dark green square.
  const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180"><rect width="180" height="180" fill="${COLORS.night}"/><g transform="translate(22 22) scale(${136 / 512})">${markInner()}</g></svg>`;
  write(path.join(SITE_DIR, "apple-touch-icon.png"), png(apple, 180));

  write(path.join(BRAND_DIR, `${SLUG}-wordmark.svg`), wordmarkSvg(COLORS.ink));
  write(path.join(BRAND_DIR, `${SLUG}-wordmark.png`), png(wordmarkSvg(COLORS.ink), 1600));
  write(path.join(BRAND_DIR, `${SLUG}-wordmark-reverse.png`), png(wordmarkSvg(COLORS.letter), 1600));

  write(path.join(BRAND_DIR, `${SLUG}-logo.svg`), logoSvg(null, COLORS.ink));
  write(path.join(BRAND_DIR, `${SLUG}-logo.png`), png(logoSvg(null, COLORS.ink), 1000));
  write(path.join(BRAND_DIR, `${SLUG}-logo-solid.png`), png(logoSvg(COLORS.night, COLORS.letter), 1000));
  write(path.join(BRAND_DIR, `${SLUG}-social.png`), png(socialSvg(), 1280));
  write(path.join(BRAND_DIR, `${SLUG}-banner-220x140.png`), png(bannerSvg(), 220));

  console.log("Brand assets written to docs/assets.");
}

main();
