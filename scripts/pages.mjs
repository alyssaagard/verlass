/**
 * The website's pages. `npm run build` writes each one into docs/ from the functions here,
 * so the header, footer, name, and addresses are the same everywhere and come from
 * scripts/site.config.mjs.
 */
import { NAME, SLUG, TAGLINE, DESCRIPTION, SITE_URL, VERSION, PROVIDER, REPO_URL, ADDIN_ID, RELEASE_DATE } from "./site.config.mjs";
import { GENERAL_FIELDS, TEMPLATE_KEYS, TEMPLATE_INFO, PLACEHOLDERS, PRESETS } from "../docs/app/core/settings.js";
import { LISTS } from "../docs/app/core/lists.js";
import { GMAIL_SCOPES } from "./gmail-manifests.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sets the theme before the page paints, so there is no flash of the wrong colors. */
const THEME_BOOT = `<script>(function(){var d=document.documentElement;try{var c=localStorage.getItem("helpdesk.theme");if(c!=="light"&&c!=="system")c="dark";var l=c==="light"||(c==="system"&&window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches);d.setAttribute("data-theme",l?"light":"dark");d.setAttribute("data-theme-choice",c)}catch(e){d.setAttribute("data-theme","dark")}})();</script>`;

/**
 * Wraps a page body in the shared shell.
 * page: { path ("" for the home page, "install/" and so on), title, description, current, body, head, scripts }
 */
export function layout(page) {
  const depth = page.path ? page.path.split("/").filter(Boolean).length : 0;
  const root = depth ? "../".repeat(depth) : "./";
  const r = (p) => (root === "./" ? p || "./" : root + p);
  const nav = [
    ["demo/", "Demo"],
    ["install/", "Install"],
    ["help/", "Help"],
  ];
  const title = page.title ? `${page.title} | ${NAME}` : `${NAME} | ${TAGLINE}`;
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(page.description || DESCRIPTION)}">
  <meta name="author" content="${esc(PROVIDER)}">
  <meta property="og:title" content="${esc(page.title ? page.title + " | " + NAME : NAME)}">
  <meta property="og:description" content="${esc(page.description || DESCRIPTION)}">
  <meta property="og:image" content="${SITE_URL}/assets/brand/${SLUG}-social.png">
  <meta property="og:url" content="${SITE_URL}/${page.path || ""}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#141C18">
  <link rel="canonical" href="${SITE_URL}/${page.path || ""}">
  <link rel="icon" href="${r("favicon.ico")}" sizes="any">
  <link rel="icon" href="${r("favicon.svg")}" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${r("apple-touch-icon.png")}">
  ${THEME_BOOT}
  <link rel="stylesheet" href="${r("assets/site.css")}">${page.head ? "\n  " + page.head.replace(/\{root\}/g, root) : ""}
</head>
<body class="site">
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-head">
    <div class="wrap">
      <a class="brand" href="${r("")}" aria-label="${NAME} home"><img src="${r(`assets/brand/${SLUG}-mark.svg`)}" alt="" width="32" height="32"><span>${NAME}</span></a>
      <nav class="nav" aria-label="Main">
        ${nav.map(([href, label]) => `<a href="${r(href)}"${page.current === href ? ' aria-current="page"' : ""}>${label}</a>`).join("\n        ")}
        <a href="${REPO_URL}">GitHub</a>
        <span class="theme-pick" role="group" aria-label="Theme">
          <button type="button" data-theme="dark">Dark</button><button type="button" data-theme="light">Light</button><button type="button" data-theme="system">System</button>
        </span>
      </nav>
    </div>
  </header>

  <main id="main" class="wrap">
${page.body.replace(/\{root\}/g, root)}
  </main>

  <footer class="site-foot">
    <div class="wrap">
      <div>${NAME} ${VERSION} by ${esc(PROVIDER)}. Free and open source under the MIT License.</div>
      <nav aria-label="Footer">
        <a href="${r("privacy/")}">Privacy</a>
        <a href="${r("terms/")}">Terms</a>
        <a href="${r("help/")}">Help</a>
        <a href="${REPO_URL}">Source code</a>
      </nav>
    </div>
  </footer>
  <script type="module" src="${r("assets/site.js")}"></script>${page.scripts ? "\n  " + page.scripts.replace(/\{root\}/g, root) : ""}
