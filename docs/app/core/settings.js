/**
 * The help desk's settings: defaults, starting presets, and the code that turns whatever is
 * stored (a spreadsheet, a SharePoint list, or the demo) into a complete, valid settings object.
 *
 * Nothing here assumes one kind of organization. Categories, priorities, statuses, locations,
 * the team, assignment rules, working hours, email wording, and branding are all data.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { clean, cleanLine, normalizeEmail, sameLabel, hexColor, safeUrl } from "./text.js";

export const SETTINGS_VERSION = 1;

/** The kinds a status can have. Queues and counts use the kind, never the status name. */
export const STATUS_KINDS = ["open", "waiting", "done"];

/**
 * Every single-value setting, in the order the settings screens and the Settings tab show them.
 * type: text, email, url, color, number, bool, choice, or time.
 */
export const GENERAL_FIELDS = [
  { key: "orgName", label: "Organization name", group: "Branding", type: "text", max: 80, value: "", help: "Shown in the header and in email." },
  { key: "deskName", label: "Help desk name", group: "Branding", type: "text", max: 60, value: "IT Help Desk", help: "For example IT Help Desk, Service Desk, or Facilities." },
  { key: "accentColor", label: "Accent color", group: "Branding", type: "color", value: "#2F4F40", help: "Buttons in Gmail and the header of every email. Use a hex color such as #2F4F40." },
  { key: "logoUrl", label: "Logo address", group: "Branding", type: "url", value: "", help: "A public https address of a square logo image. Leave empty for none." },
  { key: "website", label: "Website", group: "Branding", type: "url", value: "", help: "Added to the email footer." },
  { key: "supportEmail", label: "Reply-to address", group: "Branding", type: "email", value: "", help: "Replies to help desk email go to this address." },
  { key: "emailFooter", label: "Email footer", group: "Branding", type: "text", max: 300, value: "", help: "One line added under every email." },

  { key: "ticketPrefix", label: "Ticket number prefix", group: "Tickets", type: "text", max: 8, value: "TKT-", help: "For example TKT-, IT-, or REQ-." },
  { key: "ticketDigits", label: "Ticket number digits", group: "Tickets", type: "number", min: 1, max: 9, value: 4, help: "TKT-0042 has four digits. Numbers keep growing past this width." },
  { key: "ticketWord", label: "Word for a ticket", group: "Tickets", type: "text", max: 20, value: "request", help: "The word people see: request, ticket, case, or issue." },
  { key: "defaultPriority", label: "Default priority", group: "Tickets", type: "text", max: 40, value: "Normal", help: "Must match a name on the priorities list." },
  { key: "requesterSetsPriority", label: "Requesters choose the priority", group: "Tickets", type: "bool", value: true, help: "When off, new tickets get the category's priority or the default." },
  { key: "locationMode", label: "Location field", group: "Tickets", type: "choice", options: ["list", "text", "off"], value: "list", help: "list: choose from the locations list. text: type anything. off: no location." },
  { key: "locationLabel", label: "Location label", group: "Tickets", type: "text", max: 40, value: "Location", help: "For example Location, Room, Office, Site, or Department." },
  { key: "locationRequired", label: "Location is required", group: "Tickets", type: "bool", value: false, help: "" },
  { key: "requesterCanClose", label: "Requesters can close their tickets", group: "Tickets", type: "bool", value: true, help: "" },
  { key: "requesterCanReopen", label: "Requesters can reopen their tickets", group: "Tickets", type: "bool", value: true, help: "A reply to a closed ticket reopens it." },
  { key: "pageSize", label: "Tickets per page", group: "Tickets", type: "number", min: 5, max: 50, value: 15, help: "" },

  { key: "assignFallback", label: "When no rule matches", group: "Assignment", type: "choice", options: ["none", "roundRobin"], value: "none", help: "none: leave the ticket unassigned. roundRobin: take turns among the active team." },

  { key: "hoursMode", label: "Due times count", group: "Hours", type: "choice", options: ["business", "calendar"], value: "business", help: "business: only working hours count. calendar: every hour counts." },
  { key: "workDays", label: "Working days", group: "Hours", type: "text", max: 20, value: "1,2,3,4,5", help: "Day numbers separated by commas. Sunday is 0, Monday is 1, Saturday is 6." },
  { key: "workStart", label: "Working day starts", group: "Hours", type: "time", value: "08:00", help: "24-hour time, such as 08:00." },
  { key: "workEnd", label: "Working day ends", group: "Hours", type: "time", value: "17:00", help: "24-hour time, such as 17:00." },
  { key: "holidays", label: "Days off", group: "Hours", type: "text", max: 2000, value: "", help: "Dates as YYYY-MM-DD separated by commas." },
  { key: "timeZone", label: "Time zone", group: "Hours", type: "text", max: 60, value: "", help: "For example America/New_York or Europe/Berlin. Set it so that due times are counted the same way for everyone." },

  { key: "notifyRequesterOnCreate", label: "Email the requester when a ticket is created", group: "Email", type: "bool", value: true, help: "" },
  { key: "notifyTeamOnCreate", label: "Email the team about new tickets", group: "Email", type: "choice", options: ["assignee", "all", "none"], value: "assignee", help: "assignee: the person the ticket is assigned to, or everyone when it is unassigned. all: everyone on the team. none: no email." },
  { key: "notifyAssigneeOnAssign", label: "Email a person when a ticket is assigned to them", group: "Email", type: "bool", value: true, help: "" },
  { key: "notifyRequesterOnStatus", label: "Email the requester when the status changes", group: "Email", type: "bool", value: true, help: "Each status can also turn this off for itself." },
  { key: "notifyRequesterOnReply", label: "Email the requester when the team replies", group: "Email", type: "bool", value: true, help: "" },
  { key: "notifyTeamOnRequesterReply", label: "Email the team when the requester replies", group: "Email", type: "bool", value: true, help: "A requester who closes or reopens a ticket without a message also sends this email." },
];

