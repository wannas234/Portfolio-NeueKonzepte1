import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { ChatError, canRate, chatErrorMessage, mergeExchange, nextFeedback, withFeedback } from "./chatProtocol.ts";

// Real lib/chat.ts compiled in memory, fake Supabase client (same approach as chat.test.mjs).
const compiled = ts.transpileModule(await readFile(new URL("./chat.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('"./chatProtocol"', JSON.stringify(new URL("./chatProtocol.ts", import.meta.url).href))
  .replace('"@supabase/supabase-js"', JSON.stringify(import.meta.resolve("@supabase/supabase-js")));
const { setMessageFeedback, loadHistory } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const MESSAGE_ID = "aaaaaaaa-1111-4222-8333-444444444444";

// Records the update like PostgREST would receive it; `result` is what the backend answers.
function feedbackClient(result) {
  const calls = [];
  const query = {
    from(table) { calls.push(["from", table]); return this; },
    update(values) { calls.push(["update", values]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    async select(columns) { calls.push(["select", columns]); return typeof result === "function" ? result() : result; },
  };
  return { client: { from: (table) => query.from(table) }, calls };
}

test("helpful=true and helpful=false are written to exactly the given message id", async () => {
  for (const value of [true, false]) {
    const { client, calls } = feedbackClient({ data: [{ id: MESSAGE_ID, helpful: value }], error: null });
    assert.equal(await setMessageFeedback(client, MESSAGE_ID, value), value);
    assert.deepEqual(calls.slice(0, 3), [["from", "chat_messages"], ["update", { helpful: value }], ["eq", "id", MESSAGE_ID]]);
  }
});

test("null withdraws a rating (the backend accepts it and drops the timestamp)", async () => {
  const { client, calls } = feedbackClient({ data: [{ id: MESSAGE_ID, helpful: null }], error: null });
  assert.equal(await setMessageFeedback(client, MESSAGE_ID, null), null);
  assert.deepEqual(calls[1], ["update", { helpful: null }]);
});

test("only the rating column is ever written, never content, timestamps or roles", async () => {
  const { client, calls } = feedbackClient({ data: [{ id: MESSAGE_ID, helpful: true }], error: null });
  await setMessageFeedback(client, MESSAGE_ID, true);
  assert.deepEqual(Object.keys(calls.find((call) => call[0] === "update")[1]), ["helpful"]);
});

test("a backend error becomes a friendly ChatError without backend details", async () => {
  const { client } = feedbackClient({ data: null, error: { message: "permission denied for table chat_messages", code: "42501" } });
  await assert.rejects(setMessageFeedback(client, MESSAGE_ID, true), (error) => error instanceof ChatError && error.code === "FEEDBACK_FAILED" && !/permission|table|42501/.test(error.message));
  assert.equal(chatErrorMessage("FEEDBACK_FAILED"), "Feedback konnte nicht gespeichert werden.");
});

test("zero affected rows (foreign, non-assistant or missing message: RLS hides them) is a failure, not success", async () => {
  const { client } = feedbackClient({ data: [], error: null });
  await assert.rejects(setMessageFeedback(client, MESSAGE_ID, true), (error) => error.code === "FEEDBACK_FAILED");
});

test("loaded history carries the stored rating", async () => {
  const columns = [];
  const rows = [
    { id: "q", seq: 1, role: "user", content: "Frage", chat_message_sources: [] },
    { id: "a1", seq: 2, role: "assistant", content: "Ja", helpful: true, helpful_at: "2026-01-01T00:00:00Z", chat_message_sources: [] },
    { id: "a2", seq: 4, role: "assistant", content: "Nein", helpful: false, helpful_at: "2026-01-01T00:00:00Z", chat_message_sources: [] },
    { id: "a3", seq: 6, role: "assistant", content: "Offen", helpful: null, helpful_at: null, chat_message_sources: [] },
  ];
  const query = {
    select(value) { columns.push(value); return this; }, eq() { return this; }, order() { return this; },
    async range() { return { data: rows, error: null }; },
  };
  const history = await loadHistory({ from: () => query }, "c1");
  assert.ok(/\bhelpful\b/.test(columns[0]) && /\bhelpful_at\b/.test(columns[0]));
  assert.deepEqual(history.map((m) => m.helpful), [undefined, true, false, null]);
});

test("a fresh exchange keeps the answer's id and rating so it can be rated immediately", () => {
  const exchange = {
    conversation_id: "c", request_id: "r",
    messages: [{ id: "u1", seq: 1, role: "user", content: "F" }, { id: "a1", seq: 2, role: "assistant", content: "A", helpful: null, helpful_at: null }],
    sources: [],
  };
  const merged = mergeExchange([], exchange);
  assert.equal(merged[1].id, "a1");
  assert.equal(merged[1].helpful, null);
  assert.equal(canRate(merged[1]), true);
});

test("only persisted assistant answers can be rated", () => {
  assert.equal(canRate({ id: "a", role: "assistant" }), true);
  assert.equal(canRate({ id: "u", role: "user" }), false);
  assert.equal(canRate({ id: "", role: "assistant" }), false);
});

test("state transitions: neutral, switch both ways, withdraw, and rollback", () => {
  assert.equal(nextFeedback(null, true), true);
  assert.equal(nextFeedback(null, false), false);
  assert.equal(nextFeedback(true, false), false);
  assert.equal(nextFeedback(false, true), true);
  assert.equal(nextFeedback(true, true), null);
  assert.equal(nextFeedback(false, false), null);

  const before = [{ id: "a", role: "assistant", helpful: true }, { id: "b", role: "assistant", helpful: null }];
  const optimistic = withFeedback(before, "a", false);
  assert.deepEqual(optimistic.map((m) => m.helpful), [false, null]);
  // A failed save restores the previous value, leaving other messages untouched.
  assert.deepEqual(withFeedback(optimistic, "a", true), before);
  assert.equal(before[0].helpful, true); // input is never mutated
});

// --- static guards -------------------------------------------------------------------
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\/.*$/gm, "");

test("both persistent chats offer feedback through the shared component", async () => {
  for (const path of ["../components/assistant/AssistantWorkspace.tsx", "../components/courses/DocumentCourseChat.tsx"]) {
    const source = await read(path);
    assert.ok(source.includes("useMessageFeedback(setMessages)"), path);
    assert.equal((source.match(/<MessageFeedback /g) ?? []).length, 1, path);
  }
});

test("the rating buttons are real, labelled, pressed-state buttons and only assistant answers get them", async () => {
  const source = await read("../components/chat/MessageFeedback.tsx");
  assert.equal((source.match(/<button type="button"/g) ?? []).length, 2);
  assert.ok(source.includes('aria-label="Antwort als hilfreich markieren"'));
  assert.ok(source.includes('aria-label="Antwort als nicht hilfreich markieren"'));
  assert.equal((source.match(/aria-pressed=/g) ?? []).length, 2);
  assert.ok(source.includes("if (!canRate(message)) return null;"));
  assert.ok(/:focus-visible/.test(await read("../components/chat/messageFeedback.module.css")));
});

test("temporary AI actions never show feedback", async () => {
  for (const file of ["DocumentAiActions"]) {
    assert.ok(!/MessageFeedback|useMessageFeedback|setMessageFeedback/.test(await read(`../components/courses/${file}.tsx`)), file);
  }
});

test("message ids are never derived from content or timestamps, and nothing is mirrored to storage", async () => {
  for (const path of ["../components/chat/useMessageFeedback.ts", "../components/chat/MessageFeedback.tsx", "./chat.ts"]) {
    const source = code(await read(path));
    assert.ok(!/\.find\([^)]*(content|created_at|seq)/.test(source), `${path}: no content/timestamp matching`);
    assert.ok(!/randomUUID/.test(code(await read("../components/chat/useMessageFeedback.ts"))), "no synthetic ids");
  }
  const hook = code(await read("../components/chat/useMessageFeedback.ts"));
  assert.ok(!/localStorage|sessionStorage|console\./.test(hook));
});

test("scopes are unchanged: document chat stays scoped, assistant stays course-wide, AP8 cleanup remains", async () => {
  const documentChat = code(await read("../components/courses/DocumentCourseChat.tsx"));
  assert.equal((documentChat.match(/withMaterialScope\(/g) ?? []).length, (documentChat.match(/sendChat\(/g) ?? []).length);
  assert.ok(/withMaterialScope\([\s\S]*?materialId\)/.test(documentChat));
  const assistant = code(await read("../components/assistant/AssistantWorkspace.tsx"));
  assert.ok(!/withMaterialScope|material_ids|deleteConversation|runTemporaryChat/.test(assistant));
  for (const file of ["DocumentAiActions"]) {
    assert.ok(code(await read(`../components/courses/${file}.tsx`)).includes("runTemporaryChat("), file);
  }
});
