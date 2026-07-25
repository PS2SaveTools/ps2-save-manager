import { Buffer } from "buffer";
import { BinaryReader } from "../binary/binary-reader";
import { readNullTerminatedAscii, readTrimmedAscii } from "../binary/fixed-string";
import type { ParsedSave, SaveEntry } from "../models/save-model";
import type { Ps1Header, Ps2FileInfo, Ps2Header, Ps2MainDirInfo, PsvHeader } from "./psv-types";

function makeDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | undefined {
  if (!year || !month || !day) {
    return undefined;
  }

  return new Date(year, month - 1, day, hour, minute, second);
}

export class PsvReader {
  read(input: Buffer): ParsedSave {
    const reader = new BinaryReader(input);
    const psvHeader = this.readPsvHeader(reader);

    if (psvHeader.magic !== "VSP") {
      throw new Error(`Invalid PSV magic: ${psvHeader.magic}`);
    }

    if (psvHeader.saveType === 1) {
      return this.readPs1Save(reader, input, psvHeader);
    }

    if (psvHeader.saveType === 2) {
      return this.readPs2Save(reader, input, psvHeader);
    }

    throw new Error(`Unsupported PSV save type: ${psvHeader.saveType}`);
  }

  private readPsvHeader(reader: BinaryReader): PsvHeader {
    const magicRaw = reader.readBytes(4);

    return {
      magicRaw,
      magic: magicRaw.subarray(1, 4).toString("ascii"),
      padding1: reader.readInt32LE(),
      salt: reader.readBytes(20),
      signature: reader.readBytes(20),
      padding2: reader.readInt32LE(),
      padding3: reader.readInt32LE(),
      headerSize: reader.readInt32LE(),
      saveType: reader.readInt32LE(),
    };
  }

  private readPs1Header(reader: BinaryReader): Ps1Header {
    const saveSize = reader.readInt32LE();
    const startOfSaveData = reader.readInt32LE();
    const blockSize = reader.readInt32LE();
    const padding1 = reader.readInt32LE();
    const padding2 = reader.readInt32LE();
    const padding3 = reader.readInt32LE();
    const padding4 = reader.readInt32LE();
    const dataSize = reader.readInt32LE();
    const unknown1 = reader.readInt32LE();
    const prodCodeRaw = reader.readBytes(20);

    return {
      saveSize,
      startOfSaveData,
      blockSize,
      padding1,
      padding2,
      padding3,
      padding4,
      dataSize,
      unknown1,
      prodCodeRaw,
      prodCode: readNullTerminatedAscii(prodCodeRaw),
      padding6: reader.readInt32LE(),
      padding7: reader.readInt32LE(),
      padding8: reader.readInt32LE(),
    };
  }

  private readPs2Header(reader: BinaryReader): Ps2Header {
    return {
      displaySize: reader.readInt32LE(),
      sysPos: reader.readInt32LE(),
      sysSize: reader.readInt32LE(),
      icon1Pos: reader.readInt32LE(),
      icon1Size: reader.readInt32LE(),
      icon2Pos: reader.readInt32LE(),
      icon2Size: reader.readInt32LE(),
      icon3Pos: reader.readInt32LE(),
      icon3Size: reader.readInt32LE(),
      numberOfFiles: reader.readInt32LE(),
    };
  }

  private readPs2MainDirInfo(reader: BinaryReader): Ps2MainDirInfo {
    const createReserved = reader.readUInt8();
    const createSecond = reader.readUInt8();
    const createMinute = reader.readUInt8();
    const createHour = reader.readUInt8();
    const createDay = reader.readUInt8();
    const createMonth = reader.readUInt8();
    const createYear = reader.readUInt16LE();
    const modReserved = reader.readUInt8();
    const modSecond = reader.readUInt8();
    const modMinute = reader.readUInt8();
    const modHour = reader.readUInt8();
    const modDay = reader.readUInt8();
    const modMonth = reader.readUInt8();
    const modYear = reader.readUInt16LE();
    const numberOfFilesInDir = reader.readInt32LE();
    const attribute = reader.readInt32LE();
    const filenameRaw = reader.readBytes(32);

    return {
      createReserved,
      createSecond,
      createMinute,
      createHour,
      createDay,
      createMonth,
      createYear,
      modReserved,
      modSecond,
      modMinute,
      modHour,
      modDay,
      modMonth,
      modYear,
      numberOfFilesInDir,
      attribute,
      filenameRaw,
      filename: readTrimmedAscii(filenameRaw),
    };
  }

  private readPs2FileInfo(reader: BinaryReader): Ps2FileInfo {
    const raw = reader.readBytes(60);
    const delphi = this.parsePs2FileInfo(raw, "delphi");
    const legacyJs = this.parsePs2FileInfo(raw, "legacy-js");

    if (this.isPlausiblePs2FileInfo(delphi, reader.length())) {
      return delphi;
    }

    if (this.isPlausiblePs2FileInfo(legacyJs, reader.length())) {
      return legacyJs;
    }

    throw new Error(`Invalid PS2 file entry at ${reader.tell() - raw.length}`);
  }

