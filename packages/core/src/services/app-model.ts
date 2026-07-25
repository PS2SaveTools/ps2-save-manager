import type { Buffer } from "buffer";
import type { SaveType, SourceFormat } from "../models/save-model";

export interface AppSaveEntry {
  id: string;
  name: string;
  data: Buffer;
  sourceName?: string;
  attribute?: number;
  mode?: number;
  createdAt?: Date;
  modifiedAt?: Date;
  positionInFile?: number;
}

export interface AppSaveDocument {
  id: string;
  sourceFormat: SourceFormat;
  type: SaveType;
  displayName: string;
  dirName: string;
  rootMode?: number;
  entryCount: number;
  entries: AppSaveEntry[];
  metadata: Record<string, string | number | boolean>;
  rawInput: Buffer;
  edited?: boolean;
}
