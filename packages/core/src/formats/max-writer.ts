import { Buffer } from "buffer";
import { BinaryWriter } from "../binary/binary-writer";
import { writeFixedAscii, writeFixedAsciiZ } from "../binary/fixed-string";
import { encodeLzari } from "../compression/lzari";
import type { SaveEntry } from "../models/save-model";
import { crc32 } from "../util/crc32";
import { roundUp } from "../util/math";
import type { MaxEntry, ParsedMaxSave } from "./max-types";
import { decodeSjisTitle } from "./sjis";

export interface MaxWriteInput {
  dirName: string;
  entries: Array<Pick<SaveEntry, "name" | "data">>;
  iconSysName?: string;
}

// icon.sys layout: the S-JIS title occupies 34 words at offset 192 (see
// TIconSys in PSVFormat.pas / Ticon_sys in maxFormat.pas).
const ICON_SYS_TITLE_START = 192;
const ICON_SYS_TITLE_END = 260;

// AR Max banned characters are replaced with spaces and names are capped at
// 31 characters plus NUL (TMaxSave.cleanString / addFileFromStream).
function cleanMaxName(input: string): string {
  return input.replace(/[*/?]/g, " ").slice(0, 31);
}

function deriveIconSysName(entries: Array<Pick<SaveEntry, "name" | "data">>): string {
  const iconSys = entries.find((entry) => entry.name.toLowerCase() === "icon.sys");
  if (!iconSys || iconSys.data.length < ICON_SYS_TITLE_END) {
    return "New File";
  }

  const titleRaw = iconSys.data.subarray(ICON_SYS_TITLE_START, ICON_SYS_TITLE_END);
  const secondLineOffset = Math.min(iconSys.data.readUInt16LE(6), titleRaw.length);
  const firstLine = decodeSjisTitle(titleRaw.subarray(0, secondLineOffset));
  const secondLine = decodeSjisTitle(titleRaw.subarray(secondLineOffset));

  // MAX has a single description field, so flatten icon.sys's two title
  // lines the same way as mymc++: add one separator when line one does not
  // already end in a space, while removing padding around line two.
  return firstLine && !firstLine.endsWith(" ")
    ? `${firstLine} ${secondLine.trim()}`
    : `${firstLine}${secondLine.trimEnd()}`;
}

function buildClump(entries: Array<Pick<SaveEntry, "name" | "data">>): Buffer {
  const writer = new BinaryWriter();

  for (const entry of entries) {
    writer
      .writeInt32LE(entry.data.length)
      .writeBytes(writeFixedAsciiZ(cleanMaxName(entry.name), 32))
      .writeBytes(entry.data);

    const padding = roundUp(writer.length() + 8, 16) - 8 - writer.length();
    if (padding > 0) {
      writer.writeBytes(Buffer.alloc(padding, 0));
    }
  }

  return writer.toBuffer();
}

function makeHeader(input: MaxWriteInput, compressedPayload: Buffer, clump: Buffer): Buffer {
  const header = Buffer.alloc(92, 0);
  const dirName = cleanMaxName(input.dirName) || "New Directory";
  const iconSysName = input.iconSysName ?? deriveIconSysName(input.entries);

  header.write("Ps2PowerSave", 0, "ascii");
  writeFixedAsciiZ(dirName, 32).copy(header, 16);
  // mymc++ packs this as a fixed 32-byte field, using the final byte when
  // the flattened title is exactly 32 characters instead of reserving it
  // for a NUL terminator.
  writeFixedAscii(iconSysName, 32).copy(header, 48);
  header.writeInt32LE(compressedPayload.length + 4, 80);
  header.writeInt32LE(input.entries.length, 84);
  header.writeInt32LE(clump.length, 88);

  return header;
}

function withChecksum(header: Buffer, compressedPayload: Buffer): Buffer {
  const output = Buffer.concat([header, compressedPayload]);
  const checksumInput = Buffer.from(output);
  checksumInput.writeUInt32LE(0, 12);
  output.writeUInt32LE(crc32(checksumInput), 12);
  return output;
}

export class MaxWriter {
  write(input: MaxWriteInput): Buffer {
    const clump = buildClump(input.entries);
    const compressedPayload = encodeLzari(clump);
    const header = makeHeader(input, compressedPayload, clump);

    return withChecksum(header, compressedPayload);
  }

  writeFromParsed(save: ParsedMaxSave): Buffer {
    return this.write({
      dirName: save.header.dirName,
      iconSysName: save.header.iconSysName,
      entries: save.entries.map((entry: MaxEntry) => ({
        name: entry.name,
        data: entry.data,
      })),
    });
  }
}
