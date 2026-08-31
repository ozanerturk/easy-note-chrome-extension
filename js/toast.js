// A line of text that says something happened, then goes away.
//
// Deliberately not a dialog and not a button: it confirms, it does not ask.
// The undo bar is the other half of this — that one is for things you might
// want back, this one is for things that simply took.

const el = document.getElementById("toast");

let timer = null;

export function toast(text, ms = 1800) {
  if (!el) return;
  el.textContent = text;
  el.classList.add("is-open");
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("is-open"), ms);
}
