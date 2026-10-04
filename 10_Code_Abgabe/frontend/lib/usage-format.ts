// Reine Darstellungshilfen für Nutzungskontingente — ohne Supabase-Client, damit sie
// testbar bleiben. Die Schlüssel stammen aus `plan_limits.kind` (Backend 20261004120000).

export type UsageKind = "chat" | "search" | "summary" | "flashcards" | "quizzes" | "material_analysis" | "upload";

export const USAGE_LABELS: Record<UsageKind, string> = {
  chat: "KI-Nachrichten",
  search: "Suchanfragen",
  summary: "Zusammenfassungen",
  flashcards: "Karteikarten-Generierungen",
  quizzes: "Quiz-Generierungen",
  material_analysis: "Materialanalysen",
  upload: "Uploads",
};

/**
 * Anteil des verbrauchten Kontingents (0–1). Bei Grenze `0` ist die Funktion im Tarif
 * gesperrt — das ist voll, nicht leer, sonst sähe eine gesperrte Funktion frei aus.
 */
export function usageRatio(used: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.min(1, Math.max(0, used / limit));
}

export type UsageTone = "ok" | "warn" | "full";

export function usageTone(used: number, limit: number): UsageTone {
  if (limit <= 0 || used >= limit) return "full";
  return used / limit >= 0.8 ? "warn" : "ok";
}

/** Verbleibende Einheiten, nie negativ. */
export function usageRemaining(used: number, limit: number): number {
  return Math.max(0, limit - used);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Speichergrößen in deutscher Schreibweise, ohne Nachkommastelle unter 1 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 2 && value < 100 ? 1 : 0;
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

/** "1. November 2026" — der Tag, an dem die Monatskontingente neu beginnen. */
export function formatResetDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}

export type UsageEntry = {
  kind: UsageKind;
  label: string;
  used: number;
  /** Grenze des aktuellen Tarifs; `0` sperrt die Funktion ganz. */
  limit: number;
  /** Dieselbe Grenze im Pro-Tarif — zeigt, was ein Abo brächte. */
  proLimit: number;
};

export type UsageOverview = {
  plan: "free" | "pro";
  /** Ende der Zahlungs-Schonfrist bei `past_due`, sonst `null`. */
  graceUntil: string | null;
  /** Beginn des nächsten Abrechnungsmonats. */
  resetsAt: string | null;
  entries: UsageEntry[];
  storage: { usedBytes: number; limitBytes: number; proLimitBytes: number };
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseUsage(payload: unknown): UsageOverview {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const usage = (raw.usage ?? {}) as Record<string, { used?: unknown; limit?: unknown; pro_limit?: unknown }>;
  const storage = (raw.storage ?? {}) as Record<string, unknown>;

  // Reihenfolge aus USAGE_LABELS, damit die Liste nicht je nach JSON-Reihenfolge springt.
  const entries = (Object.keys(USAGE_LABELS) as UsageKind[]).flatMap((kind) => {
    const row = usage[kind];
    if (!row) return [];
    return [{
      kind,
      label: USAGE_LABELS[kind],
      used: count(row.used),
      limit: count(row.limit),
      proLimit: count(row.pro_limit),
    }];
  });

  return {
    plan: raw.plan === "pro" ? "pro" : "free",
    graceUntil: typeof raw.grace_until === "string" ? raw.grace_until : null,
    resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null,
    entries,
    storage: {
      usedBytes: count(storage.used_bytes),
      limitBytes: count(storage.limit_bytes),
      proLimitBytes: count(storage.pro_limit_bytes),
    },
  };
}
