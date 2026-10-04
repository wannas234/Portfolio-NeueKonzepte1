import type { Metadata } from "next";
import Link from "next/link";
import PageHeading from "@/components/ui/PageHeading";
import s from "@/components/billing/billing.module.css";

export const metadata: Metadata = {
  title: "Checkout abgebrochen · UniVerse",
  description: "Der Checkout für UniVerse Pro wurde abgebrochen",
};

export default function Page() {
  return (
    <div className={s.page}>
      <PageHeading title="UniVerse Pro" description="Der Checkout wurde abgebrochen." />
      <section className={s.errorCard}>
        <h2>Checkout abgebrochen</h2>
        <p>Es wurde nichts abgebucht und dein Konto wurde nicht verändert. Du kannst UniVerse Pro jederzeit abonnieren.</p>
        <div className={s.actions}>
          <Link href="/billing" className={s.primary}>Zurück zur Abo-Seite</Link>
        </div>
      </section>
    </div>
  );
}