/** The email templates. Subjects and bodies are plain text with {{placeholders}}. */
export const TEMPLATE_KEYS = ["created", "teamNew", "assigned", "status", "resolved", "reply", "requesterReply"];

export const TEMPLATE_INFO = {
  created: "To the requester when a ticket is created",
  teamNew: "To the team when a ticket is created",
  assigned: "To a team member when a ticket is assigned to them",
  status: "To the requester when the status changes",
  resolved: "To the requester when the ticket is resolved or closed",
  reply: "To the requester when the team replies",
  requesterReply: "To the team when the requester replies, closes, or reopens a ticket",
};

/** Placeholders a template may use. */
export const PLACEHOLDERS = [
  "ticket.id", "ticket.subject", "ticket.description", "ticket.category", "ticket.priority", "ticket.location",
  "ticket.status", "ticket.assignedTo", "ticket.due", "ticket.created", "requester.name", "requester.email",
  "actor.name", "actor.email", "message", "old.status", "org.name", "desk.name", "ticket.word",
];

export const DEFAULT_TEMPLATES = {
  created: {
    subject: "[{{ticket.id}}] We received your {{ticket.word}}: {{ticket.subject}}",
    body: "Hello {{requester.name}},\n\nWe received your {{ticket.word}} and gave it the number {{ticket.id}}. We will email you when there is an update.\n\nThank you,\n{{desk.name}}",
  },
  teamNew: {
    subject: "[{{ticket.id}}] New {{ticket.priority}} {{ticket.word}}: {{ticket.subject}}",
    body: "{{requester.name}} ({{requester.email}}) sent a new {{ticket.word}}.\n\n{{ticket.description}}",
  },
  assigned: {
    subject: "[{{ticket.id}}] Assigned to you: {{ticket.subject}}",
    body: "{{actor.name}} assigned this {{ticket.word}} to you.\n\n{{ticket.description}}",
  },
  status: {
    subject: "[{{ticket.id}}] Now {{ticket.status}}: {{ticket.subject}}",
    body: "Hello {{requester.name}},\n\nYour {{ticket.word}} {{ticket.id}} changed from {{old.status}} to {{ticket.status}}.\n\n{{message}}\n\n{{desk.name}}",
  },
  resolved: {
    subject: "[{{ticket.id}}] {{ticket.status}}: {{ticket.subject}}",
    body: "Hello {{requester.name}},\n\nYour {{ticket.word}} {{ticket.id}} is now {{ticket.status}}.\n\n{{message}}\n\nIf you still need help with this, reply in the help desk and we will pick it up again.\n\n{{desk.name}}",
  },
  reply: {
    subject: "[{{ticket.id}}] New reply: {{ticket.subject}}",
    body: "Hello {{requester.name}},\n\n{{actor.name}} replied to your {{ticket.word}} {{ticket.id}}:\n\n{{message}}\n\n{{desk.name}}",
  },
  requesterReply: {
    subject: "[{{ticket.id}}] {{requester.name}} wrote: {{ticket.subject}}",
    body: "{{requester.name}} ({{requester.email}}) wrote about {{ticket.id}}:\n\n{{message}}",
  },
};

