import { config } from "../config/env";

/**
 * Provider-agnostic LLM client.
 *
 * Talks to any OpenAI-compatible `/chat/completions` endpoint (OpenRouter,
 * OpenAI, Together, a local Ollama, ...). Configure it with:
 *   LLM_API_KEY   – provider API key (OpenRouter, etc.)
 *   LLM_BASE_URL  – default https://openrouter.ai/api/v1
 *   LLM_MODEL     – default deepseek/deepseek-chat:free (a free model)
 *
 * The agent stack only needs single-turn JSON/text generation, so a plain chat
 * completion is a drop-in replacement for the previous Claude Agent SDK call.
 * Tool use is not used by the planner/analyst/generator prompts.
 */

export interface AskOptions {
  /** Role system prompt. */
  system?: string;
  /** Retained for call-site compatibility; ignored by the chat backend. */
  maxTurns?: number;
  allowedTools?: string[];
  cwd?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

export async function askModel(prompt: string, opts: AskOptions = {}): Promise<string> {
  if (!config.LLM_API_KEY && !config.DRY_RUN) {
    throw new Error("LLM_API_KEY is not set. Add it to .env (or use DRY_RUN=1 to try the pipeline).");
  }

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.LLM_API_KEY}`,
      // OpenRouter expects these; harmless for other OpenAI-compatible hosts.
      "HTTP-Referer": "https://github.com/mtsncls/agentic-qa-workflow",
      "X-Title": "agentic-qa-workflow",
    },
    body: JSON.stringify({ model: config.LLM_MODEL, messages, temperature: 0 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("LLM returned no textual content");
  return content;
}
