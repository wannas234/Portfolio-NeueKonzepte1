"use client";

import { useState, type FormEvent } from "react";
import { emailChangeErrorMessage, validateNewEmail } from "@/lib/auth/emailChange";
import { createClient } from "@/lib/supabase/browser";
import s from "./profile.module.css";

type State =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

/**
 * Ändert die Anmelde-E-Mail. Supabase schickt je einen Bestätigungslink an die alte und
 * die neue Adresse; bis beide bestätigt sind, bleibt die bisherige Adresse gültig.
 */
export default function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const check = validateNewEmail(email, currentEmail);
    if (!check.valid) {
      setState({ status: "error", message: check.message });
      return;
    }

    setState({ status: "saving" });
    try {
      const { error } = await createClient().auth.updateUser({ email: check.value });
      if (error) {
        setState({ status: "error", message: emailChangeErrorMessage(error) });
        return;
      }
      setState({ status: "sent", email: check.value });
      setEmail("");
    } catch {
      setState({ status: "error", message: emailChangeErrorMessage({}) });
    }
  }

  if (state.status === "sent") {
    return (
      <p className={s.securityNote} role="status">
        Wir haben zwei Bestätigungslinks verschickt: einen an deine bisherige Adresse und einen an {state.email}.
        Die Änderung gilt erst, wenn du beide Links bestätigt hast. Bis dahin meldest du dich weiter mit der
        bisherigen Adresse an.
      </p>
    );
  }

  if (!open) {
    return (
      <>
        <p className={s.securityNote}>
          Deine E-Mail-Adresse gehört zu deiner Anmeldung. Eine Änderung musst du über die alte und die neue
          Adresse bestätigen.
        </p>
        <button type="button" onClick={() => setOpen(true)}>E-Mail-Adresse ändern</button>
      </>
    );
  }

  const saving = state.status === "saving";
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="new-email">Neue E-Mail-Adresse</label>
      <input
        id="new-email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (state.status === "error") setState({ status: "idle" });
        }}
        aria-describedby="new-email-status"
        aria-invalid={state.status === "error"}
        disabled={saving}
      />
      <div id="new-email-status" className={s.errorMessage} role="alert">
        {state.status === "error" && state.message}
      </div>
      <button type="submit" disabled={saving}>
        {saving ? "Wird gesendet …" : "Bestätigungslinks senden"}
      </button>
    </form>
  );
}
