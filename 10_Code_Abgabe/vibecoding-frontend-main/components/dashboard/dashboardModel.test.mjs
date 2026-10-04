import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile the model in memory (its relative import is rewritten to the real file),
// so the tests run the actual implementation without Next's resolver.
const compiled = ts.transpileModule(await readFile(new URL("./dashboardModel.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('"../courses/documentIndexing"', JSON.stringify(new URL("../courses/documentIndexing.ts", import.meta.url).href));
const { upcomingEvents, nextEventByCourse, eventDayLabel, recentDocuments, attentionDocuments, documentTypeLabel } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime(); // 25.09.2026 12:00 local
const at = (day, hour = 0, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
const event = (id, patch) => ({ id, courseId: null, allDay: false, endsAt: null, ...patch });

test("past events are excluded and upcoming events are sorted chronologically", () => {
  const events = [
    event("later", { startsAt: at(30, 9) }),
    event("past", { startsAt: at(24, 9), endsAt: at(24, 10) }),
    event("soon", { startsAt: at(26, 9) }),
    event("just-ended", { startsAt: at(25, 9), endsAt: at(25, 11) }),
  ];
  assert.deepEqual(upcomingEvents(events, NOW).map((e) => e.id), ["soon", "later"]);
});

test("an event without an end is over once its start has passed", () => {
  assert.deepEqual(upcomingEvents([event("a", { startsAt: at(25, 11, 59) })], NOW), []);
  assert.deepEqual(upcomingEvents([event("b", { startsAt: at(25, 12, 0) })], NOW).map((e) => e.id), ["b"]);
});

test("ongoing events are still shown until they end", () => {
  const running = event("running", { startsAt: at(25, 11), endsAt: at(25, 13) });
  assert.deepEqual(upcomingEvents([running], NOW).map((e) => e.id), ["running"]);
});

test("all-day events count for the whole day, with or without an end", () => {
  const today = event("today", { startsAt: at(25, 0, 0), allDay: true });
  const todayWithEnd = event("today-end", { startsAt: at(25, 0, 0), endsAt: at(25, 23, 59), allDay: true });
  const yesterday = event("yesterday", { startsAt: at(24, 0, 0), endsAt: at(24, 23, 59), allDay: true });
  const multiDay = event("multi", { startsAt: at(24, 0, 0), endsAt: at(26, 23, 59), allDay: true });
  assert.deepEqual(upcomingEvents([yesterday, today, todayWithEnd, multiDay], NOW).map((e) => e.id).sort(), ["multi", "today", "today-end"]);
});

test("the limit is applied after sorting", () => {
  const events = ["5", "3", "4", "1", "2"].map((n) => event(n, { startsAt: at(26 + Number(n), 9) }));
  assert.deepEqual(upcomingEvents(events, NOW, 2).map((e) => e.id), ["1", "2"]);
});

test("the next event of each course ignores past events and events without a course", () => {
  const events = [
    event("a-past", { courseId: "a", startsAt: at(20, 9) }),
    event("a-2", { courseId: "a", startsAt: at(29, 9) }),
    event("a-1", { courseId: "a", startsAt: at(27, 9) }),
    event("b-1", { courseId: "b", startsAt: at(28, 9) }),
    event("private", { courseId: null, startsAt: at(26, 9) }),
  ];
  const next = nextEventByCourse(events, NOW);
  assert.deepEqual([...next.keys()].sort(), ["a", "b"]);
  assert.equal(next.get("a").id, "a-1");
});

test("day labels distinguish ongoing, today, tomorrow and later days", () => {
  assert.equal(eventDayLabel(at(24, 9), NOW), "Läuft");
  assert.equal(eventDayLabel(at(25, 18), NOW), "Heute");
  assert.equal(eventDayLabel(at(26, 8), NOW), "Morgen");
  assert.match(eventDayLabel(at(30, 8), NOW), /30/);
});

const doc = (id, addedAt, state = {}) => ({
  materialId: id, courseId: "c", fileId: `f-${id}`, name: `${id}.pdf`, mimeType: "application/pdf", addedAt,
  state: { processingStatus: "ready", errorCode: null, indexingStatus: "ready", indexingError: null, ...state },
});

test("recent documents are newest first and limited", () => {
  const docs = [doc("old", at(1)), doc("new", at(20)), doc("mid", at(10)), doc("older", at(2))];
  assert.deepEqual(recentDocuments(docs, 3).map((d) => d.materialId), ["new", "mid", "older"]);
  assert.equal(docs[0].materialId, "old", "the input is not reordered");
});

test("attention lists failed and in-progress documents but not ready ones", () => {
  const docs = [
    doc("ready", at(1)),
    doc("running", at(2), { processingStatus: "processing", indexingStatus: "pending" }),
    doc("failed", at(3), { processingStatus: "failed", errorCode: "UNSUPPORTED_FORMAT", indexingStatus: "pending" }),
    doc("indexing", at(4), { indexingStatus: "processing" }),
    doc("index-failed", at(5), { indexingStatus: "failed", indexingError: "INDEXING_TIMEOUT" }),
  ];
  const { items, total } = attentionDocuments(docs);
  assert.deepEqual(items.map((i) => i.document.materialId), ["failed", "index-failed", "running", "indexing"]);
  assert.equal(total, 4);
  assert.deepEqual(items.map((i) => i.progress.tone), ["failed", "failed", "active", "active"]);
});

test("attention keeps the total when the list is limited and is empty when nothing needs attention", () => {
  const many = Array.from({ length: 7 }, (_, i) => doc(`d${i}`, at(1), { indexingStatus: "pending" }));
  const { items, total } = attentionDocuments(many, 5);
  assert.equal(items.length, 5);
  assert.equal(total, 7);
  assert.deepEqual(attentionDocuments([doc("ok", at(1))]), { items: [], total: 0 });
});

test("document type labels", () => {
  assert.equal(documentTypeLabel("application/pdf"), "PDF");
  assert.equal(documentTypeLabel("text/plain"), "TXT");
  assert.equal(documentTypeLabel("image/png"), "Datei");
});

test("the dashboard code contains no fixture or preview data", async () => {
  const files = ["DashboardOverview.tsx", "dashboardModel.ts", "../../app/dashboard/page.tsx", "../home.module.css", "../../lib/supabase/queries/dashboard.ts"];
  const forbidden = [/PRODUKTVORSCHAU/i, /Beispieldaten/i, /illustrativ/i, /fixture/i, /mock/i, /Vibe Coding/, /Network Security/, /Threat Modeling/, /Math\.random/];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} must not match ${pattern}`);
  }
});
