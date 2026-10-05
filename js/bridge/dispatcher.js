// Turns a "call" frame into a "result" frame: checks the arguments, routes to
// the tool, and makes sure a retried capture is not captured twice.

import { handlers, ToolError } from "./handlers.js";
import { WHEN, validTimeZone } from "../notes/query.js";

const REMEMBER = 100;

const bad = (message) => {
  throw new ToolError("INVALID_ARGS", message);
};

const isString = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;

// Each returns the arguments as the handler should see them, or throws.
const validators = {
  search_notes(a) {
    if (!isString(a.query, 1, 200)) bad("query must be a string of 1-200 characters");
    const limit = a.limit === undefined ? 10 : a.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) bad("limit must be an integer from 1 to 20");
    return { query: a.query, limit };
  },
  get_note(a) {
    if (!isString(a.id, 1, 200)) bad("id must be a string of 1-200 characters");
    return { id: a.id };
  },
  list_reminders(a) {
    const when = a.when === undefined ? "today" : a.when;
    if (!WHEN.includes(when)) bad(`when must be one of ${WHEN.join(", ")}`);
    const timezone = a.timezone === undefined ? "UTC" : a.timezone;
    if (!isString(timezone, 1, 64) || !validTimeZone(timezone)) bad("timezone must be an IANA name such as Europe/Istanbul");
    const limit = a.limit === undefined ? 50 : a.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad("limit must be an integer from 1 to 100");
    return { when, timezone, limit };
  },
  capture(a) {
    if (!isString(a.text, 1, 10_000)) bad("text must be a string of 1-10000 characters");
    if (a.title !== undefined && !isString(a.title, 0, 120)) bad("title must be a string of at most 120 characters");
    if (a.sourceUrl !== undefined) {
      let url;
      try {
        url = new URL(a.sourceUrl);
      } catch {
        bad("sourceUrl must be a valid URL");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") bad("sourceUrl must be an http or https URL");
    }
    return { text: a.text, sourceUrl: a.sourceUrl, title: a.title };
  },
};

// callId -> the promise of its result, so a duplicate that arrives while the
// first is still being written gets the same answer instead of a second note
const captured = new Map();

async function run(tool, args) {
  const validate = validators[tool];
  if (!validate) bad(`unknown tool: ${tool}`);
  if (!args || typeof args !== "object" || Array.isArray(args)) bad("arguments must be an object");
  return handlers[tool](validate(args));
}

function toFrame(id, promise) {
  return promise.then(
    (data) => ({ type: "result", id, ok: true, data }),
    (err) => ({
      type: "result",
      id,
      ok: false,
      error: err instanceof ToolError ? { code: err.code, message: err.message } : { code: "INTERNAL", message: "Easy Note hit an error." },
    }),
  );
}

export function dispatch({ id, tool, args }) {
  if (tool !== "capture") return toFrame(id, run(tool, args));

  const seen = captured.get(id);
  if (seen) return toFrame(id, seen);
  const pending = run(tool, args);
  captured.set(id, pending);
  if (captured.size > REMEMBER) captured.delete(captured.keys().next().value);
  // a failed capture wrote nothing, so a retry should be allowed to try again
  pending.catch(() => captured.delete(id));
  return toFrame(id, pending);
}
