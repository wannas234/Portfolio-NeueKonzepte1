"use client";

import { useEffect, useState } from "react";
import { deleteDeck, getDeck, listCourseDecks, type Flashcard, type FlashcardDeck, type FlashcardDeckSummary } from "@/lib/supabase/queries/flashcards";
import {
  blankProgress,
  cardStatusLabel,
  listCardProgress,
  markCardSeen,
  recordFlashcardReview,
  setCardStarred,
  type CardProgress,
} from "@/lib/supabase/queries/flashcardReview";
import GenerateDeckDialog from "@/components/flashcards/GenerateDeckDialog";
import styles from "@/components/documents/documents.module.css";

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.6v.5h5.2v-.5c0-.6.3-1.2.9-1.6A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

const GENERATION_UNAVAILABLE = "Neue Karteikarten lassen sich erst erzeugen, wenn dieses Dokument fertig verarbeitet ist.";

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)).toUpperCase();
}

// Studying a set happens in place; there is no separate route for it.
function DeckStudy({ deck, onBack }: { deck: FlashcardDeck; onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Serverseitiger Fortschritt statt Browser-Ablage: er überlebt Tab und Gerät.
  const [progress, setProgress] = useState<Map<string, CardProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const card: Flashcard | undefined = deck.cards[index];

  useEffect(() => {
    let active = true;
    listCardProgress(deck.cards.map((entry) => entry.id))
      .then((loaded) => { if (active) setProgress(loaded); })
      .catch(() => { /* Ohne Fortschritt bleibt die Lernansicht nutzbar. */ });
    return () => { active = false; };
  }, [deck]);

  function go(delta: number) {
    setRevealed(false);
    setIndex((current) => Math.min(deck.cards.length - 1, Math.max(0, current + delta)));
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
    const cardId = card.id;
    const current = progress.get(cardId);
    const next = !(current?.starred ?? false);
    setProgress((map) => new Map(map).set(cardId, { ...blankProgress(cardId), ...current, starred: next }));
    void setCardStarred(cardId, next).catch(() => {
      setProgress((map) => new Map(map).set(cardId, { ...blankProgress(cardId), ...current, starred: !next }));
      setError("Die Markierung konnte nicht gespeichert werden.");
    });
  }

  function rate(known: boolean) {
    if (!card) return;
    const cardId = card.id;
    setError(null);
    // Der Server bestimmt Intervall und Fälligkeit; hier wird nichts selbst gerechnet.
    void recordFlashcardReview(cardId, known, crypto.randomUUID())
      .then((saved) => { if (saved) setProgress((map) => new Map(map).set(cardId, saved)); })
      .catch(() => setError("Die Antwort konnte nicht gespeichert werden."));
    if (index < deck.cards.length - 1) go(1);
  }

  if (!card) return null;
  const cardState = progress.get(card.id) ?? blankProgress(card.id);
  const status = cardStatusLabel(progress.get(card.id));

  return (
    <div className={styles.studyPanel}>
      <button type="button" className={styles.viewerLink} onClick={onBack}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        Zurück zu den Sets
      </button>

      <div className={styles.studyCard} data-revealed={revealed} onClick={toggleReveal} role="button" tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleReveal(); } }}>
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

      {revealed && (
        <div className={styles.studyRateRow}>
          <button type="button" className={styles.studyRateAgain} onClick={() => rate(false)}>Nochmal üben</button>
          <button type="button" className={styles.studyRateKnown} onClick={() => rate(true)}>Ich wusste es</button>
        </div>
      )}
      {error && <p className={styles.studyError} role="alert">{error}</p>}

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
    </div>
  );
}

