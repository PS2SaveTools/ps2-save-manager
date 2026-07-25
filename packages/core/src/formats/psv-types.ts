import type { Buffer } from "buffer";

export interface PsvHeader {
  magicRaw: Buffer;
  magic: string;
  padding1: number;
  salt: Buffer;
  signature: Buffer;
  padding2: number;
  padding3: number;
  headerSize: number;
  saveType: number;
}

export interface Ps2Header {
  displaySize: number;
  sysPos: number;
  sysSize: number;
  icon1Pos: number;
  icon1Size: number;
  icon2Pos: number;
  icon2Size: number;
  icon3Pos: number;
  icon3Size: number;
  numberOfFiles: number;
}

export interface Ps2MainDirInfo {
  createReserved: number;
  createSecond: number;
  createMinute: number;
  createHour: number;
  createDay: number;
  createMonth: number;
  createYear: number;
  modReserved: number;
  modSecond: number;
  modMinute: number;
  modHour: number;
  modDay: number;
  modMonth: number;
  modYear: number;
  numberOfFilesInDir: number;
  attribute: number;
  filenameRaw: Buffer;
  filename: string;
}

export interface Ps2FileInfo {
  createReserved: number;
  createSecond: number;
  createMinute: number;
  createHour: number;
  createDay: number;
  createMonth: number;
  createYear: number;
  modReserved: number;
  modSecond: number;
  modMinute: number;
  modHour: number;
  modDay: number;
  modMonth: number;
  modYear: number;
  fileSize: number;
  attribute: number;
  positionInFile: number;
  filenameRaw: Buffer;
  filename: string;
  sourceLayout?: "delphi" | "legacy-js";
}

export interface Ps1Header {
  saveSize: number;
  startOfSaveData: number;
  blockSize: number;
  padding1: number;
  padding2: number;
  padding3: number;
  padding4: number;
  dataSize: number;
  unknown1: number;
  prodCodeRaw: Buffer;
  prodCode: string;
  padding6: number;
  padding7: number;
  padding8: number;
}
