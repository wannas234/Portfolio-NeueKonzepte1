import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { FunctionsHttpError } from "@supabase/supabase-js";

// Same in-memory compilation as chat.test.mjs: real lib/chat.ts, fake Supabase client.
const compiled = ts.transpileModule(await readFile(new URL("./chat.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('"./chatProtocol"', JSON.stringify(new URL("./chatProtocol.ts", import.meta.url).href))
  .replace('"@supabase/supabase-js"', JSON.stringify(import.meta.resolve("@supabase/supabase-js")));
const { runTemporaryChat, deleteConversation, loadConversations } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const COURSE_ID = "course-1";
const TEMP_ID = "temp-conversation";
const EXPECTED_MATERIAL_ID = "11111111-2222-4333-8444-555555555555";

function exchangeFor(body) {
  return {
    conversation_id: body.conversation_id, request_id: body.request_id,
    messages: [
      { id: "u1", seq: 1, role: "user", content: body.question },
      { id: "a1", seq: 2, role: "assistant", content: "Eine Antwort [1]." },
    ],
    sources: [{ citation_no: 1, material_title: "Vorlesung", page_number: null, excerpt: "Beleg" }],
  };
}

// Records every step in order. `invoke` receives the request body like the real Edge Function.
function lifecycleClient({ createError = false, deleteError = false, invoke } = {}) {
  const steps = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: "user-jwt" } }, error: null }) },
    functions: {
      invoke: async (_name, options) => {
        steps.push(["send", options.body]);
        return invoke ? invoke(options.body) : { data: exchangeFor(options.body), error: null };
      },
    },
    from(table) {
      assert.equal(table, "chat_conversations");
      return {
        insert(row) { steps.push(["create", row]); return this; },
        select() { return this; },
        async single() {
          return createError
            ? { data: null, error: { message: "x" } }
            : { data: { id: TEMP_ID, course_id: COURSE_ID, title: "Neuer Chat", updated_at: "" }, error: null };
        },
        delete() {
          steps.push(["delete"]);
          return { eq: async (column, value) => { steps.push(["delete-eq", column, value]); return { error: deleteError ? { message: "x" } : null }; } };
        },
      };
    },
  };
  return { client, steps };
}

test("a temporary AI action creates, chats and then cleans up its conversation, in that order", async () => {
  const { client, steps } = lifecycleClient();
  const result = await runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Fasse zusammen");
  assert.deepEqual(steps.map((step) => step[0]), ["create", "send", "delete", "delete-eq"]);
  assert.deepEqual(steps[3], ["delete-eq", "id", TEMP_ID]);
  assert.equal(result.messages[1].content, "Eine Antwort [1].");
});

test("the temporary chat is scoped to exactly the given material", async () => {
  const { client, steps } = lifecycleClient();
  await runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Frage");
  const body = steps.find((step) => step[0] === "send")[1];
  assert.deepEqual(body.material_ids, [EXPECTED_MATERIAL_ID]);
  assert.equal(body.conversation_id, TEMP_ID);
  assert.equal(body.question, "Frage");
  assert.deepEqual(steps[0][1], { course_id: COURSE_ID });
});

test("a failed request still attempts cleanup and reports the original error", async () => {
  const failing = async () => ({ error: new FunctionsHttpError(new Response(JSON.stringify({ error: { code: "INCOMPLETE_ANSWER" } }), { status: 503 })) });
  const { client, steps } = lifecycleClient({ invoke: failing });
  await assert.rejects(runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Frage"), (error) => error.code === "INCOMPLETE_ANSWER");
  assert.deepEqual(steps.map((step) => step[0]), ["create", "send", "delete", "delete-eq"]);
});

test("cleanup is finished before the caller can parse, so a parser rejection cannot skip it", async () => {
  const { client, steps } = lifecycleClient();
  await runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Frage");
  assert.equal(steps.at(-1)[0], "delete-eq");
  assert.equal(steps.filter((step) => step[0] === "delete").length, 1);
});

test("a failing cleanup is logged but the successful answer is still returned", async () => {
  const { client } = lifecycleClient({ deleteError: true });
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const result = await runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Frage");
    assert.equal(result.messages[1].role, "assistant");
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(TEMP_ID));
});

test("a failed cleanup does not mask a request failure", async () => {
  const { client } = lifecycleClient({ deleteError: true, invoke: async () => { throw new Error("offline"); } });
  const original = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Frage"), (error) => error.code === "NETWORK_ERROR");
  } finally { console.warn = original; }
});

test("if the conversation cannot be created nothing is sent or deleted", async () => {
  const { client, steps } = lifecycleClient({ createError: true });
  await assert.rejects(runTemporaryChat(client, COURSE_ID, EXPECTED_MATERIAL_ID, "Frage"), (error) => error.code === "LOAD_FAILED");
  assert.deepEqual(steps.map((step) => step[0]), ["create"]);
});

test("deleteConversation deletes exactly one conversation by id and surfaces errors", async () => {
  const { client, steps } = lifecycleClient();
  await deleteConversation(client, "abc");
  assert.deepEqual(steps, [["delete"], ["delete-eq", "id", "abc"]]);
  await assert.rejects(deleteConversation(lifecycleClient({ deleteError: true }).client, "abc"), (error) => error.code === "LOAD_FAILED");
});

test("the normal history query is unchanged and applies no title or prompt filtering", async () => {
  const calls = [];
  const query = {
    select(value) { calls.push(["select", value]); return this; },
    eq(key, value) { calls.push(["eq", key, value]); return this; },
    async order(key, options) { calls.push(["order", key, options]); return { data: [{ id: "c1", title: "Erstelle 8 Lernkarteikarten" }], error: null }; },
  };
  const list = await loadConversations({ from: () => query }, COURSE_ID);
  assert.deepEqual(calls, [["select", "id, course_id, title, updated_at"], ["eq", "course_id", COURSE_ID], ["order", "updated_at", { ascending: false }]]);
  assert.equal(list.length, 1);
});
