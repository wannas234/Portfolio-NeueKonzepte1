"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuthenticatedProfile } from "@/lib/auth/useAuthenticatedProfile";
import BrandLogo from "@/components/ui/BrandLogo";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { COMPACT_MEDIA_QUERY, effectiveCollapsed, isDrawerOpen } from "./shellState";
import s from "./dashboardFrame.module.css";

const sidebarStorageKey = "lernapp-dashboard-sidebar";

const items = [
  { href: "/dashboard", label: "Übersicht", icon: <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v8.5a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1V10" /></> },
  { href: "/assistant", label: "KI-Assistent", badge: "Neu", icon: <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9l5.6-1.9L12 3.5Z" strokeLinejoin="round" /> },
  { href: "/courses", label: "Kurse", icon: <><path d="M4 5.5C4 4.67 4.67 4 5.5 4H13v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" /><path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" /></> },
  { href: "/calendar", label: "Kalender", icon: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16M8 3v3.4M16 3v3.4" /></> },
  { href: "/documents", label: "Unterlagen", icon: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2h7A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11Z" /> },
  { href: "/flashcards", label: "Karteikarten", icon: <><rect x="7" y="3" width="13" height="14" rx="2"/><path d="M16 17v3H4V7h3M11 8h5M11 12h3"/></> },
  { href: "/grades", label: "Noten", icon: <><path d="M5 20V11M12 20V4M19 20v-7" /></> },
  { href: "/profile", label: "Profil", icon: <><circle cx="12" cy="8.2" r="3.2" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></> },
];

// The server always renders the desktop variant; the real value is applied right
// after hydration. The compact CSS itself does not depend on this.
function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getCompact = () => window.matchMedia(COMPACT_MEDIA_QUERY).matches;
const getServerCompact = () => false;

export default function DashboardFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { name, detail, initial, signingOut, logout } = useAuthenticatedProfile();
  // Desktop preference (persisted) and mobile drawer (not persisted) are separate.
  const [collapsedPreference, setCollapsedPreference] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const compact = useSyncExternalStore(subscribeCompact, getCompact, getServerCompact);
  const collapsed = effectiveCollapsed(collapsedPreference, compact);
  const drawerOpen = isDrawerOpen(openedAt, pathname, compact);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasDrawerOpen = useRef(false);

  // No theme effect here on purpose. The shell used to pin `data-theme="light"`,
  // which overrode the user's choice on every mount. The theme is now resolved
  // once by the head script in app/layout.tsx (stored choice, else system).

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setCollapsedPreference(localStorage.getItem(sidebarStorageKey) === "collapsed");
      } catch { /* Navigation works without browser storage. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Drawer: Escape closes it; focus moves into it on open and back to the menu button on close.
  useEffect(() => {
    if (drawerOpen) {
      closeButtonRef.current?.focus();
      wasDrawerOpen.current = true;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpenedAt(null);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    if (wasDrawerOpen.current) {
      wasDrawerOpen.current = false;
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsedPreference((current) => {
      const next = !current;
      try { localStorage.setItem(sidebarStorageKey, next ? "collapsed" : "expanded"); } catch { /* Optional preference. */ }
      return next;
    });
  }

  const closeDrawer = () => setOpenedAt(null);

  return (
    <div className={s.shell}>
      <div className={s.atmosphere} aria-hidden="true" />
      <aside id="app-sidebar" className={s.sidebar} data-collapsed={collapsed} data-drawer-open={drawerOpen}>
        <div className={s.brandRow}>
          <Link href="/dashboard" className={s.brand} title={collapsed ? "UniVerse" : undefined} aria-label={collapsed ? "UniVerse – Übersicht" : undefined}>
            <BrandLogo mark={collapsed} />
          </Link>
          {compact ? (
            <button ref={closeButtonRef} type="button" className={s.collapseToggle} onClick={closeDrawer}
              aria-label="Navigation schließen" title="Navigation schließen">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          ) : !collapsed && (
            <button type="button" className={s.collapseToggle} onClick={toggleCollapsed} title="Navigation einklappen"
              aria-expanded={!collapsed} aria-controls="dashboard-navigation" aria-label="Navigation einklappen">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 5 12l6 7M5 12h14" /></svg>
            </button>
          )}
        </div>
        <div className={s.sidebarBody}>
          {!compact && collapsed && (
            <button type="button" className={s.collapseToggle} onClick={toggleCollapsed} title="Navigation ausklappen"
              aria-expanded={!collapsed} aria-controls="dashboard-navigation" aria-label="Navigation ausklappen">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" data-flip="true"><path d="M11 5 5 12l6 7M5 12h14" /></svg>
            </button>
          )}
          <nav aria-label="Hauptnavigation" id="dashboard-navigation">
            {items.map((item) => {
              const inFlashcards = /^\/courses\/[^/]+\/flashcards(?:\/|$)/.test(pathname);
              const active = item.href === "/flashcards" ? pathname === item.href || inFlashcards : (pathname === item.href || pathname.startsWith(item.href + "/")) && !(item.href === "/courses" && inFlashcards);
              return (
                <Link key={item.href} href={item.href} className={s.navItem} aria-current={active ? "page" : undefined} data-active={active}
                  title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{item.icon}</svg>
                  <span>{item.label}</span>
                  {item.badge && !collapsed && <span className={s.navBadge}>{item.badge}</span>}
                </Link>
              );
            })}
          </nav>
          <div className={s.sidebarFooter}>
            <ThemeToggle compact={collapsed} />
            <Link href="/profile" className={s.profileRow} title={collapsed ? name : undefined} aria-label={collapsed ? `${name} – Profil` : undefined}>
              <span className={s.avatar} aria-hidden="true">{initial}</span>
              {!collapsed && (
                <>
                  <span className={s.identity}><strong>{name}</strong><small>{detail}</small></span>
                  <svg aria-hidden="true" className={s.gear} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.3 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.7 7.7 0 0 0 1.7 1L11 21h4l.3-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z" /></svg>
                </>
              )}
            </Link>
            <button type="button" className={s.logoutItem} onClick={logout} disabled={signingOut}
              title={collapsed ? "Abmelden" : undefined} aria-label={collapsed ? "Abmelden" : undefined}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3" /><path d="M15 16l4-4-4-4M19 12H9" /></svg>
              <span>{signingOut ? "Wird abgemeldet …" : "Abmelden"}</span>
            </button>
          </div>
        </div>
      </aside>
      {drawerOpen && <div className={s.backdrop} onClick={closeDrawer} aria-hidden="true" />}
      <div className={s.workspace} inert={drawerOpen}>
        <header className={s.topbar}>
          <button ref={menuButtonRef} type="button" className={s.menuButton} onClick={() => setOpenedAt(pathname)}
            aria-label="Navigation öffnen" aria-expanded={drawerOpen} aria-controls="app-sidebar">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <div className={s.search}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" placeholder="Kurse, Dokumente, Karteikarten, ..." aria-label="Globale Suche" />
            <kbd className={s.searchHint} aria-hidden="true">⌘K</kbd>
          </div>
          <div className={s.topbarRight}>
            <button type="button" className={s.bell} aria-label="Benachrichtigungen">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
              <span className={s.dot} aria-hidden="true" />
            </button>
            <Link href="/profile" className={s.profileChip}>
              <span className={s.avatar} aria-hidden="true">{initial}</span>
              <span className={s.identity}><strong>{name}</strong><small>{detail}</small></span>
              <svg aria-hidden="true" className={s.chevronDown} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </Link>
          </div>
        </header>
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}
