/**
 * The settings screens, for administrators. Everything the help desk does is set here:
 * branding, ticket fields, assignment, working hours, email notices and wording, and the
 * lists of categories, priorities, statuses, locations, team members, and assignment rules.
 */
import { h, clear, field, button, busy } from "./dom.js";
import { GENERAL_FIELDS, TEMPLATE_KEYS, TEMPLATE_INFO, PLACEHOLDERS, PRESETS, STATUS_KINDS, normalizeSettings, presetById } from "../core/settings.js";
import { LISTS, listById, listItems, incompleteItem } from "../core/lists.js";
import { renderNotification } from "../core/mail.js";
import { ticketId } from "../core/tickets.js";
import { plural } from "../core/text.js";

const CHOICE_LABELS = {
  locationMode: { list: "Choose from the locations list", text: "Type anything", off: "No location field" },
  assignFallback: { none: "Leave the ticket unassigned", roundRobin: "Take turns among the team (round robin)" },
  hoursMode: { business: "Working hours only", calendar: "Every hour" },
  notifyTeamOnCreate: { assignee: "The assignee, or everyone when unassigned", all: "Everyone on the team", none: "No one" },
};

export async function settingsScreen(app, params) {
  const data = await app.ask("settingsGet");
  if (!data) return h("div", {}, button("Back", () => app.back()));
  const s = data.settings;
  const tab = params.tab || "general";
  const entry = app.top();
  const out = h("div", { class: "stack" }, h("h1", { text: "Settings" }));

  const tabs = [
    ["general", "General"],
    ["lists", "Lists"],
    ["email", "Email wording"],
  ];
  out.appendChild(
    h(
      "div",
      { class: "chips", role: "group", "aria-label": "Settings sections" },
      tabs.map((t) => h("button", { type: "button", class: "chip" + (t[0] === tab ? " on" : ""), "aria-pressed": t[0] === tab ? "true" : "false", onclick: () => app.replace("settings", { tab: t[0] }) }, t[1]))
    )
  );
  if (data.warnings && data.warnings.length) out.appendChild(h("div", { class: "notice" }, h("strong", { text: "To review" }), h("ul", {}, data.warnings.map((w) => h("li", { text: w })))));
  if (data.info && data.info.storage) out.appendChild(h("p", { class: "muted", text: data.info.storage }));

  /** Saves a patch, says what was stored, then redraws this screen if the person is still on it. */
  const save = (btn, patch, keep) =>
    busy(btn, async () => {
      const result = await app.ask("settingsSave", patch);
      if (!result) return;
      let text = "Saved.";
      if (result.adjusted && result.adjusted.length) text += " Corrected because the value could not be used: " + result.adjusted.join(", ") + ".";
      if (result.renamedTickets) text += " Renamed on " + plural(result.renamedTickets, "ticket") + ".";
      app.toast(text);
      await app.refreshBoot();
      await app.replaceIfTop(entry, "settings", Object.assign({ tab }, keep || {}));
    });

  if (tab === "general") out.appendChild(generalTab(s, save));
  if (tab === "lists") out.appendChild(listsTab(s, save, params, app));
  if (tab === "email") out.appendChild(emailTab(s, save, { key: params.key, drafts: params.drafts || {} }));
  return out;
}

// --- General -------------------------------------------------------------------

