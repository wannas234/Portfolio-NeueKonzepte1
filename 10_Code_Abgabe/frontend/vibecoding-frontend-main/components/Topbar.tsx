"use client";
import { usePathname } from "next/navigation";
import s from "./dashboard.module.css";
const labels: Record<string, string> = {
  "/dashboard": "Übersicht",
  "/assistant": "KI-Assistent",
  "/courses": "Kurse",
  "/calendar": "Kalender",
  "/documents": "Unterlagen",
  "/grades": "Noten",
  "/profile": "Profil",
};
const today = new Date();
const stamp = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "short" }).format(today);
export default function Topbar() {
  const path = usePathname();
  return (
    <header className={s.topbar}>
      <div>
        <span>Dein Studienraum / </span>
        <strong>{labels[path] ?? "UniVerse"}</strong>
      </div>
      <small>{stamp.toUpperCase()}</small>
    </header>
  );
}
