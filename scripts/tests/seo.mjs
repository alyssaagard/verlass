/**
 * Search engine and link preview checks for the website.
 *
 *  1. Every public page has one title, one description, and one canonical address of its own,
 *     of a length search results show in full, and its tags match a fresh build.
 *  2. The pictures, icons, and web manifest the tags point to exist, the icons are square and
 *     the sizes they claim, and the structured data is valid JSON with the expected types.
 *  3. The sitemap lists exactly the public pages, robots.txt allows everything and points to
 *     the sitemap, and every other HTML page asks to be left out of search results.
 *
 * Run with: node scripts/check.mjs --only=seo
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import fs from "node:fs";
import path from "node:path";

/** Width and height from a PNG file's header. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return b.slice(1, 4).toString() === "PNG" ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
}

export async function run({ ROOT, check, load }) {
  const { SEO_PAGES, SOCIAL_IMAGE, SITE_NAME, THEME_COLORS } = await load("scripts/seo.config.mjs");
  const pages = await load("scripts/pages.mjs");
  const { SITE_URL, PROVIDER } = await load("scripts/site.config.mjs");
  const docs = path.join(ROOT, "docs");
  const read = (f) => fs.readFileSync(path.join(docs, f), "utf8");
  const count = (text, re) => (text.match(re) || []).length;

  // 1 and 2. Tags on every public page --------------------------------------------------------
  const titles = new Set();
  const descriptions = new Set();
  for (const page of SEO_PAGES) {
    const where = page.file;
    if (!check(fs.existsSync(path.join(docs, page.file)), `${where} exists`)) continue;
    const html = read(page.file);
    const head = html.slice(0, html.indexOf("</head>"));
    check(count(head, /<title>/g) === 1, `${where} has exactly one title`);
    check(count(head, /<meta name="description"/g) === 1, `${where} has exactly one description`);
    check(count(head, /<link rel="canonical"/g) === 1 && head.includes(`<link rel="canonical" href="${SITE_URL}/${page.path}">`), `${where} has the canonical address ${SITE_URL}/${page.path}`);
    check(page.title.length <= 60, `${where}: the title has ${page.title.length} characters; search results show about 60`);
    check(page.description.length >= 70 && page.description.length <= 160, `${where}: the description has ${page.description.length} characters; keep it between 70 and 160`);
    check(/^[A-Z].*\.$/.test(page.description) && !/,\s*,|\|/.test(page.description), `${where}: the description is a plain sentence`);
    check(!titles.has(page.title) && !descriptions.has(page.description), `${where}: its title and description are its own`);
    titles.add(page.title);
    descriptions.add(page.description);
    check(head.includes(pages.seoBlock(page)), `${where}: its search tags match a fresh build; run npm run build`);
    check(!/name="robots" content="[^"]*noindex/.test(head) && head.includes('<meta name="robots" content="index, follow, max-image-preview:large">'), `${where} asks to be indexed, with large image previews`);
    check(head.includes(`<meta name="author" content="${PROVIDER}">`), `${where} names ${PROVIDER} as the author`);
    check(!/<meta name="keywords"/i.test(head), `${where} has no keywords tag`);
    for (const prop of ["og:type", "og:site_name", "og:title", "og:description", "og:url", "og:image", "og:image:width", "og:image:height", "og:image:alt"]) check(count(head, new RegExp(`property="${prop}"`, "g")) === 1, `${where} has one ${prop} tag`);
    for (const name of ["twitter:card", "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt"]) check(count(head, new RegExp(`name="${name}"`, "g")) === 1, `${where} has one ${name} tag`);
    check(head.includes(`content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)"`) && head.includes(`content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)"`), `${where} has theme colors for dark and light`);
    for (const m of head.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"(?: type="[^"]+")?(?: sizes="(\d+)x(\d+)")?/g)) {
      const file = path.join(docs, path.dirname(page.file), m[1]);
      if (!check(fs.existsSync(file), `${where}: ${m[1]} exists`)) continue;
      if (m[2]) {
        const size = pngSize(file);
        check(size && size.w === Number(m[2]) && size.h === Number(m[3]), `${where}: ${m[1]} is ${m[2]} by ${m[3]} pixels as it claims`);
      }
    }
    const ld = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    if (page.schema) {
      check(ld.length === 1, `${where} has one block of structured data`);
      let data = null;
      try {
        data = JSON.parse(ld[0][1]);
      } catch (e) {
        check(false, `${where}: its structured data is valid JSON (${e.message})`);
      }
      if (data) {
        check(data["@context"] === "https://schema.org", `${where}: structured data uses the schema.org context`);
        const types = (data["@graph"] || [data]).map((n) => n["@type"]);
        const want = page.schema === "site" ? ["WebSite", "Person", "SoftwareApplication"] : ["WebApplication"];
        check(JSON.stringify(types) === JSON.stringify(want), `${where}: structured data describes ${want.join(", ")} (found ${types.join(", ")})`);
        const app = (data["@graph"] || [data]).find((n) => /Application$/.test(n["@type"]));
        check(app.isAccessibleForFree === true && app.offers && app.offers.price === "0" && app.applicationCategory === "BusinessApplication", `${where}: the application is described as free business software`);
        if (page.schema === "site") check(app.license === "https://opensource.org/licenses/MIT" && /Gmail/.test(app.operatingSystem) && /Outlook/.test(app.operatingSystem), `${where}: the software is MIT licensed and names the Gmail add-on and the Outlook add-in`);
      }
    } else check(ld.length === 0, `${where} has no structured data`);
  }

  const social = path.join(docs, SOCIAL_IMAGE.path);
  if (check(fs.existsSync(social), `the link preview picture ${SOCIAL_IMAGE.path} exists`)) {
    const size = pngSize(social);
    check(size && size.w === SOCIAL_IMAGE.width && size.h === SOCIAL_IMAGE.height, `the link preview picture is ${SOCIAL_IMAGE.width} by ${SOCIAL_IMAGE.height} pixels`);
  }
  for (const f of ["favicon.ico", "favicon.svg", "apple-touch-icon.png"]) check(fs.existsSync(path.join(docs, f)), `${f} exists`);
  const touch = pngSize(path.join(docs, "apple-touch-icon.png"));
  check(touch && touch.w === touch.h && touch.w >= 180, "the apple-touch-icon is square and at least 180 pixels");
  const manifest = JSON.parse(read("site.webmanifest"));
  check(manifest.name.startsWith(SITE_NAME) && manifest.short_name === SITE_NAME && manifest.theme_color === THEME_COLORS.dark, "site.webmanifest names the site and its color");
  check(manifest.icons.some((i) => Number(i.sizes.split("x")[0]) >= 192), "site.webmanifest has an icon of at least 192 pixels");
  for (const icon of manifest.icons) {
    const file = path.join(docs, icon.src);
    if (!check(fs.existsSync(file), `site.webmanifest: ${icon.src} exists`)) continue;
    const size = pngSize(file);
    check(size && `${size.w}x${size.h}` === icon.sizes, `site.webmanifest: ${icon.src} is ${icon.sizes}`);
  }

  // 3. Sitemap, robots.txt, and pages kept out of search results ---------------------------------
  const sitemap = read("sitemap.xml");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(locs.join("\n") === SEO_PAGES.map((p) => `${SITE_URL}/${p.path}`).join("\n"), "sitemap.xml lists exactly the public pages, in order");
  check(sitemap === pages.sitemapXml() && read("robots.txt") === pages.robotsTxt() && read("site.webmanifest") === pages.webManifest(), "sitemap.xml, robots.txt, and site.webmanifest match a fresh build");
  const robots = read("robots.txt");
  check(/^User-agent: \*$/m.test(robots) && /^Allow: \/$/m.test(robots) && !/^Disallow:/m.test(robots) && robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), "robots.txt allows everything and points to the sitemap");
  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".html")) all.push(path.relative(docs, full).split(path.sep).join("/"));
    }
  };
  walk(docs);
  const publicFiles = new Set(SEO_PAGES.map((p) => p.file));
  for (const f of all) {
    if (publicFiles.has(f)) continue;
    check(/<meta name="robots" content="noindex/.test(read(f)), `${f} is not in scripts/seo.config.mjs, so it carries <meta name="robots" content="noindex">`);
    check(!/<link rel="canonical"/.test(read(f)), `${f} has no canonical address`);
  }
  return `${SEO_PAGES.length} public pages each have their own title, description, address, icons, and preview; the sitemap lists them, and the ${all.length - publicFiles.size} other pages stay out of search results`;
}
