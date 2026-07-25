import { Buffer } from "buffer";
import type { SaveEntry } from "../models/save-model";
import { packPs2Dirent, ps2DirMode, ps2FileMode, ps2TodFromDate, type Ps2Tod } from "./ps2-dirent";
import type { ParsedPsuSave } from "./psu-types";
import { roundUp } from "../util/math";

export interface PsuWriteInput {
  dirName: string;
  rootMode?: number;
  entries: Array<Pick<SaveEntry, "name" | "nameRaw" | "data" | "attribute" | "mode" | "createdAt" | "modifiedAt">>;
  date?: Date;
}

const psuClusterSize = 1024;

function defaultDate(input?: Date): Ps2Tod {
  return ps2TodFromDate(input ?? new Date());
}

function entryDate(date: Date | undefined, fallback: Ps2Tod): Ps2Tod {
  return date ? ps2TodFromDate(date) : fallback;
}

function dotEntry(name: "." | "..", timestamp: Ps2Tod): Buffer {
  return packPs2Dirent({
    mode: ps2DirMode,
    unknown: 0,
    length: 0,
    created: timestamp,
    cluster: 0,
    parent: 0,
    modified: timestamp,
    attr: 0,
    name,
  });
}

export class PsuWriter {
  write(input: PsuWriteInput): Buffer {
    const timestamp = defaultDate(input.date);
    const chunks = [
      packPs2Dirent({
        mode: input.rootMode ?? ps2DirMode,
        unknown: 0,
        length: input.entries.length + 2,
        created: timestamp,
        cluster: 0,
        parent: 0,
        modified: timestamp,
        attr: 0,
        name: input.dirName,
      }),
      dotEntry(".", timestamp),
      dotEntry("..", timestamp),
    ];

    for (const entry of input.entries) {
      const data = entry.data;
      const mode = entry.mode ?? entry.attribute ?? ps2FileMode;
      const created = entryDate(entry.createdAt, timestamp);
      const modified = entryDate(entry.modifiedAt, timestamp);
      const nameRaw = entry.nameRaw && entry.nameRaw.length === 448 ? entry.nameRaw : undefined;

      chunks.push(
        packPs2Dirent({
          mode,
          unknown: 0,
          length: data.length,
          created,
          cluster: 0,
          parent: 0,
          modified,
          attr: 0,
          nameRaw,
          name: entry.name,
        }),
      );
      chunks.push(data);
      chunks.push(Buffer.alloc(roundUp(data.length, psuClusterSize) - data.length, 0));
    }

    return Buffer.concat(chunks);
  }

  writeFromParsed(save: ParsedPsuSave): Buffer {
    return this.write({
      dirName: save.dirName,
      entries: save.entries,
    });
  }
}
