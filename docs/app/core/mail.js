/**
 * Turns a planned notification into an email: subject, plain text, and HTML.
 * Templates are plain text with {{placeholders}}. Every value is escaped before it goes into
 * HTML, so nothing a person types into a ticket can change the email's markup.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { escapeHtml, htmlLines, safeUrl, accentFor, cleanLine, nameFromEmail } from "./text.js";
import { teamMember } from "./settings.js";

/** Replaces {{key}} with values[key]. Unknown placeholders become empty text. */
export function fillTemplate(text, values) {
  return String(text || "").replace(/\{\{\s*([^}]*?)\s*\}\}/g, (all, key) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : ""));
}

function defaultFormatDate(iso) {
  return iso ? String(iso).slice(0, 16).replace("T", " ") + " UTC" : "";
}

export function senderName(settings) {
  const g = settings.general;
  return cleanLine((g.orgName ? g.orgName + " " : "") + g.deskName, 120);
}

/** The values a template can use, as plain text. */
export function templateValues(ticket, settings, actor, data, formatDate) {
  const g = settings.general;
  const fmt = typeof formatDate === "function" ? formatDate : defaultFormatDate;
  const actorEmail = (actor && actor.email) || "";
  const member = teamMember(settings, actorEmail);
  const assignee = teamMember(settings, ticket.assignedTo);
  const d = data || {};
  return {
    "ticket.id": ticket.id,
    "ticket.subject": ticket.subject,
    "ticket.description": ticket.description,
    "ticket.category": ticket.category,
    "ticket.priority": ticket.priority,
    "ticket.location": ticket.location || "",
    "ticket.status": ticket.status,
    "ticket.assignedTo": ticket.assignedTo ? (assignee && assignee.name) || ticket.assignedTo : "Unassigned",
    "ticket.due": ticket.dueAt ? fmt(ticket.dueAt) : "",
    "ticket.created": fmt(ticket.createdAt),
    "ticket.word": g.ticketWord,
    "requester.name": ticket.requesterName || nameFromEmail(ticket.requesterEmail),
    "requester.email": ticket.requesterEmail,
    "actor.name": (member && member.name) || (actor && actor.name) || nameFromEmail(actorEmail),
    "actor.email": actorEmail,
    message: d.message || "",
    "old.status": d.oldStatus || "",
    "org.name": g.orgName,
    "desk.name": g.deskName,
  };
}

function detailRows(ticket, settings, values) {
  const g = settings.general;
  const rows = [
    ["Number", values["ticket.id"]],
    ["Subject", values["ticket.subject"]],
    ["Category", values["ticket.category"]],
    ["Priority", values["ticket.priority"]],
  ];
  if (g.locationMode !== "off" && ticket.location) rows.push([g.locationLabel, ticket.location]);
  rows.push(["Status", values["ticket.status"]]);
  rows.push(["Assigned to", values["ticket.assignedTo"]]);
  if (values["ticket.due"]) rows.push(["Due", values["ticket.due"]]);
  return rows;
}

function footerParts(settings) {
  const g = settings.general;
  return [senderName(settings), g.supportEmail, g.website, g.emailFooter].filter(Boolean);
}

/**
 * Builds the email for one notification.
 * Returns { to, subject, text, html, replyTo, senderName }.
 */
export function renderNotification(notification, ticket, settings, actor, formatDate) {
  const g = settings.general;
  const template = settings.templates[notification.template];
  const values = templateValues(ticket, settings, actor, notification.data, formatDate);
  const subject = cleanLine(fillTemplate(template.subject, values), 250);
  const body = fillTemplate(template.body, values).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const rows = detailRows(ticket, settings, values);
  const footer = footerParts(settings);

  const width = rows.reduce((w, r) => Math.max(w, r[0].length), 0) + 2;
  const text = body + "\n\n" + rows.map((r) => (r[0] + ":").padEnd(width + 1) + r[1]).join("\n") + "\n\n" + footer.join("\n") + "\n";

  const colors = accentFor(g.accentColor);
  const accent = colors.background;
  const onAccent = colors.text;
  const logo = safeUrl(g.logoUrl);
  const site = safeUrl(g.website);
  const paragraphs = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px 0;">${htmlLines(p)}</p>`).join("");
  const table = rows
    .map((r) => `<tr><td style="padding:5px 12px 5px 0;color:#56635B;white-space:nowrap;vertical-align:top;">${escapeHtml(r[0])}</td><td style="padding:5px 0;color:#18241D;">${escapeHtml(r[1])}</td></tr>`)
    .join("");
  const footerHtml = footer
    .map((part) => {
      if (part === g.supportEmail) return `<a href="mailto:${escapeHtml(part)}" style="color:#2B5843;">${escapeHtml(part)}</a>`;
      if (part === g.website && site) return `<a href="${escapeHtml(site)}" style="color:#2B5843;">${escapeHtml(part)}</a>`;
      return escapeHtml(part);
    })
    .join(" &middot; ");
  const html =
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F1F4F2;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F4F2;padding:24px 12px;"><tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #D0D9D3;border-radius:8px;">` +
    `<tr><td style="background:${accent};color:${onAccent};padding:18px 28px;border-radius:8px 8px 0 0;font-size:16px;font-weight:600;">` +
    (logo ? `<img src="${escapeHtml(logo)}" alt="" height="32" style="height:32px;vertical-align:middle;margin-right:12px;border:0;">` : "") +
    `${escapeHtml(senderName(settings))}</td></tr>` +
    `<tr><td style="padding:24px 28px 8px 28px;color:#18241D;font-size:15px;line-height:1.55;">${paragraphs}</td></tr>` +
    `<tr><td style="padding:0 28px 22px 28px;"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #D0D9D3;padding-top:12px;font-size:14px;line-height:1.4;">${table}</table></td></tr>` +
    `<tr><td style="padding:14px 28px;border-top:1px solid #D0D9D3;color:#56635B;font-size:12px;line-height:1.5;">${footerHtml}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { to: notification.to.slice(), subject, text, html, replyTo: g.supportEmail || "", senderName: senderName(settings) };
}
