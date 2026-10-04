"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { runTemporaryChat } from "@/lib/chat";
import { ChatError } from "@/lib/chatProtocol";
import { cleanProse } from "@/lib/aiOutput";
import GeneratedSummaryPanel from "@/components/summaries/GeneratedSummaryPanel";
import DocumentDateSuggestions from "./DocumentDateSuggestions";
import styles from "@/components/documents/documents.module.css";

function asChatError(error: unknown): ChatError {
  return error instanceof ChatError ? error : new ChatError("LOAD_FAILED");
}

// Für Erklärungen gibt es keinen eigenen Backend-Endpunkt. Die Aktion stellt dem echten
// Kurs-RAG-Chat (lib/chat.ts) eine einmalige Frage, eingegrenzt auf das geöffnete Dokument,
// und zeigt die Antwort. Zusammenfassungen laufen dagegen über die Function `summaries`.
async function askOnce(courseId: string, materialId: string, question: string): Promise<string> {
  const client = createClient();
  const exchange = await runTemporaryChat(client, courseId, materialId, question);
  const answer = exchange.messages.find((message) => message.role === "assistant");
  if (!answer) throw new ChatError("INVALID_ANSWER_RESPONSE");
  // Free prose stays free; only citation markers are removed and an empty answer is an error.
  const text = cleanProse(answer.content);
  if (!text) throw new ChatError("UNUSABLE_AI_OUTPUT");
  return text;
}

export default function DocumentAiActions({
  courseId,
  documentId,
  materialId,
}: {
  courseId: string;
  /** `source_documents.id` — Ziel der Dokumentzusammenfassung. */
  documentId: string;
  materialId: string;
}) {
  const [topic, setTopic] = useState("");
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainResult, setExplainResult] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);

  async function handleExplain(event: FormEvent) {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || explainLoading) return;
    setExplainLoading(true);
    setExplainError(null);
    try {
      const answer = await askOnce(courseId, materialId, `Erkläre das Konzept "${trimmed}" verständlich anhand der Kursunterlagen. Nutze wenn möglich ein Beispiel.`);
      setExplainResult(answer);
    } catch (error) {
      setExplainError(asChatError(error).message);
    } finally {
      setExplainLoading(false);
    }
  }

  return (
    <div className={styles.aiActions}>
      <div className={styles.aiHeader}>
        <span className={styles.aiHeaderIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></svg>
        </span>
        <div>
          <h2>KI-Aktionen</h2>
          <p>Aus dem Text dieser Unterlage.</p>
        </div>
      </div>

      {/* Echte Dokumentzusammenfassung über die Function `summaries` statt frei geparstem
          Chattext: liefert Abschnitte mit Quellenangaben und meldet veraltete Ergebnisse. */}
      <GeneratedSummaryPanel
        courseId={courseId}
        sourceDocumentId={documentId}
        heading="Zusammenfassung dieser Unterlage"
        intro="UniVerse liest den extrahierten Text dieser Unterlage und erstellt daraus eine Zusammenfassung mit Quellenangaben. Das läuft im Hintergrund weiter, auch wenn du die Seite verlässt."
      />

      <div className={styles.actionCard}>
        <div className={styles.actionCardHead}>
          <span className={styles.actionIconBadge} data-tone="amber" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.6v.5h5.2v-.5c0-.6.3-1.2.9-1.6A6 6 0 0 0 12 3Z" /></svg>
          </span>
          <div>
            <h3>Konzept erklären</h3>
            <p>Gib ein Thema oder einen Begriff aus den Unterlagen ein, um eine ausführliche Erklärung zu erhalten.</p>
          </div>
        </div>
        <form className={styles.actionInputRow} onSubmit={handleExplain}>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="z. B. „Man-in-the-Middle-Angriff“" disabled={explainLoading} />
          <button type="submit" className={styles.runButton} disabled={explainLoading || !topic.trim()}>
            {explainLoading ? "Wird erklärt …" : "Erklären"}
          </button>
        </form>
        {explainError && <p className={styles.errorHint} role="alert">{explainError}</p>}
        {explainResult && <div className={styles.actionResult}><p>{explainResult}</p></div>}
      </div>

      {/* Eigener Backend-Endpunkt (`material-analysis`), nicht der Chat: er liefert
          geprüfte Termindaten mit Originalzitat statt freiem Text. */}
      <DocumentDateSuggestions materialId={materialId} />
    </div>
  );
}
