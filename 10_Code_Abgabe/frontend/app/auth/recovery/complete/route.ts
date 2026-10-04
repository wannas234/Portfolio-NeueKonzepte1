import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  RECOVERY_SESSION_COOKIE,
  requestHasTrustedOrigin,
  trustedOrigin,
  expiredAuthCookie,
} from "@/lib/auth/confirmation";

export async function POST(request: NextRequest) {
  let origin: string;
  try {
    origin = trustedOrigin(process.env.AUTH_SITE_URL, request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: "configuration" }, { status: 500 });
  }
  if (!requestHasTrustedOrigin(request.headers.get("origin"), origin)) {
    return NextResponse.json({ error: "origin" }, { status: 403 });
  }
  (await cookies()).set(RECOVERY_SESSION_COOKIE, "", expiredAuthCookie);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
