import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryText } from "./summary-format.ts";

test("the frontend summary JSON format accepts only a string text field", () => {
  assert.equal(summaryText({ text: "Lerninhalt" }), "Lerninhalt");
  for (const value of [null, "text", 42, true, [], { text: 42 }, { other: "value" }]) {
    assert.equal(summaryText(value), "");
  }
});
