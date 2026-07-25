import type { Buffer } from "buffer";

export interface MaxHeader {
  magic: string;
  checksum: number;
  dirNameRaw: Buffer;
  dirName: string;
  iconSysNameRaw: Buffer;
  iconSysName: string;
  compressedSize: number;
  numFiles: number;
  origSize: number;
}

export interface MaxEntry {
  nameRaw: Buffer;
  name: string;
  size: number;
  data: Buffer;
}

export interface ParsedMaxSave {
  sourceFormat: "max";
  displayName: string;
  header: MaxHeader;
  compressedPayload: Buffer;
  decompressedClump: Buffer;
  entries: MaxEntry[];
  rawInput: Buffer;
}
