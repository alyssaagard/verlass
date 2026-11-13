/**
 * Ticket rules: creating, updating, assigning, due times, queues, and counts.
 *
 * These functions never read or write storage and never send email. They take the current
 * ticket, the change someone asked for, and the settings, and return a plan: the new ticket,
 * the activity lines to record, the messages to add, and the notifications to send. Each host
 * (Apps Script, the task pane, the demo) carries the plan out with its own storage and mail.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { clean, cleanLine, normalizeEmail, sameEmail, sameLabel, nameFromEmail, toIso, toMs } from "./text.js";
import { statusKind, initialStatus, firstDoneStatus, findStatus, findPriority, priorityRank, findCategory, activeTeam, roleOf, teamMember, timeToMinutes } from "./settings.js";

export const LIMITS = { subject: 150, description: 5000, message: 5000, location: 80, name: 80 };

/** TKT-0042 from the number 42. */
export function ticketId(number, settings) {
  const g = settings.general;
  return g.ticketPrefix + String(Math.max(0, Math.floor(Number(number) || 0))).padStart(g.ticketDigits, "0");
}

/** 42 from TKT-0042, or 0 when the text has no number at its end. */
export function ticketNumber(id) {
  const m = /(\d+)\s*$/.exec(String(id || ""));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * The due time for a ticket that starts at `start` and is allowed `hours`.
 * In business mode only working hours count. localParts(date) must return the local
 * { dow, minutes, date } of a moment (day of week 0 to 6, minutes after midnight, YYYY-MM-DD);
 * each host supplies it for its own time zone. Returns "" when the priority has no due time.
 */
export function computeDue(start, hours, settings, localParts) {
  const startMs = toMs(start);
  const h = Number(hours);
  if (!(h > 0) || Number.isNaN(startMs)) return "";
  const g = settings.general;
  const calendar = new Date(startMs + h * 3600000).toISOString();
  if (g.hoursMode !== "business" || typeof localParts !== "function") return calendar;
  const days = g.workDays.split(",").map(Number);
  const holidays = g.holidays ? g.holidays.split(",") : [];
  const dayStart = timeToMinutes(g.workStart);
  const dayEnd = timeToMinutes(g.workEnd);
  const dayNumber = (date) => Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000);

  /**
   * The moment when the local clock first shows `target` minutes after the local midnight that
   * starts the day of `from` (target may be 1440, the next midnight). Local days can be 23 or 25
   * hours long when clocks change, so the moment is found by asking for the local time instead of
   * adding minutes. When the target falls in an hour that the clocks skip, the first moment after
   * the gap is returned.
   */
  function at(from, p, target) {
    const base = dayNumber(p.date);
    const local = (ms) => {
      const q = localParts(new Date(ms));
      return (dayNumber(q.date) - base) * 1440 + q.minutes;
    };
    let ms = from + (target - p.minutes) * 60000;
    for (let i = 0; i < 4; i++) {
      const now = local(ms);
      if (now === target) return ms;
      ms += (target - now) * 60000;
    }
    let lo = from;
    let hi = from + (target - p.minutes + 180) * 60000;
    while (hi - lo > 60000) {
      const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
      if (local(mid) >= target) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  let remaining = Math.round(h * 60) * 60000;
  let cursor = startMs;
  for (let guard = 0; guard < 20000; guard++) {
    const p = localParts(new Date(cursor));
    const working = days.includes(p.dow) && !holidays.includes(p.date);
    if (!working || p.minutes >= dayEnd) {
      cursor = at(cursor, p, 1440);
      continue;
    }
    if (p.minutes < dayStart) {
      cursor = at(cursor, p, dayStart);
      continue;
    }
    const end = at(cursor, p, dayEnd);
    const available = end - cursor;
    if (remaining <= available) return new Date(cursor + remaining).toISOString();
    remaining -= available;
    cursor = end;
  }
  return calendar;
}

/**
 * Chooses who gets a new ticket: the first matching rule, then the category's own person,
 * then round robin if it is on. People who are not active team members are skipped.
 * rrIndex is the round robin position; the returned rrIndex is the one to store.
 */
export function pickAssignee(fields, settings, rrIndex) {
  const agents = activeTeam(settings);
  const isActive = (email) => agents.some((m) => m.email === email);
  const text = (String(fields.subject || "") + " " + String(fields.description || "")).toLowerCase();
  for (const r of settings.rules) {
    if (r.category && !sameLabel(r.category, fields.category)) continue;
    if (r.priority && !sameLabel(r.priority, fields.priority)) continue;
    if (r.location && !sameLabel(r.location, fields.location)) continue;
    if (r.keyword && !text.includes(r.keyword.toLowerCase())) continue;
    if (isActive(r.assignTo)) return { assignedTo: r.assignTo, via: "rule", rrIndex };
  }
  const category = findCategory(settings, fields.category);
  if (category && category.assignTo && isActive(category.assignTo)) return { assignedTo: category.assignTo, via: "category", rrIndex };
  if (settings.general.assignFallback === "roundRobin" && agents.length) {
    const i = (((Number(rrIndex) || 0) % agents.length) + agents.length) % agents.length;
    return { assignedTo: agents[i].email, via: "roundRobin", rrIndex: i + 1 };
  }
  return { assignedTo: "", via: "", rrIndex };
}

function displayName(settings, email, fallback) {
  const m = teamMember(settings, email);
  return (m && m.name) || cleanLine(fallback, LIMITS.name) || nameFromEmail(email);
}

/**
 * Who on the team hears about a ticket: its assignee, or the whole active team when it has
 * none, when everyone is asked for, or when the assignee is no longer an active member.
 */
function teamRecipients(settings, ticket, exceptEmail, everyone) {
  const team = activeTeam(settings).map((m) => m.email);
  const list = !everyone && ticket.assignedTo && team.includes(ticket.assignedTo) ? [ticket.assignedTo] : team;
  return list.filter((e, i) => e && !sameEmail(e, exceptEmail) && list.indexOf(e) === i);
}

/**
 * Plans a new ticket.
 * input: { subject, description, category, priority, location, requesterEmail, requesterName }
 * actor: { email, name } of the signed-in person.
 * ctx:   { now, number, rrIndex, source, localParts }
 * Returns { ok: false, errors } or { ok: true, ticket, activity, notifications, rrIndex }.
 */
export function planCreate(input, actor, settings, ctx) {
  const g = settings.general;
  const errors = [];
  const src = input || {};
  const actorEmail = normalizeEmail(actor && actor.email);
  if (!actorEmail) return { ok: false, errors: ["Your email address could not be read, so the " + g.ticketWord + " was not sent."] };
  const isTeam = roleOf(settings, actorEmail) !== "requester";

  const subject = cleanLine(src.subject, LIMITS.subject);
  const description = clean(src.description, LIMITS.description);
  if (!subject) errors.push("Enter a subject.");
  if (!description) errors.push("Describe the problem or what you need.");

  const category = findCategory(settings, src.category);
  if (!category || !category.active) errors.push("Choose a category.");

  let priority = null;
  if ((isTeam || g.requesterSetsPriority) && String(src.priority || "").trim()) {
    priority = findPriority(settings, src.priority);
    if (!priority) errors.push("Choose a priority from the list.");
  }
  if (!priority) priority = (category && findPriority(settings, category.priority)) || findPriority(settings, g.defaultPriority) || settings.priorities[0];

  let location = "";
  if (g.locationMode !== "off") {
    location = cleanLine(src.location, LIMITS.location);
    if (location && g.locationMode === "list") {
      const match = settings.locations.find((l) => sameLabel(l, location));
      if (match) location = match;
      else errors.push("Choose a " + g.locationLabel.toLowerCase() + " from the list.");
    }
    if (!location && g.locationRequired) errors.push("Choose a " + g.locationLabel.toLowerCase() + ".");
  }

  let requesterEmail = actorEmail;
  let requesterName = displayName(settings, actorEmail, (actor && actor.name) || src.requesterName);
  let onBehalf = false;
  if (isTeam && String(src.requesterEmail || "").trim()) {
    const e = normalizeEmail(src.requesterEmail);
    if (!e) errors.push("The requester's email address is not valid.");
    else if (e !== actorEmail) {
      requesterEmail = e;
      requesterName = displayName(settings, e, src.requesterName);
      onBehalf = true;
    }
  }
  if (errors.length) return { ok: false, errors };

  const now = toIso(ctx.now) || new Date().toISOString();
  const pick = pickAssignee({ category: category.name, priority: priority.name, location, subject, description }, settings, ctx.rrIndex);
  const ticket = {
    id: ticketId(ctx.number, settings),
    number: ctx.number,
    createdAt: now,
    updatedAt: now,
    requesterEmail,
    requesterName,
    subject,
    description,
    category: category.name,
    priority: priority.name,
    location,
    status: initialStatus(settings),
    assignedTo: pick.assignedTo,
    dueAt: computeDue(now, priority.dueHours, settings, ctx.localParts),
    closedAt: "",
    source: cleanLine(ctx.source, 20) || "web",
  };

  const activity = [{ at: now, by: actorEmail, text: onBehalf ? "Created for " + requesterEmail + "." : "Created." }];
  if (pick.assignedTo) {
    const how = pick.via === "rule" ? "an assignment rule" : pick.via === "category" ? "the category" : "round robin";
    activity.push({ at: now, by: actorEmail, text: "Assigned to " + pick.assignedTo + " by " + how + "." });
  }

  const notifications = [];
  if (g.notifyRequesterOnCreate) notifications.push({ template: "created", to: [requesterEmail], data: {} });
  if (g.notifyTeamOnCreate !== "none") {
    // A requester who is on the team already gets the confirmation, so they are not told twice.
    const to = teamRecipients(settings, ticket, actorEmail, g.notifyTeamOnCreate === "all").filter((e) => !(g.notifyRequesterOnCreate && sameEmail(e, requesterEmail)));
    if (to.length) notifications.push({ template: "teamNew", to, data: {} });
  }
  return { ok: true, ticket, activity, notifications, rrIndex: pick.rrIndex };
}

/**
 * Plans a change to a ticket.
 * changes (team): { status, assignedTo, priority, category, location, dueAt, subject, reply, note }
 * changes (requester, own tickets only): { reply, close, reopen }
 * A key that is absent means "leave it alone"; assignedTo: "" and dueAt: "" clear the value.
 * Returns { ok: false, errors } or
 * { ok: true, changed, ticket, activity, messages, notifications, oldStatus }.
 */
export function planUpdate(ticket, changes, actor, settings, ctx) {
  const g = settings.general;
  const c = changes || {};
  const actorEmail = normalizeEmail(actor && actor.email);
  const isTeam = roleOf(settings, actorEmail) !== "requester";
  const isOwner = sameEmail(ticket.requesterEmail, actorEmail);
  if (!actorEmail || (!isTeam && !isOwner)) return { ok: false, errors: ["You do not have access to this " + g.ticketWord + "."] };

  const errors = [];
  const now = toIso(ctx && ctx.now) || new Date().toISOString();
  const next = Object.assign({}, ticket);
  const activity = [];
  const say = (text) => activity.push({ at: now, by: actorEmail, text });
  const oldKind = statusKind(settings, ticket.status);
  const reply = clean(c.reply, LIMITS.message);
  const note = isTeam ? clean(c.note, LIMITS.message) : "";
  let reopenedSilently = false;
  let closedByRequester = false;

  if (isTeam) {
    if (c.status !== undefined && !sameLabel(c.status, ticket.status)) {
      const s = findStatus(settings, c.status);
      if (!s) errors.push("Choose a status from the list.");
      else next.status = s.name;
    }
    if (c.assignedTo !== undefined) {
      const raw = String(c.assignedTo || "").trim();
      const e = normalizeEmail(raw);
      if (raw && !e) errors.push("The assignee must be an email address.");
      else if (e && !sameEmail(e, ticket.assignedTo) && !activeTeam(settings).some((m) => m.email === e)) errors.push("The assignee must be an active team member.");
      else next.assignedTo = e;
    }
    if (c.priority !== undefined && !sameLabel(c.priority, ticket.priority)) {
      const p = findPriority(settings, c.priority);
      if (!p) errors.push("Choose a priority from the list.");
      else {
        next.priority = p.name;
        if (c.dueAt === undefined) next.dueAt = computeDue(ticket.createdAt, p.dueHours, settings, ctx && ctx.localParts);
      }
    }
    if (c.category !== undefined && !sameLabel(c.category, ticket.category)) {
      const cat = findCategory(settings, c.category);
      if (!cat) errors.push("Choose a category from the list.");
      else next.category = cat.name;
    }
    if (c.location !== undefined) next.location = cleanLine(c.location, LIMITS.location);
    if (c.subject !== undefined) {
      const s = cleanLine(c.subject, LIMITS.subject);
      if (!s) errors.push("The subject cannot be empty.");
      else next.subject = s;
    }
    if (c.dueAt !== undefined) {
      if (c.dueAt === "" || c.dueAt === null) next.dueAt = "";
      else {
        const iso = toIso(c.dueAt);
        if (!iso) errors.push("The due time is not a date.");
        else next.dueAt = iso;
      }
    }
  } else {
    if (oldKind === "done") {
      // A finished ticket: a reply or a reopen request reopens it, if that is allowed at all.
      if (reply || c.reopen) {
        if (!g.requesterCanReopen) errors.push("This " + g.ticketWord + " is closed. Please send a new one.");
        else if (!c.close) {
          next.status = initialStatus(settings);
          reopenedSilently = !reply;
        }
      }
    } else if (c.close) {
      // Closing wins over everything else, including a reply sent with it.
      if (!g.requesterCanClose) errors.push("Only the team can close a " + g.ticketWord + ".");
      else {
        next.status = firstDoneStatus(settings);
        closedByRequester = true;
      }
    } else if (reply && oldKind === "waiting") {
      next.status = initialStatus(settings);
    }
  }
  if (errors.length) return { ok: false, errors };

  const newKind = statusKind(settings, next.status);
  const statusChanged = next.status !== ticket.status;
  const assigneeChanged = !sameEmail(next.assignedTo, ticket.assignedTo) && (next.assignedTo || "") !== (ticket.assignedTo || "");
  if (statusChanged) say("Status changed from " + ticket.status + " to " + next.status + ".");
  if (assigneeChanged) say(next.assignedTo ? "Assigned to " + next.assignedTo + "." : "Assignment removed.");
  if (next.priority !== ticket.priority) say("Priority changed from " + ticket.priority + " to " + next.priority + ".");
  if (next.category !== ticket.category) say("Category changed from " + ticket.category + " to " + next.category + ".");
  if ((next.location || "") !== (ticket.location || "")) say(g.locationLabel + " changed to " + (next.location || "none") + ".");
  if (next.subject !== ticket.subject) say("Subject changed.");
  if ((next.dueAt || "") !== (ticket.dueAt || "")) say(next.dueAt ? "Due time changed." : "Due time removed.");
  if (newKind === "done" && oldKind !== "done") next.closedAt = now;
  if (newKind !== "done") next.closedAt = "";

  const actorName = displayName(settings, actorEmail, actor && actor.name);
  const messages = [];
  if (reply) {
    messages.push({ at: now, by: actorEmail, byName: actorName, role: isTeam ? "team" : "requester", visibility: "public", text: reply });
    say("Replied.");
  }
  if (note) {
    messages.push({ at: now, by: actorEmail, byName: actorName, role: "team", visibility: "internal", text: note });
    say("Added an internal note.");
  }

  const changed = activity.length > 0;
  if (changed) next.updatedAt = now;

  const notifications = [];
  if (changed) {
    const requester = ticket.requesterEmail;
    if (assigneeChanged && next.assignedTo && !sameEmail(next.assignedTo, actorEmail) && g.notifyAssigneeOnAssign) {
      notifications.push({ template: "assigned", to: [next.assignedTo], data: {} });
    }
    if (isTeam) {
      const status = findStatus(settings, next.status);
      const tellStatus = statusChanged && g.notifyRequesterOnStatus && status && status.notify && !sameEmail(requester, actorEmail);
      if (tellStatus) {
        notifications.push({ template: newKind === "done" ? "resolved" : "status", to: [requester], data: { oldStatus: ticket.status, message: reply } });
      } else if (reply && g.notifyRequesterOnReply && !sameEmail(requester, actorEmail)) {
        notifications.push({ template: "reply", to: [requester], data: { message: reply } });
      }
      // A team member writing on their own ticket is the requester here: tell whoever has it.
      if (reply && sameEmail(requester, actorEmail) && next.assignedTo && !assigneeChanged && g.notifyTeamOnRequesterReply) {
        const to = teamRecipients(settings, next, actorEmail, false);
        if (to.length) notifications.push({ template: "requesterReply", to, data: { message: reply } });
      }
    } else if ((reply || reopenedSilently || closedByRequester) && g.notifyTeamOnRequesterReply) {
      const to = teamRecipients(settings, next, actorEmail, false);
      const fallback = closedByRequester ? "Closed by the requester without a message." : "Reopened without a message.";
      if (to.length) notifications.push({ template: "requesterReply", to, data: { message: reply ? (closedByRequester ? reply + "\n\n(Closed by the requester.)" : reply) : fallback } });
    }
  }
  return { ok: true, changed, ticket: next, activity, messages, notifications, oldStatus: ticket.status };
}

// --- Access ------------------------------------------------------------------

/** True when this person may read the ticket: the team, or the requester. */
export function canSee(ticket, email, settings) {
  return roleOf(settings, email) !== "requester" || sameEmail(ticket.requesterEmail, email);
}

/** The messages this person may read. Requesters never get internal notes. */
export function visibleMessages(messages, email, settings) {
  const isTeam = roleOf(settings, email) !== "requester";
  return (messages || []).filter((m) => isTeam || m.visibility === "public");
}

// --- Queues ------------------------------------------------------------------

export const TEAM_VIEWS = [
  { id: "open", label: "Open" },
  { id: "unassigned", label: "Unassigned" },
  { id: "mine", label: "Assigned to me" },
  { id: "overdue", label: "Overdue" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Finished" },
  { id: "all", label: "All" },
];

/** A ticket is overdue when it is being worked on (not waiting, not finished) and past its due time. */
export function isOverdue(ticket, settings, nowMs) {
  if (!ticket.dueAt || statusKind(settings, ticket.status) !== "open") return false;
  const due = toMs(ticket.dueAt);
  return !Number.isNaN(due) && due < nowMs;
}

export function inView(ticket, view, actorEmail, settings, nowMs) {
  const kind = statusKind(settings, ticket.status);
  switch (view) {
    case "requested":
      return sameEmail(ticket.requesterEmail, actorEmail);
    case "open":
      return kind !== "done";
    case "unassigned":
      return kind !== "done" && !ticket.assignedTo;
    case "mine":
      return kind !== "done" && sameEmail(ticket.assignedTo, actorEmail);
    case "overdue":
      return isOverdue(ticket, settings, nowMs);
    case "waiting":
      return kind === "waiting";
    case "done":
      return kind === "done";
    default:
      return true;
  }
}

/** True when every word of the search appears somewhere in the ticket. */
export function matchesQuery(ticket, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [ticket.id, ticket.subject, ticket.description, ticket.requesterName, ticket.requesterEmail, ticket.category, ticket.priority, ticket.location, ticket.status, ticket.assignedTo]
    .join("\n")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Work order: tickets being worked on first (overdue ones at the top, then the highest
 * priority, the soonest due time, and the oldest), then waiting tickets, then finished ones.
 */
export function sortForQueue(tickets, settings, nowMs) {
  const key = (t) => {
    const due = toMs(t.dueAt);
    const kind = statusKind(settings, t.status);
    return {
      done: kind === "done" ? 2 : kind === "waiting" ? 1 : 0,
      overdue: isOverdue(t, settings, nowMs) ? 0 : 1,
      rank: -priorityRank(settings, t.priority),
      due: Number.isNaN(due) ? Infinity : due,
      created: toMs(t.createdAt) || 0,
    };
  };
  return tickets
    .map((t) => ({ t, k: key(t) }))
    .sort((a, b) => a.k.done - b.k.done || a.k.overdue - b.k.overdue || a.k.rank - b.k.rank || a.k.due - b.k.due || a.k.created - b.k.created)
    .map((x) => x.t);
}

/** Newest activity first, with unfinished tickets ahead of finished ones. */
export function sortByRecent(tickets, settings) {
  return tickets.slice().sort((a, b) => {
    const da = statusKind(settings, a.status) === "done" ? 1 : 0;
    const db = statusKind(settings, b.status) === "done" ? 1 : 0;
    return da - db || (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0);
  });
}

/**
 * One page of a queue.
 * opts: { view, query, category, priority, status, assignedTo, page, pageSize }
 * Requesters always get only their own tickets, whatever view they ask for.
 */
export function listTickets(tickets, opts, actorEmail, settings, nowMs) {
  const o = opts || {};
  const isTeam = roleOf(settings, actorEmail) !== "requester";
  const view = isTeam ? o.view || "open" : "requested";
  let items = tickets.filter((t) => (isTeam || sameEmail(t.requesterEmail, actorEmail)) && inView(t, view, actorEmail, settings, nowMs) && matchesQuery(t, o.query));
  if (o.category) items = items.filter((t) => sameLabel(t.category, o.category));
  if (o.priority) items = items.filter((t) => sameLabel(t.priority, o.priority));
  if (o.status) items = items.filter((t) => sameLabel(t.status, o.status));
  if (o.assignedTo) items = items.filter((t) => sameEmail(t.assignedTo, o.assignedTo));
  items = view === "requested" || view === "done" || view === "all" ? sortByRecent(items, settings) : sortForQueue(items, settings, nowMs);
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(o.pageSize) || settings.general.pageSize)));
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(o.page) || 1)));
  return { view, total: items.length, page, pages, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

/** Counts for the dashboard. */
export function ticketStats(tickets, actorEmail, settings, nowMs) {
  const stats = { open: 0, unassigned: 0, mine: 0, overdue: 0, waiting: 0, done: 0, doneThisWeek: 0, total: tickets.length, requestedOpen: 0 };
  const weekAgo = nowMs - 7 * 86400000;
  for (const t of tickets) {
    const kind = statusKind(settings, t.status);
    if (kind !== "done") {
      stats.open++;
      if (!t.assignedTo) stats.unassigned++;
      if (sameEmail(t.assignedTo, actorEmail)) stats.mine++;
      if (sameEmail(t.requesterEmail, actorEmail)) stats.requestedOpen++;
    }
    if (kind === "waiting") stats.waiting++;
    if (isOverdue(t, settings, nowMs)) stats.overdue++;
    if (kind === "done") stats.done++;
    if (kind === "done" && toMs(t.closedAt) >= weekAgo) stats.doneThisWeek++;
  }
  return stats;
}
