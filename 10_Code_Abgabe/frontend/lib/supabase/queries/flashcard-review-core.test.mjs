import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankProgress,
  cardStatusLabel,
  listCardProgress,
  listDeckProgressCounts,
  markCardSeen,
  recordFlashcardReview,
  setCardStarred,
} from "./flashcard-review-core.ts";

// A chainable fake of the query builder. Every awaited query resolves with the next entry
// of `results`, so a function that runs two queries can be given two different answers.
function fakeClient(results, user = { id: "user-1" }) {
  const calls = [];
  const queue = [...results];
  const builder = new Proxy({}, {
    get(_, method) {
      if (method === "then") return (resolve) => resolve(queue.shift());
      return (...args) => { calls.push([method, ...args]); return builder; };
    },
  });
  return {
    calls,
    client: {
      from: (table) => { calls.push(["from", table]); return builder; },
      rpc: (name, args) => { calls.push(["rpc", name, args]); return builder; },
      auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no session") }) },
    },
  };
}

const row = {
  card_id: "c1", known: true, starred: false, interval_days: 2, repetition_count: 2,
  reviewed_at: "2026-10-04T10:00:00Z", due_at: "2026-10-06T10:00:00Z",
};
const mapped = {
  cardId: "c1", known: true, starred: false, intervalDays: 2, repetitionCount: 2,
  reviewedAt: "2026-10-04T10:00:00Z", dueAt: "2026-10-06T10:00:00Z",
};

test("card progress is read for the given cards and keyed by card id", async () => {
  const { calls, client } = fakeClient([{ data: [row], error: null }]);
  const progress = await listCardProgress(client, ["c1", "c2"]);
  assert.deepEqual(calls.find(([m]) => m === "from"), ["from", "flashcard_progress"]);
  assert.deepEqual(calls.find(([m]) => m === "in"), ["in", "card_id", ["c1", "c2"]]);
  assert.deepEqual([...progress], [["c1", mapped]]);
});

test("no cards means no query, and read errors are propagated", async () => {
  const empty = fakeClient([]);
  assert.equal((await listCardProgress(empty.client, [])).size, 0);
  assert.equal(empty.calls.length, 0);
  await assert.rejects(listCardProgress(fakeClient([{ data: null, error: new Error("boom") }]).client, ["c1"]), /boom/);
});

test("a review goes through the server RPC with the request id and returns the server's progress", async () => {
  const { calls, client } = fakeClient([{ data: row, error: null }]);
  assert.deepEqual(await recordFlashcardReview(client, "c1", true, "req-1"), mapped);
  assert.deepEqual(calls[0], ["rpc", "record_flashcard_review", { p_card: "c1", p_known: true, p_request_id: "req-1" }]);
});

test("a review result without a progress row is not treated as progress", async () => {
  assert.equal(await recordFlashcardReview(fakeClient([{ data: null, error: null }]).client, "c1", false, "r"), null);
  assert.equal(await recordFlashcardReview(fakeClient([{ data: { status: "pending" }, error: null }]).client, "c1", false, "r"), null);
  await assert.rejects(recordFlashcardReview(fakeClient([{ data: null, error: new Error("denied") }]).client, "c1", true, "r"), /denied/);
});

test("seeing a card creates its progress row without touching an existing one", async () => {
  const { calls, client } = fakeClient([{ data: null, error: null }]);
  await markCardSeen(client, "c1");
  assert.deepEqual(calls.find(([m]) => m === "upsert"), [
    "upsert", { user_id: "user-1", card_id: "c1" }, { onConflict: "user_id,card_id", ignoreDuplicates: true },
  ]);
});

test("starring updates only the starred column of an existing row", async () => {
  const { calls, client } = fakeClient([{ data: [{ card_id: "c1" }], error: null }]);
  await setCardStarred(client, "c1", true);
  assert.deepEqual(calls.find(([m]) => m === "update"), ["update", { starred: true }]);
  assert.equal(calls.some(([m]) => m === "insert"), false);
});

test("starring a card without progress inserts the row", async () => {
  const { calls, client } = fakeClient([{ data: [], error: null }, { data: null, error: null }]);
  await setCardStarred(client, "c1", true);
  assert.deepEqual(calls.find(([m]) => m === "insert"), ["insert", { user_id: "user-1", card_id: "c1", starred: true }]);
});

test("progress writes need a signed-in user and propagate errors", async () => {
  await assert.rejects(markCardSeen(fakeClient([], null).client, "c1"), /no session/);
  await assert.rejects(setCardStarred(fakeClient([], null).client, "c1", true), /no session/);
  await assert.rejects(setCardStarred(fakeClient([{ data: null, error: new Error("boom") }]).client, "c1", true), /boom/);
  await assert.rejects(setCardStarred(fakeClient([{ data: [], error: null }, { data: null, error: new Error("insert") }]).client, "c1", true), /insert/);
});

test("deck counts come from the server per material", async () => {
  const { calls, client } = fakeClient([{ data: [{ material_id: "m1", total: 10, new: 4, reviewed: 6, known: 5, due: 3 }], error: null }]);
  const counts = await listDeckProgressCounts(client, ["m1"]);
  assert.deepEqual(calls[0], ["rpc", "learning_deck_progress_counts", { p_material_ids: ["m1"] }]);
  assert.deepEqual(counts.get("m1"), { materialId: "m1", total: 10, new: 4, reviewed: 6, known: 5, due: 3 });
  assert.equal((await listDeckProgressCounts(fakeClient([]).client, [])).size, 0);
});

test("the card status distinguishes new, seen, repeat and known", () => {
  assert.equal(cardStatusLabel(undefined), "Neu");
  assert.equal(cardStatusLabel(blankProgress("c1")), "Gesehen");
  assert.equal(cardStatusLabel({ ...blankProgress("c1"), known: false }), "Nochmal");
  assert.equal(cardStatusLabel({ ...blankProgress("c1"), known: true }), "Gewusst");
});
