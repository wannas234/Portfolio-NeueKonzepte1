import type { ReactNode } from "react";
import s from "./PageHeading.module.css";

export default function PageHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className={s.header}>
    <div className={s.identity}>
      <span className={s.icon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="14" height="16" rx="3"/><path d="M8 8h6M8 12h3m4 3 5 5"/><circle cx="14" cy="14" r="3"/></svg></span>
      <div><h1>{title}</h1><p>{description}</p></div>
    </div>
    {children}
  </header>;
}