</body>
</html>
`;
}

const APP_CSS = `<link rel="stylesheet" href="{root}app/ui/app.css">`;

/** The script that runs the demo help desk inside an element with id "demo-app". */
const DEMO_SCRIPT = `<script type="module">
    // The modules load one by one, so a failure (for example right after a release, while old
    // files are still cached) shows a message instead of an empty pane.
    const pane = document.getElementById("demo-app");
    Promise.all([import("{root}app/ui/app.js"), import("{root}app/stores/service.js"), import("{root}app/stores/demo.js")])
      .then(([ui, svc, demo]) => {
        let storage = null;
        try { storage = window.sessionStorage; storage.getItem("x"); } catch (e) { storage = null; }
        const backend = demo.makeDemoBackend({ storage });
        const app = ui.mountApp(pane, {
          service: svc.makeService(backend),
          host: { kind: "demo", name: "${NAME}", siteUrl: "{root}".replace(/\\/$/, "") || ".", demo: backend, embedded: true, onReset: () => draw() },
        });
        const buttons = Array.from(document.querySelectorAll("[data-persona]"));
        function draw() { buttons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.persona === backend.persona() ? "true" : "false")); }
        buttons.forEach((b) => b.addEventListener("click", async () => { backend.setPersona(b.dataset.persona); draw(); await app.home(); }));
        draw();
        window.__demo = { app, backend };
      })
      .catch(() => {
        pane.textContent = "The demo could not load. Reload the page in a minute.";
        pane.className = "pane-message";
      });
  </script>`;

export function homePage() {
  return layout({
    path: "",
    head: APP_CSS,
    scripts: DEMO_SCRIPT,
    body: `    <section class="hero">
      <div>
        <p class="kicker">A help desk for Gmail and Outlook</p>
        <h1 class="display">${esc(TAGLINE)}</h1>
        <p class="lead">${NAME} turns the side panel of your email into a help desk. People send a request and follow it without leaving their inbox. Your team sees its queue, assigns work, replies, and keeps notes in the same place. It suits an office of five, a school, a nonprofit, or a company with many sites.</p>
        <div class="btn-row">
          <a class="btn btn-primary" href="demo/">Try the live demo</a>
          <a class="btn" href="install/">Install ${NAME}</a>
        </div>
        <p class="notice small"><strong>Your data stays yours.</strong> Tickets live in a Google Sheet in your own Google account, or in a list in your own Microsoft 365. ${NAME} has no server, no account to create, and no tracking.</p>
      </div>
      <div class="hero-art">
        <div class="pane" role="region" aria-label="A live ${NAME} demo with sample tickets"><div id="demo-app"><noscript><p class="pane-message">The live demo needs JavaScript. The install guide works without it.</p></noscript></div></div>
      </div>
    </section>

    <h2>What it does</h2>
    <div class="grid">
      <div class="card"><h3>Requests from the inbox</h3><p>Anyone in the organization opens ${NAME} beside their mail, describes what they need, and gets a ticket number and email updates. They can reply, close, or reopen their own requests.</p></div>
      <div class="card"><h3>Queues for the team</h3><p>The team works from queues for open, unassigned, assigned to me, overdue, waiting, finished, and all tickets. It can search by number, name, or words, and filter by category, priority, or person.</p></div>
      <div class="card"><h3>Assignment rules</h3><p>Send printer problems to one person and password resets to another, by category, priority, location, or a keyword. Anything else can take turns around the team.</p></div>
      <div class="card"><h3>Due times that respect working hours</h3><p>Each priority has a time allowed. Only your working days and hours count, with your days off skipped, and overdue tickets rise to the top.</p></div>
      <div class="card"><h3>Replies and internal notes</h3><p>Reply to the requester, or leave a note only the team can read. Every change is written to an activity log.</p></div>
      <div class="card"><h3>Email in your words</h3><p>There are seven notices, each with wording you can change and placeholders for the ticket's details. Switches turn them off.</p></div>
      <div class="card"><h3>Made to be changed</h3><p>Categories, priorities, statuses, locations, the team, the word for a ticket, the number format, colors, and logo are all settings. Nobody edits code.</p></div>
      <div class="card"><h3>Create a ticket from an email</h3><p>When someone emails the team instead, open the message and turn it into a ticket in their name.</p></div>
    </div>

    <h2>Where it runs</h2>
    <div class="two-col">
      <div class="card">
        <h3>Gmail and Google Workspace</h3>
        <p>A Google Workspace add-on. Tickets and settings are rows in one Google Sheet. The Private install keeps that Sheet closed to everyone but the help desk, and asks staff for the fewest permissions.</p>
        <p><a href="install/#gmail">Install for Gmail</a></p>
      </div>
      <div class="card">
        <h3>Outlook and Microsoft 365</h3>
        <p>An Outlook add-in for the web, Windows, Mac, and mobile. Tickets are items in a SharePoint list in your own tenant, and each person sees only their own requests.</p>
        <p><a href="install/#outlook">Install for Outlook</a></p>
      </div>
    </div>

    <h2>Free for everyone</h2>
    <p class="lead">${NAME} is free and open source under the MIT License, for personal, commercial, school, and enterprise use. Read the <a href="${REPO_URL}">source code</a>, change it, and run your own copy if you like.</p>
    <p class="notice small"><strong>Version ${VERSION} is new.</strong> It has been tested against simulated Gmail, Google Sheets, and Microsoft 365 services and in a real browser, and has not yet been run in a live Google account or a live Microsoft 365 tenant. Try it with a few people first, and please <a href="${REPO_URL}/issues">report what you find</a>.</p>
    <p class="muted small"><em>Verlass</em> is the German word for dependability. "Auf uns ist Verlass" means "you can count on us."</p>`,
  });
}

export function demoPage() {
  return layout({
    path: "demo/",
    title: "Live demo",
    description: `Try ${NAME} in your browser with sample tickets. No sign-in, and nothing leaves your browser.`,
    current: "demo/",
    head: APP_CSS,
    scripts: DEMO_SCRIPT,
    body: `    <div class="demo-layout">
      <div class="demo-side">
        <p class="kicker">Live demo</p>
        <h1 class="page-title">Try the whole help desk</h1>
        <p class="lead">This is the real ${NAME} panel with sample tickets for an invented organization. It runs entirely in this browser tab: there is no sign-in, and nothing you type is sent anywhere.</p>
        <h2 style="margin-top:32px">Who are you?</h2>
        <div class="persona" role="group" aria-label="Choose who you are in the demo">
          <button type="button" data-persona="staff">Morgan, a staff member<span>Send a request, follow it, reply, and close it.</span></button>
          <button type="button" data-persona="agent">Sam, on the help desk team<span>Work the queues, assign, reply, and keep internal notes.</span></button>
          <button type="button" data-persona="admin">Alex, the administrator<span>Everything Sam can do, plus every setting.</span></button>
        </div>
        <h2 style="margin-top:32px">Things to try</h2>
        <ul class="prose">
          <li>As Morgan, send a new request. Then open the menu (the three dots) and choose <strong>Email outbox</strong> to read the notices a real help desk would have sent.</li>
          <li>As Sam, open the <strong>Overdue</strong> or <strong>Unassigned</strong> queue, assign a ticket to yourself, and reply.</li>
          <li>As Alex, open <strong>Settings</strong>. Rename a category, add a priority, write an assignment rule, or change the wording of an email and watch the preview.</li>
          <li>Switch between Dark, Light, and System at the top of the page or in the menu.</li>
        </ul>
        <p class="muted small">Changes last until you close this tab. Choose <strong>Reset the demo</strong> in the menu to start again.</p>
        <div class="btn-row"><a class="btn btn-primary" href="{root}install/">Install ${NAME}</a></div>
      </div>
      <div class="pane tall" role="region" aria-label="${NAME} demo"><div id="demo-app"><noscript><p class="pane-message">The live demo needs JavaScript. The install guide works without it.</p></noscript></div></div>
    </div>`,
  });
}

// ---------------------------------------------------------------------------
// The app pages (Outlook task pane, browser app, sign-in helpers)
// ---------------------------------------------------------------------------

function appPage(kind) {
  const office = kind === "web" ? "" : `\n  <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>`;
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${NAME}</title>
  <meta name="robots" content="noindex">
  <meta name="author" content="${esc(PROVIDER)}">
  <link rel="icon" href="../favicon.ico" sizes="any">
  ${THEME_BOOT}
  <link rel="stylesheet" href="../assets/theme.css">
  <link rel="stylesheet" href="ui/app.css">${office}
  <script src="vendor/msal-browser.min.js"></script>
  <style>html, body { height: 100%; } #app { min-height: 100%; }</style>
</head>
<body class="app-body">
  <div id="app"><p style="padding:16px;color:#9DAAA2;font-family:sans-serif">Loading ${NAME}...</p></div>
  <noscript><p style="padding:16px">${NAME} needs JavaScript.</p></noscript>
  <script type="module">
    // A failure to load or start shows a message instead of "Loading" forever.
    const root = document.getElementById("app");
    const failed = () => {
      root.textContent = "";
      const p = document.createElement("p");
      p.style.padding = "16px";
      p.textContent = "${NAME} could not load. Close this panel and open it again in a minute.";
      root.appendChild(p);
    };
    import("./hosts/m365.js")
      .then((m) => m.startM365(root, { kind: "${kind}", name: "${NAME}", siteUrl: new URL("..", window.location.href).href.replace(/\\/$/, "") }))
      .catch(failed);
  </script>
</body>
</html>
`;
}

export const outlookPage = () => appPage("outlook");
export const webAppPage = () => appPage("web");

/** The page MSAL returns to after a pop-up sign-in. It must stay empty. */
export function blankPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${NAME}: signing in</title>
  <meta name="robots" content="noindex">
