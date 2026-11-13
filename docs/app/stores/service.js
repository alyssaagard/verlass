/**
 * The help desk service for the web app (the Outlook task pane, the browser app, and the demo).
 *
 * It does for the web what Service.gs does for Gmail: it checks who is asking, applies the
 * shared rules in ../core, saves through a backend, and sends email. The answers have the same
 * shape as the Gmail service's, so one set of screens works everywhere.
 *
 * A backend supplies storage and mail. All of its methods may be async:
 *   me()                         -> { email, name }
 *   loadSettings()               -> stored settings, or null when the help desk is not set up
 *   saveSettings(settings)
 *   canSetup()                   -> true when this person may create the help desk
 *   setup(settings)              -> creates storage and saves the first settings
 *   allTickets()                 -> every ticket this person is allowed to read
 *   getTicket(id)                -> one ticket or null
 *   createTicket(ticket, activity) -> the ticket with its final id and number
 *   saveTicket(ticket, extras)   -> extras: { messages (public), activity, expectedUpdatedAt }
 *   addNotes(ticket, notes)      -> internal notes, team only
 *   thread(ticket, isTeam)       -> { messages, activity }
 *   nextNumber()                 -> the next ticket number, or 0 when storage assigns it
 *   assignsNumbers               -> true when storage numbers tickets itself (see stamp below)
 *   rrIndex(), setRrIndex(i)     -> round robin position (optional)
 *   sendMail(mail)               -> { to, subject, text, html, replyTo, senderName }
 *   localParts(date, timeZone)   -> { dow, minutes, date }
 *   formatDate(iso, timeZone)    -> text
 *   adminInfo()                  -> extra facts for the settings screen (optional)
 *   renameTickets(plan)          -> renames statuses, priorities, categories, and locations on
 *                                   stored tickets; resolves to how many tickets changed
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { normalizeEmail, cleanLine, nameFromEmail } from "../core/text.js";
import { normalizeSettings, defaultSettings, settingsWarnings, publicSettings, roleOf, teamMember, TEMPLATE_KEYS, renamePlan, hasRenames, applyRenamesToSettings, adjustedFields, orphanWarnings } from "../core/settings.js";
import { listById } from "../core/lists.js";
import { planCreate, planUpdate, listTickets, ticketStats, canSee, visibleMessages, isOverdue, ticketId } from "../core/tickets.js";
import { renderNotification } from "../core/mail.js";

const fail = (messages) => ({ ok: false, errors: [].concat(messages) });

export function makeService(backend) {
  let cachedSettings = null;
  let cachedAt = 0;

  async function settings(fresh) {
    if (!fresh && cachedSettings && Date.now() - cachedAt < 60000) return cachedSettings;
    const raw = await backend.loadSettings();
    if (!raw) return null;
    cachedSettings = normalizeSettings(raw);
    cachedAt = Date.now();
    return cachedSettings;
  }

  async function actor() {
    const me = await backend.me();
    const email = normalizeEmail(me && me.email);
    if (!email) throw new Error("Your email address could not be read.");
    return { email, name: cleanLine(me.name, 80) };
  }

  /**
   * Some storage numbers tickets itself (a SharePoint list numbers its items). Those backends set
   * assignsNumbers and return tickets with only a number; the id is made here from the settings.
   */
  const stamp = (t, s) => (backend.assignsNumbers && t ? Object.assign({}, t, { id: ticketId(t.number, s) }) : t);
  const everyTicket = async (s) => (await backend.allTickets()).map((t) => stamp(t, s));

  const zone = (s) => s.general.timeZone || "";

  /** Warnings for an administrator: the settings' own, plus a time zone this device does not know. */
  const warningsFor = (s, tickets) => {
    const out = settingsWarnings(s);
    if (s.general.timeZone && !knownTimeZone(s.general.timeZone)) out.push(`The time zone "${s.general.timeZone}" is not one this device knows, so times are shown in the device's own zone.`);
    return tickets ? out.concat(orphanWarnings(s, tickets)) : out;
  };
  const partsFor = (s) => (date) => backend.localParts(date, zone(s));
  const formatFor = (s) => (iso) => backend.formatDate(iso, zone(s));

  /** Sends the planned emails. A failure is reported back but never undoes the saved ticket. */
  async function send(notifications, ticket, s, who) {
    const problems = [];
    for (const n of notifications) {
      try {
        const mail = renderNotification(n, ticket, s, who, formatFor(s));
        mail.to = mail.to.filter((e) => normalizeEmail(e));
        if (mail.to.length) await backend.sendMail(mail);
      } catch (e) {
        problems.push(String((e && e.message) || e));
      }
    }
    return problems;
  }

  async function boot() {
    const who = await actor();
    const s = await settings(true);
    if (!s) return { ok: true, ready: false, canSetup: await backend.canSetup(), user: who };
    const role = roleOf(s, who.email);
    const tickets = await everyTicket(s);
    const stats = ticketStats(tickets, who.email, s, Date.now());
    const member = teamMember(s, who.email);
    const out = {
      ok: true,
      ready: true,
      role,
      user: { email: who.email, name: (member && member.name) || who.name || nameFromEmail(who.email) },
      settings: role === "requester" ? publicSettings(s) : s,
      stats: role === "requester" ? { requestedOpen: stats.requestedOpen } : stats,
    };
    if (role === "admin") out.warnings = warningsFor(s, tickets);
    return out;
  }

  async function setup(payload) {
    const who = await actor();
    if (await settings(true)) return fail("The help desk is already set up.");
    if (!(await backend.canSetup())) return fail("Only an administrator can set up the help desk.");
    const p = payload || {};
    const first = defaultSettings(p.preset);
    first.general.orgName = cleanLine(p.orgName, 80);
    // Due times must not depend on whose device does the counting, so the zone is fixed now.
    first.general.timeZone = browserTimeZone();
    first.team.push({ email: who.email, name: who.name || nameFromEmail(who.email), role: "admin", active: true });
    await backend.setup(normalizeSettings(first));
    cachedSettings = null;
    return boot();
  }

  async function create(payload) {
    const who = await actor();
    const s = await settings();
    if (!s) return fail("The help desk has not been set up yet.");
    const number = await backend.nextNumber();
    const rr = backend.rrIndex ? await backend.rrIndex() : undefined;
    const plan = planCreate(payload, who, s, { now: new Date(), number, rrIndex: rr, source: (payload && payload.source) || "web", localParts: partsFor(s) });
    if (!plan.ok) return plan;
    const saved = stamp(await backend.createTicket(plan.ticket, plan.activity), s);
    if (backend.setRrIndex && plan.rrIndex !== undefined && plan.rrIndex !== rr) await backend.setRrIndex(plan.rrIndex);
    const mailProblems = await send(plan.notifications, saved, s, who);
    return { ok: true, ticket: saved, mailProblems };
  }

  async function list(payload) {
    const who = await actor();
    const s = await settings();
    if (!s) return fail("The help desk has not been set up yet.");
    const now = Date.now();
    const result = listTickets(await everyTicket(s), payload, who.email, s, now);
    result.items = result.items.map((t) => ({
      id: t.id, subject: t.subject, status: t.status, priority: t.priority, category: t.category, requesterName: t.requesterName,
      requesterEmail: t.requesterEmail, assignedTo: t.assignedTo, updatedAt: t.updatedAt, dueAt: t.dueAt, overdue: isOverdue(t, s, now),
    }));
    return { ok: true, list: result };
  }

  async function detail(ticket, who, s) {
    const isTeam = roleOf(s, who.email) !== "requester";
    const thread = await backend.thread(ticket, isTeam);
    return {
      ok: true,
      ticket,
      overdue: isOverdue(ticket, s, Date.now()),
      messages: visibleMessages(thread.messages, who.email, s),
      activity: isTeam ? thread.activity : [],
    };
  }

  async function get(payload) {
    const who = await actor();
    const s = await settings();
    if (!s) return fail("The help desk has not been set up yet.");
    const ticket = stamp(await backend.getTicket(payload && payload.id), s);
    if (!ticket || !canSee(ticket, who.email, s)) return fail("That " + s.general.ticketWord + " was not found.");
    return detail(ticket, who, s);
  }

  async function update(payload) {
    const who = await actor();
    // Fresh settings for a change, so someone just removed from the team cannot keep acting.
    const s = await settings(true);
    if (!s) return fail("The help desk has not been set up yet.");
    const p = payload || {};
    const ticket = stamp(await backend.getTicket(p.id), s);
    if (!ticket || !canSee(ticket, who.email, s)) return fail("That " + s.general.ticketWord + " was not found.");
    const stale = "Someone else changed this " + s.general.ticketWord + " a moment ago. The latest is shown now and what you typed is kept, so check it and save again.";
    if (p.expectedUpdatedAt && ticket.updatedAt && p.expectedUpdatedAt !== ticket.updatedAt) return fail(stale);
    const plan = planUpdate(ticket, p.changes, who, s, { now: new Date(), localParts: partsFor(s) });
    if (!plan.ok) return plan;
    // When this person cannot store internal notes at all, say so before anything is saved, so
    // the note stays on their screen and the activity log never mentions a note that is not there.
    if (plan.messages.some((m) => m.visibility === "internal") && backend.canAddNotes && !(await backend.canAddNotes())) {
      return fail(backend.notesProblem ? backend.notesProblem() : "Internal notes cannot be saved with your account.");
    }
    let mailProblems = [];
    let noteProblem = "";
    if (plan.changed) {
      const publicMessages = plan.messages.filter((m) => m.visibility === "public");
      const notes = plan.messages.filter((m) => m.visibility === "internal");
      try {
        await backend.saveTicket(plan.ticket, { messages: publicMessages, activity: plan.activity, expectedUpdatedAt: ticket.updatedAt });
      } catch (e) {
        if (e && e.code === "conflict") return fail(stale);
        throw e;
      }
      if (notes.length) {
        // The ticket is already saved. A note that cannot be saved is reported, not thrown, so
        // the email still goes out and the person is not told that nothing happened.
        try {
          await backend.addNotes(plan.ticket, notes);
        } catch (e) {
          noteProblem = String((e && e.message) || e);
        }
      }
      mailProblems = await send(plan.notifications, plan.ticket, s, who);
    }
    const out = await detail(plan.ticket, who, s);
    out.changed = plan.changed;
    out.mailProblems = mailProblems;
    out.noteProblem = noteProblem;
    return out;
  }

  async function settingsGet() {
    const who = await actor();
    const s = await settings(true);
    if (!s) return fail("The help desk has not been set up yet.");
    if (roleOf(s, who.email) !== "admin") return fail("Only an administrator can open the settings.");
    return { ok: true, settings: s, warnings: warningsFor(s, await everyTicket(s)), info: backend.adminInfo ? await backend.adminInfo() : {} };
  }

  /** payload: { general, lists: { id: items }, templates: { key: { subject, body } } }, each optional. */
  async function settingsSave(payload) {
    const who = await actor();
    const current = await settings(true);
    if (!current) return fail("The help desk has not been set up yet.");
    if (roleOf(current, who.email) !== "admin") return fail("Only an administrator can change the settings.");
    const p = payload || {};
    let next = JSON.parse(JSON.stringify(current));
    for (const key of Object.keys(p.general || {})) next.general[key] = p.general[key];
    for (const id of Object.keys(p.lists || {})) if (listById(id)) next[id] = p.lists[id];
    for (const key of Object.keys(p.templates || {})) if (TEMPLATE_KEYS.includes(key)) next.templates[key] = p.templates[key];
    // A renamed item is renamed wherever it is used: in rules and defaults here, and on stored
    // tickets below. The web editor says which row became which (p.renames); without that, only
    // a rename that changed nothing else in the list is recognized.
    const plan = renamePlan(current, normalizeSettings(next), p.renames && typeof p.renames === "object" ? p.renames : undefined);
    if (hasRenames(plan)) next = applyRenamesToSettings(next, plan);
    next = normalizeSettings(next);
    if (roleOf(next, who.email) !== "admin") return fail("That change would remove your own administrator access, so it was not saved.");
    // Tickets are renamed before the settings are saved. If renaming stops part way, the settings
    // still hold the old names, so saving again finds the same renames and finishes the rest.
    let renamedTickets = 0;
    if (hasRenames(plan) && backend.renameTickets) {
      try {
        renamedTickets = await backend.renameTickets(plan);
      } catch (e) {
        return fail("Some tickets could not be renamed, so the settings were not saved. Save again to finish. (" + String((e && e.message) || e) + ")");
      }
    }
    await backend.saveSettings(next);
    cachedSettings = next;
    cachedAt = Date.now();
    return {
      ok: true,
      settings: next,
      adjusted: adjustedFields(p.general, next),
      renamedTickets,
      warnings: warningsFor(next, await everyTicket(next)),
      info: backend.adminInfo ? await backend.adminInfo() : {},
    };
  }

  const actions = { boot, setup, create, list, get, update, settingsGet, settingsSave };

  /** Runs one action. Always resolves to an object with ok true or false. */
  async function call(action, payload) {
    if (!Object.prototype.hasOwnProperty.call(actions, action)) return fail("Unknown action.");
    try {
      return await actions[action](payload || {});
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  return { call, ticketId };
}

/** The device's own time zone name, such as America/New_York, or "" when it cannot be read. */
export function browserTimeZone() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (e) {
    return "";
  }
}

/** True when this device can format times in the named zone. */
export function knownTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch (e) {
    return false;
  }
}

/** The local day and time of a moment in a time zone ("" means the browser's own). */
export function browserLocalParts(date, timeZone) {
  const options = { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" };
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", timeZone ? { ...options, timeZone } : options).formatToParts(date);
  } catch (e) {
    parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  }
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dow, minutes: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

/** "Fri, Nov 13, 2026, 2:05 PM" in a time zone ("" means the browser's own). */
export function browserFormatDate(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const options = { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-US", timeZone ? { ...options, timeZone } : options).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat("en-US", options).format(d);
  }
}