/**
 * Starting points for different kinds of organizations. A preset only fills the lists; every
 * item can be renamed, removed, or added to afterward.
 */
export const PRESETS = [
  {
    id: "office",
    name: "Office or business",
    deskName: "IT Help Desk",
    locationLabel: "Location",
    categories: ["Computer or laptop", "Phone or mobile device", "Printer or scanner", "Network or Wi-Fi", "Email and calendar", "Software and apps", "Account or password", "Meeting room equipment", "New equipment", "Something else"],
    locations: ["Main office", "Remote"],
  },
  {
    id: "school",
    name: "School or college",
    deskName: "IT Help Desk",
    locationLabel: "Room",
    categories: ["Computer or laptop", "Student device", "Projector or display", "Printer or copier", "Network or Wi-Fi", "Email and classroom apps", "Software and apps", "Account or password", "Phone system", "New equipment", "Something else"],
    locations: ["Main office", "Library", "Classroom"],
  },
  {
    id: "nonprofit",
    name: "Nonprofit or community group",
    deskName: "Help Desk",
    locationLabel: "Site",
    categories: ["Computer or laptop", "Phone", "Printer", "Internet or Wi-Fi", "Email", "Database or donor system", "Account or password", "Website", "Something else"],
    locations: ["Office", "Remote"],
  },
  {
    id: "facilities",
    name: "Facilities and maintenance",
    deskName: "Facilities Desk",
    locationLabel: "Area",
    categories: ["Heating and cooling", "Lighting and electrical", "Plumbing", "Doors, locks, and keys", "Furniture", "Cleaning", "Grounds", "Safety concern", "Something else"],
    locations: ["Main building"],
  },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

const DEFAULT_PRIORITIES = [
  { name: "Low", hint: "When you get a chance", dueHours: 40 },
  { name: "Normal", hint: "It slows my work", dueHours: 24 },
  { name: "High", hint: "I cannot do my work", dueHours: 8 },
  { name: "Urgent", hint: "Several people are stopped", dueHours: 2 },
];

const DEFAULT_STATUSES = [
  { name: "Open", kind: "open", notify: false },
  { name: "In progress", kind: "open", notify: true },
  { name: "Waiting on requester", kind: "waiting", notify: true },
  { name: "Resolved", kind: "done", notify: true },
  { name: "Closed", kind: "done", notify: false },
];

/** Complete settings for a new help desk, from a preset. */
export function defaultSettings(presetId) {
  const preset = presetById(presetId);
  const general = {};
  for (const f of GENERAL_FIELDS) general[f.key] = f.value;
  general.deskName = preset.deskName;
  general.locationLabel = preset.locationLabel;
  return {
    version: SETTINGS_VERSION,
    general,
    categories: preset.categories.map((name) => ({ name, assignTo: "", priority: "", active: true })),
    priorities: DEFAULT_PRIORITIES.map((p) => ({ ...p })),
    statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
    locations: preset.locations.slice(),
    team: [],
    rules: [],
    templates: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)),
  };
}

function toBool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(s)) return true;
  if (["false", "no", "n", "0", "off"].includes(s)) return false;
  return fallback;
}

