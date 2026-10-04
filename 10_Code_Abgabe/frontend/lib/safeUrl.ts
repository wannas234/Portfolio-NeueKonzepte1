/**
 * Resolves a path returned by the backend against the configured Supabase origin and refuses
 * anything that ends up elsewhere (absolute URLs, `//host`, `javascript:` …). The result is
 * opened in a tab or an iframe, so a response-derived URL must never leave that origin.
 */
export function resolveSameOriginUrl(path: unknown, base: string): string {
  if (typeof path !== "string" || !path) throw new Error("INVALID_URL");
  const baseUrl = new URL(base);
  const resolved = new URL(path, baseUrl);
  if (!["http:", "https:"].includes(resolved.protocol) || resolved.origin !== baseUrl.origin) throw new Error("INVALID_URL");
  return resolved.href;
}
