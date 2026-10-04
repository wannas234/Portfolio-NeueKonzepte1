const COLORS = [
  "green",
  "amber",
  "sage",
  "blue",
  "rose",
  "violet",
  "teal",
  "coral",
  "indigo",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function deriveCourseBadge(title: string): { code: string; color: string } {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const code =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : (words[0] ?? "?").slice(0, 2).toUpperCase();

  const color = COLORS[hashString(title.trim().toLowerCase()) % COLORS.length];

  return { code, color };
}
