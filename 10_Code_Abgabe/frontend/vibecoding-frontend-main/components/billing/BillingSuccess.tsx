"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeading from "@/components/ui/PageHeading";
import { loadOwnSubscription, waitForProAccess, BillingError } from "@/lib/billing";
import { createClient } from "@/lib/supabase/browser";
import s from "./billing.module.css";

type State = "checking" | "pro" | "timeout" | "error";

// Diese Seite setzt Pro nie selbst. Sie zeigt nur, was der Stripe-Webhook in `subscriptions`
// bestätigt hat, und beobachtet den Status, bis er Pro freischaltet.
export default function BillingSuccess() {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const client = createClient();
    void (async () => {
      // Ohne Session wäre jede Abfrage leer; dann zuerst anmelden statt endlos zu warten.
      const { data: { session } } = await client.auth.getSession();
      if (cancelled) return;
      if (!session) {
        router.replace("/login?next=%2Fbilling%2Fsuccess");
        return;
      }
      const result = await waitForProAccess(
        async () => {
          try {
            return await loadOwnSubscription(client);
          } catch (error) {
            throw error instanceof BillingError ? error : new BillingError("LOAD_FAILED");
          }
        },
        { isCancelled: () => cancelled }
      );
      if (cancelled || result.state === "cancelled") return;
      setState(result.state);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, router]);

  const retry = useCallback(() => {
    setState("checking");
    setAttempt((value) => value + 1);
  }, []);

  return (
    <div className={s.page}>
      <PageHeading title="UniVerse Pro" description="Bestätigung deiner Zahlung." />

      <section className={s.errorCard} aria-live="polite" aria-busy={state === "checking"}>
        {state === "checking" && (
          <>
            <span className={s.badge} data-tone="pending">Wird geprüft</span>
            <h2>Deine Zahlung wird verarbeitet …</h2>
            <p>Danke! Wir warten auf die Bestätigung von Stripe. Das dauert normalerweise nur wenige Sekunden.</p>
          </>
        )}
        {state === "pro" && (
          <>
            <span className={s.badge} data-tone="pro">Pro</span>
            <h2>UniVerse Pro ist aktiv</h2>
            <p>Deine Zahlung wurde bestätigt. Vielen Dank für deine Unterstützung!</p>
            <div className={s.actions}>
              <Link href="/dashboard" className={s.primary}>Zur Übersicht</Link>
              <Link href="/billing" className={s.secondary}>Abo ansehen</Link>
            </div>
          </>
        )}
        {state === "timeout" && (
          <>
            <span className={s.badge} data-tone="pending">In Bearbeitung</span>
            <h2>Die Bestätigung dauert etwas länger</h2>
            <p>
              Deine Zahlung wird noch verarbeitet. Pro wird freigeschaltet, sobald Stripe sie bestätigt hat.
              Du musst nichts weiter tun und kannst den Status jederzeit auf der Abo-Seite prüfen.
            </p>
            <div className={s.actions}>
              <button type="button" className={s.primary} onClick={retry}>Status erneut prüfen</button>
              <Link href="/billing" className={s.secondary}>Zur Abo-Seite</Link>
            </div>
          </>
        )}
        {state === "error" && (
          <>
            <span className={s.badge} data-tone="attention">Fehler</span>
            <h2>Status nicht verfügbar</h2>
            <p>Dein Abo-Status konnte gerade nicht geladen werden. Falls du bezahlt hast, ist das Abo dadurch nicht verloren.</p>
            <div className={s.actions}>
              <button type="button" className={s.primary} onClick={retry}>Erneut versuchen</button>
              <Link href="/billing" className={s.secondary}>Zur Abo-Seite</Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