function toNumber(value, fallback, min, max) {
  const n = typeof value === "number" ? value : parseFloat(String(value === null || value === undefined ? "" : value).replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** "08:00", "8:00", "5 pm", or "5:30 PM" as "HH:MM". */
function toTime(value, fallback) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(String(value || "").trim());
  if (!m || (m[2] === undefined && !m[3])) return fallback;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) {
    if (h < 1 || h > 12) return fallback;
    h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  }
  m[2] = String(min).padStart(2, "0");
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return fallback;
  return String(h).padStart(2, "0") + ":" + m[2];
}

/** Minutes after midnight for "HH:MM". */
export function timeToMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * Working days as day numbers: Sunday 0, Monday 1, through Saturday 6. Accepts commas or spaces
 * between days and ranges such as 1-5. A range may wrap past Saturday (5-1 is Friday to Monday),
 * and 7 means Sunday, as in the ISO numbering where Monday is 1. Returns { days, clean }; clean is
 * false when any part could not be read, so the administrator can be told.
 */
export function parseWorkDays(text) {
  const days = [];
  let clean = true;
  const parts = String(text === null || text === undefined ? "" : text).replace(/[\u2010-\u2015\u2212]/g, "-").split(/[\s,;]+/).filter(Boolean);
  const day = (s) => (/^[0-7]$/.test(s) ? Number(s) % 7 : -1);
  for (const part of parts) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) {
      const from = day(m[1]);
      const to = day(m[2]);
      if (from < 0 || to < 0) {
        clean = false;
        continue;
      }
      for (let d = from, n = 0; n < 7; d = (d + 1) % 7, n++) {
        days.push(d);
        if (d === to) break;
      }
    } else if (day(part) >= 0) days.push(day(part));
    else clean = false;
  }
  return { days: Array.from(new Set(days)).sort(), clean: clean && days.length > 0 };
}

/** "www.example.org" becomes "https://www.example.org"; anything with a scheme is left alone. */
function withScheme(value) {
  const s = String(value === null || value === undefined ? "" : value).trim();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s) ? "https://" + s : s;
}

/**
 * One line of text for a list item. A vertical bar is the column separator when lists are
 * edited as text, so it is replaced with a slash.
 */
function label(value, max) {
  return cleanLine(String(value === null || value === undefined ? "" : value).replace(/\s*\|\s*/g, " / "), max);
}

/** The first of the candidate names that no item uses yet, numbering the last one if needed. */
function freeName(items, candidates) {
  const used = (name) => items.some((item) => sameLabel(item.name, name));
  for (const c of candidates) if (!used(c)) return c;
  const base = candidates[candidates.length - 1];
  for (let n = 2; ; n++) if (!used(base + " " + n)) return base + " " + n;
}

