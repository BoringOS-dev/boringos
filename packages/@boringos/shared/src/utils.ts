import { randomUUID } from "node:crypto";
import { resolve, normalize, relative } from "node:path";

export function generateId(): string {
  return randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sanitizePath(root: string, userPath: string): string {
  const resolved = resolve(root, userPath);
  const rel = relative(root, resolved);

  if (rel.startsWith("..") || normalize(resolved) !== resolved) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }

  return resolved;
}
