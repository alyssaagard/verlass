/**
 * Tests for the Gmail add-on. The real .gs files run in a simulated Apps Script
 * (scripts/lib/gas-mock.mjs), and a simulated person opens the add-on, reads its cards, fills
 * fields, and selects buttons, for both the Standard and the Private install.
 *
 * These prove the add-on's own logic. They cannot prove how Gmail draws a card, or that
 * Google's real services behave exactly as simulated; that needs a real install.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeWorld, makeProject, makeSession } from "../lib/gas-mock.mjs";

export async function run({ ROOT, check, load }) {
  const { gmailProject } = await load("scripts/build.mjs");
  const { gmailManifest, GMAIL_FILES } = await load("scripts/gmail-manifests.mjs");
  const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

  // Write each project's files to a temporary folder, exactly as the packages hold them.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helpdesk-gmail-"));
  const filesFor = (kind, order) => {
    const files = gmailProject(kind);
    const names = (order || GMAIL_FILES[kind]).slice();
    return names.map((name) => {
      const p = path.join(tmp, kind + "-" + name);
      fs.writeFileSync(p, files[name]);
      return p;
    });
  };
  const sheetOf = (world) => Array.from(world.files.values())[0];
  const tab = (world, name) => sheetOf(world).book.getSheetByName(name);
  const rows = (world, name) => {
    const sheet = tab(world, name);
    const last = sheet.getLastRow();
    return last < 2 ? [] : sheet.getRange(2, 1, last - 1, sheet.cells[0].length).getValues();
  };

  try {
    // --- Manifests ----------------------------------------------------------------
    const scopes = (kind) => JSON.parse(gmailManifest(kind)).oauthScopes.map((s) => s.replace("https://www.googleapis.com/auth/", ""));
    eq(scopes("standard"), ["gmail.addons.execute", "userinfo.email", "spreadsheets", "script.send_mail"], "the Standard project asks for four permissions");
    eq(scopes("addon"), ["gmail.addons.execute", "userinfo.email", "openid", "script.external_request"], "the Private add-on asks staff for no spreadsheet or mail permission");
    eq(scopes("service"), ["userinfo.email", "spreadsheets", "script.send_mail", "script.external_request"], "the service's permissions");
    const svcManifest = JSON.parse(gmailManifest("service"));
    eq([svcManifest.webapp.executeAs, svcManifest.webapp.access, svcManifest.urlFetchWhitelist], ["USER_DEPLOYING", "ANYONE_ANONYMOUS", ["https://oauth2.googleapis.com/"]], "the service runs as its owner and may only call Google's token check");
    check(!("webapp" in JSON.parse(gmailManifest("addon"))) && JSON.parse(gmailManifest("standard")).addOns.common.homepageTrigger.runFunction === "onHomepage", "add-on manifests open onHomepage");

    // --- Standard install -------------------------------------------------------------
    {
      // The files load in any order (here: reverse), because the editor's file order is not fixed.
      const world = makeWorld();
      const p = makeProject({ world, files: filesFor("standard", GMAIL_FILES.standard.slice().reverse()), user: "ana@example.com" });
      const ana = makeSession(p, "ana@example.com");
      let c = ana.open();
      check(c.all.includes("Welcome") && c.buttons.some((b) => b.text === "Create the help desk"), "the first open shows the setup card");
      c = ana.click("Create the help desk", { orgName: "Example Co", preset: "office" });
      eq([c.title, c.subtitle, ana.notification()], ["IT Help Desk", "Example Co", "Your help desk is ready."], "setup creates the help desk");
      eq(sheetOf(world).book.getSheets().map((s) => s.getName()), ["Tickets", "Messages", "Activity", "Settings", "Categories", "Priorities", "Statuses", "Locations", "Team", "Assignment rules", "Email wording"], "the Sheet has every tab");
      eq(rows(world, "Team"), [["ana@example.com", "Ana", "admin", "yes"]], "the person who set it up is the first administrator");
      check(c.buttons.some((b) => b.text === "Settings"), "an administrator sees Settings");

      // A person the Sheet is not shared with gets a clear message, not a crash.
      const pat = makeSession(p, "pat@example.com");
      c = pat.open();
      check(/share it with you/.test(c.all) && c.buttons.some((b) => b.text === "Try again"), "without access to the Sheet, the card says to ask for sharing");
      sheetOf(world).editors.add("pat@example.com").add("sam@example.com").add("ben@example.com");

      c = pat.open();
      eq(c.buttons.map((b) => b.text), ["New request", "View"], "a requester sees only New request and their own list");
      c = pat.click("New request");
      eq(c.inputs.map((i) => i.name), ["subject", "category", "priority", "location", "description"], "the requester's form has no fields for acting as someone else");
      c = pat.click("Send request", { subject: "", description: "" });
      check(c.all.includes("Enter a subject.") && c.all.includes("Describe the problem") && rows(world, "Tickets").length === 0, "missing fields are listed and nothing is saved");
      c = pat.click("Send request", { subject: "=IMPORTXML(\"http://evil\")", description: "The printer <b>jams</b>\n+1 every time", category: "Printer or scanner", priority: "High", location: "Main office" });
      eq([c.title, pat.notification()], ["TKT-0001", "TKT-0001 was sent."], "a ticket is created and shown");
      check(c.all.includes("&lt;b&gt;jams&lt;/b&gt;") && !c.all.includes("<b>jams</b>"), "text typed by a person is escaped on the card");
      check(!sheetOf(world).book.getSheets().some((s) => s.hasFormula()), "nothing a person typed became a spreadsheet formula");
      eq(rows(world, "Tickets")[0].slice(5, 7), ["=IMPORTXML(\"http://evil\")", "The printer <b>jams</b>\n+1 every time"], "the Sheet holds the text exactly as typed");
      eq(rows(world, "Settings").filter((r) => r[0] === "Time zone").map((r) => r[1]), ["America/New_York"], "setup records the help desk's time zone, so due times do not depend on who is looking");
      eq(world.mail.map((m) => [m.from, m.to, m.subject.slice(0, 11)]), [["pat@example.com", "pat@example.com", "[TKT-0001] "], ["pat@example.com", "ana@example.com", "[TKT-0001] "]], "the requester and the team are emailed");
      check(world.mail.every((m) => !m.htmlBody.includes("<b>jams</b>") && m.name === "Example Co IT Help Desk"), "email is escaped and carries the help desk's name");

      // The team works the ticket.
      c = ana.open();
      check(/Open \| 1/.test(c.all) && /Unassigned \| 1/.test(c.all), "the dashboard counts the new ticket");
      c = ana.click("View", {}, { view: "open" });
      eq([c.title, c.rows.length, c.rows[0].top], ["Open", 1, "TKT-0001 · High"], "the open queue lists it");
      c = ana.click("TKT-0001");
      eq(c.inputs.map((i) => i.name), ["status", "assignedTo", "priority", "category", "due", "reply", "note"], "the team sees the work fields");
      world.tick(60000);
      c = ana.click("Save", { status: "In progress", assignedTo: "ana@example.com", reply: "On my way.", note: "Roller looks worn." });
      eq(ana.notification(), "Saved.", "the team's change is saved");
      check(c.all.includes("On my way.") && c.all.includes("Internal note | Roller looks worn.") && c.all.includes("Status changed from Open to In progress."), "the card shows the reply, the note, and the activity");
      eq(world.mail.slice(2).map((m) => [m.from, m.to, /Now In progress/.test(m.subject)]), [["ana@example.com", "pat@example.com", true]], "the requester is told once");
      c = ana.click("Save", {});
      eq(ana.notification(), "Nothing was changed.", "saving again with no change does nothing");
      eq(world.mail.length, 3, "and sends nothing");

      // The requester sees the reply, not the note or the activity log.
      c = pat.open();
      c = pat.click("View");
      c = pat.click("TKT-0001");
      check(c.all.includes("On my way.") && !c.all.includes("Roller looks worn.") && !c.all.includes("Status changed"), "internal notes and activity stay with the team");
      eq(c.inputs.map((i) => i.name), ["reply"], "a requester can only reply");
      c = pat.click("Send reply", { reply: "'Twas the roller. Thank you." });
      check(c.all.includes("'Twas the roller. Thank you."), "a message that starts with an apostrophe keeps it");
      eq(world.mail[world.mail.length - 1].to, "ana@example.com", "the assignee is told about the reply");
      // A requester who forges the team's form fields changes nothing but the reply.
      world.tick(60000);
      c = pat.click("Send reply", { reply: "One more thing.", status: "Closed", assignedTo: "", priority: "Urgent", note: "sneaky" });
      eq(rows(world, "Tickets")[0].slice(8, 12), ["High", "Main office", "In progress", "ana@example.com"], "a requester cannot change priority, status, or assignee");
      check(!rows(world, "Messages").some((r) => r[5] === "internal" && r[6] === "sneaky"), "a requester cannot write an internal note");

      // Another requester cannot open it, even by asking for its number directly.
      const sam = makeSession(p, "sam@example.com");
      c = sam.open();
      c = sam.click("View");
      eq(c.rows.length, 0, "other people's tickets are not listed");
      p.user = "sam@example.com";
      const direct = p.context.uiTicket({ parameters: { id: "TKT-0001" } });
      check(direct.notification && /was not found/.test(direct.notification.text), "another requester asking for the ticket by number is told it was not found");
      const noSettings = p.context.uiSettings({ parameters: {} });
      check(noSettings.notification && /Only an administrator/.test(noSettings.notification.text), "a requester cannot open the settings");
      p.user = "ana@example.com";

      // Two people change the same ticket: the second is asked to look again.
      c = ana.open();
      c = ana.click("View", {}, { view: "open" });
      c = ana.click("TKT-0001");
      world.tick(60000);
      p.user = "ana@example.com";
      p.context.Service.handle("update", { id: "TKT-0001", changes: { note: "from another window" } }, { email: "ana@example.com" });
      c = ana.click("Save", { status: "Resolved" });
      check(/Someone else changed/.test(ana.notification()) && rows(world, "Tickets")[0][10] === "In progress", "a stale save is refused instead of overwriting");

      // Due times are typed in the help desk's time zone.
      c = ana.back();
      c = ana.click("TKT-0001");
      c = ana.click("Save", { due: "tomorrow" });
      check(/YYYY-MM-DD/.test(ana.notification()), "an unreadable due time is explained");
      world.tick(60000);
      c = ana.click("Save", { due: "2026-12-01 09:30" });
      eq(rows(world, "Tickets")[0][12], "2026-12-01T14:30:00.000Z", "a due time typed in New York time is stored as the right moment");
      world.tick(60000);
      c = ana.click("Save", { due: "" });
      eq(rows(world, "Tickets")[0][12], "", "an empty due field removes the due time");

      // Settings without code.
      c = ana.open();
      c = ana.click("Settings");
      c = ana.click("Edit", {}, { list: "team" });
      c = ana.click("Save", { items: "ana@example.com | Ana | admin\nBen@Example.com | Ben | agent" });
      eq([ana.notification(), rows(world, "Team").length], ["Saved.", 2], "a team member is added from the add-on");
      c = ana.click("Edit", {}, { list: "team" });
      c = ana.click("Save", { items: "ben@example.com | Ben | admin" });
      check(/remove your own administrator access/.test(ana.notification()) && rows(world, "Team").length === 2, "an administrator cannot lock themselves out");
      c = ana.back();
      c = ana.click("Edit", {}, { list: "rules" });
      c = ana.click("Save", { items: "Printer or scanner | | | | ben@example.com" });
      eq(rows(world, "Assignment rules"), [["Printer or scanner", "", "", "", "ben@example.com"]], "an assignment rule is saved to its tab");
      c = ana.click("Edit", {}, { list: "rules" });
      c = ana.click("Save", { items: "Printer or scanner | | | | ben@example.com\nNetwork or Wi-Fi | High" });
      check(/Item 2 needs a value for "Assign to"/.test(ana.notification()) && rows(world, "Assignment rules").length === 1, "a rule with nobody to assign to is not saved, and the reason is shown");
      c = ana.back();
      c = ana.click("Edit", {}, { group: "Tickets" });
      c = ana.click("Save", { ticketPrefix: "IT-", ticketWord: "ticket", requesterSetsPriority: "" });
      eq(rows(world, "Settings").filter((r) => ["Ticket number prefix", "Word for a ticket", "Requesters choose the priority"].includes(r[0])).map((r) => r[1]), ["IT-", "ticket", "no"], "general settings are saved to the Settings tab");
      c = ana.click("Edit", {}, { group: "Branding" });
      c = ana.click("Save", { accentColor: "greenish", website: "www.example.org" });
      check(/Corrected because the value could not be used: Accent color\./.test(ana.notification()), "a value that could not be used is named when saving");
      // Renaming a status in place renames it on the tickets that use it.
      c = ana.click("Edit", {}, { list: "statuses" });
      c = ana.click("Save", { items: "Open | open | no\nWorking on it | open | yes\nWaiting on requester | waiting | yes\nResolved | done | yes\nClosed | done | no" });
      check(/Renamed on 1 ticket\./.test(ana.notification()) && rows(world, "Tickets")[0][10] === "Working on it", "renaming a status renames it on the tickets that use it");
      c = ana.click("Edit", {}, { key: "created" });
      c = ana.click("Save", { subject: "Got it: {{ticket.id}}", body: "Thanks, {{requester.name}}." });
      eq(rows(world, "Email wording")[0].slice(0, 3), ["created", "Got it: {{ticket.id}}", "Thanks, {{requester.name}}."], "email wording is saved");

      const mailBefore = world.mail.length;
      c = pat.open();
      c = pat.click("New ticket");
      check(!c.inputs.some((i) => i.name === "priority"), "the priority field is hidden from requesters when that is turned off");
      c = pat.click("Send ticket", { subject: "Second", description: "Scanner", category: "Printer or scanner" });
      eq([c.title, rows(world, "Tickets")[1][11]], ["IT-0002", "ben@example.com"], "the new prefix is used and the rule assigns the ticket");
      eq(world.mail.slice(mailBefore).map((m) => [m.to, m.subject]), [["pat@example.com", "Got it: IT-0002"], ["ben@example.com", "[IT-0002] New Normal ticket: Second"]], "the edited email wording is used");
      c = ana.open();
      c = ana.click("Settings");
      c = ana.click("Edit", {}, { key: "created" });
      c = ana.click("Use the original wording");
      check(rows(world, "Email wording")[0][1].startsWith("[{{ticket.id}}] We received"), "an email can be reset to its original wording");

      // A change made directly in the Sheet shows up after the five-minute cache.
      const cats = tab(world, "Categories");
      cats.getRange(cats.getLastRow() + 1, 1, 1, 4).setValues([["Badge reader", "", "", "yes"]]);
      c = pat.open();
      c = pat.click("New ticket");
      check(!c.inputs.find((i) => i.name === "category").items.some((i) => i.value === "Badge reader"), "a Sheet edit is not seen while settings are cached");
      world.tick(301000);
      c = pat.open();
      c = pat.click("New ticket");
      check(c.inputs.find((i) => i.name === "category").items.some((i) => i.value === "Badge reader"), "a Sheet edit is seen after five minutes");

      // Numbers never repeat, even when rows are removed or sorted.
      for (let i = 0; i < 18; i++) p.context.Service.handle("create", { subject: "Bulk " + i, description: "x", category: "Something else" }, { email: "pat@example.com" });
      const ids = rows(world, "Tickets").map((r) => r[0]);
      check(new Set(ids).size === ids.length && ids[ids.length - 1] === "IT-0020", "twenty tickets have twenty different numbers");
      const sheet = tab(world, "Tickets");
      sheet.getRange(sheet.getLastRow() - 1, 1, 1, 15).clearContent();
      const next = p.context.Service.handle("create", { subject: "After a gap", description: "x", category: "Something else" }, { email: "pat@example.com" });
      eq(next.ticket.id, "IT-0021", "the next number is one more than the highest, not the row count");

      // Paging and search.
      c = ana.open();
      c = ana.click("View", {}, { view: "all" });
      check(c.rows.length === 15 && c.all.includes("Page 1 of 2"), "long lists are paged");
      c = ana.click("Next");
      check(c.rows.length === 5 && c.all.includes("Page 2 of 2"), "the next page shows the rest");
      c = ana.open();
      c = ana.click("Search", { query: "GAP after" });
      eq([c.rows.length, c.rows[0].text], [1, "After a gap"], "search finds a ticket by its words");
      c = ana.open();
      c = ana.click("Search", { query: "it-0017" });
      eq(c.rows.map((r) => r.top.split(" ")[0]), ["IT-0017"], "search finds a ticket by its number");

      eq(Array.from(p.used).sort(), ["MailApp", "Session", "SpreadsheetApp"], "the Standard project calls only the services its permissions cover");

      // Creating a ticket from the open email (needs the optional permission).
      p.message = { id: "m1", from: "\"Dana Cruz\" <Dana.Cruz@example.com>", subject: "RE: Fwd: Projector is dead", body: "It will not turn on.\n" };
      ana.gmail = { messageId: "m1", accessToken: "tok" };
      c = ana.open();
      check(c.buttons.some((b) => b.text === "Create from this email"), "with a message open, the home card offers to create a ticket from it");
      c = ana.click("Create from this email");
      const filled = Object.fromEntries(c.inputs.map((i) => [i.name, i.value]));
      eq([filled.subject, filled.description, filled.requesterEmail, filled.requesterName], ["Projector is dead", "It will not turn on.\n", "dana.cruz@example.com", "Dana Cruz"], "the form is filled from the email and its sender");
      c = ana.click("Send ticket", { category: "Meeting room equipment" });
      const last = rows(world, "Tickets").pop();
      eq([last[3], last[4], last[14]], ["dana.cruz@example.com", "Dana Cruz", "email"], "the ticket is in the sender's name");
      pat.gmail = null;
      c = pat.open();
      check(!c.buttons.some((b) => b.text === "Create from this email"), "without a message open there is no such button");
    }

    // --- Private install --------------------------------------------------------------
    {
      const world = makeWorld();
      const URL = "https://script.google.com/macros/s/AKfy-test/exec";
      const service = makeProject({ world, files: filesFor("service"), owner: "helpdesk@example.com", user: "helpdesk@example.com" });
      service.deployWebApp(URL);
      const addon = makeProject({ world, files: filesFor("addon"), user: "pat@example.com", timeZone: "Asia/Tokyo", properties: { SERVICE_URL: URL } });
      const reply = (payload) => JSON.parse(service.context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());

      eq(service.context.doGet().getContent().includes("is running"), true, "opening the service address in a browser shows only a notice");
      check(!reply({ action: "boot" }).ok && !reply({ token: "nonsense", action: "boot" }).ok, "a request without a valid sign-in token is refused");

      const pat = makeSession(addon, "pat@example.com");
      let c = pat.open();
      check(/not connected yet/.test(c.all), "before the owner connects the add-on, other people are refused");
      const owner = makeSession(addon, "helpdesk@example.com");
      c = owner.open();
      check(c.buttons.some((b) => b.text === "Create the help desk"), "the owner is offered the setup");
      c = owner.click("Create the help desk", { orgName: "Example Org", preset: "school" });
      eq([c.title, sheetOf(world).owner, sheetOf(world).editors.size], ["IT Help Desk", "helpdesk@example.com", 0], "the Sheet belongs to the owner and is shared with no one");
      check(service.properties.get("ALLOWED_AUDIENCE") === addon.audience, "the service remembers which add-on project it answers");

      c = pat.open();
      eq(c.buttons.map((b) => b.text), ["New request", "View"], "a staff member can use the help desk without any access to the Sheet");
      c = pat.click("New request");
      const fetchesBefore = addon.fetchLog.length;
      c = pat.click("Send request", { subject: "Projector", description: "No picture", category: "Projector or display", priority: "Normal", location: "Library" });
      eq(addon.fetchLog.length - fetchesBefore, 1, "sending a request is one trip to the service, not four");
      eq([c.title, world.mail.map((m) => m.from)], ["TKT-0001", ["helpdesk@example.com", "helpdesk@example.com"]], "the ticket is saved and email comes from the help desk's account");
      c = pat.open();
      const listBefore = addon.fetchLog.length;
      c = pat.click("View");
      eq(c.rows.map((r) => r.text), ["Projector"], "they see their own request");
      const openBefore = addon.fetchLog.length;
      c = pat.click("Projector");
      eq([openBefore - listBefore, addon.fetchLog.length - openBefore], [1, 1], "a list and a ticket each take one trip to the service");
      // The add-on project is in another time zone than the service; times follow the service.
      check(c.all.includes("Created | Nov 13, 10:00 AM"), "cards show times in the help desk's zone, whatever zone the add-on project has", c.all);
      c = owner.open();
      c = owner.click("View", {}, { view: "open" });
      c = owner.click("Projector");
      world.tick(60000);
      c = owner.click("Save", { due: "2026-12-01 09:30" });
      eq(rows(world, "Tickets")[0][12], "2026-12-01T14:30:00.000Z", "a typed due time is read in the help desk's zone too");
      const lee = makeSession(addon, "lee@example.com");
      c = lee.open();
      c = lee.click("View");
      eq(c.rows.length, 0, "and nobody else's");

      eq([Array.from(addon.used).sort(), Array.from(service.used).sort()], [["IdentityToken", "UrlFetchApp"], ["MailApp", "Session", "SpreadsheetApp", "UrlFetchApp"]], "each project calls only the services its permissions cover");
      check(addon.fetchLog.every((f) => f.url === URL) && service.fetchLog.every((f) => f.url.startsWith("https://oauth2.googleapis.com/tokeninfo")), "the add-on talks only to the service, and the service only to Google's token check");
      c = pat.open();
      const checksBefore = service.fetchLog.length;
      c = pat.open();
      c = pat.open();
      eq(service.fetchLog.length, checksBefore, "a checked sign-in token is remembered for a few minutes");
      world.tick(3700000);
      c = pat.open();
      check(service.fetchLog.length > checksBefore && c.buttons.some((b) => b.text === "New request"), "after the token expires a new one is checked");

      // A different add-on project, even one a real colleague made, is refused.
      const rogue = makeProject({ world, files: filesFor("addon"), user: "pat@example.com", properties: { SERVICE_URL: URL } });
      c = makeSession(rogue, "pat@example.com").open();
      check(/made for a different add-on/.test(c.all), "a sign-in token issued to another project is refused");

      // With ALLOWED_DOMAIN set, outside accounts are refused.
      service.properties.set("ALLOWED_DOMAIN", "example.com");
      c = makeSession(addon, "eve@elsewhere.org").open();
      check(/only accepts accounts from example.com/.test(c.all), "an account from another domain is refused");
      c = pat.open();
      check(c.buttons.some((b) => b.text === "New request"), "accounts from the allowed domain still work");
      // A personal Google account registered with an address at the domain is not a domain account.
      addon.hd = "";
      c = pat.open();
      world.tick(400000);
      c = pat.open();
      check(/only accepts accounts from example.com/.test(c.all), "the domain check uses Google's own domain claim, not the email address");
      addon.hd = null;
      service.properties.delete("ALLOWED_DOMAIN");

      // A wrong address is explained.
      const lost = makeProject({ world, files: filesFor("addon"), user: "pat@example.com", properties: { SERVICE_URL: "https://example.com/exec" } });
      check(/must be the help desk's web app address/.test(makeSession(lost, "pat@example.com").open().all), "a SERVICE_URL that is not an Apps Script web app is explained");
      const unset = makeProject({ world, files: filesFor("addon"), user: "pat@example.com" });
      check(/SERVICE_URL/.test(makeSession(unset, "pat@example.com").open().all), "a missing SERVICE_URL is explained");
      const dead = makeProject({ world, files: filesFor("addon"), user: "pat@example.com", properties: { SERVICE_URL: "https://script.google.com/macros/s/gone/exec" } });
      check(/did not answer as expected/.test(makeSession(dead, "pat@example.com").open().all), "a web app address that no longer exists is explained");

      // The owner can also set up from the editor, without the add-on.
      const world2 = makeWorld();
      const service2 = makeProject({ world: world2, files: filesFor("service"), owner: "desk@example.com", user: "desk@example.com" });
      service2.context.setupHelpDesk();
      eq(rows(world2, "Team"), [["desk@example.com", "Desk", "admin", "yes"]], "setupHelpDesk run from the editor creates the help desk");
      let threw = false;
      try {
        service2.context.setupHelpDesk();
      } catch (e) {
        threw = /already set up/.test(e.message);
      }
      check(threw, "running setup twice is refused");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return "Standard and Private installs behave as designed in the simulated Apps Script";
}
