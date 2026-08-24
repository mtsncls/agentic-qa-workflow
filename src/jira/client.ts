import { textToAdf } from "./adf";
import type {
  AttachInput,
  CreateBugInput,
  JiraIssue,
  JiraTransition,
} from "./types";
import { config } from "../config/env";

export interface JiraApi {
  myself(): Promise<{ displayName: string; emailAddress?: string }>;
  getIssue(key: string): Promise<JiraIssue>;
  searchIssues(jql: string, fields?: string): Promise<JiraIssue[]>;
  addComment(issueKey: string, bodyText: string): Promise<void>;
  createBug(input: CreateBugInput): Promise<string>;
  attachFiles(issueKey: string, files: AttachInput[]): Promise<void>;
  getTransitions(issueKey: string): Promise<JiraTransition[]>;
  transitionByName(issueKey: string, nameSubstring: string): Promise<boolean>;
  linkIssues(linkTypeName: string, inwardKey: string, outwardKey: string): Promise<void>;
  issueUrl(key: string): string;
}

const ISSUE_FIELDS = "summary,description,status,issuetype,priority,labels";

export class RestJiraClient implements JiraApi {
  private readonly auth: string;

  constructor(
    private readonly baseUrl = config.JIRA_BASE_URL.replace(/\/$/, ""),
    email = config.JIRA_EMAIL,
    token = config.JIRA_API_TOKEN
  ) {
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  issueUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/rest/api/3${path}`, {
      ...init,
      headers: {
        Authorization: this.auth,
        Accept: "application/json",
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira ${res.status} ${res.statusText} on ${path}: ${text.slice(0, 400)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async myself(): Promise<{ displayName: string; emailAddress?: string }> {
    return this.req("/myself");
  }

  async getIssue(key: string): Promise<JiraIssue> {
    return this.req(`/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`);
  }

  async searchIssues(jql: string, fields = ISSUE_FIELDS): Promise<JiraIssue[]> {
    const data = await this.req<{ issues: JiraIssue[] }>("/search/jql", {
      method: "POST",
      body: JSON.stringify({ jql, fields, maxResults: 50 }),
    });
    return data.issues ?? [];
  }

  async addComment(issueKey: string, bodyText: string): Promise<void> {
    await this.req(`/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: textToAdf(bodyText) }),
    });
  }

  async createBug(input: CreateBugInput): Promise<string> {
    const fields: Record<string, unknown> = {
      project: { key: config.JIRA_PROJECT_KEY },
      issuetype: { name: "Bug" },
      summary: input.summary,
      description: textToAdf(input.descriptionText),
      labels: input.labels,
    };
    if (input.priority) fields.priority = { name: input.priority };

    const data = await this.req<{ key: string }>("/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    return data.key;
  }

  async attachFiles(issueKey: string, files: AttachInput[]): Promise<void> {
    if (!files.length) return;
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const form = new FormData();
    for (const f of files) {
      const buf = await readFile(f.path);
      form.append("file", new Blob([new Uint8Array(buf)]), f.filename || path.basename(f.path));
    }

    await this.req(`/issue/${encodeURIComponent(issueKey)}/attachments`, {
      method: "POST",
      headers: { "X-Atlassian-Token": "no-check" },
      body: form,
    });
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const data = await this.req<{ transitions: JiraTransition[] }>(
      `/issue/${encodeURIComponent(issueKey)}/transitions`
    );
    return data.transitions ?? [];
  }

  async transitionByName(issueKey: string, nameSubstring: string): Promise<boolean> {
    if (!nameSubstring.trim()) return false;
    const target = nameSubstring.toLowerCase();
    const transitions = await this.getTransitions(issueKey);
    const match = transitions.find((t) => t.name.toLowerCase().includes(target));
    if (!match) return false;
    await this.req(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    return true;
  }

  async linkIssues(linkTypeName: string, inwardKey: string, outwardKey: string): Promise<void> {
    await this.req("/issueLink", {
      method: "POST",
      body: JSON.stringify({
        type: { name: linkTypeName },
        inwardIssue: { key: inwardKey },
        outwardIssue: { key: outwardKey },
      }),
    });
  }
}
