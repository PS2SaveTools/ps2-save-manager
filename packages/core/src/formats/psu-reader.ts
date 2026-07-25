import type { Buffer } from "buffer";
import { dateFromPs2Tod, isPs2DirMode, isPs2FileMode, ps2DirentLength, unpackPs2Dirent } from "./ps2-dirent";
import type { ParsedPsuSave } from "./psu-types";
import { roundUp } from "../util/math";

const psuClusterSize = 1024;

function readDirent(input: Buffer, offset: number) {
  if (offset + ps2DirentLength > input.length) {
    throw new Error(`PSU read out of bounds at ${offset}`);
  }

  return unpackPs2Dirent(input.subarray(offset, offset + ps2DirentLength));
}

export function isPsuBuffer(input: Buffer): boolean {
  if (input.length < ps2DirentLength * 3) {
    return false;
  }

  try {
    const dir = unpackPs2Dirent(input.subarray(0, ps2DirentLength));
    const dot = unpackPs2Dirent(input.subarray(ps2DirentLength, ps2DirentLength * 2));
    const dotdot = unpackPs2Dirent(input.subarray(ps2DirentLength * 2, ps2DirentLength * 3));

    return (
      isPs2DirMode(dir.mode) &&
      (isPs2DirMode(dot.mode) || isPs2FileMode(dot.mode)) &&
      (isPs2DirMode(dotdot.mode) || isPs2FileMode(dotdot.mode)) &&
      dir.length >= 2 &&
      dot.name === "." &&
      dotdot.name === ".."
    );
  } catch {
    return false;
  }
}

export class PsuReader {
  read(input: Buffer): ParsedPsuSave {
    const directoryEntry = readDirent(input, 0);
    const dotEntry = readDirent(input, ps2DirentLength);
    const dotdotEntry = readDirent(input, ps2DirentLength * 2);

    if (
      !isPs2DirMode(directoryEntry.mode) ||
      (!isPs2DirMode(dotEntry.mode) && !isPs2FileMode(dotEntry.mode)) ||
      (!isPs2DirMode(dotdotEntry.mode) && !isPs2FileMode(dotdotEntry.mode)) ||
      directoryEntry.length < 2 ||
      dotEntry.name !== "." ||
      dotdotEntry.name !== ".."
    ) {
      throw new Error("Not a valid PSU save");
    }

    const syntheticEntriesUseFileMode = isPs2FileMode(dotEntry.mode) && isPs2FileMode(dotdotEntry.mode);
    const fileCount = syntheticEntriesUseFileMode ? (directoryEntry.length - 2) / 2 : directoryEntry.length - 2;
    const fileEntries = [];
    const entries = [];
    let offset = ps2DirentLength * 3;

    for (let index = 0; index < fileCount; index += 1) {
      const fileEntry = readDirent(input, offset);
      offset += ps2DirentLength;

      if (!isPs2FileMode(fileEntry.mode)) {
        throw new Error(`PSU entry is not a file: ${fileEntry.name || index}`);
      }

      const dataEnd = offset + fileEntry.length;
      if (dataEnd > input.length) {
        throw new Error(`PSU read out of bounds at ${offset}`);
      }

      const data = input.subarray(offset, dataEnd);
      fileEntries.push(fileEntry);
      entries.push({
        name: fileEntry.name,
        nameRaw: fileEntry.nameRaw,
        size: fileEntry.length,
        data,
        attribute: fileEntry.mode,
        mode: fileEntry.mode,
        createdAt: dateFromPs2Tod(fileEntry.created),
        modifiedAt: dateFromPs2Tod(fileEntry.modified),
      });

      const paddedLength = roundUp(fileEntry.length, psuClusterSize);
      const nextOffset = offset + paddedLength;
      if (nextOffset > input.length && dataEnd !== input.length) {
        throw new Error(`PSU read out of bounds at ${dataEnd}`);
      }
      offset = Math.min(nextOffset, input.length);
    }

    return {
      type: "ps2",
      sourceFormat: "psu",
      displayName: directoryEntry.name,
      dirName: directoryEntry.name,
      directoryEntry,
      fileEntries,
      entries,
      rawInput: input,
    };
  }
}
