import type { Page } from "@playwright/test";
import { HelperPage } from "./HelperPage";

export class ProductsPage extends HelperPage {
  constructor(page: Page) {
    super(page);
  }

  /** Adds to the cart the product whose data-test is `add-to-cart-<slug>`. */
  async addItem(slug: string): Promise<void> {
    await this.page.getByTestId(`add-to-cart-${slug}`).click();
  }

  async removeItem(slug: string): Promise<void> {
    await this.page.getByTestId(`remove-${slug}`).click();
  }

  async addFirstItem(): Promise<void> {
    await this.page.getByRole("button", { name: "Add to cart" }).first().click();
  }
}