function generalTab(s, save) {
  const groups = [];
  GENERAL_FIELDS.forEach((f) => {
    if (!groups.includes(f.group)) groups.push(f.group);
  });
  const inputs = {};
  const sections = groups.map((group, i) => {
    const body = h("div", { class: "stack tight" });
    GENERAL_FIELDS.filter((f) => f.group === group).forEach((f) => {
      const spec = { label: f.label, name: f.key, value: s.general[f.key], hint: f.help };
      if (f.type === "bool") spec.type = "checkbox";
      else if (f.type === "choice") {
        spec.type = "select";
        spec.options = f.options.map((o) => ({ value: o, label: (CHOICE_LABELS[f.key] && CHOICE_LABELS[f.key][o]) || o }));
        spec.hint = "";
      } else if (f.key === "defaultPriority") {
        spec.type = "select";
        spec.options = s.priorities.map((p) => p.name);
        spec.hint = "";
      } else if (f.type === "number") {
        spec.type = "number";
        spec.min = f.min;
        spec.maxValue = f.max;
      } else if (f.type === "color" || f.type === "email" || f.type === "time") spec.type = f.type;
      else spec.max = f.max;
      inputs[f.key] = field(spec);
      body.appendChild(inputs[f.key].el);
    });
    return h("details", { class: "group", open: i === 0 }, h("summary", { text: group }), body);
  });
  // One Save for every group, so a change made in one group is never lost by saving another.
  const go = button("Save settings", null, "primary", { type: "submit" });
  return h(
    "form",
    {
      class: "stack",
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const general = {};
        Object.keys(inputs).forEach((k) => (general[k] = inputs[k].get()));
        save(go, { general });
      },
    },
    sections,
    go
  );
}

// --- Lists -----------------------------------------------------------------------

