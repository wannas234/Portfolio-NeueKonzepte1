import type { Metadata } from "next";
import GradeStudio from "@/components/grades/studio/GradeStudio";

export const metadata: Metadata = {
  title: "Noten | UniVerse",
  description: "Kursleistungen, offene Bewertungen und Zielnoten im Überblick.",
};

export default function GradesPage() {
  return <GradeStudio />;
}
