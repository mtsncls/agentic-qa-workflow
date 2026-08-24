import { test as base, expect } from "@playwright/test";
import { PageManager } from "./pages/PageManager";

/**
 * Fixtures compartidas del suite E2E.
 * Uso: `import { test, expect } from "../fixtures"` (o relativo según profundidad).
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
