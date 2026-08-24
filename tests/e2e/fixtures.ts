import { test as base, expect } from "@playwright/test";
import { PageManager } from "./pages/PageManager";

/**
 * Shared E2E suite fixtures.
 * Usage: `import { test, expect } from "./fixtures"`.
 */
type Fixtures = {
  pm: PageManager;
};

export const test = base.extend<Fixtures>({
  pm: async ({ page }, use) => {
    await use(new PageManager(page));
  },
});

export { expect };
