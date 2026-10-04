"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useDialogA11y } from "@/components/useDialogA11y";
import {
  cancelFlashcardJob,
  continueFlashcardJob,
  fetchFlashcardJob,
  FLASHCARD_POLL_INTERVAL_MS,
  FlashcardGenerationError,
  flashcardErrorMessage,
  flashcardProgress,
  isFlashcardJobRunning,
  listSelectableDocuments,
  listUnfinishedJobs,
  MAX_REQUESTED_CARDS,
  MAX_SELECTED_DOCUMENTS,
  MAX_DECK_TITLE_LENGTH,
  MIN_REQUESTED_CARDS,
  retryFlashcardJob,
  saveGeneratedDeck,
  startFlashcardAnalysis,
  toFlashcardErrorCode,
  validateDeckSave,
  type FlashcardJob,
  type GeneratedCard,
  type SelectableDocument,
} from "@/lib/flashcardGeneration";
import { applyFlashcardDraft } from "@/lib/supabase/queries/learning-drafts";
import { useFlashcardDraft } from "./useFlashcardDraft";
import styles from "@/components/documents/documents.module.css";

type Step =
  | { name: "choose" }
  | { name: "working"; job: FlashcardJob }
  | { name: "estimated"; job: FlashcardJob }
  | { name: "review"; job: FlashcardJob }
  // `jobId` nur, wenn ein gescheiterter Auftrag fortgesetzt werden kann: ein Retry behält
  // laut Backend-Vertrag das bereits bezahlte Budget, ein Neustart nicht.
  | { name: "error"; message: string; jobId: string | null };

type EditableCard = GeneratedCard & { keep: boolean };

/**
 * Karteikarten aus Kursunterlagen erzeugen.
 *
 * Mehrstufig, weil das Backend den Auftrag bewusst nach der Schätzung anhält: der Nutzer
 * sieht erst, wie viele Karten sinnvoll wären, und entscheidet dann. Gespeichert wird
 * nichts, bevor er die Karten im Review bestätigt hat.
 */
