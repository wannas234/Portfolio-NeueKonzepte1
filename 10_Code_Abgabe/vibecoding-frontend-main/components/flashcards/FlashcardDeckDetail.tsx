"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addFlashcard,
  deleteDeck,
  deleteFlashcard,
  getDeck,
  updateDeck,
  updateFlashcard,
  type FlashcardDeck,
} from "@/lib/supabase/queries/flashcards";
import {
  blankProgress,
  cardStatusLabel,
  listCardProgress,
  listDeckProgressCounts,
  markCardSeen,
  recordFlashcardReview,
  setCardStarred,
  type CardProgress,
} from "@/lib/supabase/queries/flashcardReview";
import EditDeckDialog from "./EditDeckDialog";
import styles from "@/components/documents/documents.module.css";

export default function FlashcardDeckDetail({
  courseId,
  materialId,
}: {
  courseId: string;
  materialId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState<FlashcardDeck | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingDeck, setEditingDeck] = useState(false);
  // Die Karte, die gerade in der Verwaltung bearbeitet wird, mit ihren ungespeicherten Eingaben.
  const [editingCard, setEditingCard] = useState<{ id: string; question: string; answer: string } | null>(null);
  const [savingCard, setSavingCard] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingSet, setDeletingSet] = useState(false);
  // Serverseitiger Lernfortschritt je Karte. Früher lag er nur in der Browser-Sitzung
  // und war nach dem Schließen des Tabs weg; jetzt gehört er zum Konto.
  const [progress, setProgress] = useState<Map<string, CardProgress>>(new Map());
  // Fällige Wiederholungen zählt der Server; `null`, solange die Zahl nicht geladen ist.
  const [due, setDue] = useState<number | null>(null);

  const refreshDue = useCallback(() => {
    listDeckProgressCounts([materialId])
      .then((counts) => setDue(counts.get(materialId)?.due ?? 0))
      .catch(() => { /* Ohne Zählerstand bleibt das Deck lernbar. */ });
  }, [materialId]);

  useEffect(() => {
    let active = true;
    getDeck(materialId)
      .then(async (nextDeck) => {
        if (!active) return;
        setDeck(nextDeck);
        if (!nextDeck || nextDeck.cards.length === 0) return;
        const loaded = await listCardProgress(nextDeck.cards.map((entry) => entry.id));
        if (!active) return;
        setProgress(loaded);
        refreshDue();
      })
      .catch(() => { if (active) setLoadError("Das Deck konnte nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [materialId, refreshDue]);

  const card = deck?.cards[index];

  function go(delta: number) {
    setRevealed(false);
    setIndex((current) => Math.min((deck?.cards.length ?? 1) - 1, Math.max(0, current + delta)));
  }

  /** Titel und Beschreibung gehen gemeinsam an den RPC; Fehler zeigt der Dialog selbst. */
  async function handleSaveDeck(input: { title: string; description: string }) {
    await updateDeck(materialId, input);
    setDeck((current) => current && { ...current, ...input });
    setEditingDeck(false);
  }

  async function handleSaveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCard || !editingCard.question.trim() || !editingCard.answer.trim()) return;
    setSavingCard(true);
    setError(null);
    try {
      const saved = await updateFlashcard(editingCard.id, {
        question: editingCard.question.trim(),
        answer: editingCard.answer.trim(),
      });
      setDeck((current) => current && {
        ...current,
        cards: current.cards.map((entry) => (entry.id === saved.id ? saved : entry)),
      });
      setEditingCard(null);
    } catch {
      setError("Die Karteikarte konnte nicht geändert werden.");
    } finally {
      setSavingCard(false);
    }
  }

  // Aufdecken zählt als „gesehen“ und wird wie der übrige Fortschritt am Konto gespeichert.
  function toggleReveal() {
    setRevealed((current) => !current);
    if (!card || revealed || progress.has(card.id)) return;
    const cardId = card.id;
    setProgress((map) => new Map(map).set(cardId, blankProgress(cardId)));
    void markCardSeen(cardId).catch(() => {
      setProgress((map) => {
        if (map.get(cardId)?.reviewedAt) return map;
        const next = new Map(map);
        next.delete(cardId);
        return next;
      });
    });
  }

  function toggleStar() {
    if (!card) return;
    const current = progress.get(card.id);
    const next = !(current?.starred ?? false);
    // Sofort umschalten, damit der Stern nicht hängt; schlägt das Speichern fehl, zurück.
    setProgress((map) => new Map(map).set(card.id, { ...blankProgress(card.id), ...current, starred: next }));
    void setCardStarred(card.id, next).catch(() => {
      setProgress((map) => new Map(map).set(card.id, { ...blankProgress(card.id), ...current, starred: !next }));
      setError("Die Markierung konnte nicht gespeichert werden.");
    });
  }

  function rate(known: boolean) {
    if (!card) return;
    const cardId = card.id;
    const last = index === (deck?.cards.length ?? 1) - 1;
    // Der Server bestimmt Intervall und Fälligkeit; hier wird nichts selbst gerechnet.
    void recordFlashcardReview(cardId, known, crypto.randomUUID())
      .then((saved) => {
        if (saved) setProgress((map) => new Map(map).set(cardId, saved));
        refreshDue();
      })
      .catch(() => setError("Die Antwort konnte nicht gespeichert werden."));
    if (!last) go(1);
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deck || !question.trim() || !answer.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const newCard = await addFlashcard(deck.deckId, { question: question.trim(), answer: answer.trim() });
      setDeck((current) => current && { ...current, cards: [...current.cards, newCard] });
      setQuestion("");
      setAnswer("");
    } catch {
      setError("Die Karteikarte konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveCard(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      await deleteFlashcard(id);
      setDeck((current) => current && { ...current, cards: current.cards.filter((entry) => entry.id !== id) });
      setIndex((current) => Math.max(0, Math.min(current, (deck?.cards.length ?? 1) - 2)));
    } catch {
      setError("Die Karteikarte konnte nicht gelöscht werden.");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDeleteSet() {
    setDeletingSet(true);
    try {
      await deleteDeck(materialId);
      router.push(`/courses/${courseId}/flashcards`);
    } catch {
      setError("Das Set konnte nicht gelöscht werden.");
      setDeletingSet(false);
    }
  }

  if (loading) return <div className={styles.page}><p className={styles.loading} aria-live="polite">Deck wird geladen …</p></div>;

  if (loadError || !deck) {
    return (
      <div className={styles.page}>
        <div className={styles.empty} role={loadError ? "alert" : undefined}>
          <h2>{loadError ? "Nicht verfügbar" : "Deck nicht gefunden"}</h2>
          <p>{loadError ?? "Dieses Deck existiert nicht oder wurde bereits gelöscht."}</p>
          <Link href={`/courses/${courseId}/flashcards`} className={styles.uploadButton}>Zurück zu den Sets</Link>
        </div>
      </div>
    );
  }

  const cardState = (card ? progress.get(card.id) : undefined) ?? blankProgress(card?.id ?? "");
  const status = cardStatusLabel(card ? progress.get(card.id) : undefined);
  // „Gesehen“, „beantwortet“ und „gewusst“ stehen direkt im geladenen Fortschritt. Die Zahl
  // fälliger Wiederholungen hängt von der Uhrzeit ab und kommt deshalb vom Server (`due`).
  const tracked = deck.cards.map((entry) => progress.get(entry.id)).filter((entry) => entry !== undefined);
  const counts = {
    seen: tracked.length,
    reviewed: tracked.filter((entry) => entry.known !== null).length,
    known: tracked.filter((entry) => entry.known === true).length,
  };

  return (
    <div className={styles.page}>
      <Link href={`/courses/${courseId}/flashcards`} className={styles.backLink}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        Zurück zu den Sets
      </Link>

      <header className={styles.header}>
        <div>
          <h1>{deck.title}</h1>
          <p className={styles.subhead}>{deck.cards.length} {deck.cards.length === 1 ? "Karte" : "Karten"}</p>
          {deck.description && <p className={styles.deckDescription}>{deck.description}</p>}
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.textButton} data-tone="neutral" onClick={() => setEditingDeck(true)}>
            Bearbeiten
          </button>
          <button type="button" className={styles.deleteSetButton} onClick={() => setConfirmingDelete(true)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /></svg>
            Set löschen
          </button>
        </div>
      </header>

      {error && <p className={styles.errorHint} role="alert">{error}</p>}

      {deck.cards.length === 0 ? (
        <div className={styles.empty}>
          <h2>Noch keine Karteikarten</h2>
          <p>Füg die erste Karteikarte für dieses Deck hinzu.</p>
        </div>
      ) : (
        card && (
          <div className={styles.studyPanel}>
            <div
              className={styles.studyCard}
              data-revealed={revealed}
              onClick={toggleReveal}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleReveal(); } }}
            >
              <div className={styles.studyBadgeRow}>
                <span className={styles.studyStatusTag} data-tone={status === "Gewusst" ? "known" : undefined}>{status}</span>
                <button type="button" className={styles.studyStarButton} data-active={cardState.starred}
                  aria-label={cardState.starred ? "Aus Favoriten entfernen" : "Als Favorit markieren"}
                  onClick={(event) => { event.stopPropagation(); toggleStar(); }}>
                  <svg viewBox="0 0 24 24" fill={cardState.starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7Z" /></svg>
                </button>
              </div>
              <p className={styles.studyQuestion}>{revealed ? card.answer : card.question}</p>
              <span className={styles.studyHint}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 1 3 6.7" /><path d="M3 17v-5h5" /></svg>
                {revealed ? "Klicken für die Frage" : "Klicken zum Anzeigen der Antwort"}
              </span>
            </div>

            <div className={styles.rateRow}>
              <button type="button" className={styles.rateAgain} onClick={() => rate(false)}>Nochmal üben</button>
              <button type="button" className={styles.rateKnown} onClick={() => rate(true)}>Ich wusste es</button>
            </div>

            <div className={styles.studyNav}>
              <button type="button" onClick={() => go(-1)} disabled={index === 0}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></svg>
                Zurück
              </button>
              <span>{index + 1} / {deck.cards.length}</span>
              <button type="button" onClick={() => go(1)} disabled={index === deck.cards.length - 1}>
                Weiter
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 5 7 7-7 7" /></svg>
              </button>
            </div>
            <p className={styles.uploadHint}>
              {counts.seen} von {deck.cards.length} Karten gesehen · {counts.known} von {counts.reviewed} beantworteten Karten gewusst.
              {due !== null && due > 0 && <> <span className={styles.deckCardDue}>{due} fällig</span></>}
            </p>

            <div className={styles.manageSection}>
              <button type="button" className={styles.manageToggle} data-open={manageOpen} onClick={() => setManageOpen((current) => !current)}>
                {manageOpen ? "Kartenverwaltung ausblenden" : `Karten verwalten (${deck.cards.length})`}
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {manageOpen && (
                <div className={styles.managePanel}>
                  <div className={styles.managePanelHead}>
                    <span className={styles.managePanelIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="13" height="15" rx="2.4" /><path d="M9 10h4M9 14h4" /></svg>
                    </span>
                    <div>
                      <h3>Karten in diesem Set</h3>
                      <p>Neue Karte hinzufügen, bestehende ändern oder entfernen.</p>
                    </div>
                  </div>
                  <form className={styles.manageForm} onSubmit={handleAdd}>
                    <div className={styles.field}>
                      <label htmlFor="card-question">Frage</label>
                      <input id="card-question" value={question} placeholder="z. B. Was ist Phishing?"
                        onChange={(event) => setQuestion(event.target.value)} disabled={saving} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="card-answer">Antwort</label>
                      <input id="card-answer" value={answer} placeholder="Kurze, prägnante Antwort"
                        onChange={(event) => setAnswer(event.target.value)} disabled={saving} />
                    </div>
                    <button type="submit" className={styles.uploadButton} disabled={saving || !question.trim() || !answer.trim()}>
                      <span aria-hidden="true">+</span> {saving ? "Wird gespeichert …" : "Karte hinzufügen"}
                    </button>
                  </form>
                  <ul className={styles.cardList}>
                    {deck.cards.map((entry, entryIndex) => editingCard?.id === entry.id ? (
                      <li key={entry.id}>
                        <form className={styles.cardEditForm} onSubmit={handleSaveCard}>
                          <div className={styles.field}>
                            <label htmlFor="edit-card-question">Frage</label>
                            <input id="edit-card-question" value={editingCard.question} autoFocus disabled={savingCard}
                              onChange={(event) => setEditingCard({ ...editingCard, question: event.target.value })} />
                          </div>
                          <div className={styles.field}>
                            <label htmlFor="edit-card-answer">Antwort</label>
                            <textarea id="edit-card-answer" value={editingCard.answer} rows={3} disabled={savingCard}
                              onChange={(event) => setEditingCard({ ...editingCard, answer: event.target.value })} />
                          </div>
                          <div className={styles.dialogFooter}>
                            <button type="button" className={styles.cancelButton} onClick={() => setEditingCard(null)} disabled={savingCard}>Abbrechen</button>
                            <button type="submit" className={styles.submitButton}
                              disabled={savingCard || !editingCard.question.trim() || !editingCard.answer.trim()}>
                              {savingCard ? "Wird gespeichert …" : "Speichern"}
                            </button>
                          </div>
                        </form>
                      </li>
                    ) : (
                      <li key={entry.id} className={styles.cardListRow}>
                        <span className={styles.cardListIndex} aria-hidden="true">{entryIndex + 1}</span>
                        <span>{entry.question}</span>
                        <button type="button" className={styles.cardListEdit} aria-label={`„${entry.question}“ bearbeiten`}
                          onClick={() => setEditingCard({ id: entry.id, question: entry.question, answer: entry.answer })}
                          disabled={savingCard}>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
                        </button>
                        <button type="button" className={styles.cardListRemove} aria-label={`„${entry.question}“ löschen`}
                          onClick={() => void handleRemoveCard(entry.id)} disabled={removingId === entry.id}>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /></svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {editingDeck && (
        <EditDeckDialog
          title={deck.title}
          description={deck.description}
          onClose={() => setEditingDeck(false)}
          onSave={handleSaveDeck}
        />
      )}

      {confirmingDelete && (
        <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget && !deletingSet) setConfirmingDelete(false); }}>
          <div className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-set-heading">
            <span className={styles.confirmIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /><path d="M10 11v6M14 11v6" /></svg>
            </span>
            <h2 id="delete-set-heading">Set löschen?</h2>
            <p>„{deck.title}&quot; wird endgültig entfernt. Das kann nicht rückgängig gemacht werden.</p>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.cancelButton} onClick={() => setConfirmingDelete(false)} disabled={deletingSet}>Abbrechen</button>
              <button type="button" className={styles.dangerButton} onClick={() => void handleDeleteSet()} disabled={deletingSet}>
                {deletingSet ? "Wird gelöscht …" : "Löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
