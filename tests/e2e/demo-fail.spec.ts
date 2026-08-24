import { test, expect } from "@playwright/test";

/**
 * Test de demostración para simular una REGRESIÓN DE PRODUCTO real.
 * Con DEMO_FAIL=1 el test falla a propósito, lo que dispara el flujo completo:
 * análisis del agente → decisión → creación automática de bug en Jira.
 */
const SIMULATE_REGRESSION = /^(1|true|yes)$/i.test(process.env.DEMO_FAIL ?? "");

test("checkout overview shows order total", async ({ page }) => {
  test.skip(!SIMULATE_REGRESSION, "Set DEMO_FAIL=1 para simular una regresión de producto");

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
  // ⚠️ Expectativa deliberadamente incorrecta: simula un bug de producto
  // (el total mostrado nunca será $0.00). El pipeline debe detectarlo,
  // clasificarlo como product_bug y crear el ticket en Jira con evidencia.
  await expect(page.getByTestId("total-label")).toHaveText("$0.00");
});