function normalizeGeneral(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const f of GENERAL_FIELDS) {
    const v = src[f.key];
    if (f.type === "bool") out[f.key] = toBool(v, f.value);
    else if (f.type === "number") out[f.key] = Math.round(toNumber(v, f.value, f.min, f.max));
    else if (f.type === "choice") out[f.key] = f.options.includes(String(v || "").trim()) ? String(v).trim() : f.value;
    else if (f.type === "color") out[f.key] = hexColor(v, f.value);
    else if (f.type === "url") out[f.key] = safeUrl(withScheme(v));
    else if (f.type === "email") out[f.key] = normalizeEmail(v);
    else if (f.type === "time") out[f.key] = toTime(v, f.value);
    else out[f.key] = v === null || v === undefined ? f.value : cleanLine(v, f.max);
  }
  if (!out.deskName) out.deskName = "Help Desk";
  if (!out.ticketWord) out.ticketWord = "request";
  out.ticketPrefix = out.ticketPrefix.replace(/[^A-Za-z0-9#_.-]/g, "");
  // A prefix that ends in a digit would run into the ticket number, so it gets a hyphen.
  if (/\d$/.test(out.ticketPrefix)) out.ticketPrefix = out.ticketPrefix.slice(0, 7) + "-";
  const parsed = parseWorkDays(out.workDays);
  out.workDays = (parsed.days.length ? parsed.days : [1, 2, 3, 4, 5]).join(",");
  if (timeToMinutes(out.workEnd) <= timeToMinutes(out.workStart)) {
    out.workStart = "08:00";
    out.workEnd = "17:00";
  }
  out.holidays = String(out.holidays).split(/[^0-9-]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).join(",");
  return out;
}

function uniqueByLabel(items, labelOf) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(labelOf(item)).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const asList = (value) => (Array.isArray(value) ? value : []);

/**
 * Returns complete, valid settings from anything that was stored. Unknown keys are dropped,
 * missing ones get their defaults, and lists always have what the help desk needs to work
 * (at least one category, one priority, one open status, and one finished status).
 */
export function normalizeSettings(raw) {
  // Nothing stored at all means a new help desk: start from the default preset.
  const src = raw && typeof raw === "object" ? raw : defaultSettings();
  const base = defaultSettings();
  const general = normalizeGeneral(src.general);

  let priorities = uniqueByLabel(
    asList(src.priorities).map((p) => ({
      name: label(p && p.name, 40),
      hint: label(p && p.hint, 120),
      dueHours: Math.round(toNumber(p && p.dueHours, 0, 0, 8760) * 100) / 100,
    })),
    (p) => p.name
  );
  if (!priorities.length) priorities = base.priorities;
  if (!priorities.some((p) => sameLabel(p.name, general.defaultPriority))) {
    const normal = priorities.find((p) => sameLabel(p.name, "Normal"));
    general.defaultPriority = (normal || priorities[0]).name;
  } else {
    general.defaultPriority = priorities.find((p) => sameLabel(p.name, general.defaultPriority)).name;
  }

  let statuses = uniqueByLabel(
    asList(src.statuses).map((s) => ({
      name: label(s && s.name, 40),
      kind: STATUS_KINDS.includes(String((s && s.kind) || "").trim().toLowerCase()) ? String(s.kind).trim().toLowerCase() : "open",
      notify: toBool(s && s.notify, true),
    })),
    (s) => s.name
  );
  if (!statuses.some((s) => s.kind === "open")) statuses.unshift({ name: freeName(statuses, ["Open", "New", "Active"]), kind: "open", notify: false });
  if (!statuses.some((s) => s.kind === "done")) statuses.push({ name: freeName(statuses, ["Closed", "Done", "Finished"]), kind: "done", notify: true });

  let categories = uniqueByLabel(
    asList(src.categories).map((c) => {
      const item = typeof c === "string" ? { name: c } : c || {};
      const priority = priorities.find((p) => sameLabel(p.name, item.priority));
      return { name: label(item.name, 60), assignTo: normalizeEmail(item.assignTo), priority: priority ? priority.name : "", active: toBool(item.active, true) };
    }),
    (c) => c.name
  );
  if (!categories.some((c) => c.active)) categories = categories.concat([{ name: freeName(categories, ["General", "Other"]), assignTo: "", priority: "", active: true }]);

  const locations = uniqueByLabel(asList(src.locations).map((l) => label(typeof l === "string" ? l : l && l.name, 80)), (l) => l);

  const team = uniqueByLabel(
    asList(src.team).map((m) => {
      const email = normalizeEmail(m && m.email);
      return {
        email,
        name: label(m && m.name, 80),
        role: String((m && m.role) || "").trim().toLowerCase() === "admin" ? "admin" : "agent",
        active: toBool(m && m.active, true),
      };
    }),
    (m) => m.email
  );

  const rules = asList(src.rules)
    .map((r) => ({
      category: label(r && r.category, 60),
      priority: label(r && r.priority, 40),
      location: label(r && r.location, 80),
      keyword: label(r && r.keyword, 60),
      assignTo: normalizeEmail(r && r.assignTo),
    }))
    .filter((r) => r.assignTo);

  const templates = {};
  const srcTemplates = src.templates && typeof src.templates === "object" ? src.templates : {};
  for (const key of TEMPLATE_KEYS) {
    const t = srcTemplates[key] || {};
    templates[key] = {
      subject: cleanLine(t.subject, 200) || DEFAULT_TEMPLATES[key].subject,
      body: clean(t.body, 5000) || DEFAULT_TEMPLATES[key].body,
    };
  }

  return { version: SETTINGS_VERSION, general, categories, priorities, statuses, locations, team, rules, templates };
}

/** Problems an administrator should know about. They do not stop the help desk from working. */
export function settingsWarnings(settings) {
  const s = settings;
  const out = [];
  const agents = s.team.filter((m) => m.active);
  const isAgent = (email) => agents.some((m) => m.email === email);
  if (!s.team.some((m) => m.active && m.role === "admin")) out.push("No active administrator is on the team list.");
  for (const c of s.categories) if (c.assignTo && !isAgent(c.assignTo)) out.push(`Category "${c.name}" assigns to ${c.assignTo}, who is not an active team member.`);
  s.rules.forEach((r, i) => {
    if (!isAgent(r.assignTo)) out.push(`Rule ${i + 1} assigns to ${r.assignTo}, who is not an active team member.`);
    if (r.category && !s.categories.some((c) => sameLabel(c.name, r.category))) out.push(`Rule ${i + 1} names the category "${r.category}", which is not on the list.`);
    if (r.priority && !s.priorities.some((p) => sameLabel(p.name, r.priority))) out.push(`Rule ${i + 1} names the priority "${r.priority}", which is not on the list.`);
  });
  if (s.general.assignFallback === "roundRobin" && !agents.length) out.push("Round robin assignment is on, but the team list has no active members.");
  if (s.general.locationMode === "list" && !s.locations.length) out.push("The location field uses a list, but the locations list is empty.");
  if (s.general.timeZone && !/^(UTC|GMT|[A-Za-z_]+\/[A-Za-z0-9_+\-\/]+)$/.test(s.general.timeZone)) out.push(`The time zone "${s.general.timeZone}" does not look like a zone name such as America/New_York or Europe/Berlin.`);
  if (!s.general.timeZone) out.push("No time zone is set, so due times may not follow the zone you expect. Set the time zone under Hours.");
  for (const key of TEMPLATE_KEYS) {
    const text = s.templates[key].subject + " " + s.templates[key].body;
    const re = /\{\{\s*([^}]*?)\s*\}\}/g;
    let m;
    while ((m = re.exec(text))) if (!PLACEHOLDERS.includes(m[1])) out.push(`The "${key}" email uses {{${m[1]}}}, which is not a known placeholder.`);
  }
  return out;
}

