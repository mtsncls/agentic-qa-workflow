import { expect, test } from "./fixtures";

const STANDARD_USER = process.env.STANDARD_USER ?? "standard_user";
const COMMON_PASSWORD = process.env.COMMON_PASSWORD ?? "secret_sauce";

/** Full purchase flow: cart → checkout → confirmation. */
test.describe("Checkout", { tag: ["@checkout", "@payment", "@revenue", "@critical"] }, () => {
  test("complete checkout flow shows confirmation", async ({ page, pm }) => {
    await pm.onLoginPage().goto();
    await pm.onLoginPage().login(STANDARD_USER, COMMON_PASSWORD);
    await expect(page).toHaveURL(/inventory\.html/);

    const products = pm.onProductsPage();
    await products.addFirstItem();
    await products.goToCart();

    const cart = pm.onCartPage();
    await cart.goToCheckout();

    await pm.onCheckoutPage().fillCheckoutForm({
      firstName: "Alice",
      lastName: "Smith",
      postalCode: "90210",
    });
    await expect(page).toHaveURL(/checkout-step-two\.html/);

    const message = await pm.onCheckoutPage().completeOrder();
    expect(message).toBe("Thank you for your order!");
  });
});
