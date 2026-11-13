/**
 * Verlass for Gmail: storage.
 *
 * Everything the help desk knows lives in one Google Sheet: tickets, messages, the activity
 * log, and every setting. This file is the only one that reads or writes that Sheet.
 * The shared rules (what a valid ticket is, who gets it, when it is due) are in Core.gs.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */

var Store = (function () {
  var TABS = {
    tickets: { name: "Tickets", headers: ["Ticket", "Created", "Updated", "Requester email", "Requester name", "Subject", "Description", "Category", "Priority", "Location", "Status", "Assigned to", "Due", "Closed", "Source"], widths: [90, 180, 180, 210, 150, 260, 380] },
    messages: { name: "Messages", headers: ["Ticket", "Time", "From", "Name", "Role", "Visibility", "Message"] },
    activity: { name: "Activity", headers: ["Time", "Ticket", "By", "What happened"] },
    settings: { name: "Settings", headers: ["Setting", "Value", "About this setting"], widths: [330, 260] },
    templates: { name: "Email wording", headers: ["Email", "Subject", "Body", "When it is sent"] },
  };
  var TICKET_COLS = TABS.tickets.headers.length;
  var PROP_SHEET = "SPREADSHEET_ID";
  var PROP_RR = "ROUND_ROBIN_INDEX";
  var CACHE_SETTINGS = "helpdesk.settings.v1";

  var book_ = null;

  function props_() {
    return PropertiesService.getScriptProperties();
  }

  function exists() {
    return !!props_().getProperty(PROP_SHEET);
  }

  function book() {
    if (book_) return book_;
    var id = props_().getProperty(PROP_SHEET);
    if (!id) throw new Error("The help desk has not been set up yet.");
    book_ = SpreadsheetApp.openById(id);
    return book_;
  }

  function url() {
    return exists() ? book().getUrl() : "";
  }

  function listTab_(list) {
    return { name: list.title, headers: list.columns.map(function (c) { return c.label; }) };
  }

  /** Returns a tab, creating it with its header row when it is missing. */
  function tab_(def) {
    var sheet = book().getSheetByName(def.name);
    if (sheet) return sheet;
    sheet = book().insertSheet(def.name);
    formatTab_(sheet, def);
    return sheet;
  }

  function formatTab_(sheet, def) {
    var n = def.headers.length;
    sheet.getRange(1, 1, 1, n).setValues([def.headers]).setFontWeight("bold").setBackground("#2F4F40").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    // Plain text format keeps "0042" or "3/4" exactly as typed and stops Sheets from guessing.
    sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), n).setNumberFormat("@").setVerticalAlignment("top");
    // Column widths are only for people reading the Sheet. Each one is a separate request, so
    // they are set on the tabs people read most and skipped on the rest to keep setup quick.
    (def.widths || []).forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  }

  function readRows_(sheet, columns) {
    var last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, 1, last - 1, columns).getValues();
  }

  /**
   * Adds rows under the last row that has content. The new cells are set to plain text first,
   * so Sheets keeps every value exactly as written, and the tab grows when it is full.
   */
  function appendRows_(sheet, rows, columns) {
    if (!rows.length) return;
    var start = sheet.getLastRow() + 1;
    var needed = start + rows.length - 1;
    var max = sheet.getMaxRows();
    if (needed > max) sheet.insertRowsAfter(max, needed - max + 200);
    sheet.getRange(start, 1, rows.length, columns).setNumberFormat("@").setValues(rows.map(safeRow_));
  }

  function safeRow_(row) {
    return row.map(function (v) { return Core.sheetSafe(v); });
  }

  function text_(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    return Core.sheetRead(String(v));
  }

  function iso_(v) {
    if (v === "" || v === null || v === undefined) return "";
    return Core.toIso(v instanceof Date ? v : String(v));
  }

  // --- Setup -----------------------------------------------------------------

  /**
   * Creates the help desk's spreadsheet with every tab, fills it from a preset, and makes
   * the person running it the first administrator. Returns the spreadsheet's address.
   */
  function create(presetId, owner, orgName) {
    if (exists()) throw new Error("The help desk is already set up.");
    var settings = Core.defaultSettings(presetId);
    settings.general.orgName = Core.cleanLine(orgName, 80);
    var email = Core.normalizeEmail(owner && owner.email);
    if (email) settings.team.push({ email: email, name: Core.cleanLine(owner.name, 80) || Core.nameFromEmail(email), role: "admin", active: true });
    // Fix the time zone now, so due times and typed times mean the same thing for everyone.
    settings.general.timeZone = Session.getScriptTimeZone();
    settings = Core.normalizeSettings(settings);

    var title = (settings.general.orgName ? settings.general.orgName + " " : "") + settings.general.deskName + " (Verlass)";
    var ss = SpreadsheetApp.create(title);
    book_ = ss;
    var first = ss.getSheets()[0];
    first.setName(TABS.tickets.name);
    formatTab_(first, TABS.tickets);
    tab_(TABS.messages);
    tab_(TABS.activity);
    saveSettings(settings);
    // Only now is the help desk recorded as set up. If anything above was cut short, setup can
    // simply be run again (an unfinished spreadsheet may be left in Drive and can be deleted).
    SpreadsheetApp.flush();
    props_().setProperty(PROP_SHEET, ss.getId());
    return ss.getUrl();
  }

  // --- Settings --------------------------------------------------------------

  function readSettings_() {
    var raw = { general: {}, templates: {} };
    var byLabel = {};
    Core.GENERAL_FIELDS.forEach(function (f) { byLabel[f.label.toLowerCase()] = f.key; });
    readRows_(tab_(TABS.settings), 2).forEach(function (row) {
      var key = byLabel[text_(row[0]).trim().toLowerCase()];
      if (key) raw.general[key] = row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), "HH:mm") : text_(row[1]);
    });
    Core.LISTS.forEach(function (list) {
      var rows = readRows_(tab_(listTab_(list)), list.columns.length).map(function (row) { return row.map(text_); });
      raw[list.id] = Core.rowsToList(list.id, rows);
    });
    readRows_(tab_(TABS.templates), 3).forEach(function (row) {
      var key = text_(row[0]).trim();
      if (Core.TEMPLATE_KEYS.indexOf(key) !== -1) raw.templates[key] = { subject: text_(row[1]), body: text_(row[2]) };
    });
    return Core.normalizeSettings(raw);
  }

  /** The settings, from a five-minute cache when possible. Pass true to read the Sheet again. */
  function loadSettings(fresh) {
    var cache = CacheService.getScriptCache();
    if (!fresh) {
      var hit = cache.get(CACHE_SETTINGS);
      if (hit) {
        try {
          return Core.normalizeSettings(JSON.parse(hit));
        } catch (e) {
          // Fall through and read the Sheet.
        }
      }
    }
    var settings = readSettings_();
    var json = JSON.stringify(settings);
    if (json.length < 90000) cache.put(CACHE_SETTINGS, json, 300);
    return settings;
  }

  function writeTab_(def, rows) {
    var sheet = tab_(def);
    var n = def.headers.length;
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, n).clearContent();
    if (!rows.length) return;
    var max = sheet.getMaxRows();
    if (rows.length + 1 > max) sheet.insertRowsAfter(max, rows.length + 1 - max);
    sheet.getRange(2, 1, rows.length, n).setNumberFormat("@").setValues(rows.map(safeRow_));
  }

  /** Writes every settings tab from a settings object and refreshes the cache. */
  function saveSettings(settings) {
    var s = Core.normalizeSettings(settings);
    writeTab_(TABS.settings, Core.GENERAL_FIELDS.map(function (f) {
      var v = s.general[f.key];
      return [f.label, f.type === "bool" ? (v ? "yes" : "no") : String(v), f.help + (f.options ? " Choices: " + f.options.join(", ") + "." : "")];
    }));
    Core.LISTS.forEach(function (list) {
      writeTab_(listTab_(list), Core.listToRows(s, list.id));
    });
    writeTab_(TABS.templates, Core.TEMPLATE_KEYS.map(function (key) {
      return [key, s.templates[key].subject, s.templates[key].body, Core.TEMPLATE_INFO[key]];
    }));
    var json = JSON.stringify(s);
    var cache = CacheService.getScriptCache();
    if (json.length < 90000) cache.put(CACHE_SETTINGS, json, 300);
    else cache.remove(CACHE_SETTINGS);
    return s;
  }

  // --- Tickets ---------------------------------------------------------------

  function rowToTicket_(row) {
    var id = text_(row[0]).trim();
    return {
      id: id,
      number: Core.ticketNumber(id),
      createdAt: iso_(row[1]),
      updatedAt: iso_(row[2]),
      requesterEmail: Core.normalizeEmail(text_(row[3])) || text_(row[3]),
      requesterName: text_(row[4]),
      subject: text_(row[5]),
      description: text_(row[6]),
      category: text_(row[7]),
      priority: text_(row[8]),
      location: text_(row[9]),
      status: text_(row[10]),
      assignedTo: Core.normalizeEmail(text_(row[11])),
      dueAt: iso_(row[12]),
      closedAt: iso_(row[13]),
      source: text_(row[14]),
    };
  }

  function ticketToRow_(t) {
    return [t.id, t.createdAt, t.updatedAt, t.requesterEmail, t.requesterName, t.subject, t.description, t.category, t.priority, t.location, t.status, t.assignedTo, t.dueAt, t.closedAt, t.source];
  }

  function allTickets() {
    return readRows_(tab_(TABS.tickets), TICKET_COLS)
      .filter(function (row) { return text_(row[0]).trim() !== ""; })
      .map(rowToTicket_);
  }

  /** The sheet row number of a ticket, or 0. */
  function rowOf_(sheet, id) {
    var last = sheet.getLastRow();
    if (last < 2) return 0;
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    var want = String(id).trim().toLowerCase();
    for (var i = 0; i < ids.length; i++) if (text_(ids[i][0]).trim().toLowerCase() === want) return i + 2;
    return 0;
  }

  function getTicket(id) {
    var sheet = tab_(TABS.tickets);
    var row = rowOf_(sheet, id);
    return row ? rowToTicket_(sheet.getRange(row, 1, 1, TICKET_COLS).getValues()[0]) : null;
  }

  /**
   * Runs fn while holding the help desk's lock, so two people can never get the same ticket
   * number or overwrite each other's change.
   */
  function locked(fn) {
    var lock = LockService.getScriptLock();
    // Add-on actions must answer within 30 seconds, so the wait for the lock is kept short.
    if (!lock.tryLock(8000)) throw new Error("The help desk is busy. Please try again in a moment.");
    try {
      return fn();
    } finally {
      SpreadsheetApp.flush();
      lock.releaseLock();
    }
  }

  /** The next free ticket number: one more than the highest number in the Tickets tab. */
  function nextNumber() {
    var sheet = tab_(TABS.tickets);
    var last = sheet.getLastRow();
    var max = 0;
    if (last >= 2) {
      sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
        var n = Core.ticketNumber(text_(r[0]));
        if (n > max) max = n;
      });
    }
    return max + 1;
  }

  function addTicket(ticket) {
    appendRows_(tab_(TABS.tickets), [ticketToRow_(ticket)], TICKET_COLS);
  }

  function saveTicket(ticket) {
    var sheet = tab_(TABS.tickets);
    var row = rowOf_(sheet, ticket.id);
    if (!row) throw new Error("Ticket " + ticket.id + " was not found.");
    sheet.getRange(row, 1, 1, TICKET_COLS).setNumberFormat("@").setValues([safeRow_(ticketToRow_(ticket))]);
  }

  /**
   * Renames statuses, priorities, categories, and locations on stored tickets after an
   * administrator renamed them in the settings. Returns how many tickets changed.
   */
  function renameTickets(plan) {
    var sheet = tab_(TABS.tickets);
    var last = sheet.getLastRow();
    if (last < 2) return 0;
    // Only Category, Priority, Location, and Status (columns 8 to 11) and the Updated time
    // (column 3) are written. Rows that do not change get their own values back exactly as read,
    // so values people typed into other rows or columns by hand are kept. Two writes in all, so
    // a large sheet stays well inside the add-on's time limit.
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    var named = sheet.getRange(2, 8, last - 1, 4);
    var stamps = sheet.getRange(2, 3, last - 1, 1);
    var values = named.getValues();
    var times = stamps.getValues();
    var now = new Date().toISOString();
    var count = 0;
    for (var i = 0; i < values.length; i++) {
      if (text_(ids[i][0]).trim() === "") continue;
      var c = values[i];
      var next = [
        Core.renamed(plan, "categories", text_(c[0])),
        Core.renamed(plan, "priorities", text_(c[1])),
        Core.renamed(plan, "locations", text_(c[2])),
        Core.renamed(plan, "statuses", text_(c[3])),
      ];
      if (!next.some(function (v, k) { return v !== text_(c[k]); })) continue;
      count++;
      values[i] = safeRow_(next);
      // A new Updated time tells anyone with the ticket open to look again before saving.
      times[i] = [now];
    }
    if (count) {
      named.setValues(values);
      stamps.setValues(times);
    }
    return count;
  }



  // --- Messages and activity ---------------------------------------------------

  function addMessages(ticketId, messages) {
    if (!messages.length) return;
    appendRows_(tab_(TABS.messages), messages.map(function (m) { return [ticketId, m.at, m.by, m.byName, m.role, m.visibility, m.text]; }), 7);
  }

  function messagesFor(ticketId) {
    var want = String(ticketId).toLowerCase();
    return readRows_(tab_(TABS.messages), 7)
      .filter(function (row) { return text_(row[0]).trim().toLowerCase() === want; })
      .map(function (row) {
        return { at: iso_(row[1]), by: text_(row[2]), byName: text_(row[3]), role: text_(row[4]) === "requester" ? "requester" : "team", visibility: text_(row[5]) === "internal" ? "internal" : "public", text: text_(row[6]) };
      });
  }

  function addActivity(ticketId, entries) {
    if (!entries.length) return;
    appendRows_(tab_(TABS.activity), entries.map(function (a) { return [a.at, ticketId, a.by, a.text]; }), 4);
  }

  function activityFor(ticketId) {
    var want = String(ticketId).toLowerCase();
    return readRows_(tab_(TABS.activity), 4)
      .filter(function (row) { return text_(row[1]).trim().toLowerCase() === want; })
      .map(function (row) { return { at: iso_(row[0]), by: text_(row[2]), text: text_(row[3]) }; });
  }

  function rrIndex() {
    return parseInt(props_().getProperty(PROP_RR) || "0", 10) || 0;
  }

  function setRrIndex(i) {
    props_().setProperty(PROP_RR, String(i));
  }

  return {
    exists: exists, url: url, create: create, loadSettings: loadSettings, saveSettings: saveSettings,
    allTickets: allTickets, getTicket: getTicket, locked: locked, nextNumber: nextNumber, addTicket: addTicket, saveTicket: saveTicket,
    renameTickets: renameTickets, addMessages: addMessages, messagesFor: messagesFor, addActivity: addActivity, activityFor: activityFor,
    rrIndex: rrIndex, setRrIndex: setRrIndex,
  };
})();
