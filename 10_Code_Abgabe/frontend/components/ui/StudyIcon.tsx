export default function StudyIcon({ kind = "document" }: { kind?: "document" | "chat" | "calendar" | "shield" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "chat" ? <><path d="M5 4h14v12h-5l-4 4v-4H5z"/><path d="M9 8h6M9 12h4"/></> : kind === "calendar" ? <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3v3m6-3v3M9 11h6M9 15h3"/></> : kind === "shield" ? <><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/></> : <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></>}
  </svg>;
}
