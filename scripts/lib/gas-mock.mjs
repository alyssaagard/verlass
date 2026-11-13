/**
 * A simulated Google Apps Script environment for the tests.
 *
 * It runs the real .gs files in a Node vm context against stand-ins for the Google services
 * the add-on uses: SpreadsheetApp, CardService, MailApp, UrlFetchApp, PropertiesService,
 * CacheService, LockService, Session, ScriptApp, Utilities, ContentService, and GmailApp.
 *
 * The stand-ins enforce the rules the real services are known to enforce (a text that starts
 * with "=" becomes a formula, ranges and values must have the same size, widgets need their
 * required parts, action parameters must be strings, a sheet a person cannot open throws).
 * They cannot prove that Gmail draws a card the way we expect; only a real install can.
 */
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

// --- A shared "Google account world": files and mail that every project sees --------

export function makeWorld() {
  return {
    now: Date.parse("2026-11-13T15:00:00Z"),
    files: new Map(), // spreadsheet id -> { book, owner, editors:Set }
    mail: [], // every email sent
    webApps: new Map(), // url -> project
    nextId: 1,
    tick(ms) {
      this.now += ms;
    },
  };
}

// --- Dates the way Utilities.formatDate and parseDate handle them -------------------

function partsIn(date, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
  const out = {};
  for (const p of f.formatToParts(date)) out[p.type] = p.value;
  return { y: Number(out.year), M: Number(out.month), d: Number(out.day), H: Number(out.hour), m: Number(out.minute), s: Number(out.second), E: out.weekday };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(date, timeZone, pattern) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("Invalid argument: date");
  const p = partsIn(date, timeZone);
  const pad = (n, w) => String(n).padStart(w, "0");
  return pattern.replace(/'([^']*)'|y+|M+|d+|H+|h+|m+|s+|a|E+/g, (tok, literal) => {
    if (literal !== undefined) return literal;
    switch (tok[0]) {
      case "y": return tok.length === 2 ? pad(p.y % 100, 2) : String(p.y);
      case "M": return tok.length >= 3 ? MONTHS[p.M - 1] : pad(p.M, tok.length);
      case "d": return pad(p.d, tok.length);
      case "H": return pad(p.H, tok.length);
      case "h": return pad(p.H % 12 === 0 ? 12 : p.H % 12, tok.length);
      case "m": return pad(p.m, tok.length);
      case "s": return pad(p.s, tok.length);
      case "a": return p.H < 12 ? "AM" : "PM";
      case "E": return p.E;
      default: return tok;
    }
  });
}

export function parseDate(text, timeZone, pattern) {
  if (pattern !== "yyyy-MM-dd HH:mm") throw new Error("The simulated parseDate only knows yyyy-MM-dd HH:mm");
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
  if (!m) throw new Error("Unparseable date: " + text);
  const want = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), timeZone);
    guess += want - Date.UTC(p.y, p.M - 1, p.d, p.H, p.m);
  }
  return new Date(guess);
}

// --- Spreadsheets -----------------------------------------------------------------

