import { textToAdf } from "./adf";
import type { JiraApi } from "./client";
import type {
  AttachInput,
  CreateBugInput,
  JiraIssue,
  JiraTransition,
} from "./types";
import { config } from "../config/env";

const STORY_QA_101: JiraIssue = {
  key: "QA-101",
  id: "10001",
  fields: {
    summary: "User login for the store",
    issuetype: { name: "Story" },
    status: { name: "In QA" },
    priority: { name: "High" },
    labels: ["frontend"],
    description: textToAdf(
      [
        "As a customer I want to log in so I can access the catalog.",
        "",
        "Acceptance Criteria:",
        "- Given a valid user, when they sign in with correct credentials, then they are redirected to the inventory page.",
        "- Given a locked-out user, when they try to sign in, then they see the error message 'user has been locked out'.",
        "- Given invalid credentials, when the login form is submitted, then an error message is shown and the inventory is not accessible.",
        "- The user can log out from the sidebar menu.",
      ].join("\n")
    ),
  },
};

/**
 * In-memory simulated Jira (MOCK_JIRA=1): allows exercising the whole pipeline
 * without credentials or network. Keeps state during the process lifetime.
 */
export class MockJiraClient implements JiraApi {
  private issues = new Map<string, JiraIssue>([["QA-101", structuredClone(STORY_QA_101)]]);
  private bugSeq = 200;

  issueUrl(key: string): string {
    return `mock://jira/browse/${key}`;
  }

  async myself(): Promise<{ displayName: string; emailAddress?: string }> {
    return { displayName: "Mock Jira User", emailAddress: "mock@jira.local" };
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const issue = this.issues.get(key.toUpperCase());
    if (!issue) throw new Error(`[mock] Issue ${key} does not exist (available: ${[...this.issues.keys()].join(", ")})`);
    return structuredClone(issue);
  }

  async searchIssues(jql: string): Promise<JiraIssue[]> {
    return [...this.issues.values()].filter((i) => jql.includes(i.key));
  }

  async addComment(issueKey: string, bodyText: string): Promise<void> {
    const issue = await this.getIssue(issueKey);
    console.log(`\n[mock-jira] 💬 comment on ${issue.key}:\n${bodyText.slice(0, 600)}${bodyText.length > 600 ? "…" : ""}\n`);
  }

  async createBug(input: CreateBugInput): Promise<string> {
    const key = `${config.JIRA_PROJECT_KEY}-${++this.bugSeq}`;
    this.issues.set(key, {
      key,
      id: String(10000 + this.bugSeq),
      fields: {
        summary: input.summary,
        issuetype: { name: "Bug" },
        status: { name: "Open" },
        priority: { name: input.priority ?? "Medium" },
        labels: input.labels,
        description: textToAdf(input.descriptionText),
      },
    });
    console.log(`\n[mock-jira] 🐛 bug created ${key}: ${input.summary}\n`);
    return key;
  }

  async attachFiles(issueKey: string, files: AttachInput[]): Promise<void> {
    const issue = await this.getIssue(issueKey);
    console.log(`[mock-jira] 📎 attachments on ${issue.key}: ${files.map((f) => f.filename).join(", ") || "(none)"}`);
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    await this.getIssue(issueKey);
    return [
      { id: "31", name: "Done" },
      { id: "21", name: "In Progress" },
      { id: "41", name: "Blocked" },
    ];
  }

  async transitionByName(issueKey: string, nameSubstring: string): Promise<boolean> {
    const available = await this.getTransitions(issueKey);
    const match = available.find((t) => t.name.toLowerCase().includes(nameSubstring.toLowerCase()));
    if (!match) return false;
    const issue = await this.getIssue(issueKey);
    issue.fields.status = { name: match.name };
    this.issues.set(issue.key, issue);
    console.log(`[mock-jira] 🔁 ${issue.key} -> ${match.name}`);
    return true;
  }

  async linkIssues(linkTypeName: string, inwardKey: string, outwardKey: string): Promise<void> {
    console.log(`[mock-jira] 🔗 link ${linkTypeName}: ${inwardKey} <-> ${outwardKey}`);
  }
}
