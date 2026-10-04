// Regeln rund um „E-Mail ändern“ — ohne Supabase-Client, damit sie testbar bleiben.
//
// Das Backend verlangt eine doppelte Bestätigung (`double_confirm_changes`): alte und neue
// Adresse bekommen je einen Link mit `type=email_change`. Die Änderung gilt erst, wenn
// beide bestätigt sind.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewEmail(value: string, currentEmail: string):
  | { valid: true; value: string }
  | { valid: false; message: string } {
  const email = value.trim();
  if (!email) return { valid: false, message: "Gib deine neue E-Mail-Adresse ein." };
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { valid: false, message: "Das ist keine gültige E-Mail-Adresse." };
  }
  if (email.toLowerCase() === currentEmail.trim().toLowerCase()) {
    return { valid: false, message: "Das ist bereits deine aktuelle E-Mail-Adresse." };
  }
  return { valid: true, value: email };
}

type AuthErrorLike = { code?: string; status?: number };

export function emailChangeErrorMessage(error: AuthErrorLike): string {
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.";
  }
  if (error.code === "email_exists") {
    return "Diese E-Mail-Adresse wird bereits verwendet.";
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return "Das ist keine gültige E-Mail-Adresse.";
  }
  if (error.status === 401 || error.code === "session_not_found") {
    return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";
  }
  return "Die E-Mail-Adresse konnte nicht geändert werden. Bitte versuche es später erneut.";
}

/**
 * Ergebnis eines bestätigten `email_change`-Links. Der erste der beiden Links liefert noch
 * keinen Nutzer zurück — die Änderung wartet dann auf den Link an die andere Adresse.
 */
export type EmailChangeOutcome = "changed" | "pending";

export function emailChangeOutcome(user: unknown): EmailChangeOutcome {
  return user ? "changed" : "pending";
}

export const EMAIL_CHANGED_DESTINATION = "/profile?email=changed";
