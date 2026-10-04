"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { RetryStage } from "./documentIndexing";
import { retryDocument, retryFailureMessage } from "@/lib/supabase/queries/document-retry";

/**
 * "Erneut versuchen" for a failed document. It only starts the backend retry; the
 * caller's `onRestarted` reloads the real status, so nothing is shown as successful
 * before the backend confirms it. The button disappears once the status is no longer
 * a retryable failure.
 */
export default function DocumentRetryButton({
  documentId,
  stage,
  onRestarted,
  className,
  errorClassName,
}: {
  documentId: string;
  stage: RetryStage;
  onRestarted: () => Promise<void>;
  className?: string;
  errorClassName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function retry() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await retryDocument(createClient(), documentId, stage);
      await onRestarted();
    } catch (failure) {
      setError(retryFailureMessage(failure instanceof Error ? failure.message : ""));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void retry()} disabled={busy}>
        {busy ? "Wird neu gestartet …" : "Erneut versuchen"}
      </button>
      {error && <span className={errorClassName} role="alert">{error}</span>}
    </>
  );
}
