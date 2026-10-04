"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { endOfDayIso, formToIso, startOfDayIso } from "@/components/calendar/dateUtils";
import { KIND_LABELS } from "@/components/calendar/EventDialog";
import {
  acceptSuggestion,
  analyzeMaterial,
  AnalysisError,
  analysisErrorMessage,
  dismissSuggestion,
  fetchAnalysis,
  suggestionFormValues,
  timezoneMismatch,
  toAnalysisErrorCode,
  type CalendarSuggestion,
  type ConfirmableEventKind,
  type MaterialAnalysis,
  type SuggestionFormValues,
} from "@/lib/materialAnalysis";
import styles from "@/components/documents/documents.module.css";

const POLL_INTERVAL_MS = 3000;

type View =
  | { kind: "idle" }
  | { kind: "running"; analysisId: string | null }
  | { kind: "ready"; analysis: MaterialAnalysis }
  | { kind: "error"; message: string };

/**
 * Terminvorschläge aus einer Unterlage.
 *
 * Das Backend erkennt Termine, legt aber keine an: jeder Vorschlag wird hier angezeigt,
 * kann korrigiert werden und wird erst auf ausdrückliche Bestätigung zum Kalendereintrag.
 * Auch ein Vorschlag ohne Prüfhinweise wird nie automatisch übernommen.
 */
export default function DocumentDateSuggestions({ materialId }: { materialId: string }) {
  const [view, setView] = useState<View>({ kind: "idle" });
  // Optional, nur vom Nutzer gesetzt (z. B. Semesterbeginn): daraus ergänzt die Analyse fehlende
  // Jahre. Bewusst nie automatisch mit Upload- oder heutigem Datum vorbelegt.
  const [referenceDate, setReferenceDate] = useState("");
  const requestId = useRef<string | null>(null);

  const pollId = view.kind === "running" && view.analysisId ? view.analysisId : null;

  useEffect(() => {
    if (!pollId) return;
    let active = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const analysis = await fetchAnalysis(createClient(), pollId);
          if (!active) return;
          if (analysis.status === "processing") return;
          applyAnalysis(analysis, setView);
        } catch (error) {
          if (!active) return;
          // Ein Netzaussetzer bricht die laufende Analyse nicht ab.
          if (error instanceof AnalysisError && error.code === "NETWORK_ERROR") return;
          setView({ kind: "error", message: analysisErrorMessage(error) });
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [pollId]);

  function handleAnalyze() {
    requestId.current = crypto.randomUUID();
    setView({ kind: "running", analysisId: null });
    void analyzeMaterial(createClient(), requestId.current, materialId, {
      referenceDate: referenceDate || null,
    })
      .then((analysis) => {
        if (analysis.status === "processing") {
          setView({ kind: "running", analysisId: analysis.analysisId });
          return;
        }
        applyAnalysis(analysis, setView);
      })
      .catch((error: unknown) => setView({ kind: "error", message: analysisErrorMessage(error) }));
  }

  function replaceAnalysis(next: MaterialAnalysis) {
    setView({ kind: "ready", analysis: next });
  }

  return (
    <div className={styles.actionCard}>
      <div className={styles.actionCardHead}>
        <span className={styles.actionIconBadge} data-tone="green" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
        </span>
        <div>
          <h3>Termine finden</h3>
          <p>Sucht Prüfungen, Abgaben und andere Termine im Text. Übernommen wird nur, was du bestätigst.</p>
        </div>
        {view.kind !== "running" && (
          <button type="button" className={styles.runButton} onClick={handleAnalyze}>
            {view.kind === "idle" ? "Termine suchen" : "Erneut suchen"}
          </button>
        )}
      </div>

      {view.kind !== "running" && (
        <label className={styles.referenceField}>
          <span>Bezugsdatum (optional, z. B. Semesterbeginn)</span>
          <input type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} />
          <small>Stehen Termine ohne Jahr in der Unterlage, wird das Jahr ab diesem Datum ergänzt.</small>
        </label>
      )}

      {view.kind === "running" && (
        <p className={styles.errorHint} data-tone="info" aria-live="polite">Die Unterlage wird analysiert …</p>
      )}

      {view.kind === "error" && <p className={styles.errorHint} role="alert">{view.message}</p>}

      {view.kind === "ready" && (
        <AnalysisBody analysis={view.analysis} onChange={replaceAnalysis} />
      )}
    </div>
  );
}

function applyAnalysis(analysis: MaterialAnalysis, setView: (view: View) => void) {
  if (analysis.status === "failed") {
    const code = toAnalysisErrorCode(analysis.errorCode);
    setView({ kind: "error", message: analysisErrorMessage(new AnalysisError(code)) });
    return;
  }
  setView({ kind: "ready", analysis });
}

function AnalysisBody({
  analysis,
  onChange,
}: {
  analysis: MaterialAnalysis;
  onChange: (next: MaterialAnalysis) => void;
}) {
  const decisionByItem = new Map(analysis.decisions.map((decision) => [decision.itemId, decision]));
  const open = analysis.items.filter((item) => !decisionByItem.has(item.id));

  function recordDecision(itemId: string, status: "accepted" | "dismissed", calendarEventId: string | null) {
    onChange({
      ...analysis,
      decisions: [...analysis.decisions.filter((d) => d.itemId !== itemId), { itemId, status, calendarEventId }],
    });
  }

  if (analysis.items.length === 0) {
    return (
      <div className={styles.actionResult}>
        <p>In dieser Unterlage wurden keine Termine gefunden.</p>
      </div>
    );
  }

  return (
    <div className={styles.actionResult}>
      {analysis.warnings.map((warning, index) => (
        <p key={`${warning.code}-${index}`} className={styles.errorHint} data-tone="info">{warning.message}</p>
      ))}

      {open.length === 0 ? (
        <p>Alle gefundenen Termine sind bearbeitet.</p>
      ) : (
        <ul className={styles.suggestionList}>
          {open.map((item) => (
            <SuggestionRow
              key={item.id}
              analysisId={analysis.analysisId}
              suggestion={item}
              onDecided={recordDecision}
            />
          ))}
        </ul>
      )}

      {analysis.decisions.length > 0 && (
        <p className={styles.suggestionDone}>
          {analysis.decisions.filter((d) => d.status === "accepted").length} übernommen ·{" "}
          {analysis.decisions.filter((d) => d.status === "dismissed").length} verworfen ·{" "}
          <Link href="/calendar">Zum Kalender</Link>
        </p>
      )}
    </div>
  );
}

