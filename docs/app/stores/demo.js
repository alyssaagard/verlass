/**
 * The demo backend: a complete help desk that lives only in this browser tab.
 *
 * It holds sample tickets for an invented organization, lets the visitor act as a staff
 * member, a team member, or the administrator, and keeps every email it "sends" in an outbox
 * so the visitor can read it. Nothing leaves the browser, and nothing needs a sign-in.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { defaultSettings, normalizeSettings, statusKind, findPriority, renameOnTicket } from "../core/settings.js";
import { ticketId, computeDue } from "../core/tickets.js";
import { browserLocalParts, browserFormatDate, browserTimeZone } from "./service.js";

const KEY = "helpdesk.demo.v1";

export const PERSONAS = [
  { id: "staff", label: "Morgan, a staff member", email: "morgan.chen@example.com", name: "Morgan Chen" },
  { id: "agent", label: "Sam, on the help desk team", email: "sam.patel@example.com", name: "Sam Patel" },
  { id: "admin", label: "Alex, the administrator", email: "alex.rivera@example.com", name: "Alex Rivera" },
];

const PEOPLE = {
  morgan: { email: "morgan.chen@example.com", name: "Morgan Chen" },
  taylor: { email: "taylor.brooks@example.com", name: "Taylor Brooks" },
  casey: { email: "casey.nguyen@example.com", name: "Casey Nguyen" },
  riley: { email: "riley.adams@example.com", name: "Riley Adams" },
  sam: { email: "sam.patel@example.com", name: "Sam Patel" },
  jordan: { email: "jordan.lee@example.com", name: "Jordan Lee" },
  alex: { email: "alex.rivera@example.com", name: "Alex Rivera" },
};

/** hoursAgo: when it was created. Each message: [hoursAgo, person, text, internal?]. */
const SAMPLE = [
  { h: 2, from: "morgan", subject: "Laptop will not connect to the office Wi-Fi", body: "Since this morning my laptop sees the network but never finishes connecting. My phone connects without trouble.", cat: "Network or Wi-Fi", pri: "High", loc: "Main office", status: "Open", to: "" },
  { h: 5, from: "taylor", subject: "Shared printer prints blank pages", body: "The printer by the kitchen feeds paper but the pages come out blank. Three of us have tried.", cat: "Printer or scanner", pri: "Normal", loc: "Main office", status: "In progress", to: "sam", msgs: [[4, "sam", "Thanks, Taylor. I am ordering a toner cartridge now and will swap it this afternoon."], [4, "sam", "Toner was low last week too. Check whether the drum needs replacing.", true]] },
  { h: 26, from: "casey", subject: "Need access to the finance shared drive", body: "I moved to the finance team on Monday and cannot open the shared drive yet.", cat: "Account or password", pri: "Normal", loc: "Remote", status: "Waiting on requester", to: "jordan", msgs: [[24, "jordan", "Happy to set that up. Could you ask your manager to reply here with approval?"]] },
  { h: 30, from: "riley", subject: "Conference room display flickers", body: "The display in the large meeting room flickers when a laptop is plugged in with the HDMI cable.", cat: "Meeting room equipment", pri: "Low", loc: "Main office", status: "Open", to: "sam" },
  { h: 50, from: "morgan", subject: "Email signature shows the old address", body: "My signature still shows our previous office address. Is there a company template I should use?", cat: "Email and calendar", pri: "Low", loc: "Main office", status: "Resolved", to: "jordan", closed: 44, msgs: [[46, "jordan", "The new template is attached to this month's staff notice. I have also updated yours for you."], [44, "morgan", "That worked. Thank you."]] },
  { h: 52, from: "taylor", subject: "New starter needs a laptop on the first of the month", body: "We have a new colleague joining the sales team. They will need a laptop, a headset, and an account.", cat: "New equipment", pri: "Normal", loc: "Main office", status: "In progress", to: "alex", msgs: [[50, "alex", "Laptop is ordered. I will confirm the delivery date here."]] },
  { h: 74, from: "casey", subject: "Phone app keeps signing me out", body: "The company phone app signs me out a few times a day and I miss calls.", cat: "Phone or mobile device", pri: "High", loc: "Remote", status: "In progress", to: "sam", msgs: [[70, "sam", "Could you tell me which phone you use and the app version shown under Settings, About?"], [69, "casey", "It is version 4.2 on an older Android phone."]] },
  { h: 98, from: "riley", subject: "Spreadsheet software asks for a license key", body: "After the update last night, the spreadsheet program opens with a message asking for a license key.", cat: "Software and apps", pri: "Urgent", loc: "Main office", status: "Resolved", to: "jordan", closed: 96, msgs: [[97, "jordan", "The update removed the license file. I have put it back; please restart the program."]] },
  { h: 120, from: "morgan", subject: "Forgot my password for the time sheet system", body: "I am locked out of the time sheet system after too many attempts.", cat: "Account or password", pri: "Normal", loc: "Remote", status: "Closed", to: "sam", closed: 118, msgs: [[119, "sam", "I have sent a reset link to your email. It works for one hour."]] },
  { h: 150, from: "taylor", subject: "Scanner saves files to the wrong folder", body: "Scans from the front desk scanner end up in a folder nobody can find.", cat: "Printer or scanner", pri: "Low", loc: "Main office", status: "Open", to: "" },
  { h: 170, from: "casey", subject: "Calendar invitations arrive an hour off", body: "Invitations from our partner organization show up one hour later than the real time.", cat: "Email and calendar", pri: "Normal", loc: "Remote", status: "Resolved", to: "alex", closed: 160, msgs: [[165, "alex", "Your calendar was set to a different time zone. I have corrected it; new invitations will be right."]] },
  { h: 200, from: "riley", subject: "Request for a second monitor", body: "A second monitor would help with the reporting work I have taken on.", cat: "New equipment", pri: "Low", loc: "Main office", status: "Closed", to: "alex", closed: 150, msgs: [[190, "alex", "Approved. It will arrive at your desk on Thursday."]] },
];