function listsTab(s, save, params, app) {
  const id = listById(params.list) ? params.list : LISTS[0].id;
  const def = listById(id);
  const out = h("div", { class: "stack items-box" });
  out.appendChild(
    h(
      "div",
      { class: "chips", role: "group", "aria-label": "Lists" },
      LISTS.map((l) => h("button", { type: "button", class: "chip" + (l.id === id ? " on" : ""), "aria-pressed": l.id === id ? "true" : "false", onclick: () => app.replace("settings", { tab: "lists", list: l.id }) }, l.title))
    )
  );
  out.appendChild(h("p", { class: "muted", text: def.help }));
  if (["statuses", "priorities", "categories", "locations"].includes(id)) {
    out.appendChild(h("p", { class: "hint", text: "To rename an item, change its name in place. Tickets that use it are renamed too. Removing an item leaves its tickets with the old name." }));
  }

  const teamOptions = [{ value: "", label: "No one" }].concat(s.team.filter((m) => m.active).map((m) => ({ value: m.email, label: m.name || m.email })));
  const columnSpec = (c, value) => {
    const spec = { label: c.label, name: c.key, value };
    if (c.type === "bool") spec.type = "checkbox";
    else if (c.type === "number") {
      spec.type = "number";
      spec.min = 0;
    } else if (c.key === "kind") {
      spec.type = "select";
      spec.options = STATUS_KINDS.map((k) => ({ value: k, label: k === "open" ? "Open (being worked on)" : k === "waiting" ? "Waiting (not counted as overdue)" : "Done (finished)" }));
    } else if (c.key === "role") {
      spec.type = "select";
      spec.options = [{ value: "agent", label: "Agent" }, { value: "admin", label: "Administrator" }];
    } else if (c.key === "assignTo") {
      spec.type = "select";
      spec.options = teamOptions;
    } else if (c.key === "priority") {
      spec.type = "select";
      spec.options = [{ value: "", label: id === "rules" ? "Any priority" : "Use the default" }].concat(s.priorities.map((p) => ({ value: p.name, label: p.name })));
    } else if (c.key === "category" && id === "rules") {
      spec.type = "select";
      spec.options = [{ value: "", label: "Any category" }].concat(s.categories.map((x) => ({ value: x.name, label: x.name })));
    } else if (c.key === "location" && id === "rules" && s.locations.length) {
      spec.type = "select";
      spec.options = [{ value: "", label: "Any location" }].concat(s.locations.map((l) => ({ value: l, label: l })));
    } else if (c.type === "email") spec.type = "email";
    return spec;
  };

  let rows = []; // each: { fields: { key: field } }
  const box = h("div", { class: "items" });
  const blank = () => {
    const item = {};
    def.columns.forEach((c) => (item[c.key] = c.type === "bool" ? true : c.key === "kind" ? "open" : c.key === "role" ? "agent" : c.type === "number" ? 0 : ""));
    return item;
  };
  const read = () =>
    rows.map((r) => {
      const item = {};
      def.columns.forEach((c) => (item[c.key] = r.fields[c.key].get()));
      return item;
    });
  /** What to call an item when a button names it: its first filled column, or its position. */
  const nameOfItem = (item, i) => String(item[def.columns[0].key] || item[def.columns[def.columns.length - 1].key] || "item " + (i + 1));
  const add = button("Add", () => {
    const now = read();
    now.push(blank());
    draw(now);
    const last = box.querySelector(".item:last-child input, .item:last-child select");
    if (last) last.focus();
  });
  /** Draws the items. focus: { index, tool } puts the keyboard focus back on a button after a redraw. */
  function draw(items, focus) {
    rows = items.map((item) => {
      const fields = {};
      def.columns.forEach((c) => (fields[c.key] = field(columnSpec(c, item[c.key]))));
      return { fields };
    });
    clear(box);
    rows.forEach((r, i) => {
      const label = nameOfItem(items[i], i);
      const move = (delta) => {
        const now = read();
        const j = i + delta;
        if (j < 0 || j >= now.length) return;
        const tmp = now[i];
        now[i] = now[j];
        now[j] = tmp;
        draw(now, { index: j, tool: delta < 0 ? "up" : "down" });
      };
      box.appendChild(
        h(
          "div",
          { class: "item" },
          h("div", { class: def.columns.length > 1 ? "grid2" : "" }, def.columns.map((c) => r.fields[c.key].el)),
          h(
            "div",
            { class: "item-tools" },
            button("↑", () => move(-1), "quiet", { "aria-label": "Move " + label + " up", "data-tool": "up", disabled: i === 0 }),
            button("↓", () => move(1), "quiet", { "aria-label": "Move " + label + " down", "data-tool": "down", disabled: i === rows.length - 1 }),
            button("Remove", () => { const now = read(); now.splice(i, 1); draw(now, { index: Math.min(i, now.length - 1), tool: "remove" }); }, "quiet", { "aria-label": "Remove " + label, "data-tool": "remove" })
          )
        )
      );
    });
    if (!rows.length) box.appendChild(h("p", { class: "empty", text: "This list is empty." }));
    if (focus) {
      const item = rows.length ? box.children[focus.index] : null;
      const target = item && (item.querySelector('[data-tool="' + focus.tool + '"]:not([disabled])') || item.querySelector("button:not([disabled])"));
      if (target) target.focus();
      else add.focus();
    }
  }
  draw(listItems(s, id).map((item) => Object.assign({}, item)));
  out.appendChild(box);

  const go = button("Save " + def.title.toLowerCase(), () => {
    const blankItem = blank();
    const items = read().filter((item) => def.columns.some((c) => String(item[c.key]) !== String(blankItem[c.key])));
    // An item without its required column would be dropped, so say so instead of losing it.
    const problem = incompleteItem(id, items);
    if (problem) {
      app.toast(problem, "bad");
      return undefined;
    }
    const lists = {};
    lists[id] = id === "locations" ? items.map((x) => x.name) : items;
    return save(go, { lists }, { list: id });
  }, "primary");
  out.appendChild(h("div", { class: "btn-row" }, add, go));

  if (id === "categories" || id === "locations") {
    const preset = field({ label: "Replace categories and locations with a preset", name: "preset", type: "select", options: PRESETS.map((p) => ({ value: p.id, label: p.name })) });
    let armed = false;
    const use = button("Use this preset", () => {
      if (!armed) {
        armed = true;
        use.textContent = "Select again to replace both lists";
        return undefined;
      }
      const p = presetById(preset.get());
      return save(use, { lists: { categories: p.categories.map((name) => ({ name, active: true })), locations: p.locations.slice() }, general: { locationLabel: p.locationLabel } }, { list: id });
    }, "quiet");
    out.appendChild(h("details", { class: "group" }, h("summary", { text: "Start from a preset" }), h("div", { class: "stack tight" }, preset.el, use)));
  }
  return out;
}

// --- Email wording -------------------------------------------------------------------