</head>
<body></body>
</html>
`;
}

/**
 * The sign-in dialog for Outlook versions without nested app authentication. Outlook opens it
 * in an Office dialog; it signs in with a redirect and sends the token back to the task pane.
 */
export function authPage() {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${NAME}: sign in</title>
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="../assets/theme.css">
  <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
  <script src="vendor/msal-browser.min.js"></script>
  <style>body { margin: 0; padding: 24px; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--ui); }</style>
</head>
<body>
  <p id="status" role="status">Signing in to Microsoft 365...</p>
  <script>
    (function () {
      var KEY = "helpdesk.auth";
      var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      var TENANT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\\.[a-z0-9-]+)+)$/i;
      var status = document.getElementById("status");
      function send(message) {
        try {
          Office.context.ui.messageParent(JSON.stringify(message));
        } catch (e) {
          status.textContent = message.ok ? "Signed in. You can close this window." : message.error || "Sign-in did not finish.";
        }
      }
      Office.onReady(function () {
        var q = new URLSearchParams(window.location.search);
        var saved = null;
        if (q.get("client")) {
          saved = { client: q.get("client"), tenant: q.get("tenant") || "", scopes: (q.get("scopes") || "User.Read").split(" ").filter(Boolean), hint: String(q.get("hint") || "").toLowerCase(), temp: q.get("temp") === "1" };
        } else {
          try { saved = JSON.parse(window.sessionStorage.getItem(KEY) || "null"); } catch (e) { saved = null; }
        }
        if (!saved || !GUID.test(saved.client) || !TENANT.test(saved.tenant)) {
          send({ ok: false, error: "This window was opened without valid sign-in settings." });
          return;
        }
        try { window.sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* The redirect below then cannot finish; the error is reported. */ }
        msal.createStandardPublicClientApplication({
          auth: { clientId: saved.client, authority: "https://login.microsoftonline.com/" + saved.tenant, redirectUri: window.location.origin + window.location.pathname },
          // The one-time setup permission is kept in this page's memory only, never in storage.
          cache: { cacheLocation: saved.temp ? "memoryStorage" : "localStorage" }
        }).then(function (pca) {
          return pca.handleRedirectPromise().then(function (result) {
            if (result) return result;
            // Use the account of the mailbox that opened this window, not just any signed-in one.
            var accounts = pca.getAllAccounts();
            var account = saved.hint ? accounts.filter(function (a) { return String(a.username).toLowerCase() === saved.hint; })[0] : accounts[0];
            if (!account) return pca.acquireTokenRedirect(saved.hint ? { scopes: saved.scopes, loginHint: saved.hint } : { scopes: saved.scopes });
            return pca.acquireTokenSilent({ scopes: saved.scopes, account: account }).catch(function () {
              return pca.acquireTokenRedirect({ scopes: saved.scopes, account: account });
            });
          });
        }).then(function (result) {
          if (result && result.accessToken) send({ ok: true, accessToken: result.accessToken, expiresOn: result.expiresOn ? result.expiresOn.getTime() : 0 });
        }).catch(function (e) {
          send({ ok: false, error: String((e && e.message) || e) });
        });
      });
    })();
  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

const scopeRows = (kind) => GMAIL_SCOPES[kind].map(([s, why]) => `<tr><td><code>${s}</code></td><td>${esc(why)}</td></tr>`).join("\n            ");

export function installPage() {
  const info = JSON.stringify({ name: NAME, siteUrl: SITE_URL, addinId: ADDIN_ID, version: VERSION, provider: PROVIDER, description: DESCRIPTION });
  const host = new URL(SITE_URL).host;
  return layout({
    path: "install/",
    title: "Install",
    description: `Install ${NAME} for Gmail or Outlook: download packages and step by step guides for one person, a team, a school, a business, or a whole organization.`,
    current: "install/",
    scripts: `<script type="module">
    import { outlookManifest } from "{root}app/outlook/manifest.js";
    import { checkConfig, configQuery, scopesFor } from "{root}app/hosts/config.js";
    const INFO = ${info};
    const form = document.getElementById("maker");
    const out = document.getElementById("maker-out");
    const result = document.getElementById("maker-result");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const checked = checkConfig({ client: data.get("client"), tenant: data.get("tenant"), site: data.get("site"), mail: data.get("mail"), access: data.get("access") });
      if (!checked.ok) {
        out.textContent = checked.errors.join(" ");
        result.hidden = true;
        return;
      }
      out.textContent = "";
      const xml = outlookManifest(INFO, checked.config);
      const link = document.getElementById("maker-download");
      if (link.href.startsWith("blob:")) URL.revokeObjectURL(link.href);
      link.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
      document.getElementById("maker-app").href = new URL("{root}app/", window.location.href).href + "?" + configQuery(checked.config);
      document.getElementById("maker-scopes").textContent = scopesFor(checked.config).join(", ");
      result.hidden = false;
      result.scrollIntoView({ block: "nearest" });
    });
  </script>`,
    body: `    <p class="kicker" style="margin-top:44px">Install</p>
    <h1 class="page-title" style="margin-top:0">Add ${NAME} to your email</h1>
    <p class="lead">${NAME} is free for personal, commercial, school, and enterprise use. It has no server of its own: everything runs in your own Google or Microsoft 365 account. Choose where your organization keeps its mail.</p>

    <div class="tabs" role="tablist" aria-label="Where your mail lives">
      <button type="button" role="tab" aria-controls="gmail" data-hash="gmail">Gmail and Google Workspace</button>
      <button type="button" role="tab" aria-controls="outlook" data-hash="outlook">Outlook and Microsoft 365</button>
    </div>

    <section class="tab-panel" id="gmail" role="tabpanel">
      <h2 style="margin-top:8px">Gmail</h2>
      <p class="prose">${NAME} for Gmail is a Google Workspace add-on written in Google Apps Script. Tickets and settings are rows in one Google Sheet in your own Drive. It works with Google Workspace accounts and with free Gmail accounts.</p>
      <p class="notice"><strong>New in version ${VERSION}.</strong> The Gmail add-on has been tested against a simulated Gmail and Google Sheets, and has not yet been run in a live Google account. Try it with a few people first, and please <a href="${REPO_URL}/issues">report what you find</a>.</p>

      <h3>Choose an install</h3>
      <div class="table-wrap"><table class="plain">
        <thead><tr><th></th><th>Standard</th><th>Private</th></tr></thead>
        <tbody>
          <tr><td><strong>Best for</strong></td><td>One person, a household, or a small team that trusts each other</td><td>Businesses, schools, and any organization</td></tr>
          <tr><td><strong>Setup</strong></td><td>One Apps Script project</td><td>Two Apps Script projects</td></tr>
          <tr><td><strong>The Google Sheet</strong></td><td>Shared with everyone who uses the help desk, so a person could open it and read every ticket</td><td>Shared with no one but the help desk's owner. People see only their own requests.</td></tr>
          <tr><td><strong>Permissions staff approve</strong></td><td>Run in Gmail, know your email address, read and write spreadsheets, send email as you</td><td>Run in Gmail, know your email address, connect to the help desk service</td></tr>
          <tr><td><strong>Email comes from</strong></td><td>The person who acted</td><td>The help desk owner's account, for example helpdesk@your-domain</td></tr>
        </tbody>
      </table></div>

      <div class="file-row"><div class="grow"><code>${SLUG}-gmail.zip</code><br><span class="muted small">Standard install: six script files, the manifest, and a guide</span></div><a class="btn btn-primary" href="{root}download/${SLUG}-gmail.zip" download>Download</a></div>
      <div class="file-row"><div class="grow"><code>${SLUG}-gmail-private.zip</code><br><span class="muted small">Private install: a service folder, an add-on folder, and a guide</span></div><a class="btn btn-primary" href="{root}download/${SLUG}-gmail-private.zip" download>Download</a></div>

      <h3 id="gmail-standard">Standard install</h3>
      <ol class="steps">
        <li>Download <code>${SLUG}-gmail.zip</code> and unzip it.</li>
        <li>Go to <a href="https://script.google.com">script.google.com</a>, select <strong>New project</strong>, and rename the project <strong>${NAME}</strong>.</li>
        <li>Select <strong>Project Settings</strong> (the gear) and check <strong>Show "appsscript.json" manifest file in editor</strong>.</li>
        <li>Go back to the <strong>Editor</strong>. For each of <code>Addon</code>, <code>Cards</code>, <code>Core</code>, <code>Service</code>, <code>SettingsCards</code>, and <code>Store</code>: select the plus sign next to Files, choose <strong>Script</strong>, type the name, and replace everything in the new file with the contents of the matching <code>.gs</code> file from the package. Then delete the starter file <code>Code.gs</code>.</li>
        <li>Open <code>appsscript.json</code> and replace everything in it with the package's <code>appsscript.json</code>. If you are not in the US Eastern time zone, change <code>America/New_York</code> to yours, for example <code>Europe/Berlin</code>. Save.</li>
        <li>Select <strong>Deploy</strong>, then <strong>Test deployments</strong>, then <strong>Install</strong>, then <strong>Done</strong>.</li>
        <li>Open Gmail and reload it. Select the ${NAME} icon in the panel on the right, select <strong>Authorize access</strong>, and approve the permissions. With a free Gmail account, Google first says that it has not verified this app, because the project is your own. Select <strong>Advanced</strong>, then <strong>Go to ${NAME} (unsafe)</strong>.</li>
        <li>Enter your organization's name, choose a starting set of lists, and select <strong>Create the help desk</strong>. ${NAME} creates the Google Sheet in your Drive and makes you the first administrator.</li>
        <li>Open <strong>Settings</strong>, then <strong>Team</strong>, and add the people who will work on tickets. Then select <strong>Open the spreadsheet</strong> and share the Sheet, as Editor, with everyone who will use the help desk. A Google group makes this one step.</li>
      </ol>
      <p class="callout"><strong>Other people</strong>A test deployment is installed per person, and Google lets a person install it only if they can edit the project. In Google Workspace they must also belong to the owner's organization. Anyone who can edit the project can change what it does, so share it only with people you would trust as administrators, and have each one select Deploy, Test deployments, and Install. For everyone else, publish the add-on for your organization (below). Sharing between free Gmail accounts has not been tested.</p>

      <h3 id="gmail-private">Private install</h3>
      <p class="prose">The Private install splits ${NAME} in two. A small <strong>service</strong> project owns the Sheet and runs as one account, ideally a shared one such as helpdesk@your-domain. The <strong>add-on</strong> project is what people install. It proves who each person is with a Google sign-in token, and the service answers only for that person.</p>
      <ol class="steps">
        <li>Download <code>${SLUG}-gmail-private.zip</code> and unzip it. Sign in to Google as the account that should own the help desk.</li>
        <li><strong>The service.</strong> At <a href="https://script.google.com">script.google.com</a> create a project named <strong>${NAME} service</strong>. Show the manifest file as in the Standard install, add the script files <code>Core</code>, <code>Service</code>, and <code>Store</code> from the package's <code>service</code> folder, delete <code>Code.gs</code>, and replace <code>appsscript.json</code> with the one in that folder.</li>
        <li>Select <strong>Deploy</strong>, then <strong>New deployment</strong>. Choose the type <strong>Web app</strong>, set <strong>Execute as</strong> to <strong>Me</strong> and <strong>Who has access</strong> to <strong>Anyone</strong>, and select <strong>Deploy</strong>. Approve the permissions, then copy the <strong>Web app URL</strong>. It ends in <code>/exec</code>.</li>
        <li>Recommended for Google Workspace: in <strong>Project Settings</strong>, under <strong>Script properties</strong>, add a property named <code>ALLOWED_DOMAIN</code> with your organization's <strong>primary</strong> domain, for example <code>example.org</code>. That is the domain shown first in the Google Admin console under <strong>Account</strong>, <strong>Domains</strong>, even when people use addresses at another of its domains. Separate several with commas. The service then refuses accounts from anywhere else. Do not set it for free Gmail accounts, which have no organization domain.</li>
        <li><strong>The add-on.</strong> Create a second project named <strong>${NAME}</strong> and show its manifest file as in the Standard install. Add the script files <code>Addon</code>, <code>Cards</code>, <code>Core</code>, and <code>SettingsCards</code> from the package's <code>addon</code> folder, delete <code>Code.gs</code>, and replace <code>appsscript.json</code> with the one in that folder. Save.</li>
        <li>In this project's <strong>Project Settings</strong>, under <strong>Script properties</strong>, add a property named <code>SERVICE_URL</code> and paste the web app URL from step 3.</li>
        <li>Select <strong>Deploy</strong>, then <strong>Test deployments</strong>, then <strong>Install</strong>. Open Gmail as the owner account, open ${NAME}, authorize it, and select <strong>Create the help desk</strong>.</li>
        <li>Open <strong>Settings</strong>, then <strong>Team</strong>, and add your team. Do not share the Sheet with anyone who should not read every ticket.</li>
      </ol>
      <p class="callout"><strong>Other people</strong>To give the add-on to a few trusted people, share the add-on project (never the service project) with them as Editor and have each one select Deploy, Test deployments, and Install. Anyone who can edit the add-on project can change its code and could act as another person, so for ordinary staff publish it for your organization (below). Only the time zone in the service project's <code>appsscript.json</code> matters; the add-on shows times the way the service does.</p>
      <p class="callout"><strong>Why the web app is open to "Anyone"</strong>The add-on reaches the service over the internet, so Google must let the request in. The service then checks every request itself: it must carry a Google sign-in token for a verified account, from your domain if you set <code>ALLOWED_DOMAIN</code>, issued to your own add-on project. The first time the owner or an administrator opens the add-on, the service remembers that project and refuses every other. A request without those gets an error and nothing else. Some organizations do not allow web apps that are open to anyone; in that case use the Standard install.</p>

      <h3 id="gmail-organization">For everyone in a Google Workspace organization</h3>
      <p class="prose">To give ${NAME} to a whole domain, an organizational unit, or a group, publish your add-on project in the Google Workspace Marketplace for your organization only. Google calls this a <strong>private</strong> app: it is visible only inside your organization and needs no review by Google. The choice between private and public cannot be changed afterward. You need a Google Workspace administrator and a Google Cloud project. Google's guides have the current screens: <a href="https://developers.google.com/workspace/add-ons/how-tos/publish-add-on-overview">Publish an add-on</a> and <a href="https://developers.google.com/workspace/marketplace/how-to-publish">Publish to the Marketplace</a>.</p>
      <ol class="steps">
        <li>In the <a href="https://console.cloud.google.com">Google Cloud console</a>, create a project in your organization. Under <strong>APIs and Services</strong>, set up the OAuth consent screen with the user type <strong>Internal</strong>.</li>
        <li>In the Apps Script project that people install (the Standard project, or the add-on project of a Private install), open <strong>Project Settings</strong>, select <strong>Change project</strong>, and enter the Cloud project's number.</li>
        <li>Select <strong>Deploy</strong>, then <strong>New deployment</strong>, choose the type <strong>Add-on</strong>, and deploy. Copy the <strong>Deployment ID</strong>.</li>
        <li>In the Cloud console, enable the <strong>Google Workspace Marketplace SDK</strong>. On its <strong>App Configuration</strong> page choose <strong>Private</strong> visibility, select <strong>Google Workspace add-on</strong>, paste the Deployment ID, and list the same permissions as the project's <code>appsscript.json</code>.</li>
        <li>Fill in the <strong>Store Listing</strong>. You can use the icons in this site's <code>assets/icons</code> folder, the small banner at <code>assets/brand/${SLUG}-banner-220x140.png</code>, and a screenshot of the <a href="{root}demo/">demo</a> (Google asks for one of 1280 by 800 pixels), and link to this site's privacy, terms, and help pages. Select <strong>Publish</strong>.</li>
        <li>In the <a href="https://admin.google.com">Google Admin console</a>, go to <strong>Apps</strong>, then <strong>Google Workspace Marketplace apps</strong>, add the app, and install it for everyone or for chosen groups.</li>
      </ol>
      <p class="callout"><strong>Private install: publish before people use it</strong>The service remembers which add-on project it answers. Moving the add-on project to a Cloud project (step 2) is expected to change that identity. If people then see "made for a different add-on", delete the script property <code>ALLOWED_AUDIENCE</code> in the service project and have the owner open the add-on first.</p>

      <h3 id="gmail-clasp">With clasp, for IT teams and developers</h3>
      <ol class="steps">
        <li>Turn on the Apps Script API at <a href="https://script.google.com/home/usersettings">script.google.com/home/usersettings</a>.</li>
        <li>Install and sign in: <code>npm install -g @google/clasp</code>, then <code>clasp login</code>.</li>
        <li>In an empty folder run <code>clasp create-script --type standalone --title "${NAME}"</code>. Copy the package's files into the folder, delete any <code>Code.js</code> that clasp made, and let the package's <code>appsscript.json</code> replace clasp's.</li>
        <li>Run <code>clasp push --force</code>, then <code>clasp open-script</code>, and continue from the Deploy step above. Versions of clasp before 3 call these two commands <code>clasp create</code> and <code>clasp open</code>.</li>
      </ol>

      <h3 id="gmail-email">Optional: create a ticket from the open email</h3>
      <p class="prose">${NAME} can turn the email you are reading into a ticket. This needs one more permission, to read the open message, so it is off by default. To turn it on, edit <code>appsscript.json</code> in the project that people install: add <code>"https://www.googleapis.com/auth/gmail.addons.current.message.readonly"</code> to <code>oauthScopes</code>, and change <code>"gmail": {}</code> to:</p>
      <pre class="callout"><code>"gmail": {
  "contextualTriggers": [
    { "unconditional": {}, "onTriggerFunction": "onGmailMessage" }
  ]
}</code></pre>
      <p class="prose">Everyone approves the new permission the next time they open ${NAME}. A <strong>Create from this email</strong> button then appears whenever a message is open.</p>

      <h3>Permissions</h3>
      <div class="two-col">
        <div><p><strong>Standard</strong></p><div class="table-wrap"><table class="plain"><tbody>
            ${scopeRows("standard")}
        </tbody></table></div></div>
        <div><p><strong>Private: what staff approve</strong></p><div class="table-wrap"><table class="plain"><tbody>
            ${scopeRows("addon")}
        </tbody></table></div>
        <p><strong>Private: what the owner approves for the service</strong></p><div class="table-wrap"><table class="plain"><tbody>
            ${scopeRows("service")}
        </tbody></table></div></div>
      </div>

      <h3>Updating</h3>
      <p class="prose">Add-ons installed this way do not update themselves. When a new version comes out, replace the script files with the new package's files and save. Your script properties, your Sheet, and your settings are not touched. For a Private install, also open <strong>Deploy</strong>, then <strong>Manage deployments</strong> in the service project, edit the web app, and choose <strong>New version</strong>, so its address stays the same. If you published the add-on for your organization, edit its add-on deployment the same way and choose <strong>New version</strong>; until then people keep the old code.</p>

      <h3>What to know</h3>
      <ul class="prose">
        <li>Google limits how much email an account sends through Apps Script each day: about 100 recipients for a free account and 1,500 for a Google Workspace account. In a Private install every notice comes from the owner's account, so a busy help desk on a free account can reach the limit. Email that could not be sent is noted in the ticket's activity.</li>
        <li>The help desk's time zone is recorded when it is set up, from the project's <code>appsscript.json</code>, and can be changed under Settings, Hours.</li>
        <li>A ticket's card shows its latest 20 messages. The Messages tab of the Sheet holds all of them.</li>
      </ul>
    </section>

    <section class="tab-panel" id="outlook" role="tabpanel">
      <h2 style="margin-top:8px">Outlook</h2>
      <p class="prose">${NAME} for Outlook is an Office add-in for Outlook on the web, the new and classic Outlook for Windows, Outlook for Mac, and Outlook for iOS and Android. Tickets are items in a SharePoint list in your own Microsoft 365 tenant, reached through Microsoft Graph as the signed-in person. It needs work or school accounts with Exchange Online mailboxes and SharePoint, which Microsoft 365 Business Basic, Standard, and Premium and the enterprise and education suites include. Personal Outlook.com accounts are not supported, and neither are the separate government and China clouds.</p>
      <p class="notice"><strong>New in version ${VERSION}.</strong> The Outlook add-in has been tested against a simulated Microsoft 365, not yet in a live tenant. Try it with a few people first, and please <a href="${REPO_URL}/issues">report what you find</a>.</p>

      <h3>What an administrator does, once</h3>
      <p class="prose">A <strong>Global Administrator</strong> can do every step. An organization that keeps that role for emergencies can share the work, using the roles Microsoft names for each task: an <strong>Application Administrator</strong> or <strong>Cloud Application Administrator</strong> for registering the app and granting consent, a <strong>SharePoint Administrator</strong> who can also approve the setup permission for creating the lists, and an <strong>Exchange Administrator</strong> for deploying the add-in. Whoever creates the lists must be an Owner of the help desk site.</p>
      <ol class="steps">
        <li><strong>Create a SharePoint site for the help desk.</strong> In SharePoint select <strong>Create site</strong>, choose <strong>Team site</strong>, name it, for example <strong>Help Desk</strong>, and set its privacy to <strong>Private</strong>. Make the help desk team <strong>Owners</strong> of the site. Then select the gear, <strong>Site permissions</strong>, <strong>Advanced permissions settings</strong>, open the <strong>Visitors</strong> group, select <strong>New</strong>, and add <strong>Everyone except external users</strong>. Do not add staff as Members: Members can change lists, including the help desk's settings. Copy the site's address, such as <code>https://contoso.sharepoint.com/sites/helpdesk</code>.</li>
        <li><strong>Register the app.</strong> In the <a href="https://entra.microsoft.com">Microsoft Entra admin center</a>, go to <strong>App registrations</strong> and select <strong>New registration</strong>. Name it <strong>${NAME}</strong>, keep <strong>Accounts in this organizational directory only</strong>, and under <strong>Redirect URI</strong> choose <strong>Single-page application (SPA)</strong> and enter <code>brk-multihub://${host}</code>. Select <strong>Register</strong>.</li>
        <li>On the app's <strong>Authentication</strong> page, add two more single-page application redirect URIs: <code>${SITE_URL}/app/blank.html</code> and <code>${SITE_URL}/app/auth.html</code>. Save.</li>
        <li>On <strong>API permissions</strong>, select <strong>Add a permission</strong>, then <strong>Microsoft Graph</strong>, then <strong>Delegated permissions</strong>, and add <code>Sites.Selected</code> and <code>Mail.Send</code>. <code>User.Read</code> is already there. Then select <strong>Grant admin consent</strong>.</li>
        <li>From the app's <strong>Overview</strong> page, copy the <strong>Application (client) ID</strong> and the <strong>Directory (tenant) ID</strong>, and make your manifest:</li>
      </ol>

      <form class="form card" id="maker">
        <h3 style="margin-top:0">Make your manifest</h3>
        <p class="muted small" style="margin:0">The manifest is made in your browser. These values are identifiers, not passwords. They become part of the add-in's address, so GitHub, as this site's host, can see them when the add-in opens.</p>
        <label>Application (client) ID <input name="client" required autocomplete="off" spellcheck="false" placeholder="00000000-0000-0000-0000-000000000000"></label>
        <label>Directory (tenant) ID <input name="tenant" required autocomplete="off" spellcheck="false" placeholder="00000000-0000-0000-0000-000000000000"></label>
        <label>SharePoint site address <input name="site" type="url" required autocomplete="off" spellcheck="false" placeholder="https://contoso.sharepoint.com/sites/helpdesk"></label>
        <label>Email notices
          <select name="mail"><option value="on">Send them from the person who acts (needs Mail.Send)</option><option value="off">Do not send email from the add-in</option></select>
          <span class="hint">Choose the second if you would rather build notices with a list rule or Power Automate. Then leave Mail.Send out of step 4.</span>
        </label>
        <label>Access to SharePoint
          <select name="access"><option value="selected">Only the help desk site (Sites.Selected, recommended)</option><option value="all">Any site the person can open (Sites.ReadWrite.All)</option></select>
          <span class="hint">The first is narrower and needs the one-time grant in step 6. If you choose the second, add Sites.ReadWrite.All in step 4 instead of Sites.Selected.</span>
        </label>
        <div><button class="btn btn-primary" type="submit">Make the manifest</button></div>
        <output id="maker-out" for="maker"></output>
        <div id="maker-result" hidden>
          <p><a class="btn btn-primary" id="maker-download" href="#" download="${SLUG}-manifest.xml">Download ${SLUG}-manifest.xml</a> <a class="btn" id="maker-app" href="#" target="_blank" rel="noopener">Open the browser app to finish setup</a></p>
          <p class="muted small">Permissions this manifest's add-in will ask for: <span id="maker-scopes"></span>.</p>
        </div>
      </form>

      <ol class="steps" start="6" style="counter-reset: step 5">
        <li><strong>Create the lists.</strong> Select <strong>Open the browser app to finish setup</strong> above and sign in as the administrator described above, who must also be an Owner of the site. Open <strong>I am the administrator</strong> and select <strong>1. Create the lists</strong>. Microsoft asks you to approve one higher permission, <code>Sites.FullControl.All</code> (or <code>Sites.Manage.All</code> if you chose the wider access above). Leave <strong>Consent on behalf of your organization</strong> unchecked, so it applies to your account only. ${NAME} uses it to give the add-in access to this one site and to create three lists, and does not store it. Then enter your organization's name and select <strong>2. Create the help desk</strong>.</li>
        <li id="outlook-revoke"><strong>Remove the setup permission.</strong> It is no longer needed. The Microsoft Entra admin center lists it under <strong>Enterprise applications</strong>, <strong>${NAME}</strong>, <strong>Permissions</strong>, <strong>User consent</strong>, but cannot remove a single person's consent there, so use <a href="https://developer.microsoft.com/graph/graph-explorer">Graph Explorer</a>, signed in as the same administrator:
          <ol>
            <li>Allow Graph Explorer the permission <code>DelegatedPermissionGrant.ReadWrite.All</code> when it asks (under <strong>Modify permissions</strong>).</li>
            <li>Run <code>GET https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq 'APPLICATION-ID'&amp;$select=id</code> with your application (client) ID, and copy the <code>id</code> it returns.</li>
            <li>Run <code>GET https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$filter=clientId eq 'THAT-ID'</code>. Find the grant whose <code>consentType</code> is <code>Principal</code> and whose <code>scope</code> contains <code>Sites.FullControl.All</code> (or <code>Sites.Manage.All</code>), and copy its <code>id</code>.</li>
            <li>If that grant holds nothing else you need, run <code>DELETE https://graph.microsoft.com/v1.0/oauth2PermissionGrants/GRANT-ID</code>. Otherwise run <code>PATCH</code> on the same address with the body <code>{"scope": "..."}</code>, listing the scopes to keep, separated by spaces.</li>
          </ol>
          Microsoft's page <a href="https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions">Review permissions granted to enterprise applications</a> also shows a PowerShell way. These steps follow Microsoft's documentation and have not yet been tried in a live tenant.</li>
        <li id="outlook-permissions"><strong>Set who can see what.</strong> On the site, open <strong>Site contents</strong> and for each list choose <strong>Settings</strong>:
          <ul>
            <li><strong>Help Desk Tickets</strong>: under <strong>Advanced settings</strong>, <strong>Item-level Permissions</strong>, choose <strong>Read items that were created by the user</strong> and <strong>Create items and edit items that were created by the user</strong>. Under <strong>Permissions for this list</strong>, stop inheriting permissions and grant <strong>Everyone except external users</strong> the level <strong>Contribute</strong>. Site Owners keep Full Control, which is what lets the team see every ticket.</li>
            <li><strong>Help Desk Notes</strong>: under <strong>Permissions for this list</strong>, stop inheriting permissions and remove every group except the Owners. Internal notes live here.</li>
            <li><strong>Help Desk Settings</strong>: leave it as it is. Visitors can read it, and Owners can change it.</li>
          </ul>
        </li>
        <li><strong>Deploy the add-in.</strong> In the <a href="https://admin.microsoft.com">Microsoft 365 admin center</a>, go to <strong>Settings</strong>, then <strong>Integrated apps</strong>. Select <strong>Upload custom apps</strong>, choose <strong>Office Add-in</strong> as the app type, and upload <code>${SLUG}-manifest.xml</code>. Choose who gets it and finish the deployment. Microsoft says it can take up to 24 hours to appear, sometimes longer.</li>
        <li><strong>Add your team.</strong> Open ${NAME} in Outlook, open the menu, choose <strong>Settings</strong>, then <strong>Lists</strong>, then <strong>Team</strong>.</li>
      </ol>

      <h3>For one person, or to test first</h3>
      <p class="prose">In Outlook on the web, open <a href="https://aka.ms/olksideload">aka.ms/olksideload</a>, choose <strong>My add-ins</strong>, then <strong>Add a custom add-in</strong>, then <strong>Add from File</strong>, and choose your manifest. The add-in then follows your account to Outlook on Windows, Mac, and mobile.</p>

      <h3>Where to find it</h3>
      <p class="prose">Open any message. In Outlook on the web and the new Outlook, select <strong>Apps</strong> in the message's toolbar and choose <strong>${NAME}</strong>. In classic Outlook for Windows and Outlook for Mac, select the <strong>Help desk</strong> button on the ribbon. Pin the panel to keep it open. On a phone, open a message, select the three dots, and choose <strong>${NAME}</strong>. Outlook opens add-ins from an open message, which also gives you the <strong>Create from the open email</strong> button. The same help desk opens in any browser at <code>${SITE_URL}/app/</code>, which suits a team that wants its queue on a large screen.</p>

      <h3>Permissions</h3>
      <div class="table-wrap"><table class="plain"><tbody>
        <tr><td><code>ReadItem</code> (Outlook)</td><td>Read the one message that is open, to turn it into a ticket. ${NAME} cannot read the rest of the mailbox.</td></tr>
        <tr><td><code>User.Read</code></td><td>Know your name and email address.</td></tr>
        <tr><td><code>Sites.Selected</code></td><td>Read and write the help desk's lists on the one SharePoint site your administrator granted, as you, within what SharePoint lets you see.</td></tr>
        <tr><td><code>Mail.Send</code> (optional)</td><td>Send the help desk's email notices from your mailbox when you act.</td></tr>
      </tbody></table></div>

      <h3>What to know</h3>
      <ul class="prose">
        <li>Email notices are sent from the mailbox of the person who acts, and only while their ${NAME} panel is open.</li>
        <li>When a team member creates a ticket for someone else, that person follows it by email. It does not appear under their own requests, because SharePoint shows people only the items they created.</li>
        <li>SharePoint, not ${NAME}, enforces who can read what. A person who opens the list in SharePoint directly can change the fields of their own tickets.</li>
        <li>Round robin assignment picks a team member evenly at random, because SharePoint keeps no counter that requesters could update.</li>
        <li>Lists show at most 12,000 tickets, and one ticket's conversation can hold about 60,000 characters.</li>
        <li>In the browser app, Microsoft's sign-in lasts about a day. When it ends, the app shows a <strong>Sign in again</strong> button.</li>
        <li>Renaming a status, priority, category, or location renames it on the tickets that use it, one ticket at a time, which can take a while on a large list.</li>
      </ul>
      <div class="file-row"><div class="grow"><code>${SLUG}-outlook.zip</code><br><span class="muted small">A manifest to fill in by hand and this guide as a text file, for sharing with an IT team</span></div><a class="btn" href="{root}download/${SLUG}-outlook.zip" download>Download</a></div>
    </section>

    <h2>Which install for whom</h2>
    <div class="table-wrap"><table class="plain">
      <thead><tr><th>You are</th><th>Use</th></tr></thead>
      <tbody>
        <tr><td>One person or a family with Gmail</td><td>Gmail, Standard install</td></tr>
        <tr><td>A small business or nonprofit on Google Workspace</td><td>Gmail, Private install, shared with a few people or published privately</td></tr>
        <tr><td>A school or district on Google Workspace for Education</td><td>Gmail, Private install, published privately and installed by the administrator</td></tr>
        <tr><td>A business, school, or enterprise on Microsoft 365</td><td>Outlook, deployed from the Microsoft 365 admin center</td></tr>
        <tr><td>An organization that uses both</td><td>Either one. Each keeps its own tickets, so choose the platform your help desk team works in.</td></tr>
      </tbody>
    </table></div>`,
  });
}

// ---------------------------------------------------------------------------
// Help, privacy, terms, and the not-found page
// ---------------------------------------------------------------------------

const TYPE_WORDS = { text: "Text", email: "Email address", url: "Web address", color: "Color", number: "Number", bool: "On or off", choice: "Choice", time: "Time" };

function settingsReference() {
  const groups = [];
  GENERAL_FIELDS.forEach((f) => {
    if (!groups.includes(f.group)) groups.push(f.group);
  });
  return groups
    .map(
      (group) => `<h3>${esc(group)}</h3>
      <div class="table-wrap"><table class="plain">
        <thead><tr><th>Setting</th><th>Kind</th><th>Starts as</th><th>What it does</th></tr></thead>
        <tbody>
          ${GENERAL_FIELDS.filter((f) => f.group === group)
            .map((f) => `<tr><td>${esc(f.label)}</td><td>${TYPE_WORDS[f.type]}</td><td>${f.type === "bool" ? (f.value ? "On" : "Off") : f.value === "" ? "<span class=\"muted\">empty</span>" : "<code>" + esc(f.value) + "</code>"}</td><td>${esc(f.help || "")}${f.options ? " Choices: " + f.options.map((o) => "<code>" + esc(o) + "</code>").join(", ") + "." : ""}</td></tr>`)
            .join("\n          ")}
        </tbody>
      </table></div>`
    )
    .join("\n      ");
}

export function helpPage() {
  return layout({
    path: "help/",
    title: "Help",
    description: `How to use ${NAME}: sending and following requests, working the team's queues, and every setting an administrator can change.`,
    current: "help/",
    body: `    <p class="kicker" style="margin-top:44px">Help</p>
    <h1 class="page-title" style="margin-top:0">Using ${NAME}</h1>
    <p class="lead">${NAME} works much the same way in Gmail, in Outlook, and in the <a href="{root}demo/">live demo</a>, which is the quickest way to try anything described here. Where Gmail and Outlook differ, this page says so.</p>

    <h2 id="requests">Sending and following a request</h2>
    <ol class="steps">
      <li>Open ${NAME} beside your mail and select <strong>New request</strong>.</li>
      <li>Give it a short subject, choose the category that fits, and describe what happened and what you expected. If you are asked for a location, choose the closest one. Leave the priority on <strong>Standard for the category</strong> unless yours is different.</li>
      <li>Select <strong>Send</strong>. You get a number such as <code>TKT-0042</code> and, unless your organization turned it off, a confirmation by email.</li>
      <li>Your requests are listed on the first screen, with unfinished ones first. Open one to read replies and to answer.</li>
      <li>If the problem goes away, select <strong>I no longer need this</strong>; anything you typed in the reply box goes along as a last message. If a finished request comes back, reply to it and it reopens.</li>
    </ol>

    <h2 id="team">Working the queues</h2>
    <p class="prose">People on the team list see the queues: <strong>Open</strong> (everything unfinished), <strong>Unassigned</strong>, <strong>Assigned to me</strong>, <strong>Overdue</strong>, <strong>Waiting</strong>, <strong>Finished</strong>, and <strong>All</strong>. Queues are in work order: overdue first, then the highest priority, then the soonest due time, then the oldest. Waiting tickets come after the ones being worked on.</p>
    <ul class="prose">
      <li><strong>Reply</strong> is saved on the ticket and emailed to the requester. <strong>Internal note</strong> is seen only by the team.</li>
      <li>Changing the <strong>status</strong> can email the requester; each status decides that for itself. A status has a kind: <em>open</em> (being worked on), <em>waiting</em> (the ticket is not counted as overdue; its due time does not move), or <em>done</em>.</li>
      <li>When a requester replies to a waiting ticket it returns to the first open status. When they reply to a finished ticket it reopens, if your settings allow.</li>
      <li>Changing the <strong>priority</strong> sets a new due time from when the ticket was created, unless you set a due time yourself.</li>
      <li>To log a request for someone who phoned or emailed, start a new request and fill in <strong>Requester email</strong>. With <strong>Create from the open email</strong>, ${NAME} fills in the subject, the message, and the sender for you.</li>
      <li>If two people change the same ticket at once, the second is asked to open it again, so nobody's change is silently lost.</li>
    </ul>

    <h2 id="settings">Settings</h2>
    <p class="prose">Administrators change everything from <strong>Settings</strong>, without editing code. In Gmail the same settings are also tabs in the help desk's Google Sheet; changes made in the Sheet show up within five minutes. When a value cannot be used, for example a color that is not a color, ${NAME} keeps a usable value and names the setting it corrected.</p>
    ${settingsReference()}

    <h3 id="lists">Lists</h3>
    <div class="table-wrap"><table class="plain">
      <thead><tr><th>List</th><th>Columns</th><th>What it is for</th></tr></thead>
      <tbody>
        ${LISTS.map((l) => `<tr><td>${esc(l.title)}</td><td>${l.columns.map((c) => esc(c.label)).join(", ")}</td><td>${esc(l.help)}</td></tr>`).join("\n        ")}
      </tbody>
    </table></div>
    <p class="prose">New help desks start from one of these presets: ${PRESETS.map((p) => esc(p.name)).join(", ")}. A preset fills the categories and locations and sets the help desk's name and the location label; rename, remove, and add items freely. In Outlook and the browser app, an administrator can load another preset later.</p>
    <p class="prose"><strong>Renaming.</strong> Tickets store the names of their status, priority, category, and location. To rename one, change its name and save: ${NAME} renames it on every ticket and rule that uses it and tells you how many tickets changed. A status keeps its kind when renamed, so a rename never reopens or finishes tickets. If you remove an item instead, its tickets keep the old name, and Settings lists them under "To review"; a ticket whose status is no longer on the list counts as open. Loading a preset renames nothing.</p>
    <p class="prose"><strong>Renaming in Gmail.</strong> The Gmail list editor is plain text and cannot tell which line became which. Change only the name on that one line and save; if the same save also adds, removes, or moves lines, nothing is renamed.</p>
    <p class="prose"><strong>In Gmail,</strong> lists are edited as text, one item per line with a vertical bar between the columns, and choices show their short names (for example <code>business</code> for working hours only).</p>

    <h3 id="assignment">How a new ticket is assigned</h3>
    <ol class="prose">
      <li>The first <strong>assignment rule</strong> whose category, priority, location, and keyword all match. Empty columns match anything.</li>
      <li>Otherwise the person named on the ticket's <strong>category</strong>.</li>
      <li>Otherwise <strong>round robin</strong> among the active team, if that is turned on.</li>
      <li>Otherwise the ticket stays unassigned, and the whole team is told about it.</li>
    </ol>
    <p class="prose">People marked inactive on the team list are skipped, so marking someone inactive while they are away sends their work to the next match.</p>

    <h3 id="due">Due times</h3>
    <p class="prose">Each priority allows a number of hours. With <strong>Working hours only</strong>, the clock runs only on your working days between the start and end times, and skips your days off. With the starting hours of 08:00 to 17:00, a ticket created on Friday evening with eight hours allowed is due at 16:00 on Monday. Set a priority's hours to 0 for no due time. The help desk's time zone is recorded when it is set up; check it under Hours.</p>

    <h3 id="email">Email wording</h3>
    <div class="table-wrap"><table class="plain">
      <thead><tr><th>Email</th><th>Sent</th></tr></thead>
      <tbody>
        ${TEMPLATE_KEYS.map((k) => `<tr><td><code>${k}</code></td><td>${esc(TEMPLATE_INFO[k])}</td></tr>`).join("\n        ")}
      </tbody>
    </table></div>
    <p class="prose">Subjects and bodies are plain text. The ticket's details are added under your text automatically. These placeholders are replaced with the ticket's own values:</p>
    <p class="prose">${PLACEHOLDERS.map((p) => "<code>{{" + p + "}}</code>").join(" ")}</p>

    <h2 id="questions">Questions</h2>
    <details class="faq"><summary>Where is my data?</summary><p>In Gmail, in one Google Sheet in the Drive of whoever set the help desk up. In Outlook, in three lists on a SharePoint site in your own Microsoft 365. ${NAME} has no server and its author never sees your tickets. See the <a href="{root}privacy/">privacy page</a>.</p></details>
    <details class="faq"><summary>Gmail: "You do not have access to the help desk's spreadsheet"</summary><p>You are using a Standard install and the Sheet has not been shared with you. Ask your administrator to share it with you as Editor, or to move to the Private install, which needs no sharing.</p></details>
    <details class="faq"><summary>Gmail: the add-on says it is not connected</summary><p>In a Private install the add-on project needs a script property named <code>SERVICE_URL</code> holding the service's web app address, which ends in <code>/exec</code>. The first person to open the add-on after that must be the owner or an administrator.</p></details>
    <details class="faq"><summary>Gmail: I changed something in the Sheet and the add-on does not show it</summary><p>Settings are remembered for five minutes. Wait, or save any setting from the add-on, which refreshes them at once. Keep the tab names and the header rows as they are; ${NAME} finds settings by them.</p></details>
    <details class="faq"><summary>Gmail: times look wrong</summary><p>Set the <strong>Time zone</strong> setting, for example <code>Europe/Berlin</code>. Times in the Sheet itself are stored in universal time so they sort correctly.</p></details>
    <details class="faq"><summary>Outlook: Microsoft says "Need admin approval"</summary><p>Your administrator has not yet granted consent for the app registration. Send them the <a href="{root}install/#outlook">install guide</a>.</p></details>
    <details class="faq"><summary>Outlook: the panel shows "Set up the help desk"</summary><p>The lists have not been created, or the add-in has not been given access to the site. If you are not an administrator, there is nothing for you to do; ask them to finish the install guide's steps "Create the lists" and "Set who can see what".</p></details>
    <details class="faq"><summary>Outlook: "Your Microsoft 365 sign-in has ended"</summary><p>Select <strong>Sign in again</strong>. In a browser tab, Microsoft's sign-in lasts about a day.</p></details>
    <details class="faq"><summary>Outlook: a team member cannot see everyone's tickets</summary><p>They need Full Control or Design on the Help Desk Tickets list (site Owners have it), and they must be on the Team list in ${NAME}'s settings.</p></details>
    <details class="faq"><summary>Can we use it for something other than IT?</summary><p>Yes. Rename the help desk, change the word for a ticket, and replace the categories. The Facilities preset is one example, and the same works for HR questions, purchasing, or a front office.</p></details>
    <details class="faq"><summary>How many tickets can it hold?</summary><p>${NAME} is built for small and medium organizations and has not been measured with large numbers of tickets. It reads the whole ticket list each time it draws a queue, so it slows down as the list grows. In Outlook, lists show at most 12,000 tickets. Archiving old rows or items keeps it quick.</p></details>
    <details class="faq"><summary>How do we stop using ${NAME}?</summary><p>In Gmail, uninstall the add-on and delete the Apps Script project or projects; the Google Sheet stays in Drive until you delete it. In Outlook, remove the add-in in the Microsoft 365 admin center, delete the app registration, and delete the three lists or the site. Nothing is stored anywhere else.</p></details>
    <details class="faq"><summary>Something is not working</summary><p>Please open an issue at <a href="${REPO_URL}/issues">${REPO_URL.replace("https://", "")}/issues</a> and say whether you use Gmail or Outlook, which install, and what you saw. Do not include private ticket details.</p></details>`,
  });
}

