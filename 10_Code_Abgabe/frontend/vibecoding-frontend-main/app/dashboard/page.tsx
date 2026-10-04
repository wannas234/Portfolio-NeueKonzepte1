import type { Metadata } from "next";
import DashboardOverview from "@/components/dashboard/DashboardOverview";

export const metadata: Metadata = {
  title: "Übersicht | UniVerse",
  description: "Deine nächsten Termine, Kurse und zuletzt hinzugefügten Unterlagen.",
};

export default function DashboardPage() {
  return <DashboardOverview />;
}
