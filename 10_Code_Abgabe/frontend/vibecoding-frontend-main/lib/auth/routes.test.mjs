import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import * as confirmation from "./confirmation.ts";
import * as validation from "./validation.ts";

// Exercise the real handlers with Next.js requests/responses and a stubbed Auth service.
function loadHandler(path, dependencies, siteUrl = "https://app.example") {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  const imports = {
    "next/server": { NextResponse },
    "@/lib/auth/confirmation": confirmation,
    "@/lib/auth/validation": validation,
    ...dependencies,
  };
  new Function("require", "exports", "process", outputText)((name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports, { env: { AUTH_SITE_URL: siteUrl } });
  return exports;
}

function proxy(authenticated, siteUrl) {
  return loadHandler("../supabase/proxy.ts", {
    "./config": { getSupabaseConfig: () => ({ url: "https://supabase.example", publicKey: "public" }) },
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({ auth: {
        getClaims: async () => {
          options.cookies.setAll([{ name: "session", value: "refreshed", options: { path: "/", httpOnly: true } }]);
          return { data: authenticated ? { claims: { sub: "user" } } : null, error: null };
        },
      } }),
    },
  }, siteUrl);
}

test("protected-route redirects preserve the destination and refreshed cookies on the public host", async () => {
  const response = await proxy(false).updateSession(new NextRequest("http://internal:3000/courses/123?tab=notes"));
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://app.example");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("next"), "/courses/123?tab=notes");
  assert.equal(response.cookies.get("session").value, "refreshed");
});

test("authenticated redirects reject external destinations and retain session cookies", async () => {
  const response = await proxy(true).updateSession(new NextRequest("http://internal:3000/login?next=https://evil.example"));
  assert.equal(response.headers.get("location"), "https://app.example/dashboard");
  assert.equal(response.cookies.get("session").value, "refreshed");
});

test("chat login round-trip preserves its destination and refreshed session cookies", async () => {
  const destination = "/assistant?conversation=example";
  const denied = await proxy(false).updateSession(new NextRequest(`http://internal:3000${destination}`));
  const login = new URL(denied.headers.get("location"));
  assert.equal(login.origin, "https://app.example");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), destination);
  const signedIn = await proxy(true).updateSession(new NextRequest(login));
  assert.equal(signedIn.headers.get("location"), `https://app.example${destination}`);
  assert.equal(signedIn.cookies.get("session").value, "refreshed");
  const allowed = await proxy(true).updateSession(new NextRequest(`https://app.example${destination}`));
  assert.equal(allowed.headers.get("location"), null);
  assert.equal(allowed.cookies.get("session").value, "refreshed");
});

test("confirmation redirect strips the token and sets a secure /auth cookie behind a proxy", async () => {
  const token = "a".repeat(64);
  const response = await proxy(false).updateSession(new NextRequest(`http://internal:3000/auth/confirm?token_hash=${token}&type=email`));
  assert.equal(response.headers.get("location"), "https://app.example/auth/confirm");
  const cookie = response.cookies.get(confirmation.PENDING_CONFIRMATION_COOKIE);
  assert.equal(cookie.path, "/auth");
  assert.equal(cookie.secure, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("PKCE success and failure both redirect to the configured public host", async () => {
  for (const error of [null, { message: "expired" }]) {
    let exchanges = 0;
    const handler = loadHandler("../../app/auth/callback/route.ts", {
      "@/lib/supabase/server": { createClient: async () => ({ auth: {
        exchangeCodeForSession: async (code) => {
          assert.equal(code, "test-code");
          exchanges++;
          return { error };
        },
      } }) },
    });
    const response = await handler.GET(new NextRequest("http://internal:3000/auth/callback?code=test-code&next=/profile"));
    assert.equal(response.headers.get("location"), error
      ? "https://app.example/login?authError=confirmation"
      : "https://app.example/profile");
    assert.equal(exchanges, 1);
  }
});

test("invalid configured origins fail closed instead of redirecting", async () => {
  const response = await proxy(false, "ftp://app.example").updateSession(new NextRequest("http://internal:3000/dashboard"));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("location"), null);
});
