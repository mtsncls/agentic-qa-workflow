import "dotenv/config";
import { z } from "zod";

const boolish = (def: "0" | "1") =>
  z
    .string()
    .default(def)
    .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const schema = z.object({
  APP_BASE_URL: z.string().default("https://www.saucedemo.com"),

  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().default("qwen/qwen3-coder:free"),
  CLAUDE_MODEL: z.string().default("sonnet"),

  JIRA_BASE_URL: z.string().default(""),
  JIRA_EMAIL: z.string().default(""),
  JIRA_API_TOKEN: z.string().default(""),
  JIRA_PROJECT_KEY: z.string().default("QA"),
  JIRA_AC_FIELD: z.string().default("description"),
  JIRA_LINK_TYPE: z.string().default("Blocks"),
  JIRA_TRANSITION_PASS: z.string().default(""),
  JIRA_TRANSITION_BUG: z.string().default(""),

  BUG_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),

  ARTIFACTS_DIR: z.string().default("artifacts"),

  // uReport (https://github.com/ureport-web/ureport-standalone). When UREPORT_URL
  // and UREPORT_API_TOKEN are both set, every pipeline run is also pushed to
  // uReport as a build (one build per run, one test per executed spec).
  UREPORT_URL: z.string().default(""),
  UREPORT_API_TOKEN: z.string().default(""),
  UREPORT_PRODUCT: z.string().default("agentic-qa-workflow"),
  UREPORT_TYPE: z.string().default("E2E"),
  UREPORT_TEAM: z.string().default("QA"),
  UREPORT_STAGE: z.string().default(""),
  // Failure screenshots are the riskiest payload to send out (they can show
  // real user data), so they are opt-in: enable them only when uReport runs
  // on infrastructure you control.
  UREPORT_ATTACH_SCREENSHOTS: boolish("0"),
  // Replaces the local repository path with "<repo>" in the error messages
  // and stack traces before they leave the machine.
  UREPORT_REDACT_PATHS: boolish("1"),
  // Total budget for one push. The push never fails the pipeline, but it must
  // not be able to stall it either.
  UREPORT_DEADLINE_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),

  MOCK_JIRA: boolish("0"),
  DRY_RUN: boolish("0"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export function assertJiraConfigured(): void {
  if (config.MOCK_JIRA) return;
  const missing = [
    !config.JIRA_BASE_URL && "JIRA_BASE_URL",
    !config.JIRA_EMAIL && "JIRA_EMAIL",
    !config.JIRA_API_TOKEN && "JIRA_API_TOKEN",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Missing Jira environment variables: ${missing.join(", ")}. Copy .env.example to .env or use MOCK_JIRA=1.`
    );
  }
}

export function assertModelConfigured(): void {
  if (config.DRY_RUN) return;
  if (!config.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is not set. Add it to .env or use DRY_RUN=1 to try the pipeline.");
  }
}

/** uReport is opt-in: without a server URL and an API token the pipeline skips it. */
export function ureportConfigured(): boolean {
  return Boolean(config.UREPORT_URL && config.UREPORT_API_TOKEN);
}

export type Config = typeof config;
