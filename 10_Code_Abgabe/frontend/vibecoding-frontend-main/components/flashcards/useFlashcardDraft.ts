"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import {
  deleteDraft,
  DraftConflictError,
  fitsDraftLimits,
  loadDraft,
  parseFlashcardDraft,
  saveDraft,
  singleSourceDocumentId,
  sourceMaterialOf,
  type FlashcardDraft,
} from "@/lib/supabase/queries/learning-drafts";

const SAVE_DELAY_MS = 1500;

export type DraftStatus =
  /** Kein Entwurf möglich (mehrere Quelldokumente) oder noch nicht bereit. */
  | "off"
  | "idle"
  | "saved"
  /** Ein anderer Tab hat weitergeschrieben; der Nutzer entscheidet, welcher Stand gilt. */
  | "conflict";

/**
 * Sichert die Bearbeitung generierter Karten laufend als Entwurf am Quelldokument, damit
 * sie ein geschlossener Tab nicht verwirft, und stellt sie beim nächsten Öffnen wieder her.
 *
 * Entwürfe sind eine Zusatzsicherung: schlägt Laden oder Speichern fehl, arbeitet der
 * Dialog ohne sie weiter. Nur ein Konflikt mit einem anderen Tab wird sichtbar gemacht.
 */
export function useFlashcardDraft(
  jobId: string,
  sources: { documentId: string | null }[],
  current: FlashcardDraft,
  onRestore: (draft: FlashcardDraft) => void
) {
  const [status, setStatus] = useState<DraftStatus>("off");
  const material = useRef<string | null>(null);
  const revision = useRef(0);
  // Zuletzt gespeicherter (oder unveränderter Ausgangs-)Stand: nur Abweichungen werden gesendet.
  const lastSaved = useRef(JSON.stringify(current));
  const restore = useRef(onRestore);
  useEffect(() => { restore.current = onRestore; });

  const documentId = singleSourceDocumentId(sources);

  /** Übernimmt den gespeicherten Stand, sofern er zu diesem Auftrag gehört. */
  const adopt = useCallback((stored: { payload: unknown; revision: number } | null) => {
    revision.current = stored?.revision ?? 0;
    const draft = stored ? parseFlashcardDraft(stored.payload, jobId) : null;
    if (!draft) return;
    lastSaved.current = JSON.stringify(draft);
    restore.current(draft);
  }, [jobId]);

  useEffect(() => {
    if (!documentId) return;
    let active = true;
    const client = createClient();
    sourceMaterialOf(client, documentId)
      .then(async (materialId) => {
        if (!active || !materialId) return;
        const stored = await loadDraft(client, materialId, "flashcards");
        if (!active) return;
        material.current = materialId;
        adopt(stored);
        setStatus("idle");
      })
      .catch(() => { /* Ohne Entwurf bleibt der Dialog nutzbar. */ });
    return () => { active = false; };
  }, [documentId, adopt]);

  const serialized = JSON.stringify(current);

  useEffect(() => {
    if (status === "off" || status === "conflict" || serialized === lastSaved.current) return;
    const materialId = material.current;
    const draft = JSON.parse(serialized) as FlashcardDraft;
    if (!materialId || !fitsDraftLimits(draft)) return;

    const timer = setTimeout(() => {
      saveDraft(createClient(), materialId, "flashcards", draft as unknown as Json, revision.current)
        .then((next) => {
          revision.current = next;
          lastSaved.current = serialized;
          setStatus("saved");
        })
        .catch((error: unknown) => {
          if (error instanceof DraftConflictError) setStatus("conflict");
        });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [serialized, status]);

  /** Konflikt auflösen: den Stand des anderen Tabs laden und hier weiterarbeiten. */
  const loadOther = useCallback(async () => {
    const materialId = material.current;
    if (!materialId) return;
    try {
      adopt(await loadDraft(createClient(), materialId, "flashcards"));
      setStatus("idle");
    } catch { /* Der Hinweis bleibt stehen; der Nutzer kann es erneut versuchen. */ }
  }, [adopt]);

  /** Konflikt auflösen: den eigenen Stand behalten; er überschreibt den des anderen Tabs. */
  const keepMine = useCallback(async () => {
    const materialId = material.current;
    if (!materialId) return;
    try {
      const stored = await loadDraft(createClient(), materialId, "flashcards");
      revision.current = stored?.revision ?? 0;
      lastSaved.current = "";
      setStatus("idle");
    } catch { /* Der Hinweis bleibt stehen. */ }
  }, []);

  /** Nach dem endgültigen Speichern der Karten: der Entwurf wird nicht mehr gebraucht. */
  const discard = useCallback(async () => {
    const materialId = material.current;
    if (!materialId || revision.current === 0) return;
    try {
      await deleteDraft(createClient(), materialId, "flashcards", revision.current);
    } catch { /* Ein liegen gebliebener Entwurf gehört zu einem erledigten Auftrag und stört nicht. */ }
  }, []);

  return { status, loadOther, keepMine, discard };
}
