"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "@/components/documents/documents.module.css";

export default function CreateDeckDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, requestId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Die Request-ID gehört zu einem Versuch mit einem bestimmten Titel: ein erneutes Absenden
  // nach einem Fehler nutzt dieselbe ID, damit kein zweites Deck entsteht. Ein geänderter
  // Titel ist ein neuer Versuch und bekommt eine neue ID.
  const attempt = useRef<{ title: string; requestId: string } | null>(null);

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
    const trimmed = title.trim();
    if (!trimmed) return;
    if (attempt.current?.title !== trimmed) {
      attempt.current = { title: trimmed, requestId: crypto.randomUUID() };
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmed, attempt.current.requestId);
    } catch {
      setError("Das Deck konnte nicht erstellt werden. Bitte versuche es erneut.");
      setSaving(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-deck-heading"
      >
        <div className={styles.dialogHeader}>
          <h2 id="create-deck-heading">Deck anlegen</h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Schließen"
            onClick={onClose}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="deck-title">Titel</label>
            <input
              id="deck-title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. Woche 1 – Grundlagen"
              required
              disabled={saving}
            />
          </div>
          {error && <p className={styles.errorHint} role="alert">{error}</p>}
          <div className={styles.dialogFooter}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={saving}>Abbrechen</button>
            <button type="submit" className={styles.submitButton} disabled={saving || !title.trim()}>
              {saving ? "Wird erstellt …" : "Deck erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
