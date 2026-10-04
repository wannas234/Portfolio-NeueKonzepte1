import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_SECURITY_POLICY, securityHeaders } from "./securityHeaders.ts";
import { resolveSameOriginUrl } from "./safeUrl.ts";
import { safeAuthRedirect } from "./auth/validation.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const header = (name) => securityHeaders.find((entry) => entry.key === name)?.value;

test("global security headers are defined", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.ok(/camera=\(\)/.test(header("Permissions-Policy")) && /microphone=\(\)/.test(header("Permissions-Policy")));
  assert.equal(header("Content-Security-Policy"), CONTENT_SECURITY_POLICY);
});

test("the CSP only contains directives that cannot break Next.js or Supabase", () => {
  const directives = CONTENT_SECURITY_POLICY.split(";").map((part) => part.trim().split(" ")[0]);
  assert.deepEqual(directives.sort(), ["base-uri", "form-action", "frame-ancestors", "object-src"]);
  assert.ok(CONTENT_SECURITY_POLICY.includes("frame-ancestors 'none'"));
  // A script/default policy must only arrive together with nonce support, never as a guess.
  assert.ok(!/script-src|default-src|connect-src|unsafe-eval|unsafe-inline/.test(CONTENT_SECURITY_POLICY));
});

test("next.config applies the headers to every path and hides the framework header", async () => {
  const config = await readFile(join(root, "next.config.ts"), "utf8");
  assert.ok(config.includes("poweredByHeader: false"));
  assert.ok(/source: "\/:path\*", headers: securityHeaders/.test(config));
});

test("response-derived file URLs must stay on the Supabase origin", () => {
  const base = "https://project.supabase.co";
  assert.equal(resolveSameOriginUrl("/storage/v1/object/sign/x?token=t", base), "https://project.supabase.co/storage/v1/object/sign/x?token=t");
  for (const bad of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "data:text/html,x", "http://project.supabase.co.evil.example/x", "", null, undefined, 42]) {
    assert.throws(() => resolveSameOriginUrl(bad, base), /INVALID_URL/, String(bad));
  }
});

test("the real backend shape (pathname + search of a signed URL) is accepted in every environment and stays intact", () => {
  // files function: json({ path: signed.pathname + signed.search }) – always relative, origin stripped.
  const signed = "/storage/v1/object/sign/learning-files/u/c/f.pdf?token=eyJhbGciOi.J9.sig-_x&download=Vorlesung%201%20%C3%9Cbung.pdf";
  for (const base of ["https://abcdefgh.supabase.co", "https://abcdefgh.supabase.co/", "http://127.0.0.1:54321", "http://localhost:54321"]) {
    const url = resolveSameOriginUrl(signed, base);
    assert.equal(url, new URL(signed, base).href, base);
    assert.equal(new URL(url).origin, new URL(base).origin, base);
    assert.equal(new URL(url).search, "?token=eyJhbGciOi.J9.sig-_x&download=Vorlesung%201%20%C3%9Cbung.pdf", `${base}: query preserved`);
  }
  // Without the download parameter (inline preview) the token alone must survive too.
  assert.equal(resolveSameOriginUrl("/storage/v1/object/sign/b/p.txt?token=t", "http://localhost:54321"), "http://localhost:54321/storage/v1/object/sign/b/p.txt?token=t");
});

test("an absolute URL is accepted only on exactly the configured origin, including port", () => {
  assert.equal(resolveSameOriginUrl("http://localhost:54321/storage/v1/x?token=t", "http://localhost:54321"), "http://localhost:54321/storage/v1/x?token=t");
  assert.equal(resolveSameOriginUrl("https://abcdefgh.supabase.co/storage/v1/x?token=t", "https://abcdefgh.supabase.co"), "https://abcdefgh.supabase.co/storage/v1/x?token=t");
  for (const bad of ["http://localhost:54322/x", "http://127.0.0.1:54321/x", "https://abcdefgh.supabase.co.evil.example/x", "https://evilabcdefgh.supabase.co/x", "http://abcdefgh.supabase.co/x", "https://abcdefgh.supabase.co@evil.example/x"]) {
    const base = bad.startsWith("http://localhost") || bad.includes("127.0.0.1") ? "http://localhost:54321" : "https://abcdefgh.supabase.co";
    assert.throws(() => resolveSameOriginUrl(bad, base), /INVALID_URL/, bad);
  }
});

