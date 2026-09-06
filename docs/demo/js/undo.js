// The undo toast. Pure UI: it names one step from the history stack and offers
// a button that walks back to it, so the bar and ⌘Z can never disagree about
// what "undo" means.

import { undoTo } from "./history.js";

const WINDOW_MS = 8000;

const bar = document.getElementById("undo-bar");
const label = document.getElementById("undo-text");
const button = document.getElementById("undo-btn");
const meter = document.getElementById("undo-meter");

let timer = null;
let offered = null;

export function hideUndo() {
  clearTimeout(timer);
  timer = null;
  offered = null;
  bar.classList.remove("is-open");
}

export function runUndo() {
  if (!offered) return false;
  const step = offered;
  hideUndo();
  undoTo(step);
  return true;
}

/**
 * Say what just happened, and offer to reverse it for a few seconds.
 *
 * @param {string} text  what just happened, in the user's words
 * @param {object} step  the recorded history step the button walks back to
 */
export function offerUndo(text, step) {
  clearTimeout(timer);
  offered = step;
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