export function privacyPage() {
  return layout({
    path: "privacy/",
    title: "Privacy",
    description: `${NAME}'s publisher receives nothing from you. Your tickets stay in your own Google or Microsoft 365 account.`,
    body: `    <h1 class="page-title">Privacy</h1>
    <p class="muted">Last updated ${RELEASE_DATE}. ${NAME} is published by ${esc(PROVIDER)}.</p>
    <div class="prose">
      <p class="lead">${NAME}'s publisher receives nothing from you. ${NAME} has no server of its own, no accounts, no analytics, and no advertising, and its publisher cannot see your tickets or your settings.</p>

      <h2>Where your information is kept</h2>
      <ul>
        <li><strong>Gmail.</strong> Tickets, messages, the activity log, and settings are rows in one Google Sheet in the Google Drive of the person or account that set up the help desk. The add-on is Apps Script code that you copy into your own Google account and that runs there. Email notices are sent by Google: from your own account in a Standard install, and from the help desk owner's account in a Private install.</li>
        <li><strong>Outlook.</strong> Tickets, notes, and settings are items in three lists on a SharePoint site in your organization's Microsoft 365. The add-in's code is loaded from this website each time it opens, runs in Outlook on your device, and talks only to Microsoft's sign-in service and to Microsoft Graph, as you. Email notices are sent from your own mailbox. The add-in's address includes your organization's application ID, tenant ID, and site address, which GitHub, as this site's host, can see. An organization that prefers can host its own copy of the site; the code is public.</li>
        <li><strong>The demo.</strong> The sample help desk on this site lives in your browser tab and is erased when you close it.</li>
      </ul>
      <p>Who can read a ticket is decided by your own Google or Microsoft 365 permissions, as described in the <a href="{root}install/">install guide</a>. Your organization's own privacy rules apply to what people write in tickets.</p>

      <h2>Permissions, and why each one is needed</h2>
      <p>In Gmail (the Standard install):</p>
      <div class="table-wrap"><table class="plain"><tbody>
        ${scopeRows("standard")}
      </tbody></table></div>
      <p>The Private install asks staff for less; see the <a href="{root}install/#gmail">install page</a>. The optional feature that turns the open email into a ticket adds permission to read that one message.</p>
      <p>In Outlook: the add-in can read the message that is open (<code>ReadItem</code>), your name and email address (<code>User.Read</code>), the help desk's lists on the one SharePoint site your administrator chose (<code>Sites.Selected</code>), and, if your administrator turned email notices on, it can send mail as you (<code>Mail.Send</code>). It uses these only to show and save tickets and to send the help desk's own notices. An administrator can choose wider access to SharePoint instead (<code>Sites.ReadWrite.All</code>). During setup, one administrator approves a higher permission once (<code>Sites.FullControl.All</code> or <code>Sites.Manage.All</code>) to create the lists, and the install guide says how to remove it afterward.</p>

      <h2>This website</h2>
      <ul>
        <li>The site and the Outlook add-in's pages are static files hosted on GitHub Pages. GitHub, as the host, receives the usual technical information any web server sees, such as your IP address. See <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a>.</li>
        <li>The site sets no cookies. It keeps a few things in your browser's own storage: your theme choice; for the Outlook add-in and the browser app, your organization's connection settings; while the older Outlook sign-in window is open, its settings and your email address, for that window only; and, in the live demo, the sample help desk for that tab. Signing in to Microsoft 365 stores Microsoft's sign-in tokens in your browser. None of this is sent to ${NAME}'s publisher.</li>
        <li>If your organization sets a logo address, the logo is loaded from the server that address names, which sees your IP address as any web server does.</li>
        <li>Fonts and Microsoft's sign-in library are served from this site. The Outlook pages load Microsoft's Office script from Microsoft.</li>
      </ul>

      <h2>Children and schools</h2>
      <p>${NAME} is a tool for an organization's staff and is not directed at children. A school that uses it keeps every record in its own Google or Microsoft 365 account, under the school's control.</p>

      <h2>Removing ${NAME} and its data</h2>
      <p>Everything ${NAME} stores is in your own account, so removing it is in your hands. In Gmail, uninstall the add-on, delete the Apps Script project or projects, and delete the Google Sheet. In Outlook, remove the add-in, delete the app registration, and delete the three lists or the site. Clearing this site's data in your browser removes the remembered theme, connection settings, and sign-in.</p>

      <h2>Changes and contact</h2>
      <p>If this page changes, the date above changes with it, and the history is public in the <a href="${REPO_URL}">source repository</a>. Questions are welcome as an issue there.</p>
    </div>`,
  });
}

