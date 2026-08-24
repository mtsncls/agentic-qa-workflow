import type { ZodType } from "zod";

/**
 * Extrae y valida el primer objeto JSON embebido en la respuesta de un LLM
 * (tolera fences ```json, texto previo/posterior, etc).
 */
export function extractJson<T>(text: string, schema: ZodType<T>): T {
  let raw = text.trim();

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) raw = fence[1].trim();

  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Respuesta sin JSON válido:\n${text.slice(0, 500)}`);
    }
    raw = raw.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `JSON inválido del agente: ${(err as Error).message}\n---\n${raw.slice(0, 500)}`
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `JSON no cumple el esquema esperado: ${result.error.message}\n---\n${raw.slice(0, 500)}`
    );
  }
  return result.data;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}