// --- Lookups ---------------------------------------------------------------

export function findStatus(settings, name) {
  return settings.statuses.find((s) => sameLabel(s.name, name)) || null;
}

/** open, waiting, or done. A status that is no longer on the list counts as open. */
export function statusKind(settings, name) {
  const s = findStatus(settings, name);
  return s ? s.kind : "open";
}

export function initialStatus(settings) {
  return settings.statuses.find((s) => s.kind === "open").name;
}

export function firstDoneStatus(settings) {
  return settings.statuses.find((s) => s.kind === "done").name;
}

export function findPriority(settings, name) {
  return settings.priorities.find((p) => sameLabel(p.name, name)) || null;
}

/** 0 for the first (lowest) priority, rising with the list. Unknown priorities rank lowest. */
export function priorityRank(settings, name) {
  return settings.priorities.findIndex((p) => sameLabel(p.name, name));
}

export function findCategory(settings, name) {
  return settings.categories.find((c) => sameLabel(c.name, name)) || null;
}

export function activeCategories(settings) {
  return settings.categories.filter((c) => c.active);
}

export function activeTeam(settings) {
  return settings.team.filter((m) => m.active);
}

export function teamMember(settings, email) {
  const e = normalizeEmail(email);
  return (e && settings.team.find((m) => m.email === e)) || null;
}

/** admin, agent, or requester. */
export function roleOf(settings, email) {
  const m = teamMember(settings, email);
  return m && m.active ? m.role : "requester";
}

