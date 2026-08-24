import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config/env";

export interface AskOptions {
  /** Role system prompt (planner, analyst, test generator...). */
  system?: string;
  /** Tools the agent may use. Empty = conversation only. */
  allowedTools?: string[];
  /** Maximum agentic turns (tool uses). */
  maxTurns?: number;
  cwd?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

/**
 * Wrapper over the Claude Code SDK. Runs a prompt in non-interactive mode and
 * returns the final text response.
 */
export async function askClaude(prompt: string, opts: AskOptions = {}): Promise<string> {
  if (!config.ANTHROPIC_API_KEY && !config.DRY_RUN) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const options = {
    systemPrompt: opts.system,
    allowedTools: opts.allowedTools ?? [],
    disallowedTools: ["Bash", "WebFetch", "WebSearch", "NotebookEdit"],
    maxTurns: opts.maxTurns ?? 4,
    model: config.CLAUDE_MODEL,
    cwd: opts.cwd ?? process.cwd(),
    permissionMode: opts.permissionMode ?? "default",
  };

  // any deliberate: SDKMessage types vary across SDK versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  const stream = query({ prompt, options } as unknown as Parameters<typeof query>[0]);

  for await (const message of stream) {
    messages.push(message);
  }

  const resultMsg = messages.find((m) => m?.type === "result") as
    | { type: "result"; result?: string; subtype?: string; is_error?: boolean }
    | undefined;

  if (resultMsg?.is_error) {
    throw new Error(`Claude ended with an error (${resultMsg.subtype}): ${resultMsg.result ?? ""}`);
  }
  if (resultMsg?.result) return resultMsg.result;

  // Fallback: concatenate text blocks from assistant messages.
  const text = messages
    .filter((m) => m?.type === "assistant")
    .flatMap((m) => m.message?.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!text.trim()) {
    throw new Error("Claude returned no textual content");
  }
  return text;
}
