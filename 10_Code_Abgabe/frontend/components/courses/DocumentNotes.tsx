"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  createDocumentNote,
  deleteDocumentNote,
  listDocumentNotes,
  NOTE_BODY_MAX,
  NOTE_QUOTE_MAX,
  sortNotesForReview,
  updateDocumentNote,
  validateNote,
  type DocumentNote,
  type NoteKind,
} from "@/lib/supabase/queries/documentNotes";
import styles from "@/components/documents/documents.module.css";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Private Notizen und Markierungen an einzelnen Seiten einer Unterlage.
 *
 * Seitenzahl und Zitat sind einfache Anker — das Backend prüft weder, ob es die Seite
 * gibt, noch ob das Zitat dort steht. Eine positionsgenaue Markierung im PDF bräuchte
 * eine Backend-Erweiterung um Koordinaten; bis dahin trägt der Nutzer die Seite ein.
 *
 * Offene Notizen stehen oben: sie sind die Liste, die beim Wiederholen zählt.
 */
export default function DocumentNotes({
  materialId,
  onOpenPage,
}: {
  materialId: string;
  /** Öffnet die Unterlage an dieser Seite; fehlt, wenn der Viewer das nicht kann. */
  onOpenPage?: (page: number) => void;
}) {
  const [notes, setNotes] = useState<DocumentNote[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<NoteKind>("note");
  const [page, setPage] = useState("1");
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listDocumentNotes(materialId)
      .then((loaded) => { if (active) setNotes(loaded); })
      .catch(() => {
        if (!active) return;
        // Leere Liste plus Hinweis: das Formular bleibt nutzbar, der Fehler sichtbar.
        setNotes([]);
        setLoadError("Vorhandene Notizen konnten nicht geladen werden.");
      });
    return () => { active = false; };
  }, [materialId]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pageNumber = Number.parseInt(page, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      setError("Die Seitenzahl muss mindestens 1 sein.");
      return;
    }
    const check = validateNote(kind, body, quote);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createDocumentNote({ materialId, pageNumber, kind, body, quote });
      setNotes((current) => [...(current ?? []), created]);
      setBody("");
      setQuote("");
    } catch {
      setError("Die Notiz konnte nicht gespeichert werden. Bitte versuche es erneut.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(note: DocumentNote) {
    setBusyId(note.id);
    setError(null);
    try {
      const next = await updateDocumentNote(note.id, { status: note.status === "open" ? "resolved" : "open" });
      setNotes((current) => (current ?? []).map((entry) => (entry.id === next.id ? next : entry)));
    } catch {
      setError("Der Status konnte nicht geändert werden.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await deleteDocumentNote(id);
      setNotes((current) => (current ?? []).filter((entry) => entry.id !== id));
    } catch {
      setError("Die Notiz konnte nicht gelöscht werden.");
    } finally {
      setBusyId(null);
    }
  }

  if (notes === undefined && !loadError) {
    return <p className={styles.loading} aria-live="polite">Notizen werden geladen …</p>;
  }

  const sorted = sortNotesForReview(notes ?? []);
  const open = sorted.filter((note) => note.status === "open").length;

  return (
    <div className={styles.notesPanel}>
      <div className={styles.notesHead}>
        <div>
          <h2>Deine Notizen</h2>
          <p>
            {sorted.length === 0
              ? "Halte fest, was du an einer bestimmten Seite nachlesen willst."
              : `${sorted.length} ${sorted.length === 1 ? "Eintrag" : "Einträge"} · ${open} offen`}
          </p>
        </div>
      </div>

      <form className={styles.noteForm} onSubmit={handleCreate}>
        <div className={styles.noteFormRow}>
          <label>
            <span>Art</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as NoteKind)} disabled={saving}>
              <option value="note">Notiz</option>
              <option value="highlight">Markierung</option>
            </select>
          </label>
          <label>
            <span>Seite</span>
            <input type="number" min={1} value={page} onChange={(event) => setPage(event.target.value)} disabled={saving} />
          </label>
        </div>

        {kind === "highlight" && (
          <label className={styles.noteField}>
            <span>Zitierter Text</span>
            <textarea
              value={quote}
              onChange={(event) => setQuote(event.target.value)}
              rows={2}
              maxLength={NOTE_QUOTE_MAX}
              placeholder="Die Stelle aus der Unterlage, die du markieren willst"
              disabled={saving}
            />
          </label>
        )}

        <label className={styles.noteField}>
          <span>{kind === "highlight" ? "Kommentar (optional)" : "Notiz"}</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={NOTE_BODY_MAX}
            placeholder={kind === "highlight" ? "Warum ist diese Stelle wichtig?" : "Was willst du dir merken?"}
            disabled={saving}
          />
        </label>

        {error && <p className={styles.errorHint} role="alert">{error}</p>}

        <button type="submit" className={styles.uploadButton} disabled={saving}>
          {saving ? "Wird gespeichert …" : "Hinzufügen"}
        </button>
      </form>

      {loadError && <p className={styles.errorHint} role="alert">{loadError}</p>}

      {sorted.length > 0 && (
        <ul className={styles.noteList}>
          {sorted.map((note) => (
            <li key={note.id} className={styles.noteItem} data-resolved={note.status === "resolved" || undefined}>
              <div className={styles.noteMeta}>
                {onOpenPage ? (
                  <button type="button" className={styles.notePage} data-link onClick={() => onOpenPage(note.pageNumber)}
                    title="Unterlage an dieser Seite öffnen">
                    Seite {note.pageNumber} →
                  </button>
                ) : (
                  <span className={styles.notePage}>Seite {note.pageNumber}</span>
                )}
                <span className={styles.noteKind} data-kind={note.kind}>
                  {note.kind === "highlight" ? "Markierung" : "Notiz"}
                </span>
                <span className={styles.noteDate}>{formatDate(note.createdAt)}</span>
              </div>

              {note.quote && <blockquote className={styles.noteQuote}>„{note.quote}“</blockquote>}
              {note.body && <p className={styles.noteBody}>{note.body}</p>}

              <div className={styles.noteActions}>
                <button type="button" className={styles.textButton} data-tone="neutral"
                  onClick={() => void toggleStatus(note)} disabled={busyId === note.id}>
                  {note.status === "open" ? "Erledigt" : "Wieder öffnen"}
                </button>
                <button type="button" className={styles.textButton}
                  onClick={() => void handleDelete(note.id)} disabled={busyId === note.id}>
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
