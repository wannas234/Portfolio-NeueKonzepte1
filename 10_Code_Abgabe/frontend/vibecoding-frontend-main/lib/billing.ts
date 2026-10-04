import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// UniVerse Pro (Stripe). Die Quelle der Wahrheit ist die Tabelle `subscriptions`, die allein der
// Stripe-Webhook des Backends pflegt. Das Frontend liest sie nur (RLS: eigene Zeile) und leitet
// Pro-Zugriff ausschließlich aus dem dort gespeicherten Status ab. Weder Rücksprung-Seiten noch
// Redirect-Parameter setzen jemals Pro. Preis, Customer und Nutzer bestimmt das Backend, das
// Frontend schickt an die Functions keine Daten.

export type BillingErrorCode =
  | "UNAUTHENTICATED"
  | "ALREADY_SUBSCRIBED"
  | "NO_SUBSCRIPTION"
  | "LOAD_FAILED"
  | "UNAVAILABLE"
  | "WAIVER_REQUIRED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  constructor(code: BillingErrorCode) {
    super(code);
    this.name = "BillingError";
    this.code = code;
  }
}

/** Der eigene Abo-Stand, so wie das UI ihn braucht. Stripe-IDs verlassen das Datenlesen nicht. */
export type OwnSubscription = {
  /** Stripe-Status unverändert (active, trialing, past_due, canceled, ...). */
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Es existiert bereits eine Stripe-Subscription (nicht nur der Platzhalter vor dem Checkout). */
  hasStripeSubscription: boolean;
};

/**
 * Angezeigter Preis von UniVerse Pro. Reine Anzeige: Abgerechnet wird der serverseitig festgelegte
 * Stripe-Preis (Secret STRIPE_PRICE_ID des Backends), und Stripe zeigt ihn vor der Zahlung erneut.
 * Ändert sich der Preis in Stripe, muss dieser Text von Hand nachgezogen werden.
 */
export const PRO_PRICE_LABEL = "6,99 € / Monat";

/** Pro-Zugriff gibt es ausschließlich in diesen DB-Status. */
export const PRO_ACCESS_STATUSES: readonly string[] = ["active", "trialing"];

export function hasProAccess(subscription: OwnSubscription | null): boolean {
  return subscription !== null && PRO_ACCESS_STATUSES.includes(subscription.status);
}

export function formatBillingDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Berlin" }).format(date);
}

export type BillingView = {
  tone: "none" | "pro" | "pending" | "attention" | "ended";
  title: string;
  detail: string;
  canSubscribe: boolean;
  canManage: boolean;
  manageLabel: string;
};

export function describeBilling(subscription: OwnSubscription | null): BillingView {
  const manage = { canSubscribe: false, canManage: true, manageLabel: "Abo verwalten" };
  const noAction = { canSubscribe: false, canManage: false, manageLabel: "Abo verwalten" };
  const none: BillingView = {
    tone: "none",
    title: "Kein Pro-Abo",
    detail: "Du nutzt UniVerse aktuell ohne Pro-Abo.",
    canSubscribe: true,
    canManage: false,
    manageLabel: "Abo verwalten",
  };

  // Kein Eintrag oder nur der Platzhalter eines abgebrochenen Checkouts: es gibt kein Abo.
  if (!subscription || (subscription.status === "incomplete" && !subscription.hasStripeSubscription)) return none;

  const until = formatBillingDate(subscription.currentPeriodEnd);
  switch (subscription.status) {
    case "active":
      return {
        tone: "pro",
        title: "UniVerse Pro ist aktiv",
        detail: subscription.cancelAtPeriodEnd
          ? until
            ? `Dein Abo ist gekündigt und läuft am ${until} aus. Bis dahin hast du vollen Zugriff.`
            : "Dein Abo ist gekündigt und läuft zum Ende des Abrechnungszeitraums aus."
          : until
            ? `Dein Abo verlängert sich am ${until}.`
            : "Dein Abo ist aktiv.",
        ...manage,
      };
    case "trialing":
      return {
        tone: "pro",
        title: "UniVerse Pro (Testphase)",
        detail: subscription.cancelAtPeriodEnd
          ? until
            ? `Dein Abo ist gekündigt und endet am ${until}.`
            : "Dein Abo ist gekündigt und endet mit der Testphase."
          : until
            ? `Deine Testphase endet am ${until}.`
            : "Du testest UniVerse Pro.",
        ...manage,
      };
    case "past_due":
      return {
        tone: "attention",
        title: "Zahlung fehlgeschlagen",
        detail: "Die letzte Zahlung ist fehlgeschlagen. Aktualisiere deine Zahlungsdaten, damit dein Abo weiterläuft. Pro ist bis dahin nicht freigeschaltet.",
        ...manage,
        manageLabel: "Zahlungsdaten aktualisieren",
      };
    case "unpaid":
      return {
        tone: "attention",
        title: "Offene Zahlung",
        detail: "Dein Abo hat eine offene Rechnung. Begleiche sie über die Zahlungsdaten, damit Pro wieder freigeschaltet wird.",
        ...manage,
        manageLabel: "Zahlungsdaten aktualisieren",
      };
    case "paused":
      return { tone: "attention", title: "Abo pausiert", detail: "Dein Abo ist pausiert. Pro ist während der Pause nicht freigeschaltet.", ...manage };
    case "incomplete":
      return {
        tone: "pending",
        title: "Zahlung wird verarbeitet",
        detail: "Sobald Stripe die Zahlung bestätigt, wird dein Abo hier aktiv. Das kann einen Moment dauern.",
        ...manage,
      };
    case "canceled":
      return { ...none, tone: "ended", title: "Dein Pro-Abo ist beendet", detail: "Du kannst UniVerse Pro jederzeit erneut abonnieren." };
    case "incomplete_expired":
      return { ...none, tone: "ended", title: "Checkout nicht abgeschlossen", detail: "Die Zahlung wurde nicht abgeschlossen. Du kannst es jederzeit erneut versuchen." };
    default:
      // Unbekannter Status (neuer Stripe-Status): nie Pro, Verwaltung nur bei vorhandener Subscription.
      return {
        tone: "attention",
        title: "Abo-Status nicht eindeutig",
        detail: "Wir können den Status deines Abos gerade nicht eindeutig anzeigen. Pro ist nicht freigeschaltet.",
        ...(subscription.hasStripeSubscription ? manage : noAction),
      };
  }
}