function sampleTicket(s) {
  const first = (list, fallback) => (list.length ? list[0] : fallback);
  return {
    id: ticketId(42, s),
    number: 42,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    requesterEmail: "pat.lee@example.com",
    requesterName: "Pat Lee",
    subject: "The printer on the second floor is offline",
    description: "It stopped printing this morning and shows a paper jam, but there is no paper stuck.",
    category: first(s.categories, { name: "General" }).name,
    priority: s.general.defaultPriority,
    location: first(s.locations, ""),
    status: first(s.statuses, { name: "Open" }).name,
    assignedTo: first(s.team, { email: "" }).email,
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    closedAt: "",
    source: "web",
  };
}

/** state: { key, drafts } where drafts keeps wording typed for each email until it is saved. */
function emailTab(s, save, state) {
  const key = TEMPLATE_KEYS.includes(state.key) ? state.key : TEMPLATE_KEYS[0];
  const drafts = state.drafts;
  const start = drafts[key] || s.templates[key];
  const out = h("div", { class: "stack items-box" });
  const pick = field({ label: "Email", name: "key", type: "select", value: key, options: TEMPLATE_KEYS.map((k) => ({ value: k, label: TEMPLATE_INFO[k] })) });
  const subject = field({ label: "Subject", name: "subject", value: start.subject, max: 200 });
  const body = field({ label: "Body", name: "body", type: "textarea", rows: 9, value: start.body, max: 5000, hint: "Plain text. The ticket's details are added under your text automatically." });
  const frame = h("iframe", { class: "mail-frame", sandbox: "", title: "Preview of the email" });
  const subjectLine = h("p", { class: "muted" });

  let last = body.input;
  subject.input.addEventListener("focus", () => (last = subject.input));
  body.input.addEventListener("focus", () => (last = body.input));

  const preview = () => {
    const draft = normalizeSettings(Object.assign({}, s, { templates: Object.assign({}, s.templates, { [key]: { subject: subject.get(), body: body.get() } }) }));
    const sample = sampleTicket(draft);
    const mail = renderNotification({ template: key, to: ["pat.lee@example.com"], data: { message: "This is where the reply or note appears.", oldStatus: sample.status } }, sample, draft, { email: draft.team.length ? draft.team[0].email : "helpdesk@example.com" });
    subjectLine.textContent = "Subject: " + mail.subject;
    frame.srcdoc = mail.html;
  };
  const typed = () => {
    drafts[key] = { subject: subject.get(), body: body.get() };
    preview();
  };
  subject.input.addEventListener("input", typed);
  body.input.addEventListener("input", typed);

  const chips = h(
    "div",
    { class: "chips wrap", role: "group", "aria-label": "Placeholders" },
    PLACEHOLDERS.map((p) =>
      h("button", { type: "button", class: "chip small", onclick: () => {
        const el = last;
        const token = "{{" + p + "}}";
        const from = el.selectionStart === null || el.selectionStart === undefined ? el.value.length : el.selectionStart;
        const to = el.selectionEnd === null || el.selectionEnd === undefined ? el.value.length : el.selectionEnd;
        el.value = el.value.slice(0, from) + token + el.value.slice(to);
        el.focus();
        el.setSelectionRange(from + token.length, from + token.length);
        typed();
      } }, p)
    )
  );

  const go = button("Save this email", () => {
    const patch = { templates: { [key]: { subject: subject.get(), body: body.get() } } };
    delete drafts[key];
    return save(go, patch, { key, drafts });
  }, "primary");
  let armed = false;
  const reset = button("Use the original wording", () => {
    if (!armed) {
      armed = true;
      reset.textContent = "Select again to replace this wording";
      return undefined;
    }
    delete drafts[key];
    return save(reset, { templates: { [key]: { subject: "", body: "" } } }, { key, drafts });
  }, "quiet");
  pick.input.addEventListener("change", () => {
    // Show the chosen email without leaving the tab. Wording typed for the others is kept.
    const next = emailTab(s, save, { key: pick.get(), drafts });
    out.replaceWith(next);
    const select = next.querySelector('select[name="key"]');
    if (select) select.focus();
  });
  out.append(pick.el, subject.el, body.el, h("p", { class: "hint", text: "Select a placeholder to insert it where the cursor is:" }), chips, h("div", { class: "btn-row" }, go, reset), h("h2", { text: "Preview" }), subjectLine, frame);
  preview();
  return out;
}
