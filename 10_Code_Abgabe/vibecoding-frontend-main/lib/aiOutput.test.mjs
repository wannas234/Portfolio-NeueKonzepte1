import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanProse, discardedNotice, parseQuiz, stripCitationMarkers, stripCodeFence } from "./aiOutput.ts";


test("citation markers: only exact [n] markers are removed, prose and content stay", () => {
  assert.equal(stripCitationMarkers("Ein Prozess ist aktiv [1]."), "Ein Prozess ist aktiv.");
  assert.equal(stripCitationMarkers("Zwei Belege [1][2] hier"), "Zwei Belege hier");
  assert.equal(stripCitationMarkers("Ohne Leerzeichen.[3] Weiter"), "Ohne Leerzeichen. Weiter");
  assert.equal(stripCitationMarkers("Mitte [1]folgt"), "Mitte folgt");
  // Markers attached directly to normal text are still markers.
  assert.equal(stripCitationMarkers("Vertraulichkeit schützt Informationen[1]."), "Vertraulichkeit schützt Informationen.");
  assert.equal(stripCitationMarkers("Wort[1][2]."), "Wort.");
  assert.equal(stripCitationMarkers(" Aussage[1][2]"), " Aussage");
  assert.equal(stripCitationMarkers("Ein Satz [1] geht weiter."), "Ein Satz geht weiter.");
  assert.equal(stripCitationMarkers("Siehe [4]."), "Siehe.");
  // Code is protected, also next to text and markers.
  assert.equal(stripCitationMarkers("`arr[1]`"), "`arr[1]`");
  const fenced = "```js\nconst a = [1];\nb = arr[1];\n```";
  assert.equal(stripCitationMarkers(fenced), fenced);
  assert.equal(stripCitationMarkers("Der Zugriff `arr[1]` liefert das zweite Element[1]. Mehr dazu[2][3]"), "Der Zugriff `arr[1]` liefert das zweite Element. Mehr dazu");
  assert.equal(stripCitationMarkers("Text[1]\n```\nx[1]\n```\nEnde[2]"), "Text\n```\nx[1]\n```\nEnde");
  // Content that only looks similar is untouched.
  for (const keep of ["`x [1]` bleibt", "[Hinweis] bleibt", "Intervall [0, 1]", "[1,2]", "[100]", "[0]", "siehe [1](http://x)", "[1]: Fußnote", "f(x) = [a+b]"]) {
    assert.equal(stripCitationMarkers(keep), keep);
  }
});

test("code fence: only a fence around the whole answer is removed", () => {
  assert.equal(stripCodeFence("```text\nF1: a\nA1: b\n```"), "F1: a\nA1: b");
  assert.equal(stripCodeFence("```\r\nF1: a\r\n```\r\n"), "F1: a");
  assert.equal(stripCodeFence("Vorher\n```\ncode\n```"), "Vorher\n```\ncode\n```");
});

const Q = (n, key = "B") => `F${n}: Frage ${n}?\nO${n}A: Alpha ${n}\nO${n}B: Beta ${n}\nO${n}C: Gamma ${n}\nO${n}D: Delta ${n}\nK${n}: ${key}\nE${n}: Weil ${n}.`;
const quiz = (text) => { const r = parseQuiz(text); assert.ok(r.ok, "expected ok"); return r; };

test("quiz: canonical format", () => {
  const r = quiz(Q(1) + "\n" + Q(2, "D"));
  assert.equal(r.questions.length, 2);
  assert.deepEqual(r.questions[0], { question: "Frage 1?", options: ["Alpha 1", "Beta 1", "Gamma 1", "Delta 1"], correctIndex: 1, explanation: "Weil 1." });
  assert.equal(r.questions[1].correctIndex, 3);
  assert.equal(r.discarded, 0);
});

test("quiz: whitespace, blank lines and CRLF", () => {
  const messy = ("\n  " + Q(1).replace(/\n/g, "\n\n   ") + "  \n").replace(/\n/g, "\r\n");
  assert.equal(quiz(messy).questions.length, 1);
});

test("quiz: code fence, numbering and key formatting such as 'B)'", () => {
  assert.equal(quiz("```\n" + Q(1) + "\n```").questions.length, 1);
  assert.equal(quiz(Q(1).split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n")).questions.length, 1);
  assert.equal(quiz(Q(1).replace("K1: B", "K1: c)")).questions[0].correctIndex, 2);
});

test("quiz: a missing option discards the question instead of shifting the letters", () => {
  const r = parseQuiz(Q(1).replace(/O1B:.*\n/, "") + "\n" + Q(2));
  assert.ok(r.ok);
  assert.deepEqual(r.questions.map((q) => q.question), ["Frage 2?"]);
  assert.equal(r.discarded, 1);
});

test("quiz: missing, unreadable or out-of-range correct answer is never guessed", () => {
  for (const broken of [Q(1).replace(/K1:.*\n/, ""), Q(1).replace("K1: B", "K1:"), Q(1).replace("K1: B", "K1: E"), Q(1).replace("K1: B", "K1: B ist richtig"), Q(1).replace("K1: B", "K1: Beta 1"), Q(1).replace("K1: B", "K1: AB")]) {
    assert.deepEqual(parseQuiz(broken), { ok: false }, broken);
  }
  assert.deepEqual(parseQuiz(Q(1) + "\nK1: C"), { ok: false }); // repeated key is ambiguous
});

test("quiz: missing explanation or duplicate option texts discard the question", () => {
  assert.deepEqual(parseQuiz(Q(1).replace(/\nE1:.*/, "")), { ok: false });
  assert.deepEqual(parseQuiz(Q(1).replace("Gamma 1", "alpha 1")), { ok: false });
});

test("quiz: incomplete last question is discarded and reported", () => {
  const r = quiz(Q(1) + "\nF2: Abgeschnitten\nO2A: Alpha\nO2B: Be");
  assert.equal(r.questions.length, 1);
  assert.equal(r.discarded, 1);
});

test("quiz: citation markers are removed but real content brackets survive", () => {
  const text = Q(1).replace("Frage 1?", "Was liefert `arr[1]`? [1]").replace("Alpha 1", "Das zweite Element [2]").replace("Weil 1.", "Laut Skript [1][3].");
  const r = quiz(text);
  assert.equal(r.questions[0].question, "Was liefert `arr[1]`?");
  assert.equal(r.questions[0].options[0], "Das zweite Element");
  assert.equal(r.questions[0].explanation, "Laut Skript.");
});

test("quiz: completely invalid answers are rejected", () => {
  assert.deepEqual(parseQuiz("Ich kann dazu leider nichts sagen."), { ok: false });
  assert.deepEqual(parseQuiz(""), { ok: false });
  assert.deepEqual(parseQuiz("F1: Nur eine Frage"), { ok: false });
});

test("free prose: citation markers go, content and paragraphs stay, empty is detected", () => {
  assert.equal(cleanProse("Erster Absatz [1].\r\n\r\n\r\n\r\nZweiter mit `a[1]` und [x] [2]  \n"), "Erster Absatz.\n\nZweiter mit `a[1]` und [x]");
  assert.equal(cleanProse("```js\nconst a = [1];\n```"), "```js\nconst a = [1];\n```");
  assert.equal(cleanProse("   \n "), null);
  assert.equal(cleanProse("[1]"), null);
});

test("discarded notice is only shown when something was dropped", () => {
  assert.equal(discardedNotice(0), null);
  assert.match(discardedNotice(1), /^1 unvollständiger Eintrag wurde verworfen/);
  assert.match(discardedNotice(3), /^3 unvollständige Einträge wurden verworfen/);
});
