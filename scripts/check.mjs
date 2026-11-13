/**
 * The automated checks. Run with: npm run check   (after npm run build)
 *
 *  1. House style: no em dashes in any text file.
 *  2. Generated files are up to date with their sources (the same comparison the GitHub
 *     workflow makes), and the generated XML and JSON are well formed.
 *  3. Area tests in scripts/tests/, one file per area:
 *       core      the shared rules: settings, tickets, due times, assignment, queues, email
 *       gmail     the Gmail add-on in a simulated Apps Script, Standard and Private installs
 *       web       the web app's service, the demo, and the Microsoft 365 backend against a
 *                 simulated Microsoft Graph
 *       pages     the website: links, scripts, and page basics
 *       colors    every text and background pair in both themes meets WCAG contrast
 *       packages  the download packages and their guides
 *       ui        the real screens driven in headless Chrome, when Chrome can be started
 *
 *  npm run check -- --only=gmail   runs just scripts/tests/gmail.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7) || null;
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log("  FAIL " + msg);
  // On GitHub Actions, each failure also becomes an annotation, which anyone can read on the
  // run's page and through the public checks API, without downloading the log.
  if (process.env.GITHUB_ACTIONS) console.log("::error title=npm run check::" + String(msg).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").slice(0, 1500));
};
const ok = (msg) => console.log("  ok   " + msg);
const note = (msg) => {
  console.log("  note " + msg);
  if (process.env.GITHUB_ACTIONS) console.log("::notice title=npm run check::" + String(msg).slice(0, 1500));
};

/** check(condition, "what should be true") records a failure when it is not. */
const check = (condition, what) => {
  if (!condition) fail(what);
  return !!condition;
};

let xmllint = true;
try {
  execFileSync("xmllint", ["--version"], { stdio: "ignore" });
} catch (e) {
  xmllint = false;
}
const wellFormed = (xml, label) => {
  if (!xmllint) return true;
  try {
    execFileSync("xmllint", ["--noout", "-"], { input: xml, stdio: ["pipe", "ignore", "pipe"] });
    return true;
  } catch (e) {
    fail(`${label}: ${String(e.stderr || e.message).split("\n")[0]}`);
    return false;
  }
};

async function runAreaTests() {
  const testDir = path.join(ROOT, "scripts/tests");
  const files = fs.readdirSync(testDir).filter((f) => f.endsWith(".mjs")).sort();
  for (const f of files) {
    if (ONLY && !f.startsWith(ONLY)) continue;
    console.log("Tests: " + f.replace(/\.mjs$/, ""));
    const before = failures;
    try {
      const mod = await import(pathToFileURL(path.join(testDir, f)).href);
      const summary = await mod.run({ ROOT, fail, ok, note, check, load, wellFormed, xmllint });
      if (failures === before && summary) {
        ok(summary);
        // On GitHub Actions the summary of each area is shown on the run's page too.
        if (process.env.GITHUB_ACTIONS) console.log("::notice title=" + f.replace(/\.mjs$/, "") + "::" + summary);
      }
    } catch (e) {
      fail(`${f}: ${(e && e.stack) || e}`);
    }
  }
}

if (!ONLY) {
  // 1. House style ------------------------------------------------------------
  console.log("House style");
  {
    const skip = new Set([".git", "node_modules"]);
    const textExt = /\.(js|mjs|gs|html|css|json|md|xml|txt|svg|yml)$/i;
    const bad = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (textExt.test(e.name) && fs.readFileSync(p, "utf8").includes(String.fromCharCode(0x2014))) bad.push(path.relative(ROOT, p));
      }
    };
    walk(ROOT);
    bad.length ? bad.forEach((f) => fail("em dash in " + f)) : ok("no em dashes");
  }

  // 2. Generated files --------------------------------------------------------
  console.log("Generated files");
  {
    const { outputs } = await load("scripts/build.mjs");
    const fresh = outputs();
    let stale = 0;
    for (const file of Object.keys(fresh)) {
      const target = path.join(ROOT, file);
      const want = Buffer.from(fresh[file]);
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(want)) {
        stale++;
        fail(`${file} is missing or out of date; run npm run build`);
      }
    }
    if (!xmllint) note("xmllint not found; XML is checked for structure only");
    wellFormed(fresh["docs/outlook/manifest.xml"], "docs/outlook/manifest.xml");
    for (const file of Object.keys(fresh).filter((f) => f.endsWith(".json"))) {
      try {
        JSON.parse(fresh[file]);
      } catch (e) {
        fail(`${file} is not valid JSON: ${e.message}`);
      }
    }
    if (!stale) ok(`${Object.keys(fresh).length} generated files match their sources`);
  }
}

// 3. Area tests ---------------------------------------------------------------
await runAreaTests();

console.log(failures ? `\n${failures} problem${failures > 1 ? "s" : ""} found.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
