import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ProfilePage from "@/components/profile/ProfilePage";
import { loadOwnSubscription, type OwnSubscription } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profil · UniVerse",
  description: "Persönliche Profil- und Kontoinformationen",
};

export default async function Page(props: PageProps<"/profile">) {
  const { email: emailNotice } = await props.searchParams;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect("/login?next=%2Fprofile");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("name, created_at, updated_at")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  // Der Abo-Status ist ergänzend: Schlägt er fehl, bleibt das Profil nutzbar und die Karte zeigt einen Hinweis.
  let proSubscription: OwnSubscription | null = null;
  let proUnavailable = false;
  try {
    proSubscription = await loadOwnSubscription(supabase);
  } catch {
    proUnavailable = true;
  }

  return (
    <ProfilePage
      proSubscription={proSubscription}
      proUnavailable={proUnavailable}
      email={userData.user.email ?? null}
      emailChanged={emailNotice === "changed"}
      initialProfile={data ?? null}
      initialError={
        error
          ? "Dein Profil konnte gerade nicht geladen werden."
          : !data
            ? "Zu deinem Konto wurde kein Profil gefunden."
            : null
      }
    />
  );
}