/** The settings a requester's screen needs: no team list, rules, or email wording. */
export function publicSettings(settings) {
  return {
    version: settings.version,
    general: settings.general,
    categories: activeCategories(settings).map((c) => ({ name: c.name, priority: c.priority })),
    priorities: settings.priorities,
    statuses: settings.statuses,
    locations: settings.locations,
  };
}

// --- Changes an administrator should be told about ---------------------------------

/**
 * The labels of single-value settings where what was typed could not be used, so something
 * else was saved (a color that is not a color, an address that is not an address, a number
 * outside its range, text that was too long). A value that was only tidied, such as "8:00"
 * saved as "08:00" or "1-5" saved as "1,2,3,4,5", is not reported. On and off switches are
 * left out, because they arrive in several spellings that all mean the same thing.
 */
export function adjustedFields(input, saved) {
  const out = [];
  const src = input || {};
  for (const f of GENERAL_FIELDS) {
    if (f.type === "bool" || !Object.prototype.hasOwnProperty.call(src, f.key)) continue;
    const typed = String(src[f.key] === null || src[f.key] === undefined ? "" : src[f.key]).trim();
    if (!typed) continue;
    const kept = saved.general[f.key];
    let unusable = false;
    if (f.type === "url" || f.type === "email") unusable = !kept;
    else if (f.type === "color") unusable = hexColor(typed, "") === "";
    else if (f.type === "number") unusable = !(Number(typed.replace(",", ".")) === kept);
    else if (f.type === "choice") unusable = !f.options.includes(typed);
    else if (f.type === "time") unusable = toTime(typed, "") !== kept;
    else if (f.key === "defaultPriority" || f.key === "ticketPrefix") unusable = typed.toLowerCase() !== String(kept).toLowerCase();
    else if (f.key === "workDays") unusable = !parseWorkDays(typed).clean;
    else if (f.key === "holidays") unusable = typed.split(/[\s,;]+/).filter(Boolean).some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
    else unusable = cleanLine(typed).length > (f.max || Infinity);
    if (unusable) out.push(f.label);
  }
  return out;
}

const RENAMABLE = ["statuses", "priorities", "categories", "locations"];
const nameOf = (item) => (typeof item === "string" ? item : (item && item.name) || "");

const kindOf = (item) => (item && typeof item === "object" ? item.kind : "");

/**
 * Finds list items that were renamed. Returns { statuses: { old: new }, priorities,
 * categories, locations }. Tickets store these names, so the hosts use the plan to rename them
 * on tickets too; otherwise a renamed status would leave its old tickets without a known status.
 *
 * explicit, when given, is { listId: { oldName: newName } } from an editor that knows which row
 * became which (the web settings screen). Only those renames are used, and only when the old
 * name is gone, the new name is on the list, and, for statuses, the kind is unchanged. A list
 * that explicit does not name gets no renames.
 *
 * Without explicit (the Gmail text editor, which has no rows to follow), a rename is read from
 * positions, and only when nothing else in the list changed: the same number of items, and each
 * item either keeps its name or takes a name that is new while its old name is gone. Anything
 * else (an item removed, added, merged, or moved) means no renames for that list, because the
 * pairing would be a guess. A status rename also needs the kind to stay the same, so a rename can
 * never reopen finished tickets or finish open ones.
 */
export function renamePlan(before, after, explicit) {
  const plan = {};
  for (const id of RENAMABLE) {
    plan[id] = {};
    const A = before[id] || [];
    const B = after[id] || [];
    const a = A.map(nameOf);
    const b = B.map(nameOf);
    const isOld = (n) => a.some((x) => sameLabel(x, n));
    const isNew = (n) => b.some((x) => sameLabel(x, n));
    const sameKind = (from, to) => id !== "statuses" || kindOf(A[a.findIndex((x) => sameLabel(x, from))]) === kindOf(B[b.findIndex((x) => sameLabel(x, to))]);
    if (explicit) {
      const wanted = explicit[id] || {};
      for (const from of Object.keys(wanted)) {
        const to = wanted[from];
        if (from && to && !sameLabel(from, to) && isOld(from) && !isNew(from) && isNew(to) && sameKind(from, to)) {
          plan[id][a.find((x) => sameLabel(x, from))] = b.find((x) => sameLabel(x, to));
        }
      }
      continue;
    }
    if (a.length !== b.length) continue;
    const pairs = [];
    let clean = true;
    for (let i = 0; i < a.length && clean; i++) {
      if (sameLabel(a[i], b[i])) continue;
      if (!isNew(a[i]) && !isOld(b[i]) && a[i] && b[i] && sameKind(a[i], b[i])) pairs.push([a[i], b[i]]);
      else clean = false;
    }
    if (clean) for (const [from, to] of pairs) plan[id][from] = to;
  }
  return plan;
}

