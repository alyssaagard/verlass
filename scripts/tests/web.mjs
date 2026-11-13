/**
 * Tests for the web app's service, the demo, and the Microsoft 365 side: connection settings,
 * the Outlook manifest, and the SharePoint backend running against a simulated Microsoft Graph.
 *
 * The simulated Graph enforces what SharePoint is set up to enforce in the install guide:
 * people see only the tickets they created, only site owners see every ticket and the notes
 * list, and only owners can change settings. It cannot prove that the real Graph answers the
 * same way; that needs a real Microsoft 365 tenant.
 */
import fs from "node:fs";
import path from "node:path";

/** A pretend Microsoft 365 tenant with one SharePoint site. */
function makeTenant() {
  const tenant = {
    site: { id: "contoso.sharepoint.com,site-guid,web-guid", webUrl: "https://contoso.sharepoint.com/sites/helpdesk", displayName: "Help Desk" },
    owners: new Set(["ana@contoso.com"]),
    granted: false, // has the app been given access to the site (Sites.Selected)?
    lists: new Map(), // id -> { id, displayName, columns, items, nextId }
    mail: [],
    calls: [],
    pageSize: 2,
    throttle: 0, // answer this many requests with 429 first
    unavailable: 0, // answer this many requests with 503 first
    grants: [],
    nextList: 1,
  };
  const json = (status, body, headers) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (headers || {})[k] || null },
    text: async () => (body === null ? "" : JSON.stringify(body)),
  });
  const error = (status, code, message) => json(status, { error: { code, message } });
  const listByName = (name) => Array.from(tenant.lists.values()).find((l) => l.displayName === name);
  const kindOf = (list) => (/Notes$/.test(list.displayName) ? "notes" : /Settings$/.test(list.displayName) ? "settings" : "tickets");

  tenant.fetch = async (url, init) => {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const auth = String((init.headers && init.headers.Authorization) || "");
    const m = /^Bearer user:([^:]+):(.*)$/.exec(auth);
    tenant.calls.push(method + " " + u.pathname + u.search);
    if (!m) return error(401, "InvalidAuthenticationToken", "No token");
    if (tenant.throttle > 0) {
      tenant.throttle--;
      return json(429, { error: { code: "TooManyRequests", message: "Slow down" } }, { "Retry-After": "0.01" });
    }
    if (tenant.unavailable > 0) {
      tenant.unavailable--;
      return json(503, { error: { code: "serviceNotAvailable", message: "Try later" } }, { "Retry-After": "0.01" });
    }
    const user = m[1];
    const scopes = m[2].split(" ");
    const elevated = scopes.includes("Sites.FullControl.All") || scopes.includes("Sites.Manage.All");
    const isOwner = tenant.owners.has(user);
    const body = init && init.body ? JSON.parse(init.body) : null;
    const p = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));

    if (p === "/me") return json(200, { displayName: user.split("@")[0], mail: user.toUpperCase(), userPrincipalName: user });
    if (p === "/me/sendMail" && method === "POST") {
      if (!scopes.includes("Mail.Send")) return error(403, "ErrorAccessDenied", "Access is denied. Check credentials and try again.");
      tenant.mail.push({ from: user, to: body.message.toRecipients.map((r) => r.emailAddress.address), subject: body.message.subject, html: body.message.body.content, replyTo: body.message.replyTo, saved: body.saveToSentItems });
      return json(202, null);
    }
    if (!tenant.granted && !elevated) return error(403, "accessDenied", "Access denied");
    if (p === "/sites/contoso.sharepoint.com:/sites/helpdesk") return json(200, tenant.site);
    const sitePrefix = "/sites/" + tenant.site.id;
    if (!p.startsWith(sitePrefix)) return error(404, "itemNotFound", "Site not found");
    const rest = p.slice(sitePrefix.length);

    if (rest === "/permissions" || /^\/permissions\/perm\d+$/.test(rest)) {
      if (!scopes.includes("Sites.FullControl.All") || !isOwner) return error(403, "accessDenied", "Needs Sites.FullControl.All");
      if (method === "GET") return json(200, { value: tenant.grants.map((g, i) => ({ id: "perm" + i, roles: g.roles, grantedToIdentitiesV2: g.grantedToIdentities })) });
      if (method === "PATCH") {
        const n = Number(/perm(\d+)$/.exec(rest)[1]);
        tenant.grants[n].roles = body.roles;
        return json(200, { id: "perm" + n, roles: body.roles });
      }
      tenant.granted = true;
      tenant.grant = body;
      tenant.grants.push(body);
      return json(201, { id: "perm" + tenant.grants.length, roles: body.roles });
    }
    if (rest === "/lists" && method === "GET") {
      const visible = Array.from(tenant.lists.values()).filter((l) => kindOf(l) !== "notes" || isOwner);
      return json(200, { value: visible.map((l) => ({ id: l.id, displayName: l.displayName, webUrl: tenant.site.webUrl + "/Lists/" + l.displayName })) });
    }
    if (rest === "/lists" && method === "POST") {
      if (!elevated || !isOwner) return error(403, "accessDenied", "Cannot create lists");
      if (listByName(body.displayName)) return error(409, "nameAlreadyExists", "Exists");
      const list = { id: "list-" + tenant.nextList++, displayName: body.displayName, columns: body.columns, items: [], nextId: 1 };
      tenant.lists.set(list.id, list);
      return json(201, { id: list.id, displayName: list.displayName });
    }
    const lm = /^\/lists\/([^/]+)\/items(?:\/(\d+))?(\/fields)?$/.exec(rest);
    if (!lm) return error(400, "invalidRequest", "Unknown path " + p);
    const list = tenant.lists.get(lm[1]);
    if (!list) return error(404, "itemNotFound", "List not found");
    const kind = kindOf(list);
    if (kind === "notes" && !isOwner) return error(403, "accessDenied", "Access denied");
    const canRead = (item) => kind !== "tickets" || isOwner || item.createdBy === user;
    const view = (item) => ({ id: String(item.id), "@odata.etag": '"' + item.id + "," + item.version + '"', createdDateTime: item.created, lastModifiedDateTime: item.modified, fields: Object.assign({ id: String(item.id) }, item.fields) });
    const known = new Set(["Title"].concat(list.columns.map((c) => c.name)));
    const badField = (fields) => Object.keys(fields).find((k) => !known.has(k));

    if (!lm[2] && method === "GET") {
      let items = list.items.filter(canRead);
      const filter = u.searchParams.get("$filter");
      if (filter) {
        const fm = /^fields\/(\w+) eq (\d+)$/.exec(filter);
        if (!fm) return error(400, "invalidRequest", "Unsupported filter");
        const column = list.columns.find((c) => c.name === fm[1]);
        if (!column || (!column.indexed && String(init.headers.Prefer || "") !== "HonorNonIndexedQueriesWarningMayFailRandomly")) return error(400, "invalidRequest", "Field is not indexed");
        items = items.filter((i) => Number(i.fields[fm[1]]) === Number(fm[2]));
      }
      const skip = Number(u.searchParams.get("$skiptoken") || 0);
      const page = items.slice(skip, skip + tenant.pageSize);
      const out = { value: page.map(view) };
      if (skip + tenant.pageSize < items.length) {
        const next = new URL(url);
        next.searchParams.set("$skiptoken", String(skip + tenant.pageSize));
        out["@odata.nextLink"] = next.href;
      }
      return json(200, out);
    }
    if (!lm[2] && method === "POST") {
      if (kind === "settings" && !isOwner) return error(403, "accessDenied", "Access denied");
      const bad = badField(body.fields);
      if (bad) return error(400, "invalidRequest", "Field '" + bad + "' is not recognized");
      const now = new Date().toISOString();
      const item = { id: list.nextId++, version: 1, createdBy: user, created: now, modified: now, fields: Object.assign({}, body.fields) };
      list.items.push(item);
      return json(201, view(item));
    }
    const item = list.items.find((i) => i.id === Number(lm[2]));
    if (!item || !canRead(item)) return error(404, "itemNotFound", "The specified item was not found");
    if (method === "GET") {
      const answer = json(200, view(item));
      if (tenant.changeAfterNextRead) {
        // Someone else saves the item in the instant after it was read.
        tenant.changeAfterNextRead = false;
        item.version++;
        item.fields.ChangedAt = "2099-01-01T00:00:00.000Z";
      }
      return answer;
    }
    if (method === "PATCH" && lm[3]) {
      if (kind === "settings" && !isOwner) return error(403, "accessDenied", "Access denied");
      if (kind === "tickets" && tenant.failTicketPatches > 0) {
        tenant.failTicketPatches--;
        return error(503, "serviceNotAvailable", "Try later");
      }
      const ifMatch = init.headers["If-Match"];
      if (ifMatch && ifMatch !== '"' + item.id + "," + item.version + '"') return error(412, "notAllowed", "Precondition failed");
      const bad = badField(body);
      if (bad) return error(400, "invalidRequest", "Field '" + bad + "' is not recognized");
      if (tenant.beforePatch) {
        // A colleague's change lands just before this one.
        const hook = tenant.beforePatch;
        tenant.beforePatch = null;
        hook(item);
        if (ifMatch && ifMatch !== '"' + item.id + "," + item.version + '"') return error(412, "notAllowed", "Precondition failed");
      }
      Object.assign(item.fields, body);
      item.version++;
      item.modified = new Date().toISOString();
      if (tenant.failAfterWrite > 0) {
        // The change is stored, but the answer is lost on the way back.
        tenant.failAfterWrite--;
        return json(504, { error: { code: "gatewayTimeout", message: "Gateway timeout" } }, { "Retry-After": "0.01" });
      }
      return json(200, item.fields);
    }
    return error(405, "notSupported", "Unsupported");
  };
  tenant.list = listByName;
  return tenant;
}

