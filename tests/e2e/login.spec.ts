import { expect, test } from "./fixtures";

const STANDARD_USER = process.env.STANDARD_USER ?? "standard_user";
const COMMON_PASSWORD = process.env.COMMON_PASSWORD ?? "secret_sauce";

/**
 * AC-1: usuario válido inicia sesión y es redirigido al inventario.
 * AC-2: usuario bloqueado ve mensaje de error.
 * AC-3: credenciales inválidas muestran error sin acceder al inventario.
 */
test.describe("Authentication", () => {
  test("successful login redirects to inventory", async ({ page, pm }) => {
    await pm.onLoginPage().goto();
    await pm.onLoginPage().login(STANDARD_USER, COMMON_PASSWORD);

    await expect(page).toHaveURL(/inventory\.html/);
    await expect(page.getByTestId("primary-header")).toBeVisible();
  });

  test("locked out user sees error message", async ({ page, pm }) => {
    await pm.onLoginPage().goto();
    await pm.onLoginPage().login("locked_out_user", COMMON_PASSWORD);

    await pm.onLoginPage().expectLoginError(/locked out/i);
    await expect(page).not.toHaveURL(/inventory/);
  });

  test("invalid credentials show error and stay on login", async ({ page, pm }) => {
    await pm.onLoginPage().goto();
    await pm.onLoginPage().login(STANDARD_USER, "wrong_password");

    const message = await pm.onLoginPage().getErrorMessage();
    expect(message).toContain("do not match any user in this service");
    await expect(page).not.toHaveURL(/inventory/);
  });
});
