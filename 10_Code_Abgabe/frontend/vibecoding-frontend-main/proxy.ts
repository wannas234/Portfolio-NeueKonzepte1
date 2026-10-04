import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/login",
    "/register",
    "/auth/confirm",
    "/auth/reset-password",
    "/dashboard/:path*",
    "/assistant/:path*",
    "/courses/:path*",
    "/calendar/:path*",
    "/documents/:path*",
    "/flashcards/:path*",
    "/summaries/:path*",
    "/grades/:path*",
    "/profile/:path*",
    "/billing/:path*",
  ],
};