export function termsPage() {
  return layout({
    path: "terms/",
    title: "Terms",
    description: `${NAME} is free, open-source software under the MIT License.`,
    body: `    <h1 class="page-title">Terms</h1>
    <p class="muted">Last updated ${RELEASE_DATE}.</p>
    <div class="prose">
      <p class="lead">${NAME} is free, open-source software by ${esc(PROVIDER)}, released under the <a href="${REPO_URL}/blob/main/LICENSE">MIT License</a>. You may use it, copy it, change it, and share it, for personal, commercial, school, and enterprise purposes, as long as the copyright and license notice stay with it.</p>
      <h2>No warranty</h2>
      <p>${NAME} is provided as it is, without warranty of any kind. Its publisher is not liable for any claim, damage, or loss that comes from using it. The MIT License has the exact wording. Test it with your own organization before you rely on it, and keep your own backups of your Google Sheet or SharePoint lists.</p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>You install and run ${NAME} in your own Google or Microsoft 365 account, and you decide who can use it and who can read its data.</li>
        <li>You are responsible for what people in your organization write in tickets, and for following the laws and policies that apply to your organization's records.</li>
        <li>Your use of Gmail, Google Sheets, Apps Script, Outlook, SharePoint, and Microsoft Graph is governed by your own agreements with Google and Microsoft, including their quotas and limits.</li>
      </ul>
      <h2>The hosted Outlook pages</h2>
      <p>The Outlook add-in and the browser app load from this website. The site is offered without any promise that it will always be available or will never change. An organization that needs that certainty can host its own copy; the <a href="${REPO_URL}">source</a> has everything needed.</p>
      <h2>Names and trademarks</h2>
      <p>${NAME} is an independent project. It is not affiliated with, endorsed by, or sponsored by Google or Microsoft. Gmail, Google Workspace, and Google Sheets are trademarks of Google LLC. Outlook, Microsoft 365, and SharePoint are trademarks of the Microsoft group of companies.</p>
      <h2>Third-party software</h2>
      <p>The Outlook pages include Microsoft's MSAL.js library (MIT License). The site uses the IBM Plex and Cormorant Garamond typefaces (SIL Open Font License). Their license texts are in the repository.</p>
    </div>`,
  });
}

export function notFoundPage() {
  // GitHub Pages serves this for any missing address, at any depth, so its links are absolute.
  return layout({
    path: "",
    title: "Page not found",
    body: `    <h1 class="page-title">That page is not here</h1>
    <p class="lead">The address may have changed. Try the <a href="${SITE_URL}/">home page</a>, the <a href="${SITE_URL}/demo/">live demo</a>, or the <a href="${SITE_URL}/install/">install guide</a>.</p>`,
  })
    .replace(/(href|src)="\.\//g, `$1="${SITE_URL}/`)
    .replace(/(href|src)="(assets\/|favicon|apple-touch|demo\/|install\/|help\/|privacy\/|terms\/)/g, `$1="${SITE_URL}/$2`);
}
