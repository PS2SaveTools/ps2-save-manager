import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";

export type XpoSourceFormat = "xpo" | "spo";

export interface XpoHeader {
  fileSize: number;
  gameName: string;
  description: string;
}

export interface ParsedXpoSave {
  type: "ps2";
  sourceFormat: XpoSourceFormat;
  displayName: string;
  dirName: string;
  rootMode: number;
  header: XpoHeader;
  entries: SaveEntry[];
  rawInput: Buffer;
}
