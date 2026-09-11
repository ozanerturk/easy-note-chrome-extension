import exprEval from "expr-eval";
import { expressionAt, formatResult, calculate, answerText } from "../js/calc.js";

const parser = new exprEval.Parser();
const evaluate = (expr) => parser.evaluate(expr);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${g}\n       want: ${w}`); }
};

console.log("What counts as a sum");

eq("a plain one", expressionAt("120*0.15"), "120*0.15");
eq("with brackets and spaces", expressionAt("(45 - 12) / 3"), "(45 - 12) / 3");
eq("at the end of a sentence", expressionAt("Tip is 120*0.15"), "120*0.15");
eq("with a space typed after it", expressionAt("12*3 "), "12*3");
eq("starting with a minus", expressionAt("-5+2"), "-5+2");
eq("a bare number is not", expressionAt("42"), null);
eq("nor a number in a sentence", expressionAt("I have 3 cats"), null);
eq("nor one bracketed on its own", expressionAt("(3)"), null);
eq("nor anything shorter than three", expressionAt("1+"), null);
eq("nor one still being typed", expressionAt("12*"), null);
eq("nor an open bracket", expressionAt("(4+"), null);
eq("nor one stuck to a word", expressionAt("x+2*3"), null);
eq("nor one after a currency sign", expressionAt("$5*3"), null);
eq("nor one with a unit in it", expressionAt("5kg*3"), null);
eq("nor one with thousands commas", expressionAt("1,000*2"), null);
eq("nor a date", expressionAt("due 2024-01-05"), null);
eq("nor a date with slashes", expressionAt("on 1/5/2024"), null);
eq("nor a phone number", expressionAt("call 555-123-4567"), null);
eq("nor a slash between words", expressionAt("and/or"), null);
eq("nor one already answered", expressionAt("120*0.15 = 18"), null);
eq("nor carrying on after an answer", expressionAt("3+4 = 7+1"), null);
eq("a simple fraction is a sum", expressionAt("3/4"), "3/4");

console.log("\nThe answer");

eq("whole numbers as they are", calculate("12*3", evaluate), "36");
eq("the example from the spec", calculate("120*0.15", evaluate), "18");
eq("precedence", calculate("2+3*4", evaluate), "14");
eq("brackets", calculate("(45-12)/3", evaluate), "11");
eq("no floating-point noise", calculate("0.1+0.2", evaluate), "0.3");
eq("four places at most", calculate("1/3", evaluate), "0.3333");
eq("negative", calculate("2-5", evaluate), "-3");
eq("no minus zero", formatResult(-0.00001), "0");
eq("dividing by zero has no answer", calculate("1/0", evaluate), null);
eq("nor does nonsense", calculate("2+*3", evaluate), null);
eq("nor an unbalanced bracket", calculate("(4+5", evaluate), null);
eq("big numbers stay numbers", calculate("99999*99999", evaluate), "9999800001");

console.log("\nWhat gets inserted");

eq("a space, then the answer", answerText("12*3", "36"), " = 36");
eq("no double space", answerText("12*3 ", "36"), "= 36");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
