import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  parsePendingConfirmation,
  PENDING_CONFIRMATION_COOKIE,
  RECOVERY_SESSION_COOKIE,
  requestHasTrustedOrigin,
  trustedOrigin,
  expiredAuthCookie,
} from "@/lib/auth/confirmation";
import { EMAIL_CHANGED_DESTINATION, emailChangeOutcome } from "@/lib/auth/emailChange";
import { createClient } from "@/lib/supabase/server";

const responseHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

export async function POST(request: NextRequest) {
  let origin: string;
  try {
    origin = trustedOrigin(process.env.AUTH_SITE_URL, request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: "configuration" }, { status: 500, headers: responseHeaders });
  }
  if (!requestHasTrustedOrigin(request.headers.get("origin"), origin)) {
    return NextResponse.json({ error: "origin" }, { status: 403, headers: responseHeaders });
  }

  const cookieStore = await cookies();
  const pending = parsePendingConfirmation(cookieStore.get(PENDING_CONFIRMATION_COOKIE)?.value);
  if (!pending) {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: responseHeaders });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: pending.tokenHash,
    type: pending.type,
  });
  cookieStore.set(PENDING_CONFIRMATION_COOKIE, "", expiredAuthCookie);

  if (error) {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: responseHeaders });
  }

  if (pending.type === "recovery") {
    cookieStore.set(RECOVERY_SESSION_COOKIE, "active", {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(origin).protocol === "https:",
      path: "/auth",
      maxAge: 10 * 60,
    });
  }

  if (pending.type === "email_change") {
    // Zwei Links, zwei Bestätigungen: nach dem ersten gibt es noch keine geänderte Adresse
    // und kein Ziel — die Seite sagt dann, dass der zweite Link noch fehlt.
    return NextResponse.json(
      emailChangeOutcome(data.user) === "changed"
        ? { destination: EMAIL_CHANGED_DESTINATION }
        : { emailChange: "pending" },
      { headers: responseHeaders }
    );
  }

  return NextResponse.json(
    { destination: pending.type === "recovery" ? "/auth/reset-password" : "/dashboard" },
    { headers: responseHeaders }
  );
}