export function hasRenames(plan) {
  return RENAMABLE.some((id) => Object.keys(plan[id] || {}).length > 0);
}

/** The new name for a value under a rename plan, or the value itself. */
export function renamed(plan, id, value) {
  const map = (plan && plan[id]) || {};
  const key = Object.keys(map).find((k) => sameLabel(k, value));
  return key ? map[key] : value;
}

/**
 * Carries renames into the settings that point at the renamed items: assignment rules, each
 * category's priority, and the default priority. Call it before normalizeSettings.
 */
export function applyRenamesToSettings(raw, plan) {
  const out = Object.assign({}, raw);
  out.general = Object.assign({}, raw.general);
  if (out.general.defaultPriority) out.general.defaultPriority = renamed(plan, "priorities", out.general.defaultPriority);
  out.categories = (raw.categories || []).map((c) => (c && typeof c === "object" ? Object.assign({}, c, { priority: renamed(plan, "priorities", c.priority) }) : c));
  out.rules = (raw.rules || []).map((r) => Object.assign({}, r, { category: renamed(plan, "categories", r.category), priority: renamed(plan, "priorities", r.priority), location: renamed(plan, "locations", r.location) }));
  return out;
}

/** A ticket with any renamed status, priority, category, or location replaced. Returns null when nothing changes. */
export function renameOnTicket(ticket, plan) {
  const next = {
    status: renamed(plan, "statuses", ticket.status),
    priority: renamed(plan, "priorities", ticket.priority),
    category: renamed(plan, "categories", ticket.category),
    location: renamed(plan, "locations", ticket.location),
  };
  const changed = Object.keys(next).some((k) => next[k] !== ticket[k]);
  return changed ? Object.assign({}, ticket, next) : null;
}

/** Names that tickets still use but that are no longer on their list, as sentences for an administrator. */
export function orphanWarnings(settings, tickets) {
  const out = [];
  const check = (id, field, what, consequence) => {
    const known = (settings[id] || []).map(nameOf);
    const counts = {};
    for (const t of tickets) {
      const v = String(t[field] || "").trim();
      if (!v || known.some((n) => sameLabel(n, v))) continue;
      const key = v.toLowerCase();
      counts[key] = { name: counts[key] ? counts[key].name : v, n: (counts[key] ? counts[key].n : 0) + 1 };
    }
    for (const key of Object.keys(counts)) {
      const c = counts[key];
      const one = c.n === 1;
      out.push(`${c.n} ${one ? "ticket uses" : "tickets use"} the ${what} "${c.name}", which is not on the list. ${consequence(one)}`);
    }
  };
  check("statuses", "status", "status", (one) => (one ? "It counts" : "They count") + " as open until its status is changed or the status is added back.");
  check("priorities", "priority", "priority", (one) => (one ? "It sorts" : "They sort") + " below every listed priority until the priority is changed or added back.");
  check("categories", "category", "category", (one) => "Change the category on " + (one ? "that ticket" : "those tickets") + ", or add it back to the list.");
  // Locations typed freely are not on any list, so only a location list is checked.
  if (settings.general && settings.general.locationMode === "list") {
    const label = String(settings.general.locationLabel || "location").toLowerCase();
    check("locations", "location", label, (one) => "Change the " + label + " on " + (one ? "that ticket" : "those tickets") + ", or add it back to the list.");
  }
  return out;
}
