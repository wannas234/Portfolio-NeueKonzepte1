"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupportedEmailOtpType } from "@/lib/auth/confirmation";
import styles from "./auth.module.css";

export default function ConfirmAuthForm({
  type,
}: {
  type: SupportedEmailOtpType | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Erster von zwei Links einer E-Mail-Änderung: bestätigt, aber noch nicht wirksam.
  const [awaitingSecondLink, setAwaitingSecondLink] = useState(false);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/auth/confirm/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await response.json()) as { destination?: string; emailChange?: string };
      if (response.ok && body.emailChange === "pending") {
        setAwaitingSecondLink(true);
        return;
      }
      if (!response.ok || !body.destination) {
        setError("Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.");
        return;
      }
      window.location.replace(body.destination);
    } catch {
      setError("Die Bestätigung konnte wegen eines Netzwerkfehlers nicht abgeschlossen werden.");
    } finally {
      setPending(false);
    }
  }

  if (!type) {
    return (
      <div className={styles.formContent}>
        <p className={styles.eyebrow}>Sicherer Kontozugang</p>
        <h1>Link nicht verfügbar</h1>
        <p className={styles.subtitle}>
          Der Bestätigungslink fehlt, ist abgelaufen oder wurde bereits verwendet.
        </p>
        <p className={styles.alternative}>
          <Link href="/login">Zur Anmeldung</Link>
        </p>
      </div>
    );
  }

  if (awaitingSecondLink) {
    return (
      <div className={styles.formContent}>
        <p className={styles.eyebrow}>Sicherer Kontozugang</p>
        <h1>Erste Bestätigung erhalten</h1>
        <p className={styles.subtitle} role="status">
          Deine E-Mail-Adresse ist noch nicht geändert. Öffne jetzt auch den Link in der Nachricht an deine
          andere Adresse — erst danach gilt die neue Adresse.
        </p>
        <p className={styles.alternative}>
          <Link href="/profile">Zum Profil</Link>
        </p>
      </div>
    );
  }

  const recovering = type === "recovery";
  const changingEmail = type === "email_change";
  return (
    <div className={styles.formContent}>
      <p className={styles.eyebrow}>Sicherer Kontozugang</p>
      <h1>{recovering ? "Passwort zurücksetzen" : changingEmail ? "E-Mail-Änderung bestätigen" : "E-Mail bestätigen"}</h1>
      <p className={styles.subtitle}>
        {recovering
          ? "Bestätige den Link, um anschließend ein neues Passwort festzulegen."
          : changingEmail
            ? "Bestätige die Änderung deiner E-Mail-Adresse. Sie gilt erst, wenn du die Links an die alte und die neue Adresse bestätigt hast."
            : "Bestätige deine E-Mail-Adresse, um deinen Studienraum zu öffnen."}
      </p>
      {error && <p className={styles.notice} data-tone="error" role="alert">{error}</p>}
      <button type="button" className={styles.primary} onClick={confirm} disabled={pending}>
        {pending ? "Wird bestätigt …" : recovering ? "Weiter zum neuen Passwort" : changingEmail ? "Änderung bestätigen" : "E-Mail bestätigen"}
      </button>
      <p className={styles.alternative}><Link href="/login">Abbrechen und anmelden</Link></p>
    </div>
  );
}
