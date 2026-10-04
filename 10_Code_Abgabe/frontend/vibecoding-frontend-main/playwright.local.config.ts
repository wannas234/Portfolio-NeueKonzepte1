import { baseConfig, chromium } from "./e2e/base.config";

// LOCAL suite: authenticated smoke tests against a LOCAL Supabase stack with the backend's seed
// data (see docs/e2e.md). It refuses to run against anything but a loopback Supabase so the
// documented seed credentials can never be used against staging or production.
const url = process.env.E2E_SUPABASE_URL;
const publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("Set E2E_SUPABASE_URL and E2E_SUPABASE_PUBLISHABLE_KEY (local Supabase, see docs/e2e.md).");
}
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("The local E2E suite only runs against a loopback Supabase (127.0.0.1 / localhost).");
}

const config = baseConfig({ url, publishableKey });
const authFile = "e2e/.auth/user.json";

const e2eConfig = {
  ...config,
  projects: [
    { name: "setup", testDir: "./e2e/local", testMatch: /auth\.setup\.ts/, use: chromium },
    {
      name: "authenticated",
      testDir: "./e2e/local",
      testMatch: /(flow|responsive|quiz)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...chromium, storageState: authFile },
    },
    // Own logins: the logout test must not invalidate the session the other tests share.
    { name: "session", testDir: "./e2e/local", testMatch: /session\.spec\.ts/, use: chromium },
  ],
};

export default e2eConfig;
