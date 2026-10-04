export const PENDING_CONFIRMATION_COOKIE = "lernapp_pending_confirmation";
export const RECOVERY_SESSION_COOKIE = "lernapp_recovery_session";

export type SupportedEmailOtpType = "email" | "recovery" | "email_change";

export type PendingConfirmation = {
  tokenHash: string;
  type: SupportedEmailOtpType;
};

const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{20,512}$/;

export function parseEmailOtpType(value: string | null): SupportedEmailOtpType | null {
  return value === "email" || value === "recovery" || value === "email_change" ? value : null;
}

export function createPendingConfirmation(
  tokenHash: string,
  type: SupportedEmailOtpType
): string | null {
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) return null;
  return `${type}.${tokenHash}`;
}

export function parsePendingConfirmation(value: string | undefined): PendingConfirmation | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  const type = parseEmailOtpType(value.slice(0, separator));
  const tokenHash = value.slice(separator + 1);
  return type && TOKEN_HASH_PATTERN.test(tokenHash) ? { type, tokenHash } : null;
}

export function trustedOrigin(configuredSiteUrl: string | undefined, fallbackOrigin: string): string {
  if (!configuredSiteUrl) return new URL(fallbackOrigin).origin;
  const url = new URL(configuredSiteUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("AUTH_SITE_URL muss HTTP oder HTTPS verwenden.");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("AUTH_SITE_URL muss eine Basisadresse sein.");
  }
  return url.origin;
}

export function requestHasTrustedOrigin(origin: string | null, trusted: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(trusted).origin;
  } catch {
    return false;
  }
}

export const expiredAuthCookie = { path: "/auth", maxAge: 0, expires: new Date(0), httpOnly: true };
