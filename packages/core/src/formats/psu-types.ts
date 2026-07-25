import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";
import type { Ps2Dirent } from "./ps2-dirent";

export interface ParsedPsuSave {
  type: "ps2";
  sourceFormat: "psu";
  displayName: string;
  dirName: string;
  directoryEntry: Ps2Dirent;
  fileEntries: Ps2Dirent[];
  entries: SaveEntry[];
  rawInput: Buffer;
}
