"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { PROFILE_UPDATED_EVENT, profileInitial, type ProfileUpdatedDetail } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/browser";

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; name: string; email: string }
  | { status: "error"; message: string };

export function useAuthenticatedProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileState>({ status: "loading" });
  const [signingOut, setSigningOut] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/login");
        router.refresh();
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("name")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (error || !data) {
        setProfile({ status: "error", message: "Profil nicht verfügbar" });
        return;
      }
      setProfile({ status: "ready", name: data.name, email: userData.user.email ?? "Angemeldet" });
    } catch {
      setProfile({ status: "error", message: "Profil konnte nicht geladen werden" });
    }
  }, [router]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadProfile(), 0);
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login");
        router.refresh();
      }
    });

    function handleProfileUpdated(event: Event) {
      const { displayName } = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      setProfile((current) => (current.status === "ready" ? { ...current, name: displayName } : current));
    }

    window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);
    return () => {
      window.clearTimeout(initialLoad);
      data.subscription.unsubscribe();
      window.removeEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);
    };
  }, [loadProfile, router]);

  async function logout() {
    setSigningOut(true);
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) {
        setProfile({ status: "error", message: "Abmelden fehlgeschlagen" });
        setSigningOut(false);
        return;
      }
      window.location.replace("/login");
    } catch {
      setProfile({ status: "error", message: "Abmelden fehlgeschlagen" });
      setSigningOut(false);
    }
  }

  const name = profile.status === "ready" ? profile.name : profile.status === "error" ? profile.message : "Profil wird geladen …";
  const detail = profile.status === "ready" ? profile.email : profile.status === "error" ? "Bitte Seite neu laden" : "Einen Moment bitte";
  const initial = profile.status === "ready" ? profileInitial(profile.name) : "L";

  return { name, detail, initial, signingOut, logout };
}
