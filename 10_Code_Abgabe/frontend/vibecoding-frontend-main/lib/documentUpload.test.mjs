import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  DOCUMENT_UPLOAD_ACCEPT, DOCUMENT_UPLOAD_ERROR_MESSAGES, DOCUMENT_UPLOAD_HINT, DOCUMENT_UPLOAD_MAX_BYTES, validateDocumentFile,
} from "./documentUpload.ts";

const file = (name, type, size = 1024) => ({ name, type, size });
const code = (input) => { const r = validateDocumentFile(input); return r.ok ? null : r.code; };
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("the limit is the backend extraction limit (10 MiB), not the 50 MiB storage limit", () => {
  assert.equal(DOCUMENT_UPLOAD_MAX_BYTES, 10 * 1024 * 1024);
});

test("PDF and TXT are accepted with their canonical MIME type", () => {
  assert.deepEqual(validateDocumentFile(file("a.pdf", "application/pdf")), { ok: true, mimeType: "application/pdf" });
  assert.deepEqual(validateDocumentFile(file("a.txt", "text/plain")), { ok: true, mimeType: "text/plain" });
});

test("PPTX and DOCX are rejected even with a matching MIME type", () => {
  assert.equal(code(file("a.pptx", PPTX)), "INVALID_FILE");
  assert.equal(code(file("a.docx", DOCX)), "INVALID_FILE");
  assert.equal(code(file("a.PPTX", "")), "INVALID_FILE");
});

test("unknown extensions and extension-less generic files are rejected", () => {
  for (const name of ["a.exe", "a.pdf.exe", "a.md", "a.", "noextension"]) assert.equal(code(file(name, "application/octet-stream")), "INVALID_FILE", name);
  assert.equal(code(file("noextension", "")), "INVALID_FILE");
});

test("extensions are case-insensitive", () => {
  assert.deepEqual(validateDocumentFile(file("SKRIPT.PDF", "")), { ok: true, mimeType: "application/pdf" });
  assert.deepEqual(validateDocumentFile(file("Notiz.TxT", "")), { ok: true, mimeType: "text/plain" });
});

test("an empty or generic browser MIME type falls back to the extension", () => {
  assert.equal(validateDocumentFile(file("a.pdf", "")).mimeType, "application/pdf");
  assert.equal(validateDocumentFile(file("a.txt", "application/octet-stream")).mimeType, "text/plain");
  assert.equal(validateDocumentFile(file("a.pdf", "application/x-pdf")).mimeType, "application/pdf");
  assert.equal(validateDocumentFile(file("a.txt", "text/plain; charset=utf-8")).mimeType, "text/plain");
});

test("without an extension a supported MIME type is enough", () => {
  assert.deepEqual(validateDocumentFile(file("Skript", "application/pdf")), { ok: true, mimeType: "application/pdf" });
});

test("an extension that contradicts another supported MIME type is rejected", () => {
  assert.equal(code(file("a.pdf", "text/plain")), "INVALID_FILE");
  assert.equal(code(file("a.txt", "application/pdf")), "INVALID_FILE");
});

test("size: exactly the limit passes, one byte more fails, empty files are reported", () => {
  assert.equal(validateDocumentFile(file("a.pdf", "application/pdf", DOCUMENT_UPLOAD_MAX_BYTES)).ok, true);
  assert.equal(code(file("a.pdf", "application/pdf", DOCUMENT_UPLOAD_MAX_BYTES + 1)), "FILE_TOO_LARGE");
  assert.equal(code(file("a.pdf", "application/pdf", 50 * 1024 * 1024)), "FILE_TOO_LARGE");
  assert.equal(validateDocumentFile(file("a.pdf", "application/pdf", 1)).ok, true);
  assert.equal(code(file("a.pdf", "application/pdf", 0)), "EMPTY_FILE");
});

test("an unsupported type is reported before size problems", () => {
  assert.equal(code(file("a.docx", DOCX, 0)), "INVALID_FILE");
});

test("accept string and visible copy are derived from the same contract", () => {
  assert.equal(DOCUMENT_UPLOAD_ACCEPT, ".pdf,.txt");
  assert.equal(DOCUMENT_UPLOAD_HINT, "PDF oder TXT, maximal 10 MiB");
  assert.ok(DOCUMENT_UPLOAD_ERROR_MESSAGES.FILE_TOO_LARGE.includes("10 MiB"));
  assert.ok(DOCUMENT_UPLOAD_ERROR_MESSAGES.INVALID_FILE.includes("PDF oder TXT"));
  for (const message of Object.values(DOCUMENT_UPLOAD_ERROR_MESSAGES)) assert.ok(!/PPTX|DOCX|50 MiB|Storage|Edge|MIME/i.test(message), message);
});

// Drift guards: every upload entry point uses the shared contract and no old copy remains.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const UPLOAD_SITES = ["../components/courses/CourseDetailClient.tsx", "../components/courses/CourseDocuments.tsx"];

test("all upload call sites use the shared contract", async () => {
  for (const site of UPLOAD_SITES) {
    const source = await read(site);
    assert.ok(source.includes("accept={DOCUMENT_UPLOAD_ACCEPT}"), `${site}: accept`);
    assert.ok(source.includes("DOCUMENT_UPLOAD_HINT"), `${site}: hint`);
    assert.ok(source.includes("...DOCUMENT_UPLOAD_ERROR_MESSAGES"), `${site}: error messages`);
    assert.ok(/validateDocumentFile\(file\)/.test(source), `${site}: validates when a file is picked`);
    assert.equal((source.match(/type="file"/g) ?? []).length, 1, `${site}: exactly one file input`);
  }
  const files = await read("./supabase/queries/files.ts");
  assert.ok(files.includes("validateDocumentFile(file)"));
});

test("no old format, limit or MIME copy remains in the upload code", async () => {
  for (const path of [...UPLOAD_SITES, "./supabase/queries/files.ts"]) {
    const source = await read(path);
    assert.ok(!/50 MiB|52_428_800|\.pptx|\.docx|PowerPoint|Word \(|ALLOWED_MIME_TYPES|EXTENSION_MIME|resolveMimeType|isFileSizeAllowed/.test(source), path);
    assert.ok(!/accept="/.test(source), `${path}: no hard-coded accept`);
  }
});

test("the document processing errors stay permanent (no retry) for unsupported or invalid files", async () => {
  const source = await read("../components/courses/documentIndexing.ts");
  assert.ok(/UNSUPPORTED_FORMAT, INVALID_DOCUMENT, INVALID_INDEXING_INPUT and SOURCE_DELETED are/.test(source));
});
