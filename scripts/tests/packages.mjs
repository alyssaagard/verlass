/**
 * Tests for the download packages: each holds exactly the files its guide describes, the files
 * are the built ones, and the committed zips match a fresh build.
 */
import fs from "node:fs";
import path from "node:path";

/** Reads the names and contents of a stored (uncompressed) zip. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let pos = 0;
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const method = view.getUint16(pos + 8, true);
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    if (method !== 0) throw new Error("unexpected compression in " + name);
    const start = pos + 30 + nameLen + extraLen;
    out[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    pos = start + size;
  }
  return out;
}

export async function run({ ROOT, check, load, wellFormed }) {
  const B = await load("scripts/build.mjs");
  const config = await load("scripts/site.config.mjs");
  const { GMAIL_FILES } = await load("scripts/gmail-manifests.mjs");
  const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  const read = (name) => new Uint8Array(fs.readFileSync(path.join(ROOT, "docs/download", name)));

  const builds = {
    [`${config.SLUG}-gmail.zip`]: B.gmailPackage(),
    [`${config.SLUG}-gmail-private.zip`]: B.gmailPrivatePackage(),
    [`${config.SLUG}-outlook.zip`]: B.outlookPackage(),
  };
  for (const name of Object.keys(builds)) {
    check(fs.existsSync(path.join(ROOT, "docs/download", name)) && Buffer.from(read(name)).equals(Buffer.from(builds[name])), `docs/download/${name} matches a fresh build`);
    check(Buffer.from(builds[name]).equals(Buffer.from(name.includes("private") ? B.gmailPrivatePackage() : name.includes("outlook") ? B.outlookPackage() : B.gmailPackage())), `${name} builds the same bytes every time`);
  }

  const standard = unzip(builds[`${config.SLUG}-gmail.zip`]);
  eq(Object.keys(standard).sort(), [...GMAIL_FILES.standard, "LICENSE.txt", "README.txt", "appsscript.json"].sort(), "the Standard package's files");
  const priv = unzip(builds[`${config.SLUG}-gmail-private.zip`]);
  eq(Object.keys(priv).sort(), [...GMAIL_FILES.service.map((f) => "service/" + f), "service/appsscript.json", ...GMAIL_FILES.addon.map((f) => "addon/" + f), "addon/appsscript.json", "LICENSE.txt", "README.txt"].sort(), "the Private package's files");
  const outlook = unzip(builds[`${config.SLUG}-outlook.zip`]);
  eq(Object.keys(outlook).sort(), ["LICENSE.txt", "README.txt", `${config.SLUG}-manifest.xml`], "the Outlook package's files");
  for (const pkg of [standard, priv, outlook]) check(/MIT License/.test(pkg["LICENSE.txt"]) && pkg["LICENSE.txt"].includes(config.PROVIDER), "each package carries the MIT License with the copyright holder");
  for (const [name, text] of Object.entries(standard)) if (name.endsWith(".gs")) check(/Copyright \(c\) 2026 .+\. MIT License; see LICENSE\./.test(text.slice(0, 1500)), `${name} names its copyright holder and license`);
  for (const pkg of [standard, priv, outlook]) for (const [name, text] of Object.entries(pkg)) check(!/\r/.test(text), `${name} uses LF line endings`);

  // The guides name every file, and the files are the built ones.
  for (const f of Object.keys(standard)) check(f === "README.txt" || standard["README.txt"].includes(f), `the Standard guide mentions ${f}`);
  for (const f of Object.keys(priv)) check(f === "README.txt" || priv["README.txt"].includes(path.basename(f)), `the Private guide mentions ${path.basename(f)}`);
  check(outlook["README.txt"].includes(`${config.SLUG}-manifest.xml`), "the Outlook guide mentions the manifest");
  eq(standard["Core.gs"], fs.readFileSync(path.join(ROOT, "gmail/Core.gs"), "utf8"), "the packaged Core.gs is the built one");
  eq(standard["appsscript.json"], fs.readFileSync(path.join(ROOT, "gmail/appsscript.json"), "utf8"), "the packaged manifest is the built one");
  for (const f of ["Addon.gs", "Cards.gs", "SettingsCards.gs"]) eq(priv["addon/" + f], fs.readFileSync(path.join(ROOT, "gmail", f), "utf8"), `the Private add-on's ${f} is the source file`);
  check(!("addon/Store.gs" in priv) && !("addon/Service.gs" in priv), "the Private add-on holds no storage or service code");
  check(!/SpreadsheetApp|MailApp/.test(priv["addon/Addon.gs"] + priv["addon/Cards.gs"] + priv["addon/SettingsCards.gs"]), "the Private add-on's own code never touches spreadsheets or mail");
  for (const [name, text] of Object.entries({ ...standard, ...priv })) {
    if (name.endsWith(".json")) {
      try {
        JSON.parse(text);
      } catch (e) {
        check(false, `${name} is not valid JSON`);
      }
    }
  }
  wellFormed(outlook[`${config.SLUG}-manifest.xml`], "the packaged Outlook manifest");
  for (const guide of [standard["README.txt"], priv["README.txt"], outlook["README.txt"]]) {
    check(guide.includes(config.NAME + " " + config.VERSION) && guide.includes(config.PROVIDER) && guide.includes(config.SITE_URL), "each guide names the product, version, author, and site");
    // A line may run past 80 columns only when it is one unbreakable address.
    const tooLong = guide.split("\n").filter((line) => line.length > 80 && line.trim().split(/\s+/).length > 1);
    check(tooLong.length === 0, "a guide line is longer than 80 columns: " + (tooLong[0] || "").slice(0, 60));
  }
  const host = new URL(config.SITE_URL).host;
  check(outlook["README.txt"].includes(`brk-multihub://${host}`) && (outlook[`${config.SLUG}-manifest.xml`].match(/\/app\/outlook\.html"/g) || []).length === 3, "the Outlook guide's by-hand steps match the manifest");

  // Core.gs defines one global and parses as a script.
  const vm = await import("node:vm");
  const context = vm.createContext({});
  vm.runInContext(standard["Core.gs"], context);
  check(typeof context.Core === "object" && typeof context.Core.planCreate === "function" && typeof context.Core.normalizeSettings === "function", "Core.gs defines the Core object");
  eq(Object.keys(context).filter((k) => k !== "Core"), [], "Core.gs adds no other global names");
  for (const f of ["Addon.gs", "Cards.gs", "Service.gs", "SettingsCards.gs", "Store.gs"]) {
    try {
      new vm.Script(standard[f], { filename: f });
    } catch (e) {
      check(false, `${f} does not parse: ${e.message}`);
    }
    // Apps Script's V8 is older than Node's. Keep to syntax it is known to accept.
    check(!/\?\.|\?\?|\bmatchAll\b|\breplaceAll\b|\.at\(|\bObject\.fromEntries\b/.test(standard[f]), `${f} uses only syntax Apps Script is known to accept`);
  }
  check(!/\?\.[A-Za-z_(\[]|\?\?|\bmatchAll\b|\breplaceAll\b|\.at\(|\bObject\.fromEntries\b/.test(standard["Core.gs"]), "Core.gs uses only syntax Apps Script is known to accept");
  return "three packages hold the right files and match a fresh build";
}
