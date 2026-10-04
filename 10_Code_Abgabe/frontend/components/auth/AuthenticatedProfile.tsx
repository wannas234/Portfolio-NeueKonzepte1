"use client";

import Link from "next/link";
import { useAuthenticatedProfile } from "@/lib/auth/useAuthenticatedProfile";
import s from "@/components/navigation.module.css";

export default function AuthenticatedProfile({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const { name, detail, initial, signingOut, logout } = useAuthenticatedProfile();

  return (
    <div className={`${s.profileArea} ${compact ? s.profileCompact : ""}`}>
      <Link
        href="/profile"
        className={s.profile}
        aria-label="Eigenes Profil öffnen"
        title={compact ? name : undefined}
        onClick={onNavigate}
      >
        <span aria-hidden="true">{initial}</span>
        <div className={compact ? s.srOnly : undefined} aria-live="polite"><strong>{name}</strong><small>{detail}</small></div>
      </Link>
      <button type="button" className={s.logoutButton} onClick={logout} disabled={signingOut} title="Abmelden" aria-label={signingOut ? "Wird abgemeldet …" : "Abmelden"}>
        {compact ? <span aria-hidden="true">↪</span> : signingOut ? "Wird abgemeldet …" : "Abmelden"}
      </button>
    </div>
  );
}
