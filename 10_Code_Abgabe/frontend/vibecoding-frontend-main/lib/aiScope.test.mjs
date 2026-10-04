import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

// Static regression guards. The scope and the temporary-conversation lifecycle are
// exercised with a fake client in chatTemporary.test.mjs and chat.test.mjs.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\/.*$/gm, "");

test("temporary document AI actions go through runTemporaryChat with the open material", async () => {
  for (const file of ["DocumentAiActions"]) {
    const source = code(await read(`../components/courses/${file}.tsx`));
    assert.ok(/runTemporaryChat\(client, courseId, materialId,/.test(source), `${file}: scoped to materialId`);
    assert.ok(!/sendChat|createConversation|deleteConversation/.test(source), `${file}: no hand-rolled conversation handling`);
  }
});

test("the document chat is scoped to its material and never cleans up automatically", async () => {
  const source = code(await read("../components/courses/DocumentCourseChat.tsx"));
  const sends = source.match(/sendChat\(/g) ?? [];
  assert.ok(sends.length > 0);
  assert.equal((source.match(/withMaterialScope\(/g) ?? []).length, sends.length);
  assert.ok(/withMaterialScope\([\s\S]*?materialId\)/.test(source));
  assert.ok(!/runTemporaryChat|deleteConversation/.test(source));
});

test("the course-wide assistant stays unscoped and persistent", async () => {
  const source = code(await read("../components/assistant/AssistantWorkspace.tsx"));
  assert.ok(!/withMaterialScope|material_ids/.test(source));
  assert.ok(!/runTemporaryChat|deleteConversation/.test(source));
});

test("temporary chats are not hidden by any title or prompt heuristic", async () => {
  for (const file of ["../lib/chat.ts", "../components/assistant/AssistantWorkspace.tsx", "../components/courses/DocumentCourseChat.tsx"]) {
    const source = code(await read(file));
    assert.ok(!/Erstelle \d|Lernkarteikarten|Multiple-Choice/.test(source), `${file}: no prompt matching`);
    assert.ok(!/\.filter\([^)]*title/.test(source), `${file}: no title filtering`);
  }
});

test("quiz generation uses a dedicated material-scoped backend job without chat or client result saves", async () => {
 const source=code(await read('../components/courses/DocumentQuizzes.tsx'));
 assert.ok(source.includes('generateQuiz(materialId,'));
 assert.ok(!/runTemporaryChat|parseQuiz\(|saveQuiz\(/.test(source));
 const api=await read('./quizGeneration.ts');
 assert.ok(api.includes('source_material_id: materialId'));
});
