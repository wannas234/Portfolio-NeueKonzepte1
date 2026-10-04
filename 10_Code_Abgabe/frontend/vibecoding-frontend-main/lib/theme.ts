export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "universe-theme";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); follow the system.
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  listeners.forEach((notify) => notify());
  return resolved;
}

// The theme lives outside React — in the <html> attribute, in storage and in
// the OS setting — so components read it through useSyncExternalStore instead
// of mirroring it into state from an effect.
const listeners = new Set<() => void>();

export function subscribeTheme(notify: () => void): () => void {
  listeners.add(notify);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  function onSystemChange() {
    // Follow the OS only while the user has not chosen explicitly.
    if (readStoredChoice() === "system") applyTheme("system");
  }
  media.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(notify);
    media.removeEventListener("change", onSystemChange);
  };
}

export function getTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// The server cannot know the stored choice; the head script corrects the
// attribute before paint and the first subscription re-reads it.
export function getServerTheme(): ResolvedTheme {
  return "light";
}

export function storeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // A non-persisted choice still applies for this page view.
  }
}

// Runs as a blocking inline script before first paint, so the correct theme is
// already on <html> and no light flash appears on a dark-mode reload. Kept as a
// self-contained string: it must not depend on the bundle being loaded yet.
export const themeInitScript = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;
