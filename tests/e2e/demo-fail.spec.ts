import { test, expect } from "@playwright/test";

/**
 * Demonstration test simulating a real PRODUCT REGRESSION.
 * With DEMO_FAIL=1 the test fails on purpose, triggering the full flow:
 * agent analysis → decision → automatic bug creation in Jira.
 */
const SIMULATE_REGRESSION = /^(1|true|yes)$/i.test(process.env.DEMO_FAIL ?? "");

test("checkout overview shows order total", { tag: ["@regression", "@checkout"] }, async ({ page }) => {
  test.skip(!SIMULATE_REGRESSION, "Set DEMO_FAIL=1 to simulate a product regression");

  await page.goto("/");
  await page.getByTestId("username").fill("standard_user");
  await page.getByTestId("password").fill("secret_sauce");
  await page.getByTestId("login-button").click();
  await expect(page).toHaveURL(/inventory\.html/);

  await page.getByTestId("add-to-cart-sauce-labs-backpack").click();
  await page.getByTestId("shopping-cart-link").click();
  await page.getByTestId("checkout").click();

  await page.getByTestId("firstName").fill("Ada");
  await page.getByTestId("lastName").fill("Lovelace");
  await page.getByTestId("postalCode").fill("12345");
  await page.getByTestId("continue").click();

  await expect(page).toHaveURL(/checkout-step-two\.html/);
  // ⚠️ Deliberately wrong expectation: simulates a product bug
  // (the displayed total will never be $0.00). The pipeline must detect it,
  // classify it as product_bug and create the Jira ticket with evidence.
  await expect(page.getByTestId("total-label")).toHaveText("$0.00");
});