function build(now) {
  let settings = defaultSettings("office");
  settings.general.orgName = "Example Organization";
  settings.general.supportEmail = "helpdesk@example.com";
  settings.general.website = "https://www.example.com";
  settings.team = [
    { email: PEOPLE.alex.email, name: PEOPLE.alex.name, role: "admin", active: true },
    { email: PEOPLE.sam.email, name: PEOPLE.sam.name, role: "agent", active: true },
    { email: PEOPLE.jordan.email, name: PEOPLE.jordan.name, role: "agent", active: true },
  ];
  settings.rules = [{ category: "Printer or scanner", priority: "", location: "", keyword: "", assignTo: PEOPLE.sam.email }];
  settings.general.timeZone = browserTimeZone();
  settings = normalizeSettings(settings);

  const ago = (h) => new Date(now - h * 3600000).toISOString();
  const tickets = [];
  const threads = {};
  SAMPLE.slice()
    .reverse()
    .forEach((s, i) => {
      const number = i + 1;
      const id = ticketId(number, settings);
      const createdAt = ago(s.h);
      const msgs = (s.msgs || []).map((m) => {
        const person = PEOPLE[m[1]];
        const isTeam = settings.team.some((t) => t.email === person.email);
        return { at: ago(m[0]), by: person.email, byName: person.name, role: isTeam ? "team" : "requester", visibility: m[3] ? "internal" : "public", text: m[2] };
      });
      const last = msgs.length ? msgs[msgs.length - 1].at : createdAt;
      const done = statusKind(settings, s.status) === "done";
      const priority = findPriority(settings, s.pri);
      tickets.push({
        id, number, createdAt,
        updatedAt: done && s.closed !== undefined ? ago(s.closed) : last,
        requesterEmail: PEOPLE[s.from].email, requesterName: PEOPLE[s.from].name,
        subject: s.subject, description: s.body, category: s.cat, priority: s.pri, location: s.loc, status: s.status,
        assignedTo: s.to ? PEOPLE[s.to].email : "",
        dueAt: computeDue(createdAt, priority.dueHours, settings, (d) => browserLocalParts(d, "")),
        closedAt: done ? ago(s.closed !== undefined ? s.closed : s.h - 1) : "",
        source: "web",
      });
      const activity = [{ at: createdAt, by: PEOPLE[s.from].email, text: "Created." }];
      if (s.to) activity.push({ at: createdAt, by: PEOPLE[s.from].email, text: "Assigned to " + PEOPLE[s.to].email + "." });
      threads[id] = { messages: msgs, activity };
    });
  return { settings, tickets, threads, mail: [], rr: 0, persona: "staff" };
}

