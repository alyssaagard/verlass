/**
 * Tests for the shared rules in docs/app/core: settings, tickets, due times, assignment,
 * queues, email, and the editable lists.
 */
export async function run({ check, load }) {
  const T = await load("docs/app/core/text.js");
  const S = await load("docs/app/core/settings.js");
  const K = await load("docs/app/core/tickets.js");
  const M = await load("docs/app/core/mail.js");
  const L = await load("docs/app/core/lists.js");
  const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

  // --- Text helpers ------------------------------------------------------------
  eq(T.escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;", "escapeHtml");
  eq(T.cleanLine("  a\tb\r\nc  ", 4), "a b", "cleanLine trims, joins lines, and limits length");
  eq(T.normalizeEmail(" Pat.Lee@Example.COM "), "pat.lee@example.com", "normalizeEmail lowercases");
  for (const bad of ["", "pat", "pat@", "a b@c.d", "<x@y.z>", "a@b", "x@y.z,q@r.s"]) eq(T.normalizeEmail(bad), "", `normalizeEmail rejects ${JSON.stringify(bad)}`);
  for (const f of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"]) {
    check(T.sheetSafe(f).startsWith(T.SHEET_GUARD), `sheetSafe guards ${JSON.stringify(f)}`);
    eq(T.sheetRead(T.sheetSafe(f)), f, "sheetRead reverses sheetSafe");
  }
  eq(T.sheetSafe("plain"), "plain", "sheetSafe leaves ordinary text");
  for (const f of ["'Twas fine", "'=1", "''x", "\u200B=x", "a'b"]) {
    eq(T.sheetRead(T.sheetSafe(f)), f, "round trip of " + JSON.stringify(f));
    // Whether Sheets keeps a leading apostrophe or drops it, a guarded value starts with the guard, so it is unaffected.
    const stored = T.sheetSafe(f);
    check(!/^['=+\-@]/.test(stored), "what is written never starts with a character Sheets treats specially: " + JSON.stringify(f));
  }
  check(T.contrast("#FFFFFF", T.buttonColor("#FFCC00")) >= 4.5 && T.buttonColor("#2F4F40") === "#2F4F40", "a button color is darkened only when white text would be hard to read");
  eq(T.sheetSafe(5), 5, "sheetSafe leaves numbers");
  eq(T.safeUrl("javascript:alert(1)"), "", "safeUrl blocks javascript links");
  eq(T.safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1", "safeUrl keeps https");
  eq(T.hexColor("#abc", "#000000"), "#AABBCC", "hexColor expands short colors");
  eq(T.hexColor("red", "#123456"), "#123456", "hexColor falls back");
  check(Math.abs(T.contrast("#000000", "#FFFFFF") - 21) < 0.01, "contrast of black on white is 21");
  eq(T.readableOn("#2F4F40"), "#FFFFFF", "white text on the dark accent");
  eq(T.readableOn("#B5C8BC"), "#14201A", "dark text on a light color");

  // --- Settings ------------------------------------------------------------------
  const base = S.normalizeSettings(null);
  check(base.categories.length > 0 && base.priorities.length === 4 && base.statuses.length === 5, "empty input becomes complete default settings");
  eq(S.normalizeSettings(base), base, "normalizing twice changes nothing");
  for (const preset of S.PRESETS) {
    const d = S.normalizeSettings(S.defaultSettings(preset.id));
    check(d.categories.length === preset.categories.length && d.general.deskName === preset.deskName, `preset ${preset.id} loads`);
    const ready = Object.assign({}, d, { general: Object.assign({}, d.general, { timeZone: "Europe/Berlin" }), team: [{ email: "a@example.com", name: "", role: "admin", active: true }] });
    eq(S.settingsWarnings(ready), [], `preset ${preset.id} has no warnings once an admin and a time zone exist`);
    check(S.settingsWarnings(d).some((w) => /No time zone/.test(w)), `preset ${preset.id} warns while no time zone is set`);
  }
  const odd = S.normalizeSettings({
    general: { accentColor: "nope", ticketDigits: 99, workStart: "18:00", workEnd: "09:00", workDays: "9,x", holidays: "2026-12-25, tomorrow", defaultPriority: "missing", logoUrl: "javascript:x", supportEmail: "bad", ticketPrefix: "T K<T>-", requesterCanClose: "no", pageSize: "abc" },
    statuses: [{ name: "Parked", kind: "weird" }],
    priorities: [{ name: "P1", dueHours: -5 }, { name: "p1" }],
    categories: [{ name: "A", assignTo: "X@Example.com", priority: "p1", active: "no" }],
    team: [{ email: "X@example.com", role: "ADMIN" }, { email: "x@example.com" }, { email: "nope" }],
    rules: [{ category: "A", assignTo: "nobody" }, { assignTo: "x@example.com" }],
    templates: { created: { subject: "", body: "Hi {{bogus}}" } },
    extra: "dropped",
  });
  eq(odd.general.accentColor, "#2F4F40", "a bad color falls back to the default");
  eq(odd.general.ticketDigits, 9, "numbers are clamped");
  eq([odd.general.workStart, odd.general.workEnd], ["08:00", "17:00"], "working hours that end before they start are reset");
  eq(odd.general.workDays, "1,2,3,4,5", "working days with no valid day are reset");
  eq(odd.general.holidays, "2026-12-25", "only real dates stay in the days off");
  eq(odd.general.defaultPriority, "P1", "the default priority must be on the list");
  eq([odd.general.logoUrl, odd.general.supportEmail], ["", ""], "bad addresses are emptied");
  eq(odd.general.ticketPrefix, "TKT-", "the ticket prefix loses unsafe characters");
  eq(odd.general.requesterCanClose, false, "yes and no are read as on and off");
  eq(odd.general.pageSize, 15, "a number that is not a number falls back");
  check(odd.statuses.some((s) => s.kind === "open") && odd.statuses.some((s) => s.kind === "done"), "an open and a done status always exist");
  eq(odd.priorities.length, 1, "duplicate names are dropped whatever their capitals");
  eq(odd.priorities[0].dueHours, 0, "negative due hours become 0");
  check(odd.categories.some((c) => c.active), "at least one category is active");
  eq(odd.categories[0], { name: "A", assignTo: "x@example.com", priority: "P1", active: false }, "category fields are tidied");
  eq(odd.team, [{ email: "x@example.com", name: "", role: "admin", active: true }], "team entries are tidied and deduplicated");
  eq(odd.rules.length, 1, "rules without a valid assignee are dropped");
  check(odd.templates.created.subject.length > 0 && odd.templates.status.body.length > 0, "empty templates fall back to the defaults");
  check(!("extra" in odd), "unknown keys are dropped");
  check(S.settingsWarnings(odd).some((w) => w.includes("{{bogus}}")), "an unknown placeholder is reported");
  eq(S.roleOf(odd, "X@EXAMPLE.com"), "admin", "roles ignore capitals");
  eq(S.roleOf(odd, "y@example.com"), "requester", "people not on the team are requesters");
  const pub = S.publicSettings(odd);
  check(!("team" in pub) && !("rules" in pub) && !("templates" in pub), "public settings leave out the team, rules, and email wording");
  for (const f of S.GENERAL_FIELDS) check(f.label && f.group && ["text", "email", "url", "color", "number", "bool", "choice", "time"].includes(f.type), `setting ${f.key} is fully described`);
  for (const key of S.TEMPLATE_KEYS) {
    check(S.TEMPLATE_INFO[key] && S.DEFAULT_TEMPLATES[key], `template ${key} has a description and a default`);
    const re = /\{\{\s*([^}]*?)\s*\}\}/g;
    let m;
    while ((m = re.exec(S.DEFAULT_TEMPLATES[key].subject + S.DEFAULT_TEMPLATES[key].body))) check(S.PLACEHOLDERS.includes(m[1]), `default template ${key} uses a known placeholder (${m[1]})`);
  }

  // Input that used to be misread or dropped without a word.
  const lenient = S.normalizeSettings({ general: { workDays: "1-5", workStart: "8 am", workEnd: "5:30 PM", website: "www.example.org", ticketPrefix: "Q4" }, statuses: [{ name: "Open", kind: "done" }, { name: "New", kind: "waiting" }], categories: [{ name: "Email | Calendar" }], team: [{ email: "a@example.com", name: "Ann | admin", active: "no" }] });
  eq([lenient.general.workDays, lenient.general.workStart, lenient.general.workEnd, lenient.general.website], ["1,2,3,4,5", "08:00", "17:30", "https://www.example.org"], "day ranges, 12-hour times, and addresses without https are understood");
  eq(lenient.general.ticketPrefix, "Q4-", "a prefix that ends in a digit gets a hyphen, so it cannot run into the number");
  eq([K.ticketId(42, lenient), K.ticketNumber(K.ticketId(42, lenient))], ["Q4-0042", 42], "and the number reads back correctly");
  eq(lenient.statuses.map((x) => x.name + ":" + x.kind), ["Active:open", "Open:done", "New:waiting"], "an added status never repeats a name that is taken");
  eq([lenient.categories[0].name, lenient.team[0].name, lenient.team[0].active], ["Email / Calendar", "Ann / admin", false], "a vertical bar in a name becomes a slash, so text editing cannot split it");
  for (const list of L.LISTS) eq(S.normalizeSettings(Object.assign({}, lenient, { [list.id]: L.textToList(list.id, L.listToText(lenient, list.id)) }))[list.id], lenient[list.id], `${list.id} with awkward names survives a trip through text`);
  const typedIn = { accentColor: "blue", website: "www.x.org", deskName: "A", pageSize: "15", requesterCanClose: "", workStart: "8:00", workEnd: "5 pm", workDays: "1-5", holidays: "2026-12-25, 2026-12-26", ticketDigits: "04", locationMode: "text", supportEmail: "", ticketPrefix: "IT-" };
  eq(S.adjustedFields(typedIn, S.normalizeSettings({ general: typedIn })), ["Accent color"], "a value that had to be corrected is named; values that were only tidied are not");
  const unusable = { logoUrl: "javascript:x", supportEmail: "nobody", ticketDigits: "99", pageSize: "many", locationMode: "map", workStart: "18:00", workEnd: "09:00", ticketPrefix: "Q4", workDays: "weekdays", holidays: "12/25/2026", deskName: "x".repeat(90), defaultPriority: "Mega" };
  eq(S.adjustedFields(unusable, S.normalizeSettings({ general: unusable })), ["Help desk name", "Logo address", "Reply-to address", "Ticket number prefix", "Ticket number digits", "Default priority", "Location field", "Tickets per page", "Working days", "Working day starts", "Working day ends", "Days off"], "every kind of unusable value is named");
  check(S.settingsWarnings(S.normalizeSettings({ general: { timeZone: "New York" } })).some((w) => /does not look like a zone/.test(w)), "a time zone that is not a zone name is reported");

  // Renaming an item in place renames it everywhere it is used.
  const before = S.normalizeSettings(Object.assign({}, S.defaultSettings("office"), { rules: [{ category: "Printer or scanner", priority: "Urgent", assignTo: "ana@example.com" }], team: [{ email: "ana@example.com", role: "admin" }] }));
  const edited = JSON.parse(JSON.stringify(before));
  edited.statuses[3].name = "Fixed";
  edited.priorities[1].name = "Standard";
  edited.priorities[3].name = "Critical";
  edited.categories[2].name = "Printing";
  const plan = S.renamePlan(before, S.normalizeSettings(edited));
  eq(plan, { statuses: { Resolved: "Fixed" }, priorities: { Normal: "Standard", Urgent: "Critical" }, categories: { "Printer or scanner": "Printing" }, locations: {} }, "names changed in place, with nothing else changed, are renames");

  // Anything else changes the shape of the list, and then no rename is guessed.
  const variant = (change) => {
    const x = JSON.parse(JSON.stringify(before));
    change(x);
    return S.renamePlan(before, S.normalizeSettings(x));
  };
  eq(variant((x) => { x.statuses.pop(); x.statuses.push({ name: "Escalated", kind: "open" }); }).statuses, {}, "removing the last status and adding another is not a rename");
  eq(variant((x) => { x.statuses[4].name = "Archived"; x.statuses[4].kind = "open"; }).statuses, {}, "a status rename that changes the kind is refused, so finished tickets are never reopened");
  eq(variant((x) => { x.statuses[1].name = "open"; x.statuses[2].name = "Parked"; x.statuses[3].name = "Fixed"; }).statuses, {}, "a merge into another name shifts the list, so nothing is renamed");
  eq(variant((x) => { x.statuses.splice(2, 1); x.statuses[2].name = "Fixed"; }).statuses, {}, "removing one item and renaming the next is not a rename");
  eq(variant((x) => { x.priorities.shift(); x.priorities[2].name = "Critical"; }).priorities, {}, "nor is removing the first and renaming another");
  eq(variant((x) => { const a = x.categories[0]; x.categories[0] = x.categories[1]; x.categories[1] = a; }).categories, {}, "swapping two items is not a rename");
  eq(variant((x) => { x.categories[0].name = "Computer OR laptop"; }).categories, {}, "a change of capitals only is not a rename");

  // An editor that knows which row became which says so, and only that is used.
  const moved = JSON.parse(JSON.stringify(before));
  moved.categories.splice(0, 1);
  moved.categories[1].name = "Printing";
  moved.categories.push({ name: "Badge reader" });
  const told = S.renamePlan(before, S.normalizeSettings(moved), { categories: { "printer or scanner": "printing", "Computer or laptop": "Badge reader", Nope: "X" } });
  eq(told.categories, { "Printer or scanner": "Printing", "Computer or laptop": "Badge reader" }, "explicit renames are used even when the list changed shape, with the stored spelling");
  eq(S.renamePlan(before, S.normalizeSettings(moved), {}).categories, {}, "an editor that sends no renames gets none, for example when a preset replaces the lists");
  const kindChange = JSON.parse(JSON.stringify(before));
  kindChange.statuses[4] = { name: "Reopened", kind: "open" };
  eq(S.renamePlan(before, S.normalizeSettings(kindChange), { statuses: { Closed: "Reopened" } }).statuses, {}, "an explicit status rename that changes the kind is refused too");
  const carried = S.normalizeSettings(S.applyRenamesToSettings(edited, plan));
  eq([carried.general.defaultPriority, carried.rules[0].category, carried.rules[0].priority], ["Standard", "Printing", "Critical"], "the default priority and the rules follow a rename");
  const oldTicket = { status: "Resolved", priority: "Urgent", category: "Printer or scanner", location: "Main office", closedAt: "x" };
  eq(S.renameOnTicket(oldTicket, plan), { status: "Fixed", priority: "Critical", category: "Printing", location: "Main office", closedAt: "x" }, "a ticket follows a rename");
  eq(S.renameOnTicket({ status: "Open", priority: "Low", category: "Something else", location: "" }, plan), null, "a ticket that uses none of the renamed names is left alone");
  eq(S.statusKind(carried, S.renameOnTicket(oldTicket, plan).status), "done", "so a finished ticket stays finished after its status is renamed");
  eq(S.hasRenames(S.renamePlan(before, before)), false, "no change means no renames");
  eq(S.orphanWarnings(carried, [{ status: "Resolved", priority: "Low", category: "Printing" }, { status: "resolved", priority: "Low", category: "Printing" }]), ['2 tickets use the status "Resolved", which is not on the list. They count as open until its status is changed or the status is added back.'], "tickets left with a name that is off the list are reported once, whatever the capitals");
  eq(S.orphanWarnings(carried, [{ status: "Open", priority: "Gone", category: "Printing", location: "Moon" }]), ['1 ticket uses the priority "Gone", which is not on the list. It sorts below every listed priority until the priority is changed or added back.', '1 ticket uses the location "Moon", which is not on the list. Change the location on that ticket, or add it back to the list.'], "one ticket is described in the singular, and a removed location is reported");
  eq(S.orphanWarnings(S.normalizeSettings(Object.assign({}, carried, { general: Object.assign({}, carried.general, { locationMode: "text" }) })), [{ status: "Open", priority: "Low", category: "Printing", location: "Moon" }]), [], "a location typed freely is not reported");
  const noCats = S.normalizeSettings({ categories: [{ name: "General", active: false }, { name: "Other", active: false }] });
  eq(noCats.categories.filter((c) => c.active).map((c) => c.name), ["Other 2"], "the category added when every one is inactive has a name of its own");
  for (const [typed, days, clean] of [["1-5", "1,2,3,4,5", true], ["1-7", "0,1,2,3,4,5,6", true], ["5-1", "0,1,5,6", true], ["6-0", "0,6", true], ["1\u20135", "1,2,3,4,5", true], ["1 3-5", "1,3,4,5", true], ["10", "1,2,3,4,5", false], ["weekdays", "1,2,3,4,5", false]]) {
    eq([S.normalizeSettings({ general: { workDays: typed } }).general.workDays, S.parseWorkDays(typed).clean], [days, clean], "working days " + JSON.stringify(typed));
  }
  check(S.adjustedFields({ workDays: "10" }, S.normalizeSettings({ general: { workDays: "10" } })).includes("Working days") && !S.adjustedFields({ workDays: "1-7" }, S.normalizeSettings({ general: { workDays: "1-7" } })).length, "working days that could not be read are named, and readable ones are not");

  // --- Lists as rows and as text ---------------------------------------------------
  let s = S.defaultSettings("office");
  s.team = [{ email: "ana@example.com", name: "Ana", role: "admin", active: true }, { email: "ben@example.com", name: "Ben", role: "agent", active: true }, { email: "cy@example.com", name: "Cy", role: "agent", active: false }];
  s.rules = [{ category: "Printer or scanner", priority: "", location: "", keyword: "", assignTo: "ben@example.com" }, { category: "", priority: "", location: "", keyword: "vpn", assignTo: "ana@example.com" }];
  s.categories[1].assignTo = "ana@example.com";
  s = S.normalizeSettings(s);
  for (const list of L.LISTS) {
    const again = S.normalizeSettings(Object.assign({}, s, { [list.id]: L.rowsToList(list.id, L.listToRows(s, list.id)) }));
    eq(again[list.id], s[list.id], `${list.id} survives a trip through rows`);
    const viaText = S.normalizeSettings(Object.assign({}, s, { [list.id]: L.textToList(list.id, L.listToText(s, list.id)) }));
    eq(viaText[list.id], s[list.id], `${list.id} survives a trip through text`);
  }
  eq(L.textToList("team", "A@Example.com | Ann | admin\n\n  b@example.com\n"), [{ email: "A@Example.com", name: "Ann", role: "admin", active: "" }, { email: "b@example.com", name: "", role: "", active: "" }], "text lines become items and blank lines are skipped");

  // --- Creating tickets ------------------------------------------------------------
  const utc = (d) => ({ dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) });
  const ctx = (extra) => Object.assign({ now: "2026-11-13T15:00:00.000Z", number: 7, rrIndex: 0, source: "test", localParts: utc }, extra || {});
  const pat = { email: "Pat.Lee@example.com", name: "" };
  const good = { subject: "  Printer   jam ", description: "It jams.\r\nEvery time.", category: "printer or scanner", priority: "high", location: "main office" };
  let made = K.planCreate(good, pat, s, ctx());
  check(made.ok, "a valid ticket is planned");
  eq([made.ticket.id, made.ticket.subject, made.ticket.description, made.ticket.category, made.ticket.priority, made.ticket.location], ["TKT-0007", "Printer jam", "It jams.\nEvery time.", "Printer or scanner", "High", "Main office"], "fields are cleaned and matched to the lists");
  eq([made.ticket.requesterEmail, made.ticket.requesterName, made.ticket.status, made.ticket.assignedTo], ["pat.lee@example.com", "Pat Lee", "Open", "ben@example.com"], "requester, status, and rule assignment");
  eq(made.notifications.map((n) => [n.template, n.to]), [["created", ["pat.lee@example.com"]], ["teamNew", ["ben@example.com"]]], "the requester and the assignee are told");
  const none = K.planCreate({}, pat, s, ctx());
  check(!none.ok && none.errors.length === 3, "an empty form reports subject, description, and category");
  check(!K.planCreate(good, { email: "" }, s, ctx()).ok, "no email address means no ticket");
  check(!K.planCreate(Object.assign({}, good, { priority: "Mega" }), pat, s, ctx()).ok, "an unknown priority is refused");
  check(!K.planCreate(Object.assign({}, good, { location: "Moon" }), pat, s, ctx()).ok, "a location that is not on the list is refused");
  const hidden = S.normalizeSettings(Object.assign({}, s, { categories: s.categories.map((c, i) => Object.assign({}, c, { active: i !== 2 })) }));
  check(!K.planCreate(good, pat, hidden, ctx()).ok, "an inactive category is refused");
  const fixedPriority = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { requesterSetsPriority: false }) }));
  eq(K.planCreate(Object.assign({}, good, { priority: "Urgent" }), pat, fixedPriority, ctx()).ticket.priority, "Normal", "requesters cannot choose the priority when that is off");
  eq(K.planCreate(Object.assign({}, good, { priority: "Urgent" }), { email: "ana@example.com" }, fixedPriority, ctx()).ticket.priority, "Urgent", "the team still can");
  const spoof = K.planCreate(Object.assign({}, good, { requesterEmail: "boss@example.com" }), pat, s, ctx());
  eq(spoof.ticket.requesterEmail, "pat.lee@example.com", "a requester cannot create a ticket in someone else's name");
  const behalf = K.planCreate(Object.assign({}, good, { requesterEmail: "Boss@example.com", requesterName: "The Boss" }), { email: "ana@example.com" }, s, ctx());
  eq([behalf.ticket.requesterEmail, behalf.ticket.requesterName], ["boss@example.com", "The Boss"], "the team can create a ticket for someone else");
  check(behalf.activity[0].text.includes("boss@example.com"), "creating for someone else is logged");
  check(!K.planCreate(Object.assign({}, good, { requesterEmail: "not an email" }), { email: "ana@example.com" }, s, ctx()).ok, "a bad requester address is refused");
  const long = K.planCreate(Object.assign({}, good, { subject: "x".repeat(500), description: "y".repeat(9000) }), pat, s, ctx());
  eq([long.ticket.subject.length, long.ticket.description.length], [K.LIMITS.subject, K.LIMITS.description], "long text is cut to the limits");
  eq(K.ticketId(12345, s), "TKT-12345", "numbers grow past the digit width");
  eq(K.ticketNumber("TKT-0042"), 42, "the number is read back from an id");

  // --- Assignment ------------------------------------------------------------------
  const pick = (fields, settings, rr) => K.pickAssignee(Object.assign({ category: "Something else", priority: "Normal", location: "", subject: "", description: "" }, fields), settings || s, rr);
  eq(pick({ category: "Printer or scanner" }).assignedTo, "ben@example.com", "a category rule assigns");
  eq(pick({ description: "My VPN is down" }).assignedTo, "ana@example.com", "a keyword rule assigns, ignoring capitals");
  eq(pick({ category: s.categories[1].name }).assignedTo, "ana@example.com", "the category's own person is next");
  eq(pick({}).assignedTo, "", "nothing matches, so nobody");
  const rr = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { assignFallback: "roundRobin" }) }));
  eq([pick({}, rr, 0).assignedTo, pick({}, rr, 1).assignedTo, pick({}, rr, 2).assignedTo], ["ana@example.com", "ben@example.com", "ana@example.com"], "round robin takes turns among active members only");
  eq(pick({}, rr, 1).rrIndex, 2, "round robin returns the next position");
  const away = S.normalizeSettings(Object.assign({}, s, { team: s.team.map((m) => (m.email === "ben@example.com" ? Object.assign({}, m, { active: false }) : m)) }));
  eq(pick({ category: "Printer or scanner" }, away).assignedTo, "", "a rule for an inactive person is skipped");

  // --- Due times ---------------------------------------------------------------------
  const due = (start, hours, settings) => K.computeDue(start, hours, settings || s, utc);
  eq(due("2026-11-13T15:00:00.000Z", 1), "2026-11-13T16:00:00.000Z", "one working hour later the same day");
  eq(due("2026-11-13T15:00:00.000Z", 8), "2026-11-16T14:00:00.000Z", "eight hours from Friday afternoon lands on Monday");
  eq(due("2026-11-14T10:00:00.000Z", 2), "2026-11-16T10:00:00.000Z", "a Saturday ticket starts counting on Monday morning");
  eq(due("2026-11-13T21:30:00.000Z", 9), "2026-11-16T17:00:00.000Z", "a full working day ends at closing time");
  eq(due("2026-11-13T05:00:00.000Z", 1), "2026-11-13T09:00:00.000Z", "before opening, counting starts at opening");
  eq(due("2026-11-13T15:00:00.000Z", 0), "", "zero hours means no due time");
  eq(due("not a date", 4), "", "a bad start means no due time");
  const holiday = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { holidays: "2026-11-16" }) }));
  eq(due("2026-11-13T15:00:00.000Z", 8, holiday), "2026-11-17T14:00:00.000Z", "a day off is skipped");
  const calendar = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { hoursMode: "calendar" }) }));
  eq(due("2026-11-13T15:00:00.000Z", 48, calendar), "2026-11-15T15:00:00.000Z", "calendar mode counts every hour");
  const longest = due("2026-11-13T15:00:00.000Z", 8760);
  check(longest.length === 24 && longest > "2029-06-01", "the longest allowed time is counted in working hours, not cut short (" + longest + ")");
  // Clocks change in New York on 2026-11-01. Working hours must still be 8 to 5 local on both sides.
  const ny = (d) => {
    const p = {};
    for (const part of new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(d)) p[part.type] = part.value;
    return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
  };
  eq(K.computeDue("2026-10-30T20:00:00.000Z", 2, s, ny), "2026-11-02T14:00:00.000Z", "a due time across a clock change stays on local working hours");
  // Clocks go forward in New York on Sunday 2026-03-08. With Sunday a working day, a ticket from
  // Saturday evening is due at 9:00 that Sunday, local time, not at 10:00.
  const everyDay = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { workDays: "0-6" }) }));
  eq(K.computeDue("2026-03-07T23:00:00.000Z", 1, everyDay, ny), "2026-03-08T13:00:00.000Z", "the morning the clocks go forward still opens at the usual local time");
  eq(K.computeDue("2026-10-31T22:00:00.000Z", 1, everyDay, ny), "2026-11-01T14:00:00.000Z", "and the morning they go back");
  const zoneParts = (tz) => (d) => {
    const p = {};
    for (const part of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(d)) p[part.type] = part.value;
    return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
  };
  const roundTheClock = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { workStart: "00:00", workEnd: "24:00" }) }));
  eq(K.computeDue("2026-03-28T00:00:00.000Z", 1, roundTheClock, zoneParts("Europe/Berlin")), "2026-03-29T23:00:00.000Z", "skipping a 23-hour Sunday still starts Monday at local midnight");
  eq(K.computeDue("2026-03-07T00:00:00.000Z", 8, roundTheClock, zoneParts("America/New_York")), "2026-03-09T07:00:00.000Z", "the same in New York");
  const earlyOpen = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { workStart: "02:30", workDays: "0-6" }) }));
  eq(K.computeDue("2026-03-07T23:00:00.000Z", 1, earlyOpen, zoneParts("America/New_York")), "2026-03-08T08:00:00.000Z", "an opening time inside the skipped hour opens at the first moment after it");
  eq(K.computeDue("2026-11-13T12:00:00.000Z", 9, s, zoneParts("Asia/Kathmandu")), "2026-11-16T11:15:00.000Z", "a zone with a quarter-hour offset");

  // --- Updating tickets -----------------------------------------------------------------
  const t0 = made.ticket;
  const ana = { email: "ana@example.com" };
  const later = { now: "2026-11-13T16:00:00.000Z", localParts: utc };
  const stranger = K.planUpdate(t0, { reply: "hi" }, { email: "eve@example.com" }, s, later);
  check(!stranger.ok, "someone who is neither the team nor the requester is refused");
  const noop = K.planUpdate(t0, { status: "Open", assignedTo: "ben@example.com", priority: "High", category: "Printer or scanner", reply: "  ", note: "" }, ana, s, later);
  check(noop.ok && !noop.changed && noop.ticket.updatedAt === t0.updatedAt && !noop.notifications.length, "saving with nothing changed changes nothing");
  const worked = K.planUpdate(t0, { status: "In progress", assignedTo: "ana@example.com", reply: "On it.", note: "Check the roller." }, ana, s, later);
  check(worked.ok && worked.changed, "a team update is planned");
  eq([worked.ticket.status, worked.ticket.assignedTo, worked.ticket.updatedAt], ["In progress", "ana@example.com", "2026-11-13T16:00:00.000Z"], "status, assignee, and time are updated");
  eq(worked.messages.map((m) => [m.visibility, m.role, m.text]), [["public", "team", "On it."], ["internal", "team", "Check the roller."]], "a reply and an internal note are kept apart");
  eq(worked.notifications.map((n) => n.template), ["status"], "one email tells the requester about the status and the reply together");
  eq(worked.notifications[0].data.message, "On it.", "the status email carries the reply");
  const assignOther = K.planUpdate(t0, { assignedTo: "ana@example.com" }, { email: "ben@example.com" }, s, later);
  eq(assignOther.notifications.map((n) => [n.template, n.to]), [["assigned", ["ana@example.com"]]], "assigning someone else emails them");
  const clear = K.planUpdate(t0, { assignedTo: "" }, ana, s, later);
  eq(clear.ticket.assignedTo, "", "an assignment can be cleared");
  check(!K.planUpdate(t0, { assignedTo: "cy@example.com" }, ana, s, later).ok, "an inactive person cannot be assigned");
  check(!K.planUpdate(t0, { assignedTo: "someone" }, ana, s, later).ok, "the assignee must be an email address");
  check(!K.planUpdate(t0, { status: "Nope" }, ana, s, later).ok, "an unknown status is refused");
  const repri = K.planUpdate(t0, { priority: "Urgent" }, ana, s, later);
  eq(repri.ticket.dueAt, K.computeDue(t0.createdAt, 2, s, utc), "a new priority sets a new due time from when the ticket was created");
  const keepDue = K.planUpdate(t0, { priority: "Urgent", dueAt: "2026-12-01T12:00:00.000Z" }, ana, s, later);
  eq(keepDue.ticket.dueAt, "2026-12-01T12:00:00.000Z", "a due time set by hand wins");
  eq(K.planUpdate(t0, { dueAt: "" }, ana, s, later).ticket.dueAt, "", "the due time can be removed");
  check(!K.planUpdate(t0, { dueAt: "whenever" }, ana, s, later).ok, "a due time that is not a date is refused");
  const resolved = K.planUpdate(worked.ticket, { status: "Resolved" }, ana, s, { now: "2026-11-13T17:00:00.000Z", localParts: utc });
  eq([resolved.ticket.closedAt, resolved.notifications[0].template], ["2026-11-13T17:00:00.000Z", "resolved"], "finishing a ticket stamps it and sends the resolved email");
  const quiet = K.planUpdate(resolved.ticket, { status: "Closed" }, ana, s, later);
  eq(quiet.notifications.length, 0, "a status with its email turned off sends nothing");
  eq(quiet.ticket.closedAt, resolved.ticket.closedAt, "moving between finished statuses keeps the finish time");

  // Requesters
  const hack = K.planUpdate(t0, { status: "Closed", assignedTo: "", priority: "Urgent", note: "secret", subject: "x" }, pat, s, later);
  check(hack.ok && !hack.changed, "a requester cannot change status, assignee, priority, or add internal notes");
  const reply = K.planUpdate(t0, { reply: "Any news?" }, pat, s, later);
  eq(reply.messages.map((m) => [m.role, m.visibility]), [["requester", "public"]], "a requester's reply is public");
  eq(reply.notifications.map((n) => [n.template, n.to]), [["requesterReply", ["ben@example.com"]]], "the assignee is told about a requester's reply");
  const waiting = K.planUpdate(t0, { status: "Waiting on requester" }, ana, s, later).ticket;
  eq(K.planUpdate(waiting, { reply: "Here you go." }, pat, s, later).ticket.status, "Open", "a reply to a waiting ticket returns it to the first open status");
  const closedByPat = K.planUpdate(t0, { close: true }, pat, s, later);
  eq([closedByPat.ticket.status, closedByPat.ticket.closedAt], ["Resolved", later.now], "a requester can close their own ticket");
  const reopened = K.planUpdate(resolved.ticket, { reply: "It is back." }, pat, s, later);
  eq([reopened.ticket.status, reopened.ticket.closedAt], ["Open", ""], "a reply to a finished ticket reopens it");
  const silentReopen = K.planUpdate(resolved.ticket, { reopen: true }, pat, s, later);
  eq(silentReopen.notifications.map((n) => n.template), ["requesterReply"], "reopening without a message still tells the team");
  const strict = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { requesterCanClose: false, requesterCanReopen: false }) }));
  check(!K.planUpdate(t0, { close: true }, pat, strict, later).ok, "closing can be turned off for requesters");
  check(!K.planUpdate(resolved.ticket, { reply: "again" }, pat, strict, later).ok, "reopening can be turned off for requesters");
  const own = K.planCreate(good, ana, s, ctx()).ticket;
  eq(K.planUpdate(own, { reply: "more detail" }, ana, s, later).notifications.map((n) => [n.template, n.to]), [["requesterReply", ["ben@example.com"]]], "a team member writing on their own ticket tells whoever it is assigned to");
  const ownUnassigned = Object.assign({}, own, { assignedTo: "" });
  eq(K.planUpdate(ownUnassigned, { reply: "note to self" }, ana, s, later).notifications.length, 0, "nobody is emailed about their own action on their own unassigned ticket");
  eq(K.planUpdate(Object.assign({}, own, { assignedTo: "ana@example.com" }), { reply: "note to self" }, ana, s, later).notifications.length, 0, "or on a ticket they both sent and hold");
  // Closing wins over the "a reply reopens a waiting ticket" rule, and a refusal cannot be dodged.
  const closeWithWords = K.planUpdate(waiting, { reply: "Solved it myself.", close: true }, pat, s, later);
  eq([closeWithWords.ticket.status, closeWithWords.messages.length, closeWithWords.notifications.map((n) => n.template)], ["Resolved", 1, ["requesterReply"]], "a requester can close with a last message, and the team is told");
  check(/Closed by the requester/.test(closeWithWords.notifications[0].data.message), "the team's email says the requester closed it");
  check(!K.planUpdate(resolved.ticket, { reply: "again", close: true }, pat, strict, later).ok, "a reply on a closed ticket is refused when reopening is off, with or without close");
  eq(K.planUpdate(t0, { close: true }, pat, s, later).notifications.map((n) => [n.template, n.to]), [["requesterReply", ["ben@example.com"]]], "the assignee hears when a requester closes a ticket");
  // A former assignee who left the team must not be the only one told.
  eq(K.planUpdate(t0, { reply: "Hello?" }, pat, away, later).notifications[0].to, ["ana@example.com"], "a reply on a ticket whose assignee is inactive goes to the active team");
  const benMakesForAna = K.planCreate(Object.assign({}, good, { category: "Something else", requesterEmail: "ana@example.com" }), { email: "ben@example.com" }, s, ctx());
  eq(benMakesForAna.notifications.map((n) => [n.template, n.to]), [["created", ["ana@example.com"]]], "a team member who is the requester is told once, not twice");
  const urgentCategory = S.normalizeSettings(Object.assign({}, s, { categories: s.categories.map((c) => (c.name === "Network or Wi-Fi" ? Object.assign({}, c, { priority: "Urgent" }) : c)) }));
  eq(K.planCreate(Object.assign({}, good, { category: "Network or Wi-Fi", priority: "" }), pat, urgentCategory, ctx()).ticket.priority, "Urgent", "with no priority chosen, the category's own priority applies");
  const gone = Object.assign({}, t0, { status: "Legacy status" });
  eq(S.statusKind(s, gone.status), "open", "a status that left the list counts as open");

  // --- Queues ------------------------------------------------------------------------
  const mk = (n, o) => Object.assign({ id: K.ticketId(n, s), number: n, createdAt: "2026-11-10T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z", requesterEmail: "pat.lee@example.com", requesterName: "Pat Lee", subject: "S" + n, description: "", category: "Something else", priority: "Normal", location: "", status: "Open", assignedTo: "", dueAt: "", closedAt: "", source: "t" }, o);
  const now = Date.parse("2026-11-13T15:00:00.000Z");
  const all = [
    mk(1, { priority: "Low", dueAt: "2026-11-20T10:00:00.000Z" }),
    mk(2, { priority: "Urgent", assignedTo: "ana@example.com" }),
    mk(3, { priority: "Low", dueAt: "2026-11-12T10:00:00.000Z" }),
    mk(4, { status: "Waiting on requester", dueAt: "2026-11-12T10:00:00.000Z", assignedTo: "ben@example.com" }),
    mk(5, { status: "Resolved", closedAt: "2026-11-12T10:00:00.000Z", updatedAt: "2026-11-12T10:00:00.000Z" }),
    mk(6, { status: "Closed", closedAt: "2026-10-01T10:00:00.000Z", requesterEmail: "sam@example.com", subject: "Projector bulb" }),
    mk(7, { priority: "Urgent", createdAt: "2026-11-09T10:00:00.000Z", requesterEmail: "sam@example.com" }),
  ];
  const ids = (view, extra, who) => K.listTickets(all, Object.assign({ view, pageSize: 50 }, extra || {}), who || "ana@example.com", s, now).items.map((t) => t.number);
  eq(ids("open"), [3, 7, 2, 1, 4], "work order: overdue, then priority, then due time, then oldest");
  eq(ids("unassigned"), [3, 7, 1], "unassigned queue");
  eq(ids("mine"), [2], "assigned to me");
  eq(ids("overdue"), [3], "a waiting ticket is never overdue");
  eq(ids("waiting"), [4], "waiting queue");
  eq(ids("done"), [5, 6], "finished queue, newest first");
  eq(ids("all").length, 7, "all tickets");
  eq(ids("all", { query: "projector BULB" }), [6], "search matches every word, ignoring capitals");
  eq(ids("all", { query: "tkt-0007" }), [7], "search finds a ticket number");
  eq(ids("open", { priority: "urgent" }), [7, 2], "filter by priority");
  eq(ids("open", { assignedTo: "ben@example.com" }), [4], "filter by assignee");
  eq(ids("all", {}, "sam@example.com").sort(), [6, 7], "a requester only ever gets their own tickets");
  eq(ids("open", {}, "sam@example.com").sort(), [6, 7], "whatever view a requester asks for");
  const paged = K.listTickets(all, { view: "all", pageSize: 3, page: 3 }, "ana@example.com", s, now);
  eq([paged.pages, paged.page, paged.items.length, paged.total], [3, 3, 1, 7], "paging");
  eq(K.listTickets(all, { view: "all", pageSize: 3, page: 99 }, "ana@example.com", s, now).page, 3, "a page past the end becomes the last page");
  eq(K.ticketStats(all, "ana@example.com", s, now), { open: 5, unassigned: 3, mine: 1, overdue: 1, waiting: 1, done: 2, doneThisWeek: 1, total: 7, requestedOpen: 0 }, "dashboard counts");
  check(K.canSee(all[0], "ben@example.com", s) && K.canSee(all[0], "pat.lee@example.com", s) && !K.canSee(all[0], "sam@example.com", s), "who can see a ticket");
  eq(K.visibleMessages([{ visibility: "public" }, { visibility: "internal" }], "pat.lee@example.com", s).length, 1, "requesters never get internal notes");
  eq(K.visibleMessages([{ visibility: "public" }, { visibility: "internal" }], "ben@example.com", s).length, 2, "the team gets both");

  // --- Email -------------------------------------------------------------------------
  const evil = Object.assign({}, t0, { subject: `<script>alert(1)</script> & "quotes"\nBcc: x@y.z`, description: "<img src=x onerror=alert(1)>", requesterName: "<b>Pat</b>" });
  const branded = S.normalizeSettings(Object.assign({}, s, { general: Object.assign({}, s.general, { orgName: "Acme <Co>", logoUrl: "https://example.com/logo.png", website: "https://example.com", supportEmail: "help@example.com", emailFooter: "Be <kind>." }) }));
  const mail = M.renderNotification({ template: "teamNew", to: ["ben@example.com"], data: {} }, evil, branded, pat, (iso) => "DATE:" + iso);
  check(!/[\r\n]/.test(mail.subject), "the subject is one line, so nothing can add a mail header");
  check(!mail.html.includes("<script>") && !mail.html.includes("<img src=x") && !mail.html.includes("<b>Pat</b>") && !mail.html.includes("Acme <Co>") && !mail.html.includes("<kind>"), "everything typed by a person is escaped in the HTML");
  check(mail.html.includes("&lt;script&gt;") && mail.html.includes("Acme &lt;Co&gt;"), "escaped text is still shown");
  check(mail.text.includes("<img src=x onerror=alert(1)>"), "the plain text part keeps the words as typed");
  check(mail.html.includes('src="https://example.com/logo.png"') && mail.html.includes("mailto:help@example.com"), "branding appears in the email");
  eq([mail.replyTo, mail.senderName, mail.to], ["help@example.com", "Acme <Co> IT Help Desk", ["ben@example.com"]], "reply-to, sender name, and recipients");
  check(mail.text.includes("DATE:" + evil.dueAt), "the host's date format is used");
  eq(M.fillTemplate("{{ a }}-{{b}}-{{nope}}-{{constructor}}", { a: 1, b: "x" }), "1-x--", "unknown placeholders become empty");
  const noMessage = M.renderNotification({ template: "status", to: ["pat.lee@example.com"], data: { oldStatus: "Open" } }, t0, s, ana);
  check(!/\n{3,}/.test(noMessage.text), "an empty placeholder does not leave a gap of blank lines");
  for (const key of S.TEMPLATE_KEYS) {
    const m = M.renderNotification({ template: key, to: ["x@example.com"], data: { message: "Hello", oldStatus: "Open" } }, t0, s, ana);
    check(m.subject.includes("TKT-0007") && m.html.startsWith("<!DOCTYPE html>") && !m.subject.includes("{{") && !m.text.includes("{{"), `the ${key} email renders with nothing left unfilled`);
  }
  return "settings, tickets, assignment, due times, queues, and email rules hold";
}
