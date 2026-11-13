/**
 * The Microsoft 365 backend: the help desk stored in three SharePoint lists in the
 * organization's own tenant, reached through Microsoft Graph as the signed-in person.
 *
 *   Help Desk Tickets   one item per ticket. The public conversation and the activity log are
 *                       kept on the item itself, so a requester who can read their ticket can
 *                       read its replies. SharePoint's item-level permissions give each person
 *                       only the tickets they created; the help desk team sees them all.
 *   Help Desk Notes     internal notes. Only the team is given access to this list.
 *   Help Desk Settings  one item holding every setting. Everyone reads it; administrators write.
 *
 * SharePoint numbers the items, so the ticket number is the item's own ID and can never repeat.
 * Who may see what is enforced by SharePoint, not by this code. See the install guide for the
 * permissions each list needs.
 */
import { makeGraph, GraphError } from "./graph.js";
import { browserLocalParts, browserFormatDate } from "./service.js";
import { ticketNumber } from "../core/tickets.js";
import { renameOnTicket } from "../core/settings.js";

export const LIST_NAMES = { tickets: "Help Desk Tickets", notes: "Help Desk Notes", settings: "Help Desk Settings" };

const text = () => ({ text: {} });
const longText = () => ({ text: { allowMultipleLines: true, textType: "plain", linesForEditing: 6 } });

/** The columns each list needs, in the form Microsoft Graph creates them. */
export const LIST_COLUMNS = {
  tickets: [
    { name: "Details", ...longText() },
    { name: "Category", ...text() },
    { name: "Priority", ...text() },
    { name: "Location", ...text() },
    { name: "Status", ...text(), indexed: true },
    { name: "AssignedTo", ...text() },
    { name: "RequesterEmail", ...text(), indexed: true },
    { name: "RequesterName", ...text() },
    { name: "OpenedAt", ...text() },
    { name: "ChangedAt", ...text() },
    { name: "DueAt", ...text() },
    { name: "ClosedAt", ...text() },
    { name: "Source", ...text() },
    { name: "Conversation", ...longText() },
    { name: "History", ...longText() },
  ],
  notes: [
    { name: "TicketNumber", number: { decimalPlaces: "none" }, indexed: true },
    { name: "Body", ...longText() },
    { name: "NoteAt", ...text() },
    { name: "AuthorEmail", ...text() },
    { name: "AuthorName", ...text() },
  ],
  settings: [{ name: "Value", ...longText() }],
};

