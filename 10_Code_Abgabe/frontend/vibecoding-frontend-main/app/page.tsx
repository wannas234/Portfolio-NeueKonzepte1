import type { Metadata } from "next";
import LandingPage from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "UniVerse – Dein Studienraum",
  description:
    "Kurse, Vorlesungsmaterial, Notizen, Termine und Prüfungsvorbereitung in einem verbundenen Workflow.",
};

export default function WelcomePage() {
  return <LandingPage />;
}
