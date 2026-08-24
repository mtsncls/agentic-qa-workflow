/** Nodo de Atlassian Document Format (ADF), versión mínima para este proyecto. */
export interface AdfNode {
  type: string;
  version?: number;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
}

export interface JiraTransition {
  id: string;
  name: string;
}

export interface JiraIssue {
  key: string;
  id?: string;
  fields: {
    summary: string;
    description?: AdfNode | null;
    status?: { name: string };
    issuetype?: { name: string };
    priority?: { name: string };
    labels?: string[];
    [customField: string]: unknown;
  };
}

export interface CreateBugInput {
  summary: string;
  descriptionText: string;
  labels: string[];
  priority?: string;
}

export interface AttachInput {
  filename: string;
  path: string;
}
