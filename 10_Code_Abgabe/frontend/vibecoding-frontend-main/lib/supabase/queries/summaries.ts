import { createClient } from "@/lib/supabase/browser";
import { summaryText } from "./summary-format";

export type CourseSummary = {
  materialId: string;
  summaryId: string;
  title: string;
  text: string;
  updatedAt: string;
};

type MaterialWithSummaryRow = {
  id: string;
  title: string;
  summaries: {
    id: string;
    content: { text?: string } | null;
    updated_at: string;
  } | null;
};

/**
 * Die vom Nutzer selbst geschriebene Zusammenfassung eines Kurses.
 *
 * Seit Backend-Migration `20261003110000_generated_summaries` legen auch die generierten
 * Zusammenfassungen Material vom Typ `summary` an. Ohne den Filter auf
 * `generation_kind = 'manual'` könnte hier eine generierte Zusammenfassung landen, die der
 * Editor fälschlich als bearbeitbar anzeigt — eine restriktive RLS-Policy erlaubt
 * Clients `update` nur auf manuellen Zeilen, das Speichern würde also ins Leere laufen.
 */
export async function getCourseSummary(courseId: string): Promise<CourseSummary | null> {
  // .limit(1) instead of .maybeSingle(): a partial failure between the two
  // inserts below could in theory leave more than one "summary" material for
  // this course. Take the first rather than throwing on that edge case.
  const { data, error } = await createClient()
    .from("materials")
    // `!inner`: ohne das würde ein nicht passendes Embed die Eltern-Zeile nicht ausschließen,
    // sondern nur `summaries: null` liefern — eine generierte Zusammenfassung würde dann eine
    // vorhandene manuelle verdecken. Nebeneffekt: Material ohne Summary-Zeile fällt ebenfalls raus.
    .select("id, title, summaries!material_id!inner(id, content, updated_at)")
    .eq("course_id", courseId)
    .eq("type", "summary")
    .eq("summaries.generation_kind", "manual")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  const row = (data as MaterialWithSummaryRow[])[0] ?? null;
  if (!row || !row.summaries) return null;

  return {
    materialId: row.id,
    summaryId: row.summaries.id,
    title: row.title,
    text: summaryText(row.summaries.content),
    updatedAt: row.summaries.updated_at,
  };
}

/**
 * Speichert die eigene Zusammenfassung eines Kurses.
 *
 * Seit Backend-Migration 20261003140000 erledigt das der RPC `save_course_summary`. Er
 * sperrt den Kurs für die Dauer der Transaktion, aktualisiert ausschließlich die älteste
 * **manuelle** Zusammenfassung und legt sonst eine neue an. Das ersetzt das frühere
 * Lesen-dann-Schreiben, bei dem zwei gleichzeitige Erst-Speicherungen zwei Materialien
 * erzeugen konnten, und es kann per Definition keine generierte Zeile erwischen.
 *
 * Grenzen des Backends: Titel 1–200, Text 1–30000 Zeichen, jeweils nach Trimmen.
 */
export async function saveCourseSummary(
  courseId: string,
  input: { title: string; text: string }
): Promise<CourseSummary> {
  const { data, error } = await createClient().rpc("save_course_summary", {
    p_course: courseId,
    p_title: input.title.trim(),
    p_text: input.text.trim(),
  });
  if (error) throw error;

  const row = data as { material_id?: unknown; summary_id?: unknown; updated_at?: unknown } | null;
  if (typeof row?.material_id !== "string" || typeof row.summary_id !== "string") {
    throw new Error("Unerwartete Antwort beim Speichern der Zusammenfassung.");
  }

  return {
    materialId: row.material_id,
    summaryId: row.summary_id,
    title: input.title.trim(),
    text: input.text.trim(),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  };
}

// Deleting the material cascades to the summary row (see core_erm migration).
export async function deleteCourseSummary(materialId: string): Promise<void> {
  const { error } = await createClient().from("materials").delete().eq("id", materialId);
  if (error) throw error;
}

/**
 * Die zuletzt generierte Zusammenfassung eines Kurses oder eines einzelnen Dokuments.
 *
 * `summary_generations` ist für Eigentümer lesbar und hält nur Metadaten. Den Inhalt holt
 * anschließend die `result`-Aktion der Edge Function, weil nur sie zusätzlich ermittelt,
 * ob das Ergebnis inzwischen veraltet ist (`is_stale`).
 *
 * `documentId` ist eine `source_documents.id`, nicht die des Materials oder der Datei.
 */
export async function getLatestGeneratedSummaryId(
  courseId: string,
  documentId?: string
): Promise<string | null> {
  const query = createClient()
    .from("summary_generations")
    .select("summary_id, created_at")
    .eq("course_id", courseId)
    .eq("kind", documentId ? "document" : "course");

  const { data, error } = await (documentId ? query.eq("document_id", documentId) : query)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data[0]?.summary_id ?? null;
}