function SuggestionRow({
  analysisId,
  suggestion,
  onDecided,
}: {
  analysisId: string;
  suggestion: CalendarSuggestion;
  onDecided: (itemId: string, status: "accepted" | "dismissed", calendarEventId: string | null) => void;
}) {
  const [form, setForm] = useState<SuggestionFormValues>(() => suggestionFormValues(suggestion));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zoneHint = timezoneMismatch(suggestion);
  // Ohne Datum lässt sich kein Kalendereintrag bauen; der Nutzer muss es ergänzen.
  const canAccept = form.title.trim().length > 0 && form.date.length > 0 && (form.allDay || form.time.length > 0);

  function update<K extends keyof SuggestionFormValues>(key: K, value: SuggestionFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  // Gleiche Konvention wie der Termin-Dialog des Kalenders: ein eintägiger Ganztages-Termin
  // hat kein Ende, erst ein mehrtägiger bekommt das Tagesende des letzten Tages.
  function buildTimes(): { startsAt: string; endsAt: string | null } | null {
    if (form.allDay) {
      if (!form.endDate || form.endDate === form.date) {
        return { startsAt: startOfDayIso(form.date), endsAt: null };
      }
      if (form.endDate < form.date) return null;
      return { startsAt: startOfDayIso(form.date), endsAt: endOfDayIso(form.endDate) };
    }
    const startsAt = formToIso(form.date, form.time);
    if (!form.endDate && !form.endTime) return { startsAt, endsAt: null };
    const endKey = form.endDate || form.date;
    const endTime = form.endTime || form.time;
    const endsAt = formToIso(endKey, endTime);
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return null;
    return { startsAt, endsAt };
  }

  async function handleAccept() {
    const times = buildTimes();
    if (!times) {
      setError("Das Ende muss nach dem Start liegen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const decision = await acceptSuggestion(createClient(), analysisId, suggestion.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        allDay: form.allDay,
      });
      onDecided(suggestion.id, decision.status, decision.calendarEventId);
    } catch (caught) {
      setError(analysisErrorMessage(caught));
      setBusy(false);
    }
  }

  async function handleDismiss() {
    setBusy(true);
    setError(null);
    try {
      const decision = await dismissSuggestion(createClient(), analysisId, suggestion.id);
      onDecided(suggestion.id, decision.status, decision.calendarEventId);
    } catch (caught) {
      setError(analysisErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <li className={styles.suggestion}>
      <div className={styles.suggestionHead}>
        <strong>{suggestion.title}</strong>
        <span className={styles.suggestionTag}>{suggestion.kind === "deadline" ? "Abgabe" : "Termin"}</span>
      </div>

      {suggestion.description && <p className={styles.suggestionText}>{suggestion.description}</p>}

      <blockquote className={styles.suggestionQuote}>
        „{suggestion.quote}“
        {suggestion.page !== null && <cite>Seite {suggestion.page}</cite>}
      </blockquote>

      {suggestion.reviewRequired && suggestion.issues.length > 0 && (
        <ul className={styles.suggestionIssues}>
          {suggestion.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      {zoneHint && <p className={styles.suggestionIssues}>{zoneHint}</p>}

      {!confirming ? (
        <div className={styles.suggestionActions}>
          <button type="button" className={styles.runButton} onClick={() => setConfirming(true)}>
            Prüfen und übernehmen
          </button>
          <button type="button" className={styles.viewerLink} onClick={() => void handleDismiss()} disabled={busy}>
            Verwerfen
          </button>
        </div>
      ) : (
        <div className={styles.suggestionForm}>
          <label>
            <span>Titel</span>
            <input value={form.title} onChange={(event) => update("title", event.target.value)} disabled={busy} />
          </label>
          <label>
            <span>Art</span>
            <select
              value={form.kind}
              onChange={(event) => update("kind", event.target.value as ConfirmableEventKind)}
              disabled={busy}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className={styles.suggestionCheck}>
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(event) => update("allDay", event.target.checked)}
              disabled={busy}
            />
            <span>Ganztägig</span>
          </label>
          <label>
            <span>Datum</span>
            <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} disabled={busy} />
          </label>
          {!form.allDay && (
            <label>
              <span>Uhrzeit</span>
              <input type="time" value={form.time} onChange={(event) => update("time", event.target.value)} disabled={busy} />
            </label>
          )}
          <label className={styles.suggestionWide}>
            <span>Notiz</span>
            <textarea
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              rows={2}
              disabled={busy}
            />
          </label>

          {error && <p className={styles.errorHint} role="alert">{error}</p>}

          <div className={styles.suggestionActions}>
            <button type="button" className={styles.runButton} onClick={() => void handleAccept()} disabled={busy || !canAccept}>
              {busy ? "Wird übernommen …" : "In den Kalender"}
            </button>
            <button type="button" className={styles.viewerLink} onClick={() => setConfirming(false)} disabled={busy}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
