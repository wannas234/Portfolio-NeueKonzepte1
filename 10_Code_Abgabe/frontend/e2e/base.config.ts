import { defineConfig, devices } from "@playwright/test";

// Dedicated port so the suites never attach to a developer's own `next dev` on 3000.
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

type SupabaseEnv = { url: string; publishableKey: string };

/**
 * Shared Playwright settings. The app is always started with an explicit Supabase
 * environment, so a developer's `.env.local` (which may point at staging) is never used.
 */
export function baseConfig(supabase: SupabaseEnv) {
  const ci = Boolean(process.env.CI);
  return defineConfig({
    fullyParallel: false,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    workers: 1,
    reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    outputDir: "test-results",
    use: {
      baseURL: E2E_BASE_URL,
      actionTimeout: 15_000,
      navigationTimeout: 45_000,
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      locale: "de-DE",
    },
    webServer: {
      command: `npm run dev -- --port ${E2E_PORT} --hostname 127.0.0.1`,
      url: E2E_BASE_URL,
      reuseExistingServer: !ci,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: supabase.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
        AUTH_SITE_URL: E2E_BASE_URL,
      },
    },
    projects: [],
  });
}

export const chromium = devices["Desktop Chrome"];
