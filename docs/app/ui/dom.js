/**
 * Small helpers for building the screens: elements, form fields, dates, and the theme.
 * Text typed by people is always placed with textContent, never as HTML.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */

/** Creates an element. attrs: class, text, on<event> handlers, and plain attributes. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  const a = attrs || {};
  for (const key of Object.keys(a)) {
    const v = a[key];
    if (v === null || v === undefined || v === false || key === "value") continue;
    if (key === "class") el.className = v;
    else if (key === "text") el.textContent = v;
    else if (key.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(key.slice(2), v);
    else if (v === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(v));
  }
  const add = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(add);
    else el.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  };
  children.forEach(add);
  if (a.value !== undefined && a.value !== null) el.value = a.value; // After the children, so a <select> has its options.
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let fieldCount = 0;

/**
 * A labeled form field. spec: { label, name, type, value, options, hint, required, rows,
 * placeholder, list }. type: text, email, url, number, time, color, datetime, textarea,
 * select, or checkbox. options for select: [value] or [{ value, label }].
 * Returns { el, input, get(), set(v) }.
 */
export function field(spec) {
  const id = "f" + ++fieldCount;
  const s = spec;
  let input;
  if (s.type === "textarea") {
    input = h("textarea", { id, name: s.name, rows: s.rows || 4, placeholder: s.placeholder, maxlength: s.max });
    input.value = s.value || "";
  } else if (s.type === "select") {
    input = h(
      "select",
      { id, name: s.name },
      (s.options || []).map((o) => {
        const opt = typeof o === "object" ? o : { value: o, label: o };
        return h("option", { value: opt.value, text: opt.label });
      })
    );
    const values = (s.options || []).map((o) => String(typeof o === "object" ? o.value : o));
    const want = String(s.value === undefined || s.value === null ? "" : s.value);
    if (values.includes(want)) input.value = want;
    else if (want !== "") {
      input.insertBefore(h("option", { value: want, text: want }), input.firstChild);
      input.value = want;
    }
  } else if (s.type === "checkbox") {
    input = h("input", { id, name: s.name, type: "checkbox" });
    input.checked = !!s.value;
  } else {
    const type = s.type === "datetime" ? "datetime-local" : s.type || "text";
    input = h("input", { id, name: s.name, type, placeholder: s.placeholder, maxlength: s.max, min: s.min, max: s.type === "number" ? s.maxValue : undefined, list: s.list, autocomplete: s.autocomplete || "off" });
    input.value = s.value === undefined || s.value === null ? "" : String(s.value);
  }
  if (s.required) input.setAttribute("aria-required", "true");
  const hint = s.hint ? h("p", { class: "hint", id: id + "h", text: s.hint }) : null;
  if (hint) input.setAttribute("aria-describedby", id + "h");
  const el =
    s.type === "checkbox"
      ? h("div", { class: "field check" }, h("label", { for: id }, input, h("span", { text: s.label })), hint)
      : h("div", { class: "field" }, h("label", { for: id, text: s.label + (s.required ? " *" : "") }), input, hint);
  return {
    el,
    input,
    get: () => (s.type === "checkbox" ? input.checked : input.value),
    set: (v) => {
      if (s.type === "checkbox") input.checked = !!v;
      else input.value = v === undefined || v === null ? "" : v;
    },
  };
}

/** A button. kind: "primary", "quiet", or "" for the standard look. */
export function button(label, onClick, kind, attrs) {
  return h("button", Object.assign({ type: "button", class: "btn" + (kind ? " " + kind : ""), onclick: onClick }, attrs || {}), label);
}

/**
 * Runs an async task for a button. While it runs, the button and every other button in the
 * same panel or form are disabled, so neither a second press nor a neighboring button can send
 * a second request. They are always enabled again.
 */
export async function busy(el, task) {
  if (el && el.disabled) return undefined;
  const scope = el && el.closest ? el.closest(".panel, form, .items-box") : null;
  const others = scope ? Array.from(scope.querySelectorAll("button")).filter((b) => b !== el && !b.disabled) : [];
  if (el) {
    el.disabled = true;
    el.setAttribute("aria-busy", "true");
  }
  others.forEach((b) => (b.disabled = true));
  try {
    return await task();
  } finally {
    if (el) {
      el.disabled = false;
      el.removeAttribute("aria-busy");
    }
    others.forEach((b) => (b.disabled = false));
  }
}

/** "Nov 13, 2:05 PM" in the reader's own time zone. */
export function shortDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const options = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (!sameYear) options.year = "numeric";
  return new Intl.DateTimeFormat(undefined, options).format(d);
}

/** The value a datetime-local input needs for an ISO time, in local time. */
export function toLocalInput(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An ISO time from a datetime-local value; "" when empty; null when unreadable. */
export function fromLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// --- Theme -------------------------------------------------------------------

const THEME_KEY = "helpdesk.theme";
export const THEMES = ["dark", "light", "system"];

function stored() {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : "dark";
  } catch (e) {
    return "dark";
  }
}

/** The saved choice: dark (the default), light, or system. */
export function themeChoice() {
  return stored();
}

/** Applies a choice to the page. "system" follows the device setting and keeps following it. */
export function applyTheme(choice) {
  const pick = THEMES.includes(choice) ? choice : stored();
  const systemLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.setAttribute("data-theme", pick === "system" ? (systemLight ? "light" : "dark") : pick);
  document.documentElement.setAttribute("data-theme-choice", pick);
}

export function setTheme(choice) {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch (e) {
    // Storage is blocked; the choice lasts for this page view.
  }
  applyTheme(choice);
  // Other theme controls on the page (the site header, the app's menu) redraw themselves.
  document.dispatchEvent(new Event("helpdesk-theme"));
}

/** Call once per page. Keeps "system" in step with the device while the page is open. */
export function initTheme() {
  applyTheme(stored());
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (document.documentElement.getAttribute("data-theme-choice") === "system") applyTheme("system");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}
