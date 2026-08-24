import { config } from "../config/env";
import { RestJiraClient, type JiraApi } from "./client";
import { MockJiraClient } from "./mock";

let instance: JiraApi | undefined;

/** Fábrica singleton: REST real o mock en memoria según MOCK_JIRA. */
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