class Sheet {
  constructor(name) {
    this.name = name;
    this.cells = []; // rows of { v, formula, format }
    this.maxRows = 1000;
    this.frozen = 0;
  }
  cell(r, c) {
    while (this.cells.length < r) this.cells.push([]);
    const row = this.cells[r - 1];
    while (row.length < c) row.push({ v: "", formula: false, format: "" });
    return row[c - 1];
  }
  write(r, c, value) {
    const cell = this.cell(r, c);
    cell.formula = false;
    if (value === null || value === undefined) value = "";
    if (typeof value === "string") {
      if (value.startsWith("=")) {
        cell.formula = true; // Sheets would run this as a formula.
      } else if (value.startsWith("'")) {
        value = value.slice(1); // A leading apostrophe marks text and is not kept.
      } else if (cell.format !== "@" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        value = Number(value); // Outside text-formatted cells, Sheets turns "0042" into 42.
      }
    }
    cell.v = value;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() {
    for (let r = this.cells.length; r >= 1; r--) if (this.cells[r - 1].some((c) => c.v !== "")) return r;
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, count) {
    if (after !== this.maxRows || !(count >= 1)) throw new Error("The simulated sheet only adds rows at the bottom");
    this.maxRows += count;
    return this;
  }
  setFrozenRows(n) { this.frozen = n; return this; }
  setColumnWidth() { return this; }
  getRange(row, col, rows = 1, cols = 1) {
    if (![row, col, rows, cols].every((n) => Number.isInteger(n) && n >= 1) || row + rows - 1 > this.maxRows) throw new Error(`The coordinates of the range are outside the dimensions of the sheet (${row}, ${col}, ${rows}, ${cols}).`);
    const sheet = this;
    const each = (fn) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) fn(row + r, col + c, r, c);
    };
    const range = {
      getValues() {
        const out = [];
        for (let r = 0; r < rows; r++) {
          const line = [];
          for (let c = 0; c < cols; c++) line.push(sheet.cell(row + r, col + c).v);
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        if (!Array.isArray(values) || values.length !== rows) throw new Error(`The number of rows in the data does not match the number of rows in the range. The data has ${values && values.length} but the range has ${rows}.`);
        values.forEach((line) => {
          if (!Array.isArray(line) || line.length !== cols) throw new Error(`The number of columns in the data does not match the number of columns in the range. The data has ${line && line.length} but the range has ${cols}.`);
        });
        each((r, c, i, j) => sheet.write(r, c, values[i][j]));
        return range;
      },
      setValue(v) { each((r, c) => sheet.write(r, c, v)); return range; },
      clearContent() { each((r, c) => { const cell = sheet.cell(r, c); cell.v = ""; cell.formula = false; }); return range; },
      setNumberFormat(f) { each((r, c) => { sheet.cell(r, c).format = f; }); return range; },
      setFontWeight() { return range; },
      setBackground() { return range; },
      setFontColor() { return range; },
      setVerticalAlignment() { return range; },
    };
    return range;
  }
  /** For the tests: true if any cell would run as a formula. */
  hasFormula() {
    return this.cells.some((row) => row.some((c) => c.formula));
  }
}

class Book {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.sheets = [new Sheet("Sheet1")];
  }
  getId() { return this.id; }
  getUrl() { return "https://docs.google.com/spreadsheets/d/" + this.id + "/edit"; }
  getName() { return this.title; }
  getSheets() { return this.sheets.slice(); }
  getActiveSheet() { return this.sheets[0]; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    const s = new Sheet(name);
    this.sheets.push(s);
    return s;
  }
}

// --- Cards ------------------------------------------------------------------------

