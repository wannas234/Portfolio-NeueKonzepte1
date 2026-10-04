"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createConversation, loadConversations, loadHistory, sendChat } from "@/lib/chat";
import { ChatError, mergeExchange, sendBlockedReason, withMaterialScope, type ChatMessage, type ChatRequest } from "@/lib/chatProtocol";
import { useAuthenticatedProfile } from "@/lib/auth/useAuthenticatedProfile";
import MessageFeedback from "@/components/chat/MessageFeedback";
import { useMessageFeedback } from "@/components/chat/useMessageFeedback";
import styles from "@/components/documents/documents.module.css";

function asChatError(error: unknown): ChatError {
  return error instanceof ChatError ? error : new ChatError("LOAD_FAILED");
}

// Renders `inline code` spans from the model's answer as styled <code>.
function renderContent(content: string) {
  const parts = content.split(/(`[^`]+`)/g);
  return parts.map((part, index) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 1
      ? <code key={index}>{part.slice(1, -1)}</code>
      : <Fragment key={index}>{part}</Fragment>
  );
}

// A lightweight, embedded chat for the document-detail page. Every question is
// scoped to the open document via `material_ids` (see withMaterialScope), so
// retrieval and citations only come from that material. The conversation itself
// still belongs to the course and is shared with the course-wide assistant.
export default function DocumentCourseChat({ courseId, courseTitle, materialId }: { courseId: string; courseTitle: string; materialId: string }) {
  const { initial } = useAuthenticatedProfile();
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const feedback = useMessageFeedback(setMessages);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const sendingRef = useRef(false);
  const alive = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const busy = loading || sending;
  const blockedReason = sendBlockedReason({ courseId, busy, pending: false, loadFailed, waitSeconds: 0, question });

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, sending]);

  useEffect(() => {
    let active = true;
    const client = createClient();
    loadConversations(client, courseId)
      .then((list) => {
        if (!active) return;
        const latest = list[0];
        if (!latest) { setLoading(false); return; }
        setConversationId(latest.id);
        return loadHistory(client, latest.id).then((history) => { if (active) setMessages(history); });
      })
      .catch((failure) => { if (active) { setError(asChatError(failure)); setLoadFailed(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (sendingRef.current || busy || loadFailed || blockedReason) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const askedQuestion = question.trim();
    try {
      const client = createClient();
      let id = conversationId;
      if (!id) {
        const conversation = await createConversation(client, courseId);
        if (!alive.current) return;
        id = conversation.id;
        setConversationId(id);
      }
      const request: ChatRequest = withMaterialScope({ conversation_id: id, request_id: crypto.randomUUID(), question: askedQuestion }, materialId);
      const exchange = await sendChat(client, request);
      if (!alive.current) return;
      setMessages((history) => mergeExchange(history, exchange));
      setQuestion("");
    } catch (failure) {
      if (!alive.current) return;
      const chatError = asChatError(failure);
      setError(chatError);
      if (chatError.code === "CONVERSATION_NOT_FOUND") setConversationId("");
    } finally {
      sendingRef.current = false;
      if (alive.current) { setSending(false); inputRef.current?.focus(); }
    }
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatScroll}>
        {!messages.length && !sending && (
          <div className={styles.panelEmpty}>
            <span className={styles.panelIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z" /></svg>
            </span>
            <h3>{loading ? "Chat wird geladen …" : "Starte eine Unterhaltung"}</h3>
            {!loading && <p>Frag mich etwas zu den Unterlagen von {courseTitle}.</p>}
          </div>
        )}

        <ul className={styles.chatMessages} aria-label="Fragen und Antworten">
          {messages.map((message) => (
            <li key={message.id} className={styles.chatRow} data-role={message.role}>
              {message.role === "assistant" && (
                <span className={styles.chatAvatar} data-role="assistant" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></svg>
                </span>
              )}
              <div className={styles.chatBubble}>
                <p>{renderContent(message.content)}</p>
                {message.chat_message_sources?.length > 0 && (
                  <div className={styles.chatSources}>
                    {[...message.chat_message_sources].sort((a, b) => a.citation_no - b.citation_no).map((source) => (
                      <details key={source.citation_no}>
                        <summary>[{source.citation_no}] {source.material_title}{source.page_number !== null ? ` · S. ${source.page_number}` : ""}</summary>
                        <blockquote>{source.excerpt}</blockquote>
                      </details>
                    ))}
                  </div>
                )}
                <MessageFeedback message={message} pending={feedback.pending.has(message.id)} failed={feedback.failedId === message.id} onRate={feedback.rate} />
              </div>
              {message.role === "user" && (
                <span className={styles.chatAvatar} data-role="user" aria-hidden="true">{initial}</span>
              )}
            </li>
          ))}
        </ul>
        <div ref={endRef} />
        {sending && <p className={styles.chatStatus} role="status">Antwort wird erstellt …</p>}
        {error && <p className={styles.errorHint} role="alert">{error.message}</p>}
      </div>

      <form className={styles.chatComposer} onSubmit={submit}>
        <textarea
          ref={inputRef}
          className={styles.chatInput}
          value={question}
          maxLength={1800}
          rows={1}
          readOnly={sending}
          placeholder="Frage etwas zu diesem Dokument …"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" className={styles.chatSend} aria-label={sending ? "Antwortet …" : "Frage senden"} disabled={Boolean(blockedReason)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 20 18-8L3 4v6l12 2-12 2v6Z" /></svg>
        </button>
      </form>
    </div>
  );
}
