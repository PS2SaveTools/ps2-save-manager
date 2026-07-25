export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function metadataRows(metadata: Record<string, string | number | boolean>): string {
  return Object.entries(metadata).map(([key, value]) => `<div class="meta-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("");
}

export function entryRows(entries: Array<{ id: string; name: string; data: Uint8Array }>, editable: boolean): string {
  return entries.map((entry) => `
    <li class="entry-row" data-entry-id="${escapeHtml(entry.id)}">
      <span class="entry-name"><span class="file-glyph" aria-hidden="true"></span>${escapeHtml(entry.name)}</span>
      <span class="entry-details"><span class="entry-size">${formatBytes(entry.data.length)}</span>
        <button class="entry-extract-button" type="button" data-extract-entry-id="${escapeHtml(entry.id)}">Extract</button>
        ${editable ? `<button class="entry-properties-button" type="button" data-properties-entry-id="${escapeHtml(entry.id)}">Properties</button><button class="entry-remove-button" type="button" data-remove-entry-id="${escapeHtml(entry.id)}">Remove</button>` : ""}
      </span>
    </li>`).join("");
}
