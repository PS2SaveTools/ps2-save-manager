import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { BinaryWriter } from "../binary/binary-writer";
import { readNullTerminatedAscii, writeFixedAscii, writeFixedAsciiZ } from "../binary/fixed-string";
import type { ParsedMaxSave } from "./max-types";
import type { ParsedMcsSave } from "./mcs-types";
import type { ParsedSave, SaveEntry } from "../models/save-model";
import type { Ps1Header, Ps2FileInfo, Ps2Header, Ps2MainDirInfo } from "./psv-types";
import { PSV_IV as IV, PSV_KEY0 as KEY0, PSV_KEY1 as KEY1, PSV_LAID_PAID as LAID_PAID, PSV_SALT_SEED as NEW_SALT_SEED, xorBuffers, xorWithByte } from "./psv-crypto-common";
import { roundUp } from "../util/math";
import { makePsvFileName } from "../services/psv-export-payload";


function aesEcb(input: Buffer, key: Buffer, encrypt: boolean): Buffer {
  const cipher = encrypt
    ? createCipheriv("aes-128-ecb", key, null)
    : createDecipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]);
}

function aesCbcDecrypt(input: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

function makeDefaultPs1Header(prodCode: string, saveData: Buffer): Ps1Header {
  return {
    saveSize: saveData.length,
    startOfSaveData: 0,
    blockSize: 512,
    padding1: 0,
    padding2: 0,
    padding3: 0,
    padding4: 0,
    dataSize: saveData.length,
    unknown1: 36867,
    prodCodeRaw: writeFixedAscii(prodCode, 20),
    prodCode,
    padding6: 0,
    padding7: 0,
    padding8: 0,
  };
}

function makePs2FileDatesFromDate(date: Date): Pick<
  Ps2FileInfo,
  | "createReserved"
  | "createSecond"
  | "createMinute"
  | "createHour"
  | "createDay"
  | "createMonth"
  | "createYear"
  | "modReserved"
  | "modSecond"
  | "modMinute"
  | "modHour"
  | "modDay"
  | "modMonth"
  | "modYear"
> {
  return {
    createReserved: 0,
    createSecond: date.getSeconds(),
    createMinute: date.getMinutes(),
    createHour: date.getHours(),
    createDay: date.getDate(),
    createMonth: date.getMonth() + 1,
    createYear: date.getFullYear(),
    modReserved: 0,
    modSecond: date.getSeconds(),
    modMinute: date.getMinutes(),
    modHour: date.getHours(),
    modDay: date.getDate(),
    modMonth: date.getMonth() + 1,
    modYear: date.getFullYear(),
  };
}

function makePs2FileDatesFromEntry(
  entry: SaveEntry,
  fallbackDate: Date,
): Pick<
  Ps2FileInfo,
  | "createReserved"
  | "createSecond"
  | "createMinute"
  | "createHour"
  | "createDay"
  | "createMonth"
  | "createYear"
  | "modReserved"
  | "modSecond"
  | "modMinute"
  | "modHour"
  | "modDay"
  | "modMonth"
  | "modYear"
> {
  const created = makePs2FileDatesFromDate(entry.createdAt ?? fallbackDate);
  const modified = makePs2FileDatesFromDate(entry.modifiedAt ?? entry.createdAt ?? fallbackDate);

  return {
    createReserved: created.createReserved,
    createSecond: created.createSecond,
    createMinute: created.createMinute,
    createHour: created.createHour,
    createDay: created.createDay,
    createMonth: created.createMonth,
    createYear: created.createYear,
    modReserved: modified.modReserved,
    modSecond: modified.modSecond,
    modMinute: modified.modMinute,
    modHour: modified.modHour,
    modDay: modified.modDay,
    modMonth: modified.modMonth,
    modYear: modified.modYear,
  };
}

function writePs2FileInfo(info: Ps2FileInfo): Buffer {
  const writer = new BinaryWriter();
  writer
    .writeUInt8(info.createReserved)
    .writeUInt8(info.createSecond)
    .writeUInt8(info.createMinute)
    .writeUInt8(info.createHour)
    .writeUInt8(info.createDay)
    .writeUInt8(info.createMonth)
    .writeUInt16LE(info.createYear)
    .writeUInt8(info.modReserved)
    .writeUInt8(info.modSecond)
    .writeUInt8(info.modMinute)
    .writeUInt8(info.modHour)
    .writeUInt8(info.modDay)
    .writeUInt8(info.modMonth)
    .writeUInt16LE(info.modYear)
    .writeInt32LE(info.fileSize)
    .writeInt32LE(info.attribute)
    .writeBytes(info.filenameRaw)
    .writeInt32LE(info.positionInFile);
  return writer.toBuffer();
}

function makeDefaultPs2Header(numberOfFiles: number): Ps2Header {
  return {
    displaySize: 0,
    sysPos: 0,
    sysSize: 0,
    icon1Pos: 0,
    icon1Size: 0,
    icon2Pos: 0,
    icon2Size: 0,
    icon3Pos: 0,
    icon3Size: 0,
    numberOfFiles,
  };
}

function makeDefaultPs2MainDirInfo(dirName: string, date: Date, numberOfFiles: number): Ps2MainDirInfo {
  return {
    createReserved: 0,
    createSecond: date.getSeconds(),
    createMinute: date.getMinutes(),
    createHour: date.getHours(),
    createDay: date.getDate(),
    createMonth: date.getMonth() + 1,
    createYear: date.getFullYear(),
    modReserved: 0,
    modSecond: date.getSeconds(),
    modMinute: date.getMinutes(),
    modHour: date.getHours(),
    modDay: date.getDate(),
    modMonth: date.getMonth() + 1,
    modYear: date.getFullYear(),
    numberOfFilesInDir: numberOfFiles + 2,
    attribute: 0x8427,
    filenameRaw: writeFixedAsciiZ(dirName, 32),
    filename: dirName,
  };
}

function parseIconNames(iconSysData: Buffer): { icon1?: string; icon2?: string; icon3?: string } {
  if (iconSysData.length < 452) {
    return {};
  }

  return {
    icon1: readNullTerminatedAscii(iconSysData.subarray(260, 324)),
    icon2: readNullTerminatedAscii(iconSysData.subarray(324, 388)),
    icon3: readNullTerminatedAscii(iconSysData.subarray(388, 452)),
  };
}

function writePsvHeader(saveType: 1 | 2): Buffer {
  const writer = new BinaryWriter();
  writer
    .writeBytes(Buffer.from([0x00, 0x56, 0x53, 0x50]))
    .writeInt32LE(0)
    .writeBytes(NEW_SALT_SEED)
    .writeBytes(Buffer.alloc(20, 0))
    .writeInt32LE(0)
    .writeInt32LE(0)
    .writeInt32LE(saveType === 1 ? 0x14 : 0x2c)
    .writeInt32LE(saveType);
  return writer.toBuffer();
}

function writePs1Header(header: Ps1Header): Buffer {
  const writer = new BinaryWriter();
  writer
    .writeInt32LE(header.saveSize)
    .writeInt32LE(header.startOfSaveData)
    .writeInt32LE(header.blockSize)
    .writeInt32LE(header.padding1)
    .writeInt32LE(header.padding2)
    .writeInt32LE(header.padding3)
    .writeInt32LE(header.padding4)
    .writeInt32LE(header.dataSize)
    .writeInt32LE(header.unknown1)
    .writeBytes(header.prodCodeRaw)
    .writeInt32LE(header.padding6)
    .writeInt32LE(header.padding7)
    .writeInt32LE(header.padding8);
  return writer.toBuffer();
}

function writePs2Header(header: Ps2Header): Buffer {
  const writer = new BinaryWriter();
  writer
    .writeInt32LE(header.displaySize)
    .writeInt32LE(header.sysPos)
    .writeInt32LE(header.sysSize)
    .writeInt32LE(header.icon1Pos)
    .writeInt32LE(header.icon1Size)
    .writeInt32LE(header.icon2Pos)
    .writeInt32LE(header.icon2Size)
    .writeInt32LE(header.icon3Pos)
    .writeInt32LE(header.icon3Size)
    .writeInt32LE(header.numberOfFiles);
  return writer.toBuffer();
}

function writePs2MainDirInfo(info: Ps2MainDirInfo): Buffer {
  const writer = new BinaryWriter();
  writer
    .writeUInt8(info.createReserved)
    .writeUInt8(info.createSecond)
    .writeUInt8(info.createMinute)
    .writeUInt8(info.createHour)
    .writeUInt8(info.createDay)
    .writeUInt8(info.createMonth)
    .writeUInt16LE(info.createYear)
    .writeUInt8(info.modReserved)
    .writeUInt8(info.modSecond)
    .writeUInt8(info.modMinute)
    .writeUInt8(info.modHour)
    .writeUInt8(info.modDay)
    .writeUInt8(info.modMonth)
    .writeUInt16LE(info.modYear)
    .writeInt32LE(info.numberOfFilesInDir)
    .writeInt32LE(info.attribute)
    .writeBytes(info.filenameRaw);
  return writer.toBuffer();
}

function deriveSpecialPositions(
  entries: Array<{ entry: SaveEntry; position: number }>,
  iconNames: { icon1?: string; icon2?: string; icon3?: string },
): Pick<Ps2Header, "sysPos" | "sysSize" | "icon1Pos" | "icon1Size" | "icon2Pos" | "icon2Size" | "icon3Pos" | "icon3Size"> {
  const result = {
    sysPos: 0,
    sysSize: 0,
    icon1Pos: 0,
    icon1Size: 0,
    icon2Pos: 0,
    icon2Size: 0,
    icon3Pos: 0,
    icon3Size: 0,
  };

  for (const { entry, position } of entries) {
    if (entry.name === "icon.sys") {
      result.sysPos = position;
      result.sysSize = entry.size;
    }
    if (iconNames.icon1 && entry.name === iconNames.icon1) {
      result.icon1Pos = position;
      result.icon1Size = entry.size;
    }
    if (iconNames.icon2 && entry.name === iconNames.icon2) {
      result.icon2Pos = position;
      result.icon2Size = entry.size;
    }
    if (iconNames.icon3 && entry.name === iconNames.icon3) {
      result.icon3Pos = position;
      result.icon3Size = entry.size;
    }
  }

  return result;
}

function computeSignature(payload: Buffer, saveType: 1 | 2): Buffer {
  const saltSeed = payload.subarray(8, 28);
  let salt64: Buffer;

  if (saveType === 1) {
    const salt16 = saltSeed.subarray(0, 16);
    const clearSalt = aesEcb(salt16, KEY1, false);
    const encryptedSalt = aesEcb(salt16, KEY1, true);
    const workBuf = Buffer.alloc(16, 0xff);
    saltSeed.subarray(16, 20).copy(workBuf, 0);
    const salt32 = Buffer.concat([xorBuffers(clearSalt, IV), xorBuffers(encryptedSalt, workBuf)]);
    salt64 = Buffer.alloc(64, 0);
    salt32.subarray(0, 20).copy(salt64, 0);
  } else {
    const salt = Buffer.alloc(64, 0);
    saltSeed.copy(salt, 0);
    const xoredKey0 = xorBuffers(KEY0, LAID_PAID);
    salt64 = aesCbcDecrypt(salt, xoredKey0, IV);
    salt64 = Buffer.concat([salt64.subarray(0, 20), Buffer.alloc(44, 0)]);
  }

  const innerPad = xorWithByte(salt64, 0x36);
  const outerPad = xorWithByte(innerPad, 0x6a);

  const payloadForHash = Buffer.from(payload);
  payloadForHash.fill(0, 28, 48);

  const innerHash = createHash("sha1").update(innerPad).update(payloadForHash).digest();
  return createHash("sha1").update(outerPad).update(innerHash).digest();
}

// Signs a complete PSV payload using the salt seed stored in its header,
// returning the 20-byte signature that belongs at offset 28.
export function signPsvPayload(payload: Buffer): Buffer {
  const saveType = payload.readInt32LE(60);

  if (saveType !== 1 && saveType !== 2) {
    throw new Error(`Unsupported PSV save type: ${saveType}`);
  }

  return computeSignature(payload, saveType);
}

function buildPs1Payload(prodCode: string, saveData: Buffer, existingHeader?: Ps1Header): Buffer {
  const header = existingHeader ? { ...existingHeader } : makeDefaultPs1Header(prodCode, saveData);
  header.saveSize = saveData.length;
  header.startOfSaveData = 64 + 68;
  header.blockSize = 512;
  header.dataSize = saveData.length;
  header.unknown1 = existingHeader?.unknown1 ?? 36867;
  header.prodCode = prodCode;
  header.prodCodeRaw = writeFixedAscii(prodCode, 20);

  const payload = Buffer.concat([writePsvHeader(1), writePs1Header(header), saveData]);
  computeSignature(payload, 1).copy(payload, 28);
  return payload;
}

function buildPs2Payload(
  dirName: string,
  entries: SaveEntry[],
  options?: {
    existingHeader?: Ps2Header;
    existingMainDirInfo?: Ps2MainDirInfo;
    existingFileInfos?: Ps2FileInfo[];
    date?: Date;
    rootMode?: number;
  },
): Buffer {
  const date = options?.date ?? new Date("2000-01-01T00:00:00Z");
  const mainDirInfo = options?.existingMainDirInfo
    ? {
        ...options.existingMainDirInfo,
        numberOfFilesInDir: entries.length + 2,
        filename: dirName,
        filenameRaw: writeFixedAsciiZ(dirName, 32),
      }
    : makeDefaultPs2MainDirInfo(dirName, date, entries.length);
  mainDirInfo.attribute = options?.rootMode ?? mainDirInfo.attribute;

  const fileTableStart = 64 + 40 + 56;
  let baseAddress = fileTableStart + entries.length * 60;

  const positionedEntries = entries.map((entry, index) => {
    const position = baseAddress;
    baseAddress += entry.size;

    const existingFileInfo = options?.existingFileInfos?.[index];
    const fileDates = existingFileInfo ?? makePs2FileDatesFromEntry(entry, date);
    const filenameRaw =
      entry.nameRaw && entry.nameRaw.length === 32 ? Buffer.from(entry.nameRaw) : writeFixedAsciiZ(entry.name, 32);
    const attribute = existingFileInfo?.attribute ?? entry.attribute ?? 0x8497;
    const fileInfo: Ps2FileInfo = {
      ...fileDates,
      fileSize: entry.size,
      attribute,
      positionInFile: position,
      filenameRaw,
      filename: entry.name,
    };

    return {
      entry,
      position,
      fileInfo,
    };
  });

  const iconEntry = entries.find((entry) => entry.name === "icon.sys");
  const iconNames = iconEntry ? parseIconNames(iconEntry.data) : {};
  const specialPositions = deriveSpecialPositions(positionedEntries, iconNames);

  const header: Ps2Header = {
    ...(options?.existingHeader ?? makeDefaultPs2Header(entries.length)),
    ...specialPositions,
    numberOfFiles: entries.length,
    displaySize: roundUp(entries.reduce((total, entry) => total + entry.size, 0), 1024),
  };

  const writer = new BinaryWriter();
  writer.writeBytes(writePsvHeader(2));
  writer.writeBytes(writePs2Header(header));
  writer.writeBytes(writePs2MainDirInfo(mainDirInfo));

  for (const positionedEntry of positionedEntries) {
    writer.writeBytes(writePs2FileInfo(positionedEntry.fileInfo));
  }

  for (const positionedEntry of positionedEntries) {
    writer.writeBytes(positionedEntry.entry.data);
  }

  const payload = writer.toBuffer();
  writePs2Header(header).copy(payload, 64);
  computeSignature(payload, 2).copy(payload, 28);
  return payload;
}

export class PsvWriter {
  static sign(payload: Buffer): Buffer {
    return signPsvPayload(payload);
  }
  makeSuggestedFileName(mainDirName: string): string {
    return makePsvFileName(mainDirName);
  }

  writePs1(prodCode: string, saveData: Buffer): Buffer {
    return buildPs1Payload(prodCode, saveData);
  }

  writePs2(dirName: string, entries: SaveEntry[], options?: { date?: Date; rootMode?: number }): Buffer {
    return buildPs2Payload(dirName, entries, { date: options?.date, rootMode: options?.rootMode });
  }

  writeFromParsed(save: ParsedSave): Buffer {
    if (save.type === "ps1") {
      return buildPs1Payload(save.ps1Header?.prodCode ?? save.dirName, save.entries[0]!.data, save.ps1Header);
    }

    return buildPs2Payload(save.dirName, save.entries, {
      existingHeader: save.ps2Header,
      existingMainDirInfo: save.ps2MainDirInfo,
      existingFileInfos: save.ps2FileInfos,
    });
  }

  writeFromMcs(save: ParsedMcsSave): Buffer {
    return buildPs1Payload(save.prodCode, save.saveData);
  }

  writeFromMax(save: ParsedMaxSave, options?: { date?: Date }): Buffer {
    return buildPs2Payload(
      save.header.dirName,
      save.entries.map((entry) => ({
        name: entry.name,
        nameRaw: entry.nameRaw,
        size: entry.size,
        data: entry.data,
      })),
      { date: options?.date },
    );
  }
}
