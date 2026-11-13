/**
 * Verlass for Gmail: the cards people see in the Gmail side panel.
 *
 * Cards never touch the spreadsheet. They ask the help desk through Api.call and draw what
 * comes back. Every piece of text a person typed is escaped before it is shown.
 */

var Cards = (function () {
  // Core is looked up when a card is drawn, so the order of the project's files never matters.
  function esc(value) {
    return Core.escapeText(value);
  }

  function accent_(settings) {
    return Core.buttonColor((settings && settings.general && settings.general.accentColor) || "#2F4F40");
  }

  function header_(settings, subtitle) {
    var g = settings.general;
    var h = CardService.newCardHeader().setTitle(g.deskName);
    var sub = subtitle || g.orgName;
    if (sub) h.setSubtitle(sub);
    if (g.logoUrl) h.setImageUrl(g.logoUrl).setImageStyle(CardService.ImageStyle.SQUARE);
    return h;
  }

  function word_(settings, capital) {
    var w = settings.general.ticketWord;
    return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }

  /**
   * The person's role, the settings, and the counts. When the Time zone setting is empty, the
   * help desk's own zone is filled in, so cards show and read times the way the service does.
   */
  function prepare_(boot) {
    if (boot && boot.ready && boot.settings && boot.settings.general && !boot.settings.general.timeZone && boot.zone) boot.settings.general.timeZone = boot.zone;
    return boot;
  }

  function boot_() {
    return prepare_(Ui.need(Api.call("boot", {})));
  }

  function memberName_(settings, email) {
    if (!email) return "Unassigned";
    var m = (settings.team || []).filter(function (t) { return t.email === email; })[0];
    return (m && m.name) || email;
  }

  // --- Home --------------------------------------------------------------------

  function setupCard_(boot) {
    var section = CardService.newCardSection();
    if (!boot.canSetup) {
      section.addWidget(CardService.newTextParagraph().setText("This help desk has not been set up yet. Its owner needs to open Verlass first."));
      return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle("Verlass")).addSection(section).build();
    }
    section.addWidget(CardService.newTextParagraph().setText("Welcome. Verlass will create one Google Sheet in your Drive to hold the tickets and settings, and make you the first administrator. Everything can be changed later."));
    section.addWidget(CardService.newTextInput().setFieldName("orgName").setTitle("Organization name").setHint("Shown in the header and in email"));
    var preset = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("preset").setTitle("Start with lists for");
    Core.PRESETS.forEach(function (p, i) { preset.addItem(p.name, p.id, i === 0); });
    section.addWidget(preset);
    section.addWidget(Ui.filled("Create the help desk", "uiSetup"));
    return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle("Verlass").setSubtitle("Set up your help desk")).addSection(section).build();
  }

  function hasMessage_(e) {
    return !!(e && e.gmail && e.gmail.messageId && e.gmail.accessToken);
  }

  function home(e, bootIn) {
    var boot = bootIn ? prepare_(bootIn) : boot_();
    if (!boot.ready) return setupCard_(boot);
    var s = boot.settings;
    var color = accent_(s);
    var isTeam = boot.role !== "requester";
    var card = CardService.newCardBuilder().setHeader(header_(s));

    var mine = CardService.newCardSection();
    mine.addWidget(Ui.filled("New " + word_(s), "uiNewForm", null, color));
    if (hasMessage_(e)) mine.addWidget(Ui.button("Create from this email", "uiNewForm", { fromMessage: "1" }));
    var openCount = boot.stats.requestedOpen || 0;
    mine.addWidget(
      CardService.newDecoratedText()
        .setTopLabel("My " + word_(s) + "s")
        .setText(openCount ? openCount + " open" : "None open")
        .setButton(Ui.button("View", "uiList", { view: "requested" }))
    );
    card.addSection(mine);

    if (isTeam) {
      var queue = CardService.newCardSection().setHeader("Team queues");
      var st = boot.stats;
      [
        ["open", "Open", st.open],
        ["unassigned", "Unassigned", st.unassigned],
        ["mine", "Assigned to me", st.mine],
        ["overdue", "Overdue", st.overdue],
        ["waiting", "Waiting", st.waiting],
        ["done", "Finished", st.done],
        ["all", "All", st.total],
      ].forEach(function (row) {
        queue.addWidget(CardService.newDecoratedText().setTopLabel(row[1]).setText(String(row[2])).setButton(Ui.button("View", "uiList", { view: row[0] })));
      });
      card.addSection(queue);

      var search = CardService.newCardSection().setHeader("Find");
      search.addWidget(CardService.newTextInput().setFieldName("query").setTitle("Number, name, or words"));
      search.addWidget(Ui.button("Search", "uiList", { view: "all", search: "1" }));
      card.addSection(search);
    }

    if (boot.role === "admin") {
      var admin = CardService.newCardSection().setHeader("Administration");
      if (boot.warnings && boot.warnings.length) {
        admin.addWidget(CardService.newTextParagraph().setText("<b>To review:</b><br>" + boot.warnings.slice(0, 5).map(esc).join("<br>")));
      }
      admin.addWidget(Ui.button("Settings", "uiSettings"));
      card.addSection(admin);
    }
    return card.build();
  }

  // --- New ticket ----------------------------------------------------------------

  /** Reads the open Gmail message, when the manifest allows it. Returns null otherwise. */
  function currentMessage_(e) {
    if (!hasMessage_(e)) return null;
    try {
      GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
      var message = GmailApp.getMessageById(e.gmail.messageId);
      var from = String(message.getFrom() || "");
      var match = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from);
      return {
        subject: String(message.getSubject() || "").replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, ""),
        body: String(message.getPlainBody() || "").slice(0, Core.LIMITS.description),
        fromEmail: Core.normalizeEmail(match ? match[2] : from),
        fromName: match ? match[1].trim() : "",
      };
    } catch (err) {
      return null;
    }
  }

  function formCard(e, boot, values, problems) {
    var s = boot.settings;
    var g = s.general;
    var v = values || {};
    var isTeam = boot.role !== "requester";
    var section = CardService.newCardSection();
    if (problems && problems.length) section.addWidget(CardService.newTextParagraph().setText("<b>Please check:</b><br>" + problems.map(esc).join("<br>")));

    section.addWidget(CardService.newTextInput().setFieldName("subject").setTitle("Subject").setHint("A short summary").setValue(v.subject || ""));

    var category = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("category").setTitle("Category");
    s.categories.filter(function (c) { return c.active !== false; }).forEach(function (c, i) {
      category.addItem(c.name, c.name, v.category ? Core.sameLabel(v.category, c.name) : i === 0);
    });
    section.addWidget(category);

    if (isTeam || g.requesterSetsPriority) {
      var priority = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("priority").setTitle("Priority");
      // The first choice leaves the priority to the category, or to the default.
      priority.addItem("Standard for the category", "", !v.priority);
      s.priorities.forEach(function (p) {
        priority.addItem(p.hint ? p.name + ": " + p.hint : p.name, p.name, !!v.priority && Core.sameLabel(v.priority, p.name));
      });
      section.addWidget(priority);
    }

    if (g.locationMode === "list" && s.locations.length) {
      var location = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("location").setTitle(g.locationLabel);
      if (!g.locationRequired) location.addItem("Not applicable", "", !v.location);
      s.locations.forEach(function (l, i) {
        location.addItem(l, l, v.location ? Core.sameLabel(v.location, l) : g.locationRequired && i === 0);
      });
      section.addWidget(location);
    } else if (g.locationMode !== "off") {
      section.addWidget(CardService.newTextInput().setFieldName("location").setTitle(g.locationLabel).setValue(v.location || ""));
    }

    section.addWidget(
      CardService.newTextInput().setFieldName("description").setTitle("Description").setHint("What happened, what you expected, and any error message").setMultiline(true).setValue(v.description || "")
    );

    if (isTeam) {
      section.addWidget(CardService.newTextInput().setFieldName("requesterEmail").setTitle("Requester email").setHint("Leave empty when the " + g.ticketWord + " is your own").setValue(v.requesterEmail || ""));
      section.addWidget(CardService.newTextInput().setFieldName("requesterName").setTitle("Requester name").setValue(v.requesterName || ""));
    }
    section.addWidget(Ui.filled("Send " + g.ticketWord, "uiCreate", { source: v.source || "gmail" }, accent_(s)));
    return CardService.newCardBuilder().setHeader(header_(s, "New " + g.ticketWord)).addSection(section).build();
  }

  function newForm(e) {
    var boot = boot_();
    var values = {};
    if (Ui.params(e).fromMessage) {
      var message = currentMessage_(e);
      if (!message) throw new Error("This email could not be read. The add-on needs the current message permission described in the install guide.");
      values.subject = message.subject.slice(0, Core.LIMITS.subject);
      values.description = message.body;
      values.source = "email";
      if (boot.role !== "requester" && message.fromEmail && !Core.sameEmail(message.fromEmail, boot.user.email)) {
        values.requesterEmail = message.fromEmail;
        values.requesterName = message.fromName;
      }
    }
    return formCard(e, boot, values, null);
  }

  function readForm_(e) {
    return {
      subject: Ui.field(e, "subject"),
      category: Ui.field(e, "category"),
      priority: Ui.field(e, "priority"),
      location: Ui.field(e, "location"),
      description: Ui.field(e, "description"),
      requesterEmail: Ui.field(e, "requesterEmail"),
      requesterName: Ui.field(e, "requesterName"),
      source: Ui.params(e).source || "gmail",
    };
  }

  function create(e) {
    var values = readForm_(e);
    var sent = {};
    Object.keys(values).forEach(function (k) { sent[k] = values[k]; });
    sent.withBoot = true;
    var result = Api.call("create", sent);
    var boot = result.boot ? prepare_(result.boot) : boot_();
    if (!result.ok) {
      return Ui.replace(formCard(e, boot, values, result.errors || ["The " + boot.settings.general.ticketWord + " could not be sent."]));
    }
    var card = detailCard(result.ticket.id, boot, result);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popToRoot().updateCard(home(e, boot)).pushCard(card))
      .setNotification(CardService.newNotification().setText(result.ticket.id + " was sent."))
      .build();
  }

  // --- Lists -------------------------------------------------------------------

  function listCard(e) {
    var p = Ui.params(e);
    var query = p.search ? Ui.field(e, "query") : p.query || "";
    var view = p.view || "open";
    var answer = Ui.need(Api.call("list", { view: view, query: query, page: Number(p.page) || 1, withBoot: true }));
    var boot = prepare_(answer.boot);
    var s = boot.settings;
    var result = answer.list;
    var viewDef = Core.TEAM_VIEWS.filter(function (v) { return v.id === result.view; })[0];
    var title = result.view === "requested" ? "My " + s.general.ticketWord + "s" : viewDef ? viewDef.label : "All";
    var subtitle = Core.plural(result.total, s.general.ticketWord) + (query ? ' matching "' + query + '"' : "");
    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle(title).setSubtitle(subtitle));

    var section = CardService.newCardSection();
    if (!result.items.length) {
      section.addWidget(CardService.newTextParagraph().setText(query ? "Nothing matches that search." : "Nothing here right now."));
    }
    result.items.forEach(function (t) {
      var top = t.id + " · " + t.priority + (t.overdue ? " · Overdue" : "");
      var bottom = t.status + " · " + (result.view === "requested" ? "Updated " + Ui.when(t.updatedAt, s) : t.requesterName + " · " + memberName_(s, t.assignedTo));
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel(top)
          .setText(esc(t.subject))
          .setBottomLabel(bottom)
          .setWrapText(true)
          .setOnClickAction(CardService.newAction().setFunctionName("uiTicket").setParameters({ id: t.id }))
      );
    });
    card.addSection(section);

    if (result.pages > 1) {
      var pager = CardService.newButtonSet();
      if (result.page > 1) pager.addButton(Ui.button("Previous", "uiListPage", { view: view, query: query, page: String(result.page - 1) }));
      if (result.page < result.pages) pager.addButton(Ui.button("Next", "uiListPage", { view: view, query: query, page: String(result.page + 1) }));
      card.addSection(CardService.newCardSection().addWidget(CardService.newTextParagraph().setText("Page " + result.page + " of " + result.pages)).addWidget(pager));
    }
    return card.build();
  }

  // --- One ticket ----------------------------------------------------------------

  function messageWidgets_(section, messages, settings) {
    var shown = messages.slice(-20);
    if (messages.length > shown.length) section.addWidget(CardService.newTextParagraph().setText("Showing the latest " + shown.length + " of " + messages.length + " messages."));
    shown.forEach(function (m) {
      var who = (m.byName || m.by) + " · " + Ui.when(m.at, settings) + (m.visibility === "internal" ? " · Internal note" : "");
      section.addWidget(CardService.newDecoratedText().setTopLabel(who).setText(Core.htmlLines(m.text.length > 1500 ? m.text.slice(0, 1500) + " ..." : m.text)).setWrapText(true));
    });
  }

  function detailCard(id, bootIn, detailIn) {
    var d = detailIn || Ui.need(Api.call("get", { id: id, withBoot: !bootIn }));
    var boot = prepare_(bootIn || d.boot);
    var s = boot.settings;
    var g = s.general;
    var t = d.ticket;
    var isTeam = boot.role !== "requester";
    var kind = Core.statusKind(s, t.status);
    var color = accent_(s);
    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle(t.id).setSubtitle(t.subject));

    var info = CardService.newCardSection();
    info.addWidget(CardService.newDecoratedText().setTopLabel("Status").setText(esc(t.status) + (d.overdue ? " · <b>Overdue</b>" : "")));
    info.addWidget(CardService.newDecoratedText().setTopLabel("Priority and category").setText(esc(t.priority + " · " + t.category)).setWrapText(true));
    if (g.locationMode !== "off" && t.location) info.addWidget(CardService.newDecoratedText().setTopLabel(g.locationLabel).setText(esc(t.location)));
    info.addWidget(CardService.newDecoratedText().setTopLabel("From").setText(esc(t.requesterName + " (" + t.requesterEmail + ")")).setWrapText(true));
    info.addWidget(CardService.newDecoratedText().setTopLabel("Assigned to").setText(esc(memberName_(s, t.assignedTo))));
    info.addWidget(CardService.newDecoratedText().setTopLabel("Created").setText(Ui.when(t.createdAt, s) + (t.dueAt ? " · Due " + Ui.when(t.dueAt, s) : "")).setWrapText(true));
    info.addWidget(CardService.newTextParagraph().setText(Core.htmlLines(t.description)));
    card.addSection(info);

    if (d.messages.length) {
      var talk = CardService.newCardSection().setHeader("Conversation");
      messageWidgets_(talk, d.messages, s);
      card.addSection(talk);
    }

    var act = CardService.newCardSection();
    var stamp = { id: t.id, expected: t.updatedAt || "" };
    if (isTeam) {
      act.setHeader("Work on this " + g.ticketWord);
      var status = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("status").setTitle("Status");
      var names = s.statuses.map(function (x) { return x.name; });
      if (!names.some(function (n) { return Core.sameLabel(n, t.status); })) names.unshift(t.status);
      names.forEach(function (n) { status.addItem(n, n, Core.sameLabel(n, t.status)); });
      act.addWidget(status);

      var assignee = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("assignedTo").setTitle("Assigned to");
      assignee.addItem("Unassigned", "", !t.assignedTo);
      var people = s.team.filter(function (m) { return m.active; });
      if (t.assignedTo && !people.some(function (m) { return m.email === t.assignedTo; })) people = people.concat([{ email: t.assignedTo, name: "" }]);
      people.forEach(function (m) { assignee.addItem(m.name ? m.name + " (" + m.email + ")" : m.email, m.email, m.email === t.assignedTo); });
      act.addWidget(assignee);

      var priority = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("priority").setTitle("Priority");
      var priorities = s.priorities.map(function (x) { return x.name; });
      if (!priorities.some(function (n) { return Core.sameLabel(n, t.priority); })) priorities.unshift(t.priority);
      priorities.forEach(function (n) { priority.addItem(n, n, Core.sameLabel(n, t.priority)); });
      act.addWidget(priority);

      var category = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName("category").setTitle("Category");
      var categories = s.categories.filter(function (c) { return c.active || Core.sameLabel(c.name, t.category); }).map(function (c) { return c.name; });
      if (!categories.some(function (n) { return Core.sameLabel(n, t.category); })) categories.unshift(t.category);
      categories.forEach(function (n) { category.addItem(n, n, Core.sameLabel(n, t.category)); });
      act.addWidget(category);

      act.addWidget(CardService.newTextInput().setFieldName("due").setTitle("Due").setHint("YYYY-MM-DD HH:MM, or empty for no due time").setValue(Ui.stamp(t.dueAt, s)));
      act.addWidget(CardService.newTextInput().setFieldName("reply").setTitle("Reply to " + (t.requesterName || "the requester")).setHint("Saved on the " + g.ticketWord + " and emailed to them").setMultiline(true));
      act.addWidget(CardService.newTextInput().setFieldName("note").setTitle("Internal note").setHint("Only the team can read this").setMultiline(true));
      stamp.due = Ui.stamp(t.dueAt, s);
      act.addWidget(Ui.filled("Save", "uiUpdate", stamp, color));
    } else {
      act.setHeader(kind === "done" ? "Need more help with this?" : "Add to this " + g.ticketWord);
      var canReply = kind !== "done" || g.requesterCanReopen;
      if (canReply) {
        act.addWidget(CardService.newTextInput().setFieldName("reply").setTitle(kind === "done" ? "Reply to reopen" : "Reply").setMultiline(true));
        act.addWidget(Ui.filled(kind === "done" ? "Send and reopen" : "Send reply", "uiUpdate", stamp, color));
      } else {
        act.addWidget(CardService.newTextParagraph().setText("This " + g.ticketWord + " is closed. Please send a new one if you need more help."));
      }
      if (kind !== "done" && g.requesterCanClose) {
        var close = { id: t.id, expected: t.updatedAt || "", close: "1" };
        act.addWidget(Ui.button("I no longer need this", "uiUpdate", close));
      }
    }
    card.addSection(act);

    if (isTeam && d.activity.length) {
      var log = CardService.newCardSection().setHeader("Activity").setCollapsible(true).setNumUncollapsibleWidgets(0);
      d.activity.slice(-15).forEach(function (a) {
        log.addWidget(CardService.newDecoratedText().setTopLabel(Ui.when(a.at, s) + " · " + a.by).setText(esc(a.text)).setWrapText(true));
      });
      card.addSection(log);
    }
    return card.build();
  }

  function update(e) {
    var p = Ui.params(e);
    var boot = boot_();
    var s = boot.settings;
    var changes = {};
    if (boot.role !== "requester") {
      changes.status = Ui.field(e, "status");
      changes.assignedTo = Ui.field(e, "assignedTo");
      changes.priority = Ui.field(e, "priority");
      changes.category = Ui.field(e, "category");
      var due = Ui.field(e, "due").trim();
      if (due !== String(p.due || "")) {
        var iso = Ui.parseStamp(due, s);
        if (iso === null) return Ui.notify("Write the due time as YYYY-MM-DD HH:MM, for example 2026-11-20 15:00.");
        changes.dueAt = iso;
      }
      changes.note = Ui.field(e, "note");
    }
    changes.reply = Ui.field(e, "reply");
    if (p.close) changes.close = true;
    if (boot.role === "requester" && !p.close && !changes.reply.trim()) return Ui.notify("Write a reply first.");

    var result = Api.call("update", { id: p.id, expectedUpdatedAt: p.expected || "", changes: changes });
    if (!result.ok) return Ui.notify((result.errors || ["The change could not be saved."]).join(" "));
    return Ui.replace(detailCard(p.id, boot, result), result.changed ? "Saved." : "Nothing was changed.");
  }

  return { home: home, newForm: newForm, create: create, listCard: listCard, detailCard: detailCard, update: update };
})();

// --- Button handlers. Apps Script calls these by name. ----------------------------

function uiHome(e) {
  return Ui.action(function () {
    return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().popToRoot().updateCard(Cards.home(e))).build();
  });
}

function uiSetup(e) {
  return Ui.action(function () {
    var boot = Ui.need(Api.call("setup", { preset: Ui.field(e, "preset") || "office", orgName: Ui.field(e, "orgName") }));
    return Ui.replace(Cards.home(e, boot), "Your help desk is ready.");
  });
}

function uiNewForm(e) {
  return Ui.action(function () {
    return Ui.push(Cards.newForm(e));
  });
}

function uiCreate(e) {
  return Ui.action(function () {
    return Cards.create(e);
  });
}

function uiList(e) {
  return Ui.action(function () {
    return Ui.push(Cards.listCard(e));
  });
}

function uiListPage(e) {
  return Ui.action(function () {
    return Ui.replace(Cards.listCard(e));
  });
}

function uiTicket(e) {
  return Ui.action(function () {
    return Ui.push(Cards.detailCard(Ui.params(e).id));
  });
}

function uiUpdate(e) {
  return Ui.action(function () {
    return Cards.update(e);
  });
}
