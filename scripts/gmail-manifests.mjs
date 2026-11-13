/**
 * The three Apps Script manifests (appsscript.json), one per project:
 *
 *   standard  One project holds everything. The add-on reads and writes the Sheet as the
 *             person using Gmail.
 *   addon     Private install, the add-on project. It only talks to the service.
 *   service   Private install, the web app that owns the Sheet and sends the email.
 *
 * Each asks for the fewest permissions (scopes) its code needs.
 */
import { NAME, SITE_URL } from "./site.config.mjs";

const SCOPE = "https://www.googleapis.com/auth/";

/** Each scope with the reason for it, shown on the privacy and install pages. */
export const GMAIL_SCOPES = {
  standard: [
    ["gmail.addons.execute", "Run as a Gmail add-on."],
    ["userinfo.email", "Know your email address, so your requests are yours."],
    ["spreadsheets", "Read and write the help desk's Google Sheet."],
    ["script.send_mail", "Send the help desk's email notices from your account."],
  ],
  addon: [
    ["gmail.addons.execute", "Run as a Gmail add-on."],
    ["userinfo.email", "Know your email address, so your requests are yours."],
    ["openid", "Prove to the help desk service who you are."],
    ["script.external_request", "Talk to the help desk service, and to nothing else."],
  ],
  service: [
    ["userinfo.email", "Know which account owns the help desk."],
    ["spreadsheets", "Read and write the help desk's Google Sheet."],
    ["script.send_mail", "Send the help desk's email notices from the owner's account."],
    ["script.external_request", "Ask Google to check each sign-in token, and nothing else."],
  ],
};

const scopeUrl = (s) => (s === "openid" ? "openid" : SCOPE + s);

function addOn() {
  return {
    common: {
      name: NAME,
      logoUrl: `${SITE_URL}/assets/icons/icon-128.png`,
      layoutProperties: { primaryColor: "#2F4F40", secondaryColor: "#2F4F40" },
      homepageTrigger: { runFunction: "onHomepage", enabled: true },
    },
    gmail: {},
  };
}

export function gmailManifest(kind) {
  const base = { timeZone: "America/New_York", dependencies: {}, exceptionLogging: "STACKDRIVER", runtimeVersion: "V8", oauthScopes: GMAIL_SCOPES[kind].map((s) => scopeUrl(s[0])) };
  if (kind === "standard") base.addOns = addOn();
  if (kind === "addon") {
    base.urlFetchWhitelist = ["https://script.google.com/", "https://script.googleusercontent.com/"];
    base.addOns = addOn();
  }
  if (kind === "service") {
    base.urlFetchWhitelist = ["https://oauth2.googleapis.com/"];
    base.webapp = { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" };
  }
  return JSON.stringify(base, null, 2) + "\n";
}

/** Which source files go into each project. Core.gs is generated from docs/app/core. */
export const GMAIL_FILES = {
  standard: ["Addon.gs", "Cards.gs", "Core.gs", "Service.gs", "SettingsCards.gs", "Store.gs"],
  addon: ["Addon.gs", "Cards.gs", "Core.gs", "SettingsCards.gs"],
  service: ["Core.gs", "Service.gs", "Store.gs"],
};
