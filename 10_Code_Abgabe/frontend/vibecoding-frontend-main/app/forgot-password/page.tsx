import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Passwort vergessen | UniVerse",
};

export default function ForgotPasswordPage() {
  return <AuthShell variant="forgot"><ForgotPasswordForm /></AuthShell>;
}
