import { NextResponse, type NextRequest } from "next/server";
import { trustedOrigin } from "@/lib/auth/confirmation";
import { safeAuthRedirect } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  let origin: string;
  try {
    origin = trustedOrigin(process.env.AUTH_SITE_URL, request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: "configuration" }, { status: 500 });
  }
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeAuthRedirect(request.nextUrl.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?authError=confirmation", origin));

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?authError=confirmation", origin));
    return NextResponse.redirect(new URL(destination, origin));
  } catch {
    return NextResponse.redirect(new URL("/login?authError=configuration", origin));
  }
}
