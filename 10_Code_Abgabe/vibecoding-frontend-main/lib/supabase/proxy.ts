import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, safeAuthRedirect } from "@/lib/auth/validation";
import {
  createPendingConfirmation,
  trustedOrigin,
  parseEmailOtpType,
  PENDING_CONFIRMATION_COOKIE,
} from "@/lib/auth/confirmation";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  let origin: string;
  try {
    origin = trustedOrigin(process.env.AUTH_SITE_URL, request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: "configuration" }, { status: 500 });
  }
  const publicUrl = new URL(origin);
  publicUrl.pathname = pathname;
  publicUrl.search = request.nextUrl.search;

  if (pathname === "/auth/confirm") {
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const type = parseEmailOtpType(request.nextUrl.searchParams.get("type"));

    if (tokenHash || request.nextUrl.searchParams.has("type")) {
      const pending = type && tokenHash ? createPendingConfirmation(tokenHash, type) : null;
      const cleanUrl = new URL(publicUrl);
      cleanUrl.search = "";

      if (!pending) {
        cleanUrl.pathname = "/login";
        cleanUrl.searchParams.set("authError", "confirmation");
        return NextResponse.redirect(cleanUrl);
      }

      const redirect = NextResponse.redirect(cleanUrl);
      redirect.cookies.set(PENDING_CONFIRMATION_COOKIE, pending, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(origin).protocol === "https:",
        path: "/auth",
        maxAge: 10 * 60,
      });
      redirect.headers.set("cache-control", "no-store");
      redirect.headers.set("referrer-policy", "no-referrer");
      return redirect;
    }
  }

  let config;

  try {
    config = getSupabaseConfig();
  } catch {
    if (isProtectedPath(pathname)) {
      const login = new URL(publicUrl);
      login.pathname = "/login";
      login.search = "";
      login.searchParams.set("authError", "configuration");
      return NextResponse.redirect(login);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(config.url, config.publicKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && Boolean(data?.claims?.sub);

  if (!authenticated && isProtectedPath(pathname)) {
    const login = new URL(publicUrl);
    const intended = `${pathname}${request.nextUrl.search}`;
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", safeAuthRedirect(intended));
    return redirectWithCookies(login, response);
  }

  if (authenticated && (pathname === "/login" || pathname === "/register")) {
    const destination = safeAuthRedirect(request.nextUrl.searchParams.get("next"));
    return redirectWithCookies(new URL(destination, origin), response);
  }

  return response;
}
