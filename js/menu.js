// One context menu, shared by the page tree and the notes.
//
// It exists so that rows and notes can carry a single quiet affordance instead
// of a row of buttons each. Everything that used to sit permanently on screen
// waiting to be clicked lives in here now, out of sight until it is asked for.

let open = null;

export function closeMenu() {
  if (!open) return;
  open.remove();
  open = null;
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("keydown", onKey, true);
}

export function menuIsOpen() {
  return !!open;
}

function onOutside(e) {
  if (open && !open.contains(e.target)) closeMenu();
}

function onKey(e) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation(); // Escape closes the menu, not whatever is behind it
  closeMenu();
}

/**
 * Show a menu at a point.
 *
 * @param items  [{ label, run, danger, disabled }], or null for a separator
 * @param x, y   viewport coordinates, usually the pointer's
 * @param opts   `onClose` fires whichever way it goes away
 * @returns the menu element, so a caller can measure or anchor to it
 */
export function showMenu(items, x, y, { onClose } = {}) {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "ctx-menu";

  items.forEach((item) => {
    if (!item) {
      const line = document.createElement("span");
      line.className = "ctx-sep";
      menu.appendChild(line);
      return;
    }
    const button = document.createElement("button");
    button.className = "ctx-item";
    if (item.danger) button.classList.add("is-danger");
    button.textContent = item.label;
    button.disabled = !!item.disabled;
    button.addEventListener("click", () => {
      // The item decides whether the menu should stay: a colour swatch that
      // opens its own popover wants this one gone first.
      closeMenu();
      item.run();
    });
    menu.appendChild(button);
  });

  // Measured off-screen, then placed so it never hangs off an edge.
  menu.style.left = "-9999px";
  menu.style.top = "-9999px";
  document.body.appendChild(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 6))}px`;

  open = menu;
  open.__onClose = onClose;
  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);
  return menu;
}
