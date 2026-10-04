import { createClient } from "@/lib/supabase/browser";

// Private Notizen und Markierungen an einer Seite einer Unterlage
// (Backend-Migration 20261004090000_course_structure_and_notes).
//
// Seite und Zitat sind einfache Anker: die Datenbank prüft weder die Seitenzahl noch,
// ob das Zitat im Dokument vorkommt. PDF-Koordinaten gibt es bewusst noch nicht, eine
// positionsgenaue Markierung bräuchte eine spätere Backend-Erweiterung.
//
// Notizen gehören dem angemeldeten Nutzer; RLS ist die Grenze, nicht dieser Code.

import type { NoteKind, NoteStatus } from "./note-format";

// Die reinen Regeln liegen in `note-format`, damit sie ohne Supabase-Client testbar sind;
// hier nur durchgereicht, damit Komponenten eine Importquelle haben.
export { NOTE_BODY_MAX, NOTE_QUOTE_MAX, sortNotesForReview, validateNote } from "./note-format";
export type { NoteKind, NoteStatus, NoteValidation } from "./note-format";

export type DocumentNote = {
  id: string;
  materialId: string;
  pageNumber: number;
  kind: NoteKind;
  body: string;
  /** Nur bei `highlight` gesetzt: der markierte Originaltext. */
  quote: string | null;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS = "id, material_id, page_number, kind, body, quote, status, created_at, updated_at";

type NoteRow = {
  id: string;
  material_id: string;
  page_number: number;
  kind: string;
  body: string;
  quote: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

function mapNote(row: NoteRow): DocumentNote {
  return {
    id: row.id,
    materialId: row.material_id,
    pageNumber: row.page_number,
    kind: row.kind === "highlight" ? "highlight" : "note",
    body: row.body,
    quote: row.quote,
    status: row.status === "resolved" ? "resolved" : "open",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDocumentNotes(materialId: string): Promise<DocumentNote[]> {
  const { data, error } = await createClient()
    .from("document_notes")
    .select(COLUMNS)
    .eq("material_id", materialId)
    .order("page_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data.map(mapNote);
}

/**
 * Legt eine Notiz oder Markierung an. `user_id` muss mitgegeben werden; RLS prüft, dass
 * sie zum angemeldeten Nutzer gehört — ein fremder Wert wird abgewiesen, nicht übernommen.
 */
export async function createDocumentNote(input: {
  materialId: string;
  pageNumber: number;
  kind: NoteKind;
  body: string;
  quote?: string | null;
}): Promise<DocumentNote> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Nicht angemeldet.");

  const { data, error } = await supabase
    .from("document_notes")
    .insert({
      user_id: userData.user.id,
      material_id: input.materialId,
      page_number: input.pageNumber,
      kind: input.kind,
      body: input.body.trim(),
      quote: input.kind === "highlight" ? (input.quote ?? "").trim() : null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapNote(data);
}

/** Nach dem Anlegen sind laut Backend ausschließlich Text und Status änderbar. */
export async function updateDocumentNote(
  id: string,
  input: { body?: string; status?: NoteStatus }
): Promise<DocumentNote> {
  const { data, error } = await createClient()
    .from("document_notes")
    .update({
      ...(input.body === undefined ? {} : { body: input.body.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapNote(data);
}

export async function deleteDocumentNote(id: string): Promise<void> {
  const { error } = await createClient().from("document_notes").delete().eq("id", id);
  if (error) throw error;
}
