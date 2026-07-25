import { Buffer } from "buffer";

export function readNullTerminatedAscii(raw: Buffer): string {
  const nul = raw.indexOf(0);
  const end = nul === -1 ? raw.length : nul;
  return raw.subarray(0, end).toString("ascii");
}

export function readTrimmedAscii(raw: Buffer): string {
  return readNullTerminatedAscii(raw).trim();
}

export function writeFixedAscii(value: string, length: number): Buffer {
  const buffer = Buffer.alloc(length, 0);
  Buffer.from(value, "ascii").copy(buffer, 0, 0, Math.min(value.length, length));
  return buffer;
}

// PS2 name fields hold at most length-1 characters; the final byte is always a
// NUL terminator (matching the Delphi writers, which cap names at 31 chars).
export function writeFixedAsciiZ(value: string, length: number): Buffer {
  return writeFixedAscii(value.slice(0, length - 1), length);
}
