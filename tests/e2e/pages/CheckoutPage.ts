import type { Page } from "@playwright/test";
import { HelperPage } from "./HelperPage";

export interface CheckoutData {
  firstName: string;
  lastName: string;
  postalCode: string;
}

export class CheckoutPage extends HelperPage {
  constructor(page: Page) {
    super(page);
  }

  async fillCheckoutForm(data: CheckoutData): Promise<void> {
    await this.page.getByTestId("firstName").fill(data.firstName);
    await this.page.getByTestId("lastName").fill(data.lastName);
    await this.page.getByTestId("postalCode").fill(data.postalCode);
    await this.page.getByTestId("continue").click();
  }

  async completeOrder(): Promise<string> {
    await this.page.getByTestId("finish").click();
    return (await this.page.getByTestId("complete-header").innerText()).trim();
  }
}