const MAX_FIELD = 60000; // A plain multi-line column holds about 63,999 characters.
const MAX_PAGES = 60; // 200 tickets a page: lists stop at 12,000 tickets.
// Lists read every column except the two long ones, which are read when one ticket is opened.
const LIST_FIELDS = "Title,Details,Category,Priority,Location,Status,AssignedTo,RequesterEmail,RequesterName,OpenedAt,ChangedAt,DueAt,ClosedAt,Source";
const NON_INDEXED = { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" };

/** "https://contoso.sharepoint.com/sites/helpdesk" as the Graph path of that site. */
export function sitePath(siteUrl) {
  const u = new URL(siteUrl);
  const p = u.pathname.replace(/\/+$/, "");
  // URL.pathname is already percent-encoded, so it is used as it is.
  return "/sites/" + u.hostname + (p ? ":" + p : "");
}

function parseList(value) {
  if (!value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
  } catch (e) {
    return [];
  }
}

const str = (v) => (v === null || v === undefined ? "" : String(v));

function toTicket(item) {
  const f = item.fields || {};
  return {
    id: "",
    number: Number(item.id),
    createdAt: str(f.OpenedAt) || str(item.createdDateTime),
    updatedAt: str(f.ChangedAt) || str(item.lastModifiedDateTime),
    requesterEmail: str(f.RequesterEmail).toLowerCase(),
    requesterName: str(f.RequesterName),
    subject: str(f.Title),
    description: str(f.Details),
    category: str(f.Category),
    priority: str(f.Priority),
    location: str(f.Location),
    status: str(f.Status),
    assignedTo: str(f.AssignedTo).toLowerCase(),
    dueAt: str(f.DueAt),
    closedAt: str(f.ClosedAt),
    source: str(f.Source),
  };
}

function toFields(t) {
  return {
    Title: t.subject, Details: t.description, Category: t.category, Priority: t.priority, Location: t.location, Status: t.status,
    AssignedTo: t.assignedTo, RequesterEmail: t.requesterEmail, RequesterName: t.requesterName, OpenedAt: t.createdAt, ChangedAt: t.updatedAt,
    DueAt: t.dueAt, ClosedAt: t.closedAt, Source: t.source,
  };
}

/**
 * options: { siteUrl, getToken(scopes), scopes, sendMail (true or false), fetch, names }
 */
export function makeSharePointBackend(options) {
  const o = options;
  const names = Object.assign({}, LIST_NAMES, o.names || {});
  const graph = o.graph || makeGraph(o.getToken, { fetch: o.fetch, scopes: o.scopes, maxWaitSeconds: o.maxWaitSeconds });
  let site = null; // { id, webUrl, displayName }
  let lists = null; // { tickets, notes, settings } -> { id, webUrl } or undefined
  let meCache = null;
  let ticketCache = null; // { at, items }
  const threads = new Map(); // ticket number -> { messages, activity, etag }

  async function resolve(force) {
    if (!site || force) site = await graph.get(sitePath(o.siteUrl) + "?$select=id,webUrl,displayName");
    if (!lists || force) {
      const found = await graph.all("/sites/" + site.id + "/lists?$select=id,displayName,webUrl&$top=200");
      lists = {};
      for (const key of Object.keys(names)) {
        const hit = found.find((l) => String(l.displayName).toLowerCase() === names[key].toLowerCase());
        if (hit) lists[key] = { id: hit.id, webUrl: hit.webUrl };
      }
    }
    return { site, lists };
  }

  const items = (key) => "/sites/" + site.id + "/lists/" + lists[key].id + "/items";

  function remember(item) {
    const f = item.fields || {};
    threads.set(Number(item.id), {
      messages: parseList(f.Conversation).map((m) => ({ at: str(m.at), by: str(m.by), byName: str(m.byName), role: m.role === "requester" ? "requester" : "team", visibility: "public", text: str(m.text) })),
      activity: parseList(f.History).map((a) => ({ at: str(a.at), by: str(a.by), text: str(a.text) })),
      etag: item["@odata.etag"] || item.eTag || "",
    });
    return toTicket(item);
  }

  async function readItem(number) {
    await resolve();
    if (!lists.tickets || !(number > 0)) return null;
    try {
      return await graph.get(items("tickets") + "/" + number + "?$expand=fields");
    } catch (e) {
      if (e instanceof GraphError && (e.status === 404 || e.status === 403)) return null;
      throw e;
    }
  }

  const backend = {
    assignsNumbers: true,
    names,

    async me() {
      if (!meCache) {
        const me = await graph.get("/me?$select=displayName,mail,userPrincipalName");
        meCache = { email: str(me.mail || me.userPrincipalName).toLowerCase(), name: str(me.displayName) };
      }
      return meCache;
    },

    /** The site and lists, for the setup screen: { site, lists, missing: [keys] }. */
    async status(force) {
      await resolve(force);
      return { site, lists, missing: Object.keys(names).filter((k) => !lists[k]) };
    },

    async loadSettings() {
      await resolve();
      if (!lists.tickets || !lists.settings) return null;
      const rows = await graph.all(items("settings") + "?$expand=fields&$top=50", null, 2);
      const row = rows.find((r) => r.fields && String(r.fields.Title).toLowerCase() === "settings");
      if (!row || !row.fields.Value) return null;
      try {
        return JSON.parse(row.fields.Value);
      } catch (e) {
        throw new Error("The saved settings could not be read. An administrator can fix the item named settings in the list " + names.settings + ".");
      }
    },

    async saveSettings(settings) {
      await resolve();
      if (!lists.settings) throw new Error("The list " + names.settings + " does not exist yet.");
      const value = JSON.stringify(settings);
      if (value.length > MAX_FIELD) throw new Error("The settings are too large to save. Shorten the email wording or the lists.");
      const rows = await graph.all(items("settings") + "?$expand=fields&$top=50", null, 2);
      const row = rows.find((r) => r.fields && String(r.fields.Title).toLowerCase() === "settings");
      if (row) await graph.patch(items("settings") + "/" + row.id + "/fields", { Value: value });
      else await graph.post(items("settings"), { fields: { Title: "settings", Value: value } });
    },

    canSetup: async () => true,

    /** Saves the first settings. The lists themselves are created by provision() below. */
    async setup(settings) {
      const s = await backend.status(true);
      if (s.missing.length) throw new Error("These lists are missing on the site: " + s.missing.map((k) => names[k]).join(", ") + ". Create them first.");
      await backend.saveSettings(settings);
    },

    async allTickets() {
      await resolve();
      if (!lists.tickets) return [];
      if (ticketCache && Date.now() - ticketCache.at < 20000) return ticketCache.items.slice();
      const rows = await graph.all(items("tickets") + "?$expand=fields($select=" + LIST_FIELDS + ")&$top=200", null, MAX_PAGES);
      const out = rows.map(toTicket);
      ticketCache = { at: Date.now(), items: out };
      return out.slice();
    },

    async getTicket(id) {
      const item = await readItem(ticketNumber(id));
      return item ? remember(item) : null;
    },

    nextNumber: async () => 0,

    async createTicket(ticket, activity) {
      await resolve();
      const fields = toFields(ticket);
      fields.Conversation = "[]";
      fields.History = JSON.stringify(activity || []);
      const item = await graph.post(items("tickets"), { fields });
      ticketCache = null;
      const saved = Object.assign({}, ticket, { number: Number(item.id), id: "" });
      threads.set(saved.number, { messages: [], activity: (activity || []).slice(), etag: item["@odata.etag"] || item.eTag || "" });
      return saved;
    },

    async saveTicket(ticket, extras) {
      const x = extras || {};
      const item = await readItem(ticket.number);
      if (!item) throw new Error("That ticket was not found.");
      const conflict = () => {
        const err = new Error("conflict");
        err.code = "conflict";
        return err;
      };
      const before = remember(item);
      if (x.expectedUpdatedAt && before.updatedAt && before.updatedAt !== x.expectedUpdatedAt) throw conflict();
      const thread = threads.get(ticket.number);
      const messages = thread.messages.concat((x.messages || []).map((m) => ({ at: m.at, by: m.by, byName: m.byName, role: m.role, text: m.text })));
      let history = thread.activity.concat(x.activity || []);
      const conversation = JSON.stringify(messages.map((m) => ({ at: m.at, by: m.by, byName: m.byName, role: m.role, text: m.text })));
      if (conversation.length > MAX_FIELD) throw new Error("This conversation has reached the size SharePoint allows. Please send a new request and mention this one.");
      while (JSON.stringify(history).length > MAX_FIELD && history.length > 1) history = history.slice(1);
      const fields = toFields(ticket);
      fields.Conversation = conversation;
      fields.History = JSON.stringify(history);
      try {
        await graph.patch(items("tickets") + "/" + ticket.number + "/fields", fields, thread.etag ? { headers: { "If-Match": thread.etag } } : undefined);
      } catch (e) {
        if (e instanceof GraphError && e.status === 412) throw conflict();
        throw e;
      }
      ticketCache = null;
      threads.delete(ticket.number);
    },

    async addNotes(ticket, notes) {
      await resolve();
      // SharePoint hides a list from people who have no access to it, so "missing" here
      // usually means this person is on the team list but is not an Owner of the site.
      if (!lists.notes) throw new Error("Your account cannot open the list " + names.notes + ". Ask an administrator to make you an Owner of the help desk site.");
      for (const n of notes) {
        await graph.post(items("notes"), { fields: { Title: n.text.replace(/\s+/g, " ").slice(0, 120), TicketNumber: ticket.number, Body: n.text, NoteAt: n.at, AuthorEmail: n.by, AuthorName: n.byName } });
      }
    },

    async thread(ticket, isTeam) {
      let t = threads.get(ticket.number);
      if (!t) {
        const item = await readItem(ticket.number);
        if (item) remember(item);
        t = threads.get(ticket.number) || { messages: [], activity: [] };
      }
      let notes = [];
      if (isTeam && lists.notes) {
        try {
          const rows = await graph.all(items("notes") + "?$expand=fields&$filter=fields/TicketNumber eq " + Number(ticket.number) + "&$top=200", { headers: NON_INDEXED }, 5);
          notes = rows.map((r) => {
            const f = r.fields || {};
            return { at: str(f.NoteAt) || str(r.createdDateTime), by: str(f.AuthorEmail), byName: str(f.AuthorName), role: "team", visibility: "internal", text: str(f.Body) };
          });
        } catch (e) {
          // No access to the notes list means this person is not on the team in SharePoint's eyes.
          if (!(e instanceof GraphError) || (e.status !== 403 && e.status !== 404)) throw e;
        }
      }
      const messages = t.messages.concat(notes).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return { messages, activity: t.activity.slice() };
    },

    /** Renames statuses, priorities, categories, and locations on the stored tickets. */
    async renameTickets(plan) {
      ticketCache = null;
      let count = 0;
      for (const t of await backend.allTickets()) {
        const next = renameOnTicket(t, plan);
        if (!next) continue;
        await graph.patch(items("tickets") + "/" + t.number + "/fields", { Status: next.status, Priority: next.priority, Category: next.category, Location: next.location });
        count++;
      }
      ticketCache = null;
      threads.clear();
      return count;
    },

    /** Stateless round robin: SharePoint keeps no counter that requesters could write to. */
    rrIndex: async () => Math.floor(Date.now() / 1000),

    async sendMail(mail) {
      if (o.sendMail === false) return;
      const message = {
        subject: mail.subject,
        body: { contentType: "HTML", content: mail.html },
        toRecipients: mail.to.map((address) => ({ emailAddress: { address } })),
      };
      if (mail.replyTo) message.replyTo = [{ emailAddress: { address: mail.replyTo } }];
      await graph.post("/me/sendMail", { message, saveToSentItems: false }, { scopes: o.mailScopes });
    },

    localParts: (date, timeZone) => browserLocalParts(date, timeZone),
    formatDate: (iso, timeZone) => browserFormatDate(iso, timeZone),

    async adminInfo() {
      await resolve();
      return { storage: "Tickets are items in the list " + names.tickets + " on the SharePoint site " + (site.displayName || site.webUrl) + ". Lists show at most " + MAX_PAGES * 200 + " tickets.", siteUrl: site.webUrl };
    },
  };
  return backend;
}

/**
 * Creates whatever lists are missing and, when asked, gives the add-in's app registration
 * access to this one site (the Sites.Selected permission). `elevated` is a Graph client whose
 * token carries the administrator's own higher permission, used only for this setup.
 * options: { siteUrl, names, grant: { clientId, appName } or null }
 * Returns { site, created: [list names], granted }.
 */
export async function provision(elevated, options) {
  const names = Object.assign({}, LIST_NAMES, options.names || {});
  const site = await elevated.get(sitePath(options.siteUrl) + "?$select=id,webUrl,displayName");
  let granted = false;
  if (options.grant && options.grant.clientId) {
    // Pressing the button twice must not stack up grants, so look for an existing one first.
    const existing = await elevated.all("/sites/" + site.id + "/permissions");
    const has = existing.some((p) => (p.grantedToIdentitiesV2 || p.grantedToIdentities || []).some((g) => g.application && String(g.application.id).toLowerCase() === String(options.grant.clientId).toLowerCase()));
    if (!has) await elevated.post("/sites/" + site.id + "/permissions", {
      roles: ["write"],
      grantedToIdentities: [{ application: { id: options.grant.clientId, displayName: options.grant.appName || "Help desk add-in" } }],
    });
    granted = true;
  }
  const found = await elevated.all("/sites/" + site.id + "/lists?$select=id,displayName&$top=200");
  const created = [];
  for (const key of Object.keys(names)) {
    if (found.some((l) => String(l.displayName).toLowerCase() === names[key].toLowerCase())) continue;
    await elevated.post("/sites/" + site.id + "/lists", { displayName: names[key], list: { template: "genericList" }, columns: LIST_COLUMNS[key] });
    created.push(names[key]);
  }
  return { site, created, granted };
}
