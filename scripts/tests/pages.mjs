/**
 * Tests for the website: every page has the basics, every local link and file it names
 * exists, module scripts use addresses a browser accepts, and the pages say what the code does.
 */
import fs from "node:fs";
import path from "node:path";

export async function run({ ROOT, check, load }) {
  const config = await load("scripts/site.config.mjs");
  const { GMAIL_FILES, GMAIL_SCOPES } = await load("scripts/gmail-manifests.mjs");
  const docs = path.join(ROOT, "docs");
  const pages = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) pages.push(p);
    }
  };
  walk(docs);
  const rel = (p) => path.relative(docs, p);
  check(pages.length >= 11, "the site has its pages (found " + pages.length + ")");
  for (const need of ["index.html", "demo/index.html", "install/index.html", "help/index.html", "privacy/index.html", "terms/index.html", "404.html", "app/index.html", "app/outlook.html", "app/auth.html", "app/blank.html"]) {
    check(fs.existsSync(path.join(docs, need)), `docs/${need} exists`);
  }

  for (const page of pages) {
    const html = fs.readFileSync(page, "utf8");
    const name = rel(page);
    check(html.startsWith("<!DOCTYPE html>") && /<html lang="en"/.test(html), `${name} declares its document type and language`);
    check(/<meta charset="utf-8">/.test(html) && /<title>[^<]{3,}<\/title>/.test(html), `${name} has a character set and a title`);
    if (name === "app/blank.html") continue;
    check(/<meta name="viewport"/.test(html), `${name} has a viewport`);
    const isSite = /class="site"/.test(html);
    if (isSite) {
      check((html.match(/<h1[ >]/g) || []).length === 1, `${name} has exactly one main heading`);
      check(/<meta name="robots" content="noindex">/.test(html) || /<meta name="description" content="[^"]{30,}">/.test(html), `${name} has a description`);
      check(html.includes(config.PROVIDER), `${name} names ${config.PROVIDER}`);
      check(/class="skip"/.test(html) && /id="main"/.test(html), `${name} has a skip link and a main landmark`);
      check(html.indexOf('data-theme="dark"') !== -1 && html.indexOf("localStorage.getItem") < html.indexOf('rel="stylesheet"'), `${name} sets the theme before its styles load, with dark as the default`);
      for (const t of ["dark", "light", "system"]) check(html.includes(`data-theme="${t}">`), `${name} offers the ${t} theme`);
    }
    // Local links, images, styles, and scripts must exist.
    for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|data:|blob:)/.test(target)) continue;
      const file = path.resolve(path.dirname(page), target);
      const resolved = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file;
      check(fs.existsSync(resolved), `${name} links to ${target}, which does not exist`);
    }
    // Browsers only accept module addresses that start with ./, ../, /, or a scheme.
    for (const m of html.matchAll(/\bfrom\s+"([^"]+)"|\bimport\("([^"]+)"\)/g)) {
      m[1] = m[1] || m[2];
      check(/^(\.\.?\/|\/|https:)/.test(m[1]), `${name} imports "${m[1]}", which a browser will not resolve`);
      if (/^\.\.?\//.test(m[1])) check(fs.existsSync(path.resolve(path.dirname(page), m[1])), `${name} imports ${m[1]}, which does not exist`);
    }
    // Anchors used inside the page must exist in it.
    for (const m of html.matchAll(/href="#([^"]+)"/g)) check(new RegExp(`id="${m[1]}"`).test(html), `${name} links to #${m[1]}, which is not on the page`);
    check(!/\bundefined\b|\[object Object\]|NaN/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), `${name} has no unfilled value in its text`);
    for (const m of html.matchAll(/<img\b[^>]*>/g)) check(/\balt="/.test(m[0]), `${name} has an image without alt text`);
  }

  // Every browser module must at least parse, including the ones no other test imports.
  const { execFileSync } = await import("node:child_process");
  const modules = [];
  const walkJs = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== "vendor") walkJs(p);
      else if (e.name.endsWith(".js")) modules.push(p);
    }
  };
  walkJs(path.join(docs, "app"));
  modules.push(path.join(docs, "assets/site.js"));
  for (const file of modules) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      check(false, `${path.relative(docs, file)} does not parse: ${String(e.stderr || e.message).split("\n").find((l) => /Error/.test(l)) || ""}`);
    }
  }

  // Cross-page anchors the app and the guides point at.
  const install = fs.readFileSync(path.join(docs, "install/index.html"), "utf8");
  for (const id of ["gmail", "outlook", "outlook-permissions", "gmail-organization", "gmail-email", "gmail-standard", "gmail-private", "maker"]) check(install.includes(`id="${id}"`), `the install page has the section #${id}`);
  for (const kind of ["standard", "addon", "service"]) {
    for (const file of GMAIL_FILES[kind]) check(install.includes(`<code>${file.replace(".gs", "")}</code>`), `the install page names the file ${file}`);
    for (const [scope] of GMAIL_SCOPES[kind]) check(install.includes(`<code>${scope}</code>`), `the install page lists the permission ${scope}`);
  }
  const host = new URL(config.SITE_URL).host;
  for (const uri of [`brk-multihub://${host}`, `${config.SITE_URL}/app/blank.html`, `${config.SITE_URL}/app/auth.html`]) check(install.includes(uri), `the install page gives the redirect address ${uri}`);
  for (const zip of [`${config.SLUG}-gmail.zip`, `${config.SLUG}-gmail-private.zip`, `${config.SLUG}-outlook.zip`]) check(install.includes(`download/${zip}`) && fs.existsSync(path.join(docs, "download", zip)), `the install page offers ${zip}`);
  for (const p of ["Sites.Selected", "Mail.Send", "User.Read", "ReadItem"]) check(install.includes(p), `the install page explains ${p}`);

  // The help page documents every setting, list, and placeholder that exists.
  const help = fs.readFileSync(path.join(docs, "help/index.html"), "utf8");
  const S = await load("docs/app/core/settings.js");
  const L = await load("docs/app/core/lists.js");
  for (const f of S.GENERAL_FIELDS) check(help.includes(">" + f.label.replace(/&/g, "&amp;") + "<"), `the help page documents the setting "${f.label}"`);
  for (const l of L.LISTS) check(help.includes(">" + l.title + "<"), `the help page documents the list "${l.title}"`);
  for (const p of S.PLACEHOLDERS) check(help.includes("{{" + p + "}}"), `the help page lists the placeholder ${p}`);

  // The pages that sign in load the sign-in library, and only the Outlook pages load Office.js.
  const app = (f) => fs.readFileSync(path.join(docs, "app", f), "utf8");
  check(app("outlook.html").includes("appsforoffice.microsoft.com/lib/1/hosted/office.js") && app("auth.html").includes("office.js") && !app("index.html").includes("office.js"), "Office.js is loaded where Outlook needs it and nowhere else");
  check(["outlook.html", "auth.html", "index.html"].every((f) => app(f).includes("vendor/msal-browser.min.js")), "the sign-in pages load the MSAL library from this site");
  check(!/<script/.test(app("blank.html")), "the pop-up return page is empty");
  check(fs.existsSync(path.join(docs, "CNAME")) ? fs.readFileSync(path.join(docs, "CNAME"), "utf8").trim() === host : true, "docs/CNAME, when present, matches the site address");
  return `${pages.length} pages: links, scripts, anchors, and documented settings all line up`;
}
