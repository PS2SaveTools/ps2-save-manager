import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";

export interface ParsedMdSave {
  type: "ps2";
  sourceFormat: "md";
  displayName: string;
  dirName: string;
  rootMode: number;
  entries: SaveEntry[];
  rawInput: Buffer;
}
