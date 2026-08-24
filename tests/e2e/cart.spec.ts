import { expect, test } from "./fixtures";

const STANDARD_USER = process.env.STANDARD_USER ?? "standard_user";
const COMMON_PASSWORD = process.env.COMMON_PASSWORD ?? "secret_sauce";

const BACKPACK = "sauce-labs-backpack";

test.beforeEach(async ({ page, pm }) => {
  await pm.onLoginPage().goto();
  await pm.onLoginPage().login(STANDARD_USER, COMMON_PASSWORD);
  await expect(page).toHaveURL(/inventory\.html/);
});

/**
 * AC-4 (cart): add products to the cart and view them.
 * AC-5 (session): log out from the sidebar menu.
 */
test.describe("Shopping cart", () => {
  test("added product appears in cart with correct badge", async ({ page, pm }) => {
    const products = pm.onProductsPage();

    await products.addItem(BACKPACK);
    await expect(page.getByTestId("shopping-cart-badge")).toHaveText("1");

    await products.goToCart();
    await expect(page).toHaveURL(/cart\.html/);
    await expect(pm.onCartPage().itemNames()).toHaveText(["Sauce Labs Backpack"]);
  });

  test("cart count reflects multiple additions and removals", async ({ page, pm }) => {
    const products = pm.onProductsPage();

    await products.addItem(BACKPACK);
    await products.addItem("sauce-labs-bolt-t-shirt");
    await expect(page.getByTestId("shopping-cart-badge")).toHaveText("2");

    await products.removeItem(BACKPACK);
    await expect(page.getByTestId("shopping-cart-badge")).toHaveText("1");
  });

  test("logout returns user to login page", async ({ page }) => {
    await page.locator("#react-burger-menu-btn").click();
    await page.locator("#logout_sidebar_link").click();
    await expect(page).not.toHaveURL(/inventory/);
  });
});
