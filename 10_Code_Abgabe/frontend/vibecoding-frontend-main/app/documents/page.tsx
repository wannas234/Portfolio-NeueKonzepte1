import type { Metadata } from "next";
import DocumentLibrary from "@/components/documents/DocumentLibrary";

export const metadata: Metadata = {
  title: "Unterlagen | UniVerse",
  description: "Alle deine Dokumente kursübergreifend finden, filtern und öffnen.",
};

export default function DocumentsPage() {
  return <DocumentLibrary />;
}
