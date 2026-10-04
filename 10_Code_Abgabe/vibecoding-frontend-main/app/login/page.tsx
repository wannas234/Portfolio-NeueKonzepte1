import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import AuthForm from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Anmelden | UniVerse" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; authError?: string; authNotice?: string }> }) {
  const params = await searchParams;
  return <AuthShell variant="login"><AuthForm mode="login" next={params.next} initialError={params.authError} initialNotice={params.authNotice} /></AuthShell>;
}
