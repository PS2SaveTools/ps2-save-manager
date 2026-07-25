import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";

export interface ParsedP2mSave {
  type: "ps2";
  sourceFormat: "p2m";
  displayName: string;
  dirName: string;
  rootMode: number;
  description: string;
  entries: SaveEntry[];
  rawInput: Buffer;
}
