"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import AuthenticatedProfile from "./auth/AuthenticatedProfile";
import s from "./navigation.module.css";

const items = [
  { href: "/dashboard", label: "Übersicht" },
  { href: "/assistant", label: "KI-Assistent" },
  { href: "/courses", label: "Kurse" },
  { href: "/calendar", label: "Kalender" },
  { href: "/documents", label: "Unterlagen" },
  { href: "/grades", label: "Noten" },
];
const laptopQuery = "(max-width: 1360px)";
function subscribeViewport(callback: () => void) {
  const query = window.matchMedia(laptopQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function Navigation({ compact = false, onNavigate, id }: { compact?: boolean; onNavigate?: () => void; id: string }) {
  const pathname = usePathname();
  return (
    <div className={s.navigation} id={id}>
      <p className={s.indexLabel}>{compact ? "INDEX" : "DEIN STUDIENRAUM"}</p>
      <nav aria-label="Hauptnavigation">
        {items.map((item, index) => (
          <Link key={item.href} href={item.href} onClick={onNavigate} title={compact ? item.label : undefined}
            aria-label={item.label} aria-current={pathname === item.href || pathname.startsWith(item.href + "/") ? "page" : undefined}>
            <span className={s.navNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className={compact ? s.srOnly : s.navLabel}>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className={s.account}><AuthenticatedProfile compact={compact} onNavigate={onNavigate} /></div>
    </div>
  );
}

export default function Sidebar() {
  const narrow = useSyncExternalStore(subscribeViewport, () => window.matchMedia(laptopQuery).matches, () => false);
  const [preference, setPreference] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const collapsed = preference ?? narrow;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem("lernapp-sidebar");
        if (saved === "collapsed" || saved === "expanded") setPreference(saved === "collapsed");
      } catch { /* Navigation works without browser storage. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (desktop.matches) drawer.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previous;
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [mobileOpen]);

  function toggle() {
    setPreference(!collapsed);
    try { localStorage.setItem("lernapp-sidebar", !collapsed ? "collapsed" : "expanded"); } catch { /* Optional preference. */ }
  }
  function closeDrawer() { drawer.current?.close(); }

  return <>
    <aside className={s.sidebar} data-collapsed={collapsed}>
      <Link className={s.brand} href="/dashboard" aria-label="UniVerse, zur Übersicht">{collapsed ? <>U<span className={s.brandDot}>.</span></> : <>UniVerse<span className={s.brandDot}>.</span></>}</Link>
      <button className={s.toggle} type="button" onClick={toggle} aria-expanded={!collapsed}
        aria-controls="desktop-navigation" aria-label={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}>
        <span aria-hidden="true">{collapsed ? "→" : "←"}</span>{!collapsed && <span>Navigation einklappen</span>}
      </button>
      <Navigation compact={collapsed} id="desktop-navigation" />
    </aside>
    <div className={s.mobileBar}>
      <Link className={s.brand} href="/dashboard">UniVerse<span className={s.brandDot}>.</span></Link>
      <button type="button" className={s.mobileToggle} aria-expanded={mobileOpen} aria-controls="mobile-navigation"
        onClick={() => { drawer.current?.showModal(); setMobileOpen(true); }}>Index <span aria-hidden="true">☰</span></button>
    </div>
    <dialog ref={drawer} className={s.drawer} aria-label="App-Navigation" onClose={() => setMobileOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <div className={s.drawerContent}>
        <div className={s.drawerHeader}><Link className={s.brand} href="/dashboard" onClick={closeDrawer}>UniVerse<span className={s.brandDot}>.</span></Link>
          <button type="button" className={s.mobileToggle} onClick={closeDrawer} aria-label="Navigation schließen">Schließen ×</button></div>
        {mobileOpen && <Navigation onNavigate={closeDrawer} id="mobile-navigation" />}
      </div>
    </dialog>
  </>;
}
