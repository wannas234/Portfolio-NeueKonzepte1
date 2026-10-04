"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeading from "@/components/ui/PageHeading";
import {
  announceProfileUpdate,
  profileInitial,
  type ProfileRecord,
} from "@/lib/auth/profile";
import { validateDisplayName } from "@/lib/auth/validation";
import type { OwnSubscription } from "@/lib/billing";
import { createClient } from "@/lib/supabase/browser";
import AccountDataCard from "./AccountDataCard";
import EmailChangeForm from "./EmailChangeForm";
import ProfileProCard from "./ProfileProCard";
import s from "./profile.module.css";

type LoadState =
  | { status: "ready"; profile: ProfileRecord }
  | { status: "loading"; message: string }
  | { status: "error"; message: string };

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Nicht verfügbar"
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(date);
}

export default function ProfilePage({
  email: accountEmail,
  emailChanged = false,
  initialProfile,
  initialError,
  proSubscription,
  proUnavailable,
}: {
  /** `null`, wenn das Konto keine E-Mail-Adresse hat; dann gibt es nichts zu ändern. */
  email: string | null;
  /** Der zweite Bestätigungslink einer E-Mail-Änderung hat gerade hierher geführt. */
  emailChanged?: boolean;
  initialProfile: ProfileRecord | null;
  initialError: string | null;
  proSubscription: OwnSubscription | null;
  proUnavailable: boolean;
}) {
  const router = useRouter();
  const email = accountEmail ?? "Keine E-Mail-Adresse verfügbar";
  const [loadState, setLoadState] = useState<LoadState>(
    initialProfile
      ? { status: "ready", profile: initialProfile }
      : { status: "error", message: initialError ?? "Dein Profil ist nicht verfügbar." }
  );
  const [displayName, setDisplayName] = useState(initialProfile?.name ?? "");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  async function loadProfile() {
    setLoadState({ status: "loading", message: "Profil wird erneut geladen …" });
    setSaveState({ status: "idle" });

    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/login?next=%2Fprofile");
        router.refresh();
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("name, created_at, updated_at")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (error || !data) {
        setLoadState({
          status: "error",
          message: error
            ? "Dein Profil konnte gerade nicht geladen werden. Bitte versuche es erneut."
            : "Zu deinem Konto wurde kein Profil gefunden.",
        });
        return;
      }

      const profile: ProfileRecord = data;
      setLoadState({ status: "ready", profile });
      setDisplayName(profile.name);
    } catch {
      setLoadState({
        status: "error",
        message: "Die Verbindung ist fehlgeschlagen. Bitte prüfe dein Netzwerk und versuche es erneut.",
      });
    }
  }

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validated = validateDisplayName(displayName);
    if (!validated.valid) {
      setSaveState({ status: "error", message: validated.message });
      return;
    }

    setSaveState({ status: "saving" });

    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/login?next=%2Fprofile");
        router.refresh();
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({ name: validated.value })
        .eq("user_id", userData.user.id)
        .select("name, created_at, updated_at")
        .single();

      if (error || !data) {
        setSaveState({
          status: "error",
          message: "Der Anzeigename konnte nicht gespeichert werden. Bitte versuche es erneut.",
        });
        return;
      }

      const profile: ProfileRecord = data;
      setLoadState({ status: "ready", profile });
      setDisplayName(profile.name);
      announceProfileUpdate(profile.name);
      setSaveState({ status: "success", message: "Dein Anzeigename wurde gespeichert." });
      router.refresh();
    } catch {
      setSaveState({
        status: "error",
        message: "Die Verbindung ist fehlgeschlagen. Bitte versuche es erneut.",
      });
    }
  }

  if (loadState.status !== "ready") {
    return (
      <div className={s.page}>
        <p className={s.eyebrow}>07 / PERSÖNLICHER BEREICH</p>
        <h1>Dein Profil</h1>
        <p className={s.intro}>Hier findest du deine persönlichen Kontoangaben.</p>
        <section className={s.errorCard} aria-live="polite" aria-busy={loadState.status === "loading"}>
          <h2>Profil nicht verfügbar</h2>
          <p>{loadState.message}</p>
          <button type="button" onClick={loadProfile} disabled={loadState.status === "loading"}>
            {loadState.status === "loading" ? "Wird geladen …" : "Erneut versuchen"}
          </button>
        </section>
      </div>
    );
  }

  const { profile } = loadState;
  const characterCount = Array.from(displayName.trim()).length;

  return (
    <div className={s.page}>
      <PageHeading title="Profil" description="Verwalte deine persönlichen Einstellungen." />

      <div className={s.grid}>
        <aside className={s.profileCard} aria-label="Dein Profil">
          <span className={s.avatar} aria-hidden="true">{profileInitial(profile.name)}</span>
          <h2>{profile.name}</h2>
          <p>{email}</p>
          <a href="#display-name" className={s.editLink}>Profil bearbeiten</a>
          {/* Füllt den freien Raum der Profilspalte, statt als dritte Karte unten rechts zu hängen. */}
          <ProfileProCard subscription={proSubscription} unavailable={proUnavailable} />
          <div className={s.membership}><strong>Mitglied seit</strong><p>{formatDate(profile.created_at)}</p></div>
        </aside>
        <div className={s.detailsColumn}>
        <section className={s.card} aria-labelledby="profile-details-heading">
          <h2 id="profile-details-heading">Persönliche Informationen</h2>
          <p className={s.supportingText}>
            Dieser Name wird in deinem persönlichen Studienraum angezeigt.
          </p>
          <form onSubmit={saveDisplayName} noValidate>
            <label htmlFor="display-name">Anzeigename</label>
            <input
              id="display-name"
              name="display_name"
              autoComplete="name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (saveState.status !== "idle") setSaveState({ status: "idle" });
              }}
              aria-describedby="display-name-help display-name-status"
              aria-invalid={saveState.status === "error"}
              disabled={saveState.status === "saving"}
            />
            <div className={s.fieldHelp} id="display-name-help">
              <span>1–60 Zeichen</span>
              <span>{characterCount}/60</span>
            </div>
            <div
              id="display-name-status"
              className={saveState.status === "error" ? s.errorMessage : s.statusMessage}
              role={saveState.status === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {saveState.status === "success" && saveState.message}
              {saveState.status === "error" && saveState.message}
            </div>
            <button type="submit" disabled={saveState.status === "saving"}>
              {saveState.status === "saving" ? "Wird gespeichert …" : "Änderungen speichern"}
            </button>
          </form>
        </section>

        <aside className={s.card} aria-labelledby="account-details-heading">
          <h2 id="account-details-heading">Kontoinformationen</h2>
          {emailChanged && (
            <p className={s.statusMessage} role="status">Deine E-Mail-Adresse wurde geändert.</p>
          )}
          <dl className={s.accountDetails}>
            <div>
              <dt>E-Mail-Adresse</dt>
              <dd>{email}</dd>
            </div>
            <div>
              <dt>Profil angelegt</dt>
              <dd>{formatDate(profile.created_at)}</dd>
            </div>
          </dl>
          {accountEmail ? (
            <EmailChangeForm currentEmail={accountEmail} />
          ) : (
            <p className={s.securityNote}>Für dieses Konto ist keine E-Mail-Adresse hinterlegt.</p>
          )}
        </aside>

        <AccountDataCard />
        </div>
      </div>
    </div>
  );
}
