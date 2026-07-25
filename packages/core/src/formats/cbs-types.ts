import type { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";
import type { Ps2Dirent } from "./ps2-dirent";

export interface CbsHeader {
  magic: string;
  unknown1: number;
  dataOffset: number;
  decompressedSize: number;
  compressedSize: number;
  nameRaw: Buffer;
  name: string;
  created: Date | undefined;
  modified: Date | undefined;
  unknown2: number;
  mode: number;
  title: string;
  description: string;
}

export interface ParsedCbsSave {
  type: "ps2";
  sourceFormat: "cbs";
  displayName: string;
  dirName: string;
  header: CbsHeader;
  directoryEntry: Ps2Dirent;
  fileEntries: Ps2Dirent[];
  entries: SaveEntry[];
  rawInput: Buffer;
}
