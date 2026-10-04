// Reine Regeln rund um Seitennotizen — ohne Supabase-Client, damit sie testbar bleiben.
// Sie spiegeln die Grenzen aus Backend-Migration 20261004090000, damit eine ungültige
// Eingabe nicht erst nach dem Absenden auffällt.

export type NoteKind = "note" | "highlight";
export type NoteStatus = "open" | "resolved";

export const NOTE_BODY_MAX = 4000;
export const NOTE_QUOTE_MAX = 2000;

export type NoteValidation = { ok: true } | { ok: false; message: string };

export function validateNote(kind: NoteKind, body: string, quote: string): NoteValidation {
  const text = body.trim();
  if (kind === "note" && text.length === 0) return { ok: false, message: "Schreib etwas in die Notiz." };
  if (text.length > NOTE_BODY_MAX) {
    return { ok: false, message: `Die Notiz darf höchstens ${NOTE_BODY_MAX} Zeichen haben.` };
  }
  if (kind === "highlight") {
    const marked = quote.trim();
    if (marked.length === 0) return { ok: false, message: "Markierungen brauchen den zitierten Text." };
    if (marked.length > NOTE_QUOTE_MAX) {
      return { ok: false, message: `Das Zitat darf höchstens ${NOTE_QUOTE_MAX} Zeichen haben.` };
    }
  }
  return { ok: true };
}

type SortableNote = { status: NoteStatus; pageNumber: number; createdAt: string };

/** Offene zuerst, dann nach Seite und Entstehung — das ist die Liste zum Wiederholen. */
export function sortNotesForReview<T extends SortableNote>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
