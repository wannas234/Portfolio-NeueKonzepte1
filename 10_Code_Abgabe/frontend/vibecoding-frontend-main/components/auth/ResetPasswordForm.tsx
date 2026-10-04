"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authErrorMessage, validatePasswordReset } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/browser";
import styles from "./auth.module.css";

export default function ResetPasswordForm({ allowed }: { allowed: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    const validationError = validatePasswordReset(password, confirmation);
    if (validationError) return setError(validationError);

    setPending(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(authErrorMessage(updateError, "password"));
        return;
      }
      const completion = await fetch("/auth/recovery/complete", { method: "POST" });
      if (!completion.ok) throw new Error("Recovery cleanup failed");
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      window.location.replace("/login?authNotice=passwordUpdated");
    } catch {
      setError("Die Verbindung ist fehlgeschlagen. Bitte versuche es erneut.");
    } finally {
      setPending(false);
    }
  }

  if (!allowed) {
    return (
      <div className={styles.formContent}>
        <p className={styles.eyebrow}>Sicherer Kontozugang</p>
        <h1>Reset-Link erforderlich</h1>
        <p className={styles.subtitle}>Fordere einen neuen Link an, um dein Passwort sicher zu ändern.</p>
        <p className={styles.alternative}><Link href="/forgot-password">Neuen Reset-Link anfordern</Link></p>
      </div>
    );
  }

  return (
    <div className={styles.formContent}>
      <p className={styles.eyebrow}>Fast geschafft</p>
      <h1>Neues Passwort</h1>
      <p className={styles.subtitle}>Lege ein neues Passwort mit mindestens acht Zeichen fest.</p>
      <form onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="new-password">Neues Passwort</label>
          <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending} />
        </div>
        <div className={styles.field}>
          <label htmlFor="new-password-confirmation">Passwort wiederholen</label>
          <input id="new-password-confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={8} required disabled={pending} />
        </div>
        {error && <p className={styles.notice} data-tone="error" role="alert">{error}</p>}
        <button className={styles.primary} type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : "Passwort speichern"}
        </button>
      </form>
    </div>
  );
}
