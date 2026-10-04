import { baseConfig, chromium } from "./e2e/base.config";

// PUBLIC suite: no backend needed, runs in CI. Unauthenticated pages only; the Supabase values
// below are inert placeholders (no session exists, so no request needs a real project).
const config = baseConfig({ url: "http://127.0.0.1:54321", publishableKey: "e2e-public-placeholder-key" });

const e2eConfig = {
  ...config,
  projects: [{ name: "public", testDir: "./e2e/public", use: chromium }],
};

export default e2eConfig;
