import type { Buffer } from "buffer";
import { CbsReader, isCbsBuffer } from "../formats/cbs-reader";
import { MaxReader } from "../formats/max-reader";
import { McsReader } from "../formats/mcs-reader";
import { MdReader } from "../formats/md-reader";
import { isNpoBuffer, NpoReader } from "../formats/npo-reader";
import { isP2mBuffer, P2mReader } from "../formats/p2m-reader";
import { isPsuBuffer, PsuReader } from "../formats/psu-reader";
import { PsvReader } from "../formats/psv-reader";
import { isXpsBuffer, XpsReader } from "../formats/xps-reader";
import { isXpoBuffer, XpoReader } from "../formats/xpo-reader";
import type { ParsedXpoSave } from "../formats/xpo-types";
import { isPs2DirMode } from "../formats/ps2-dirent";
import type { ParsedPsuSave } from "../formats/psu-types";
import type { ParsedCbsSave } from "../formats/cbs-types";
import type { ParsedXpsSave, XpsSourceFormat } from "../formats/xps-types";
import type { ParsedSave, SaveEntry } from "../models/save-model";
import type { AppSaveDocument, AppSaveEntry } from "./app-model";
import { basename, extname, makeEntryId } from "../util/path";

function normalizeEntries(entries: SaveEntry[]): AppSaveEntry[] {
  return entries.map((entry, index) => ({
    id: makeEntryId(entry.name, index),
    name: entry.name,
    data: entry.data,
    sourceName: entry.name,
    attribute: entry.attribute,
    mode: entry.mode,
    createdAt: entry.createdAt,
    modifiedAt: entry.modifiedAt,
    positionInFile: entry.positionInFile,
  }));
}

export class SaveInspectionService {
  private inspectBufferSync(input: Buffer, fileName: string): AppSaveDocument {
    const extension = extname(fileName).toLowerCase();

    switch (extension) {
      case ".psv":
        return this.fromParsedSave(new PsvReader().read(input), fileName);
      case ".mcs":
        return this.fromMcs(input, fileName);
      case ".max":
        return this.fromMax(input, fileName);
      case ".pws": {
        const document = this.fromMax(input, fileName);
        document.sourceFormat = "pws";
        return document;
      }
      case ".md":
        return this.fromMd(input, fileName);
      case ".p2m":
        return this.fromP2m(input, fileName);
      case ".npo":
        return this.fromNpo(input, fileName);
      case ".psu":
        return this.fromPsu(new PsuReader().read(input), fileName);
      case ".xps":
        return this.fromXps(new XpsReader().read(input, "xps"), fileName);
      case ".sps":
        return this.fromXps(new XpsReader().read(input, "sps"), fileName);
      case ".xpo":
        return this.fromXpo(new XpoReader().read(input, "xpo"), fileName);
      case ".spo":
        return this.fromXpo(new XpoReader().read(input, "spo"), fileName);
      default:
        return this.inspectByContent(input, fileName);
    }
  }

  async inspectBuffer(input: Buffer, fileName = "input.bin"): Promise<AppSaveDocument> {
    const extension = extname(fileName).toLowerCase();

    if (extension === ".cbs" || isCbsBuffer(input)) {
      return this.fromCbs(await new CbsReader().read(input), fileName);
    }

    return this.inspectBufferSync(input, fileName);
  }

  private inspectByContent(input: Buffer, fileName: string): AppSaveDocument {
    const asciiMagic = input.subarray(0, 12).toString("ascii");

    if (input.length >= 4 && input[1] === 0x56 && input[2] === 0x53 && input[3] === 0x50) {
      return this.fromParsedSave(new PsvReader().read(input), fileName);
    }

    if (asciiMagic === "Ps2PowerSave") {
      return this.fromMax(input, fileName);
    }

    if (isXpsBuffer(input)) {
      return this.fromXps(new XpsReader().read(input, "xps"), fileName);
    }

    if (isXpoBuffer(input)) return this.fromXpo(new XpoReader().read(input, "xpo"), fileName);

    if (input.length >= 4 && input.readInt32LE(0) === 81) {
      return this.fromMcs(input, fileName);
    }

    if (isPsuBuffer(input)) {
      return this.fromPsu(new PsuReader().read(input), fileName);
    }

    if (isP2mBuffer(input)) return this.fromP2m(input, fileName);

    if (isNpoBuffer(input)) return this.fromNpo(input, fileName);

    throw new Error(`Unsupported save format for ${fileName}`);
  }

  private fromParsedSave(save: ParsedSave, fileName: string): AppSaveDocument {
    return {
      id: basename(fileName),
      sourceFormat: save.sourceFormat,
      type: save.type,
      displayName: save.displayName,
      dirName: save.dirName,
      rootMode: save.ps2MainDirInfo?.attribute,
      entryCount: save.entries.length,
      entries: normalizeEntries(save.entries),
      metadata: {
        sourceFile: basename(fileName),
        saveType: save.type,
        entryCount: save.entries.length,
        headerSize: save.psvHeader.headerSize,
      },
      rawInput: save.rawInput,
    };
  }

  private fromMcs(input: Buffer, fileName: string): AppSaveDocument {
    const save = new McsReader().read(input);

    return {
      id: basename(fileName),
      sourceFormat: "mcs",
      type: "ps1",
      displayName: save.displayName,
      dirName: save.prodCode,
      entryCount: 1,
      entries: [
        {
          id: makeEntryId(save.prodCode, 0),
          name: save.prodCode,
          data: save.saveData,
          sourceName: save.prodCode,
        },
      ],
      metadata: {
        sourceFile: basename(fileName),
        saveType: "ps1",
        entryCount: 1,
        dataSize: save.header.dataSize,
        checksum: save.header.checksum,
      },
      rawInput: save.rawInput,
    };
  }

