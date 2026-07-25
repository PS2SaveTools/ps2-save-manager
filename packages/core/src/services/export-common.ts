import { CbsWriter } from "../formats/cbs-writer";
import { MaxWriter } from "../formats/max-writer";
import { McsWriter } from "../formats/mcs-writer";
import { MdWriter } from "../formats/md-writer";
import { NpoWriter } from "../formats/npo-writer";
import { P2mWriter } from "../formats/p2m-writer";
import { PsuWriter } from "../formats/psu-writer";
import { XpoWriter } from "../formats/xpo-writer";
import { XpsWriter } from "../formats/xps-writer";
import type { AppSaveDocument } from "./app-model";
import type { ExportFormat } from "./export-service";
export { sanitizeFileName } from "../util/path";

export function availableExportFormats(documentModel: AppSaveDocument): ExportFormat[] {
  return documentModel.type === "ps1" ? ["psv", "mc", "mcs"] : ["psv", "max", "pws", "psu", "xps", "sps", "xpo", "spo", "cbs", "npo", "md", "p2m"];
}

// PSV is deliberately handled by the caller because signing is runtime-specific.
// Every other format is assembled here so Node and browser exports cannot drift.
export function exportUnsignedFormat(documentModel: AppSaveDocument, format: Exclude<ExportFormat, "psv">): Buffer {
  if (format === documentModel.sourceFormat && !documentModel.edited) return documentModel.rawInput;

  if (documentModel.type === "ps1") {
    const entry = documentModel.entries[0];
    if (!entry) throw new Error("PS1 save has no payload to export");
    if (format === "mc") return entry.data;
    if (format === "mcs") return new McsWriter().write({ prodCode: documentModel.dirName, saveData: entry.data });
    throw new Error(`${format.toUpperCase()} export is not available for PS1 saves`);
  }

  const entries = documentModel.entries;
  if (format === "max" || format === "pws") return new MaxWriter().write({ dirName: documentModel.dirName, entries });
  if (format === "npo") return new NpoWriter().write({ entries, rootMode: documentModel.rootMode });
  if (format === "md") return new MdWriter().write({ dirName: documentModel.dirName, rootMode: documentModel.rootMode, entries });
  if (format === "p2m") return new P2mWriter().write({ dirName: documentModel.dirName, rootMode: documentModel.rootMode, displayName: documentModel.displayName, entries });
  if (format === "xpo" || format === "spo") return new XpoWriter().write({ dirName: documentModel.dirName, rootMode: documentModel.rootMode, displayName: documentModel.displayName, entries });
  if (format === "psu") return new PsuWriter().write({ dirName: documentModel.dirName, rootMode: documentModel.rootMode, entries });
  if (format === "xps" || format === "sps") return new XpsWriter().write({ dirName: documentModel.dirName, rootMode: documentModel.rootMode, entries, sourceFormat: format });
  if (format === "cbs") return new CbsWriter().write({ dirName: documentModel.dirName, rootMode: documentModel.rootMode, entries });
  throw new Error(`Unsupported export format: ${format}`);
}
