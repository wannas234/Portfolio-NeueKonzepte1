import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { ChatError, canDiscardRequest, mergeExchange, sendBlockedReason, validateQuestion, withMaterialScope } from "./chatProtocol.ts";

// Compile the browser module in memory so tests exercise its real implementation
// without Next's alias resolver or any connection to a live Supabase project.
const compiled = ts.transpileModule(await readFile(new URL("./chat.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('"./chatProtocol"', JSON.stringify(new URL("./chatProtocol.ts", import.meta.url).href))
  .replace('"@supabase/supabase-js"', JSON.stringify(import.meta.resolve("@supabase/supabase-js")));
const { sendChat, loadHistory, hasIndexedMaterial } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const request = { conversation_id: "conversation-1", request_id: "request-1", question: "Was ist ein Prozess?" };
const source = { citation_no: 5, material_title: "Vorlesung", page_number: null, excerpt: "Beleg" };
const exchange = {
  conversation_id: request.conversation_id, request_id: request.request_id,
  messages: [
    { id: "user-1", seq: 1, role: "user", content: request.question },
    { id: "assistant-1", seq: 2, role: "assistant", content: "Eine Antwort [5]." },
  ], sources: [source],
};
function clientWith(invoke, session = { access_token: "user-jwt" }) {
  return { auth: { getSession: async () => ({ data: { session }, error: null }) }, functions: { invoke } };
}

test("question limit uses UTF-16 and rejects whitespace-only input", () => {
  assert.equal(validateQuestion(" \n "), false);
  assert.equal(validateQuestion("x".repeat(1800)), true);
  assert.equal(validateQuestion("🧠".repeat(901)), false);
});

test("replayed exchanges are deduplicated, sorted and keep sparse citations on assistant messages", () => {
  const history = mergeExchange([], exchange);
  assert.deepEqual(mergeExchange([...history].reverse(), exchange), history);
  assert.deepEqual(history[0].chat_message_sources, []);
  assert.deepEqual(history[1].chat_message_sources, [source]);
  assert.equal(history[1].request_id, request.request_id);
});

test("a send targets chat with the user's JWT and retries preserve the entire request", async () => {
  const calls = [];
  const client = clientWith(async (name, options) => { calls.push({ name, options }); return { data: exchange, error: null }; });
  assert.deepEqual(await sendChat(client, request), exchange);
  await sendChat(client, request);
  assert.equal(calls[0].name, "chat");
  assert.equal(calls[0].options.headers.Authorization, "Bearer user-jwt");
  assert.ok(calls[0].options.timeout >= 120000);
  assert.deepEqual(calls[0].options.body, calls[1].options.body);
});

const MATERIAL_ID = "11111111-2222-4333-8444-555555555555";

test("a course-wide request is sent without any material scope", async () => {
  const calls = [];
  const client = clientWith(async (name, options) => { calls.push({ name, options }); return { data: exchange, error: null }; });
  await sendChat(client, request);
  assert.deepEqual(calls[0].options.body, request);
  assert.equal("material_ids" in calls[0].options.body, false);
});

test("a document-scoped request transmits exactly the one material id", async () => {
  const calls = [];
  const client = clientWith(async (name, options) => { calls.push({ name, options }); return { data: exchange, error: null }; });
  const scoped = withMaterialScope(request, MATERIAL_ID);
  assert.deepEqual(await sendChat(client, scoped), exchange);
  assert.equal(calls[0].name, "chat");
  assert.deepEqual(calls[0].options.body.material_ids, [MATERIAL_ID]);
  assert.deepEqual(calls[0].options.body, { ...request, material_ids: [MATERIAL_ID] });
});

test("scoping keeps the request identity and does not change the original request", async () => {
  const scoped = withMaterialScope(request, MATERIAL_ID);
  assert.equal(scoped.conversation_id, request.conversation_id);
  assert.equal(scoped.request_id, request.request_id);
  assert.equal(scoped.question, request.question);
  assert.equal("material_ids" in request, false);
  // A retry sends the identical body, so the backend sees the same request_id and scope.
  const calls = [];
  const client = clientWith(async (name, options) => { calls.push(options.body); return { data: exchange, error: null }; });
  await sendChat(client, scoped);
  await sendChat(client, scoped);
  assert.deepEqual(calls[0], calls[1]);
});

test("missing session prevents an unauthenticated provider request", async () => {
  const client = clientWith(() => assert.fail("must not invoke"), null);
  await assert.rejects(sendChat(client, request), (error) => error.code === "UNAUTHENTICATED");
});

test("HTTP error body controls retry delay rather than the generic SDK error", async () => {
  const client = clientWith(async () => ({ error: new FunctionsHttpError(new Response(JSON.stringify({ error: { code: "RATE_LIMITED", retry_after_seconds: 17 } }), { status: 429 })) }));
  await assert.rejects(sendChat(client, request), (error) => error.code === "RATE_LIMITED" && error.retryAfter === 17);
});

test("network failures and invalid responses preserve an unknown outcome for retry", async () => {
  await assert.rejects(sendChat(clientWith(async () => { throw new Error("private network details"); }), request), (error) => error.code === "NETWORK_ERROR" && !error.message.includes("private"));
  await assert.rejects(sendChat(clientWith(async () => ({ data: { ...exchange, request_id: "wrong" }, error: null })), request), (error) => error.code === "INVALID_ANSWER_RESPONSE");
  await assert.rejects(sendChat(clientWith(async () => ({ data: { ...exchange, sources: [null] }, error: null })), request), (error) => error.code === "INVALID_ANSWER_RESPONSE");
  for (const code of ["NETWORK_ERROR", "CHAT_UNAVAILABLE", "REQUEST_IN_PROGRESS", "UNAUTHENTICATED", "RATE_LIMITED", "REQUEST_ID_CONFLICT"]) assert.equal(canDiscardRequest(code), false);
  assert.equal(canDiscardRequest("NO_RELEVANT_MATERIAL"), true);
  assert.equal(new ChatError("RATE_LIMITED", NaN).retryAfter, 0);
});

test("history loads additional pages and does not silently stop at the API row limit", async () => {
  const ranges = [];
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    async range(start, end) {
      ranges.push([start, end]);
      return { data: start === 0 ? Array.from({ length: 100 }, (_, i) => ({ id: String(i) })) : [{ id: "100" }], error: null };
    },
  };
  const history = await loadHistory({ from: () => query }, "conversation-1");
  assert.equal(history.length, 101);
  assert.deepEqual(ranges, [[0, 99], [100, 199]]);
});

test("index lookup uses the explicit material relationship and ready status", async () => {
  const calls = [];
  const query = {
    select(value) { calls.push(value); return this; },
    eq(key, value) { calls.push([key, value]); return this; },
    async limit() { return { data: [], error: null }; },
  };
  assert.equal(await hasIndexedMaterial({ from: () => query }, "course-1"), false);
  assert.ok(calls[0].includes("materials!source_documents_material_id_fkey!inner"));
  assert.deepEqual(calls[1], ["materials.course_id", "course-1"]);
  assert.deepEqual(calls[2], ["indexing_status", "ready"]);
});


test("send is available without an index precheck and every actual blocker has an explanation", () => {
  const ready = { courseId: "course-1", busy: false, pending: false, loadFailed: false, waitSeconds: 0, question: "Meine Frage" };
  assert.equal(sendBlockedReason(ready), null);
  for (const patch of [{ courseId: "" }, { busy: true }, { pending: true }, { loadFailed: true }, { waitSeconds: 5 }, { question: "  " }]) {
    assert.equal(typeof sendBlockedReason({ ...ready, ...patch }), "string");
  }
});
