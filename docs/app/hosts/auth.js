/**
 * Microsoft 365 sign-in for the help desk, with no server.
 *
 * Three ways to get a Microsoft Graph token, chosen by where the app runs:
 *   nested   Inside Outlook, when Outlook supports nested app authentication. Outlook signs
 *            the person in with the account they already use there. No extra window.
 *   dialog   Inside an older Outlook. A small Office dialog signs in and passes the token back.
 *   popup    In an ordinary browser tab (the browser app). A sign-in window opens once.
 *
 * Uses Microsoft's MSAL.js library (vendor/msal-browser.min.js, the global `msal`).
 * makeAuth returns { mode, silent(scopes), interactive(scopes), elevated(scopes), signOut }.
 *   silent       resolves to a token, or null when the person has to sign in or consent
 *   interactive  signs in with a window; call it from a button press
 *   elevated     a one-time token with a higher permission, for the administrator's setup;
 *                in the browser app it is kept in memory only and never stored
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { configQuery } from "./config.js";

/* global msal, Office */

export async function makeAuth(config, options) {
  const o = options || {};
  const origin = o.origin || window.location.origin;
  const appBase = o.appBase || origin + "/app/";
  const authority = "https://login.microsoftonline.com/" + config.tenant;
  const insideOffice = o.kind === "outlook";

  let nested = false;
  if (insideOffice) {
    try {
      nested = Office.context.requirements.isSetSupported("NestedAppAuth", "1.1");
    } catch (e) {
      nested = false;
    }
  }

  if (insideOffice && !nested) return dialogAuth(config, appBase, o.loginHint);

  const settings = {
    auth: { clientId: config.client, authority, redirectUri: appBase + "blank.html" },
    cache: { cacheLocation: "localStorage" },
  };
  const pca = nested ? await msal.createNestablePublicClientApplication(settings) : await msal.createStandardPublicClientApplication(settings);

  const account = () => (nested ? undefined : pca.getActiveAccount() || pca.getAllAccounts()[0] || undefined);

  async function silent(scopes) {
    const who = account();
    if (!nested && !who) return null;
    try {
      const result = await pca.acquireTokenSilent(who ? { scopes, account: who } : { scopes });
      return result.accessToken;
    } catch (e) {
      // Only an answer that says the person must sign in or consent means the sign-in ended.
      // Anything else, such as a dropped connection, is a problem to report, not a reason to
      // send the person to sign in again.
      if (e instanceof msal.InteractionRequiredAuthError || (e && /interaction_required|login_required|consent_required|no_account|no_tokens_found/i.test(String(e.errorCode || "")))) return null;
      throw new Error("Microsoft 365 could not be reached. Check your connection and try again.");
    }
  }

  async function interactive(scopes) {
    const who = account();
    const result = await pca.acquireTokenPopup(who ? { scopes, account: who } : { scopes, prompt: nested ? undefined : "select_account" });
    if (!nested && result.account) pca.setActiveAccount(result.account);
    return result.accessToken;
  }

  /**
   * The administrator's one-time setup token. In a browser tab it comes from a second sign-in
   * client that keeps everything in memory, so a token with the higher permission is never
   * written to the browser's storage. With nested sign-in, Outlook holds the token. In the
   * Office dialog, the dialog page keeps it in memory too (see the temp flag in auth.html).
   */
  async function elevated(scopes) {
    if (nested) return interactive(scopes);
    const who = account();
    const temporary = await msal.createStandardPublicClientApplication({ auth: settings.auth, cache: { cacheLocation: "memoryStorage" } });
    const result = await temporary.acquireTokenPopup(who ? { scopes, loginHint: who.username } : { scopes, prompt: "select_account" });
    return result.accessToken;
  }

  return {
    mode: nested ? "nested" : "popup",
    silent,
    interactive,
    elevated,
    signOut: nested
      ? null
      : async () => {
          await pca.clearCache();
          window.location.reload();
        },
  };
}

/**
 * The fallback for Outlook versions without nested app authentication: an Office dialog opens
 * auth.html, which signs in and sends the token back. Tokens are kept in memory only.
 */
function dialogAuth(config, appBase, loginHint) {
  const cache = new Map(); // scopes -> { token, expires }
  const key = (scopes) => scopes.slice().sort().join(" ");
  const fresh = (scopes) => {
    const hit = cache.get(key(scopes));
    return hit && hit.expires - Date.now() > 120000 ? hit.token : null;
  };

  /** temporary: keep this sign-in in the dialog's memory only (for the setup permission). */
  function open(scopes, temporary) {
    return new Promise((resolve, reject) => {
      const url = appBase + "auth.html?" + configQuery(config) + "&scopes=" + encodeURIComponent(scopes.join(" ")) + (loginHint ? "&hint=" + encodeURIComponent(loginHint) : "") + (temporary ? "&temp=1" : "");
      Office.context.ui.displayDialogAsync(url, { height: 60, width: 30 }, (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error("The sign-in window could not be opened. Allow pop-up windows for Outlook and try again."));
          return;
        }
        const dialog = result.value;
        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg) => {
          dialog.close();
          let message = null;
          try {
            message = JSON.parse(arg.message);
          } catch (e) {
            message = null;
          }
          if (message && message.ok && message.accessToken) {
            cache.set(key(scopes), { token: message.accessToken, expires: Number(message.expiresOn) || Date.now() + 3000000 });
            resolve(message.accessToken);
          } else {
            reject(new Error((message && message.error) || "Sign-in did not finish."));
          }
        });
        dialog.addEventHandler(Office.EventType.DialogEventReceived, () => reject(new Error("The sign-in window was closed before sign-in finished.")));
      });
    });
  }

  return {
    mode: "dialog",
    silent: async (scopes) => fresh(scopes),
    interactive: open,
    elevated: (scopes) => open(scopes, true),
    signOut: null,
  };
}
