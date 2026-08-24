import type { Page } from "@playwright/test";
import { LoginPage } from "./LoginPage";
import { ProductsPage } from "./ProductsPage";
import { CartPage } from "./CartPage";
import { CheckoutPage } from "./CheckoutPage";

/** Acceso centralizado a los Page Objects de una misma página. */
export class PageManager {
  private readonly loginPage: LoginPage;
  private readonly productsPage: ProductsPage;
  private readonly cartPage: CartPage;
  private readonly checkoutPage: CheckoutPage;

  constructor(page: Page) {
    this.loginPage = new LoginPage(page);
    this.productsPage = new ProductsPage(page);
    this.cartPage = new CartPage(page);
    this.checkoutPage = new CheckoutPage(page);
  }

  onLoginPage(): LoginPage {
    return this.loginPage;
  }

  onProductsPage(): ProductsPage {
    return this.productsPage;
  }

  onCartPage(): CartPage {
    return this.cartPage;
  }

  onCheckoutPage(): CheckoutPage {
    return this.checkoutPage;
  }
}
