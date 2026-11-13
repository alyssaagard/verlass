/**
 * The customizable lists (categories, priorities, statuses, locations, team, rules) as tables.
 *
 * LISTS describes each list's columns once. The spreadsheet tabs, the Gmail settings cards
 * (one item per line, columns separated by " | "), and the web settings screen all use it.
 */

export const LISTS = [
  {
    id: "categories",
    title: "Categories",
    help: "What a request is about. A category can send its tickets to one person and set their priority.",
    columns: [
      { key: "name", label: "Category", type: "text" },
      { key: "assignTo", label: "Assign to", type: "email" },
      { key: "priority", label: "Priority", type: "text" },
      { key: "active", label: "Active", type: "bool" },
    ],
  },
  {
    id: "priorities",
    title: "Priorities",
    help: "Listed from lowest to highest. Due in hours sets the due time; 0 means no due time.",
    columns: [
      { key: "name", label: "Priority", type: "text" },
      { key: "hint", label: "Shown hint", type: "text" },
      { key: "dueHours", label: "Due in hours", type: "number" },
    ],
  },
  {
    id: "statuses",
    title: "Statuses",
    help: "Kind is open, waiting, or done. New tickets get the first open status. The first done status is used when a requester closes a ticket.",
    columns: [
      { key: "name", label: "Status", type: "text" },
      { key: "kind", label: "Kind", type: "text" },
      { key: "notify", label: "Email requester", type: "bool" },
    ],
  },
  {
    id: "locations",
    title: "Locations",
    help: "Places a requester can choose, such as offices, rooms, sites, or departments.",
    columns: [{ key: "name", label: "Location", type: "text" }],
  },
  {
    id: "team",
    title: "Team",
    help: "The people who work on tickets. Role is agent or admin. Admins can change settings.",
    columns: [
      { key: "email", label: "Email", type: "email" },
      { key: "name", label: "Name", type: "text" },
      { key: "role", label: "Role", type: "text" },
      { key: "active", label: "Active", type: "bool" },
    ],
  },
  {
    id: "rules",
    title: "Assignment rules",
    help: "The first rule that matches a new ticket assigns it. An empty column matches anything. Keyword looks in the subject and description.",
    columns: [
      { key: "category", label: "Category", type: "text" },
      { key: "priority", label: "Priority", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "keyword", label: "Keyword", type: "text" },
      { key: "assignTo", label: "Assign to", type: "email" },
    ],
  },
];

export function listById(id) {
  return LISTS.find((l) => l.id === id) || null;
}

/** The items of one list as objects. Locations are stored as plain text, so they are wrapped. */
export function listItems(settings, id) {
  const items = settings[id] || [];
  return id === "locations" ? items.map((name) => ({ name })) : items;
}

function cellText(value, type) {
  if (type === "bool") return value ? "yes" : "no";
  if (value === null || value === undefined) return "";
  return String(value);
}

/** A list as rows of text cells, in column order (no header row). */
export function listToRows(settings, id) {
  const def = listById(id);
  return listItems(settings, id).map((item) => def.columns.map((c) => cellText(item[c.key], c.type)));
}

/**
 * Rows of cells back into list items. The result still goes through normalizeSettings, which
 * validates every value, so this only maps columns to keys.
 */
export function rowsToList(id, rows) {
  const def = listById(id);
  const items = (rows || [])
    .filter((row) => row && row.some((cell) => String(cell === null || cell === undefined ? "" : cell).trim() !== ""))
    .map((row) => {
      const item = {};
      def.columns.forEach((c, i) => {
        const cell = row[i];
        item[c.key] = cell === null || cell === undefined ? "" : typeof cell === "string" ? cell.trim() : cell;
      });
      return item;
    });
  return id === "locations" ? items.map((item) => String(item.name)) : items;
}

/** A list as editable text: one item per line, columns separated by " | ". */
export function listToText(settings, id) {
  return listToRows(settings, id)
    .map((row) => {
      const cells = row.slice();
      while (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
      return cells.join(" | ");
    })
    .join("\n");
}

/** Editable text back into list items. */
export function textToList(id, text) {
  const rows = String(text || "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.split("|").map((cell) => cell.trim()));
  return rowsToList(id, rows);
}

/** The header line that explains the text format, such as "Category | Assign to | Priority | Active". */
export function listFormat(id) {
  return listById(id).columns.map((c) => c.label).join(" | ");
}

/** The column an item cannot do without: who a rule assigns to, a member's email, or a name. */
export function requiredColumn(id) {
  const key = id === "rules" ? "assignTo" : id === "team" ? "email" : "name";
  return listById(id).columns.find((c) => c.key === key);
}

/**
 * Looks for an item that would be dropped when saved because its required column is empty.
 * Returns "" when every item is complete, or a sentence that says which one is not.
 */
export function incompleteItem(id, items) {
  const column = requiredColumn(id);
  const index = (items || []).findIndex((item) => {
    const value = typeof item === "string" ? item : item && item[column.key];
    return !String(value === null || value === undefined ? "" : value).trim();
  });
  return index === -1 ? "" : "Item " + (index + 1) + ' needs a value for "' + column.label + '".';
}