function makeCardService(globalHas) {
  const need = (cond, msg) => {
    if (!cond) throw new Error("CardService: " + msg);
  };
  const chain = (kind, setters, validate) => () => {
    const o = { kind };
    const api = {};
    for (const [name, fn] of Object.entries(setters)) {
      api[name] = (...args) => {
        fn(o, ...args);
        return api;
      };
    }
    api.__o = o;
    api.__validate = () => validate && validate(o);
    api.build = () => {
      if (validate) validate(o);
      return o;
    };
    return api;
  };
  const raw = (x) => (x && x.__o ? (x.__validate(), x.__o) : x);
  const str = (v, what) => {
    need(typeof v === "string", what + " must be text, got " + typeof v);
    return v;
  };

  const newAction = chain("action", {
    setFunctionName: (o, n) => { o.fn = str(n, "function name"); },
    setParameters: (o, p) => {
      need(p && typeof p === "object", "parameters must be an object");
      for (const [k, v] of Object.entries(p)) need(typeof v === "string", `action parameter "${k}" must be a string, got ${typeof v}`);
      o.params = { ...p };
    },
  }, (o) => {
    need(o.fn, "an action needs a function name");
    need(globalHas(o.fn), `action function "${o.fn}" does not exist`);
  });

  const widgetText = { setText: (o, t) => { o.text = str(t, "text"); } };
  const CardService = {
    ImageStyle: { SQUARE: "SQUARE", CIRCLE: "CIRCLE" },
    SelectionInputType: { DROPDOWN: "DROPDOWN", CHECK_BOX: "CHECK_BOX", RADIO_BUTTON: "RADIO_BUTTON", SWITCH: "SWITCH" },
    TextButtonStyle: { FILLED: "FILLED", TEXT: "TEXT", OUTLINED: "OUTLINED" },
    newAction,
    newOpenLink: chain("openLink", { setUrl: (o, u) => { o.url = str(u, "url"); } }, (o) => need(/^https?:\/\//.test(o.url || ""), "an open link needs an http(s) address")),
    newNotification: chain("notification", widgetText, (o) => need(o.text, "a notification needs text")),
    newCardHeader: chain("header", {
      setTitle: (o, t) => { o.title = str(t, "title"); },
      setSubtitle: (o, t) => { o.subtitle = str(t, "subtitle"); },
      setImageUrl: (o, u) => { o.imageUrl = str(u, "image url"); },
      setImageStyle: (o, s) => { o.imageStyle = s; },
    }, (o) => need(o.title, "a card header needs a title")),
    newTextParagraph: chain("paragraph", widgetText, (o) => need(o.text, "a text paragraph needs text")),
    newDecoratedText: chain("decorated", {
      ...widgetText,
      setTopLabel: (o, t) => { o.top = str(t, "top label"); },
      setBottomLabel: (o, t) => { o.bottom = str(t, "bottom label"); },
      setWrapText: (o, b) => { o.wrap = !!b; },
      setOnClickAction: (o, a) => { o.action = raw(a); },
      setButton: (o, b) => { o.button = raw(b); },
    }, (o) => need(o.text, "decorated text needs text")),
    newTextInput: chain("textInput", {
      setFieldName: (o, n) => { o.name = str(n, "field name"); },
      setTitle: (o, t) => { o.title = str(t, "title"); },
      setHint: (o, t) => { o.hint = str(t, "hint"); },
      setValue: (o, v) => { o.value = str(v, "value"); },
      setMultiline: (o, b) => { o.multiline = !!b; },
    }, (o) => need(o.name, "a text input needs a field name")),
    newSelectionInput: chain("selection", {
      setType: (o, t) => { o.type = t; },
      setFieldName: (o, n) => { o.name = str(n, "field name"); },
      setTitle: (o, t) => { o.title = str(t, "title"); },
      addItem: (o, text, value, selected) => {
        need(text !== undefined && text !== null && String(text) !== "", "a selection item needs text");
        need(value !== undefined && value !== null, "a selection item needs a value");
        (o.items = o.items || []).push({ text: String(text), value: String(value), selected: !!selected });
      },
    }, (o) => {
      need(o.name, "a selection input needs a field name");
      need(o.type, "a selection input needs a type");
      need(o.items && o.items.length, `selection input "${o.name}" needs at least one item`);
    }),
    newTextButton: chain("button", {
      ...widgetText,
      setOnClickAction: (o, a) => { o.action = raw(a); },
      setOpenLink: (o, l) => { o.link = raw(l); },
      setTextButtonStyle: (o, s) => { o.style = s; },
      setBackgroundColor: (o, c) => { need(/^#[0-9a-fA-F]{6}$/.test(c), "button color must be #RRGGBB, got " + c); o.color = c; },
      setDisabled: (o, b) => { o.disabled = !!b; },
    }, (o) => {
      need(o.text, "a button needs text");
      need(o.action || o.link, `button "${o.text}" needs an action or a link`);
    }),
    newButtonSet: chain("buttonSet", { addButton: (o, b) => { (o.buttons = o.buttons || []).push(raw(b)); } }, (o) => need(o.buttons && o.buttons.length, "a button set needs a button")),
    newCardSection: chain("section", {
      setHeader: (o, t) => { o.header = str(t, "section header"); },
      addWidget: (o, w) => { need(w, "addWidget needs a widget"); (o.widgets = o.widgets || []).push(raw(w)); },
      setCollapsible: (o, b) => { o.collapsible = !!b; },
      setNumUncollapsibleWidgets: (o, n) => { o.uncollapsible = n; },
    }, (o) => {
      need(o.widgets && o.widgets.length, "a section needs at least one widget");
      need(o.widgets.length <= 100, "a section can hold at most 100 widgets");
    }),
    newCardBuilder: chain("card", {
      setHeader: (o, h) => { o.header = raw(h); },
      addSection: (o, s) => { (o.sections = o.sections || []).push(raw(s)); },
      setName: (o, n) => { o.name = n; },
    }, (o) => need(o.sections && o.sections.length, "a card needs at least one section")),
    newNavigation: chain("navigation", {
      pushCard: (o, c) => { need(c && c.kind === "card", "pushCard needs a built card"); (o.ops = o.ops || []).push({ op: "push", card: c }); },
      updateCard: (o, c) => { need(c && c.kind === "card", "updateCard needs a built card"); (o.ops = o.ops || []).push({ op: "update", card: c }); },
      popCard: (o) => { (o.ops = o.ops || []).push({ op: "pop" }); },
      popToRoot: (o) => { (o.ops = o.ops || []).push({ op: "root" }); },
    }),
    newActionResponseBuilder: chain("response", {
      setNavigation: (o, n) => { o.navigation = raw(n); },
      setNotification: (o, n) => { o.notification = raw(n); },
      setStateChanged: (o, b) => { o.stateChanged = !!b; },
    }, (o) => need(o.navigation || o.notification, "an action response needs navigation or a notification")),
  };
  return CardService;
}

// --- One Apps Script project --------------------------------------------------------

/**
 * Loads .gs files into a new simulated project.
 * options: { world, files: [paths], user, owner (for web apps), timeZone, properties }
 */
export function makeProject(options) {
  const world = options.world || makeWorld();
  const project = {
    world,
    user: options.user || "owner@example.com",
    effectiveUser: options.owner || null, // set for a web app that runs as its owner
    properties: new Map(Object.entries(options.properties || {})),
    cache: new Map(),
    audience: options.audience || "client-" + world.nextId++ + ".apps.googleusercontent.com",
    fetchLog: [],
    message: null, // the open Gmail message, for "create from this email"
    used: new Set(), // which Google services the code actually called, to compare with its scopes
  };
  const use = (service) => project.used.add(service);

  const scriptProperties = {
    getProperty: (k) => (project.properties.has(k) ? project.properties.get(k) : null),
    setProperty: (k, v) => {
      project.properties.set(k, String(v));
      return scriptProperties;
    },
    deleteProperty: (k) => {
      project.properties.delete(k);
      return scriptProperties;
    },
  };
  const scriptCache = {
    get: (k) => {
      const hit = project.cache.get(k);
      if (!hit || hit.until <= world.now) return null;
      return hit.value;
    },
    put: (k, v, seconds = 600) => {
      if (typeof v !== "string") throw new Error("CacheService values must be strings");
      if (v.length > 100000) throw new Error("Argument too large: value");
      project.cache.set(k, { value: v, until: world.now + seconds * 1000 });
    },
    remove: (k) => project.cache.delete(k),
  };

  const currentUser = () => project.user;
  const canOpen = (file) => {
    const who = project.effectiveUser || currentUser();
    return file.owner === who || file.editors.has(who);
  };

  const sandbox = {
    console,
    Date: makeDate(world),
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: { getScriptCache: () => scriptCache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => (use("Session"), project.effectiveUser ? "" : currentUser()) }),
      // Google can return an empty address here (for example under some account policies); effectiveEmpty simulates that.
      getEffectiveUser: () => ({ getEmail: () => (use("Session"), options.effectiveEmpty ? "" : project.effectiveUser || currentUser()) }),
      getScriptTimeZone: () => options.timeZone || "America/New_York",
    },
    ScriptApp: {
      getIdentityToken: () => (use("IdentityToken"), "idtoken." + Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: project.audience, email: currentUser(), email_verified: "true", hd: project.hd === null || project.hd === undefined ? currentUser().split("@")[1] : project.hd, exp: Math.floor(world.now / 1000) + 3600 })).toString("base64url")),
    },
    Utilities: {
      formatDate,
      parseDate,
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest: (alg, text) => Array.from(crypto.createHash("sha256").update(String(text)).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
    },
    SpreadsheetApp: {
      create: (title) => {
        use("SpreadsheetApp");
        const id = "sheet" + world.nextId++;
        const book = new Book(id, title);
        world.files.set(id, { book, owner: project.effectiveUser || currentUser(), editors: new Set() });
        return book;
      },
      openById: (id) => {
        use("SpreadsheetApp");
        const file = world.files.get(id);
        if (!file) throw new Error("Document " + id + " is missing (perhaps it was deleted, or you don't have read access?)");
        if (!canOpen(file)) throw new Error("You do not have permission to access the requested document.");
        return file.book;
      },
      flush: () => {},
    },
    MailApp: {
      getRemainingDailyQuota: () => 100,
      sendEmail: (m) => {
        use("MailApp");
        if (!m || typeof m !== "object") throw new Error("sendEmail needs a message object");
        if (!m.to || !/@/.test(m.to)) throw new Error("Failed to send email: no recipient");
        if (!m.subject && m.subject !== "") throw new Error("sendEmail needs a subject");
        if (/[\r\n]/.test(m.subject)) throw new Error("Invalid subject: line break");
        world.mail.push({ ...m, from: project.effectiveUser || currentUser() });
      },
    },
    ContentService: {
      MimeType: { JSON: "JSON", TEXT: "TEXT" },
      createTextOutput: (text) => {
        const out = { text: String(text), mime: "TEXT", setMimeType: (m) => { out.mime = m; return out; }, getContent: () => out.text };
        return out;
      },
    },
    GmailApp: {
      setCurrentMessageAccessToken: (t) => {
        if (!t) throw new Error("Access token required");
      },
      getMessageById: (id) => {
        use("GmailApp");
        if (!project.message || project.message.id !== id) throw new Error("Invalid message id");
        const m = project.message;
        return { getFrom: () => m.from, getSubject: () => m.subject, getPlainBody: () => m.body };
      },
    },
    UrlFetchApp: {
      fetch: (url, opts = {}) => {
        use("UrlFetchApp");
        project.fetchLog.push({ url, opts });
        const respond = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?id_token=")) {
          const token = decodeURIComponent(url.split("id_token=")[1]);
          if (!token.startsWith("idtoken.")) return respond(400, '{"error":"invalid_token"}');
          try {
            return respond(200, Buffer.from(token.slice(8), "base64url").toString("utf8"));
          } catch (e) {
            return respond(400, '{"error":"invalid_token"}');
          }
        }
        const app = world.webApps.get(url);
        if (app) {
          app.reset();
          if (String(opts.method || "get").toLowerCase() !== "post") return respond(200, app.context.doGet().getContent());
          const out = app.context.doPost({ postData: { contents: opts.payload, type: opts.contentType } });
          return respond(200, out.getContent());
        }
        if (opts.muteHttpExceptions) return respond(404, "<html>Not found</html>");
        throw new Error("Request failed for " + url + " returned code 404");
      },
    },
  };
  sandbox.CardService = makeCardService((name) => typeof project.context[name] === "function");
  const sources = options.files.map((file) => ({ file, script: new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }) }));
  /**
   * Apps Script starts every execution with fresh globals: nothing a script keeps in a variable
   * survives to the next click. reset() does the same here, so the tests cannot pass by
   * accident on state a real add-on would have lost.
   */
  project.reset = () => {
    const context = vm.createContext(Object.assign({}, sandbox));
    for (const s of sources) s.script.runInContext(context);
    project.context = context;
    return context;
  };
  project.reset();
  project.deployWebApp = (url) => {
    world.webApps.set(url, project);
    return url;
  };
  return project;
}

