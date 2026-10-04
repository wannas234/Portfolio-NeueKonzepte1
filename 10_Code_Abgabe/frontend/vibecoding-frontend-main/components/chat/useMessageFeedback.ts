"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createClient } from "@/lib/supabase/browser";
import { setMessageFeedback } from "@/lib/chat";
import { nextFeedback, withFeedback, type ChatMessage } from "@/lib/chatProtocol";

/**
 * Optimistic rating of persisted assistant answers: the new state shows immediately, is saved
 * through the backend, and is rolled back to the previous rating if saving fails.
 */
export function useMessageFeedback(setMessages: Dispatch<SetStateAction<ChatMessage[]>>) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failedId, setFailedId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const rate = useCallback(async (message: ChatMessage, clicked: boolean) => {
    if (inFlight.current.has(message.id)) return;
    const previous = message.helpful ?? null;
    const next = nextFeedback(previous, clicked);
    inFlight.current.add(message.id);
    setPending(new Set(inFlight.current));
    setFailedId(null);
    setMessages((current) => withFeedback(current, message.id, next));
    try {
      await setMessageFeedback(createClient(), message.id, next);
    } catch {
      setMessages((current) => withFeedback(current, message.id, previous));
      setFailedId(message.id);
    } finally {
      inFlight.current.delete(message.id);
      setPending(new Set(inFlight.current));
    }
  }, [setMessages]);

  return { rate, pending, failedId };
}