export type ProCardView = {
  pro: boolean;
  status: string;
  text: string;
  linkLabel: string;
};

/**
 * Kurzfassung für die „UniVerse Pro“-Karte im Profil. Sie baut auf `describeBilling` auf, damit
 * Status-Regeln nur an einer Stelle stehen. `unavailable`: der Status konnte nicht gelesen werden.
 */
export function describeProCard(subscription: OwnSubscription | null, unavailable = false): ProCardView {
  if (unavailable) {
    return { pro: false, status: "Status nicht verfügbar", text: "Dein Abo-Status konnte gerade nicht geladen werden.", linkLabel: "Zur Abo-Seite" };
  }
  const view = describeBilling(subscription);
  if (hasProAccess(subscription)) {
    return {
      pro: true,
      status: subscription?.status === "trialing" ? "Pro aktiv · Testphase" : "Pro aktiv",
      text: view.detail,
      linkLabel: "Abo verwalten",
    };
  }
  if (view.tone === "none" || view.tone === "ended") {
    return {
      pro: false,
      status: "Aktuell Kein Pro-Abo",
      text: `Du nutzt UniVerse aktuell ohne Pro. UniVerse Pro kostet ${PRO_PRICE_LABEL}.`,
      linkLabel: "UniVerse Pro ansehen",
    };
  }
  // Zahlungsprobleme, ausstehende Zahlung, Pause oder unklarer Status: kein Pro, Klärung auf /billing.
  return { pro: false, status: view.title, text: view.detail, linkLabel: view.canManage ? view.manageLabel : "Zur Abo-Seite" };
}

/**
 * Liest die eigene Abo-Zeile. RLS liefert ausschließlich die Zeile des angemeldeten Nutzers; ein
 * Filter im Frontend wäre keine Autorisierung.
 */
export async function loadOwnSubscription(client: SupabaseClient<Database>): Promise<OwnSubscription | null> {
  const { data, error } = await client
    .from("subscriptions")
    .select("status, current_period_end, cancel_at_period_end, stripe_subscription_id")
    .maybeSingle();
  if (error) throw new BillingError("LOAD_FAILED");
  if (!data) return null;
  return {
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    hasStripeSubscription: Boolean(data.stripe_subscription_id),
  };
}

export type StripeRedirectAction = "checkout" | "portal";

const FUNCTION_NAMES: Record<StripeRedirectAction, string> = {
  checkout: "create-checkout-session",
  portal: "create-portal-session",
};
const STRIPE_HOSTS: Record<StripeRedirectAction, string> = {
  checkout: "checkout.stripe.com",
  portal: "billing.stripe.com",
};

/** Die Antwort der Function wird nur befolgt, wenn sie auf die erwartete Stripe-Seite zeigt. */
export function parseStripeRedirect(action: StripeRedirectAction, value: unknown): string {
  let url: URL;
  try {
    url = new URL(typeof value === "string" ? value : "");
  } catch {
    throw new BillingError("INVALID_RESPONSE");
  }
  if (url.protocol !== "https:" || url.hostname !== STRIPE_HOSTS[action] || url.username || url.password) {
    throw new BillingError("INVALID_RESPONSE");
  }
  return url.href;
}

