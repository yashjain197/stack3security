import { findNodeAtLocation, getNodeValue, parse, parseTree, type Node, type ParseError } from 'jsonc-parser';

// Same library and options VS Code uses for settings.json and tasks.json, so a file VS Code accepts parses here too.
const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;

/** An empty file is valid for VS Code (it means `{}`), so it is not an error here. */
const isBlank = (text: string): boolean => text.trim() === '';

export function parseJsonc(text: string): { value: unknown; errors: number } {
  if (isBlank(text)) return { value: {}, errors: 0 };
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, OPTIONS);
  return { value, errors: errors.length };
}

export interface JsoncDoc {
  text: string;
  root: Node | undefined;
  value: unknown;
  errors: number;
}

export function parseJsoncTree(text: string): JsoncDoc {
  if (isBlank(text)) return { text, root: undefined, value: {}, errors: 0 };
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, OPTIONS);
  return { text, root, value: root ? getNodeValue(root) : undefined, errors: errors.length };
}

/** 1-based line of a character offset. */
export function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** 1-based line of a node's start. */
export function lineOf(text: string, node: Node | undefined): number | undefined {
  return node ? lineAtOffset(text, node.offset) : undefined;
}

export function nodeAt(root: Node | undefined, path: (string | number)[]): Node | undefined {
  return root ? findNodeAtLocation(root, path) : undefined;
}
