import type { Buffer } from "buffer";
import type { Ps1Header, Ps2FileInfo, Ps2Header, Ps2MainDirInfo, PsvHeader } from "../formats/psv-types";

export type SaveType = "ps1" | "ps2";
export type SourceFormat = "new" | "psv" | "max" | "pws" | "mcs" | "psu" | "xps" | "sps" | "cbs" | "npo" | "xpo" | "spo" | "md" | "p2m";

export interface SaveEntry {
  name: string;
  nameRaw?: Buffer;
  size: number;
  createdAt?: Date;
  modifiedAt?: Date;
  attribute?: number;
  mode?: number;
  positionInFile?: number;
  data: Buffer;
}

export interface ParsedSave {
  type: SaveType;
  sourceFormat: SourceFormat;
  displayName: string;
  dirName: string;
  entries: SaveEntry[];
  psvHeader: PsvHeader;
  ps1Header?: Ps1Header;
  ps2Header?: Ps2Header;
  ps2MainDirInfo?: Ps2MainDirInfo;
  ps2FileInfos?: Ps2FileInfo[];
  rawInput: Buffer;
}