/**
 * Ruft create-checkout-session bzw. create-portal-session mit der Session des Nutzers auf und
 * liefert die Stripe-URL. Es werden bewusst keine Daten mitgeschickt: Preis, Nutzer und Customer
 * bestimmt allein das Backend.
 */
/**
 * `waiverAccepted`: ausdrückliches Verlangen nach sofortiger Leistung samt Verzicht auf
 * das Widerrufsrecht (§ 356 Abs. 4/5 BGB). Das Backend speichert Zeitpunkt und
 * Textversion in den Stripe-Metadaten und kann die Zustimmung zur Pflicht machen
 * (`WAIVER_REQUIRED`). Nur weitergeben, was der Nutzer wirklich angekreuzt hat.
 */
export async function requestStripeRedirect(
  client: SupabaseClient<Database>,
  action: StripeRedirectAction,
  options: { waiverAccepted?: boolean } = {}
): Promise<string> {
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) throw new BillingError("UNAUTHENTICATED");
  let result;
  try {
    result = await client.functions.invoke<{ url?: unknown }>(FUNCTION_NAMES[action], {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      ...(action === "checkout" ? { body: { waiver_accepted: options.waiverAccepted === true } } : {}),
    });
  } catch {
    throw new BillingError("NETWORK_ERROR");
  }
  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response;
    let code: unknown;
    try {
      code = (await response.json())?.error?.code;
    } catch {
      /* Unbekannter Fehlertext: unten allgemein behandelt. */
    }
    if (response.status === 401 || code === "UNAUTHENTICATED") throw new BillingError("UNAUTHENTICATED");
    if (code === "ALREADY_SUBSCRIBED") throw new BillingError("ALREADY_SUBSCRIBED");
    if (code === "NO_SUBSCRIPTION") throw new BillingError("NO_SUBSCRIPTION");
    if (code === "WAIVER_REQUIRED") throw new BillingError("WAIVER_REQUIRED");
    throw new BillingError("UNAVAILABLE");
  }
  if (result.error) throw new BillingError("NETWORK_ERROR");
  return parseStripeRedirect(action, result.data?.url);
}

export const BILLING_POLL_INTERVAL_MS = 2000;
export const BILLING_POLL_MAX_ATTEMPTS = 30;

export type ProWaitResult =
  | { state: "pro"; subscription: OwnSubscription }
  | { state: "timeout"; subscription: OwnSubscription | null }
  | { state: "error" }
  | { state: "cancelled" };

/**
 * Wartet auf den Webhook: liest den Status wiederholt aus der Datenbank, bis er Pro freischaltet.
 * Die Rücksprung-Seite setzt Pro nie selbst, sie beobachtet nur den tatsächlichen Stand.
 */
export async function waitForProAccess(
  load: () => Promise<OwnSubscription | null>,
  options: {
    intervalMs?: number;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    isCancelled?: () => boolean;
  } = {},
): Promise<ProWaitResult> {
  const intervalMs = options.intervalMs ?? BILLING_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? BILLING_POLL_MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let latest: OwnSubscription | null = null;
  let succeeded = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.isCancelled?.()) return { state: "cancelled" };
    try {
      latest = await load();
      succeeded = true;
      if (options.isCancelled?.()) return { state: "cancelled" };
      if (latest && hasProAccess(latest)) return { state: "pro", subscription: latest };
    } catch {
      /* Vorübergehender Lesefehler: nächster Versuch. */
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  return succeeded ? { state: "timeout", subscription: latest } : { state: "error" };
}

/** Nutzertexte zu Fehlern der Billing-Aktionen. Keine Backend-Meldungen werden durchgereicht. */
export function billingErrorMessage(error: unknown, action: StripeRedirectAction): string {
  const code = error instanceof BillingError ? error.code : "NETWORK_ERROR";
  switch (code) {
    case "ALREADY_SUBSCRIBED":
      return "Du hast bereits ein Abo. Wir aktualisieren deinen Status.";
    case "NO_SUBSCRIPTION":
      return "Zu deinem Konto wurde kein Abo gefunden.";
    case "WAIVER_REQUIRED":
      return "Bitte bestätige den Hinweis zum Widerrufsrecht, um fortzufahren.";
    case "NETWORK_ERROR":
      return "Die Verbindung ist fehlgeschlagen. Bitte prüfe dein Netzwerk und versuche es erneut.";
    default:
      return action === "checkout"
        ? "Die Bezahlseite konnte gerade nicht geöffnet werden. Bitte versuche es später erneut."
        : "Die Abo-Verwaltung konnte gerade nicht geöffnet werden. Bitte versuche es später erneut.";
  }
}
