import { defineConfig, devices } from "@playwright/test";

const artifactsDir = process.env.ARTIFACTS_DIR ?? "artifacts";
const isJsonMode = process.env.PW_JSON_REPORT === "1";

/**
 * Proyectos activos: por defecto solo chromium.
 * La matriz nightly usa PW_PROJECTS=chromium,firefox y ejecuta cada browser
 * con --project=<browser>.
 */
const enabledProjects = (process.env.PW_PROJECTS ?? "chromium").split(",");
const allDevices: Record<string, (typeof devices)["Desktop Chrome"]> = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Retries are handled agentically by the pipeline (engine), not by Playwright.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: isJsonMode
    ? [["json"]]
    : [
        ["html", { outputFolder: `${artifactsDir}/playwright-html`, open: "never" }],
        ["allure-playwright", { resultsDir: "allure-results" }],
        ["list"],
      ],
  use: {
    baseURL: process.env.APP_BASE_URL ?? "https://www.saucedemo.com",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    testIdAttribute: "data-test",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: enabledProjects
    .filter((name) => allDevices[name])
    .map((name) => ({ name, use: allDevices[name] })),
});
