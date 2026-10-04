import type { Json } from "../database.types";

// summaries.content is a jsonb column with no backend-defined shape yet.
// { text: string } is a frontend-owned format until the backend defines one.
export function summaryText(content: Json): string {
  if (!content || Array.isArray(content) || typeof content !== "object") return "";
  return typeof content.text === "string" ? content.text : "";
}