/** A Date whose "now" follows the simulated world's clock. */
function makeDate(world) {
  class SimDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(world.now);
      else super(...args);
    }
    static now() {
      return world.now;
    }
  }
  return SimDate;
}

// --- A person using the add-on --------------------------------------------------------

/** Collects what a card shows: its texts, inputs, and buttons. */
export function readCard(card) {
  const out = { title: card.header ? card.header.title : "", subtitle: card.header ? card.header.subtitle || "" : "", texts: [], inputs: [], buttons: [], rows: [] };
  const addButton = (b) => out.buttons.push({ text: b.text, fn: b.action ? b.action.fn : null, params: (b.action && b.action.params) || {}, link: b.link ? b.link.url : null });
  for (const s of card.sections || []) {
    if (s.header) out.texts.push(s.header);
    for (const w of s.widgets) {
      if (w.kind === "paragraph") out.texts.push(w.text);
      if (w.kind === "decorated") {
        out.texts.push([w.top, w.text, w.bottom].filter(Boolean).join(" | "));
        if (w.button) addButton(w.button);
        if (w.action) out.rows.push({ text: w.text, top: w.top || "", bottom: w.bottom || "", fn: w.action.fn, params: w.action.params || {} });
      }
      if (w.kind === "textInput") out.inputs.push({ name: w.name, type: "text", value: w.value || "", title: w.title || "" });
      if (w.kind === "selection") out.inputs.push({ name: w.name, type: w.type, items: w.items, title: w.title || "", value: w.type === "SWITCH" || w.type === "CHECK_BOX" ? (w.items.some((i) => i.selected) ? w.items.find((i) => i.selected).value : "") : (w.items.find((i) => i.selected) || w.items[0]).value });
      if (w.kind === "button") addButton(w);
      if (w.kind === "buttonSet") w.buttons.forEach(addButton);
    }
  }
  out.all = out.texts.join("\n");
  return out;
}

