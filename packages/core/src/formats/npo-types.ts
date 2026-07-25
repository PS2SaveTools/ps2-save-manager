import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";

export interface NpoHeader {
  recordCount: number;
  iconSysDataOffset: number;
  iconDataOffset: number;
}

export interface ParsedNpoSave {
  type: "ps2";
  sourceFormat: "npo";
  displayName: string;
  dirName: string;
  rootMode: number;
  header: NpoHeader;
  entries: SaveEntry[];
  rawInput: Buffer;
}