export function makeDemoBackend(options) {
  const o = options || {};
  const storage = o.storage || null; // sessionStorage in the browser; none in tests
  let state = null;

  function load() {
    if (state) return state;
    if (storage) {
      try {
        const saved = JSON.parse(storage.getItem(KEY) || "null");
        if (saved && saved.settings && Array.isArray(saved.tickets)) state = saved;
      } catch (e) {
        state = null;
      }
    }
    if (!state) state = build(o.now || Date.now());
    return state;
  }

  function save() {
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // Storage is full or blocked. The demo still works for this page view.
    }
  }

  const persona = () => PERSONAS.find((p) => p.id === load().persona) || PERSONAS[0];
  const copy = (x) => JSON.parse(JSON.stringify(x));

  return {
    isDemo: true,
    personas: PERSONAS,
    persona: () => persona().id,
    setPersona(id) {
      load().persona = PERSONAS.some((p) => p.id === id) ? id : "staff";
      save();
    },
    reset() {
      state = build(o.now || Date.now());
      save();
    },
    outbox: () => copy(load().mail),

    me: () => ({ email: persona().email, name: persona().name }),
    loadSettings: () => copy(load().settings),
    saveSettings(settings) {
      load().settings = copy(settings);
      save();
    },
    canSetup: () => false,
    setup() {},
    allTickets: () => copy(load().tickets),
    getTicket: (id) => {
      const t = load().tickets.find((x) => x.id.toLowerCase() === String(id || "").toLowerCase());
      return t ? copy(t) : null;
    },
    nextNumber: () => load().tickets.reduce((max, t) => Math.max(max, t.number), 0) + 1,
    createTicket(ticket, activity) {
      const s = load();
      s.tickets.push(copy(ticket));
      s.threads[ticket.id] = { messages: [], activity: copy(activity || []) };
      save();
      return copy(ticket);
    },
    saveTicket(ticket, extras) {
      const s = load();
      const i = s.tickets.findIndex((x) => x.id === ticket.id);
      if (i === -1) throw new Error("Ticket " + ticket.id + " was not found.");
      if (extras && extras.expectedUpdatedAt && s.tickets[i].updatedAt !== extras.expectedUpdatedAt) {
        const err = new Error("conflict");
        err.code = "conflict";
        throw err;
      }
      s.tickets[i] = copy(ticket);
      const thread = s.threads[ticket.id] || (s.threads[ticket.id] = { messages: [], activity: [] });
      thread.messages.push(...copy((extras && extras.messages) || []));
      thread.activity.push(...copy((extras && extras.activity) || []));
      save();
    },
    addNotes(ticket, notes) {
      const s = load();
      const thread = s.threads[ticket.id] || (s.threads[ticket.id] = { messages: [], activity: [] });
      thread.messages.push(...copy(notes));
      save();
    },
    thread(ticket) {
      const t = load().threads[ticket.id] || { messages: [], activity: [] };
      const messages = copy(t.messages).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return { messages, activity: copy(t.activity) };
    },
    renameTickets(plan) {
      const s = load();
      let count = 0;
      s.tickets = s.tickets.map((t) => {
        const next = renameOnTicket(t, plan);
        if (!next) return t;
        count++;
        return Object.assign(next, { updatedAt: new Date().toISOString() });
      });
      save();
      return count;
    },
    rrIndex: () => load().rr || 0,
    setRrIndex(i) {
      load().rr = i;
      save();
    },
    sendMail(mail) {
      const s = load();
      s.mail.unshift({ at: new Date().toISOString(), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, from: mail.senderName });
      s.mail = s.mail.slice(0, 30);
      save();
    },
    localParts: (date, timeZone) => browserLocalParts(date, timeZone),
    formatDate: (iso, timeZone) => browserFormatDate(iso, timeZone),
    adminInfo: () => ({ storage: "This demo keeps its data in this browser tab only." }),
  };
}
