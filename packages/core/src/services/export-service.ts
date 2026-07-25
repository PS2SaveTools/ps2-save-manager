import { PsvWriter } from "../formats/psv-writer";
import type { AppSaveDocument } from "./app-model";
import { availableExportFormats, exportUnsignedFormat, sanitizeFileName } from "./export-common";
import { buildUnsignedPs1Psv, buildUnsignedPs2Psv, makePsvFileName } from "./psv-export-payload";

export type ExportFormat = "psv" | "mc" | "mcs" | "max" | "pws" | "psu" | "xps" | "sps" | "cbs" | "npo" | "xpo" | "spo" | "md" | "p2m";
export interface ExportedSave { fileName: string; mimeType: string; data: Buffer }

export class ExportService {
  availableFormats(documentModel: AppSaveDocument): ExportFormat[] { return availableExportFormats(documentModel); }

  export(documentModel: AppSaveDocument, format: ExportFormat): ExportedSave {
    if (!this.availableFormats(documentModel).includes(format)) throw new Error(`${format.toUpperCase()} export is not available for ${documentModel.type.toUpperCase()} saves`);
    const baseName = sanitizeFileName(documentModel.dirName || documentModel.displayName);
    let data: Buffer;
    if (format === "psv") {
      const payload = documentModel.type === "ps1"
        ? buildUnsignedPs1Psv(documentModel.dirName, documentModel.entries[0]?.data ?? Buffer.alloc(0))
        : buildUnsignedPs2Psv(documentModel);
      const signature = PsvWriter.sign(payload);
      signature.copy(payload, 28);
      data = payload;
    } else data = exportUnsignedFormat(documentModel, format);
    return { fileName: format === "psv" ? makePsvFileName(documentModel.dirName || documentModel.displayName) : `${baseName}.${format}`, mimeType: "application/octet-stream", data };
  }
}
