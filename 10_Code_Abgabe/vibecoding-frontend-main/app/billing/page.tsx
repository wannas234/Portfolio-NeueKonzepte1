import type { Metadata } from "next";
import { redirect } from "next/navigation";
import BillingPage from "@/components/billing/BillingPage";
import { loadOwnSubscription, type OwnSubscription } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UniVerse Pro · UniVerse",
  description: "Abo und Zahlungsdaten verwalten",
};

export default async function Page() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect("/login?next=%2Fbilling");
  }

  let subscription: OwnSubscription | null = null;
  let loadError: string | null = null;
  try {
    subscription = await loadOwnSubscription(supabase);
  } catch {
    loadError = "Dein Abo-Status konnte gerade nicht geladen werden. Bitte versuche es erneut.";
  }

  return <BillingPage initialSubscription={subscription} initialError={loadError} />;
}
