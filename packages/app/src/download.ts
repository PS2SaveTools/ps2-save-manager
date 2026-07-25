import type { Buffer } from "buffer";

export function downloadBuffer(fileName: string, mimeType: string, data: Buffer): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
