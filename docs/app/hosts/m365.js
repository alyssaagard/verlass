/**
 * Starts the help desk for Microsoft 365, in the Outlook task pane (kind "outlook") or in an
 * ordinary browser tab (kind "web"): read the connection settings, sign in, and open the app
 * on the organization's SharePoint lists. Also holds the one-time setup screen.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { h, clear, button, busy, field, initTheme } from "../ui/dom.js";
import { mountApp } from "../ui/app.js";
import { makeService } from "../stores/service.js";
import { makeSharePointBackend, provision } from "../stores/sharepoint.js";
import { makeGraph } from "../stores/graph.js";
import { readConfig, checkConfig, configQuery, scopesFor, setupScopesFor } from "./config.js";
import { makeAuth } from "./auth.js";
import { PRESETS } from "../core/settings.js";

/* global Office */

function safeStorage() {
  try {
    window.localStorage.getItem("x");
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

function shell(root, ...children) {
  root.classList.add("app");
  clear(root).appendChild(h("main", { class: "view" }, h("div", { class: "stack" }, children)));
}

/** The open email in Outlook, or null. Needs only the add-in's "read item" permission. */
async function readOutlookMessage() {
  const item = Office.context.mailbox && Office.context.mailbox.item;
  if (!item || typeof item.subject !== "string" || !item.body) return null;
  const body = await new Promise((resolve) => {
    item.body.getAsync(Office.CoercionType.Text, (r) => resolve(r.status === Office.AsyncResultStatus.Succeeded ? String(r.value || "") : ""));
  });
  const from = item.from || item.sender || {};
  return {
    subject: item.subject.replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, ""),
    body: body.trim(),
    fromEmail: String(from.emailAddress || ""),
    fromName: String(from.displayName || ""),
  };
}

/**
 * options: { kind: "outlook" | "web", name, siteUrl (the product website, for help links) }
 */
export async function startM365(root, options) {
  const o = options;
  initTheme();
  const storage = safeStorage();
  const appBase = new URL(".", window.location.href).href;
  const help = (o.siteUrl || "") + "/install/#outlook";

  if (o.kind === "outlook") await new Promise((resolve) => Office.onReady(() => resolve()));

  const found = readConfig(window.location.search, storage);
  if (!found || !found.ok) {
    connectScreen(root, o, found, help);
    return;
  }
  const config = found.config;
  const scopes = scopesFor(config);

  let auth;
  try {
    let loginHint = "";
    try {
      loginHint = o.kind === "outlook" ? String(Office.context.mailbox.userProfile.emailAddress || "") : "";
    } catch (e) {
      loginHint = "";
    }
    auth = await makeAuth(config, { kind: o.kind, appBase, loginHint });
  } catch (e) {
    shell(root, h("h1", { text: "Sign-in could not start" }), h("div", { class: "notice bad" }, h("p", { text: String((e && e.message) || e) })), h("p", {}, h("a", { href: help, target: "_blank", rel: "noopener" }, "Open the install guide")));
    return;
  }

  let appRef = null;
  let banner = null;
  /** Shows a bar with a Sign in again button. Sign-in windows only open from a button press. */
  const askToSignIn = () => {
    if (banner) return;
    const go = button("Sign in again", () =>
      busy(go, async () => {
        try {
          await auth.interactive(scopes);
          banner.remove();
          banner = null;
          // Keep the screen and anything typed on it; the person simply sends it again.
          if (appRef && appRef.boot) appRef.toast("You are signed in again. Please try once more.");
          else if (appRef) await appRef.home();
        } catch (e) {
          go.textContent = "Sign in again";
        }
      }), "primary");
    banner = h("div", { class: "notice signin", role: "alert" }, h("p", { text: "Your Microsoft 365 sign-in has ended." }), go);
    root.insertBefore(banner, root.firstChild);
  };
  /** A token without opening a window. When that is not possible, ask the person to sign in again. */
  const getToken = async (wanted) => {
    const token = await auth.silent(wanted || scopes);
    if (token && banner) {
      banner.remove();
      banner = null;
    }
    if (token) return token;
    if (auth.mode === "dialog") return auth.interactive(wanted || scopes); // The Office dialog may open by itself.
    askToSignIn();
    throw new Error("Your Microsoft 365 sign-in has ended. Select Sign in again.");
  };

  const open = async () => {
    const backend = makeSharePointBackend({ siteUrl: config.site, getToken, scopes, sendMail: config.mail !== "off" });
    const service = makeService(backend);
    const ctx = { backend, service, auth, config, name: o.name, siteUrl: o.siteUrl, help };
    const mount = () =>
      (appRef = mountApp(root, {
        service,
        host: {
          kind: o.kind,
          name: o.name,
          siteUrl: o.siteUrl,
          // Always offered in Outlook: with a pinned pane the open message changes, and
          // readOutlookMessage answers null when there is none.
          readMessage: o.kind === "outlook" ? readOutlookMessage : undefined,
          signOut: auth.signOut || undefined,
          setupScreen: (app) => setupView(Object.assign({ onDone: () => app.home() }, ctx)),
        },
      }));
    try {
      await backend.status();
      mount();
    } catch (e) {
      // The site cannot be read yet: the add-in has not been given access, or the address is wrong.
      shell(root, setupView(Object.assign({ problem: String((e && e.message) || e), onDone: mount }, ctx)));
    }
  };

  let token = null;
  let startProblem = "";
  try {
    token = await auth.silent(scopes);
  } catch (e) {
    startProblem = String((e && e.message) || e);
  }
  if (token) {
    await open();
    return;
  }
  const problem = h("div", { class: "notice bad", hidden: !startProblem, role: "alert", text: startProblem });
  const go = button("Sign in with Microsoft", () =>
    busy(go, async () => {
      try {
        await auth.interactive(scopes);
        await open();
      } catch (e) {
        problem.textContent = String((e && e.message) || e);
        problem.hidden = false;
      }
    }), "primary big");
  shell(root, h("h1", { text: o.name }), h("p", { text: "Sign in with your work or school account to open the help desk." }), go, problem, h("p", { class: "muted", text: "If Microsoft says \"Need admin approval\", send your administrator the install guide." }), h("p", {}, h("a", { href: help, target: "_blank", rel: "noopener" }, "Install guide")));
}

/** Shown when the page has no connection settings, or they are not valid. */
function connectScreen(root, o, found, help) {
  const current = (found && found.config) || {};
  const out = [h("h1", { text: "Connect " + o.name + " to Microsoft 365" })];
  if (found && !found.ok) out.push(h("div", { class: "notice bad" }, h("ul", {}, found.errors.map((e) => h("li", { text: e })))));
  if (o.kind === "outlook") {
    out.push(h("p", { text: "This add-in was installed without its connection settings. Ask your administrator to install it again with a manifest made on the install page." }));
    out.push(h("p", {}, h("a", { href: help, target: "_blank", rel: "noopener" }, "Open the install guide")));
    shell(root, ...out);
    return;
  }
  const client = field({ label: "Application (client) ID", name: "client", value: current.client || "", hint: "From your app registration in the Microsoft Entra admin center." });
  const tenant = field({ label: "Directory (tenant) ID", name: "tenant", value: current.tenant && current.tenant !== "organizations" ? current.tenant : "" });
  const site = field({ label: "SharePoint site address", name: "site", type: "url", value: current.site || "", placeholder: "https://contoso.sharepoint.com/sites/helpdesk" });
  const problems = h("div", { class: "notice bad", hidden: true, role: "alert" });
  const go = button("Connect", () => {
    const checked = checkConfig({ client: client.get(), tenant: tenant.get(), site: site.get() });
    if (!checked.ok) {
      clear(problems).appendChild(h("ul", {}, checked.errors.map((e) => h("li", { text: e }))));
      problems.hidden = false;
      return;
    }
    window.location.search = "?" + configQuery(checked.config);
  }, "primary");
  out.push(h("p", { text: "Enter the three values your administrator has from the install guide. They are remembered in this browser." }), client.el, tenant.el, site.el, problems, go, h("p", {}, h("a", { href: help, target: "_blank", rel: "noopener" }, "Install guide")));
  shell(root, ...out);
}

/**
 * The one-time setup for an administrator: give the add-in access to the site, create the
 * three lists, and save the first settings.
 */
function setupView(ctx) {
  const { backend, service, auth, config } = ctx;
  const out = h("div", { class: "stack" });
  const log = h("div", { class: "notice", hidden: true, role: "status" });
  const say = (text, bad) => {
    log.className = "notice" + (bad ? " bad" : "");
    log.textContent = text;
    log.hidden = false;
  };

  const org = field({ label: "Organization name", name: "orgName", hint: "Shown in the header and in email." });
  const preset = field({ label: "Start with lists for", name: "preset", type: "select", options: PRESETS.map((p) => ({ value: p.id, label: p.name })) });

  const lists = button("1. Create the lists", () =>
    busy(lists, async () => {
      try {
        const token = await auth.elevated(setupScopesFor(config));
        const elevated = makeGraph(async () => token);
        const result = await provision(elevated, { siteUrl: config.site, grant: config.access === "selected" ? { clientId: config.client, appName: ctx.name } : null });
        await backend.status(true);
        say((result.granted ? "The add-in now has access to the site. " : "") + (result.created.length ? "Created: " + result.created.join(", ") + "." : "The lists were already there.") + " Now do step 2.");
      } catch (e) {
        say(String((e && e.message) || e) + " This step needs a Global Administrator (or a SharePoint Administrator who can also grant consent to apps) who is an Owner of the site.", true);
      }
    }), "primary");

  const finish = button("2. Create the help desk", () =>
    busy(finish, async () => {
      const result = await service.call("setup", { orgName: org.get(), preset: preset.get() });
      if (!result.ok) {
        say((result.errors || ["Setup did not finish."]).join(" "), true);
        return;
      }
      say("The help desk is ready. Finish the list permissions in the install guide, then open the help desk.");
      done.hidden = false;
    }), "primary");
  const done = button("Open the help desk", () => ctx.onDone(), "primary big", { hidden: true });

  out.append(
    h("h1", { text: "Set up the help desk" }),
    ctx.problem ? h("div", { class: "notice bad" }, h("p", { text: "The help desk's SharePoint site could not be opened yet: " + ctx.problem })) : null,
    h("p", { text: "If you are not an administrator, there is nothing for you to do here. Ask your administrator to finish the setup, then open this panel again." }),
    h(
      "details",
      { class: "group" },
      h("summary", { text: "I am the administrator" }),
      h(
        "div",
        { class: "stack tight" },
        h("p", { text: "Step 1 asks you to approve one higher permission (" + setupScopesFor(config)[0] + "). It is used to " + (config.access === "selected" ? "give this add-in access to the one site and to create three lists on it" : "create three lists on the site") + ", and for nothing else. You need to be an administrator who can approve it (a Global Administrator, or a SharePoint Administrator who can also grant consent) and an Owner of the site." }),
        h("p", { text: "When Microsoft asks, leave \"Consent on behalf of your organization\" unchecked. Afterward, remove this permission again as the install guide's step \"Remove the setup permission\" describes." }),
        h("p", { class: "muted", text: "Site: " + config.site }),
        lists,
        org.el,
        preset.el,
        finish,
        log,
        done,
        h("p", {}, h("a", { href: ctx.help + "-permissions", target: "_blank", rel: "noopener" }, "3. Set who can see what (install guide)"))
      )
    ),
    button("Check again", () => ctx.onDone(), "quiet")
  );
  return out;
}
