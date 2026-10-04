import assert from "node:assert/strict";
import { test } from "node:test";
import { LIBRARY_LIMIT, listLibraryDocuments, mapLibraryRows } from "./library.ts";

// A chainable fake of the query builder that records every call and resolves with `result`.
function fakeClient(result) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_, method) {
      if (method === "then") return (resolve) => resolve(result);
      return (...args) => { calls.push([method, ...args]); return builder; };
    },
  });
  return { calls, client: { from: (table) => { calls.push(["from", table]); return builder; } } };
}

const row = (patch = {}) => ({
  id: "m1", course_id: "c1", file_id: "f1",
  courses: { title: "Netzwerksicherheit" },
  lectures: null,
  files: { original_filename: "Vorlesung 1.pdf", mime_type: "application/pdf", size_bytes: 2048, status: "ready", created_at: "2026-09-10T10:00:00Z" },
  source_documents: { id: "d1", processing_status: "ready", error_code: null, indexing_status: "ready", indexing_error: null },
  ...patch,
});

test("rows are mapped with course, file, source document and navigation ids", () => {
  assert.deepEqual(mapLibraryRows([row()]), [{
    documentId: "d1", materialId: "m1", fileId: "f1", courseId: "c1", courseTitle: "Netzwerksicherheit", lectureTitle: null,
    name: "Vorlesung 1.pdf", mimeType: "application/pdf", sizeBytes: 2048, uploadedAt: "2026-09-10T10:00:00Z", fileStatus: "ready",
    state: { processingStatus: "ready", errorCode: null, indexingStatus: "ready", indexingError: null },
  }]);
});

test("the assigned lecture title is carried over", () => {
  const [document] = mapLibraryRows([row({ lectures: { title: "VL 3 – Kryptographie" } })]);
  assert.equal(document.lectureTitle, "VL 3 – Kryptographie");
});

test("rows with a missing file, course or source document are skipped, not invented", () => {
  assert.deepEqual(mapLibraryRows([row({ file_id: null }), row({ files: null }), row({ courses: null }), row({ source_documents: null })]), []);
});

test("a failed state keeps its error code", () => {
  const [document] = mapLibraryRows([row({ source_documents: { id: "d1", processing_status: "failed", error_code: "UNSUPPORTED_FORMAT", indexing_status: "pending", indexing_error: null } })]);
  assert.equal(document.state.processingStatus, "failed");
  assert.equal(document.state.errorCode, "UNSUPPORTED_FORMAT");
});

test("the library reads the user's source materials in one query, newest first, with a cap", async () => {
  const { calls, client } = fakeClient({ data: [row()], error: null });
  const documents = await listLibraryDocuments(client);
  assert.equal(documents.length, 1);
  assert.deepEqual(calls.filter(([m]) => m === "from"), [["from", "materials"]]);
  const select = calls.find(([m]) => m === "select")[1];
  for (const part of ["courses!course_id(title)", "lectures!lecture_id(title)", "files!file_id(", "source_documents!source_documents_material_id_fkey(id,"]) assert.ok(select.includes(part), part);
  assert.deepEqual(calls.find(([m]) => m === "eq"), ["eq", "type", "source_document"]);
  assert.deepEqual(calls.find(([m]) => m === "order"), ["order", "created_at", { ascending: false }]);
  assert.deepEqual(calls.find(([m]) => m === "range"), ["range", 0, LIBRARY_LIMIT - 1]);
});

test("database errors are propagated instead of an empty library", async () => {
  const failure = new Error("permission denied");
  await assert.rejects(listLibraryDocuments(fakeClient({ data: null, error: failure }).client), (error) => error === failure);
});
