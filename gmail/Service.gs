/**
 * Verlass for Gmail: the help desk service.
 *
 * Service.handle(action, payload, actor) is the one door to the help desk's data. It checks
 * who is asking, applies the shared rules in Core.gs, saves through Store.gs, and sends email.
 *
 * Standard install: the add-on calls Service.handle directly, as the person using Gmail.
 * Private install: this file runs in its own project as a web app owned by the help desk
 * account. The add-on sends each request to doPost with a Google identity token, so staff
 * never need access to the spreadsheet.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */

/**
 * True when a time zone name is one the runtime knows. Utilities.formatDate does not reliably
 * refuse an unknown name (it may quietly use GMT), so the name is checked with Intl, which the
 * Apps Script V8 runtime provides and which throws for a name it does not know.
 */
function knownZone_(tz) {
  if (!tz) return false;
  try {
    if (typeof Intl === "undefined") {
      Utilities.formatDate(new Date(), tz, "HH");
      return true;
    }
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

var Service = (function () {
  /** The zone the help desk counts and shows times in: the setting, or this project's own zone. */
  function zone_(settings) {
    var tz = settings.general.timeZone;
    return knownZone_(tz) ? tz : Session.getScriptTimeZone();
  }

  /** Warnings for an administrator: the settings' own, names tickets use that left the lists, and an unknown zone. */
  function warnings_(settings, tickets) {
    var out = Core.settingsWarnings(settings).concat(Core.orphanWarnings(settings, tickets));
    var tz = settings.general.timeZone;
    if (tz && !knownZone_(tz)) out.push('The time zone "' + tz + '" is not a known zone name, so times use the help desk\'s own zone, ' + Session.getScriptTimeZone() + ".");
    return out;
  }

  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  /** The local day and time of a moment, for working-hours due dates. */
  function localParts_(settings) {
    var tz = zone_(settings);
    return function (date) {
      var p = Utilities.formatDate(date, tz, "EEE|H|m|yyyy-MM-dd").split("|");
      return { dow: DOW[p[0]], minutes: Number(p[1]) * 60 + Number(p[2]), date: p[3] };
    };
  }

  function formatDate_(settings) {
    var tz = zone_(settings);
    return function (iso) {
      var ms = Core.toMs(iso);
      return isNaN(ms) ? "" : Utilities.formatDate(new Date(ms), tz, "EEE, MMM d, yyyy, h:mm a");
    };
  }

  function fail_(messages) {
    return { ok: false, errors: [].concat(messages) };
  }

  /** Sends the planned emails. A failed email is written to the activity log, never thrown. */
  function send_(notifications, ticket, settings, actor) {
    var problems = [];
    notifications.forEach(function (n) {
      try {
        var m = Core.renderNotification(n, ticket, settings, actor, formatDate_(settings));
        var to = m.to.filter(function (e) { return Core.normalizeEmail(e); });
        if (!to.length) return;
        var mail = { to: to.join(","), subject: m.subject, body: m.text, htmlBody: m.html, name: m.senderName };
        if (m.replyTo) mail.replyTo = m.replyTo;
        MailApp.sendEmail(mail);
      } catch (e) {
        problems.push(String((e && e.message) || e));
      }
    });
    if (problems.length) {
      try {
        Store.addActivity(ticket.id, [{ at: new Date().toISOString(), by: "system", text: "An email could not be sent: " + problems[0] }]);
      } catch (e) {
        // The ticket itself is saved; there is nothing more to do here.
      }
    }
    return problems.length;
  }

  // --- Actions -----------------------------------------------------------------

  function boot(payload, actor) {
    if (!Store.exists()) return { ok: true, ready: false, canSetup: isOwner_(actor.email), user: actor };
    var settings = Store.loadSettings();
    var role = Core.roleOf(settings, actor.email);
    var tickets = Store.allTickets();
    var out = {
      ok: true,
      ready: true,
      role: role,
      user: { email: actor.email, name: (Core.teamMember(settings, actor.email) || {}).name || actor.name || Core.nameFromEmail(actor.email) },
      settings: role === "requester" ? Core.publicSettings(settings) : settings,
      stats: Core.ticketStats(tickets, actor.email, settings, Date.now()),
    };
    if (role === "requester") {
      out.stats = { requestedOpen: out.stats.requestedOpen };
    }
    // The cards show and read times in this zone, also when the add-on is a separate project.
    out.zone = zone_(settings);
    if (role === "admin") {
      out.sheetUrl = Store.url();
      out.warnings = warnings_(settings, tickets);
    }
    return out;
  }

  /** In a web app the effective user is the owner; in the add-on it is the person using it. */
  function isOwner_(email) {
    var owner = "";
    try {
      owner = Session.getEffectiveUser().getEmail();
    } catch (e) {
      owner = "";
    }
    return !!owner && Core.sameEmail(owner, email);
  }

  function setup(payload, actor) {
    if (Store.exists()) return fail_("The help desk is already set up.");
    if (!isOwner_(actor.email)) return fail_("Only the help desk owner can set it up.");
    Store.locked(function () {
      if (!Store.exists()) Store.create(payload.preset, actor, payload.orgName);
    });
    return boot({}, actor);
  }

  function create(payload, actor) {
    var settings = Store.loadSettings();
    var plan = Store.locked(function () {
      var p = Core.planCreate(payload, actor, settings, {
        now: new Date(),
        number: Store.nextNumber(),
        rrIndex: Store.rrIndex(),
        source: payload.source || "gmail",
        localParts: localParts_(settings),
      });
      if (!p.ok) return p;
      Store.addTicket(p.ticket);
      Store.addActivity(p.ticket.id, p.activity);
      if (p.rrIndex !== undefined && p.rrIndex !== Store.rrIndex()) Store.setRrIndex(p.rrIndex);
      return p;
    });
    if (!plan.ok) return plan;
    send_(plan.notifications, plan.ticket, settings, actor);
    // The new ticket's details come back with it, so the card needs no second request. The
    // ticket is saved by now, so a failure to read the details must never report it as unsent.
    try {
      return detail_(plan.ticket, actor, settings);
    } catch (e) {
      return { ok: true, ticket: plan.ticket, overdue: false, messages: [], activity: [] };
    }
  }

  function list(payload, actor) {
    var settings = Store.loadSettings();
    var now = Date.now();
    var result = Core.listTickets(Store.allTickets(), payload, actor.email, settings, now);
    result.items = result.items.map(function (t) {
      return { id: t.id, subject: t.subject, status: t.status, priority: t.priority, category: t.category, requesterName: t.requesterName, requesterEmail: t.requesterEmail, assignedTo: t.assignedTo, updatedAt: t.updatedAt, dueAt: t.dueAt, overdue: Core.isOverdue(t, settings, now) };
    });
    return { ok: true, list: result };
  }

  function detail_(ticket, actor, settings) {
    var isTeam = Core.roleOf(settings, actor.email) !== "requester";
    return {
      ok: true,
      ticket: ticket,
      overdue: Core.isOverdue(ticket, settings, Date.now()),
      messages: Core.visibleMessages(Store.messagesFor(ticket.id), actor.email, settings),
      activity: isTeam ? Store.activityFor(ticket.id) : [],
    };
  }

  function get(payload, actor) {
    var settings = Store.loadSettings();
    var ticket = Store.getTicket(payload.id);
    if (!ticket || !Core.canSee(ticket, actor.email, settings)) return fail_("That " + settings.general.ticketWord + " was not found.");
    return detail_(ticket, actor, settings);
  }

  function update(payload, actor) {
    var settings = Store.loadSettings();
    var plan = Store.locked(function () {
      var ticket = Store.getTicket(payload.id);
      if (!ticket || !Core.canSee(ticket, actor.email, settings)) return fail_("That " + settings.general.ticketWord + " was not found.");
      if (payload.expectedUpdatedAt && ticket.updatedAt && payload.expectedUpdatedAt !== ticket.updatedAt) {
        return fail_("Someone else changed this " + settings.general.ticketWord + " a moment ago. Open it again to see the latest, then make your change.");
      }
      var p = Core.planUpdate(ticket, payload.changes, actor, settings, { now: new Date(), localParts: localParts_(settings) });
      if (!p.ok || !p.changed) return p;
      Store.saveTicket(p.ticket);
      Store.addMessages(p.ticket.id, p.messages);
      Store.addActivity(p.ticket.id, p.activity);
      return p;
    });
    if (!plan.ok) return plan;
    if (plan.changed) send_(plan.notifications, plan.ticket, settings, actor);
    var out = detail_(plan.ticket, actor, settings);
    out.changed = plan.changed;
    return out;
  }

  function settingsGet(payload, actor) {
    var settings = Store.loadSettings(true);
    if (Core.roleOf(settings, actor.email) !== "admin") return fail_("Only an administrator can open the settings.");
    return { ok: true, settings: settings, warnings: warnings_(settings, Store.allTickets()), sheetUrl: Store.url() };
  }

  /**
   * Saves part of the settings. payload may hold general (some keys), lists ({ id: items }),
   * and templates ({ key: { subject, body } }). Everything else stays as it is.
   */
  function settingsSave(payload, actor) {
    return Store.locked(function () {
      var current = Store.loadSettings(true);
      if (Core.roleOf(current, actor.email) !== "admin") return fail_("Only an administrator can change the settings.");
      var next = JSON.parse(JSON.stringify(current));
      var p = payload || {};
      Object.keys(p.general || {}).forEach(function (key) { next.general[key] = p.general[key]; });
      Object.keys(p.lists || {}).forEach(function (id) {
        if (Core.listById(id)) next[id] = p.lists[id];
      });
      Object.keys(p.templates || {}).forEach(function (key) {
        if (Core.TEMPLATE_KEYS.indexOf(key) !== -1) next.templates[key] = p.templates[key];
      });
      // A renamed item is renamed wherever it is used: in rules and defaults here, and on stored
      // tickets below. The text editor has no rows to follow, so only a rename that changed
      // nothing else in the list is recognized (see Core.renamePlan). renames: {} turns this off.
      var plan = Core.renamePlan(current, Core.normalizeSettings(next), p.renames && typeof p.renames === "object" ? p.renames : undefined);
      if (Core.hasRenames(plan)) next = Core.applyRenamesToSettings(next, plan);
      next = Core.normalizeSettings(next);
      if (Core.roleOf(next, actor.email) !== "admin") return fail_("That change would remove your own administrator access, so it was not saved.");
      // Tickets first: if this is cut short, the settings still hold the old names, and saving
      // again finds the same renames and finishes the rest.
      var renamedTickets = Core.hasRenames(plan) ? Store.renameTickets(plan) : 0;
      var saved = Store.saveSettings(next);
      return {
        ok: true,
        settings: saved,
        adjusted: Core.adjustedFields(p.general, saved),
        renamedTickets: renamedTickets,
        warnings: warnings_(saved, Store.allTickets()),
        sheetUrl: Store.url(),
      };
    });
  }

  var ACTIONS = { boot: boot, setup: setup, create: create, list: list, get: get, update: update, settingsGet: settingsGet, settingsSave: settingsSave };

  /** Runs one action for one person. Always returns an object with ok true or false. */
  function handle(action, payload, actor) {
    var email = Core.normalizeEmail(actor && actor.email);
    if (!email) return fail_("Your Google account's email address could not be read.");
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return fail_("Unknown action.");
    try {
      if (action !== "boot" && action !== "setup" && !Store.exists()) return fail_("The help desk has not been set up yet.");
      var who = { email: email, name: Core.cleanLine(actor.name, 80) };
      var result = ACTIONS[action](payload || {}, who);
      // A card usually needs the person's role and the settings along with its answer. Sending
      // them together saves a second request, which matters most in the Private install. The
      // action is already done, so a failure here only leaves the card to ask for them itself.
      if (payload && payload.withBoot && action !== "boot" && action !== "setup" && Store.exists()) {
        try {
          result.boot = boot({}, who);
        } catch (e) {
          result.boot = null;
        }
      }
      return result;
    } catch (e) {
      var message = String((e && e.message) || e);
      if (/permission|access denied|not have access/i.test(message)) message = "You do not have access to the help desk's spreadsheet. Ask your administrator to share it with you.";
      return fail_(message);
    }
  }

  return { handle: handle };
})();

/**
 * Checks the Google identity token the add-on sends in a Private install, and returns the
 * verified email address of the person using the add-on.
 */
var Identity = (function () {
  var PROP_AUDIENCE = "ALLOWED_AUDIENCE";
  var PROP_DOMAIN = "ALLOWED_DOMAIN";

  function digest_(text) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text));
  }

  function verify(token) {
    if (!token || typeof token !== "string") throw new Error("The add-on did not send a sign-in token.");
    var cache = CacheService.getScriptCache();
    var key = "helpdesk.id." + digest_(token);
    var hit = cache.get(key);
    if (hit) return { email: hit };

    var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token), { muteHttpExceptions: true });
    var status = response.getResponseCode();
    if (status === 400 || status === 401) throw new Error("Google did not accept the sign-in token. Close the add-on and open it again.");
    if (status !== 200) throw new Error("Google could not check the sign-in just now. Please try again in a moment.");
    var info = JSON.parse(response.getContentText());
    var email = Core.normalizeEmail(info.email);
    var seconds = Number(info.exp) - Math.floor(Date.now() / 1000);
    if (info.iss !== "https://accounts.google.com" && info.iss !== "accounts.google.com") throw new Error("The sign-in token did not come from Google.");
    if (!email || String(info.email_verified) !== "true") throw new Error("The sign-in token has no verified email address.");
    if (!(seconds > 0)) throw new Error("The sign-in token has expired. Close the add-on and open it again.");

    var props = PropertiesService.getScriptProperties();
    // Google's own domain claim (hd) decides. The part after the @ is not proof: a personal Google
    // account can be registered with any address. hd names the organization's primary domain,
    // also for people whose addresses use another of its domains. Several may be listed.
    var domains = String(props.getProperty(PROP_DOMAIN) || "").toLowerCase().split(",").map(function (d) { return d.trim(); }).filter(Boolean);
    var hd = String(info.hd || "").toLowerCase();
    if (domains.length && domains.indexOf(hd) === -1) {
      if (!hd) throw new Error("This help desk accepts only Google Workspace accounts from " + domains.join(", ") + ", and personal Google accounts are not accepted.");
      throw new Error("Your account belongs to the Google Workspace domain " + hd + ", which this help desk does not accept. ALLOWED_DOMAIN must list the organization's primary domain.");
    }

    var audience = props.getProperty(PROP_AUDIENCE);
    if (audience) {
      if (info.aud !== audience) throw new Error("This sign-in token was made for a different add-on. If the add-on project was moved to another Google Cloud project, delete the script property ALLOWED_AUDIENCE in the service project, then have the owner open the add-on first.");
    } else if (canPair_(email)) {
      // The first request from the owner or an administrator connects this add-on to the service.
      props.setProperty(PROP_AUDIENCE, String(info.aud));
    } else {
      throw new Error("The help desk is not connected yet. The owner or an administrator must open the add-on first.");
    }
    cache.put(key, email, Math.max(1, Math.min(300, seconds)));
    return { email: email };
  }

  function canPair_(email) {
    var owner = "";
    try {
      owner = Session.getEffectiveUser().getEmail();
    } catch (e) {
      owner = "";
    }
    if (owner && Core.sameEmail(owner, email)) return true;
    return Store.exists() && Core.roleOf(Store.loadSettings(), email) === "admin";
  }

  return { verify: verify };
})();

/** Private install: the add-on posts { token, action, payload } here. */
function doPost(e) {
  var out;
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var who = Identity.verify(request.token);
    out = Service.handle(request.action, request.payload || {}, { email: who.email, name: "" });
  } catch (err) {
    out = { ok: false, errors: [String((err && err.message) || err)] };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Opening the web app address in a browser shows only that the service is there. */
function doGet() {
  return ContentService.createTextOutput("The Verlass help desk service is running. Open the Verlass add-on in Gmail to use it.").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Optional: run this once from the Apps Script editor to create the help desk's spreadsheet
 * without opening the add-on. The account that runs it becomes the first administrator.
 * Change the two values first if you like; both can be changed later in the settings.
 */
function setupHelpDesk() {
  var preset = "office"; // office, school, nonprofit, or facilities
  var organizationName = "";
  var email = Session.getEffectiveUser().getEmail();
  var result = Service.handle("setup", { preset: preset, orgName: organizationName }, { email: email, name: "" });
  if (!result.ok) throw new Error(result.errors.join(" "));
  Logger.log("The help desk is ready. Its spreadsheet is in your Google Drive.");
}
