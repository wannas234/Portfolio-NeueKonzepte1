import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';

/** Fehlercodes von `account-export` und `delete-account` (Feld `error.code`). */
export type AccountErrorCode =
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'PASSWORD_REQUIRED'
  | 'STRIPE_ERROR'
  | 'STORAGE_ERROR'
  | 'DATABASE_ERROR'
  | 'DELETE_FAILED'
  | 'CONFIGURATION_ERROR'
  | 'SERVICE_UNAVAILABLE';

export interface AccountExportFile {
  id: string;
  course_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  created_at: string;
  /** Nur für fertige Dateien; gilt bis `download_expires_at` (24 h). */
  download_url: string | null;
  download_expires_at: string | null;
}

/** Datenexport (Art. 15/20 DSGVO). Übrige Schlüssel: siehe docs/account.md. */
export interface AccountExport {
  export_version: 1;
  exported_at: string;
  account: { id: string; email: string | null; created_at: string };
  files: AccountExportFile[];
  [collection: string]: unknown;
}

/** Höchstens 3 Exporte pro 24 h; danach `RATE_LIMITED` (429, Header Retry-After). */
export function exportAccount(client: SupabaseClient<Database>) {
  return client.functions.invoke<AccountExport>('account-export', { method: 'GET' });
}

/** Löschtext, den der Nutzer exakt eintippen muss. */
export const DELETE_CONFIRMATION = 'LÖSCHEN';

/**
 * Löscht das Konto endgültig: kündigt das Stripe-Abo sofort, entfernt alle Dateien und den
 * Auth-Nutzer. Danach lokal abmelden (`client.auth.signOut({ scope: 'local' })`).
 */
export function deleteAccount(client: SupabaseClient<Database>, password: string) {
  return client.functions.invoke<{ deleted: true }>('delete-account', {
    body: { password, confirm: DELETE_CONFIRMATION },
  });
}

/**
 * E-Mail ändern: Supabase schickt wegen double_confirm_changes an alte und neue Adresse je
 * einen Link (`/auth/confirm?token_hash=…&type=email_change`). Wirksam erst nach beiden.
 */
export function changeEmail(
  client: SupabaseClient<Database>,
  email: string,
  emailRedirectTo?: string,
) {
  return client.auth.updateUser({ email }, emailRedirectTo ? { emailRedirectTo } : undefined);
}
