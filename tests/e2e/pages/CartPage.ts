import type { Page } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { HelperPage } from "./HelperPage";

export class CartPage extends HelperPage {
  constructor(page: Page) {
    super(page);
  }

  async goToCheckout(): Promise<void> {
    await this.page.getByTestId("checkout").click();
  }

  itemNames(): Locator {
    return this.page.getByTestId("inventory-item-name");
  }
}
