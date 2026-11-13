/**
 * Small text helpers shared by every host (Gmail add-on, Outlook task pane, browser demo).
 * Everything in docs/app/core is plain JavaScript with no browser or Google objects, so the
 * same code runs in Apps Script, in a task pane, and in Node for the tests.
 */

/** Escapes text for use inside HTML. */
export function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes text that goes between tags (never into an attribute). Quotation marks are left as
 * they are, which keeps the text readable wherever simple HTML is shown, such as Gmail cards.
 */
export function escapeText(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escaped text with line breaks turned into <br>, for message bodies in email and on cards. */
export function htmlLines(value) {
  return escapeText(value).replace(/\r\n|\r|\n/g, "<br>");
}

/** Trims, removes control characters, and limits the length of text typed by a person. */
export function clean(value, max) {
  let s = String(value === null || value === undefined ? "" : value);
  s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/[ \t]+\n/g, "\n").trim();
  if (max && s.length > max) s = s.slice(0, max).replace(/\s+$/, "");
  return s;
}

/** One line of cleaned text: line breaks and tabs become spaces. */
export function cleanLine(value, max) {
  return clean(String(value === null || value === undefined ? "" : value).replace(/[\r\n\t]+/g, " "), max).replace(/ {2,}/g, " ");
}

/** A lowercased, trimmed email address, or "" when the text is not an address. */
export function normalizeEmail(value) {
  const s = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s) ? s : "";
}

export function sameEmail(a, b) {
  const x = normalizeEmail(a);
  return x !== "" && x === normalizeEmail(b);
}

/** "pat.lee@example.com" becomes "Pat Lee", for a first guess at a person's name. */
export function nameFromEmail(email) {
  const local = String(email || "").split("@")[0].replace(/\+.*$/, "");
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Case-insensitive comparison of two labels such as category or status names. */
export function sameLabel(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/**
 * Text that a spreadsheet would read as a formula (it starts with =, +, -, or @) gets a
 * leading apostrophe, so a ticket can never run a formula in the help desk's workbook.
 * Text that itself starts with an apostrophe gets one too, because Sheets drops the first.
 */
export function sheetSafe(value) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r']/.test(value) ? "'" + value : value;
}

/** Reverses sheetSafe for text read back from a spreadsheet. */
export function sheetRead(value) {
  if (typeof value !== "string") return value;
  return /^'[=+\-@\t\r']/.test(value) ? value.slice(1) : value;
}

/** A valid #RRGGBB color, or the fallback. */
export function hexColor(value, fallback) {
  const s = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
  return fallback;
}

/** A web address that starts with https:// (or http://), or "". Blocks javascript: and data: links. */
export function safeUrl(value) {
  const s = String(value || "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
}

/** WCAG relative luminance of a #RRGGBB color. */
export function luminance(hex) {
  const h = hexColor(hex, "#000000").slice(1);
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio between two #RRGGBB colors. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black, whichever reads better on the given background color. */
export function readableOn(background) {
  return contrast("#FFFFFF", background) >= contrast("#14201A", background) ? "#FFFFFF" : "#14201A";
}

/**
 * Darkens a color step by step until white text on it reaches a contrast of 4.5:1.
 * Gmail draws filled buttons with white text, so their background must be this dark.
 */
export function buttonColor(color) {
  let c = hexColor(color, "#2F4F40");
  for (let i = 0; i < 40 && contrast("#FFFFFF", c) < 4.5; i++) {
    const h = c.slice(1);
    c = "#" + [0, 2, 4].map((k) => Math.floor(parseInt(h.slice(k, k + 2), 16) * 0.92).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return c;
}

/**
 * A background and a text color for an organization's accent color, always readable together:
 * the accent with white or near-black text when one of them reaches 4.5:1, otherwise a darker
 * shade of the accent with white text.
 */
export function accentFor(color) {
  const c = hexColor(color, "#2F4F40");
  const text = readableOn(c);
  if (contrast(text, c) >= 4.5) return { background: c, text };
  return { background: buttonColor(c), text: "#FFFFFF" };
}

/** An ISO time string for a Date, a time in milliseconds, or an ISO string; "" when not a date. */
export function toIso(value) {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Milliseconds for an ISO string or Date; NaN when it is not a date. */
export function toMs(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const d = value instanceof Date ? value : new Date(value);
  return d.getTime();
}

/** "3 tickets" or "1 ticket". */
export function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many || one + "s");
}
