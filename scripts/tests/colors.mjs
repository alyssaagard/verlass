/**
 * Contrast tests. Every pair of text color and background the site and app use, in the dark
 * theme and the light theme, must reach 4.5:1 (WCAG AA for text). Focus rings and field
 * borders must reach 3:1 (WCAG AA for interface parts). The colors are read from theme.css,
 * so a changed color is checked without touching this file.
 */
import fs from "node:fs";
import path from "node:path";

export async function run({ ROOT, check, load }) {
  const { contrast, hexColor } = await load("docs/app/core/text.js");
  const css = fs.readFileSync(path.join(ROOT, "docs/assets/theme.css"), "utf8");
  const block = (selector) => {
    const start = css.indexOf(selector + " {");
    if (start === -1) return null;
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    const out = {};
    for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
    return out;
  };
  const themes = { dark: block(":root"), light: block(':root[data-theme="light"]') };
  check(themes.dark && themes.light, "theme.css has a dark block and a light block");
  check(/color-scheme:\s*dark/.test(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")))), "dark is the default theme");

  const TEXT = [
    ...["ink", "ink-soft", "muted", "link", "accent", "warn"].flatMap((fg) => ["bg", "bg-deep", "surface", "raised"].map((bg) => [fg, bg])),
    ["on-accent", "accent"],
    ["on-accent", "accent-hover"],
    ["ink", "sage"],
    ["warn", "warn-bg"],
    ["note", "note-bg"],
  ];
  const PARTS = [
    ["focus", "bg"], ["focus", "surface"], ["focus", "bg-deep"],
    ["line-strong", "bg"], ["line-strong", "surface"], ["line-strong", "bg-deep"], ["line-strong", "raised"],
    ["accent", "bg"], ["accent", "surface"],
  ];
  let lowest = 99;
  for (const [name, t] of Object.entries(themes)) {
    for (const key of Object.keys(themes.dark)) check(t[key], `${name} theme defines --${key}`);
    for (const [fg, bg] of TEXT) {
      const ratio = contrast(t[fg], t[bg]);
      lowest = Math.min(lowest, ratio);
      check(ratio >= 4.5, `${name}: --${fg} ${t[fg]} on --${bg} ${t[bg]} is ${ratio.toFixed(2)}:1, below 4.5:1`);
    }
    for (const [fg, bg] of PARTS) {
      const ratio = contrast(t[fg], t[bg]);
      check(ratio >= 3, `${name}: --${fg} ${t[fg]} against --${bg} ${t[bg]} is ${ratio.toFixed(2)}:1, below 3:1`);
    }
  }

  // The email uses fixed light colors, and the organization's accent with readable text on it.
  const mail = fs.readFileSync(path.join(ROOT, "docs/app/core/mail.js"), "utf8");
  for (const fg of ["#56635B", "#18241D", "#2B5843"]) {
    check(mail.includes(fg), `the email still uses ${fg}`);
    check(contrast(fg, "#FFFFFF") >= 4.5, `email text ${fg} on white is below 4.5:1`);
  }
  const { accentFor, buttonColor } = await load("docs/app/core/text.js");
  for (const accent of ["#2F4F40", "#8FB5A0", "#FFFFFF", "#000000", "#777777", "#808080", "#FFCC00", "#0D47A1", "#B00020", "#4285F4", "#34A853"]) {
    const c = accentFor(accent);
    check(contrast(c.text, c.background) >= 4.5, `email header text on an accent of ${accent} is below 4.5:1`);
    check(contrast("#FFFFFF", buttonColor(accent)) >= 4.5, `white button text on an accent of ${accent} is below 4.5:1`);
  }
  check(accentFor("#2F4F40").background === "#2F4F40" && buttonColor("#2F4F40") === "#2F4F40", "an accent that is already readable is not changed");
  check(hexColor("x", "#123456") === "#123456", "hexColor falls back");
  return `both themes pass; the lowest text contrast is ${lowest.toFixed(2)}:1`;
}
