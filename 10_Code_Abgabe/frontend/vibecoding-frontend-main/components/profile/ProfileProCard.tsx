import Link from "next/link";
import { describeProCard, PRO_PRICE_LABEL, type OwnSubscription } from "@/lib/billing";
import s from "./profile.module.css";

// Dezenter Hinweis auf UniVerse Pro. Status und Texte kommen aus den Billing-Helfern, hier gibt es
// keine eigene Stripe- oder Statuslogik. Alles Weitere (Abschluss, Verwaltung) passiert auf /billing.
// Die Leistungsliste steht bewusst nur dort: ein Teaser soll die Zielseite nicht verdoppeln.
export default function ProfileProCard({
  subscription,
  unavailable,
}: {
  subscription: OwnSubscription | null;
  unavailable: boolean;
}) {
  const view = describeProCard(subscription, unavailable);

  return (
    <section className={s.proCard} data-pro={view.pro || undefined} aria-labelledby="pro-card-heading">
      <div className={s.proTop}>
        <span className={s.proBadge}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.3 5.6.4-4.3 3.6 1.4 5.4L12 14.3l-4.6 2.9 1.4-5.4L4.5 8.2l5.6-.4L12 2.5Z" /></svg>
          UniVerse Pro
        </span>
        {!view.pro && <span className={s.proPrice}>{PRO_PRICE_LABEL}</span>}
      </div>

      <h2 id="pro-card-heading" className={s.proStatus}>{view.status}</h2>
      <p className={s.proText}>{view.text}</p>

      <Link href="/billing" className={s.proLink}>
        {view.linkLabel}
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
