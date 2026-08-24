import type { AdfNode } from "./types";

const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "codeBlock", "blockquote"]);

/** Convierte un documento ADF a texto plano legible (para prompts del agente). */
export function adfToText(doc?: AdfNode | null): string {
  if (!doc) return "";
  const buf: string[] = [];

  const walk = (node: AdfNode): void => {
    if (typeof node.text === "string") buf.push(node.text);
    if (BLOCK_TYPES.has(node.type)) buf.push("\n");
    node.content?.forEach(walk);
  };

  walk(doc);
  return buf.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Convierte texto plano a ADF (cada línea = párrafo). Suficiente para comentarios/descripciones. */
export function textToAdf(text: string): AdfNode {
  const paragraphs = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));

  return {
    type: "doc",
    version: 1,
    content: paragraphs.length ? paragraphs : [{ type: "paragraph", content: [] }],
  };
}