export default function GenerateDeckDialog({
  courseId,
  preselectDocumentId,
  onClose,
  onSaved,
}: {
  courseId: string;
  /** `source_documents.id`, vorausgewählt wenn der Dialog aus einer Dokumentansicht kommt.
   *  Die Auswahl bleibt änderbar — das Backend erlaubt mehrere Dokumente je Auftrag. */
  preselectDocumentId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [documents, setDocuments] = useState<SelectableDocument[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectDocumentId ? [preselectDocumentId] : [])
  );
  const [automatic, setAutomatic] = useState(true);
  const [wantedCount, setWantedCount] = useState("30");
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  // Während des Speicherns darf der Dialog nicht per Escape oder Klick daneben schließen.
  const { containerRef, handleBackdropClick } = useDialogA11y({ onClose, disabled: busy });

  // Auswahlliste laden — und einen noch offenen Auftrag dieses Kurses wieder aufgreifen.
  // Die Generierung läuft serverseitig weiter, auch wenn der Dialog zwischendurch zu war.
  useEffect(() => {
    let active = true;
    const client = createClient();
    Promise.all([listSelectableDocuments(client, courseId), listUnfinishedJobs(client, courseId)])
      .then(([list, jobs]) => {
        if (!active) return;
        setDocuments(list);
        const resumable = jobs.find((job) => job.status !== "cancelled" && job.status !== "completed");
        if (resumable) applyJob(resumable, setStep);
      })
      .catch((error: unknown) => {
        if (active) setStep({ name: "error", message: flashcardErrorMessage(error), jobId: null });
      });
    return () => { active = false; };
  }, [courseId]);

  const pollJobId = step.name === "working" ? step.job.id : null;

  useEffect(() => {
    if (!pollJobId) return;
    let active = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const job = await fetchFlashcardJob(createClient(), pollJobId);
          if (active) applyJob(job, setStep);
        } catch (error) {
          if (!active) return;
          if (error instanceof FlashcardGenerationError && error.code === "NETWORK_ERROR") return;
          setStep({ name: "error", message: flashcardErrorMessage(error), jobId: null });
        }
      })();
    }, FLASHCARD_POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [pollJobId]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ready = (documents ?? []).filter((document) => document.ready);
  const parsedCount = Number.parseInt(wantedCount, 10);
  const countValid =
    automatic || (Number.isInteger(parsedCount) && parsedCount >= MIN_REQUESTED_CARDS && parsedCount <= MAX_REQUESTED_CARDS);
  const canStart = selected.size > 0 && selected.size <= MAX_SELECTED_DOCUMENTS && countValid && !busy;

  function handleStart() {
    requestId.current = crypto.randomUUID();
    setBusy(true);
    void startFlashcardAnalysis(
      createClient(),
      requestId.current,
      courseId,
      [...selected],
      automatic ? null : parsedCount
    )
      .then((job) => applyJob(job, setStep))
      .catch((error: unknown) => setStep({ name: "error", message: flashcardErrorMessage(error), jobId: null }))
      .finally(() => setBusy(false));
  }

  function handleContinue(jobId: string) {
    setBusy(true);
    void continueFlashcardJob(createClient(), jobId)
      .then((job) => applyJob(job, setStep))
      .catch((error: unknown) => setStep({ name: "error", message: flashcardErrorMessage(error), jobId: null }))
      .finally(() => setBusy(false));
  }

  function handleRetry(jobId: string) {
    setBusy(true);
    void retryFlashcardJob(createClient(), jobId)
      .then((job) => applyJob(job, setStep))
      .catch((error: unknown) => setStep({ name: "error", message: flashcardErrorMessage(error), jobId: null }))
      .finally(() => setBusy(false));
  }

  function handleCancel(jobId: string) {
    setBusy(true);
    void cancelFlashcardJob(createClient(), jobId)
      .then(() => onClose())
      .catch((error: unknown) => setStep({ name: "error", message: flashcardErrorMessage(error), jobId: null }))
      .finally(() => setBusy(false));
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div ref={containerRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="generate-deck-heading">
        <h2 id="generate-deck-heading">Karteikarten erzeugen</h2>

        {step.name === "error" && (
          <>
            <p className={styles.errorHint} role="alert">{step.message}</p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.viewerLink} onClick={onClose} disabled={busy}>Schließen</button>
              <button
                type="button"
                className={step.jobId ? styles.secondaryAction : styles.uploadButton}
                onClick={() => setStep({ name: "choose" })}
                disabled={busy}
              >
                Von vorn
              </button>
              {/* Fortsetzen statt neu starten: der Auftrag behält sein bezahltes Budget. */}
              {step.jobId && (
                <button type="button" className={styles.uploadButton} onClick={() => handleRetry(step.jobId!)} disabled={busy}>
                  {busy ? "Wird fortgesetzt …" : "Fortsetzen"}
                </button>
              )}
            </div>
          </>
        )}

        {step.name === "choose" && (
          <ChooseStep
            documents={documents}
            ready={ready}
            selected={selected}
            onToggle={toggle}
            automatic={automatic}
            onAutomatic={setAutomatic}
            wantedCount={wantedCount}
            onWantedCount={setWantedCount}
            countValid={countValid}
            canStart={canStart}
            busy={busy}
            onStart={handleStart}
            onClose={onClose}
          />
        )}

        {step.name === "working" && (
          <WorkingStep job={step.job} busy={busy} onCancel={() => handleCancel(step.job.id)} />
        )}

        {step.name === "estimated" && (
          <EstimatedStep
            job={step.job}
            busy={busy}
            onContinue={() => handleContinue(step.job.id)}
            onCancel={() => handleCancel(step.job.id)}
          />
        )}

        {step.name === "review" && (
          <ReviewStep job={step.job} onSaved={onSaved} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function applyJob(job: FlashcardJob, setStep: (step: Step) => void) {
  if (job.status === "failed") {
    const code = toFlashcardErrorCode(job.errorCode);
    setStep({ name: "error", message: flashcardErrorMessage(new FlashcardGenerationError(code)), jobId: job.id });
    return;
  }
  if (job.status === "estimated") { setStep({ name: "estimated", job }); return; }
  if (job.status === "review") { setStep({ name: "review", job }); return; }
  if (isFlashcardJobRunning(job)) { setStep({ name: "working", job }); return; }
  // completed/cancelled kommen hier nur nach einem Reload vor.
  setStep({ name: "error", message: "Dieser Auftrag ist bereits abgeschlossen. Starte eine neue Generierung.", jobId: null });
}

function ChooseStep({
  documents, ready, selected, onToggle, automatic, onAutomatic, wantedCount, onWantedCount,
  countValid, canStart, busy, onStart, onClose,
}: {
  documents: SelectableDocument[] | null;
  ready: SelectableDocument[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  automatic: boolean;
  onAutomatic: (value: boolean) => void;
  wantedCount: string;
  onWantedCount: (value: string) => void;
  countValid: boolean;
  canStart: boolean;
  busy: boolean;
  onStart: () => void;
  onClose: () => void;
}) {
  if (documents === null) return <p className={styles.loading} aria-live="polite">Unterlagen werden geladen …</p>;

  if (ready.length === 0) {
    return (
      <>
        <p className={styles.dialogHint}>
          In diesem Kurs gibt es noch keine fertig verarbeitete Unterlage. Lade zuerst Material hoch
          und warte, bis die Textextraktion abgeschlossen ist.
        </p>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.viewerLink} onClick={onClose}>Schließen</button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className={styles.dialogHint}>Wähle die Unterlagen, aus denen die Karten entstehen sollen.</p>

      <ul className={styles.pickList}>
        {documents.map((document) => (
          <li key={document.id}>
            <label className={document.ready ? undefined : styles.pickDisabled}>
              <input
                type="checkbox"
                checked={selected.has(document.id)}
                onChange={() => onToggle(document.id)}
                disabled={!document.ready || busy}
              />
              <span>{document.title}</span>
              {!document.ready && <small>wird noch verarbeitet</small>}
            </label>
          </li>
        ))}
      </ul>

      <fieldset className={styles.pickFieldset}>
        <legend>Umfang</legend>
        <label className={styles.pickRadio}>
          <input type="radio" checked={automatic} onChange={() => onAutomatic(true)} disabled={busy} />
          <span>Automatisch — so viele Karten, wie der Stoff hergibt</span>
        </label>
        <label className={styles.pickRadio}>
          <input type="radio" checked={!automatic} onChange={() => onAutomatic(false)} disabled={busy} />
          <span>Höchstens</span>
          <input
            type="number"
            min={MIN_REQUESTED_CARDS}
            max={MAX_REQUESTED_CARDS}
            value={wantedCount}
            onChange={(event) => onWantedCount(event.target.value)}
            disabled={automatic || busy}
            aria-label="Gewünschte Kartenzahl"
          />
          <span>Karten</span>
        </label>
        {!countValid && (
          <p className={styles.errorHint}>
            Gib eine Zahl zwischen {MIN_REQUESTED_CARDS} und {MAX_REQUESTED_CARDS} ein.
          </p>
        )}
      </fieldset>

      <div className={styles.dialogActions}>
        <button type="button" className={styles.viewerLink} onClick={onClose} disabled={busy}>Abbrechen</button>
        <button type="button" className={styles.uploadButton} onClick={onStart} disabled={!canStart}>
          {busy ? "Wird gestartet …" : `Analysieren (${selected.size})`}
        </button>
      </div>
    </>
  );
}

function WorkingStep({ job, busy, onCancel }: { job: FlashcardJob; busy: boolean; onCancel: () => void }) {
  const progress = flashcardProgress(job);
  return (
    <>
      <p className={styles.dialogHint} aria-live="polite">
        {progress.label}
        {progress.indeterminate ? " …" : ` · ${progress.percent} %`}
      </p>
      <div className={styles.progressTrack} role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={100} {...(progress.percent === null ? {} : { "aria-valuenow": progress.percent })}>
        <span
          className={styles.progressBar}
          data-indeterminate={progress.indeterminate || undefined}
          style={progress.indeterminate ? undefined : { width: `${progress.percent}%` }}
        />
      </div>
      <p className={styles.dialogHint}>Das läuft im Hintergrund weiter, auch wenn du das Fenster schließt.</p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.viewerLink} onClick={onCancel} disabled={busy}>Abbrechen</button>
      </div>
    </>
  );
}

function EstimatedStep({
  job, busy, onContinue, onCancel,
}: { job: FlashcardJob; busy: boolean; onContinue: () => void; onCancel: () => void }) {
  return (
    <>
      <p className={styles.dialogHint}>
        Aus deinen Unterlagen ergeben sich <strong>{job.estimatedCount}</strong>{" "}
        {job.estimatedCount === 1 ? "sinnvolle Karte" : "sinnvolle Karten"}
        {job.requestedCount !== null && ` (gewünscht: höchstens ${job.requestedCount})`}. Danach kannst
        du jede Karte prüfen, bevor etwas gespeichert wird.
      </p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.viewerLink} onClick={onCancel} disabled={busy}>Verwerfen</button>
        <button type="button" className={styles.uploadButton} onClick={onContinue} disabled={busy || job.estimatedCount === 0}>
          {busy ? "Wird erstellt …" : "Karten erstellen"}
        </button>
      </div>
    </>
  );
}

function ReviewStep({ job, onSaved, onClose }: { job: FlashcardJob; onSaved: () => void; onClose: () => void }) {
  const [cards, setCards] = useState<EditableCard[]>(() => job.cards.map((card) => ({ ...card, keep: true })));
  const [title, setTitle] = useState("Generierte Karten");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bearbeitungen laufend als Entwurf sichern, damit ein geschlossener Tab sie nicht verwirft.
  const draft = useFlashcardDraft(
    job.id,
    job.sources,
    { jobId: job.id, title, cards: cards.map(({ id, question, answer, keep }) => ({ id, question, answer, keep })) },
    (stored) => {
      setTitle(stored.title);
      setCards((current) => applyFlashcardDraft(current, stored));
    }
  );

  const kept = cards.filter((card) => card.keep);
  const check = validateDeckSave(title, kept);

  function edit(id: string, patch: Partial<EditableCard>) {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));
    setError(null);
  }

  function handleSave() {
    if (!check.ok) { setError(check.message); return; }
    setSaving(true);
    void saveGeneratedDeck(createClient(), job.id, title, kept)
      .then(async () => {
        await draft.discard();
        onSaved();
      })
      .catch((caught: unknown) => {
        setError(flashcardErrorMessage(caught));
        setSaving(false);
      });
  }

  return (
    <>
      <p className={styles.dialogHint}>
        {cards.length} {cards.length === 1 ? "Karte wurde" : "Karten wurden"} erzeugt. Automatisch
        erstellt und nicht geprüft — korrigiere, was nicht stimmt, und wähle ab, was du nicht brauchst.
      </p>

      <label className={styles.dialogField}>
        <span>Name des Kartensatzes</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={MAX_DECK_TITLE_LENGTH}
          disabled={saving}
        />
      </label>

      <ul className={styles.reviewList}>
        {cards.map((card) => (
          <li key={card.id} data-dropped={!card.keep || undefined}>
            <label className={styles.reviewKeep}>
              <input
                type="checkbox"
                checked={card.keep}
                onChange={(event) => edit(card.id, { keep: event.target.checked })}
                disabled={saving}
              />
              <span>Übernehmen</span>
            </label>
            <label className={styles.dialogField}>
              <span>Frage</span>
              <textarea
                value={card.question}
                onChange={(event) => edit(card.id, { question: event.target.value })}
                rows={2}
                disabled={saving || !card.keep}
              />
            </label>
            <label className={styles.dialogField}>
              <span>Antwort</span>
              <textarea
                value={card.answer}
                onChange={(event) => edit(card.id, { answer: event.target.value })}
                rows={3}
                disabled={saving || !card.keep}
              />
            </label>
          </li>
        ))}
      </ul>

      {draft.status === "saved" && <p className={styles.draftNote} role="status">Deine Änderungen sind als Entwurf gesichert.</p>}
      {draft.status === "conflict" && (
        <div className={styles.draftConflict} role="alert">
          <p>Diese Karten wurden inzwischen in einem anderen Tab weiterbearbeitet. Welcher Stand soll gelten?</p>
          <button type="button" className={styles.viewerLink} onClick={() => void draft.loadOther()}>Stand aus dem anderen Tab laden</button>
          <button type="button" className={styles.viewerLink} onClick={() => void draft.keepMine()}>Meinen Stand behalten</button>
        </div>
      )}
      {error && <p className={styles.errorHint} role="alert">{error}</p>}

      <div className={styles.dialogActions}>
        <button type="button" className={styles.viewerLink} onClick={onClose} disabled={saving}>Abbrechen</button>
        <button type="button" className={styles.uploadButton} onClick={handleSave} disabled={saving || !check.ok}>
          {saving ? "Wird gespeichert …" : `${kept.length} Karten speichern`}
        </button>
      </div>
    </>
  );
}
