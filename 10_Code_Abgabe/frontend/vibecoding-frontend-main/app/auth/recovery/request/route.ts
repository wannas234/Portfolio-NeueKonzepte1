import { NextResponse, type NextRequest } from "next/server";
import { requestHasTrustedOrigin, trustedOrigin } from "@/lib/auth/confirmation";
import { createClient } from "@/lib/supabase/server";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export async function POST(request: NextRequest) {
  let origin: string;
  try {
    origin = trustedOrigin(process.env.AUTH_SITE_URL, request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: "configuration" }, { status: 500, headers });
  }
  if (!requestHasTrustedOrigin(request.headers.get("origin"), origin)) {
    return NextResponse.json({ error: "origin" }, { status: 403, headers });
  }

  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    return NextResponse.json({ error: "request" }, { status: 400, headers });
  }
  if (!email || email.length > 320 || !email.includes("@")) {
    return NextResponse.json({ error: "request" }, { status: 400, headers });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm`,
  });
  if (error) {
    return NextResponse.json(
      { error: "send" },
      { status: error.status === 429 ? 429 : 400, headers }
    );
  }
  return NextResponse.json({ ok: true }, { headers });
}
