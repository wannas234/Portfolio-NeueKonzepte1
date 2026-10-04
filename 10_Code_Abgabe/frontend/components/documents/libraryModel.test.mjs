import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile the model in memory (its relative import is rewritten to the real file),
// so the tests run the actual implementation without Next's resolver.
const compiled = ts.transpileModule(await readFile(new URL("./libraryModel.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('"../courses/documentIndexing"', JSON.stringify(new URL("../courses/documentIndexing.ts", import.meta.url).href));
const { DEFAULT_FILTERS, applyFilters, courseOptions, documentTypeLabel, formatFileSize, hasActiveFilters, searchTerms, statusGroup, toEntries } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const READY = { processingStatus: "ready", errorCode: null, indexingStatus: "ready", indexingError: null };
const doc = (id, patch = {}) => ({
  documentId: `d-${id}`, materialId: `m-${id}`, fileId: `f-${id}`, courseId: "c1", courseTitle: "Netzwerksicherheit", lectureTitle: null,
  name: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 2048, uploadedAt: "2026-09-10T10:00:00Z",
  fileStatus: "ready", state: READY, ...patch,
});
const ids = (entries) => entries.map((entry) => entry.document.fileId.slice(2));
const run = (docs, filters = {}) => ids(applyFilters(toEntries(docs), { ...DEFAULT_FILTERS, ...filters }));

const processing = { processingStatus: "processing", indexingStatus: "pending" };
const failed = { processingStatus: "failed", errorCode: "UNSUPPORTED_FORMAT", indexingStatus: "pending" };
const indexingFailed = { indexingStatus: "failed", indexingError: "INDEXING_TIMEOUT" };

test("documents are newest first by default, independent of the input order", () => {
  const docs = [
    doc("mid", { uploadedAt: "2026-09-15T10:00:00Z" }),
    doc("old", { uploadedAt: "2026-09-01T10:00:00Z" }),
    doc("new", { uploadedAt: "2026-09-20T10:00:00Z" }),
  ];
  assert.deepEqual(run(docs), ["new", "mid", "old"]);
  assert.deepEqual(run([...docs].reverse()), ["new", "mid", "old"]);
});

test("search matches the file name case-insensitively", () => {
  const docs = [doc("Vorlesung 1"), doc("Übung 2"), doc("Skript")];
  assert.deepEqual(run(docs, { query: "VORLESUNG" }), ["Vorlesung 1"]);
  assert.deepEqual(run(docs, { query: "übung" }), ["Übung 2"]);
});

test("search also matches the course title", () => {
  const docs = [doc("a", { courseTitle: "Analysis" }), doc("b", { courseTitle: "Netzwerksicherheit" })];
  assert.deepEqual(run(docs, { query: "netzwerk" }), ["b"]);
});

test("search also matches the lecture title", () => {
  const docs = [doc("a", { lectureTitle: "VL 3 – Kryptographie" }), doc("b")];
  assert.deepEqual(run(docs, { query: "krypto" }), ["a"]);
});

test("search ignores surrounding and repeated whitespace, and every word must match", () => {
  const docs = [doc("Protokoll", { courseTitle: "Analysis" }), doc("Protokoll", { fileId: "f-p2", documentId: "d-p2", courseTitle: "Netzwerksicherheit" })];
  assert.deepEqual(searchTerms("  Protokoll   analysis \n"), ["protokoll", "analysis"]);
  assert.deepEqual(run(docs, { query: "   protokoll    analysis  " }), ["Protokoll"]);
  assert.equal(run(docs, { query: "   " }).length, 2, "blank search shows everything");
  assert.deepEqual(run(docs, { query: "protokoll gibtesnicht" }), []);
});

test("the course filter only keeps that course", () => {
  const docs = [doc("a", { courseId: "c1" }), doc("b", { courseId: "c2", courseTitle: "Analysis" }), doc("c", { courseId: "c2", courseTitle: "Analysis" })];
  assert.deepEqual(run(docs, { courseId: "c2", sort: "name" }), ["b", "c"]);
  assert.deepEqual(run(docs, { courseId: "c3" }), []);
});

test("the status filter uses the existing status semantics", () => {
  const docs = [
    doc("ready"),
    doc("running", { state: { ...READY, ...processing } }),
    doc("indexing", { state: { ...READY, indexingStatus: "processing" } }),
    doc("failed", { state: { ...READY, ...failed } }),
    doc("index-failed", { state: { ...READY, ...indexingFailed } }),
    doc("upload-failed", { fileStatus: "failed", state: { ...READY, ...processing } }),
  ];
  const sorted = (status) => run(docs, { status, sort: "name" });
  assert.deepEqual(sorted("ready"), ["ready"]);
  assert.deepEqual(sorted("processing"), ["indexing", "running"]);
  assert.deepEqual(sorted("failed"), ["failed", "index-failed", "upload-failed"]);
  assert.equal(sorted("all").length, 6);
  for (const entry of toEntries(docs)) assert.equal(entry.group, statusGroup(entry.progress));
});

test("search, course and status combine with AND", () => {
  const docs = [
    doc("Skript A", { courseId: "c1", state: { ...READY, ...failed } }),
    doc("Skript B", { courseId: "c2", courseTitle: "Analysis", state: { ...READY, ...failed } }),
    doc("Skript C", { courseId: "c1" }),
    doc("Folien", { courseId: "c1", state: { ...READY, ...failed } }),
  ];
  assert.deepEqual(run(docs, { query: "skript", courseId: "c1", status: "failed" }), ["Skript A"]);
  assert.deepEqual(run(docs, { query: "skript", courseId: "c2", status: "ready" }), []);
});

test("an empty result is an empty list, and the reset state is recognised", () => {
  assert.deepEqual(run([doc("a")], { query: "nichts" }), []);
  assert.equal(hasActiveFilters(DEFAULT_FILTERS), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, query: "  " }), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, query: "x" }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, courseId: "c1" }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, status: "failed" }), true);
  // Sorting alone is not a filter.
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, sort: "name" }), false);
});

