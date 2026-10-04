import type { Metadata } from "next";
import CalendarWorkspace from "@/components/calendar/CalendarWorkspace";

export const metadata: Metadata = {
  title: "Kalender | UniVerse",
  description: "Vorlesungen, Lernzeit und wichtige Termine im Studienkontext.",
};

export default function CalendarPage() {
  return <CalendarWorkspace />;
}
