/**
 * The Microsoft 365 connection settings: which app registration to sign in with and which
 * SharePoint site holds the help desk. They are public identifiers, not secrets.
 *
 * An organization's administrator puts them in the add-in's manifest (the install page makes
 * the manifest), so the task pane opens with them in its address:
 *   outlook.html?client=<application id>&tenant=<tenant id>&site=<site address>&mail=on&access=selected
 * They are also remembered in this browser, so the browser app can be opened without them.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */

const KEY = "helpdesk.m365";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only the worldwide Microsoft 365 cloud is supported: sign-in and Microsoft Graph use its addresses.
const SITE = /^https:\/\/[a-z0-9-]+\.sharepoint\.com(\/[A-Za-z0-9._~\-\/%]*)?$/i;
const TENANT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/** Checks and tidies connection settings. Returns { ok, config, errors }. */
export function checkConfig(raw) {
  const r = raw || {};
  const errors = [];
  const client = String(r.client || "").trim();
  const tenant = String(r.tenant || "").trim();
  const site = String(r.site || "").trim().replace(/\/+$/, "");
  if (!GUID.test(client)) errors.push("The application (client) ID must look like 00000000-0000-0000-0000-000000000000.");
  if (!TENANT.test(tenant)) errors.push("Enter the directory (tenant) ID, or a domain such as contoso.onmicrosoft.com.");
  if (!SITE.test(site)) errors.push("The site address must look like https://contoso.sharepoint.com/sites/helpdesk.");
  const config = {
    client: client.toLowerCase(),
    tenant: tenant.toLowerCase(),
    site,
    mail: String(r.mail || "on").toLowerCase() === "off" ? "off" : "on",
    access: String(r.access || "selected").toLowerCase() === "all" ? "all" : "selected",
  };
  return { ok: errors.length === 0, config, errors };
}

/** The query string that carries a config, for the manifest and for links. */
export function configQuery(config) {
  const p = new URLSearchParams();
  p.set("client", config.client);
  p.set("tenant", config.tenant);
  p.set("site", config.site);
  if (config.mail === "off") p.set("mail", "off");
  if (config.access === "all") p.set("access", "all");
  return p.toString();
}

/** The Graph permissions the help desk asks for with a given config. */
export function scopesFor(config) {
  const scopes = ["User.Read", config.access === "all" ? "Sites.ReadWrite.All" : "Sites.Selected"];
  if (config.mail !== "off") scopes.push("Mail.Send");
  return scopes;
}

/** The higher permission an administrator uses once, during setup only. */
export function setupScopesFor(config) {
  return [config.access === "all" ? "Sites.Manage.All" : "Sites.FullControl.All"];
}

/**
 * Reads the connection settings from the page address, falling back to the ones remembered
 * in this browser. Returns { ok, config, errors } or null when there are none at all.
 */
export function readConfig(search, storage) {
  const q = new URLSearchParams(search || "");
  let raw = null;
  if (q.get("client") || q.get("site")) {
    raw = { client: q.get("client"), tenant: q.get("tenant"), site: q.get("site"), mail: q.get("mail"), access: q.get("access") };
  } else if (storage) {
    try {
      raw = JSON.parse(storage.getItem(KEY) || "null");
    } catch (e) {
      raw = null;
    }
  }
  if (!raw) return null;
  const result = checkConfig(raw);
  if (result.ok && storage) {
    try {
      storage.setItem(KEY, JSON.stringify(result.config));
    } catch (e) {
      // Storage is blocked; the address still carries the settings.
    }
  }
  return result;
}

export function forgetConfig(storage) {
  try {
    storage.removeItem(KEY);
  } catch (e) {
    // Nothing to forget.
  }
}
