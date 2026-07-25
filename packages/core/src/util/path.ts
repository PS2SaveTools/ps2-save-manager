export function basename(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  return normalized.split("/").pop() || input;
}

export function extname(input: string): string {
  const base = basename(input);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

export function makeEntryId(name: string, index: number): string { return `${index}:${name}`; }

export function sanitizeFileName(input: string, fallback = "save"): string {
  const sanitized = input.replace(/[\\/:*?"<>|]/g, " ").trim();
  return sanitized || fallback;
}