/**
 * Drives the add-on the way a person would: open it, read the card, fill fields, and select
 * buttons. Keeps the card stack that Gmail would keep.
 */
export function makeSession(project, email) {
  const stack = [];
  let lastNotification = "";
  const as = (fn) => {
    const before = project.user;
    project.user = email;
    project.reset();
    try {
      return fn();
    } finally {
      project.user = before;
    }
  };
  const event = (params, values, gmail) => {
    const formInputs = {};
    const formInput = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === "" || v === false || v === undefined || v === null) continue; // Empty fields are not sent.
      formInputs[k] = { stringInputs: { value: [String(v)] } };
      formInput[k] = String(v);
    }
    const e = { parameters: params, formInput, commonEventObject: { parameters: params, formInputs } };
    if (gmail) e.gmail = gmail;
    return e;
  };
  const apply = (response) => {
    if (!response || response.kind !== "response") throw new Error("A button handler must return an action response");
    lastNotification = response.notification ? response.notification.text : "";
    for (const op of (response.navigation && response.navigation.ops) || []) {
      if (op.op === "push") stack.push(op.card);
      else if (op.op === "update") stack[stack.length - 1] = op.card;
      else if (op.op === "pop") { if (stack.length > 1) stack.pop(); }
      else if (op.op === "root") stack.length = 1;
    }
  };
  const session = {
    gmail: null,
    open() {
      stack.length = 0;
      const card = as(() => project.context.onHomepage(event({}, {}, session.gmail)));
      if (!card || card.kind !== "card") throw new Error("onHomepage must return a card");
      stack.push(card);
      return session.card();
    },
    card: () => readCard(stack[stack.length - 1]),
    depth: () => stack.length,
    notification: () => lastNotification,
    /** Selects a button by its text (or a list row by a text it contains). values fill the form. */
    click(text, values = {}, pick = {}) {
      const card = session.card();
      const buttons = card.buttons.filter((b) => b.text === text && Object.entries(pick).every(([k, v]) => b.params[k] === v));
      let target = buttons[0];
      if (!target) target = card.rows.find((r) => (r.text + " " + r.top).includes(text));
      if (!target) throw new Error(`No button or row "${text}" on the card "${card.title}". Buttons: ${card.buttons.map((b) => b.text).join(", ")}`);
      if (!target.fn) throw new Error(`"${text}" is a link, not an action`);
      const filled = {};
      for (const input of card.inputs) filled[input.name] = input.value;
      Object.assign(filled, values);
      apply(as(() => project.context[target.fn](event(target.params, filled, session.gmail))));
      return session.card();
    },
    back() {
      if (stack.length > 1) stack.pop();
      return session.card();
    },
  };
  return session;
}
