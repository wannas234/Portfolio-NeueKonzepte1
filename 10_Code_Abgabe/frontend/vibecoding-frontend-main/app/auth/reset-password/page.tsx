import type { Metadata } from "next";
import { cookies } from "next/headers";
import AuthShell from "@/components/auth/AuthShell";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { RECOVERY_SESSION_COOKIE } from "@/lib/auth/confirmation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Neues Passwort | UniVerse",
};

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const recoveryActive = cookieStore.get(RECOVERY_SESSION_COOKIE)?.value === "active";
  let authenticated = false;
  if (recoveryActive) {
    try {
      const { data, error } = await (await createClient()).auth.getClaims();
      authenticated = !error && Boolean(data?.claims?.sub);
    } catch {
      authenticated = false;
    }
  }

  return <AuthShell><ResetPasswordForm allowed={recoveryActive && authenticated} /></AuthShell>;
}
