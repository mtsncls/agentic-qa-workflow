import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { HelperPage } from "./HelperPage";

export class LoginPage extends HelperPage {
  constructor(page: Page) {
    super(page);
  }

  async login(user: string, pass: string): Promise<void> {
    await this.page.getByTestId("username").fill(user);
    await this.page.getByTestId("password").fill(pass);
    await this.page.getByTestId("login-button").click();
  }

  async getErrorMessage(): Promise<string> {
    const errorLocator = this.page.getByTestId("error");
    await errorLocator.waitFor({ state: "visible" });
    return errorLocator.innerText();
  }

  async expectLoginError(fragment: RegExp | string): Promise<void> {
    await expect(this.page.getByTestId("error")).toContainText(fragment);
  }
}
