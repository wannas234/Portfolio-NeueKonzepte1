import { canRate, chatErrorMessage, type ChatMessage } from "@/lib/chatProtocol";
import styles from "./messageFeedback.module.css";

/** Compact thumbs up/down for one assistant answer. Renders nothing for anything else. */
export default function MessageFeedback({ message, pending, failed, onRate }: {
  message: ChatMessage;
  pending: boolean;
  failed: boolean;
  onRate: (message: ChatMessage, helpful: boolean) => void;
}) {
  if (!canRate(message)) return null;
  const value = message.helpful ?? null;
  return (
    <div className={styles.feedback}>
      <div className={styles.actions} role="group" aria-label="Antwort bewerten">
        <button type="button" className={styles.button} aria-pressed={value === true} disabled={pending}
          aria-label="Antwort als hilfreich markieren" title="Hilfreich" onClick={() => onRate(message, true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11v9H4v-9h3Z" /><path d="M7 11l4-7c1.4 0 2.3 1.2 2 2.5L12.5 9H19a2 2 0 0 1 2 2.4l-1.3 6.5A2 2 0 0 1 17.8 19H7" /></svg>
        </button>
        <button type="button" className={styles.button} aria-pressed={value === false} disabled={pending}
          aria-label="Antwort als nicht hilfreich markieren" title="Nicht hilfreich" onClick={() => onRate(message, false)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 13V4h3v9h-3Z" /><path d="M17 13l-4 7c-1.4 0-2.3-1.2-2-2.5l.5-3H5a2 2 0 0 1-2-2.4l1.3-6.5A2 2 0 0 1 6.2 5H17" /></svg>
        </button>
      </div>
      {failed && <p className={styles.error} role="alert">{chatErrorMessage("FEEDBACK_FAILED")}</p>}
    </div>
  );
}
