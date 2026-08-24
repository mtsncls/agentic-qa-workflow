import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config/env";

export interface AskOptions {
  /** System prompt del rol (planner, analista, generador de tests...). */
  system?: string;
  /** Herramientas que el agente puede usar. Vacío = solo conversación. */
  allowedTools?: string[];
  /** Máximo de vueltas agénticas (uso de herramientas). */
  maxTurns?: number;
  cwd?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

/**
 * Wrapper sobre el SDK de Claude Code. Ejecuta un prompt en modo no
 * interactivo y devuelve la respuesta textual final.
 */
export async function askClaude(prompt: string, opts: AskOptions = {}): Promise<string> {
  if (!config.ANTHROPIC_API_KEY && !config.DRY_RUN) {
    throw new Error("ANTHROPIC_API_KEY no configurada");
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

  // any deliberado: los tipos SDKMessage varían entre versiones del SDK.
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
    throw new Error(`Claude terminó con error (${resultMsg.subtype}): ${resultMsg.result ?? ""}`);
  }
  if (resultMsg?.result) return resultMsg.result;

  // Fallback: concatenar bloques de texto de los mensajes assistant.
  const text = messages
    .filter((m) => m?.type === "assistant")
    .flatMap((m) => m.message?.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!text.trim()) {
    throw new Error("Claude no devolvió contenido textual");
  }
  return text;
}
