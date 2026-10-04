"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import DashboardFrame from "./DashboardFrame";
import styles from "./dashboard.module.css";

const lightRoutes = ["/dashboard", "/documents", "/courses", "/calendar", "/grades", "/assistant", "/profile", "/flashcards", "/billing", "/billing/success", "/billing/cancel"];
const lightRoutePattern = /^\/courses\/[^/]+(\/(documents(\/[^/]+)?|flashcards(\/[^/]+)?|summaries))?$/;

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/register" || pathname === "/forgot-password" || pathname === "/" || pathname.startsWith("/auth/"))
    return children;

  if (lightRoutes.includes(pathname) || lightRoutePattern.test(pathname)) return <DashboardFrame>{children}</DashboardFrame>;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.workspace}>
        <Topbar />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
