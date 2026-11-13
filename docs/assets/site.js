/**
 * Small behaviors for the website: the Dark, Light, System theme choice and tabbed guides.
 */
import { initTheme, setTheme, themeChoice } from "../app/ui/dom.js";

initTheme();

function drawThemePick() {
  document.querySelectorAll(".theme-pick button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.theme === themeChoice() ? "true" : "false");
  });
}

document.querySelectorAll(".theme-pick button").forEach((b) => {
  b.addEventListener("click", () => {
    setTheme(b.dataset.theme);
    drawThemePick();
  });
});
drawThemePick();
// The app's own menu can change the theme too; keep these buttons in step with it.
document.addEventListener("helpdesk-theme", drawThemePick);

// Tabs: <div class="tabs" role="tablist"> with buttons whose aria-controls name a .tab-panel.
document.querySelectorAll(".tabs").forEach((tabs) => {
  const buttons = Array.from(tabs.querySelectorAll("button[aria-controls]"));
  const select = (button, focus) => {
    buttons.forEach((b) => {
      const on = b === button;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(b.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    });
    if (focus) button.focus();
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => {
      select(b, false);
      if (b.dataset.hash) history.replaceState(null, "", "#" + b.dataset.hash);
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") select(buttons[(i + 1) % buttons.length], true);
      if (e.key === "ArrowLeft") select(buttons[(i - 1 + buttons.length) % buttons.length], true);
    });
  });
  // Open the tab the address points at: either the tab itself (#outlook) or something inside
  // its panel (#outlook-permissions), and then scroll to that place.
  const openFromHash = () => {
    const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const tab = target && buttons.find((b) => {
      const panel = document.getElementById(b.getAttribute("aria-controls"));
      return panel && (panel === target || panel.contains(target));
    });
    select(tab || buttons[0], false);
    if (tab && target && target.id !== tab.getAttribute("aria-controls")) target.scrollIntoView();
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
});
