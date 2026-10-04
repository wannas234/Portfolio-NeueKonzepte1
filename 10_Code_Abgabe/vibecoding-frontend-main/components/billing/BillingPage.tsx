"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeading from "@/components/ui/PageHeading";
import {
  BillingError,
  billingErrorMessage,
  describeBilling,
  hasProAccess,
  loadOwnSubscription,
  PRO_PRICE_LABEL,
  requestStripeRedirect,
  type OwnSubscription,
  type StripeRedirectAction,
} from "@/lib/billing";
import { createClient } from "@/lib/supabase/browser";
import UsageOverview from "./UsageOverview";
import s from "./billing.module.css";

type LoadState =
  | { status: "ready"; subscription: OwnSubscription | null }
  | { status: "loading" }
  | { status: "error"; message: string };

type ActionState =
  | { status: "idle" }
  | { status: "redirecting"; action: StripeRedirectAction }
  | { status: "error"; message: string };

const LOGIN_PATH = "/login?next=%2Fbilling";

const BENEFITS = [
  "Unbegrenzte Nutzung des KI-Assistenten",
  "Unbegrenzt viele Karteikarten",
  "Unbegrenzt Vorlesungsfolien hochladen",
];

export default function BillingPage({
  initialSubscription,
  initialError,
}: {
  initialSubscription: OwnSubscription | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>(
    initialError ? { status: "error", message: initialError } : { status: "ready", subscription: initialSubscription }
  );
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  // Nie vorangekreuzt: die Zustimmung muss eine bewusste Handlung sein.
  const [waiver, setWaiver] = useState(false);

  // Beim Zurück-Navigieren von Stripe (Browser-Cache) soll die Seite nicht im Weiterleitungs-Zustand hängen.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setActionState({ status: "idle" });
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function reload(keepActionError = false) {
    setLoadState({ status: "loading" });
    if (!keepActionError) setActionState({ status: "idle" });
    try {
      const subscription = await loadOwnSubscription(createClient());
      setLoadState({ status: "ready", subscription });
    } catch {
      setLoadState({ status: "error", message: "Dein Abo-Status konnte gerade nicht geladen werden. Bitte versuche es erneut." });
    }
  }

  async function open(action: StripeRedirectAction) {
    setActionState({ status: "redirecting", action });
    try {
      const url = await requestStripeRedirect(createClient(), action, { waiverAccepted: waiver });
      window.location.assign(url);
    } catch (error) {
      if (error instanceof BillingError && error.code === "UNAUTHENTICATED") {
        router.replace(LOGIN_PATH);
        router.refresh();
        return;
      }
      setActionState({ status: "error", message: billingErrorMessage(error, action) });
      // Bei einem schon bestehenden Abo den echten Stand nachladen, damit die richtige Aktion erscheint.
      if (error instanceof BillingError && (error.code === "ALREADY_SUBSCRIBED" || error.code === "NO_SUBSCRIPTION")) {
        void reload(true);
      }
    }
  }

  if (loadState.status !== "ready") {
    return (
      <div className={s.page}>
        <PageHeading title="UniVerse Pro" description="Dein Abo und deine Zahlungsdaten." />
        <section className={s.errorCard} aria-live="polite" aria-busy={loadState.status === "loading"}>
          <h2>{loadState.status === "loading" ? "Abo-Status wird geladen …" : "Abo-Status nicht verfügbar"}</h2>
          {loadState.status === "error" && <p>{loadState.message}</p>}
          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={() => void reload()} disabled={loadState.status === "loading"}>
              {loadState.status === "loading" ? "Wird geladen …" : "Erneut versuchen"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const { subscription } = loadState;
  const view = describeBilling(subscription);
  const busy = actionState.status === "redirecting";
  const pro = hasProAccess(subscription);

  return (
    <div className={s.page}>
      <PageHeading title="UniVerse Pro" description="Dein Abo und deine Zahlungsdaten." />

      {/* Eine Tarifkarte statt zwei nebeneinander, die denselben Preis wiederholt haben:
          getönter Kopf (Tarif + Preis), Rumpf (Leistungen), Fuß (Aktion). Der Blick geht
          so von Preis über Nutzen zum Button. Die Logik darüber ist unverändert. */}
      <section className={s.plan} data-active={pro || undefined} aria-labelledby="billing-status-heading">
        <div className={s.planHead}>
          <div>
            <h2 id="billing-status-heading" className={s.planName}>{pro ? "UniVerse Pro" : "Kostenlos"}</h2>
            <span className={s.badge} data-tone={view.tone}>{view.title}</span>
          </div>
          {/* PRO_PRICE_LABEL bleibt die einzige Quelle für den Preis. */}
          {pro ? (
            <p className={s.period}>{view.detail}</p>
          ) : (
            <p className={s.price}>{PRO_PRICE_LABEL}</p>
          )}
        </div>

        <ul className={s.benefits}>
          {BENEFITS.map((benefit) => (
            <li key={benefit}>
              <span className={s.check} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
              </span>
              {benefit}
            </li>
          ))}
        </ul>

        <div className={s.planFoot}>
          {pro && <p className={s.detail}>{view.detail}</p>}

          {/* Widerrufsrecht (§ 356 Abs. 4/5 BGB): Pro steht sofort zur Verfügung, deshalb
              muss der Nutzer die sofortige Leistung ausdrücklich verlangen. Das Häkchen
              geht als `waiver_accepted` an die Function, die Zeitpunkt und Textversion
              bei Stripe festhält. Nie vorangekreuzt. */}
          {view.canSubscribe && (
            <label className={s.waiver}>
              <input type="checkbox" checked={waiver} onChange={(event) => setWaiver(event.target.checked)} disabled={busy} />
              <span>
                Ich verlange ausdrücklich, dass UniVerse Pro sofort bereitsteht, und weiß,
                dass mein Widerrufsrecht mit der vollständigen Bereitstellung erlischt.
              </span>
            </label>
          )}

          <div className={s.actions}>
            {view.canSubscribe && (
              <button type="button" className={s.primary} onClick={() => void open("checkout")} disabled={busy || !waiver}>
                {actionState.status === "redirecting" && actionState.action === "checkout" ? "Weiterleitung zu Stripe …" : "Pro freischalten"}
              </button>
            )}
            {view.canManage && (
              <button type="button" className={s.secondary} onClick={() => void open("portal")} disabled={busy}>
                {actionState.status === "redirecting" && actionState.action === "portal" ? "Weiterleitung zu Stripe …" : view.manageLabel}
              </button>
            )}
            <button type="button" className={s.secondary} onClick={() => void reload()} disabled={busy}>Status aktualisieren</button>
          </div>

          <p className={s.note}>
            {pro
              ? "Kündigen jederzeit bei Stripe. Dein Abo läuft bis zum Ende des bezahlten Zeitraums."
              : "Monatlich kündbar · Bezahlung über Stripe, Kartendaten erreichen UniVerse nie"}
          </p>

          <div
            className={actionState.status === "error" ? s.errorMessage : s.statusMessage}
            role={actionState.status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {actionState.status === "error" && actionState.message}
            {actionState.status === "redirecting" && "Du wirst zur sicheren Seite von Stripe weitergeleitet."}
          </div>
        </div>
      </section>

      <UsageOverview />
    </div>
  );
}