  private fromMax(input: Buffer, fileName: string): AppSaveDocument {
    const save = new MaxReader().read(input);

    return {
      id: basename(fileName),
      sourceFormat: "max",
      type: "ps2",
      displayName: save.displayName,
      dirName: save.header.dirName,
      rootMode: 0x84a7,
      entryCount: save.entries.length,
      entries: save.entries.map((entry, index) => ({
        id: makeEntryId(entry.name, index),
        name: entry.name,
        data: entry.data,
        sourceName: entry.name,
      })),
      metadata: {
        sourceFile: basename(fileName),
        saveType: "ps2",
        entryCount: save.entries.length,
        compressedSize: save.header.compressedSize,
        decompressedSize: save.header.origSize,
        maxFiles: save.header.numFiles,
      },
      rawInput: save.rawInput,
    };
  }

  private fromNpo(input: Buffer, fileName: string): AppSaveDocument {
    const base = basename(fileName);
    const extension = extname(base);
    const dirName = extension ? base.slice(0, -extension.length) : base;
    const save = new NpoReader().read(input, dirName);
    return {
      id: base,
      sourceFormat: "npo",
      type: "ps2",
      displayName: save.displayName,
      dirName: save.dirName,
      rootMode: save.rootMode,
      entryCount: save.entries.length,
      entries: normalizeEntries(save.entries),
      metadata: { sourceFile: base, saveType: "ps2", entryCount: save.entries.length, npoRecords: save.header.recordCount },
      rawInput: save.rawInput,
    };
  }

  private fromMd(input: Buffer, fileName: string): AppSaveDocument {
    const save = new MdReader().read(input);
    return {
      id: basename(fileName), sourceFormat: "md", type: "ps2", displayName: save.displayName, dirName: save.dirName, rootMode: save.rootMode,
      entryCount: save.entries.length, entries: normalizeEntries(save.entries),
      metadata: { sourceFile: basename(fileName), saveType: "ps2", entryCount: save.entries.length, mdPayloadBytes: save.entries.reduce((sum, entry) => sum + entry.size, 0) },
      rawInput: save.rawInput,
    };
  }

  private fromP2m(input: Buffer, fileName: string): AppSaveDocument {
    const save = new P2mReader().read(input);
    return {
      id: basename(fileName), sourceFormat: "p2m", type: "ps2", displayName: save.displayName, dirName: save.dirName, rootMode: save.rootMode,
      entryCount: save.entries.length, entries: normalizeEntries(save.entries),
      metadata: { sourceFile: basename(fileName), saveType: "ps2", entryCount: save.entries.length, p2mDescription: save.description },
      rawInput: save.rawInput,
    };
  }

  private fromPsu(save: ParsedPsuSave, fileName: string): AppSaveDocument {
    return {
      id: basename(fileName),
      sourceFormat: "psu",
      type: "ps2",
      displayName: save.displayName,
      dirName: save.dirName,
      rootMode: save.directoryEntry.mode,
      entryCount: save.entries.length,
      entries: normalizeEntries(save.entries),
      metadata: {
        sourceFile: basename(fileName),
        saveType: "ps2",
        entryCount: save.entries.length,
        psuFiles: save.entries.length,
      },
      rawInput: save.rawInput,
    };
  }

  private fromXps(save: ParsedXpsSave, fileName: string): AppSaveDocument {
    return {
      id: basename(fileName),
      sourceFormat: save.sourceFormat as XpsSourceFormat,
      type: "ps2",
      displayName: save.displayName,
      dirName: save.dirName,
      rootMode: save.directoryEntry.mode,
      entryCount: save.entries.length,
      entries: normalizeEntries(save.entries),
      metadata: {
        sourceFile: basename(fileName),
        saveType: "ps2",
        entryCount: save.entries.length,
        descriptorBytes: save.header.descriptorBytes,
        checksum: save.checksum,
        computedChecksum: save.computedChecksum,
        checksumValid: save.checksumValid,
      },
      rawInput: save.rawInput,
    };
  }

  private fromXpo(save: ParsedXpoSave, fileName: string): AppSaveDocument {
    return {
      id: basename(fileName),
      sourceFormat: save.sourceFormat,
      type: "ps2",
      displayName: save.displayName,
      dirName: save.dirName,
      rootMode: save.rootMode,
      entryCount: save.entries.length,
      entries: normalizeEntries(save.entries),
      metadata: {
        sourceFile: basename(fileName), saveType: "ps2", entryCount: save.entries.length,
        xpoGameName: save.header.gameName, xpoDescription: save.header.description,
      },
      rawInput: save.rawInput,
    };
  }

  private fromCbs(save: ParsedCbsSave, fileName: string): AppSaveDocument {
    return {
      id: basename(fileName),
      sourceFormat: "cbs",
      type: "ps2",
      displayName: save.displayName,
      dirName: save.dirName,
      rootMode: isPs2DirMode(save.header.mode) ? save.header.mode : 0x84a7,
      entryCount: save.entries.length,
      entries: normalizeEntries(save.entries),
      metadata: {
        sourceFile: basename(fileName),
        saveType: "ps2",
        entryCount: save.entries.length,
        compressedSize: save.header.compressedSize,
        decompressedSize: save.header.decompressedSize,
        cbsFiles: save.entries.length,
      },
      rawInput: save.rawInput,
    };
  }
}
