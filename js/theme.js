// Light, dark, or whatever the system says.
//
// The choice is mirrored to localStorage for the same reason the sidebar and
// the privacy blur are: IndexedDB resolves after the first paint, so reading
// it from there would show a white page for a frame or two before going dark
// on every new tab. boot.js applies the mirror; this owns the rest.

import { getPref, setPref } from "./prefs.js";
import { markUsed } from "./tips.js";

const ORDER = ["system", "light", "dark"];

const FACE = {
  system: { icon: "🌗", title: "Theme: match the system" },
  light: { icon: "☀️", title: "Theme: light" },
  dark: { icon: "🌙", title: "Theme: dark" },
};

const button = document.getElementById("toggle-theme");

let theme = "system";

/** Put a theme on the page. `system` leaves the attribute off, which is what
 *  the prefers-color-scheme rules in the stylesheet answer to. */
export function applyTheme(next, { persist = true } = {}) {
  theme = ORDER.includes(next) ? next : "system";

  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  if (button) {
    button.textContent = FACE[theme].icon;
    button.title = `${FACE[theme].title} — click to change`;
  }

  if (!persist) return;
  setPref("theme", theme);
  try {
    localStorage.setItem("easynote:theme", theme);
  } catch (e) {
    /* private mode or storage disabled: the pref is still the record */
  }
}

export function initTheme() {
  // boot.js already stamped the attribute from localStorage; this only syncs
  // the button, and covers a profile whose choice arrived by sync.
  let stored = null;
  try {
    stored = localStorage.getItem("easynote:theme");
  } catch (e) {
    /* ignore */
  }
  applyTheme(stored || getPref("theme", "system"), { persist: false });

  if (button) {
    button.addEventListener("click", () => {
      markUsed("theme"); // the boot-time restore below does not count
      applyTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);
    });
  }
}
