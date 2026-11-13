/**
 * The help desk screens, shared by the Outlook task pane, the browser app, and the demo.
 *
 * mountApp(root, { service, host }) draws the app inside root.
 *   service: makeService(backend) from ../stores/service.js
 *   host:    { kind: "demo" | "outlook" | "web", name, siteUrl,
 *              readMessage()  optional, returns the open email { subject, body, fromEmail, fromName }
 *              signOut()      optional
 *              demo           optional, the demo backend (personas, outbox, reset)
 *              setupScreen(app)  optional, a screen to show when the help desk is not set up }
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */
import { h, clear, field, button, busy, shortDate, toLocalInput, fromLocalInput, THEMES, themeChoice, setTheme } from "./dom.js";
import { TEAM_VIEWS, LIMITS } from "../core/tickets.js";
import { statusKind, PRESETS } from "../core/settings.js";
import { sameLabel, sameEmail, plural } from "../core/text.js";
import { settingsScreen } from "./settings.js";
import { MARK_SVG } from "./mark.js";

/** The product mark. MARK_SVG is a constant made by the brand script, never text from a person. */
function markEl() {
  const span = h("span", { class: "bar-mark", "aria-hidden": "true" });
  span.innerHTML = MARK_SVG;
  return span;
}

export function mountApp(root, options) {
  const service = options.service;
  const host = options.host || { kind: "web", name: "Verlass" };
  const app = { boot: null, stack: [], host, service };

  const bar = h("header", { class: "bar" });
  // Inside a web page that has its own main landmark, the app is a plain region.
  const main = h(host.embedded ? "div" : "main", { class: "view", tabindex: "-1" });
  const toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
  clear(root).append(bar, main, toastBox);
  root.classList.add("app");

  // --- Helpers -----------------------------------------------------------------

  app.toast = (text, kind) => {
    const t = h("div", { class: "toast" + (kind ? " " + kind : ""), text });
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), kind === "bad" ? 9000 : 4500);
  };

  /** Calls the service. On failure shows the message and returns null. */
  app.ask = async (action, payload) => {
    const result = await service.call(action, payload);
    if (!result.ok) {
      app.toast((result.errors || ["Something went wrong."]).join(" "), "bad");
      return null;
    }
    return result;
  };

  const word = (capital) => {
    const w = (app.boot && app.boot.settings.general.ticketWord) || "request";
    return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  };
  app.word = word;
  const isTeam = () => app.boot && app.boot.role !== "requester";
  const settings = () => app.boot.settings;

  const personName = (email) => {
    if (!email) return "Unassigned";
    const m = (settings().team || []).find((t) => t.email === email);
    return (m && m.name) || email;
  };

  // --- Navigation ----------------------------------------------------------------

  const screens = {};

  app.go = (name, params) => {
    app.stack.push({ name, params: params || {} });
    return render();
  };
  app.replace = (name, params) => {
    app.stack[app.stack.length - 1] = { name, params: params || {} };
    return render();
  };
  /** The screen that is showing now. A save keeps it, to see whether the person moved on meanwhile. */
  app.top = () => app.stack[app.stack.length - 1];
  /** Redraws a screen with new parameters, but only if the person is still on it. */
  app.replaceIfTop = (entry, name, params) => (app.top() === entry ? app.replace(name, params) : Promise.resolve());
  app.back = async () => {
    if (app.stack.length > 1) app.stack.pop();
    // Back on the first screen, the counts and the person's role are read again.
    if (app.stack.length === 1) await refreshBoot();
    return render();
  };
  app.home = async () => {
    app.stack = [{ name: "home", params: {} }];
    await refreshBoot();
    return render();
  };

  async function refreshBoot() {
    const result = await service.call("boot");
    if (result.ok) app.boot = result;
    return result;
  }
  app.refreshBoot = refreshBoot;

  let renderCount = 0;
  async function render() {
    const mine = ++renderCount;
    const top = app.stack[app.stack.length - 1];
    drawBar();
    clear(main).appendChild(h("p", { class: "loading", text: "Loading..." }));
    let node;
    try {
      node = await screens[top.name](top.params);
    } catch (e) {
      node = h("div", { class: "notice bad" }, h("p", { text: String((e && e.message) || e) }), button("Try again", () => render()));
    }
    if (mine !== renderCount) return; // A newer screen was asked for while this one loaded.
    clear(main).appendChild(node);
    main.scrollTop = 0;
    if (app.stack.length > 1) main.focus({ preventScroll: true });
  }
  app.render = render;

  function drawBar() {
    const g = app.boot && app.boot.ready ? settings().general : null;
    const canBack = app.stack.length > 1;
    const title = h("div", { class: "bar-title" }, h("strong", { text: g ? g.deskName : host.name }), g && g.orgName ? h("span", { text: g.orgName }) : null);
    const menu = h(
      "details",
      { class: "menu" },
      h("summary", { "aria-label": "Menu" }, h("span", { class: "dots", "aria-hidden": "true", text: "•••" })),
      h(
        "div",
        { class: "menu-list" },
        h("p", { class: "menu-label", text: "Theme" }),
        THEMES.map((t) =>
          h("button", { type: "button", class: "menu-item" + (themeChoice() === t ? " on" : ""), "aria-pressed": themeChoice() === t ? "true" : "false", onclick: () => { setTheme(t); drawBar(); const s = bar.querySelector(".menu summary"); if (s) s.focus(); } }, t.charAt(0).toUpperCase() + t.slice(1))
        ),
        app.boot && app.boot.ready && app.boot.role === "admin" ? h("button", { type: "button", class: "menu-item", onclick: () => app.go("settings") }, "Settings") : null,
        host.demo ? h("button", { type: "button", class: "menu-item", onclick: () => app.go("outbox") }, "Email outbox") : null,
        host.demo ? h("button", { type: "button", class: "menu-item", onclick: async () => { host.demo.reset(); if (host.onReset) host.onReset(); app.toast("The demo was reset."); await app.home(); } }, "Reset the demo") : null,
        host.signOut ? h("button", { type: "button", class: "menu-item", onclick: () => host.signOut() }, "Sign out") : null,
        h("a", { class: "menu-item", href: (host.siteUrl || "") + "/help/", target: "_blank", rel: "noopener" }, "Help")
      )
    );
    clear(bar).append(
      canBack ? h("button", { type: "button", class: "back", "aria-label": "Back", onclick: () => app.back() }, "←") : g && g.logoUrl ? h("img", { class: "bar-logo", src: g.logoUrl, alt: "" }) : markEl(),
      title,
      menu
    );
  }

  // --- Small pieces -----------------------------------------------------------------

  function badge(text, kind) {
    return h("span", { class: "badge" + (kind ? " " + kind : ""), text });
  }

  function statusBadge(status) {
    return badge(status, "k-" + statusKind(settings(), status));
  }

  function ticketRow(t, showPeople) {
    return h(
      "button",
      { type: "button", class: "row", onclick: () => app.go("ticket", { id: t.id }) },
      h("span", { class: "row-top" }, h("span", { class: "mono", text: t.id }), statusBadge(t.status), t.overdue ? badge("Overdue", "warn") : null, h("span", { class: "row-pri", text: t.priority })),
      h("span", { class: "row-title", text: t.subject }),
      h("span", { class: "row-sub", text: showPeople ? t.requesterName + " · " + personName(t.assignedTo) : "Updated " + shortDate(t.updatedAt) })
    );
  }

  // --- Home ------------------------------------------------------------------------

  screens.home = async () => {
    if (!app.boot) {
      const result = await refreshBoot();
      if (!result.ok) throw new Error((result.errors || ["The help desk could not be opened."]).join(" "));
    }
    if (!app.boot.ready) return host.setupScreen ? host.setupScreen(app) : setupScreen();
    drawBar();
    const st = app.boot.stats;
    const out = h("div", { class: "stack" });

    const actions = h("div", { class: "stack tight" }, button("New " + word(), () => app.go("new"), "primary big"));
    if (host.readMessage) actions.appendChild(button("Create from the open email", () => app.go("new", { fromMessage: true })));
    out.appendChild(actions);

    if (isTeam()) {
      const tiles = [
        ["open", "Open", st.open],
        ["unassigned", "Unassigned", st.unassigned],
        ["mine", "Assigned to me", st.mine],
        ["overdue", "Overdue", st.overdue],
        ["waiting", "Waiting", st.waiting],
        ["done", "Finished", st.done],
      ];
      out.appendChild(
        h(
          "section",
          { "aria-label": "Team queues" },
          h("h2", { text: "Queues" }),
          h(
            "div",
            { class: "tiles" },
            tiles.map((t) => h("button", { type: "button", class: "tile" + (t[0] === "overdue" && t[2] ? " warn" : ""), onclick: () => app.go("list", { view: t[0] }) }, h("span", { class: "tile-n", text: String(t[2]) }), h("span", { class: "tile-l", text: t[1] })))
          )
        )
      );
      const q = field({ label: "Find a " + word(), name: "q", placeholder: "Number, name, or words" });
      const form = h("form", { class: "search", onsubmit: (e) => { e.preventDefault(); app.go("list", { view: "all", query: q.get() }); } }, q.el, button("Search", null, "", { type: "submit" }));
      out.appendChild(form);
    }

    const mine = await app.ask("list", { view: "requested", pageSize: 5 });
    if (mine) {
      const section = h("section", {}, h("h2", { text: "My " + word() + "s" }));
      if (!mine.list.items.length) section.appendChild(h("p", { class: "muted", text: "You have not sent any yet." }));
      mine.list.items.forEach((t) => section.appendChild(ticketRow(t, false)));
      if (mine.list.total > mine.list.items.length) section.appendChild(button("See all " + mine.list.total, () => app.go("list", { view: "requested" }), "quiet"));
      out.appendChild(section);
    }

    if (app.boot.role === "admin") {
      const admin = h("section", {}, h("h2", { text: "Administration" }));
      if (app.boot.warnings && app.boot.warnings.length) admin.appendChild(h("div", { class: "notice" }, h("strong", { text: "To review" }), h("ul", {}, app.boot.warnings.slice(0, 5).map((w) => h("li", { text: w })))));
      admin.appendChild(button("Settings", () => app.go("settings")));
      out.appendChild(admin);
    }
    return out;
  };

  function setupScreen() {
    if (!app.boot.canSetup) return h("div", { class: "notice" }, h("p", { text: "This help desk has not been set up yet. Ask your administrator to open it first." }));
    const org = field({ label: "Organization name", name: "orgName", hint: "Shown in the header and in email." });
    const preset = field({ label: "Start with lists for", name: "preset", type: "select", options: PRESETS.map((p) => ({ value: p.id, label: p.name })) });
    const go = button("Create the help desk", () => busy(go, async () => {
      const result = await app.ask("setup", { orgName: org.get(), preset: preset.get() });
      if (result) {
        app.boot = result;
        app.toast("Your help desk is ready.");
        await render();
      }
    }), "primary");
    return h("div", { class: "stack" }, h("h1", { text: "Set up your help desk" }), h("p", { text: "You will be its first administrator. Everything can be changed later." }), org.el, preset.el, go);
  }

  // --- New ticket --------------------------------------------------------------------

  screens.new = async (params) => {
    const s = settings();
    const g = s.general;
    const v = { subject: "", description: "", source: host.kind };
    if (params.fromMessage && host.readMessage) {
      const m = await host.readMessage();
      if (m) {
        v.subject = String(m.subject || "").slice(0, LIMITS.subject);
        v.description = String(m.body || "").slice(0, LIMITS.description);
        v.source = "email";
        if (isTeam() && m.fromEmail && !sameEmail(m.fromEmail, app.boot.user.email)) {
          v.requesterEmail = m.fromEmail;
          v.requesterName = m.fromName || "";
        }
      } else app.toast("The open email could not be read.", "bad");
    }
    const f = {};
    f.subject = field({ label: "Subject", name: "subject", required: true, max: LIMITS.subject, value: v.subject, hint: "A short summary." });
    f.category = field({ label: "Category", name: "category", type: "select", required: true, options: s.categories.filter((c) => c.active !== false).map((c) => c.name) });
    if (isTeam() || g.requesterSetsPriority) {
      // The first choice leaves the priority to the category, or to the default.
      f.priority = field({ label: "Priority", name: "priority", type: "select", value: "", options: [{ value: "", label: "Standard for the category" }].concat(s.priorities.map((p) => ({ value: p.name, label: p.hint ? p.name + ": " + p.hint : p.name }))) });
    }
    if (g.locationMode === "list" && s.locations.length) {
      const options = (g.locationRequired ? [] : [{ value: "", label: "Not applicable" }]).concat(s.locations.map((l) => ({ value: l, label: l })));
      f.location = field({ label: g.locationLabel, name: "location", type: "select", required: g.locationRequired, options });
    } else if (g.locationMode !== "off") {
      f.location = field({ label: g.locationLabel, name: "location", required: g.locationRequired, max: LIMITS.location });
    }
    f.description = field({ label: "Description", name: "description", type: "textarea", rows: 7, required: true, max: LIMITS.description, value: v.description, hint: "What happened, what you expected, and any error message." });
    if (isTeam()) {
      f.requesterEmail = field({ label: "Requester email", name: "requesterEmail", type: "email", value: v.requesterEmail || "", hint: "Leave empty when the " + word() + " is your own." });
      f.requesterName = field({ label: "Requester name", name: "requesterName", value: v.requesterName || "" });
    }
    const problems = h("div", { class: "notice bad", hidden: true, role: "alert" });
    const send = button("Send " + word(), null, "primary", { type: "submit" });
    const form = h(
      "form",
      {
        class: "stack",
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          busy(send, async () => {
            const payload = { source: v.source };
            Object.keys(f).forEach((k) => (payload[k] = f[k].get()));
            const result = await service.call("create", payload);
            if (!result.ok) {
              clear(problems).append(h("strong", { text: "Please check:" }), h("ul", {}, (result.errors || []).map((x) => h("li", { text: x }))));
              problems.hidden = false;
              problems.scrollIntoView({ block: "nearest" });
              return;
            }
            app.toast(result.ticket.id + " was sent." + (result.mailProblems && result.mailProblems.length ? " An email notice could not be sent." : ""));
            await refreshBoot();
            app.stack = [{ name: "home", params: {} }];
            await app.go("ticket", { id: result.ticket.id });
          });
        },
      },
      h("h1", { text: "New " + word() }),
      problems,
      Object.keys(f).map((k) => f[k].el),
      send
    );
    return form;
  };

  // --- Lists -----------------------------------------------------------------------

  screens.list = async (params) => {
    const p = Object.assign({ view: isTeam() ? "open" : "requested", page: 1, query: "" }, params);
    const result = await app.ask("list", p);
    if (!result) return h("div", {}, button("Back", () => app.back()));
    const L = result.list;
    const s = settings();
    const reload = (changes) => app.replace("list", Object.assign({}, p, changes));
    const out = h("div", { class: "stack" });
    const viewDef = TEAM_VIEWS.find((v) => v.id === L.view);
    out.appendChild(h("h1", { text: L.view === "requested" ? "My " + word() + "s" : viewDef ? viewDef.label : "All" }));

    if (isTeam() && L.view !== "requested") {
      out.appendChild(
        h(
          "div",
          { class: "chips", role: "group", "aria-label": "Queue" },
          TEAM_VIEWS.map((v) => h("button", { type: "button", class: "chip" + (v.id === L.view ? " on" : ""), "aria-pressed": v.id === L.view ? "true" : "false", onclick: () => reload({ view: v.id, page: 1 }) }, v.label))
        )
      );
      const q = field({ label: "Search", name: "q", value: p.query, placeholder: "Number, name, or words" });
      const cat = field({ label: "Category", name: "category", type: "select", value: p.category || "", options: [{ value: "", label: "Any category" }].concat(s.categories.map((c) => ({ value: c.name, label: c.name }))) });
      const pri = field({ label: "Priority", name: "priority", type: "select", value: p.priority || "", options: [{ value: "", label: "Any priority" }].concat(s.priorities.map((x) => ({ value: x.name, label: x.name }))) });
      const who = field({ label: "Assigned to", name: "assignedTo", type: "select", value: p.assignedTo || "", options: [{ value: "", label: "Anyone" }].concat((s.team || []).map((m) => ({ value: m.email, label: m.name || m.email }))) });
      const filtered = !!(p.category || p.priority || p.assignedTo);
      out.appendChild(
        h(
          "form",
          { class: "filters", onsubmit: (e) => { e.preventDefault(); reload({ query: q.get(), category: cat.get(), priority: pri.get(), assignedTo: who.get(), page: 1 }); } },
          h("div", { class: "search" }, q.el, button("Search", null, "", { type: "submit" })),
          h("details", { open: filtered }, h("summary", { text: "Filters" + (filtered ? " (on)" : "") }), h("div", { class: "grid2" }, cat.el, pri.el, who.el), button("Apply", null, "", { type: "submit" }))
        )
      );
    }

    out.appendChild(h("p", { class: "muted", text: plural(L.total, word()) + (p.query ? ' matching "' + p.query + '"' : "") }));
    const list = h("div", { class: "rows" });
    L.items.forEach((t) => list.appendChild(ticketRow(t, L.view !== "requested")));
    if (!L.items.length) list.appendChild(h("p", { class: "empty", text: p.query ? "Nothing matches that search." : "Nothing here right now." }));
    out.appendChild(list);

    if (L.pages > 1) {
      out.appendChild(
        h(
          "nav",
          { class: "pager", "aria-label": "Pages" },
          button("Previous", () => reload({ page: L.page - 1 }), "", { disabled: L.page <= 1 }),
          h("span", { text: "Page " + L.page + " of " + L.pages }),
          button("Next", () => reload({ page: L.page + 1 }), "", { disabled: L.page >= L.pages })
        )
      );
    }
    return out;
  };

  // --- One ticket ------------------------------------------------------------------

  screens.ticket = async (params) => {
    // A saved result and kept drafts are used once. Coming back to this screen later (Back from
    // Settings, Try again) reads the ticket fresh and starts with empty boxes.
    const d = params.detail || (await app.ask("get", { id: params.id }));
    delete params.detail;
    if (!d) return h("div", {}, button("Back", () => app.back()));
    const s = settings();
    const g = s.general;
    const t = d.ticket;
    const kind = statusKind(s, t.status);
    const team = isTeam();
    const out = h("div", { class: "stack" });
    const out_ = out;

    out.appendChild(
      h("div", {}, h("p", { class: "eyebrow" }, h("span", { class: "mono", text: t.id }), statusBadge(t.status), d.overdue ? badge("Overdue", "warn") : null), h("h1", { text: t.subject }))
    );
    const facts = [
      ["Priority", t.priority],
      ["Category", t.category],
      g.locationMode !== "off" && t.location ? [g.locationLabel, t.location] : null,
      ["From", t.requesterName + " (" + t.requesterEmail + ")"],
      ["Assigned to", personName(t.assignedTo)],
      ["Created", shortDate(t.createdAt)],
      t.dueAt ? ["Due", shortDate(t.dueAt)] : null,
      t.closedAt ? ["Finished", shortDate(t.closedAt)] : null,
    ].filter(Boolean);
    out.appendChild(h("dl", { class: "facts" }, facts.map((f) => [h("dt", { text: f[0] }), h("dd", { text: f[1] })])));
    out.appendChild(h("p", { class: "body", text: t.description }));

    if (d.messages.length) {
      out.appendChild(
        h(
          "section",
          { "aria-label": "Conversation" },
          h("h2", { text: "Conversation" }),
          d.messages.map((m) =>
            h(
              "div",
              { class: "msg " + (m.visibility === "internal" ? "internal" : m.role) },
              h("p", { class: "msg-head" }, h("strong", { text: m.byName || m.by }), " · " + shortDate(m.at), m.visibility === "internal" ? badge("Internal note", "note") : null),
              h("p", { class: "body", text: m.text })
            )
          )
        )
      );
    }

    const entry = app.top();
    const draft = params.draft || {};
    delete params.draft;
    /**
     * Text in the reply and note boxes that is not yet saved, to put back after a redraw: all of
     * a box that was not sent, and whatever was typed into a sent box while the save ran.
     */
    const unsent = (changes) => {
      const out = {};
      for (const name of ["reply", "note"]) {
        const el = out_.querySelector('[name="' + name + '"]');
        const now = el ? el.value : "";
        const sent = String(changes[name] || "");
        if (!now.trim() || now === sent) continue;
        out[name] = sent && now.startsWith(sent) ? now.slice(sent.length).replace(/^\s+/, "") : now;
        if (!out[name]) delete out[name];
      }
      return out;
    };
    const save = async (btn, changes, okText) =>
      busy(btn, async () => {
        const result = await app.ask("update", { id: t.id, expectedUpdatedAt: t.updatedAt, changes });
        if (!result) {
          // When someone else changed the ticket meanwhile, show the latest and keep every word typed.
          const fresh = await service.call("get", { id: t.id });
          if (fresh.ok && fresh.ticket.updatedAt !== t.updatedAt) await app.replaceIfTop(entry, "ticket", { id: t.id, detail: fresh, draft: unsent({}) });
          return;
        }
        app.toast(result.changed ? okText || "Saved." : "Nothing was changed.");
        const keep = unsent(changes);
        if (result.noteProblem && changes.note) {
          keep.note = changes.note;
          app.toast("The internal note could not be saved: " + result.noteProblem, "bad");
        }
        if (result.mailProblems && result.mailProblems.length) app.toast("An email notice could not be sent: " + result.mailProblems[0], "bad");
        await refreshBoot();
        // If the person went Back or opened something else while this was saving, leave them there.
        await app.replaceIfTop(entry, "ticket", { id: t.id, detail: result, draft: keep });
      });

    if (team) {
      const f = {
        status: field({ label: "Status", name: "status", type: "select", value: t.status, options: s.statuses.map((x) => x.name) }),
        assignedTo: field({ label: "Assigned to", name: "assignedTo", type: "select", value: t.assignedTo || "", options: [{ value: "", label: "Unassigned" }].concat(s.team.filter((m) => m.active || m.email === t.assignedTo).map((m) => ({ value: m.email, label: m.name || m.email }))) }),
        priority: field({ label: "Priority", name: "priority", type: "select", value: t.priority, options: s.priorities.map((x) => x.name) }),
        category: field({ label: "Category", name: "category", type: "select", value: t.category, options: s.categories.filter((c) => c.active || sameLabel(c.name, t.category)).map((c) => c.name) }),
        due: field({ label: "Due", name: "due", type: "datetime", value: toLocalInput(t.dueAt), hint: "Empty means no due time." }),
        reply: field({ label: "Reply to " + (t.requesterName || "the requester"), name: "reply", type: "textarea", rows: 4, max: LIMITS.message, value: draft.reply || "", hint: "Saved on the " + word() + " and emailed to them." }),
        note: field({ label: "Internal note", name: "note", type: "textarea", rows: 3, max: LIMITS.message, value: draft.note || "", hint: "Only the team can read this." }),
      };
      const dueBefore = toLocalInput(t.dueAt);
      const go = button("Save", () => {
        const changes = { status: f.status.get(), assignedTo: f.assignedTo.get(), priority: f.priority.get(), category: f.category.get(), reply: f.reply.get(), note: f.note.get() };
        // A half-typed date reads as empty; do not take that to mean "remove the due time".
        if (f.due.input.validity && f.due.input.validity.badInput) return app.toast("Finish typing the due date and time, or clear it.", "bad");
        if (f.due.get() !== dueBefore) {
          const iso = fromLocalInput(f.due.get());
          if (iso === null) return app.toast("The due time is not a date.", "bad");
          changes.dueAt = iso;
        }
        return save(go, changes);
      }, "primary");
      const mineBtn = !sameEmail(t.assignedTo, app.boot.user.email) && kind !== "done" ? button("Assign to me", () => save(mineBtn, { assignedTo: app.boot.user.email }, "Assigned to you."), "quiet") : null;
      out.appendChild(h("section", { class: "panel" }, h("h2", { text: "Work on this " + word() }), h("div", { class: "grid2" }, f.status.el, f.assignedTo.el, f.priority.el, f.category.el), f.due.el, f.reply.el, f.note.el, h("div", { class: "btn-row" }, go, mineBtn)));
      if (d.activity.length) {
        out.appendChild(
          h("details", { class: "activity" }, h("summary", { text: "Activity (" + d.activity.length + ")" }), h("ul", {}, d.activity.map((a) => h("li", {}, h("span", { class: "muted", text: shortDate(a.at) + " · " + a.by + " " }), a.text))))
        );
      }
    } else {
      const canReply = kind !== "done" || g.requesterCanReopen;
      const panel = h("section", { class: "panel" }, h("h2", { text: kind === "done" ? "Need more help with this?" : "Add to this " + word() }));
      if (canReply) {
        const reply = field({ label: kind === "done" ? "Reply to reopen" : "Reply", name: "reply", type: "textarea", rows: 4, max: LIMITS.message, value: draft.reply || "" });
        const go = button(kind === "done" ? "Send and reopen" : "Send reply", () => {
          if (!reply.get().trim()) return app.toast("Write a reply first.", "bad");
          return save(go, { reply: reply.get() }, "Sent.");
        }, "primary");
        panel.append(reply.el, go);
      } else {
        panel.appendChild(h("p", { text: "This " + word() + " is closed. Please send a new one if you need more help." }));
      }
      if (kind !== "done" && g.requesterCanClose) {
        // Anything typed in the reply box goes along as a last message.
        const close = button("I no longer need this", () => {
          const typed = panel.querySelector('[name="reply"]');
          return save(close, { close: true, reply: typed ? typed.value : "" }, "Closed. Thank you.");
        }, "quiet");
        panel.appendChild(close);
      }
      out.appendChild(panel);
    }
    return out;
  };

  // --- Demo outbox -------------------------------------------------------------------

  screens.outbox = async () => {
    const mail = host.demo ? host.demo.outbox() : [];
    const out = h("div", { class: "stack" }, h("h1", { text: "Email outbox" }), h("p", { class: "muted", text: "In the demo no email is sent. These are the messages a real help desk would have sent, newest first." }));
    if (!mail.length) out.appendChild(h("p", { class: "empty", text: "Nothing yet. Send a request or change one, then look here again." }));
    mail.forEach((m) => {
      const frame = h("iframe", { class: "mail-frame", sandbox: "", title: m.subject, loading: "lazy" });
      frame.srcdoc = m.html;
      out.appendChild(h("details", { class: "mail" }, h("summary", {}, h("strong", { text: m.subject }), h("span", { class: "muted", text: " To " + m.to.join(", ") })), frame));
    });
    return out;
  };

  screens.settings = (params) => settingsScreen(app, params);

  // The menu closes on Escape and when something outside it is pressed.
  const closeMenu = (refocus) => {
    const menu = bar.querySelector("details.menu[open]");
    if (!menu) return;
    menu.removeAttribute("open");
    if (refocus) menu.querySelector("summary").focus();
  };
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu(true);
  });
  document.addEventListener("click", (e) => {
    const menu = bar.querySelector("details.menu[open]");
    if (menu && !menu.contains(e.target)) closeMenu(false);
  });
  // Another theme control on the page changed the theme: show the new choice in the menu.
  document.addEventListener("helpdesk-theme", () => drawBar());

  // --- Start ---------------------------------------------------------------------

  app.stack = [{ name: "home", params: {} }];
  app.ready = render();
  return app;
}
