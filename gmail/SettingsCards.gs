/**
 * Verlass for Gmail: the settings cards, for administrators.
 *
 * Every setting can be changed here without touching code. The same settings are also rows
 * in the help desk's spreadsheet, for people who would rather edit a table.
 */

var SettingsCards = (function () {
  // Core is looked up when a card is drawn, so the order of the project's files never matters.
  function esc(value) {
    return Core.escapeText(value);
  }

  function groups_() {
    var seen = [];
    Core.GENERAL_FIELDS.forEach(function (f) {
      if (seen.indexOf(f.group) === -1) seen.push(f.group);
    });
    return seen;
  }

  function load_() {
    return Ui.need(Api.call("settingsGet", {}));
  }

  function menu(dataIn) {
    var data = dataIn || load_();
    var s = data.settings;
    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle("Settings").setSubtitle(s.general.deskName));

    if (data.warnings && data.warnings.length) {
      card.addSection(CardService.newCardSection().setHeader("To review").addWidget(CardService.newTextParagraph().setText(data.warnings.slice(0, 8).map(esc).join("<br>"))));
    }

    var general = CardService.newCardSection().setHeader("General");
    groups_().forEach(function (group) {
      var count = Core.GENERAL_FIELDS.filter(function (f) { return f.group === group; }).length;
      general.addWidget(CardService.newDecoratedText().setText(group).setBottomLabel(Core.plural(count, "setting")).setButton(Ui.button("Edit", "uiSettingsGroup", { group: group })));
    });
    card.addSection(general);

    var lists = CardService.newCardSection().setHeader("Lists");
    Core.LISTS.forEach(function (list) {
      var count = (s[list.id] || []).length;
      lists.addWidget(CardService.newDecoratedText().setText(list.title).setBottomLabel(Core.plural(count, "item")).setButton(Ui.button("Edit", "uiSettingsList", { list: list.id })));
    });
    card.addSection(lists);

    var mail = CardService.newCardSection().setHeader("Email wording").setCollapsible(true).setNumUncollapsibleWidgets(0);
    Core.TEMPLATE_KEYS.forEach(function (key) {
      mail.addWidget(CardService.newDecoratedText().setTopLabel(key).setText(Core.TEMPLATE_INFO[key]).setWrapText(true).setButton(Ui.button("Edit", "uiSettingsTemplate", { key: key })));
    });
    card.addSection(mail);

    if (data.sheetUrl) {
      card.addSection(
        CardService.newCardSection()
          .setHeader("Spreadsheet")
          .addWidget(CardService.newTextParagraph().setText("Tickets and settings are rows in one Google Sheet. Changes made there show up here within five minutes."))
          .addWidget(CardService.newTextButton().setText("Open the spreadsheet").setOpenLink(CardService.newOpenLink().setUrl(data.sheetUrl)))
      );
    }
    return card.build();
  }

  function groupCard(group) {
    var s = load_().settings;
    var section = CardService.newCardSection();
    Core.GENERAL_FIELDS.filter(function (f) { return f.group === group; }).forEach(function (f) {
      var value = s.general[f.key];
      if (f.type === "bool") {
        section.addWidget(CardService.newSelectionInput().setType(CardService.SelectionInputType.SWITCH).setFieldName(f.key).addItem(f.label, "yes", value === true));
      } else if (f.type === "choice") {
        var input = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN).setFieldName(f.key).setTitle(f.label);
        f.options.forEach(function (o) { input.addItem(o, o, o === value); });
        section.addWidget(input);
      } else {
        var text = CardService.newTextInput().setFieldName(f.key).setTitle(f.label).setValue(String(value === undefined || value === null ? "" : value));
        if (f.type !== "choice" && f.help) text.setHint(f.help);
        section.addWidget(text);
      }
      if ((f.type === "bool" || f.type === "choice") && f.help) section.addWidget(CardService.newTextParagraph().setText("<font color=\"#56635B\">" + esc(f.help) + "</font>"));
    });
    section.addWidget(Ui.filled("Save", "uiSettingsSaveGroup", { group: group }, Core.buttonColor(s.general.accentColor)));
    return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle(group).setSubtitle("Settings")).addSection(section).build();
  }

  function saveGroup(e) {
    var group = Ui.params(e).group;
    var general = {};
    Core.GENERAL_FIELDS.filter(function (f) { return f.group === group; }).forEach(function (f) {
      general[f.key] = f.type === "bool" ? Ui.isOn(e, f.key) : Ui.field(e, f.key);
    });
    return done_(Ui.need(Api.call("settingsSave", { general: general })));
  }

  function listCard(id) {
    var s = load_().settings;
    var list = Core.listById(id);
    if (!list) throw new Error("Unknown list.");
    var section = CardService.newCardSection();
    section.addWidget(CardService.newTextParagraph().setText(esc(list.help) + "<br><br>One item per line. Separate the columns with a vertical bar:<br><b>" + esc(Core.listFormat(id)) + "</b>"));
    section.addWidget(CardService.newTextInput().setFieldName("items").setTitle(list.title).setMultiline(true).setValue(Core.listToText(s, id)));
    section.addWidget(Ui.filled("Save", "uiSettingsSaveList", { list: id }, Core.buttonColor(s.general.accentColor)));
    return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle(list.title).setSubtitle("Settings")).addSection(section).build();
  }

  function saveList(e) {
    var id = Ui.params(e).list;
    if (!Core.listById(id)) throw new Error("Unknown list.");
    var lists = {};
    lists[id] = Core.textToList(id, Ui.field(e, "items"));
    // An item without its required column would be dropped, so say so instead of losing it.
    var problem = Core.incompleteItem(id, lists[id]);
    if (problem) return Ui.notify(problem);
    return done_(Ui.need(Api.call("settingsSave", { lists: lists })));
  }

  function templateCard(key) {
    var s = load_().settings;
    if (Core.TEMPLATE_KEYS.indexOf(key) === -1) throw new Error("Unknown email.");
    var t = s.templates[key];
    var section = CardService.newCardSection();
    section.addWidget(CardService.newTextParagraph().setText(esc(Core.TEMPLATE_INFO[key]) + ". The ticket's details are added under your text automatically."));
    section.addWidget(CardService.newTextInput().setFieldName("subject").setTitle("Subject").setValue(t.subject));
    section.addWidget(CardService.newTextInput().setFieldName("body").setTitle("Body").setMultiline(true).setValue(t.body));
    section.addWidget(CardService.newTextParagraph().setText("<b>Placeholders:</b> " + Core.PLACEHOLDERS.map(function (p) { return "{{" + p + "}}"; }).join(", ")));
    section.addWidget(
      CardService.newButtonSet()
        .addButton(Ui.filled("Save", "uiSettingsSaveTemplate", { key: key }, Core.buttonColor(s.general.accentColor)))
        .addButton(Ui.button("Use the original wording", "uiSettingsSaveTemplate", { key: key, reset: "1" }))
    );
    return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle("Email wording").setSubtitle("Settings")).addSection(section).build();
  }

  function saveTemplate(e) {
    var p = Ui.params(e);
    if (Core.TEMPLATE_KEYS.indexOf(p.key) === -1) throw new Error("Unknown email.");
    var templates = {};
    templates[p.key] = p.reset ? { subject: "", body: "" } : { subject: Ui.field(e, "subject"), body: Ui.field(e, "body") };
    return done_(Ui.need(Api.call("settingsSave", { templates: templates })));
  }

  /** After a save: go back to the settings menu and show it with the new values. */
  function done_(result) {
    var text = "Saved.";
    if (result.adjusted && result.adjusted.length) text += " Corrected because the value could not be used: " + result.adjusted.join(", ") + ".";
    if (result.renamedTickets) text += " Renamed on " + Core.plural(result.renamedTickets, "ticket") + ".";
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().popCard().updateCard(menu(result)))
      .setNotification(CardService.newNotification().setText(text.slice(0, 300)))
      .build();
  }

  return { menu: menu, groupCard: groupCard, saveGroup: saveGroup, listCard: listCard, saveList: saveList, templateCard: templateCard, saveTemplate: saveTemplate };
})();

function uiSettings(e) {
  return Ui.action(function () {
    return Ui.push(SettingsCards.menu());
  });
}

function uiSettingsGroup(e) {
  return Ui.action(function () {
    return Ui.push(SettingsCards.groupCard(Ui.params(e).group));
  });
}

function uiSettingsSaveGroup(e) {
  return Ui.action(function () {
    return SettingsCards.saveGroup(e);
  });
}

function uiSettingsList(e) {
  return Ui.action(function () {
    return Ui.push(SettingsCards.listCard(Ui.params(e).list));
  });
}

function uiSettingsSaveList(e) {
  return Ui.action(function () {
    return SettingsCards.saveList(e);
  });
}

function uiSettingsTemplate(e) {
  return Ui.action(function () {
    return Ui.push(SettingsCards.templateCard(Ui.params(e).key));
  });
}

function uiSettingsSaveTemplate(e) {
  return Ui.action(function () {
    return SettingsCards.saveTemplate(e);
  });
}
