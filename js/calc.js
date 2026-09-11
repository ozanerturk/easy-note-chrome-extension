// Sums in a note: what counts as one, and how its answer is written.
//
// A note is full of things that look like arithmetic and are not — dates,
// phone numbers, "3-4 people", "and/or". So this is deliberately narrow: a run
// of digits and + - * / ( ) at the end of the line, standing on its own, with
// at least one operator between two numbers in it. Anything unsure is not a
// sum; a missed answer costs nothing, a wrong one in the middle of a sentence
// is noise.
//
// Pure, and handed its evaluator, so the rules can be tested in node.

// The characters a sum is made of. Letters, units, currency, commas and "="
// are not among them, so none of those can ever reach the evaluator.
const TAIL = /[\d.+\-*/() ]+$/;

// Two numbers with an operator between them: "12*3", "(4 + 5)", "2 - -1".
const BINARY = /[\d.)]\s*[+\-*/]\s*[-(.\d]/;

// 2024-01-05, 555-123-4567, 1/5/2024: three or more runs of digits joined by
// the same one of - or /, with no spaces. Arithmetic, technically; not what
// anyone typing them meant.
const DATE_LIKE = /^\d+([-/])\d+(\1\d+)+$/;

/**
 * The sum at the end of a line of text, or null.
 *
 * `text` is the line up to the caret. Returns the expression exactly as typed
 * (without the spaces around it), which is what gets evaluated.
 */
export function expressionAt(text) {
  const match = TAIL.exec(String(text || ""));
  if (!match) return null;

  const lead = match[0].length - match[0].trimStart().length;
  const expr = match[0].trim();
  const before = text.slice(0, match.index + lead);

  // On its own: at the start of the line or after a space. "x+2" and "$5*3"
  // are a word with a sum stuck to it, not a sum.
  if (before && !/\s$/.test(before)) return null;
  // Right after an answer — "3+4 = 7+1" — is a sentence about a sum, not one.
  if (/=\s*$/.test(before)) return null;

  if (expr.length < 3) return null;
  if (!/^[-(.\d]/.test(expr) || !/[\d)]$/.test(expr)) return null; // half-typed
  if (!BINARY.test(expr)) return null; // a bare number, or "(3)"
  if (DATE_LIKE.test(expr)) return null;
  return expr;
}

/**
 * A number the way a person would write the answer: whole numbers as they
 * are, anything else to at most four places with the trailing zeros gone —
 * 0.1+0.2 is 0.3, not 0.30000000000000004.
 */
export function formatResult(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(4)) || 0); // `|| 0` folds -0 into 0
}

/** Evaluate an expression and format its answer, or null if it has none. */
export function calculate(expr, evaluate) {
  try {
    return formatResult(evaluate(expr));
  } catch (e) {
    return null; // "2+*3", "(4", and friends: no answer, and no fuss
  }
}

/**
 * What the ghost says and what accepting it inserts — the same string, so the
 * ghost can simply turn solid. A space before the "=" unless the line already
 * ends in one.
 */
export function answerText(line, result) {
  return `${/\s$/.test(line) ? "" : " "}= ${result}`;
}
