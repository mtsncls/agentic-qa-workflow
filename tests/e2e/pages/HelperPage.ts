import type { Page } from "@playwright/test";

export class HelperPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(path = ""): Promise<void> {
    await this.page.goto(path);
  }

  async goToCart(): Promise<void> {
    await this.page.getByTestId("shopping-cart-link").click();
  }

  async getCartCount(): Promise<number> {
    const cartBadge = this.page.getByTestId("shopping-cart-badge");
    const isVisible = await cartBadge.isVisible();
    if (!isVisible) return 0;
    return parseInt((await cartBadge.innerText()).trim(), 10) || 0;
  }
}
