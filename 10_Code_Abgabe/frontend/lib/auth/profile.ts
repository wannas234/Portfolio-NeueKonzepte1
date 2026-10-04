import type { Tables } from "@/lib/supabase/database.types";

export type ProfileRecord = Pick<
  Tables<"profiles">,
  "name" | "created_at" | "updated_at"
>;

export const PROFILE_UPDATED_EVENT = "lernapp:profile-updated";

export type ProfileUpdatedDetail = {
  displayName: string;
};

export function registrationProfileMetadata(displayName: string) {
  return { display_name: displayName };
}

export function profileInitial(displayName: string): string {
  return Array.from(displayName.trim())[0]?.toLocaleUpperCase("de-DE") ?? "L";
}

export function announceProfileUpdate(displayName: string) {
  window.dispatchEvent(
    new CustomEvent<ProfileUpdatedDetail>(PROFILE_UPDATED_EVENT, {
      detail: { displayName },
    })
  );
}

export type ProfileLookup = {
  data: unknown;
  error: { code?: string } | null;
  status: number;
};

export type LoginProfileResult = "ready" | "missing" | "unauthorized" | "unavailable" | "configuration";

// Retry only transport/server failures, never missing rows or permission/schema errors.
export async function loadLoginProfile(
  query: () => PromiseLike<ProfileLookup>,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 400)),
): Promise<LoginProfileResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: ProfileLookup;
    try {
      result = await query();
    } catch {
      result = { data: null, error: {}, status: 0 };
    }
    if (!result.error && result.status >= 200 && result.status < 300) {
      return result.data ? "ready" : "missing";
    }
    if (result.status === 401) return "unauthorized";
    if (result.status !== 0 && result.status !== 408 && result.status !== 429 && result.status < 500) {
      return "configuration";
    }
    if (attempt === 0) await wait();
  }
  return "unavailable";
}

export const loginProfileMessages: Record<Exclude<LoginProfileResult, "ready">, string> = {
  missing: "Du bist angemeldet, aber für dein Konto ist kein Profil verfügbar. Bitte kontaktiere den Support, falls das Problem bestehen bleibt.",
  unauthorized: "Deine Sitzung ist nicht mehr gültig. Bitte melde dich erneut an.",
  unavailable: "Du bist angemeldet. Dein Profil konnte gerade nicht geladen werden. Bitte versuche den Profilabruf erneut.",
  configuration: "Du bist angemeldet, aber dein Profil kann derzeit nicht abgerufen werden. Bitte kontaktiere den Support, falls das Problem bestehen bleibt.",
};
