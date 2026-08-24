import { config } from "../config/env";
import { RestJiraClient, type JiraApi } from "./client";
import { MockJiraClient } from "./mock";

let instance: JiraApi | undefined;

/** Singleton factory: real REST client or in-memory mock depending on MOCK_JIRA. */
export function getJira(): JiraApi {
  if (!instance) {
    instance = config.MOCK_JIRA ? new MockJiraClient() : new RestJiraClient();
  }
  return instance;
}

export type { JiraApi } from "./client";
export { adfToText, textToAdf } from "./adf";
export * from "./acceptance";
export * from "./reporter";
