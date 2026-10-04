"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  authErrorMessage,
  safeAuthRedirect,
  validateDisplayName,
  validateLoginPassword,
  validateRegistrationPassword,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/browser";
import { loadLoginProfile, loginProfileMessages, registrationProfileMetadata } from "@/lib/auth/profile";
import styles from "./auth.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

const initialMessages: Record<string, string> = {
  confirmation: "Der Bestätigungslink ist ungültig oder abgelaufen. Bitte fordere bei der Registrierung eine neue E-Mail an.",
  configuration: "Die Supabase-Verbindung ist noch nicht konfiguriert. Bitte prüfe die öffentliche Frontend-Konfiguration.",
};

const initialNotices: Record<string, string> = {
  passwordUpdated: "Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.",
};

export default function AuthForm({ mode, next, initialError, initialNotice }: {
  mode: "login" | "register";
  next?: string;
  initialError?: string;
  initialNotice?: string;
}) {
  const registering = mode === "register";
  const destination = safeAuthRedirect(next);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<Notice>(
    initialError && initialMessages[initialError]
      ? { tone: "error", message: initialMessages[initialError] }
      : initialNotice && initialNotices[initialNotice]
        ? { tone: "success", message: initialNotices[initialNotice] }
      : null
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function verifyProfile(userId: string) {
    setProfileUserId(userId);
    const result = await loadLoginProfile(() => createClient()
      .from("profiles")
      .select("id, name")
      .eq("user_id", userId)
      .maybeSingle());
    if (result !== "ready") {
      setNotice({ tone: "error", message: loginProfileMessages[result] });
      return false;
    }
    return true;
  }

  async function retryProfile() {
    if (!profileUserId) return;
    setPending(true);
    setNotice(null);
    try {
      if (await verifyProfile(profileUserId)) window.location.replace(destination);
    } finally {
      setPending(false);
    }
  }

  async function restartLogin() {
    setPending(true);
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/login");
    } catch {
      setNotice({ tone: "error", message: "Abmelden fehlgeschlagen. Bitte versuche es erneut." });
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    try {
      const supabase = createClient();
      if (registering) {
        const displayName = validateDisplayName(String(form.get("display_name") ?? ""));
        if (!displayName.valid) {
          setNotice({ tone: "error", message: displayName.message });
          return;
        }
        const passwordError = validateRegistrationPassword(password);
        if (passwordError) {
          setNotice({ tone: "error", message: passwordError });
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: registrationProfileMetadata(displayName.value),
            emailRedirectTo: `${window.location.origin}/auth/confirm`,
          },
        });
        if (error) {
          setNotice({ tone: "error", message: authErrorMessage(error, "register") });
          return;
        }
        if (!data.session) {
          setConfirmationEmail(email);
          setCooldown(60);
          setNotice({ tone: "success", message: "Wenn die Adresse registriert werden kann, erhältst du eine Bestätigungs-E-Mail. Prüfe auch deinen Spam-Ordner." });
          return;
        }
        if (!data.user || !(await verifyProfile(data.user.id))) return;
      } else {
        const passwordError = validateLoginPassword(password);
        if (passwordError) {
          setNotice({ tone: "error", message: passwordError });
          return;
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setNotice({ tone: "error", message: authErrorMessage(error, "login") });
          return;
        }
        if (!(await verifyProfile(data.user.id))) return;
      }
      window.location.replace(destination);
    } catch {
      setNotice({ tone: "error", message: "Die Verbindung konnte nicht hergestellt werden. Bitte prüfe deine Netzwerk- und Supabase-Konfiguration." });
    } finally {
      setPending(false);
    }
  }

  async function resendConfirmation() {
    if (!confirmationEmail || cooldown > 0) return;
    setPending(true);
    setNotice(null);
    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email: confirmationEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      });
      if (error) {
        setNotice({ tone: "error", message: authErrorMessage(error, "resend") });
        return;
      }
      setCooldown(60);
      setNotice({ tone: "success", message: "Wenn die Adresse registriert ist, wurde eine neue Bestätigungs-E-Mail gesendet." });
    } catch {
      setNotice({ tone: "error", message: "Die Bestätigungs-E-Mail konnte wegen eines Netzwerkfehlers nicht gesendet werden." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.formContent}>
      {confirmationEmail ? (
        <section className={styles.confirmation} aria-labelledby="confirmation-heading">
          <span aria-hidden="true">✓</span>
          <h2 id="confirmation-heading">Bestätige deine E-Mail</h2>
          <p>Wir haben einen Bestätigungslink an <strong>{confirmationEmail}</strong> gesendet.</p>
          {notice && <p className={styles.notice} data-tone={notice.tone} role="status">{notice.message}</p>}
          <button type="button" className={styles.secondary} disabled={pending || cooldown > 0} onClick={resendConfirmation}>
            {pending ? "Wird gesendet …" : cooldown > 0 ? `Erneut senden in ${cooldown} s` : "Bestätigungs-E-Mail erneut senden"}
          </button>
          <Link href="/login">Zur Anmeldung</Link>
        </section>
      ) : profileUserId ? (
        <section className={styles.confirmation} aria-label="Profil laden">
          {notice && <p className={styles.notice} data-tone={notice.tone} role="alert">{notice.message}</p>}
          <button type="button" className={styles.primary} disabled={pending} onClick={retryProfile}>
            {pending ? "Profil wird geladen …" : "Profil erneut laden"}
          </button>
          <button type="button" className={styles.secondary} disabled={pending} onClick={restartLogin}>Abmelden und erneut anmelden</button>
        </section>
      ) : (
        <form onSubmit={submit}>
          {registering && <div className={styles.field}>
            <label htmlFor="display-name">Anzeigename</label>
            <div className={styles.inputIcon}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.6 3.4-6.5 8-6.5s8 2.9 8 6.5" /></svg>
              <input id="display-name" name="display_name" autoComplete="nickname" placeholder="Wie dürfen wir dich nennen?" required disabled={pending} />
            </div>
            <small>1–60 Zeichen</small>
          </div>}
          <div className={styles.field}>
            <label htmlFor="email">E-Mail</label>
            <div className={styles.inputIcon}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
              <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="du@hochschule.de" required disabled={pending} />
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Passwort</label>
            <div className={`${styles.inputIcon} ${styles.passwordWrap}`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
              <input id="password" name="password" type={visible ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} placeholder={registering ? "Mindestens 8 Zeichen" : "Dein Passwort"} minLength={registering ? 8 : undefined} required disabled={pending} />
              <button className={styles.visibility} type="button" aria-label={visible ? "Passwort ausblenden" : "Passwort anzeigen"} aria-controls="password" onClick={() => setVisible(!visible)} disabled={pending}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
              </button>
            </div>
            {!registering && (
              <Link className={styles.forgotPassword} href="/forgot-password">
                Passwort vergessen?
              </Link>
            )}
          </div>
          {notice && <p className={styles.notice} data-tone={notice.tone} role="alert">{notice.message}</p>}
          <button className={styles.primary} type="submit" disabled={pending}>{pending ? "Bitte warten …" : registering ? "Konto erstellen" : "Anmelden"}<span aria-hidden="true">→</span></button>
        </form>
      )}
      {!confirmationEmail && !profileUserId && <>
        <div className={styles.divider}><span>oder</span></div>
        <button type="button" className={styles.googleButton} disabled aria-describedby="google-unavailable"><span className={styles.googleMark} aria-hidden="true">G</span>Mit Google {registering ? "registrieren" : "anmelden"}</button>
        <p className={styles.providerHint} id="google-unavailable">Google-Anmeldung ist noch nicht eingerichtet.</p>
        {!registering && <p className={styles.alternative}>Du hast noch kein Konto? <Link href="/register">Jetzt registrieren</Link></p>}
      </>}
    </div>
  );
}