test("sorting is deterministic: oldest first, name A to Z, ties by name and id", () => {
  const docs = [
    doc("Beta", { uploadedAt: "2026-09-02T10:00:00Z" }),
    doc("alpha", { uploadedAt: "2026-09-03T10:00:00Z" }),
    doc("Zeta 10", { uploadedAt: "2026-09-01T10:00:00Z" }),
    doc("Zeta 2", { uploadedAt: "2026-09-04T10:00:00Z" }),
  ];
  assert.deepEqual(run(docs, { sort: "oldest" }), ["Zeta 10", "Beta", "alpha", "Zeta 2"]);
  assert.deepEqual(run(docs, { sort: "name" }), ["alpha", "Beta", "Zeta 2", "Zeta 10"]);
  const same = [doc("b", { uploadedAt: "2026-09-01T10:00:00Z" }), doc("a", { uploadedAt: "2026-09-01T10:00:00Z" })];
  assert.deepEqual(run(same), run([...same].reverse()));
});

test("course options list each course once, sorted by title", () => {
  const docs = [doc("1", { courseId: "c2", courseTitle: "Zoologie" }), doc("2", { courseId: "c1", courseTitle: "Analysis" }), doc("3", { courseId: "c2", courseTitle: "Zoologie" })];
  assert.deepEqual(courseOptions(docs), [{ id: "c1", title: "Analysis" }, { id: "c2", title: "Zoologie" }]);
  assert.deepEqual(courseOptions([]), []);
});

test("entries offer a retry only for retryable failures", () => {
  const entries = toEntries([
    doc("timeout", { state: { ...READY, processingStatus: "failed", errorCode: "PROCESSING_TIMEOUT", indexingStatus: "pending" } }),
    doc("format", { state: { ...READY, ...failed } }),
    doc("ok"),
  ]);
  assert.deepEqual(entries.map((entry) => entry.retry), ["processing", null, null]);
});

test("type labels and file sizes", () => {
  assert.equal(documentTypeLabel("application/pdf"), "PDF");
  assert.equal(documentTypeLabel("text/plain"), "TXT");
  assert.equal(documentTypeLabel("image/png"), "Datei");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2,0 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5,0 MB");
});

test("the documents route contains no fixture or preview data", async () => {
  const files = ["../../app/documents/page.tsx", "./DocumentLibrary.tsx", "./libraryModel.ts", "../../lib/supabase/queries/library.ts"];
  const forbidden = [/PRODUKTVORSCHAU/i, /Beispieldaten/i, /illustrativ/i, /fixture/i, /mock/i, /Vibe Coding/, /Network Security/, /Threat Modeling/, /Security Protocols/, /Software Foundations/];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} must not match ${pattern}`);
  }
});
