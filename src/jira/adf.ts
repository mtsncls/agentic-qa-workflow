import type { AdfNode } from "./types";

const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "codeBlock", "blockquote"]);

/** Converts an ADF document to plain readable text (for agent prompts). */
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

/** Converts plain text to ADF (each line = paragraph). Good enough for comments/descriptions. */
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
