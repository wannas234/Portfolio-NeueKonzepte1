// Pure helpers that turn the chat backend's answer text into usable learning content.
//
// Backend contract (chat Edge Function, `_shared/answers.ts`): the answer is stored
// verbatim and the model is instructed to cite every statement with `[n]` (1–99,
// several as `[1][2]`). Those markers are therefore part of every answer, including
// answers to structured prompts. Only this exact marker syntax is removed here.

/**
 * A run of `[n]` markers. Not a marker: `[1](url)` / `[1]: ...` (link syntax, the
 * backend rejects these as citations too). Code is protected separately, see
 * `stripCitationMarkers`, so a marker attached directly to a word is still a marker.
 */
const CITATION_RUN = /([ \t]*)((?:\[[1-9]\d?\])+)(?![(:])/g;

function stripMarkersIn(text: string): string {
  return text.replace(CITATION_RUN, (match, space: string, _run: string, offset: number, whole: string) => {
    const after = whole[offset + match.length];
    if (after === undefined || /[\s.,;:!?)]/.test(after)) return "";
    return space ? " " : "";
  });
}

/** Removes citation markers everywhere except inside code fences and inline code, where `[1]` is content. */
export function stripCitationMarkers(text: string): string {
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, index) => (index % 2 === 1 ? part : stripMarkersIn(part))).join("");
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Removes one Markdown code fence that wraps the entire answer; anything else is untouched. */
export function stripCodeFence(text: string): string {
  const trimmed = normalizeNewlines(text).trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*)\n```$/);
  return match ? match[1] : trimmed;
}

/** Free-text answers (summary, explanation): only citation markers and outer whitespace go. `null` = empty. */
export function cleanProse(raw: string): string | null {
  const cleaned = stripCitationMarkers(normalizeNewlines(raw))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || null;
}

type LabelledLine = { kind: string; n: number; option: string | null; text: string };

// `F1: …`, `A1: …`, `O1B: …`, `K1: …`, `E1: …`, optionally preceded by a bullet or a
// list number ("1. F1: …"). Every other line (preamble, closing remarks) is ignored.
const LABEL = /^(?:[-*•]\s+|\d+[.)]\s+)?([A-Z])(\d+)([A-D])?\s*:\s*(.*)$/i;

function labelledLines(raw: string): LabelledLine[] {
  const lines: LabelledLine[] = [];
  for (const line of stripCodeFence(raw).split("\n")) {
    const match = stripCitationMarkers(line).trim().match(LABEL);
    if (!match) continue;
    lines.push({ kind: match[1].toUpperCase(), n: Number(match[2]), option: match[3]?.toUpperCase() ?? null, text: match[4].trim() });
  }
  return lines;
}

function groupByNumber(lines: LabelledLine[]): Map<number, LabelledLine[]> {
  const groups = new Map<number, LabelledLine[]>();
  for (const line of lines) groups.set(line.n, [...(groups.get(line.n) ?? []), line]);
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}

/** The single value of a label; `null` when it is missing, repeated or empty (ambiguous or incomplete). */
function single(lines: LabelledLine[], kind: string, option: string | null = null): string | null {
  const found = lines.filter((line) => line.kind === kind && line.option === option);
  return found.length === 1 && found[0].text ? found[0].text : null;
}

// Für Karteikarten gab es hier einen Parser, der Chatantworten in Karten zerlegt hat.
// Seit dem Backend-Endpunkt `flashcards` liefert das Backend geprüfte Karten mit
// Quellenangaben, siehe lib/flashcardGeneration.ts; der Parser ist entfallen.

export type ParsedQuizQuestion = { question: string; options: [string, string, string, string]; correctIndex: number; explanation: string };
export type QuizParseResult =
  | { ok: true; questions: ParsedQuizQuestion[]; discarded: number }
  | { ok: false };

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

/**
 * Expected per question: `F<n>`, `O<n>A`–`O<n>D`, `K<n>` (exactly one letter) and `E<n>`.
 * A question is only kept when all four options are present and distinct and the key
 * names one of them; the correct answer is never guessed.
 */
export function parseQuiz(raw: string): QuizParseResult {
  const questions: ParsedQuizQuestion[] = [];
  let discarded = 0;
  for (const lines of groupByNumber(labelledLines(raw).filter((line) => ["F", "O", "K", "E"].includes(line.kind))).values()) {
    const question = single(lines, "F");
    const explanation = single(lines, "E");
    const options = OPTION_LETTERS.map((letter) => single(lines, "O", letter));
    const key = single(lines, "K")?.match(/^([A-D])[.)]?$/i)?.[1].toUpperCase();
    const [a, b, c, d] = options;
    const distinct = new Set(options.map((option) => option?.toLowerCase())).size === 4;
    if (!question || !explanation || !key || !a || !b || !c || !d || !distinct) { discarded += 1; continue; }
    questions.push({ question, options: [a, b, c, d], correctIndex: OPTION_LETTERS.indexOf(key as (typeof OPTION_LETTERS)[number]), explanation });
  }
  return questions.length > 0 ? { ok: true, questions, discarded } : { ok: false };
}

/** Shown next to a partly usable result so dropped entries are never silent. */
export function discardedNotice(discarded: number): string | null {
  if (discarded === 0) return null;
  const dropped = discarded === 1 ? "1 unvollständiger Eintrag wurde" : `${discarded} unvollständige Einträge wurden`;
  return `${dropped} verworfen. Es werden nur vollständige Einträge angezeigt. Du kannst die Generierung wiederholen.`;
}
