import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";
import type { Ps2Dirent } from "./ps2-dirent";

export type XpsSourceFormat = "xps" | "sps";

export interface XpsHeader {
  magic: Buffer;
  saveType: number;
  fileName: string;
  dateStamp: string;
  comment: string;
  descriptorBytes: number;
}

export interface ParsedXpsSave {
  type: "ps2";
  sourceFormat: XpsSourceFormat;
  displayName: string;
  dirName: string;
  header: XpsHeader;
  directoryEntry: Ps2Dirent;
  fileEntries: Ps2Dirent[];
  entries: SaveEntry[];
  checksum: number;
  computedChecksum: number;
  checksumValid: boolean;
  rawInput: Buffer;
}