  private parsePs2FileInfo(raw: Buffer, sourceLayout: "delphi" | "legacy-js"): Ps2FileInfo {
    const createReserved = raw.readUInt8(0);
    const createSecond = raw.readUInt8(1);
    const createMinute = raw.readUInt8(2);
    const createHour = raw.readUInt8(3);
    const createDay = raw.readUInt8(4);
    const createMonth = raw.readUInt8(5);
    const createYear = raw.readUInt16LE(6);
    const modReserved = raw.readUInt8(8);
    const modSecond = raw.readUInt8(9);
    const modMinute = raw.readUInt8(10);
    const modHour = raw.readUInt8(11);
    const modDay = raw.readUInt8(12);
    const modMonth = raw.readUInt8(13);
    const modYear = raw.readUInt16LE(14);

    if (sourceLayout === "legacy-js") {
      const filenameRaw = Buffer.alloc(32, 0);
      raw.subarray(36, 60).copy(filenameRaw);

      return {
        createReserved,
        createSecond,
        createMinute,
        createHour,
        createDay,
        createMonth,
        createYear,
        modReserved,
        modSecond,
        modMinute,
        modHour,
        modDay,
        modMonth,
        modYear,
        fileSize: raw.readInt32LE(24),
        attribute: raw.readInt32LE(28),
        positionInFile: raw.readInt32LE(32),
        filenameRaw,
        filename: readTrimmedAscii(filenameRaw),
        sourceLayout,
      };
    }

    const filenameRaw = raw.subarray(24, 56);

    return {
      createReserved,
      createSecond,
      createMinute,
      createHour,
      createDay,
      createMonth,
      createYear,
      modReserved,
      modSecond,
      modMinute,
      modHour,
      modDay,
      modMonth,
      modYear,
      fileSize: raw.readInt32LE(16),
      attribute: raw.readInt32LE(20),
      positionInFile: raw.readInt32LE(56),
      filenameRaw,
      filename: readTrimmedAscii(filenameRaw),
      sourceLayout,
    };
  }

  private isPlausiblePs2FileInfo(fileInfo: Ps2FileInfo, inputLength: number): boolean {
    const dataEnd = fileInfo.positionInFile + fileInfo.fileSize;

    return (
      fileInfo.fileSize >= 0 &&
      fileInfo.positionInFile >= 0 &&
      dataEnd <= inputLength &&
      fileInfo.attribute !== 0 &&
      fileInfo.filename.length > 0
    );
  }

  private readPs1Save(reader: BinaryReader, input: Buffer, psvHeader: PsvHeader): ParsedSave {
    const ps1Header = this.readPs1Header(reader);
    const dataStart = ps1Header.startOfSaveData;
    const dataEnd = dataStart + ps1Header.saveSize;

    if (dataStart < 0 || ps1Header.saveSize < 0 || dataEnd > input.length) {
      throw new Error(`PS1 save data out of bounds: start=${dataStart} size=${ps1Header.saveSize}`);
    }

    const saveData = input.subarray(dataStart, dataEnd);

    const entries: SaveEntry[] = [
      {
        name: ps1Header.prodCode,
        size: saveData.length,
        data: saveData,
      },
    ];

    return {
      type: "ps1",
      sourceFormat: "psv",
      displayName: ps1Header.prodCode,
      dirName: ps1Header.prodCode,
      entries,
      psvHeader,
      ps1Header,
      rawInput: input,
    };
  }

  private readPs2Save(reader: BinaryReader, input: Buffer, psvHeader: PsvHeader): ParsedSave {
    const ps2Header = this.readPs2Header(reader);
    const ps2MainDirInfo = this.readPs2MainDirInfo(reader);
    const ps2FileInfos: Ps2FileInfo[] = [];

    for (let index = 0; index < ps2Header.numberOfFiles; index += 1) {
      ps2FileInfos.push(this.readPs2FileInfo(reader));
    }

    const entries: SaveEntry[] = ps2FileInfos.map((fileInfo) => {
      const dataEnd = fileInfo.positionInFile + fileInfo.fileSize;

      if (fileInfo.positionInFile < 0 || fileInfo.fileSize < 0 || dataEnd > input.length) {
        throw new Error(
          `PS2 file data out of bounds for ${fileInfo.filename}: start=${fileInfo.positionInFile} size=${fileInfo.fileSize}`,
        );
      }

      return {
        name: fileInfo.filename,
        nameRaw: fileInfo.filenameRaw,
        size: fileInfo.fileSize,
        attribute: fileInfo.attribute,
        mode: fileInfo.attribute,
        createdAt: makeDate(
          fileInfo.createYear,
          fileInfo.createMonth,
          fileInfo.createDay,
          fileInfo.createHour,
          fileInfo.createMinute,
          fileInfo.createSecond,
        ),
        modifiedAt: makeDate(
          fileInfo.modYear,
          fileInfo.modMonth,
          fileInfo.modDay,
          fileInfo.modHour,
          fileInfo.modMinute,
          fileInfo.modSecond,
        ),
        positionInFile: fileInfo.positionInFile,
        data: input.subarray(fileInfo.positionInFile, dataEnd),
      };
    });

    return {
      type: "ps2",
      sourceFormat: "psv",
      displayName: ps2MainDirInfo.filename,
      dirName: ps2MainDirInfo.filename,
      entries,
      psvHeader,
      ps2Header,
      ps2MainDirInfo,
      ps2FileInfos,
      rawInput: input,
    };
  }
}