test("protocol-relative URLs are judged by the host they resolve to", () => {
  const base = "https://abcdefgh.supabase.co";
  assert.equal(resolveSameOriginUrl("//abcdefgh.supabase.co/x?token=t", base), "https://abcdefgh.supabase.co/x?token=t");
  for (const bad of ["//evil.example/x", "//abcdefgh.supabase.co.evil.example/x", "///evil.example/x"]) assert.throws(() => resolveSameOriginUrl(bad, base), /INVALID_URL/, bad);
});

test("auth redirects never leave the app or reach unprotected targets", () => {
  for (const bad of ["//evil.example", "/\\evil.example", "\\\\evil.example", "https://evil.example", "javascript:alert(1)", "/login", "/dashboard/../../evil", "/%2F%2Fevil.example", "", null, undefined]) {
    const result = safeAuthRedirect(bad);
    assert.ok(result.startsWith("/") && !result.startsWith("//") && !result.includes("\\"), `${bad} -> ${result}`);
  }
  assert.equal(safeAuthRedirect("/courses/abc?tab=1"), "/courses/abc?tab=1");
});

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

// app/layout.tsx inlines the theme script (lib/theme.ts `themeInitScript`) in
// <head> so the stored theme is on <html> before first paint. It is a fixed,
// self-contained string with no interpolated user input, and there is no way to
// set the attribute pre-paint without an inline script. The exemption covers
// only that one file and only the markup sinks — the service-role check below
// still applies to it.
const inlineScriptAllowed = new Set(["app/layout.tsx"]);

test("no raw HTML injection, dynamic code execution or service-role usage in application code", async () => {
  for (const file of [...await sourceFiles(join(root, "app")), ...await sourceFiles(join(root, "components")), ...await sourceFiles(join(root, "lib"))]) {
    if (file.endsWith("database.types.ts")) continue;
    const relative = file.slice(root.length).replaceAll("\\", "/");
    const source = await readFile(file, "utf8");
    if (!inlineScriptAllowed.has(relative)) {
      assert.ok(!/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(source), file);
    }
    assert.ok(!/service_role|SERVICE_ROLE/i.test(source), file);
  }
});

test("only the two public Supabase variables are exposed to the browser", async () => {
  const names = new Set();
  for (const file of [...await sourceFiles(join(root, "app")), ...await sourceFiles(join(root, "components")), ...await sourceFiles(join(root, "lib"))]) {
    for (const match of (await readFile(file, "utf8")).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)) names.add(match[0]);
  }
  assert.deepEqual([...names].sort(), ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
});

test("browser storage holds no credentials, tokens or passwords", async () => {
  const allowed = new Map([
    ["components/Sidebar.tsx", ["lernapp-sidebar"]],
    ["components/DashboardFrame.tsx", ["sidebarStorageKey"]],
    ["components/assistant/AssistantWorkspace.tsx", ["storagePrefix", "key"]],
    // Stores only the theme preference ("light" / "dark"), never user data.
    ["lib/theme.ts", ["THEME_STORAGE_KEY"]],
  ]);
  for (const file of [...await sourceFiles(join(root, "app")), ...await sourceFiles(join(root, "components")), ...await sourceFiles(join(root, "lib"))]) {
    const relative = file.slice(root.length).replaceAll("\\", "/");
    const source = await readFile(file, "utf8");
    if (!/localStorage|sessionStorage/.test(source) || /\.test\./.test(relative)) continue;
    assert.ok(allowed.has(relative), `unexpected storage use in ${relative}`);
    assert.ok(!/access_token|refresh_token|password|token_hash|recovery/i.test(source.match(/(?:local|session)Storage[^\n]*/g)?.join("\n") ?? ""), relative);
  }
});
