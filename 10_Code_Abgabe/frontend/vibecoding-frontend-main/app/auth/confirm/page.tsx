import type { Metadata } from "next";
import { cookies } from "next/headers";
import AuthShell from "@/components/auth/AuthShell";
import ConfirmAuthForm from "@/components/auth/ConfirmAuthForm";
import {
  parsePendingConfirmation,
  PENDING_CONFIRMATION_COOKIE,
} from "@/lib/auth/confirmation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "E-Mail bestätigen | UniVerse",
};

export default async function ConfirmPage() {
  const cookieStore = await cookies();
  const pending = parsePendingConfirmation(
    cookieStore.get(PENDING_CONFIRMATION_COOKIE)?.value
  );

  return (
    <AuthShell>
      <ConfirmAuthForm type={pending?.type ?? null} />
    </AuthShell>
  );
}