export async function run({ ROOT, check, load, wellFormed }) {
  const { makeService } = await load("docs/app/stores/service.js");
  const { makeDemoBackend, PERSONAS } = await load("docs/app/stores/demo.js");
  const { makeSharePointBackend, provision, sitePath, LIST_NAMES, LIST_COLUMNS } = await load("docs/app/stores/sharepoint.js");
  const { makeGraph } = await load("docs/app/stores/graph.js");
  const C = await load("docs/app/hosts/config.js");
  const { outlookManifest } = await load("docs/app/outlook/manifest.js");
  const { MANIFEST_INFO } = await load("scripts/build.mjs");
  const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

  // --- The demo ---------------------------------------------------------------------
  {
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const backend = makeDemoBackend({ storage, now: Date.parse("2026-11-13T15:00:00Z") });
    const svc = makeService(backend);
    let r = await svc.call("boot");
    eq([r.ready, r.role, r.user.name, Object.keys(r.stats)], [true, "requester", "Morgan Chen", ["requestedOpen"]], "the demo opens as a staff member");
    check(!("team" in r.settings) && !("templates" in r.settings), "a requester is not sent the team list or the email wording");
    r = await svc.call("list", { view: "all" });
    check(r.list.view === "requested" && r.list.items.length > 0 && r.list.items.every((t) => t.requesterEmail === "morgan.chen@example.com"), "a requester's list holds only their own tickets");
    const someoneElses = backend.allTickets().find((t) => t.requesterEmail !== "morgan.chen@example.com");
    eq((await svc.call("get", { id: someoneElses.id })).ok, false, "a requester cannot open someone else's ticket");
    eq((await svc.call("settingsGet")).ok, false, "a requester cannot open the settings");
    r = await svc.call("create", { subject: "Mouse", description: "Left button", category: "Computer or laptop", priority: "Low", location: "Remote" });
    check(r.ok && /^TKT-\d{4}$/.test(r.ticket.id) && backend.outbox().length === 2, "a new demo ticket is saved and its two emails go to the outbox");
    const id = r.ticket.id;
    backend.setPersona("agent");
    r = await svc.call("boot");
    eq([r.role, r.stats.total], ["agent", 13], "switching to a team member shows the team's counts");
    r = await svc.call("update", { id, changes: { status: "In progress", assignedTo: "sam.patel@example.com", reply: "Looking now.", note: "Spare mice are in the cabinet." } });
    eq([r.ok, r.changed, r.messages.map((m) => m.visibility)], [true, true, ["public", "internal"]], "a team update saves a reply and a note");
    const stale = await svc.call("update", { id, expectedUpdatedAt: "2000-01-01T00:00:00.000Z", changes: { note: "late" } });
    check(!stale.ok && /Someone else changed/.test(stale.errors[0]), "a stale change is refused");
    backend.setPersona("staff");
    r = await svc.call("get", { id });
    eq([r.messages.length, r.messages[0].text, r.activity.length], [1, "Looking now.", 0], "the requester sees the reply but not the note or the activity");
    backend.setPersona("admin");
    r = await svc.call("settingsSave", { general: { ticketPrefix: "REQ-", accentColor: "blue" }, lists: { locations: ["HQ", "hq", "Depot"], bogus: [1] }, templates: { created: { subject: "", body: "" } } });
    eq([r.ok, r.settings.general.ticketPrefix, r.settings.general.accentColor, r.settings.locations], [true, "REQ-", "#2F4F40", ["HQ", "Depot"]], "settings are saved after being checked and tidied");
    check(!(await svc.call("settingsSave", { lists: { team: [] } })).ok, "an administrator cannot remove their own access");
    const again = makeService(makeDemoBackend({ storage }));
    eq((await again.call("boot")).settings.general.ticketPrefix, "REQ-", "the demo's changes are kept for the browser tab");
    backend.reset();
    eq((await svc.call("boot")).settings.general.ticketPrefix, "TKT-", "resetting the demo restores the sample data");
    eq(PERSONAS.map((p) => p.id), ["staff", "agent", "admin"], "the demo offers three people");
    check((await svc.call("nope")).ok === false, "an unknown action is refused");
  }

  // --- Connection settings ------------------------------------------------------------
  const good = { client: "11111111-2222-3333-4444-555555555555", tenant: "AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee", site: "https://contoso.sharepoint.com/sites/helpdesk/" };
  check(!C.checkConfig({ client: good.client, site: good.site }).ok, "the tenant is required, because a single-organization app cannot sign in without it");
  check(!C.checkConfig({ ...good, tenant: "organizations" }).ok, "a placeholder is not a tenant");
  check(!C.checkConfig({ ...good, site: "https://contoso.sharepoint.us/sites/helpdesk" }).ok, "sites outside the worldwide Microsoft 365 cloud are refused up front");
  const cfg = C.checkConfig(good);
  eq([cfg.ok, cfg.config], [true, { client: good.client, tenant: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", site: "https://contoso.sharepoint.com/sites/helpdesk", mail: "on", access: "selected" }], "valid connection settings are tidied");
  for (const bad of [{ ...good, client: "abc" }, { ...good, tenant: "not a tenant!" }, { ...good, site: "http://contoso.sharepoint.com/sites/x" }, { ...good, site: "https://evil.example.com/sites/x" }, { ...good, site: "https://contoso.sharepoint.com.evil.com/x" }, { ...good, site: "https://contoso.sharepoint.com/sites/x?y=<script>" }]) {
    check(!C.checkConfig(bad).ok, "bad connection settings are refused: " + JSON.stringify(bad).slice(0, 90));
  }
  eq(C.scopesFor(cfg.config), ["User.Read", "Sites.Selected", "Mail.Send"], "the default permissions");
  eq(C.scopesFor(C.checkConfig({ ...good, mail: "off", access: "all" }).config), ["User.Read", "Sites.ReadWrite.All"], "permissions without mail and with wider site access");
  eq([C.setupScopesFor(cfg.config), C.setupScopesFor({ access: "all" })], [["Sites.FullControl.All"], ["Sites.Manage.All"]], "the one-time setup permission");
  const kept = new Map();
  const box = { getItem: (k) => kept.get(k) || null, setItem: (k, v) => kept.set(k, v), removeItem: (k) => kept.delete(k) };
  eq(C.readConfig("?" + C.configQuery(cfg.config), box).config, cfg.config, "settings survive a trip through the page address");
  eq(C.readConfig("", box).config, cfg.config, "and are remembered for the next visit");
  eq(C.readConfig("", { getItem: () => null, setItem() {} }), null, "no settings at all is reported as none");
  eq(C.readConfig("?client=bad&site=x", box).ok, false, "bad settings in the address are reported, not saved");
  eq(sitePath("https://contoso.sharepoint.com/sites/help%20desk/"), "/sites/contoso.sharepoint.com:/sites/help%20desk", "the Graph path of a site");
  eq(sitePath("https://contoso.sharepoint.com"), "/sites/contoso.sharepoint.com", "the Graph path of a root site");

  // --- The Outlook manifest ---------------------------------------------------------------
  const xml = outlookManifest(MANIFEST_INFO, cfg.config);
  wellFormed(xml, "the Outlook manifest with connection settings");
  const pane = `${MANIFEST_INFO.siteUrl}/app/outlook.html?client=${good.client}&amp;tenant=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&amp;site=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Fhelpdesk`;
  eq(xml.split(pane).length - 1, 3, "the task pane address, with its settings, appears in all three places");
  check(xml.includes('xsi:type="MailApp"') && xml.includes("<Permissions>ReadItem</Permissions>") && !/ReadWriteMailbox|ReadWriteItem/.test(xml), "the add-in asks Outlook only to read the open message");
  check(new RegExp(`<Id>${MANIFEST_INFO.addinId}</Id>`).test(xml) && /<Version>\d+\.\d+\.\d+\.\d+<\/Version>/.test(xml), "the manifest has the permanent ID and a four-part version");
  check(xml.includes("MobileMessageReadCommandSurface") && xml.includes("MessageReadCommandSurface") && xml.includes("<SupportsPinning>true</SupportsPinning>"), "desktop, mobile, and pinning are declared");
  check(xml.includes("VersionOverridesV1_0") && xml.includes("VersionOverridesV1_1"), "both version override blocks are present");
  for (const m of xml.matchAll(/assets\/icons\/(icon-\d+\.png)/g)) check(fs.existsSync(path.join(ROOT, "docs/assets/icons", m[1])), `the manifest's ${m[1]} exists`);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of xml.matchAll(/resid="([^"]+)"/g)) check(new RegExp(`<bt:(Image|Url|String)\\s+id="${escRe(m[1])}"`).test(xml), `manifest resource ${m[1]} is defined`);
  check(!new RegExp(`<bt:(Image|Url|String)\\s+id="Icon\\.16"`).test(xml.replace(/<bt:Image id="Icon\.16"[^>]*\/>/g, "")), "the resource check would notice a missing definition");
  check(/<Description DefaultValue="[^"]{20,250}"\/>/.test(xml), "the description fits Outlook's limit");
  const bare = outlookManifest(MANIFEST_INFO, null);
  check(bare.includes(`${MANIFEST_INFO.siteUrl}/app/outlook.html"`) && !bare.includes("client="), "the generic manifest carries no connection settings");
  check(wellFormed(outlookManifest({ ...MANIFEST_INFO, name: "A & B <Desk>", provider: "\"Q\" & Co" }, cfg.config), "a manifest with awkward characters"), "names with special characters still make valid XML");

  // --- Microsoft 365 backend ----------------------------------------------------------------
  const tenant = makeTenant();
  const as = (email, extra) => {
    const scopes = C.scopesFor(cfg.config);
    const backend = makeSharePointBackend(Object.assign({ siteUrl: cfg.config.site, getToken: async (s) => "user:" + email + ":" + (s || scopes).join(" "), scopes, fetch: tenant.fetch, maxWaitSeconds: 1 }, extra || {}));
    return { backend, svc: makeService(backend) };
  };
  const elevatedFor = (email) => makeGraph(async () => "user:" + email + ":Sites.FullControl.All", { fetch: tenant.fetch });

  let ana = as("ana@contoso.com");
  let threw = "";
  try {
    await ana.backend.status();
  } catch (e) {
    threw = e.message;
  }
  check(/did not allow/.test(threw), "before the add-in is given access to the site, opening it reports a permission problem");
  try {
    await provision(elevatedFor("pat@contoso.com"), { siteUrl: cfg.config.site, grant: { clientId: good.client, appName: "Verlass" } });
    check(false, "someone who is not a site owner must not be able to run setup");
  } catch (e) {
    check(/did not allow/.test(e.message), "setup by someone who is not a site owner is refused by SharePoint");
  }
  const made = await provision(elevatedFor("ana@contoso.com"), { siteUrl: cfg.config.site, grant: { clientId: good.client, appName: "Verlass" } });
  eq([made.granted, made.created, tenant.grant.roles, tenant.grant.grantedToIdentities[0].application.id], [true, Object.values(LIST_NAMES), ["fullcontrol"], good.client], "setup grants the add-in access to the one site and creates three lists");
  eq((await provision(elevatedFor("ana@contoso.com"), { siteUrl: cfg.config.site, grant: null })).created, [], "running setup again creates nothing");
  await provision(elevatedFor("ana@contoso.com"), { siteUrl: cfg.config.site, grant: { clientId: good.client.toUpperCase(), appName: "Verlass" } });
  eq(tenant.grants.length, 1, "pressing the setup button again does not stack up a second grant");
  tenant.grants[0].roles = ["write"];
  await provision(elevatedFor("ana@contoso.com"), { siteUrl: cfg.config.site, grant: { clientId: good.client, appName: "Verlass" } });
  eq([tenant.grants.length, tenant.grants[0].roles], [1, ["fullcontrol"]], "a lower grant from an earlier setup is raised, not duplicated");
  for (const key of Object.keys(LIST_NAMES)) eq(tenant.list(LIST_NAMES[key]).columns.map((c) => c.name), LIST_COLUMNS[key].map((c) => c.name), `the ${key} list has its columns`);

  let r = await ana.svc.call("boot");
  eq([r.ok, r.ready, r.canSetup], [true, false, true], "with empty lists the help desk reports that it needs setting up");
  r = await ana.svc.call("setup", { orgName: "Contoso", preset: "office" });
  eq([r.ready, r.role, r.user.email, r.settings.general.orgName], [true, "admin", "ana@contoso.com", "Contoso"], "the administrator creates the help desk and becomes its first admin");
  check((await ana.svc.call("setup", { orgName: "Twice" })).ok === false, "setting up twice is refused");
  r = await ana.svc.call("settingsSave", { lists: { team: [{ email: "ana@contoso.com", name: "Ana", role: "admin" }, { email: "ben@contoso.com", name: "Ben", role: "agent" }] } });
  check(r.ok, "the team list is saved to SharePoint");

  // A requester.
  const pat = as("pat@contoso.com");
  r = await pat.svc.call("boot");
  eq([r.role, r.user.email], ["requester", "pat@contoso.com"], "a requester signs in (and their address is lowercased)");
  r = await pat.svc.call("create", { subject: "Laptop fan", description: "Loud <noise>", category: "Computer or laptop", priority: "High", location: "Main office" });
  eq([r.ok, r.ticket.id, r.ticket.number, r.mailProblems], [true, "TKT-0001", 1, []], "SharePoint numbers the ticket");
  const item = tenant.list(LIST_NAMES.tickets).items[0];
  eq([item.createdBy, item.fields.Title, item.fields.Details, item.fields.Status, item.fields.Conversation], ["pat@contoso.com", "Laptop fan", "Loud <noise>", "Open", "[]"], "the ticket is one list item created by the requester");
  eq(tenant.mail.map((m) => [m.from, m.to, m.saved]), [["pat@contoso.com", ["pat@contoso.com"], false], ["pat@contoso.com", ["ana@contoso.com", "ben@contoso.com"], false]], "notices are sent from the acting person's mailbox and not kept in Sent Items");
  check(tenant.mail.every((m) => !m.html.includes("<noise>")), "email is escaped");

  const sam = as("sam@contoso.com");
  eq((await sam.svc.call("list", {})).list.items.length, 0, "another person sees none of it");
  eq((await sam.svc.call("get", { id: "TKT-0001" })).ok, false, "and cannot open it by number");
  check(!(await sam.svc.call("settingsSave", { general: { deskName: "Mine" } })).ok, "a requester cannot change settings");

  // The team.
  ana = as("ana@contoso.com");
  r = await ana.svc.call("list", { view: "open" });
  eq(r.list.items.map((t) => t.id), ["TKT-0001"], "a site owner on the team sees every ticket");
  r = await ana.svc.call("update", { id: "TKT-0001", changes: { status: "In progress", assignedTo: "ben@contoso.com", reply: "Bring it by.", note: "Third fan this month." } });
  eq([r.ok, r.changed, r.messages.map((m) => [m.visibility, m.text])], [true, true, [["public", "Bring it by."], ["internal", "Third fan this month."]]], "a team update saves a reply and an internal note");
  eq([JSON.parse(item.fields.Conversation).map((m) => m.text), tenant.list(LIST_NAMES.notes).items.map((n) => [n.fields.TicketNumber, n.fields.Body])], [["Bring it by."], [[1, "Third fan this month."]]], "the reply is on the ticket item and the note is in the notes list");
  check(JSON.parse(item.fields.History).some((a) => /Status changed/.test(a.text)), "the activity log is kept on the item");
  r = await pat.svc.call("get", { id: "TKT-0001" });
  eq([r.ok, r.messages.map((m) => m.text), r.activity], [true, ["Bring it by."], []], "the requester reads the reply and never the note");
  r = await pat.svc.call("update", { id: "TKT-0001", changes: { reply: "Will do.", status: "Closed", note: "x" } });
  eq([r.ok, r.ticket.status, tenant.list(LIST_NAMES.notes).items.length], [true, "In progress", 1], "a requester's update can only add a reply");

  // Two people at once.
  const first = as("ana@contoso.com");
  const second = as("ana@contoso.com");
  const seen = (await first.svc.call("get", { id: "TKT-0001" })).ticket.updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  check((await second.svc.call("update", { id: "TKT-0001", changes: { priority: "Urgent" } })).ok, "one person's change is saved");
  r = await first.svc.call("update", { id: "TKT-0001", expectedUpdatedAt: seen, changes: { priority: "Low" } });
  check(!r.ok && /Someone else changed/.test(r.errors[0]) && item.fields.Priority === "Urgent", "the other person's stale change is refused");
  // The same race, caught by SharePoint's own version check rather than by the time stamp.
  const racer = as("ana@contoso.com");
  const current = await racer.backend.getTicket("TKT-0001");
  tenant.changeAfterNextRead = true;
  let conflict = "";
  try {
    await racer.backend.saveTicket(Object.assign({}, current, { updatedAt: "2026-12-01T00:00:00.000Z" }), { messages: [], activity: [{ at: "2026-12-01T00:00:00.000Z", by: "ana@contoso.com", text: "Racing." }] });
  } catch (e) {
    conflict = e.code;
  }
  eq(conflict, "conflict", "a change that lost the race at SharePoint is reported as a conflict");

  // A save whose answer was lost is sent again; it must count as saved, not as someone else's change.
  const mailBeforeLost = tenant.mail.length;
  tenant.failAfterWrite = 1;
  r = await as("ana@contoso.com").svc.call("update", { id: "TKT-0001", changes: { reply: "Saved once." } });
  check(r.ok && r.changed && JSON.parse(item.fields.Conversation).filter((m) => m.text === "Saved once.").length === 1 && tenant.mail.length > mailBeforeLost, "a save whose answer was lost is recognized as saved, once, and the email still goes out");

  // Paging, throttling, and limits.
  for (let i = 0; i < 4; i++) await pat.svc.call("create", { subject: "Extra " + i, description: "x", category: "Something else" });
  const fresh = as("ana@contoso.com");
  eq((await fresh.svc.call("list", { view: "all", pageSize: 50 })).list.total, 5, "every page of a long list is read");
  check(tenant.calls.some((c) => c.includes("expand=fields($select=Title,") && !c.includes("Conversation")) || tenant.calls.some((c) => /expand=fields\(\$select=Title,/.test(decodeURIComponent(c)) && !/Conversation/.test(decodeURIComponent(c))), "lists ask for the short columns only, not every conversation");

  // A request that may already have gone through is not sent twice.
  const before503 = tenant.list(LIST_NAMES.tickets).items.length;
  tenant.unavailable = 1;
  r = await pat.svc.call("create", { subject: "Once only", description: "x", category: "Something else" });
  check(!r.ok && tenant.list(LIST_NAMES.tickets).items.length === before503, "a create that Microsoft 365 answered with 503 is reported, not repeated");
  tenant.unavailable = 1;
  eq((await as("ana@contoso.com").svc.call("boot")).ok, true, "a read that got a 503 is tried again");

  // Renaming a status in the settings renames it on the stored tickets.
  const renamedStatuses = [{ name: "Open", kind: "open" }, { name: "Working", kind: "open" }, { name: "Waiting on requester", kind: "waiting" }, { name: "Resolved", kind: "done" }, { name: "Closed", kind: "done" }];
  // First the rename fails part way: then the settings must not be saved, so saving again finishes it.
  tenant.failTicketPatches = 4;
  r = await as("ana@contoso.com").svc.call("settingsSave", { lists: { statuses: renamedStatuses } });
  tenant.failTicketPatches = 0;
  check(!r.ok && /Save again to finish/.test(r.errors[0]) && (await as("ana@contoso.com").svc.call("settingsGet")).settings.statuses[1].name === "In progress", "when renaming tickets fails, the settings keep the old names");
  // While the rename runs, a colleague raises the ticket's priority; the rename must not undo it.
  tenant.beforePatch = (it) => {
    it.fields.Priority = "Low";
    it.version++;
  };
  r = await as("ana@contoso.com").svc.call("settingsSave", { lists: { statuses: renamedStatuses } });
  eq([r.ok, r.renamedTickets, item.fields.Status, item.fields.Priority], [true, 1, "Working", "Low"], "a renamed status is renamed on the tickets that use it, without undoing a colleague's change");
  check(item.fields.ChangedAt > "2026-11-13", "a renamed ticket gets a new change time, so an open form is told to look again");
  // The web editor says which row became which, so a removed row is never taken for a rename.
  r = await as("ana@contoso.com").svc.call("settingsSave", { lists: { statuses: [{ name: "Open", kind: "open" }, { name: "Doing", kind: "open" }, { name: "Resolved", kind: "done" }, { name: "Closed", kind: "done" }] }, renames: { statuses: { Working: "Doing" } } });
  eq([r.ok, r.renamedTickets, item.fields.Status], [true, 1, "Doing"], "a rename named by the editor is applied even when another status was removed in the same save");
  r = await as("ana@contoso.com").svc.call("settingsSave", { lists: { statuses: renamedStatuses }, renames: {} });
  eq([r.ok, r.renamedTickets, item.fields.Status], [true, 0, "Doing"], "replacing a list with renames: {} renames nothing");
  r = await as("ana@contoso.com").svc.call("settingsSave", { lists: { statuses: [{ name: "Open", kind: "open" }, { name: "Working", kind: "open" }, { name: "Waiting on requester", kind: "waiting" }, { name: "Resolved", kind: "done" }, { name: "Closed", kind: "done" }] }, renames: { statuses: {} } });
  r = await as("ana@contoso.com").svc.call("update", { id: "TKT-0001", changes: { status: "Working" } });
  eq((await as("ana@contoso.com").svc.call("boot")).warnings.filter((w) => /not on the list/.test(w)), [], "so no ticket is left with an unknown status");

  // A team member SharePoint does not let into the notes list: the reply is saved, the note is reported.
  const ben = as("ben@contoso.com");
  tenant.owners.add("ben@contoso.com");
  const benSees = (await ben.svc.call("list", { view: "all" })).list.total;
  tenant.owners.delete("ben@contoso.com");
  check(benSees >= 5, "a team member who is a site owner sees every ticket");
  r = await as("ana@contoso.com").svc.call("update", { id: "TKT-0002", changes: { assignedTo: "ben@contoso.com" } });
  const mailBeforeNote = tenant.mail.length;
  const patAsTeam = as("pat@contoso.com");
  await as("ana@contoso.com").svc.call("settingsSave", { lists: { team: [{ email: "ana@contoso.com", name: "Ana", role: "admin" }, { email: "ben@contoso.com", name: "Ben", role: "agent" }, { email: "pat@contoso.com", name: "Pat", role: "agent" }] } });
  const ticket2 = tenant.list(LIST_NAMES.tickets).items.find((it) => it.id === 2);
  const historyBefore = ticket2.fields.History;
  r = await patAsTeam.svc.call("update", { id: "TKT-0002", changes: { reply: "Looking into it.", note: "For the team." } });
  check(!r.ok && /cannot save internal notes/.test(r.errors[0]) && ticket2.fields.History === historyBefore && tenant.mail.length === mailBeforeNote, "when this person cannot store notes, nothing is saved and the reason is given, so the typed text stays and the log stays true");
  r = await patAsTeam.svc.call("update", { id: "TKT-0002", changes: { reply: "Looking into it." } });
  check(r.ok && r.changed && tenant.mail.length > mailBeforeNote, "the same person can still reply");
  await as("ana@contoso.com").svc.call("settingsSave", { lists: { team: [{ email: "ana@contoso.com", name: "Ana", role: "admin" }, { email: "ben@contoso.com", name: "Ben", role: "agent" }] } });
  r = await patAsTeam.svc.call("update", { id: "TKT-0001", changes: { status: "Closed" } });
  eq([r.ok, r.changed], [true, false], "someone just removed from the team loses the team's powers on their next change, not a minute later");
  tenant.throttle = 2;
  eq((await as("ana@contoso.com").svc.call("boot")).ok, true, "when Microsoft 365 says to slow down, the request waits and tries again");
  tenant.throttle = 9;
  r = await as("ana@contoso.com").svc.call("boot");
  check(!r.ok && /busy/.test(r.errors[0]), "after several tries it gives up with a plain message");
  tenant.throttle = 0;
  r = await pat.svc.call("update", { id: "TKT-0001", changes: { reply: "z".repeat(5000) } });
  for (let i = 0; i < 12 && r.ok; i++) r = await pat.svc.call("update", { id: "TKT-0001", changes: { reply: "z".repeat(5000) } });
  check(!r.ok && /size SharePoint allows/.test(r.errors[0]), "a conversation that outgrows a SharePoint field is refused with an explanation");
  check(item.fields.Conversation.length <= 60000, "and the stored conversation stays within the limit");

  // Mail turned off, or not permitted.
  const before = tenant.mail.length;
  const quiet = as("pat@contoso.com", { sendMail: false });
  r = await quiet.svc.call("create", { subject: "No mail", description: "x", category: "Something else" });
  eq([r.ok, tenant.mail.length], [true, before], "with email notices off, nothing is sent");
  const noMail = makeSharePointBackend({ siteUrl: cfg.config.site, getToken: async () => "user:pat@contoso.com:User.Read Sites.Selected", fetch: tenant.fetch });
  r = await makeService(noMail).call("create", { subject: "Denied mail", description: "x", category: "Something else" });
  check(r.ok && r.mailProblems.length === 2, "when sending mail is not permitted, the ticket is still saved and the problem is reported");

  // The Graph client refuses to send a token anywhere but Microsoft Graph.
  let refused = "";
  try {
    await makeGraph(async () => "user:x:y", { fetch: tenant.fetch }).get("https://evil.example.com/v1.0/me");
  } catch (e) {
    refused = e.code;
  }
  eq(refused, "badUrl", "a token is never sent to an address that is not Microsoft Graph");
  check(tenant.calls.every((c) => !/evil/.test(c)), "and no such request was made");
  return "the demo, the connection settings, the manifest, and the Microsoft 365 backend behave as designed";
}
