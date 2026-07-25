import { BinaryWriter } from "../binary/binary-writer";
import { readNullTerminatedAscii, writeFixedAscii, writeFixedAsciiZ } from "../binary/fixed-string";
import type { AppSaveDocument, AppSaveEntry } from "./app-model";
import { PSV_SALT_SEED } from "../formats/psv-crypto-common";

export function makePsvFileName(mainDirName: string): string {
  return `${mainDirName.slice(0, 12)}${Buffer.from(mainDirName.slice(12), "ascii").toString("hex").toUpperCase()}.PSV`;
}

function writeHeader(saveType: 1 | 2): Buffer {
  return new BinaryWriter().writeBytes(Buffer.from([0, 0x56, 0x53, 0x50])).writeInt32LE(0)
    .writeBytes(PSV_SALT_SEED).writeBytes(Buffer.alloc(20)).writeInt32LE(0).writeInt32LE(0)
    .writeInt32LE(saveType === 1 ? 0x14 : 0x2c).writeInt32LE(saveType).toBuffer();
}

function writeDate(writer: BinaryWriter, date: Date): void {
  writer.writeUInt8(0).writeUInt8(date.getSeconds()).writeUInt8(date.getMinutes()).writeUInt8(date.getHours())
    .writeUInt8(date.getDate()).writeUInt8(date.getMonth() + 1).writeUInt16LE(date.getFullYear());
}

function iconNames(data?: Buffer): string[] {
  if (!data || data.length < 452) return [];
  return [260, 324, 388].map((offset) => readNullTerminatedAscii(data.subarray(offset, offset + 64)));
}

export function buildUnsignedPs1Psv(prodCode: string, data: Buffer): Buffer {
  return new BinaryWriter().writeBytes(writeHeader(1)).writeInt32LE(data.length).writeInt32LE(132)
    .writeInt32LE(512).writeInt32LE(0).writeInt32LE(0).writeInt32LE(0).writeInt32LE(0)
    .writeInt32LE(data.length).writeInt32LE(36867).writeBytes(writeFixedAscii(prodCode, 20))
    .writeInt32LE(0).writeInt32LE(0).writeInt32LE(0).writeBytes(data).toBuffer();
}

export function buildUnsignedPs2Psv(documentModel: AppSaveDocument): Buffer {
  const entries = documentModel.entries;
  let position = 160 + entries.length * 60;
  const positioned = entries.map((entry) => {
    const current = position;
    position += entry.data.length;
    return { entry, position: current };
  });
  const names = iconNames(entries.find((entry) => entry.name === "icon.sys")?.data);
  const special = (name: string | undefined): [number, number] => {
    const found = positioned.find(({ entry }) => entry.name === name);
    return found ? [found.position, found.entry.data.length] : [0, 0];
  };
  const [sysPos, sysSize] = special("icon.sys");
  const [icon1Pos, icon1Size] = special(names[0]);
  const [icon2Pos, icon2Size] = special(names[1]);
  const [icon3Pos, icon3Size] = special(names[2]);
  const fallback = new Date("2000-01-01T00:00:00Z");
  const rootCreated = entries[0]?.createdAt ?? fallback;
  const rootModified = entries[0]?.modifiedAt ?? rootCreated;
  const writer = new BinaryWriter().writeBytes(writeHeader(2))
    .writeInt32LE(Math.ceil(entries.reduce((sum, entry) => sum + entry.data.length, 0) / 1024) * 1024)
    .writeInt32LE(sysPos).writeInt32LE(sysSize).writeInt32LE(icon1Pos).writeInt32LE(icon1Size)
    .writeInt32LE(icon2Pos).writeInt32LE(icon2Size).writeInt32LE(icon3Pos).writeInt32LE(icon3Size)
    .writeInt32LE(entries.length);
  writeDate(writer, rootCreated);
  writeDate(writer, rootModified);
  writer.writeInt32LE(entries.length + 2).writeInt32LE(documentModel.rootMode ?? 0x8427)
    .writeBytes(writeFixedAsciiZ(documentModel.dirName, 32));
  for (const { entry, position: entryPosition } of positioned) writeEntry(writer, entry, entryPosition, fallback);
  for (const { entry } of positioned) writer.writeBytes(entry.data);
  return writer.toBuffer();
}

function writeEntry(writer: BinaryWriter, entry: AppSaveEntry, position: number, fallback: Date): void {
  writeDate(writer, entry.createdAt ?? fallback);
  writeDate(writer, entry.modifiedAt ?? entry.createdAt ?? fallback);
  writer.writeInt32LE(entry.data.length).writeInt32LE(entry.attribute ?? 0x8497)
    .writeBytes(writeFixedAsciiZ(entry.name, 32)).writeInt32LE(position);
}
