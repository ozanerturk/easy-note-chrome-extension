// The undo toast. Pure UI: it knows nothing about notes, so note.js can own
// the restore without the two importing each other.

const WINDOW_MS = 8000;

const bar = document.getElementById("undo-bar");
const label = document.getElementById("undo-text");
const button = document.getElementById("undo-btn");
const meter = document.getElementById("undo-meter");

let timer = null;
let action = null;

export function hideUndo() {
  clearTimeout(timer);
  timer = null;
  action = null;
  bar.classList.remove("is-open");
}

export function hasPendingUndo() {
  return !!action;
}

export function runUndo() {
  if (!action) return false;
  const fn = action;
  hideUndo();
  fn();
  return true;
}

/**
 * Offer to reverse something for a few seconds.
 * @param {string} text  what just happened, in the user's words
 * @param {Function} onUndo  called if they take it
 */
export function offerUndo(text, onUndo) {
  clearTimeout(timer);
  action = onUndo;
  label.textContent = text;
  bar.classList.add("is-open");

  // Restart the depleting bar. Removing the class and forcing a reflow is what
  // makes the animation replay when one delete follows another.
  meter.style.animation = "none";
  void meter.offsetWidth;
  meter.style.animation = `undo-countdown ${WINDOW_MS}ms linear forwards`;

  timer = setTimeout(hideUndo, WINDOW_MS);
}

button.addEventListener("click", runUndo);
