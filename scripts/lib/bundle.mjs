/**
 * A tiny bundler for the shared modules in docs/app/core.
 *
 * Apps Script cannot load ES modules, so the build turns the core modules into one file,
 * Core.gs, that defines a single global named Core. Each module is wrapped in its own function
 * scope, its imports become reads from the modules it depends on, and its exports become the
 * scope's return value. Core is every module's exports merged into one object.
 *
 * It only understands the plain forms the core uses:
 *   import { a, b } from "./x.js";        (on one line)
 *   export function / const / let / class
 */
import fs from "node:fs";
import path from "node:path";

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?[ \t]*$/gm;

export function bundleCore(entries, options = {}) {
  const globalName = options.globalName || "Core";
  const order = [];
  const seen = new Set();
  const idFor = (file) => "__m_" + path.basename(file).replace(/[^A-Za-z0-9]/g, "_");

  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) visit(path.resolve(path.dirname(file), m[2]));
    order.push(file);
  }
  entries.forEach(visit);

  const owner = new Map();
  const parts = order.map((file) => {
    const name = path.basename(file);
    let src = fs.readFileSync(file, "utf8");
    if (/^export\s+default\b/m.test(src)) throw new Error(`${name}: default exports are not supported by the bundler`);
    if (/^import\s+(?!\{)/m.test(src)) throw new Error(`${name}: only named imports are supported by the bundler`);
    src = src.replace(IMPORT_RE, (all, names, from) => {
      const target = idFor(path.resolve(path.dirname(file), from));
      const fields = names
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => n.replace(/\s+as\s+/, ": "));
      return `const { ${fields.join(", ")} } = ${target};`;
    });
    if (/^\s*import\b/m.test(src)) throw new Error(`${name}: an import form the bundler does not understand (keep each import on one line)`);
    const exported = [];
    src = src.replace(/^export\s+((?:async\s+)?(?:function\*?|const|let|class))\s+([A-Za-z_$][\w$]*)/gm, (all, kind, id) => {
      exported.push(id);
      return `${kind} ${id}`;
    });
    if (/^\s*export\b/m.test(src)) throw new Error(`${name}: an export form the bundler does not understand`);
    for (const id of exported) {
      if (owner.has(id)) throw new Error(`"${id}" is exported by both ${owner.get(id)} and ${name}; names must be unique across the core`);
      owner.set(id, name);
    }
    return `// ---- ${name} ----\nconst ${idFor(file)} = (() => {\n${src.trim()}\nreturn { ${exported.join(", ")} };\n})();`;
  });

  const banner = options.banner ? options.banner.trim() + "\n" : "";
  return `${banner}var ${globalName} = (function () {\n"use strict";\n${parts.join("\n\n")}\n\nreturn Object.assign({}, ${order.map(idFor).join(", ")});\n})();\n`;
}
