/**
 * Drives the real screens in headless Chrome: the scenario in ui-harness.html (a staff member,
 * a team member, and an administrator using the demo help desk), and then the built home,
 * demo, and install pages, to see that their scripts start.
 *
 * Needs Google Chrome, Microsoft Edge, or Chromium. Set CHROME_PATH to choose one. When no
 * browser can be started (for example inside a sandbox, or on a machine without one), the
 * test says so and is skipped; it does not fail.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

export async function run({ ROOT, check, note }) {
  // The GitHub check runs every other area; the browser scenario is run on the maintainer's own
  // computer before a release (see MAINTAINING.md). Set VERLASS_UI=1 to run it on CI as well.
  if (process.env.CI && process.env.VERLASS_UI !== "1") {
    note("the browser tests are not run on CI; run npm run check on your own computer, or set VERLASS_UI=1");
    return "";
  }
  const chrome = CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    note("no Chrome, Edge, or Chromium found; the browser tests were skipped");
    return "";
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "helpdesk-chrome-"));
  const dump = (file, budget) =>
    execFileSync(
      chrome,
      ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--user-data-dir=" + profile, "--allow-file-access-from-files", "--window-size=1100,900", "--virtual-time-budget=" + budget, "--dump-dom", pathToFileURL(file).href],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000, maxBuffer: 64 * 1024 * 1024 }
    );
  try {
    // First make sure the browser can start at all, on a page that does nothing. Only that
    // failure skips the tests; a hang or crash on the real pages is a failure, not a skip.
    const probe = path.join(profile, "probe.html");
    fs.writeFileSync(probe, '<!DOCTYPE html><html><body><pre id="result">[]</pre></body></html>');
    try {
      dump(probe, 1000);
    } catch (e) {
      note("the browser could not be started here; the browser tests were skipped (" + String(e.message).split("\n")[0].slice(0, 80) + ")");
      return "";
    }
    let dom;
    try {
      dom = dump(path.join(ROOT, "scripts/tests/ui-harness.html"), 60000);
    } catch (e) {
      check(false, "the browser scenario finished (" + String(e.message).split("\n")[0].slice(0, 120) + ")");
      return "";
    }
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(dom);
    const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    let results = null;
    try {
      results = JSON.parse(decode(m ? m[1] : ""));
    } catch (e) {
      results = null;
    }
    if (!check(Array.isArray(results) && results.length > 0, "the browser scenario reported its results")) return "";
    for (const r of results) check(r.ok, r.name + (r.detail ? " (" + r.detail + ")" : ""));

    // The built pages: their module scripts must start in a real browser.
    const home = dump(path.join(ROOT, "docs/index.html"), 8000);
    check(/id="demo-app"[^>]*class="app"/.test(home) && home.includes("New request"), "the home page starts the live demo");
    const demo = dump(path.join(ROOT, "docs/demo/index.html"), 8000);
    check(demo.includes("New request") && /data-persona="staff"[^>]*aria-pressed="true"/.test(demo), "the demo page starts the demo as a staff member");
    const install = dump(path.join(ROOT, "docs/install/index.html"), 8000);
    check(/id="gmail" role="tabpanel">/.test(install) && /id="outlook" role="tabpanel" hidden/.test(install) && /aria-selected="true"[^>]*>Gmail/.test(install.replace(/data-hash="[^"]*"/g, "")), "the install page's tabs start on Gmail");
    // A link to a place inside the Outlook guide must open the Outlook tab, not the first one.
    const deep = execFileSync(
      chrome,
      ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--user-data-dir=" + profile, "--allow-file-access-from-files", "--virtual-time-budget=8000", "--dump-dom", pathToFileURL(path.join(ROOT, "docs/install/index.html")).href + "#outlook-permissions"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000, maxBuffer: 64 * 1024 * 1024 }
    );
    check(/id="outlook" role="tabpanel">/.test(deep) && /id="gmail" role="tabpanel" hidden/.test(deep), "a link to the permissions step opens the Outlook tab");
    const web = dump(path.join(ROOT, "docs/app/index.html"), 8000);
    check(/Connect Verlass to Microsoft 365|Connect .* to Microsoft 365/.test(web) && web.includes('name="client"'), "the browser app asks for connection settings when it has none");
    return `${results.length} steps of the staff, team, and administrator scenario pass in ${path.basename(chrome)}, and the built pages start`;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
