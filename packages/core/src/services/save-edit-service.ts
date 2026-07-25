import { Buffer } from "buffer";
import type { AppSaveDocument, AppSaveEntry } from "./app-model";
import { basename, makeEntryId } from "../util/path";

export interface AddAppSaveEntryInput {
  name: string;
  data: Buffer;
  date?: Date;
}

export function createBlankPs2Save(iconSys: Buffer, icon: Buffer, date = new Date()): AppSaveDocument {
  if (iconSys.length < 452 || iconSys.subarray(0, 4).toString("ascii") !== "PS2D") throw new Error("Invalid blank-save icon.sys seed");
  return {
    id: "NEW_FILE",
    sourceFormat: "new",
    type: "ps2",
    displayName: "NEW_FILE",
    dirName: "NEW_FILE",
    rootMode: defaultPs2RootMode,
    entryCount: 2,
    entries: [
      { id: "0:icon.sys", name: "icon.sys", sourceName: "icon.sys", data: Buffer.from(iconSys), mode: defaultPs2FileMode, attribute: defaultPs2FileMode, createdAt: date, modifiedAt: date },
      { id: "1:my.icn", name: "my.icn", sourceName: "my.icn", data: Buffer.from(icon), mode: defaultPs2FileMode, attribute: defaultPs2FileMode, createdAt: date, modifiedAt: date },
    ],
    metadata: { sourceFile: "New blank save", saveType: "ps2", entryCount: 2, rootId: "NEW_FILE" },
    rawInput: Buffer.alloc(0),
    edited: true,
  };
}

export const editableFileAttributeMask = 0x400f;
export const defaultPs2FileMode = 0x8497;
export const defaultPs2RootMode = 0x84a7;

export interface EditableFileAttributes {
  readable: boolean;
  writable: boolean;
  executable: boolean;
  copyProtected: boolean;
  hidden: boolean;
}

export function editableFileAttributes(mode = defaultPs2FileMode): EditableFileAttributes {
  return {
    readable: (mode & 0x0001) !== 0,
    writable: (mode & 0x0002) !== 0,
    executable: (mode & 0x0004) !== 0,
    copyProtected: (mode & 0x0008) !== 0,
    hidden: (mode & 0x4000) !== 0,
  };
}

export function updateAppSaveEntryAttributes(
  documentModel: AppSaveDocument,
  entryId: string,
  attributes: EditableFileAttributes,
): AppSaveDocument {
  const index = documentModel.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return documentModel;
  const entry = documentModel.entries[index]!;
  const oldMode = entry.mode ?? entry.attribute ?? defaultPs2FileMode;
  const editableMode =
    (attributes.readable ? 0x0001 : 0) |
    (attributes.writable ? 0x0002 : 0) |
    (attributes.executable ? 0x0004 : 0) |
    (attributes.copyProtected ? 0x0008 : 0) |
    (attributes.hidden ? 0x4000 : 0);
  const mode = (oldMode & ~editableFileAttributeMask) | editableMode;
  if (mode === oldMode && entry.mode === mode && entry.attribute === mode) return documentModel;
  const entries = [...documentModel.entries];
  entries[index] = { ...entry, mode, attribute: mode };
  return withEntries(documentModel, entries);
}

/**
 * Cleans a host filename for use as a PS2 save entry name.
 * PS2 tooling safely interoperates on printable ASCII (0x20-0x7e), except
 * for '*', '/' and '?', which are removed rather than substituted.
 */
export function sanitizeAddedPs2FileName(input: string): string {
  return basename(input).replace(/[^\x20-\x7e]|[*/?]/g, "").trim();
}

function validatePs2Name(input: string, label: string): string {
  const name = input.trim();
  if (!name) throw new Error(`${label} is required`);
  if (/[\\/:*?"<>|\0]/.test(name)) throw new Error(`${label} contains an unsupported character`);
  if (Buffer.byteLength(name, "utf8") > 31) throw new Error(`${label} must be 31 bytes or fewer`);
  return name;
}

function normalizeEntry(entry: AppSaveEntry, index: number): AppSaveEntry {
  return {
    ...entry,
    id: makeEntryId(entry.name, index),
  };
}

function withEntries(documentModel: AppSaveDocument, entries: AppSaveEntry[]): AppSaveDocument {
  const normalizedEntries = entries.map(normalizeEntry);

  return {
    ...documentModel,
    edited: true,
    entryCount: normalizedEntries.length,
    entries: normalizedEntries,
    metadata: {
      ...documentModel.metadata,
      entryCount: normalizedEntries.length,
    },
  };
}

export function addAppSaveEntries(
  documentModel: AppSaveDocument,
  additions: AddAppSaveEntryInput[],
): AppSaveDocument {
  if (additions.length === 0) {
    return documentModel;
  }

  const names = new Set(documentModel.entries.map((entry) => entry.name.toLowerCase()));
  const newEntries = additions.map((addition) => {
    const name = sanitizeAddedPs2FileName(addition.name);
    if (!name) {
      throw new Error("Entry name is required");
    }

    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) {
      throw new Error(`Entry already exists: ${name}`);
    }
    names.add(normalizedName);

    return {
      id: "",
      name,
      data: Buffer.from(addition.data),
      sourceName: name,
      createdAt: addition.date,
      modifiedAt: addition.date,
    };
  });

  return withEntries(documentModel, [...documentModel.entries, ...newEntries]);
}

export function removeAppSaveEntry(documentModel: AppSaveDocument, entryId: string): AppSaveDocument {
  const entries = documentModel.entries.filter((entry) => entry.id !== entryId);
  return entries.length === documentModel.entries.length ? documentModel : withEntries(documentModel, entries);
}

export function renameAppSaveEntry(documentModel: AppSaveDocument, entryId: string, input: string): AppSaveDocument {
  const index = documentModel.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return documentModel;
  const name = validatePs2Name(input, "File name");
  if (documentModel.entries.some((entry, candidateIndex) => candidateIndex !== index && entry.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Entry already exists: ${name}`);
  }
  if (documentModel.entries[index]!.name === name) return documentModel;
  const entries = [...documentModel.entries];
  entries[index] = { ...entries[index]!, name };
  return withEntries(documentModel, entries);
}

export function renameAppSaveRoot(documentModel: AppSaveDocument, input: string): AppSaveDocument {
  const dirName = validatePs2Name(input, "Root/ID");
  if (dirName === documentModel.dirName) return documentModel;
  return {
    ...documentModel,
    dirName,
    displayName: documentModel.displayName === documentModel.dirName ? dirName : documentModel.displayName,
    edited: true,
    metadata: { ...documentModel.metadata, rootId: dirName },
  };
}

export function updateAppSaveRootAttributes(documentModel: AppSaveDocument, attributes: EditableFileAttributes): AppSaveDocument {
  const oldMode = documentModel.rootMode ?? defaultPs2RootMode;
  const editableMode =
    (attributes.readable ? 0x0001 : 0) | (attributes.writable ? 0x0002 : 0) |
    (attributes.executable ? 0x0004 : 0) | (attributes.copyProtected ? 0x0008 : 0) |
    (attributes.hidden ? 0x4000 : 0);
  const rootMode = (oldMode & ~editableFileAttributeMask) | editableMode;
  return rootMode === oldMode && documentModel.rootMode === rootMode
    ? documentModel
    : { ...documentModel, rootMode, edited: true };
}
