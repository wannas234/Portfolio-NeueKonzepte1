"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  createDeck,
  deleteDeck,
  listCourseDecks,
  type FlashcardDeckSummary,
} from "@/lib/supabase/queries/flashcards";
import { listDeckProgressCounts, type DeckProgressCounts } from "@/lib/supabase/queries/flashcardReview";
import CreateDeckDialog from "./CreateDeckDialog";
import GenerateDeckDialog from "./GenerateDeckDialog";
import styles from "@/components/documents/documents.module.css";

function DeckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="13" height="15" rx="2.4" /><path d="M9 10h4M9 14h4" />
    </svg>
  );
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)).toUpperCase();
}

/**
 * Zählerstände nachladen. Ein Fehler hier darf die Deckliste nicht verhindern — ohne
 * Fortschritt zeigen die Karten neutrale Werte statt gar nichts.
 */
async function loadCounts(materialIds: string[]): Promise<Map<string, DeckProgressCounts>> {
  try {
    return await listDeckProgressCounts(materialIds);
  } catch {
    return new Map();
  }
}

export default function CourseFlashcardDecks({ courseId }: { courseId: string }) {
  const [loading, setLoading] = useState(true);
  const [decks, setDecks] = useState<FlashcardDeckSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Serverseitiger Lernfortschritt je Deck. Früher nur in der Browser-Sitzung, also pro Tab.
  const [progressCounts, setProgressCounts] = useState<Map<string, DeckProgressCounts>>(new Map());

  useEffect(() => {
    let active = true;
    listCourseDecks(courseId)
      .then(async (nextDecks) => {
        if (!active) return;
        setDecks(nextDecks);
        const counts = await loadCounts(nextDecks.map((deck) => deck.materialId));
        if (active) setProgressCounts(counts);
      })
      .catch(() => { if (active) setLoadError("Die Karteikarten-Decks konnten nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  async function reloadDecks() {
    try {
      const next = await listCourseDecks(courseId);
      setDecks(next);
      setProgressCounts(await loadCounts(next.map((deck) => deck.materialId)));
    } catch {
      setError("Die Decks konnten nicht neu geladen werden. Lade die Seite neu.");
    }
  }

  async function handleCreate(title: string, requestId: string) {
    const deck = await createDeck(courseId, title, requestId);
    // Ein wiederholter Versuch kann ein Deck liefern, das schon in der Liste steht.
    setDecks((current) => current.some((entry) => entry.materialId === deck.materialId)
      ? current
      : [...current, { ...deck, cardCount: 0, createdAt: new Date().toISOString() }]);
    setDialogOpen(false);
  }

  async function handleRemove(materialId: string) {
    setRemovingId(materialId);
    setError(null);
    try {
      await deleteDeck(materialId);
      setDecks((current) => current.filter((deck) => deck.materialId !== materialId));
    } catch {
      setError("Das Deck konnte nicht gelöscht werden.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <Link href={`/courses/${courseId}`} className={styles.backLink}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        Zurück zum Kurs
      </Link>

      <header className={styles.header}>
        <div>
          <h1>Karteikarten</h1>
          <p className={styles.subhead}>Alle Decks in diesem Kurs, aus deinem Vorlesungsmaterial.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryAction} onClick={() => setGenerateOpen(true)}>
            Aus Unterlagen erzeugen
          </button>
          <button type="button" className={styles.uploadButton} onClick={() => setDialogOpen(true)}>
            <span aria-hidden="true">+</span> Neues Deck
          </button>
        </div>
      </header>

      {error && <p className={styles.errorHint} role="alert">{error}</p>}

      {loading && <p className={styles.loading} aria-live="polite">Decks werden geladen …</p>}

      {!loading && loadError && (
        <div className={styles.empty} role="alert">
          <h2>Nicht verfügbar</h2>
          <p>{loadError} Bitte lade die Seite erneut.</p>
        </div>
      )}

      {!loading && !loadError && (
        decks.length === 0 ? (
          <div className={styles.empty}>
            <h2>Noch keine Karteikarten-Decks</h2>
            <p>Leg dein erstes Deck für diesen Kurs an.</p>
            <button type="button" className={styles.uploadButton} onClick={() => setDialogOpen(true)}>
              <span aria-hidden="true">+</span> Neues Deck
            </button>
          </div>
        ) : (
          <ul className={styles.deckGrid}>
            {decks.map((deck) => {
              // Zählerstände kommen serverseitig; fehlen sie noch, zeigt die Karte neutrale Werte.
              const counts = progressCounts.get(deck.materialId);
              const reviewedCount = Math.min(counts?.reviewed ?? 0, deck.cardCount);
              const score = counts && counts.reviewed > 0 ? Math.round((counts.known / counts.reviewed) * 100) : null;
              const percent = deck.cardCount > 0 ? Math.round((reviewedCount / deck.cardCount) * 100) : 0;
              return (
                <li key={deck.materialId}>
                  <article className={styles.deckCard}>
                    <button type="button" className={styles.deckCardDelete} aria-label={`„${deck.title}“ löschen`}
                      onClick={() => void handleRemove(deck.materialId)} disabled={removingId === deck.materialId}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /></svg>
                    </button>
                    <span className={styles.deckCardIcon} aria-hidden="true"><DeckIcon /></span>
                    <span className={styles.deckCardTitle}>{deck.title}</span>
                    <span className={styles.deckCardDate}>ERSTELLT {formatShortDate(deck.createdAt)}</span>
                    <div className={styles.deckCardPills}>
                      <span className={styles.deckCardCount}>{deck.cardCount} {deck.cardCount === 1 ? "Karte" : "Karten"}</span>
                      {score !== null && (
                        <span className={styles.deckCardScore}>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 15 5-5 4 4 7-7" /><path d="M14 7h6v6" /></svg>
                          {score}%
                        </span>
                      )}
                      {/* Fällige Wiederholungen rechnet der Server aus — hier hinge das
                          sonst von der aktuellen Uhrzeit ab und wäre im Render unrein. */}
                      {counts && counts.due > 0 && (
                        <span className={styles.deckCardDue}>{counts.due} fällig</span>
                      )}
                    </div>
                    <div className={styles.deckCardProgressRow}>
                      <span>Fortschritt</span>
                      <span>{reviewedCount}/{deck.cardCount} gesehen</span>
                    </div>
                    <div className={styles.deckCardProgressTrack}>
                      <div className={styles.deckCardProgressFill} style={{ width: `${percent}%` }} />
                    </div>
                    <Link href={`/courses/${courseId}/flashcards/${deck.materialId}`} className={`${styles.deckCardAction} ${styles.deckCardActionPrimary}`}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5v14l11-7Z" /></svg>
                      Jetzt lernen
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>
        )
      )}

      {dialogOpen && (
        <CreateDeckDialog onClose={() => setDialogOpen(false)} onCreate={handleCreate} />
      )}

      {generateOpen && (
        <GenerateDeckDialog
          courseId={courseId}
          onClose={() => setGenerateOpen(false)}
          onSaved={() => {
            setGenerateOpen(false);
            // Das Deck entsteht serverseitig in einer Transaktion; die Liste wird neu geladen,
            // statt eine Zeile zu erfinden, die vom gespeicherten Stand abweichen könnte.
            void reloadDecks();
          }}
        />
      )}
    </div>
  );
}
