"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { DECK_DESCRIPTION_MAX, DECK_TITLE_MAX } from "@/lib/supabase/queries/flashcards";
import styles from "@/components/documents/documents.module.css";

/** Name und Beschreibung eines Decks bearbeiten; gilt auch für generierte Decks. */
export default function EditDeckDialog({
  title: initialTitle,
  description: initialDescription,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onSave: (input: { title: string; description: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: title.trim(), description: description.trim() });
    } catch {
      setError("Die Änderungen konnten nicht gespeichert werden. Bitte versuche es erneut.");
      setSaving(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="edit-deck-heading">
        <div className={styles.dialogHeader}>
          <h2 id="edit-deck-heading">Deck bearbeiten</h2>
          <button type="button" className={styles.closeButton} aria-label="Schließen" onClick={onClose} disabled={saving}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="edit-deck-title">Titel</label>
            <input
              id="edit-deck-title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={DECK_TITLE_MAX}
              required
              disabled={saving}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="edit-deck-description">Beschreibung (optional)</label>
            <textarea
              id="edit-deck-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={DECK_DESCRIPTION_MAX}
              rows={3}
              placeholder="Worum geht es in diesem Deck?"
              disabled={saving}
            />
          </div>
          {error && <p className={styles.errorHint} role="alert">{error}</p>}
          <div className={styles.dialogFooter}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={saving}>Abbrechen</button>
            <button type="submit" className={styles.submitButton} disabled={saving || !title.trim()}>
              {saving ? "Wird gespeichert …" : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
