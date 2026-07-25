import type { Buffer } from "buffer";

export interface McsHeader {
  magic: number;
  dataSize: number;
  positionInCard: number;
  prodCodeRaw: Buffer;
  prodCode: string;
  filler: Buffer;
  checksum: number;
}

export interface ParsedMcsSave {
  sourceFormat: "mcs";
  displayName: string;
  prodCode: string;
  header: McsHeader;
  saveData: Buffer;
  rawInput: Buffer;
}