// Vorhandene Decks sind Kursinhalt und bleiben immer sichtbar. Nur das Erzeugen neuer
// Karten braucht das Quelldokument: die Function `flashcards` nimmt ausschließlich fertig
// verarbeitete `source_documents`. Fehlt die ID, ist das Erzeugen nicht verfügbar, statt
// auf den ganzen Kurs auszuweichen.
export default function DocumentFlashcards({
  courseId,
  documentId,
}: {
  courseId: string;
  /** `source_documents.id`; `null`, solange das Dokument nicht verarbeitet ist. */
  documentId: string | null;
}) {
  const [decks, setDecks] = useState<FlashcardDeckSummary[] | undefined>(undefined);
  const [openDeck, setOpenDeck] = useState<FlashcardDeck | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  function refreshDecks() {
    listCourseDecks(courseId).then(setDecks).catch(() => setDecks([]));
  }

  useEffect(() => {
    listCourseDecks(courseId).then(setDecks).catch(() => setDecks([]));
  }, [courseId]);

  async function openStudy(materialId: string) {
    setOpenError(null);
    try {
      const deck = await getDeck(materialId);
      if (!deck) { setOpenError("Dieses Set wurde nicht gefunden."); return; }
      setOpenDeck(deck);
    } catch {
      setOpenError("Das Set konnte nicht geladen werden.");
    }
  }

  async function handleDelete(materialId: string) {
    setRemovingId(materialId);
    try {
      await deleteDeck(materialId);
      setDecks((current) => current?.filter((deck) => deck.materialId !== materialId) ?? current);
    } catch {
      setOpenError("Das Set konnte nicht gelöscht werden.");
    } finally {
      setRemovingId(null);
    }
  }

  if (openDeck) {
    return <DeckStudy deck={openDeck} onBack={() => { setOpenDeck(null); refreshDecks(); }} />;
  }

  if (decks === undefined) {
    return <p className={styles.loading}>Karteikarten werden geladen …</p>;
  }

  if (decks.length === 0) {
    return (
      <div className={styles.panelEmpty}>
        <h3>Karteikarten erstellen</h3>
        {documentId ? (
          <>
            <p>Lass aus dieser Unterlage Karteikarten erzeugen. Du prüfst jede Karte, bevor sie gespeichert wird.</p>
            <button type="button" className={styles.uploadButton} onClick={() => setGenerateOpen(true)}>
              Karteikarten erzeugen
            </button>
          </>
        ) : (
          <p>{GENERATION_UNAVAILABLE}</p>
        )}
        {generateOpen && documentId && (
          <GenerateDeckDialog
            courseId={courseId}
            preselectDocumentId={documentId}
            onClose={() => setGenerateOpen(false)}
            onSaved={() => { setGenerateOpen(false); refreshDecks(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.deckPanel}>
      <div className={styles.deckToolbar}>
        <div>
          <h2>Deine Karteikarten-Sets</h2>
          <p>{decks.length} {decks.length === 1 ? "Set verfügbar" : "Sets verfügbar"}</p>
        </div>
        {documentId
          ? (
            <button type="button" className={styles.uploadButton} onClick={() => setGenerateOpen(true)}>
              Karteikarten erzeugen
            </button>
          )
          : <div><p>{GENERATION_UNAVAILABLE}</p></div>}
      </div>
      {openError && <p className={styles.errorHint} role="alert">{openError}</p>}
      <ul className={styles.deckGrid}>
        {decks.map((deck) => (
          <li key={deck.materialId}>
            <article className={styles.deckCard}>
              <button type="button" className={styles.deckCardDelete} aria-label={`„${deck.title}“ löschen`}
                onClick={() => void handleDelete(deck.materialId)} disabled={removingId === deck.materialId}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /></svg>
              </button>
              <button type="button" className={styles.deckCardBody} onClick={() => void openStudy(deck.materialId)}>
                <span className={styles.deckCardIcon} aria-hidden="true"><CardIcon /></span>
                <span className={styles.deckCardTitle}>{deck.title}</span>
                <span className={styles.deckCardDate}>ERSTELLT {formatShortDate(deck.createdAt)}</span>
                <span className={styles.deckCardCount}>{deck.cardCount} {deck.cardCount === 1 ? "Karte" : "Karten"}</span>
              </button>
            </article>
          </li>
        ))}
      </ul>

      {generateOpen && documentId && (
        <GenerateDeckDialog
          courseId={courseId}
          preselectDocumentId={documentId}
          onClose={() => setGenerateOpen(false)}
          onSaved={() => { setGenerateOpen(false); refreshDecks(); }}
        />
      )}
    </div>
  );
}
