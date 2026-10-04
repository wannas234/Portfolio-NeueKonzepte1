import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Datenexport und Kontolöschung (Backend-Functions `account-export` und
// `delete-account`, Migrationen 20261004170000 und 20261004180000).
//
// Beides sind Betroffenenrechte nach DSGVO. Das Frontend löst sie nur aus: Welche Daten
// der Export enthält und was beim Löschen passiert, entscheidet ausschließlich das
// Backend — hier wird nichts nachgebaut, gefiltert oder zwischengespeichert.

export const DELETE_CONFIRMATION = "LÖSCHEN";

export type AccountErrorCode =
  | "UNAUTHENTICATED"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "CONFIRMATION_REQUIRED"
  | "INVALID_PASSWORD"
  | "PASSWORD_REQUIRED"
  | "STRIPE_ERROR"
  | "STORAGE_ERROR"
  | "DATABASE_ERROR"
  | "DELETE_FAILED"
  | "CONFIGURATION_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  /** Bei RATE_LIMITED die Wartezeit in Sekunden, falls das Backend sie nennt. */
  readonly retryAfterSeconds: number | null;
  constructor(code: AccountErrorCode, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "AccountError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const KNOWN_CODES = new Set<string>([
  "UNAUTHENTICATED", "RATE_LIMITED", "INVALID_REQUEST", "CONFIRMATION_REQUIRED",
  "INVALID_PASSWORD", "PASSWORD_REQUIRED", "STRIPE_ERROR", "STORAGE_ERROR",
  "DATABASE_ERROR", "DELETE_FAILED", "CONFIGURATION_ERROR", "SERVICE_UNAVAILABLE",
]);

export function toAccountErrorCode(value: unknown): AccountErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as AccountErrorCode) : "UNKNOWN";
}

function waitHint(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "Bitte versuche es später erneut.";
  const hours = Math.ceil(seconds / 3600);
  return hours > 1 ? `Bitte versuche es in etwa ${hours} Stunden erneut.` : "Bitte versuche es in etwa einer Stunde erneut.";
}

export function accountErrorMessage(error: unknown): string {
  const code = error instanceof AccountError ? error.code : "UNKNOWN";
  const seconds = error instanceof AccountError ? error.retryAfterSeconds : null;
  switch (code) {
    case "UNAUTHENTICATED":
      return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";
    case "RATE_LIMITED":
      return `Du hast das zuletzt zu oft angefordert. ${waitHint(seconds)}`;
    case "CONFIRMATION_REQUIRED":
      return `Tippe genau ${DELETE_CONFIRMATION} ein, um die Löschung zu bestätigen.`;
    case "INVALID_PASSWORD":
      return "Das Passwort stimmt nicht.";
    case "PASSWORD_REQUIRED":
      return "Dieses Konto hat kein Passwort. Die Löschung ist hier nicht möglich.";
    case "STRIPE_ERROR":
      return "Dein Abo konnte nicht gekündigt werden. Es wurde nichts gelöscht — bitte versuche es erneut.";
    case "STORAGE_ERROR":
      return "Deine Dateien konnten nicht entfernt werden. Dein Konto besteht weiterhin.";
    case "DELETE_FAILED":
      return "Die Löschung wurde begonnen, aber nicht abgeschlossen. Bitte versuche es erneut.";
    case "CONFIGURATION_ERROR":
      return "Die Löschung ist auf diesem Server nicht vollständig eingerichtet.";
    case "INVALID_REQUEST":
      return "Die Anfrage war unvollständig. Bitte fülle alle Felder aus.";
    case "NETWORK_ERROR":
      return "Keine Verbindung zum Server. Prüfe deine Internetverbindung.";
    default:
      return "Das hat nicht geklappt. Bitte versuche es erneut.";
  }
}

async function unwrap<T>(result: { data: T | null; error: unknown }): Promise<T> {
  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response;
    let body: { error?: { code?: unknown } } | undefined;
    try {
      body = await response.json();
    } catch {
      /* Kein JSON-Body: unten allgemein behandelt. */
    }
    const header = Number.parseInt(response.headers?.get?.("retry-after") ?? "", 10);
    throw new AccountError(
      response.status === 401 ? "UNAUTHENTICATED" : toAccountErrorCode(body?.error?.code),
      Number.isFinite(header) ? header : null
    );
  }
  if (result.error) throw new AccountError("NETWORK_ERROR");
  if (!result.data) throw new AccountError("UNKNOWN");
  return result.data;
}

/** Dateiname des Exports: `universe-export-YYYY-MM-DD.json`, wie vom Backend vorgegeben. */
export function exportFileName(now: Date = new Date()): string {
  const iso = Number.isNaN(now.getTime()) ? new Date() : now;
  return `universe-export-${iso.toISOString().slice(0, 10)}.json`;
}

/**
 * Lädt alle eigenen Daten als JSON. Höchstens drei Exporte je 24 Stunden; danach
 * antwortet das Backend mit RATE_LIMITED und einer Wartezeit.
 */
export async function requestAccountExport(client: SupabaseClient<Database>): Promise<unknown> {
  return unwrap(await client.functions.invoke("account-export", { method: "GET" }));
}

/**
 * Löscht das Konto endgültig: kündigt ein laufendes Abo sofort, entfernt alle Dateien
 * und den Auth-Nutzer. Danach muss sich das Frontend lokal abmelden — das alte Token
 * bleibt bis zum Ablauf formal gültig, findet aber keine Daten mehr.
 */
export async function deleteOwnAccount(client: SupabaseClient<Database>, password: string): Promise<void> {
  await unwrap(
    await client.functions.invoke("delete-account", {
      body: { password, confirm: DELETE_CONFIRMATION },
    })
  );
  await client.auth.signOut({ scope: "local" });
}
