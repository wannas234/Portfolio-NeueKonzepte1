"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  accountErrorMessage,
  DELETE_CONFIRMATION,
  deleteOwnAccount,
  exportFileName,
  requestAccountExport,
} from "@/lib/account";
import { createClient } from "@/lib/supabase/browser";
import s from "./profile.module.css";

/**
 * Datenexport und Kontolöschung (DSGVO Art. 15/20 und 17).
 *
 * Der Export wird im Browser als Datei gespeichert und nirgends zwischengelagert. Die
 * Löschung ist endgültig und kündigt ein laufendes Abo sofort — deshalb verlangt das
 * Backend Passwort und ein exakt eingetipptes Bestätigungswort, und beides wird hier
 * nicht abgekürzt.
 */
export default function AccountDataCard() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExported(false);
    try {
      const data = await requestAccountExport(createClient());
      // Als Datei anbieten, statt die Daten irgendwo zu halten.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFileName();
      link.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (error) {
      setExportError(accountErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation.trim() !== DELETE_CONFIRMATION) {
      setDeleteError(`Tippe genau ${DELETE_CONFIRMATION} ein, um fortzufahren.`);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteOwnAccount(createClient(), password);
      router.replace("/");
      router.refresh();
    } catch (error) {
      setDeleteError(accountErrorMessage(error));
      setDeleting(false);
    }
  }

  return (
    <section className={s.card} aria-labelledby="account-data-heading">
      <h2 id="account-data-heading">Deine Daten</h2>
      <p className={s.supportingText}>
        Lade alles herunter, was zu deinem Konto gespeichert ist, oder lösche es endgültig.
      </p>

      <div className={s.dataActions}>
        <button type="button" onClick={() => void handleExport()} disabled={exporting}>
          {exporting ? "Wird vorbereitet …" : "Daten exportieren"}
        </button>
        <span className={s.dataHint}>JSON-Datei · höchstens drei Exporte pro Tag</span>
      </div>
      {exported && <p className={s.statusMessage} role="status">Der Export wurde heruntergeladen.</p>}
      {exportError && <p className={s.errorMessage} role="alert">{exportError}</p>}

      <div className={s.dangerZone}>
        <h3>Konto löschen</h3>
        <p>
          Alle Kurse, Unterlagen, Notizen und Lernstände werden entfernt. Ein laufendes
          Abo wird sofort gekündigt, ohne anteilige Erstattung. Das lässt sich nicht
          rückgängig machen.
        </p>

        {!open ? (
          <button type="button" className={s.dangerButton} onClick={() => setOpen(true)}>
            Konto löschen …
          </button>
        ) : (
          <form onSubmit={handleDelete} noValidate>
            <label htmlFor="delete-password">Dein Passwort</label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={deleting}
              required
            />

            <label htmlFor="delete-confirm">Tippe {DELETE_CONFIRMATION} ein</label>
            <input
              id="delete-confirm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={DELETE_CONFIRMATION}
              disabled={deleting}
              required
            />

            {deleteError && <p className={s.errorMessage} role="alert">{deleteError}</p>}

            <div className={s.dangerActions}>
              <button type="button" className={s.cancelDelete} onClick={() => setOpen(false)} disabled={deleting}>
                Abbrechen
              </button>
              <button
                type="submit"
                className={s.dangerButton}
                disabled={deleting || !password || confirmation.trim() !== DELETE_CONFIRMATION}
              >
                {deleting ? "Wird gelöscht …" : "Endgültig löschen"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
