"use client";

import { useSyncExternalStore } from "react";
import {
  applyTheme,
  getServerTheme,
  getTheme,
  storeChoice,
  subscribeTheme,
  type ThemeChoice,
} from "@/lib/theme";
import s from "./themeToggle.module.css";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const resolved = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const isDark = resolved === "dark";

  function toggle() {
    const next: ThemeChoice = isDark ? "light" : "dark";
    storeChoice(next);
    applyTheme(next);
  }

  const label = isDark ? "Zu hellem Erscheinungsbild wechseln" : "Zu dunklem Erscheinungsbild wechseln";

  return (
    <button
      type="button"
      className={s.toggle}
      data-compact={compact || undefined}
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      <span className={s.icon}>{isDark ? <SunIcon /> : <MoonIcon />}</span>
      {!compact && <span className={s.text}>{isDark ? "Hell" : "Dunkel"}</span>}
    </button>
  );
}
